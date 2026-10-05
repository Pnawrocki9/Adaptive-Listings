/**
 * Types, ClickHouse access and report assembly for GET /api/dashboard/analytics/lift — the ONE
 * CTA-lift surface (FOLLOW-1289, WP-2.4 of the audit-remediation plan).
 *
 * Before FOLLOW-1289 two routes computed the pilot's primary metric independently
 * (`/api/pilot/cta-lift` for the pilot dashboard, `/api/dashboard/analytics/lift` for the analytics
 * panels). Both now read ONE set of ClickHouse queries and derive every rate / lift / p-value from
 * {@link computeArmLift} in `@/lib/pilot-stats`.
 *
 * Lives outside `route.ts` so Next.js 15 accepts that file as a route segment (it may export only
 * HTTP handlers and config).
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/lift/route-helpers
 */

import type { ArchetypeId } from '@estalara/shared';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';
import { computeArmLift, type PilotConfidence } from '@/lib/pilot-stats';

// ─── Response types ──────────────────────────────────────────────────────────

/** Funnel stages, ordered top → bottom. */
const FUNNEL_STAGES = [
  'page.view',
  'listing.viewed',
  'cta.clicked',
  'inquiry.started',
  'inquiry.completed',
] as const;

type FunnelStage = (typeof FUNNEL_STAGES)[number];

