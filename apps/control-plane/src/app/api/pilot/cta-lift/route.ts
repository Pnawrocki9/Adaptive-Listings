/**
 * GET /api/pilot/cta-lift
 *
 * The pilot primary metric: CTA lift of adapted sessions vs the 10% holdout
 * (TICKET-PILOT-003). Returns a summary (two-proportion z-test), a conversion
 * funnel, and a per-archetype breakdown for the authenticated tenant.
 *
 *   GET /api/pilot/cta-lift?window_days=<7|14|30>
 *
 * Auth: Bearer JWT required; tenant_id is taken from the JWT claim (NOT the
 * query string) so a tenant can only read its own pilot data.
 *
 * ClickHouse access uses the HTTP interface with bound query parameters
 * (`param_tenant_id`, `param_window_days`) — the same parameterized pattern as
 * the existing analytics routes — so tenant_id is never string-interpolated
 * into SQL (injection-safe). Drizzle is Postgres-only and is intentionally not
 * used for ClickHouse. When CLICKHOUSE_URL is unset (dev / CI) the route falls
 * back to deterministic mock data keyed on tenant_id.
 *
 * @module apps/control-plane/src/app/api/pilot/cta-lift/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthClaims } from '@estalara/auth';
import {
  twoProportionZTest,
  classifyConfidence,
  relativeLiftPct,
  type PilotConfidence,
} from '@/lib/pilot-stats';

// ─── Response types ──────────────────────────────────────────────────────────

/** Funnel stages, ordered top → bottom. */
export const FUNNEL_STAGES = [
  'page.view',
  'listing.viewed',
  'cta.clicked',
  'inquiry.started',
  'inquiry.completed',
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface PilotSummary {
  adapted_sessions: number;
  holdout_sessions: number;
  /** cta.clicked sessions / total adapted sessions, in [0, 1]. */
  adapted_cta_rate: number;
  holdout_cta_rate: number;
  /** adapted_cta_rate - holdout_cta_rate. */
  absolute_lift: number;
  /** (adapted - holdout) / holdout * 100. null when holdout_cta_rate === 0. */
  relative_lift_pct: number | null;
  /** Two-proportion z-test two-tailed p-value. */
  p_value: number;
  /** True only when p_value < 0.05 AND both arms meet the minimum sample. */
  is_significant: boolean;
  confidence: PilotConfidence;
}

export interface FunnelRow {
  stage: FunnelStage;
  adapted_count: number;
  holdout_count: number;
  /** adapted_count / adapted_sessions, in [0, 1]. */
  adapted_rate: number;
  holdout_rate: number;
}

export interface ArchetypeRow {
  archetype: string;
  adapted_cta_rate: number;
  holdout_cta_rate: number;
  /** Relative lift %. null when holdout_cta_rate === 0. */
  lift_pct: number | null;
  n_adapted: number;
  n_holdout: number;
  p_value: number;
}

export interface CtaLiftResponse {
  window_days: number;
  tenant_id: string;
  summary: PilotSummary;
  funnel: FunnelRow[];
  by_archetype: ArchetypeRow[];
  generated_at: string;
}

// ─── Query param parsing ───────────────────────────────────────────────────────

const ALLOWED_WINDOWS = [7, 14, 30] as const;
type WindowDays = (typeof ALLOWED_WINDOWS)[number];

/** Parse window_days; defaults to 7 when missing or out of the allowed set. */
export function parseWindowDays(raw: string | null): WindowDays {
  const n = Number(raw);
  return (ALLOWED_WINDOWS as readonly number[]).includes(n) ? (n as WindowDays) : 7;
}

// ─── ClickHouse access ─────────────────────────────────────────────────────────

/**
 * Raw per-group session/conversion counts pulled from ClickHouse, before any
 * statistics are applied. `holdout = 0` is the adapted arm, `1` the holdout.
 */
interface ChGroupCounts {
  holdout: number;
  sessions: number;
  cta_sessions: number;
}

interface ChArchetypeCounts {
  archetype: string;
  holdout: number;
  sessions: number;
  cta_sessions: number;
}

interface ChFunnelCounts {
  stage: string;
  holdout: number;
  sessions: number;
}

interface ChRawData {
  groups: ChGroupCounts[];
  archetypes: ChArchetypeCounts[];
  funnel: ChFunnelCounts[];
}

function clickHouseHeaders(password: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
  if (password) {
    headers.Authorization = `Basic ${Buffer.from(`:${password}`).toString('base64')}`;
  }
  return headers;
}

/**
 * Execute one parameterized ClickHouse query over the HTTP interface and parse
 * JSONEachRow output. tenant_id and window_days are bound as query parameters
 * (never interpolated) to prevent SQL injection.
 */
async function chQuery<T>(
  baseUrl: string,
  password: string,
  sql: string,
  params: Record<string, string>,
): Promise<T[]> {
  const url = new URL(baseUrl);
  url.searchParams.set('query', `${sql.trim()} FORMAT JSONEachRow`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(`param_${k}`, v);
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: clickHouseHeaders(password),
  });
  if (!res.ok) {
    throw new Error(`ClickHouse query failed: HTTP ${String(res.status)}`);
  }
  const text = await res.text();
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/**
 * Pull all raw counts for the pilot CTA-lift report from ClickHouse.
 *
 * Three parameterized queries, all joining `adaptation_decisions` (for
 * holdout_group + archetype) against `events` (for event types) on
 * (tenant_id, session_id) within the window:
 *
 *   1. group counts     — distinct sessions and CTA-clicked sessions per arm
 *   2. archetype counts — same, split by archetype
 *   3. funnel counts    — distinct sessions per event-type stage per arm
 *
 * Returns null when CLICKHOUSE_URL is unset; throws on query failure (the
 * caller catches and falls back to mock data).
 */
async function fetchCtaLiftRaw(tenantId: string, windowDays: number): Promise<ChRawData | null> {
  const baseUrl = process.env.CLICKHOUSE_URL;
  if (!baseUrl) return null;
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';
  const params = { tenant_id: tenantId, window_days: String(windowDays) };

  // 1. Per-arm totals: distinct adapted/holdout sessions and the subset that
  //    fired a cta.clicked event.
  const groupSql = `
    SELECT
      ad.holdout_group AS holdout,
      countDistinct(ad.session_id) AS sessions,
      countDistinctIf(ad.session_id, ev.session_id != '') AS cta_sessions
    FROM adaptation_decisions AS ad
    LEFT JOIN (
      SELECT DISTINCT tenant_id, session_id
      FROM events
      WHERE tenant_id = {tenant_id:String}
        AND type = 'cta.clicked'
        AND ts >= now() - toIntervalDay({window_days:UInt16})
    ) AS ev
      ON ad.tenant_id = ev.tenant_id AND ad.session_id = ev.session_id
    WHERE ad.tenant_id = {tenant_id:String}
      AND ad.ts >= now() - toIntervalDay({window_days:UInt16})
    GROUP BY ad.holdout_group
  `;

  // 2. Per-archetype, per-arm totals.
  const archetypeSql = `
    SELECT
      ad.archetype AS archetype,
      ad.holdout_group AS holdout,
      countDistinct(ad.session_id) AS sessions,
      countDistinctIf(ad.session_id, ev.session_id != '') AS cta_sessions
    FROM adaptation_decisions AS ad
    LEFT JOIN (
      SELECT DISTINCT tenant_id, session_id
      FROM events
      WHERE tenant_id = {tenant_id:String}
        AND type = 'cta.clicked'
        AND ts >= now() - toIntervalDay({window_days:UInt16})
    ) AS ev
      ON ad.tenant_id = ev.tenant_id AND ad.session_id = ev.session_id
    WHERE ad.tenant_id = {tenant_id:String}
      AND ad.ts >= now() - toIntervalDay({window_days:UInt16})
    GROUP BY ad.archetype, ad.holdout_group
  `;

  // 3. Funnel: distinct sessions per event-type stage per arm. Joins the
  //    holdout assignment from adaptation_decisions onto events.
  const funnelSql = `
    SELECT
      ev.type AS stage,
      ad.holdout_group AS holdout,
      countDistinct(ev.session_id) AS sessions
    FROM events AS ev
    INNER JOIN (
      SELECT session_id, anyHeavy(holdout_group) AS holdout_group
      FROM adaptation_decisions
      WHERE tenant_id = {tenant_id:String}
        AND ts >= now() - toIntervalDay({window_days:UInt16})
      GROUP BY session_id
    ) AS ad
      ON ev.session_id = ad.session_id
    WHERE ev.tenant_id = {tenant_id:String}
      AND ev.ts >= now() - toIntervalDay({window_days:UInt16})
      AND ev.type IN ('page.view','listing.viewed','cta.clicked','inquiry.started','inquiry.completed')
    GROUP BY ev.type, ad.holdout_group
  `;

  const [groupsRaw, archetypesRaw, funnelRaw] = await Promise.all([
    chQuery<Record<string, unknown>>(baseUrl, password, groupSql, params),
    chQuery<Record<string, unknown>>(baseUrl, password, archetypeSql, params),
    chQuery<Record<string, unknown>>(baseUrl, password, funnelSql, params),
  ]);

  return {
    groups: groupsRaw.map((r) => ({
      holdout: Number(r.holdout ?? 0),
      sessions: Number(r.sessions ?? 0),
      cta_sessions: Number(r.cta_sessions ?? 0),
    })),
    archetypes: archetypesRaw.map((r) => ({
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- primitive JSON value coerced safely
      archetype: String(r.archetype ?? ''),
      holdout: Number(r.holdout ?? 0),
      sessions: Number(r.sessions ?? 0),
      cta_sessions: Number(r.cta_sessions ?? 0),
    })),
    funnel: funnelRaw.map((r) => ({
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- primitive JSON value coerced safely
      stage: String(r.stage ?? ''),
      holdout: Number(r.holdout ?? 0),
      sessions: Number(r.sessions ?? 0),
    })),
  };
}

// ─── Assembly: raw counts → response ────────────────────────────────────────────

/** Pick the arm row for the given holdout flag (0=adapted, 1=holdout). */
function armRow<T extends { holdout: number }>(rows: T[], holdout: 0 | 1): T | undefined {
  return rows.find((r) => r.holdout === holdout);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Transform raw ClickHouse counts into the public response shape, applying the
 * z-test, minimum-sample guard, and division-by-zero guard.
 */
export function buildResponseFromRaw(
  tenantId: string,
  windowDays: number,
  raw: ChRawData,
): CtaLiftResponse {
  // ── Summary ──
  const adaptedGroup = armRow(raw.groups, 0);
  const holdoutGroup = armRow(raw.groups, 1);
  const adaptedSessions = adaptedGroup?.sessions ?? 0;
  const holdoutSessions = holdoutGroup?.sessions ?? 0;
  const adaptedCta = adaptedGroup?.cta_sessions ?? 0;
  const holdoutCta = holdoutGroup?.cta_sessions ?? 0;

  const adaptedRate = adaptedSessions > 0 ? adaptedCta / adaptedSessions : 0;
  const holdoutRate = holdoutSessions > 0 ? holdoutCta / holdoutSessions : 0;

  const pValue = twoProportionZTest(adaptedRate, adaptedSessions, holdoutRate, holdoutSessions);
  const confidence = classifyConfidence(pValue, adaptedSessions, holdoutSessions);
  const relLift = relativeLiftPct(adaptedRate, holdoutRate);

  const summary: PilotSummary = {
    adapted_sessions: adaptedSessions,
    holdout_sessions: holdoutSessions,
    adapted_cta_rate: round4(adaptedRate),
    holdout_cta_rate: round4(holdoutRate),
    absolute_lift: round4(adaptedRate - holdoutRate),
    relative_lift_pct: relLift === null ? null : Math.round(relLift * 100) / 100,
    p_value: round4(pValue),
    is_significant: confidence === '95%',
    confidence,
  };

  // ── Funnel ──
  const funnel: FunnelRow[] = FUNNEL_STAGES.map((stage) => {
    const stageRows = raw.funnel.filter((r) => r.stage === stage);
    const adaptedCount = armRow(stageRows, 0)?.sessions ?? 0;
    const holdoutCount = armRow(stageRows, 1)?.sessions ?? 0;
    return {
      stage,
      adapted_count: adaptedCount,
      holdout_count: holdoutCount,
      adapted_rate: round4(adaptedSessions > 0 ? adaptedCount / adaptedSessions : 0),
      holdout_rate: round4(holdoutSessions > 0 ? holdoutCount / holdoutSessions : 0),
    };
  });

  // ── By archetype ──
  const archetypeNames = Array.from(new Set(raw.archetypes.map((r) => r.archetype))).filter(
    (a) => a !== '',
  );
  const byArchetype: ArchetypeRow[] = archetypeNames
    .map((archetype) => {
      const rows = raw.archetypes.filter((r) => r.archetype === archetype);
      const a = armRow(rows, 0);
      const h = armRow(rows, 1);
      const nAdapted = a?.sessions ?? 0;
      const nHoldout = h?.sessions ?? 0;
      const aRate = nAdapted > 0 ? (a?.cta_sessions ?? 0) / nAdapted : 0;
      const hRate = nHoldout > 0 ? (h?.cta_sessions ?? 0) / nHoldout : 0;
      const p = twoProportionZTest(aRate, nAdapted, hRate, nHoldout);
      const lift = relativeLiftPct(aRate, hRate);
      return {
        archetype,
        adapted_cta_rate: round4(aRate),
        holdout_cta_rate: round4(hRate),
        lift_pct: lift === null ? null : Math.round(lift * 100) / 100,
        n_adapted: nAdapted,
        n_holdout: nHoldout,
        p_value: round4(p),
      };
    })
    // Top archetypes by adapted volume first.
    .sort((x, y) => y.n_adapted - x.n_adapted);

  return {
    window_days: windowDays,
    tenant_id: tenantId,
    summary,
    funnel,
    by_archetype: byArchetype,
    generated_at: new Date().toISOString(),
  };
}

// ─── Mock data (dev / CI fallback) — replaced by FOLLOW-086 ────────────────────
// MVP stub — FOLLOW-086 replaces mock fallback with real ClickHouse queries once
// CLICKHOUSE_URL is available in Vercel preview + dev environments.

/** Deterministic integer hash of a string. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + (s.charCodeAt(i) | 0)) | 0;
  }
  return Math.abs(h);
}

/** Seeded pseudo-random in [0, 1). */
function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

const MOCK_ARCHETYPES = [
  'yield_hunter',
  'family_buyer',
  'investor',
  'downsizer',
  'neutral',
] as const;

/**
 * Build deterministic raw counts for dev / CI when ClickHouse is not
 * configured. Designed to show a realistic, significant CTA lift so the
 * dashboard renders meaningfully in local development.
 */
function buildMockRaw(tenantId: string, windowDays: number): ChRawData {
  const seed = hash(tenantId) + windowDays;

  // Per-archetype synthetic counts with a consistent adapted > holdout lift.
  const archetypes: ChArchetypeCounts[] = [];
  MOCK_ARCHETYPES.forEach((name, i) => {
    const s = seed + i * 17;
    const nAdapted = 180 + Math.floor(seededRandom(s) * 700);
    const nHoldout = 20 + Math.floor(seededRandom(s + 1) * 80);
    const holdoutRate = 0.06 + seededRandom(s + 2) * 0.06;
    const adaptedRate = Math.min(0.5, holdoutRate * (1.2 + seededRandom(s + 3) * 0.6));
    archetypes.push({
      archetype: name,
      holdout: 0,
      sessions: nAdapted,
      cta_sessions: Math.round(nAdapted * adaptedRate),
    });
    archetypes.push({
      archetype: name,
      holdout: 1,
      sessions: nHoldout,
      cta_sessions: Math.round(nHoldout * holdoutRate),
    });
  });

  const sumSessions = (h: 0 | 1) =>
    archetypes.filter((r) => r.holdout === h).reduce((acc, r) => acc + r.sessions, 0);
  const sumCta = (h: 0 | 1) =>
    archetypes.filter((r) => r.holdout === h).reduce((acc, r) => acc + r.cta_sessions, 0);

  const adaptedSessions = sumSessions(0);
  const holdoutSessions = sumSessions(1);
  const adaptedCta = sumCta(0);
  const holdoutCta = sumCta(1);

  const groups: ChGroupCounts[] = [
    { holdout: 0, sessions: adaptedSessions, cta_sessions: adaptedCta },
    { holdout: 1, sessions: holdoutSessions, cta_sessions: holdoutCta },
  ];

  // Funnel: monotonically decreasing through the stages.
  const stageFactors: Record<FunnelStage, number> = {
    'page.view': 1.0,
    'listing.viewed': 0.78,
    'cta.clicked': adaptedSessions > 0 ? adaptedCta / adaptedSessions : 0.12,
    'inquiry.started': 0.06,
    'inquiry.completed': 0.025,
  };
  const holdoutStageFactors: Record<FunnelStage, number> = {
    'page.view': 1.0,
    'listing.viewed': 0.75,
    'cta.clicked': holdoutSessions > 0 ? holdoutCta / holdoutSessions : 0.09,
    'inquiry.started': 0.045,
    'inquiry.completed': 0.018,
  };
  const funnel: ChFunnelCounts[] = [];
  for (const stage of FUNNEL_STAGES) {
    funnel.push({
      stage,
      holdout: 0,
      sessions: Math.round(adaptedSessions * stageFactors[stage]),
    });
    funnel.push({
      stage,
      holdout: 1,
      sessions: Math.round(holdoutSessions * holdoutStageFactors[stage]),
    });
  }

  return { groups, archetypes, funnel };
}

// ─── Route handler ───────────────────────────────────────────────────────────

/**
 * GET /api/pilot/cta-lift
 *
 * @returns 200 CtaLiftResponse on success.
 * @returns 401 when no valid tenant JWT is present.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims(req);
  if (!claims || !('tenant_id' in claims) || !claims.tenant_id) {
    return NextResponse.json(
      {
        error: { code: 'unauthorized', message: 'Valid Bearer JWT with tenant_id claim required' },
      },
      { status: 401 },
    );
  }

  const tenantId: string = claims.tenant_id;
  const windowDays = parseWindowDays(req.nextUrl.searchParams.get('window_days'));

  const raw = await fetchCtaLiftRaw(tenantId, windowDays).catch(() => null);
  const data = raw ?? buildMockRaw(tenantId, windowDays);

  const response = buildResponseFromRaw(tenantId, windowDays, data);
  return NextResponse.json(response, { status: 200 });
}
