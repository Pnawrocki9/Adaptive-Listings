/**
 * GET /api/dashboard/analytics/summary
 *
 * Returns Panel 1 KPIs for the authenticated tenant:
 *   - sessions      COUNT(DISTINCT session_id) — last 7 days
 *   - adapted       count where holdout_group = false
 *   - holdout        count where holdout_group = true
 *   - p95Latency    quantile(0.95)(latency_ms)
 *
 * Auth: Bearer JWT required. tenant_id extracted from JWT claim.
 * ClickHouse: parameterized queries via existing client in apps/control-plane/src/lib/clickhouse.ts.
 * Falls back to mock data when CLICKHOUSE_URL is not configured (dev / CI).
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/summary/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthClaims } from '@estalara/auth';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';

// ─── Response types ────────────────────────────────────────────────────────────

export interface SummaryResponse {
  tenant_id: string;
  sessions: number;
  adapted: number;
  holdout: number;
  p95Latency: number;
  window_days: number;
  generated_at: string;
}

// ─── ClickHouse query ──────────────────────────────────────────────────────────

/**
 * Run the summary ClickHouse query for the given tenant.
 * Uses parameterized inputs to prevent injection.
 * Returns null when CLICKHOUSE_URL is not configured.
 */
async function fetchSummaryFromClickHouse(tenantId: string): Promise<{
  sessions: number;
  adapted: number;
  holdout: number;
  p95Latency: number;
} | null> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return null;

  const user = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';

  // Parameterized query — tenant_id is bound via ClickHouse query parameters
  // to prevent string interpolation injection.
  const query = `
    SELECT
      countDistinct(session_id)                       AS sessions,
      countIf(holdout_group = false)                  AS adapted,
      countIf(holdout_group = true)                   AS holdout,
      quantile(0.95)(latency_ms)                      AS p95_latency
    FROM adaptation_decisions
    WHERE tenant_id = {tenant_id:String}
      AND assigned_at >= now() - INTERVAL 7 DAY
    FORMAT JSONEachRow
  `.trim();

  const url = new URL(clickhouseUrl);
  url.searchParams.set('query', query);
  url.searchParams.set('param_tenant_id', tenantId);

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
    ...clickhouseAuthHeaders({ user, password }),
  };

  const res = await fetch(url.toString(), { method: 'GET', headers });
  if (!res.ok) return null;

  const text = await res.text();
  const line = text.trim().split('\n')[0];
  if (!line) return null;

  const row = JSON.parse(line) as Record<string, unknown>;
  return {
    sessions: Number(row.sessions ?? 0),
    adapted: Number(row.adapted ?? 0),
    holdout: Number(row.holdout ?? 0),
    p95Latency: Number(row.p95_latency ?? 0),
  };
}

// ─── Mock data (dev / CI fallback) ────────────────────────────────────────────
//
// NOTE: this route currently falls back to mock data on ANY ClickHouse failure
// (see GET handler `.catch(() => null)`), so a configured-but-failing CH silently
// serves fabricated numbers at HTTP 200 with no `data_source` provenance. That is
// the un-fixed sibling of FOLLOW-124 (lift route) — tracked by FOLLOW-329:
// fail loud when CLICKHOUSE_URL is set, keep mock only for the unset (dev/CI) path.

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

function buildMockSummary(tenantId: string): {
  sessions: number;
  adapted: number;
  holdout: number;
  p95Latency: number;
} {
  const seed = hash(tenantId);
  const sessions = 500 + Math.floor(seededRandom(seed) * 4500);
  const adapted = Math.floor(sessions * (0.85 + seededRandom(seed + 1) * 0.1));
  const holdout = sessions - adapted;
  const p95Latency = 40 + Math.floor(seededRandom(seed + 2) * 60);
  return { sessions, adapted, holdout, p95Latency };
}

// ─── Route handler ─────────────────────────────────────────────────────────────

/**
 * GET /api/dashboard/analytics/summary
 *
 * @returns 200 SummaryResponse on success.
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

  const chData = await fetchSummaryFromClickHouse(tenantId).catch(() => null);
  const data = chData ?? buildMockSummary(tenantId);

  const response: SummaryResponse = {
    tenant_id: tenantId,
    sessions: data.sessions,
    adapted: data.adapted,
    holdout: data.holdout,
    p95Latency: data.p95Latency,
    window_days: 7,
    generated_at: new Date().toISOString(),
  };

  return NextResponse.json(response, { status: 200 });
}