interface PilotSummary {
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

interface FunnelRow {
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

/** One row of the analytics "Conversion lift" panel (the same cohort as {@link ArchetypeRow}). */
export interface LiftRow {
  archetype: string;
  adaptedRate: number;
  holdoutRate: number;
  adaptedN: number;
  holdoutN: number;
  /** (adaptedRate - holdoutRate) / holdoutRate * 100. 0 (not null) when holdoutRate=0. */
  lift: number;
  /** Two-tailed p-value from two-proportion z-test. */
  pValue: number;
  /** Significance status bucket. */
  status: 'significant' | 'trending' | 'not_significant';
}

export interface LiftResponse {
  tenant_id: string;
  window_days: number;
  /** Per-arm totals + z-test (the pilot primary metric). */
  summary: PilotSummary;
  /** Conversion funnel by arm. */
  funnel: FunnelRow[];
  /** Per-archetype breakdown, pilot shape (null lift when holdout rate is 0). */
  by_archetype: ArchetypeRow[];
  /** Per-archetype breakdown, analytics-panel shape (same cohorts and numbers as by_archetype). */
  rows: LiftRow[];
  /** True when no adapted/holdout sessions exist in the window — rows will be empty. */
  dqsUnavailable: boolean;
  generated_at: string;
  /**
   * Provenance field (Rule K.2).
   * 'clickhouse' — live data from a successful ClickHouse query.
   * 'mock'       — CLICKHOUSE_URL is unset (dev / CI); deterministic stub data.
   */
  data_source: 'clickhouse' | 'mock';
}

// ─── Internal ClickHouse row shapes ──────────────────────────────────────────

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

export interface ChRawData {
  groups: ChGroupCounts[];
  archetypes: ChArchetypeCounts[];
  funnel: ChFunnelCounts[];
}

// ─── Query param parsing ─────────────────────────────────────────────────────

const ALLOWED_WINDOWS = [7, 14, 30] as const;
type WindowDays = (typeof ALLOWED_WINDOWS)[number];

/** Parse window_days; defaults to 7 when missing or out of the allowed set. */
export function parseWindowDays(raw: string | null): WindowDays {
  const n = Number(raw);
  return (ALLOWED_WINDOWS as readonly number[]).includes(n) ? (n as WindowDays) : 7;
}

// ─── Assembly: raw counts → response ─────────────────────────────────────────

/** Pick the arm row for the given holdout flag (0=adapted, 1=holdout). */
function armRow<T extends { holdout: number }>(rows: T[], holdout: 0 | 1): T | undefined {
  return rows.find((r) => r.holdout === holdout);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Classify p-value into status bucket. Requires N >= 200 per arm for 'significant'. */
function classifyStatus(pValue: number, adaptedN: number, holdoutN: number): LiftRow['status'] {
  const minN = 200;
  if (pValue < 0.05 && adaptedN >= minN && holdoutN >= minN) return 'significant';
  if (pValue < 0.15) return 'trending';
  return 'not_significant';
}

/** Rows the analytics panel shows at most (the pre-FOLLOW-1289 query had LIMIT 20). */
const MAX_LIFT_ROWS = 20;

/**
 * Transform raw ClickHouse counts into the public response, applying the z-test, minimum-sample
 * guard and division-by-zero guard through {@link computeArmLift} — the only lift computation.
 */
export function buildResponseFromRaw(
  tenantId: string,
  windowDays: number,
  raw: ChRawData,
  dataSource: 'clickhouse' | 'mock',
): LiftResponse {
  // ── Summary ──
  const adaptedGroup = armRow(raw.groups, 0);
  const holdoutGroup = armRow(raw.groups, 1);
  const adaptedSessions = adaptedGroup?.sessions ?? 0;
  const holdoutSessions = holdoutGroup?.sessions ?? 0;

  const total = computeArmLift({
    adaptedN: adaptedSessions,
    adaptedConversions: adaptedGroup?.cta_sessions ?? 0,
    holdoutN: holdoutSessions,
    holdoutConversions: holdoutGroup?.cta_sessions ?? 0,
  });

  const summary: PilotSummary = {
    adapted_sessions: adaptedSessions,
    holdout_sessions: holdoutSessions,
    adapted_cta_rate: round4(total.adaptedRate),
    holdout_cta_rate: round4(total.holdoutRate),
    absolute_lift: round4(total.absoluteLift),
    relative_lift_pct: total.relativeLiftPct === null ? null : round2(total.relativeLiftPct),
    p_value: round4(total.pValue),
    is_significant: total.confidence === '95%',
    confidence: total.confidence,
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

  // ── By archetype (one computeArmLift per cohort feeds BOTH row shapes) ──
  const archetypeNames = Array.from(new Set(raw.archetypes.map((r) => r.archetype))).filter(
    (a) => a !== '',
  );
  const cohorts = archetypeNames
    .map((archetype) => {
      const rows = raw.archetypes.filter((r) => r.archetype === archetype);
      const a = armRow(rows, 0);
      const h = armRow(rows, 1);
      const nAdapted = a?.sessions ?? 0;
      const nHoldout = h?.sessions ?? 0;
      const lift = computeArmLift({
        adaptedN: nAdapted,
        adaptedConversions: a?.cta_sessions ?? 0,
        holdoutN: nHoldout,
        holdoutConversions: h?.cta_sessions ?? 0,
      });
      return { archetype, nAdapted, nHoldout, lift };
    })
    // Top archetypes by adapted volume first.
    .sort((x, y) => y.nAdapted - x.nAdapted);

  const byArchetype: ArchetypeRow[] = cohorts.map(({ archetype, nAdapted, nHoldout, lift }) => ({
    archetype,
    adapted_cta_rate: round4(lift.adaptedRate),
    holdout_cta_rate: round4(lift.holdoutRate),
    lift_pct: lift.relativeLiftPct === null ? null : round2(lift.relativeLiftPct),
    n_adapted: nAdapted,
    n_holdout: nHoldout,
    p_value: round4(lift.pValue),
  }));

  const rows: LiftRow[] = cohorts
    .slice(0, MAX_LIFT_ROWS)
    .map(({ archetype, nAdapted, nHoldout, lift }) => ({
      archetype,
      adaptedRate: round4(lift.adaptedRate),
      holdoutRate: round4(lift.holdoutRate),
      adaptedN: nAdapted,
      holdoutN: nHoldout,
      lift: round2(lift.relativeLiftPct ?? 0),
      pValue: round4(lift.pValue),
      status: classifyStatus(lift.pValue, nAdapted, nHoldout),
    }));

  return {
    tenant_id: tenantId,
    window_days: windowDays,
    summary,
    funnel,
    by_archetype: byArchetype,
    rows,
    // Mock data always renders; a live window with no sessions at all is "data not yet available".
    dqsUnavailable: dataSource === 'clickhouse' && rows.length === 0,
    generated_at: new Date().toISOString(),
    data_source: dataSource,
  };
}

// ─── ClickHouse access ───────────────────────────────────────────────────────

/**
 * Execute one parameterized ClickHouse query over the HTTP interface and parse JSONEachRow output.
 * tenant_id and window_days are bound as query parameters (never interpolated) to prevent SQL
 * injection.
 */
async function chQuery<T>(
  baseUrl: string,
  user: string,
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
    headers: {
      'Content-Type': 'text/plain',
      ...clickhouseAuthHeaders({ user, password }),
    },
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
 * Pull all raw counts for the lift report from ClickHouse.
 *
 * Three parameterized queries, all joining `adaptation_decisions` (for holdout_group + archetype)
 * against `events` (for event types) on (tenant_id, session_id) within the window:
 *
 *   1. group counts     — distinct sessions and CTA-clicked sessions per arm
 *   2. archetype counts — same, split by archetype
 *   3. funnel counts    — distinct sessions per event-type stage per arm
 *
 * Returns null when CLICKHOUSE_URL is unset (dev / CI — not an error). Throws on query failure when
 * CLICKHOUSE_URL is set (caller must NOT fall back to mock in that case — Rule K.2 fail-loud).
 */
export async function fetchLiftRaw(
  tenantId: string,
  windowDays: number,
): Promise<ChRawData | null> {
  const baseUrl = process.env.CLICKHOUSE_URL;
  if (!baseUrl) return null;
  const user = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';
  const params = { tenant_id: tenantId, window_days: String(windowDays) };

  // FOLLOW-371 / ESC-026: exclude contaminated holdout rows written during the
  // ~12.5h window between PR #327 (2026-06-19 21:17 UTC) and PR #333
  // (2026-06-20 09:53 UTC) when the GET path logged (holdout_group=1,
  // variant IN ('v1','v2')). The predicate is a no-op for all clean rows.
  const CLEAN_HOLDOUT = `NOT (ad.holdout_group = 1 AND ad.variant != 'control')`;

  // FOLLOW-1201 AC(4): every `events` predicate below buckets on `ingest_received_at` (stamped by
  // the Worker, `handlers/events.ts`) — never on the client-supplied `ts`, which a forger can set
  // to any value. `ad.ts` on `adaptation_decisions` is server-written and stays.

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
        AND ingest_received_at >= now() - toIntervalDay({window_days:UInt16})
    ) AS ev
      ON ad.tenant_id = ev.tenant_id AND ad.session_id = ev.session_id
    WHERE ad.tenant_id = {tenant_id:String}
      AND ad.ts >= now() - toIntervalDay({window_days:UInt16})
      AND ${CLEAN_HOLDOUT}
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
        AND ingest_received_at >= now() - toIntervalDay({window_days:UInt16})
    ) AS ev
      ON ad.tenant_id = ev.tenant_id AND ad.session_id = ev.session_id
    WHERE ad.tenant_id = {tenant_id:String}
      AND ad.ts >= now() - toIntervalDay({window_days:UInt16})
      AND ${CLEAN_HOLDOUT}
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
        AND NOT (holdout_group = 1 AND variant != 'control')
      GROUP BY session_id
    ) AS ad
      ON ev.session_id = ad.session_id
    WHERE ev.tenant_id = {tenant_id:String}
      AND ev.ingest_received_at >= now() - toIntervalDay({window_days:UInt16})
      AND ev.type IN ('page.view','listing.viewed','cta.clicked','inquiry.started','inquiry.completed')
    GROUP BY ev.type, ad.holdout_group
  `;

  const [groupsRaw, archetypesRaw, funnelRaw] = await Promise.all([
    chQuery<Record<string, unknown>>(baseUrl, user, password, groupSql, params),
    chQuery<Record<string, unknown>>(baseUrl, user, password, archetypeSql, params),
    chQuery<Record<string, unknown>>(baseUrl, user, password, funnelSql, params),
  ]);

  return {
    groups: groupsRaw.map(
      (r): ChGroupCounts => ({
        holdout: Number(r.holdout ?? 0),
        sessions: Number(r.sessions ?? 0),
        cta_sessions: Number(r.cta_sessions ?? 0),
      }),
    ),
    archetypes: archetypesRaw.map(
      (r): ChArchetypeCounts => ({
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- primitive JSON value coerced safely
        archetype: String(r.archetype ?? ''),
        holdout: Number(r.holdout ?? 0),
        sessions: Number(r.sessions ?? 0),
        cta_sessions: Number(r.cta_sessions ?? 0),
      }),
    ),
    funnel: funnelRaw.map(
      (r): ChFunnelCounts => ({
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- primitive JSON value coerced safely
        stage: String(r.stage ?? ''),
        holdout: Number(r.holdout ?? 0),
        sessions: Number(r.sessions ?? 0),
      }),
    ),
  };
}

// ─── Mock data (dev / CI fallback) ───────────────────────────────────────────
// Only reachable when CLICKHOUSE_URL is unset. Always tagged data_source:'mock'.

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

// FOLLOW-585: the third entry was the invalid literal "investor" — replaced with
// the most generic INVESTOR_ARCHETYPES member (no niche flip/vacation-rental/
// golden-visa connotation); yield_hunter is already covered above.
const MOCK_ARCHETYPES: readonly ArchetypeId[] = [
  'yield_hunter',
  'family_buyer',
  'portfolio_builder',
  'downsizer',
  'neutral',
] as const;

/**
 * Build deterministic raw counts for dev / CI when ClickHouse is not configured. Designed to
 * render meaningfully in local development; the response is always tagged `data_source:'mock'`.
 */
export function buildMockRaw(tenantId: string, windowDays: number): ChRawData {
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
