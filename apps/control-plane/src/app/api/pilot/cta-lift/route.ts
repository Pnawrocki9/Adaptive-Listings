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
 * Non-handler exports (types, parseWindowDays, buildResponseFromRaw) live in
 * ./route-helpers.ts so Next.js 15 App Router accepts this file as a valid
 * route segment.
 *
 * @module apps/control-plane/src/app/api/pilot/cta-lift/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getAuthClaims } from '@estalara/auth';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';
import {
  FUNNEL_STAGES,
  parseWindowDays,
  buildResponseFromRaw,
  type ChGroupCounts,
  type ChArchetypeCounts,
  type ChFunnelCounts,
  type ChRawData,
  type FunnelStage,
} from './route-helpers';

// ─── ClickHouse access ─────────────────────────────────────────────────────────

/**
 * Execute one parameterized ClickHouse query over the HTTP interface and parse
 * JSONEachRow output. tenant_id and window_days are bound as query parameters
 * (never interpolated) to prevent SQL injection.
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
 * Returns null when CLICKHOUSE_URL is unset (dev / CI — not an error).
 * Throws on query failure when CLICKHOUSE_URL is set (caller must NOT fall back
 * to mock in that case — Rule K.2 fail-loud).
 */
async function fetchCtaLiftRaw(tenantId: string, windowDays: number): Promise<ChRawData | null> {
  const baseUrl = process.env.CLICKHOUSE_URL;
  if (!baseUrl) return null;
  const user = process.env.CLICKHOUSE_USER ?? 'default';
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
 * @returns 200 CtaLiftResponse on success (with data_source provenance field).
 * @returns 401 when no valid tenant JWT is present.
 * @returns 500 when CLICKHOUSE_URL is set but the ClickHouse query fails
 *   (Rule K.2 — fail loud; never silently fall back to mock in production).
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

  // Rule K.2 — fail loud.
  // When CLICKHOUSE_URL is set, a query failure is a real production error: surface
  // it as HTTP 500 + Sentry alert. Never silently fall back to mock data in that
  // case — callers cannot distinguish real from synthetic metrics.
  // When CLICKHOUSE_URL is unset (dev / CI), return mock with provenance field.
  const clickhouseConfigured = Boolean(process.env.CLICKHOUSE_URL);

  if (!clickhouseConfigured) {
    const data = buildMockRaw(tenantId, windowDays);
    const response = buildResponseFromRaw(tenantId, windowDays, data, 'mock');
    return NextResponse.json(response, { status: 200 });
  }

  let raw: ChRawData | null;
  try {
    raw = await fetchCtaLiftRaw(tenantId, windowDays);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      tags: { cta_lift_clickhouse_error: 'true' },
      extra: { tenant_id: tenantId, window_days: windowDays },
    });
    return NextResponse.json(
      {
        error: {
          code: 'clickhouse_query_failed',
          message: `ClickHouse query failed: ${message}`,
        },
      },
      { status: 500 },
    );
  }

  // raw is null only when CLICKHOUSE_URL is unset — already handled above.
  // Treat null as empty (no data) to satisfy the type without a non-null assertion.
  const data: ChRawData = raw ?? { groups: [], archetypes: [], funnel: [] };
  const response = buildResponseFromRaw(tenantId, windowDays, data, 'clickhouse');
  return NextResponse.json(response, { status: 200 });
}
