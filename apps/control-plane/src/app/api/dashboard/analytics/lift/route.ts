/**
 * GET /api/dashboard/analytics/lift
 *
 * Returns Panel 3 per-archetype A/B lift table for the authenticated tenant.
 * Computes two-proportion z-test server-side — no external statistics library.
 *
 * Response row shape per archetype:
 *   archetype      string
 *   adaptedRate    number  (0–1)
 *   holdoutRate    number  (0–1)
 *   adaptedN       number  sample size for adapted arm
 *   holdoutN       number  sample size for holdout arm
 *   lift           number  lift in percent: (adapted - holdout) / holdout * 100
 *   pValue         number  two-tailed two-proportion z-test p-value
 *   status         'significant' | 'trending' | 'not_significant'
 *
 * Auth: Bearer JWT required. tenant_id from JWT claim.
 *
 * ClickHouse: if no conversion signals are available, returns panel shell with
 * dqsUnavailable=true and empty rows — the page renders a "data not yet available"
 * message.
 *
 * Rule K.2 — fail loud: when CLICKHOUSE_URL is set but a query fails, this route
 * returns HTTP 500 and captures the error in Sentry. It NEVER silently falls back
 * to mock data when a real ClickHouse is configured (RETRO-008 / FOLLOW-439).
 * When CLICKHOUSE_URL is unset (dev / CI), the mock fallback is legitimate and is
 * tagged data_source:'mock' so it is never mistaken for real data.
 *
 * --- FOLLOW-093 RECONCILIATION NOTE ---
 * Previously this route queried the non-canonical `dqs_events` table using the
 * event vocabulary `cta_clicked` (underscore) and filtered on `assigned_at`.
 * That diverged from the canonical pilot CTA-lift route at
 * /api/pilot/cta-lift, which queries the `events` table with type='cta.clicked'
 * (dot-separated) and filters on `ts`. The two paths returned different numbers
 * for the same metric, which is a data correctness bug.
 *
 * This route now reads from the same vocabulary and table as the canonical route:
 *   - Table:      events (canonical event store)
 *   - Event type: 'cta.clicked' (dot-separated, matching events.type column)
 *   - Time col:   ts (not assigned_at)
 *
 * The canonical pilot route (/api/pilot/cta-lift) is the primary surface for
 * pilot metrics. This route provides the dashboard panel view using the same
 * underlying counts so the numbers are always consistent.
 * --- end FOLLOW-093 ---
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/lift/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getAuthClaims, isTenantClaims } from '@estalara/auth';
import { zTest } from '@/lib/z-test';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface LiftRow {
  archetype: string;
  adaptedRate: number;
  holdoutRate: number;
  adaptedN: number;
  holdoutN: number;
  /** (adaptedRate - holdoutRate) / holdoutRate * 100. NaN-safe: 0 when holdoutRate=0. */
  lift: number;
  /** Two-tailed p-value from two-proportion z-test. */
  pValue: number;
  /** Significance status bucket. */
  status: 'significant' | 'trending' | 'not_significant';
}

export interface LiftResponse {
  tenant_id: string;
  rows: LiftRow[];
  window_days: number;
  /** True when no CTA conversion data is available in the window — rows will be empty. */
  dqsUnavailable: boolean;
  generated_at: string;
  /**
   * Provenance field (Rule K.2).
   * 'clickhouse' — live data from a successful ClickHouse query.
   * 'mock'       — CLICKHOUSE_URL is unset (dev / CI); deterministic stub data.
   */
  data_source: 'clickhouse' | 'mock';
}

// ─── Statistics helpers ────────────────────────────────────────────────────────

/** Classify p-value into status bucket. Requires N >= 200 per arm for 'significant'. */
function classifyStatus(pValue: number, adaptedN: number, holdoutN: number): LiftRow['status'] {
  const minN = 200;
  if (pValue < 0.05 && adaptedN >= minN && holdoutN >= minN) return 'significant';
  if (pValue < 0.15) return 'trending';
  return 'not_significant';
}

/** Safe lift computation — returns 0 when holdoutRate is 0. */
function computeLift(adaptedRate: number, holdoutRate: number): number {
  if (holdoutRate === 0) return 0;
  return ((adaptedRate - holdoutRate) / holdoutRate) * 100;
}

// ─── ClickHouse query ──────────────────────────────────────────────────────────

