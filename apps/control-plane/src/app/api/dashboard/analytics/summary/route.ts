/**
 * GET /api/dashboard/analytics/summary
 *
 * Returns Panel 1 KPIs for the authenticated tenant:
 *   - sessions      COUNT(DISTINCT session_id) — last 7 days
 *   - adapted       count where holdout_group = false
 *   - holdout       count where holdout_group = true
 *   - p95Latency    null (latency_ms does not exist on adaptation_decisions;
 *                   FOLLOW-445 tracks adding a correct latency source via llm_calls join)
 *
 * Auth: Bearer JWT required. tenant_id extracted from JWT claim.
 *
 * Rule K.2 — fail loud: when CLICKHOUSE_URL is set but a query fails, this route
 * returns HTTP 500 and captures the error in Sentry. It NEVER silently falls back
 * to mock data when a real ClickHouse is configured (RETRO-008 / FOLLOW-329).
 * When CLICKHOUSE_URL is unset (dev / CI), the mock fallback is legitimate and is
 * tagged data_source:'mock' so it is never mistaken for real data.
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/summary/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getAuthClaims } from '@estalara/auth';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';

// ─── Response types ────────────────────────────────────────────────────────────

export interface SummaryResponse {
  tenant_id: string;
  sessions: number;
  adapted: number;
  holdout: number;
  /**
   * p95 adaptation latency in ms. null when data comes from ClickHouse (the
   * adaptation_decisions table has no latency_ms column; FOLLOW-445 tracks a
   * correct llm_calls join). Always a positive number on the mock path.
   */
  p95Latency: number | null;
  window_days: number;
  generated_at: string;
  /**
   * Provenance field (Rule K.2).
   * 'clickhouse' — live data from a successful ClickHouse query.
   * 'mock'       — CLICKHOUSE_URL is unset (dev / CI); deterministic stub data.
   */
  data_source: 'clickhouse' | 'mock';
}

// ─── ClickHouse query ──────────────────────────────────────────────────────────

/**
 * Run the summary ClickHouse query for the given tenant.
 * Uses parameterized inputs to prevent injection.
 *
 * Returns null when CLICKHOUSE_URL is not configured (dev / CI).
 * THROWS when CLICKHOUSE_URL is set but the query fails (Rule K.2 — fail loud).
 *
 * NOTE: latency_ms is intentionally omitted — it does not exist on
 * adaptation_decisions (see migration 0003). FOLLOW-445 tracks adding it via a
 * join with llm_calls. The returned p95_latency is always null.
 */
async function fetchSummaryFromClickHouse(tenantId: string): Promise<{
  sessions: number;
  adapted: number;
  holdout: number;
  p95Latency: null;
} | null> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return null;

  const user = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';

  // Parameterized query — tenant_id is bound via ClickHouse query parameters
  // to prevent string interpolation injection.
  //
  // `ts` is the canonical timestamp column on adaptation_decisions (migration 0003).
  // `assigned_at` does NOT exist on this table — never query it.
  // `latency_ms` does NOT exist on adaptation_decisions — FOLLOW-445 tracks the fix.
  const query = `
    SELECT
      countDistinct(session_id)                       AS sessions,
      countIf(holdout_group = false)                  AS adapted,
      countIf(holdout_group = true)                   AS holdout
    FROM adaptation_decisions
    WHERE tenant_id = {tenant_id:String}
      AND ts >= now() - INTERVAL 7 DAY
    FORMAT JSONEachRow
  `.trim();

  const url = new URL(clickhouseUrl);
  url.searchParams.set('query', query);
  url.searchParams.set('param_tenant_id', tenantId);

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
    ...clickhouseAuthHeaders({ user, password }),
  };

  // Rule K.2: let non-ok responses propagate as thrown errors; caller handles.
  const res = await fetch(url.toString(), { method: 'GET', headers });
  if (!res.ok) {
    throw new Error(
      `ClickHouse summary query failed: HTTP ${String(res.status)} ${res.statusText}`,
    );
  }

  const text = await res.text();
  const line = text.trim().split('\n')[0];
  if (!line) {
    return { sessions: 0, adapted: 0, holdout: 0, p95Latency: null };
  }

  const row = JSON.parse(line) as Record<string, unknown>;
  return {
    sessions: Number(row.sessions ?? 0),
    adapted: Number(row.adapted ?? 0),
    holdout: Number(row.holdout ?? 0),
    p95Latency: null,
  };
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
 * @returns 500 when CLICKHOUSE_URL is set but the ClickHouse query fails
 *   (Rule K.2 — fail loud; never silently fall back to mock data when a real
 *   ClickHouse is configured).
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

  // Rule K.2: when CLICKHOUSE_URL is unset (dev / CI), serve deterministic mock
  // data tagged data_source:'mock' so consumers can distinguish it from real data.
  const clickhouseConfigured = Boolean(process.env.CLICKHOUSE_URL);

  if (!clickhouseConfigured) {
    const data = buildMockSummary(tenantId);
    const response: SummaryResponse = {
      tenant_id: tenantId,
      sessions: data.sessions,
      adapted: data.adapted,
      holdout: data.holdout,
      p95Latency: data.p95Latency,
      window_days: 7,
      generated_at: new Date().toISOString(),
      data_source: 'mock',
    };
    return NextResponse.json(response, { status: 200 });
  }

  // Rule K.2: CLICKHOUSE_URL is set — fail loud on any error; never fabricate data.
  let chData: Awaited<ReturnType<typeof fetchSummaryFromClickHouse>>;
  try {
    chData = await fetchSummaryFromClickHouse(tenantId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      tags: { route: 'dashboard/analytics/summary', tenant_id: tenantId },
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

  // chData is null only when CLICKHOUSE_URL is unset — already handled above.
  const data = chData ?? { sessions: 0, adapted: 0, holdout: 0, p95Latency: null };

  const response: SummaryResponse = {
    tenant_id: tenantId,
    sessions: data.sessions,
    adapted: data.adapted,
    holdout: data.holdout,
    p95Latency: data.p95Latency,
    window_days: 7,
    generated_at: new Date().toISOString(),
    data_source: 'clickhouse',
  };

  return NextResponse.json(response, { status: 200 });
}
