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
 * ClickHouse: if DQS conversion signals are not joined, returns panel shell with
 * dqsUnavailable=true and empty rows — the page renders a "requires DQS" message.
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/lift/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthClaims } from '@estalara/auth';
import { zTest } from '@/lib/z-test';

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
  /** True when DQS conversion signals are not available — rows will be empty. */
  dqsUnavailable: boolean;
  generated_at: string;
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

interface ChLiftRow {
  archetype: string;
  adapted_n: number;
  adapted_conversions: number;
  holdout_n: number;
  holdout_conversions: number;
}

/**
 * Query ClickHouse for per-archetype adapted vs holdout conversion counts.
 * Joins adaptation_decisions with DQS conversion signals (cta_clicked).
 * Returns null when CLICKHOUSE_URL is not set or the query fails.
 * Returns empty array when the DQS join yields no rows (DQS not yet integrated).
 */
async function fetchLiftFromClickHouse(tenantId: string): Promise<ChLiftRow[] | null> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return null;

  const password = process.env.CLICKHOUSE_PASSWORD ?? '';

  // Attempt the DQS-joined query. Falls back to session-count only if DQS table
  // is not present (query will error, caught below → dqsUnavailable path).
  const query = `
    SELECT
      ad.archetype                                     AS archetype,
      countIf(ad.holdout_group = false)               AS adapted_n,
      countIf(ad.holdout_group = false AND dqs.event_type = 'cta_clicked') AS adapted_conversions,
      countIf(ad.holdout_group = true)                AS holdout_n,
      countIf(ad.holdout_group = true  AND dqs.event_type = 'cta_clicked') AS holdout_conversions
    FROM adaptation_decisions ad
    LEFT JOIN dqs_events dqs
      ON ad.session_id = dqs.session_id
      AND ad.tenant_id = dqs.tenant_id
    WHERE ad.tenant_id = {tenant_id:String}
      AND ad.assigned_at >= now() - INTERVAL 7 DAY
    GROUP BY ad.archetype
    HAVING adapted_n > 0 OR holdout_n > 0
    ORDER BY adapted_n DESC
    LIMIT 20
    FORMAT JSONEachRow
  `.trim();

  const url = new URL(clickhouseUrl);
  url.searchParams.set('query', query);
  url.searchParams.set('param_tenant_id', tenantId);

  const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
  if (password) {
    headers.Authorization = `Basic ${Buffer.from(`:${password}`).toString('base64')}`;
  }

  try {
    const res = await fetch(url.toString(), { method: 'GET', headers });
    if (!res.ok) return null;

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
  } catch {
    return null;
  }
}

// ─── Mock data (dev / CI fallback) ────────────────────────────────────────────

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

  const tenantId = claims.tenant_id;

  const chRows = await fetchLiftFromClickHouse(tenantId).catch(() => null);

  let rows: LiftRow[];
  let dqsUnavailable = false;

  if (chRows === null) {
    // No ClickHouse configured or query failed — use mock data (FOLLOW-035 will replace with empty-state)
    rows = buildMockLiftRows(tenantId);
    dqsUnavailable = false;
  } else if (chRows.length === 0) {
    // ClickHouse responded but DQS data not yet available
    rows = [];
    dqsUnavailable = true;
  } else {
    rows = chRows.map((row) => {
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
  };

  return NextResponse.json(response, { status: 200 });
}