/** Raw counts returned by ClickHouse per archetype, from the canonical events table. */
interface ChLiftRow {
  archetype: string;
  adapted_n: number;
  adapted_conversions: number;
  holdout_n: number;
  holdout_conversions: number;
}

/**
 * Query ClickHouse for per-archetype adapted vs holdout CTA conversion counts.
 *
 * Uses the canonical event vocabulary: `events` table with `type = 'cta.clicked'`
 * filtered on `ts`, joined with `adaptation_decisions` on (tenant_id, session_id).
 * This is the same join pattern used by the canonical pilot route at
 * /api/pilot/cta-lift (FOLLOW-093 reconciliation).
 *
 * Returns null when CLICKHOUSE_URL is not set (dev / CI — caller uses mock data).
 * THROWS when CLICKHOUSE_URL is set but the query fails (Rule K.2 — fail loud).
 */
async function fetchLiftFromClickHouse(tenantId: string): Promise<ChLiftRow[] | null> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return null;

  const user = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';

  // Join adaptation_decisions with the canonical events table on (tenant_id,
  // session_id). CTA conversions are sessions that fired a 'cta.clicked' event
  // (dot-separated type, matching the events.type column) within the window.
  // Uses DISTINCT subquery pattern identical to the canonical pilot route so
  // both paths count the same sessions.
  //
  // FOLLOW-371 / ESC-026: exclude contaminated holdout rows written during the
  // ~12.5h window (PR #327 2026-06-19 21:17 UTC → PR #333 2026-06-20 09:53 UTC)
  // when the GET path logged (holdout_group=1, variant IN ('v1','v2')).
  // Predicate is a no-op for all clean rows.
  const query = `
    SELECT
      ad.archetype                                          AS archetype,
      countDistinctIf(ad.session_id, ad.holdout_group = 0) AS adapted_n,
      countDistinctIf(ad.session_id, ad.holdout_group = 0 AND ev.session_id != '') AS adapted_conversions,
      countDistinctIf(ad.session_id, ad.holdout_group = 1) AS holdout_n,
      countDistinctIf(ad.session_id, ad.holdout_group = 1 AND ev.session_id != '') AS holdout_conversions
    FROM adaptation_decisions AS ad
    LEFT JOIN (
      SELECT DISTINCT tenant_id, session_id
      FROM events
      WHERE tenant_id = {tenant_id:String}
        AND type = 'cta.clicked'
        AND ts >= now() - toIntervalDay(7)
    ) AS ev
      ON ad.tenant_id = ev.tenant_id AND ad.session_id = ev.session_id
    WHERE ad.tenant_id = {tenant_id:String}
      AND ad.ts >= now() - toIntervalDay(7)
      AND NOT (ad.holdout_group = 1 AND ad.variant != 'control')
    GROUP BY ad.archetype
    HAVING adapted_n > 0 OR holdout_n > 0
    ORDER BY adapted_n DESC
    LIMIT 20
    FORMAT JSONEachRow
  `.trim();

  const url = new URL(clickhouseUrl);
  url.searchParams.set('query', query);
  url.searchParams.set('param_tenant_id', tenantId);

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
    ...clickhouseAuthHeaders({ user, password }),
  };

  // Rule K.2: let network errors propagate (caller wraps in try/catch + Sentry).
  const res = await fetch(url.toString(), { method: 'GET', headers });
  if (!res.ok) {
    throw new Error(`ClickHouse lift query failed: HTTP ${String(res.status)} ${res.statusText}`);
  }

  const text = await res.text();
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line) as Record<string, unknown>;
      return {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- row is Record<string,unknown>; String() coerces safely for primitive values from JSON
        archetype: String(row.archetype ?? ''),
        adapted_n: Number(row.adapted_n ?? 0),
        adapted_conversions: Number(row.adapted_conversions ?? 0),
        holdout_n: Number(row.holdout_n ?? 0),
        holdout_conversions: Number(row.holdout_conversions ?? 0),
      };
    });
}

// ─── Mock data (dev / CI fallback) ────────────────────────────────────────────
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

const MOCK_ARCHETYPES = [
  'yield_hunter',
  'family_buyer',
  'investor',
  'neutral',
  'downsizer',
] as const;

function buildMockLiftRows(tenantId: string): LiftRow[] {
  const seed = hash(tenantId);
  return MOCK_ARCHETYPES.map((archetype, i) => {
    const baseSeed = seed + i * 10;
    const adaptedN = 200 + Math.floor(seededRandom(baseSeed) * 800);
    const holdoutN = 50 + Math.floor(seededRandom(baseSeed + 1) * 200);
    const holdoutRate = 0.05 + seededRandom(baseSeed + 2) * 0.1;
    const liftFraction = -0.05 + seededRandom(baseSeed + 3) * 0.2;
    const adaptedRate = Math.max(0, Math.min(1, holdoutRate * (1 + liftFraction)));
    const adaptedConversions = Math.round(adaptedN * adaptedRate);
    const holdoutConversions = Math.round(holdoutN * holdoutRate);
    const pValue = zTest(adaptedN, adaptedConversions, holdoutN, holdoutConversions);
    const lift = computeLift(adaptedRate, holdoutRate);
    return {
      archetype,
      adaptedRate: Math.round(adaptedRate * 10000) / 10000,
      holdoutRate: Math.round(holdoutRate * 10000) / 10000,
      adaptedN,
      holdoutN,
      lift: Math.round(lift * 100) / 100,
      pValue: Math.round(pValue * 10000) / 10000,
      status: classifyStatus(pValue, adaptedN, holdoutN),
    };
  });
}

// ─── Route handler ─────────────────────────────────────────────────────────────

/**
 * GET /api/dashboard/analytics/lift
 *
 * @returns 200 LiftResponse on success.
 * @returns 401 when no valid JWT is present.
 * @returns 500 when CLICKHOUSE_URL is set but the ClickHouse query fails
 *   (Rule K.2 — fail loud; never silently fall back to mock data when a real
 *   ClickHouse is configured).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims(req);
  if (!claims || !isTenantClaims(claims)) {
    return NextResponse.json(
      {
        error: { code: 'unauthorized', message: 'Valid Bearer JWT with tenant_id claim required' },
      },
      { status: 401 },
    );
  }

  const tenantId: string = claims.tenant_id;

  // Rule K.2: when CLICKHOUSE_URL is unset (dev / CI), serve deterministic mock
  // data tagged data_source:'mock' so consumers can distinguish it from real data.
  const clickhouseConfigured = Boolean(process.env.CLICKHOUSE_URL);

  if (!clickhouseConfigured) {
    const rows = buildMockLiftRows(tenantId);
    const response: LiftResponse = {
      tenant_id: tenantId,
      rows,
      window_days: 7,
      dqsUnavailable: false,
      generated_at: new Date().toISOString(),
      data_source: 'mock',
    };
    return NextResponse.json(response, { status: 200 });
  }

  // Rule K.2: CLICKHOUSE_URL is set — fail loud on any error; never fabricate data.
  let chRows: ChLiftRow[] | null;
  try {
    chRows = await fetchLiftFromClickHouse(tenantId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      tags: { route: 'dashboard/analytics/lift', tenant_id: tenantId },
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

  let rows: LiftRow[];
  let dqsUnavailable = false;

  // chRows is null only when CLICKHOUSE_URL is unset — already handled above.
  // Treat null as empty (no data) to satisfy the type safely.
  const safeRows = chRows ?? [];

  if (safeRows.length === 0) {
    // ClickHouse responded but no cta.clicked events in the window yet.
    rows = [];
    dqsUnavailable = true;
  } else {
    rows = safeRows.map((row) => {
      const adaptedRate = row.adapted_n > 0 ? row.adapted_conversions / row.adapted_n : 0;
      const holdoutRate = row.holdout_n > 0 ? row.holdout_conversions / row.holdout_n : 0;
      const pValue = zTest(
        row.adapted_n,
        row.adapted_conversions,
        row.holdout_n,
        row.holdout_conversions,
      );
      const lift = computeLift(adaptedRate, holdoutRate);
      return {
        archetype: row.archetype,
        adaptedRate: Math.round(adaptedRate * 10000) / 10000,
        holdoutRate: Math.round(holdoutRate * 10000) / 10000,
        adaptedN: row.adapted_n,
        holdoutN: row.holdout_n,
        lift: Math.round(lift * 100) / 100,
        pValue: Math.round(pValue * 10000) / 10000,
        status: classifyStatus(pValue, row.adapted_n, row.holdout_n),
      };
    });
    dqsUnavailable = false;
  }

  const response: LiftResponse = {
    tenant_id: tenantId,
    rows,
    window_days: 7,
    dqsUnavailable,
    generated_at: new Date().toISOString(),
    data_source: 'clickhouse',
  };

  return NextResponse.json(response, { status: 200 });
}
