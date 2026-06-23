/**
 * GET /api/pilot/inquiry-starts
 *
 * Returns inquiry.started event counts split by A/B group (adapted vs holdout)
 * for the authenticated tenant, used by the pilot dashboard inquiry starts panel.
 *
 * Query params:
 *   window_days: number  (default: 30, clamped to 1–90)
 *
 * Response shape:
 *   total_inquiry_starts   number
 *   adapted_count          number
 *   holdout_count          number
 *   adapted_rate           number   (0–1; 0 when adapted sessions = 0)
 *   holdout_rate           number   (0–1; 0 when holdout sessions = 0)
 *   lift_pct               number | null  (null when either arm < 30)
 *   daily_breakdown        { date: string; adapted: number; holdout: number }[]
 *   window_days            number
 *   generated_at           string   (ISO)
 *   data_source            'clickhouse' | 'mock'
 *
 * Auth: Bearer JWT required. tenant_id from JWT claim.
 *
 * ClickHouse: Joins events (type='inquiry.started') with adaptation_decisions
 * (holdout_group) on (tenant_id, session_id) within window_days.  When
 * CLICKHOUSE_URL is not set (dev / CI) the route falls back to deterministic
 * mock data so the dashboard renders in all environments.
 *
 * Rule K.2 — fail loud: when CLICKHOUSE_URL is set but a query fails, return
 * HTTP 500 and capture the error in Sentry. Never silently fall back to mock
 * data when a real ClickHouse is configured.
 *
 * @module apps/control-plane/src/app/api/pilot/inquiry-starts/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getAuthClaims } from '@estalara/auth';
import type { DailyBreakdownRow, InquiryStartsResponse } from './route-helpers';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';

// ─── Response types (re-exported from route-helpers for backward compat) ───────
// Canonical definitions live in route-helpers.ts so client components can import
// them without pulling in @estalara/auth (which is only built in CI).

export type { DailyBreakdownRow, InquiryStartsResponse } from './route-helpers';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clampWindowDays(raw: string | null): number {
  const parsed = parseInt(raw ?? '30', 10);
  if (isNaN(parsed)) return 30;
  return Math.max(1, Math.min(90, parsed));
}

function computeLiftPct(
  adaptedCount: number,
  holdoutCount: number,
  adaptedRate: number,
  holdoutRate: number,
): number | null {
  // Require at least 30 inquiry starts per group for statistical credibility.
  if (adaptedCount < 30 || holdoutCount < 30) return null;
  if (holdoutRate === 0) return null;
  return ((adaptedRate - holdoutRate) / holdoutRate) * 100;
}

interface ClickHouseConfig {
  url: string;
  /** ClickHouse username. Defaults to `'default'` when env is unset. */
  user: string;
  password: string;
}

function readClickHouseConfig(): ClickHouseConfig | null {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  return {
    url: url.replace(/\/$/, ''),
    user: process.env.CLICKHOUSE_USER ?? 'default',
    password: process.env.CLICKHOUSE_PASSWORD ?? '',
  };
}

// ─── ClickHouse query ──────────────────────────────────────────────────────────

interface ChAggRow {
  is_holdout: '0' | '1' | 0 | 1;
  inquiry_starts: number;
  total_sessions: number;
}

interface ChDailyRow {
  date: string;
  adapted: number;
  holdout: number;
}

interface ClickHouseResult {
  aggRows: ChAggRow[];
  dailyRows: ChDailyRow[];
}

/**
 * Query ClickHouse for adapted vs holdout inquiry starts.
 *
 * Uses parameterised query params (`{param_tenant_id:String}`) — no string
 * concatenation of user-supplied values.
 *
 * Returns null when CLICKHOUSE_URL is not set (dev / CI — caller uses mock data).
 * Throws when CLICKHOUSE_URL is set but the query fails (Rule K.2 — fail loud).
 */
async function fetchFromClickHouse(
  tenantId: string,
  windowDays: number,
): Promise<ClickHouseResult | null> {
  const cfg = readClickHouseConfig();
  if (!cfg) return null;

  // ── Aggregate query ──────────────────────────────────────────────────
  // FOLLOW-371 / ESC-026: exclude contaminated holdout rows written during the
  // ~12.5h window (PR #327 2026-06-19 21:17 UTC → PR #333 2026-06-20 09:53 UTC)
  // when the GET path logged (holdout_group=1, variant IN ('v1','v2')).
  const aggQuery = `
    SELECT
      ad.holdout_group                                    AS is_holdout,
      countIf(e.type = 'inquiry.started')                AS inquiry_starts,
      count(DISTINCT ad.session_id)                      AS total_sessions
    FROM adaptation_decisions ad
    LEFT JOIN events e
      ON ad.session_id = e.session_id
      AND ad.tenant_id = e.tenant_id
      AND e.type = 'inquiry.started'
    WHERE ad.tenant_id = {tenant_id:String}
      AND ad.assigned_at >= now() - INTERVAL {window_days:UInt8} DAY
      AND NOT (ad.holdout_group = 1 AND ad.variant != 'control')
    GROUP BY ad.holdout_group
    FORMAT JSONEachRow
  `.trim();

  const aggUrl = new URL(cfg.url);
  aggUrl.searchParams.set('query', aggQuery);
  aggUrl.searchParams.set('param_tenant_id', tenantId);
  aggUrl.searchParams.set('param_window_days', String(windowDays));

  const aggRes = await fetch(aggUrl.toString(), {
    method: 'GET',
    headers: { ...clickhouseAuthHeaders(cfg), 'Content-Type': 'text/plain' },
  });
  if (!aggRes.ok) {
    throw new Error(
      `ClickHouse agg query failed: HTTP ${String(aggRes.status)} ${aggRes.statusText}`,
    );
  }

  const aggText = await aggRes.text();
  const aggRows: ChAggRow[] = aggText
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line) as Record<string, unknown>;
      return {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- coercing JSON primitive safely
        is_holdout: String(row.is_holdout ?? '0') as '0' | '1',
        inquiry_starts: Number(row.inquiry_starts ?? 0),
        total_sessions: Number(row.total_sessions ?? 0),
      };
    });

  // ── Daily breakdown query ────────────────────────────────────────────
  // FOLLOW-371 / ESC-026: same exclusion filter as aggregate query above.
  const dailyQuery = `
    SELECT
      toDate(e.ts)                                        AS date,
      countIf(ad.holdout_group = false AND e.type = 'inquiry.started') AS adapted,
      countIf(ad.holdout_group = true  AND e.type = 'inquiry.started') AS holdout
    FROM adaptation_decisions ad
    LEFT JOIN events e
      ON ad.session_id = e.session_id
      AND ad.tenant_id = e.tenant_id
      AND e.type = 'inquiry.started'
    WHERE ad.tenant_id = {tenant_id:String}
      AND ad.assigned_at >= now() - INTERVAL {window_days:UInt8} DAY
      AND NOT (ad.holdout_group = 1 AND ad.variant != 'control')
    GROUP BY date
    ORDER BY date ASC
    FORMAT JSONEachRow
  `.trim();

  const dailyUrl = new URL(cfg.url);
  dailyUrl.searchParams.set('query', dailyQuery);
  dailyUrl.searchParams.set('param_tenant_id', tenantId);
  dailyUrl.searchParams.set('param_window_days', String(windowDays));

  const dailyRes = await fetch(dailyUrl.toString(), {
    method: 'GET',
    headers: { ...clickhouseAuthHeaders(cfg), 'Content-Type': 'text/plain' },
  });
  if (!dailyRes.ok) {
    throw new Error(
      `ClickHouse daily query failed: HTTP ${String(dailyRes.status)} ${dailyRes.statusText}`,
    );
  }

  const dailyText = await dailyRes.text();
  const dailyRows: ChDailyRow[] = dailyText
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line) as Record<string, unknown>;
      return {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- coercing JSON primitive safely
        date: String(row.date ?? ''),
        adapted: Number(row.adapted ?? 0),
        holdout: Number(row.holdout ?? 0),
      };
    });

  return { aggRows, dailyRows };
}

// ─── Response builder from ClickHouse result ──────────────────────────────────

function buildResponseFromClickHouse(
  tenantId: string,
  chResult: ClickHouseResult,
  windowDays: number,
): InquiryStartsResponse {
  let adaptedCount = 0;
  let holdoutCount = 0;
  let adaptedSessions = 0;
  let holdoutSessions = 0;

  for (const row of chResult.aggRows) {
    const isHoldout = row.is_holdout === '1' || row.is_holdout === 1;
    if (isHoldout) {
      holdoutCount = row.inquiry_starts;
      holdoutSessions = row.total_sessions;
    } else {
      adaptedCount = row.inquiry_starts;
      adaptedSessions = row.total_sessions;
    }
  }

  const adaptedRate = adaptedSessions > 0 ? adaptedCount / adaptedSessions : 0;
  const holdoutRate = holdoutSessions > 0 ? holdoutCount / holdoutSessions : 0;
  const liftPct = computeLiftPct(adaptedCount, holdoutCount, adaptedRate, holdoutRate);

  return {
    tenant_id: tenantId,
    total_inquiry_starts: adaptedCount + holdoutCount,
    adapted_count: adaptedCount,
    holdout_count: holdoutCount,
    adapted_rate: Math.round(adaptedRate * 10000) / 10000,
    holdout_rate: Math.round(holdoutRate * 10000) / 10000,
    lift_pct: liftPct !== null ? Math.round(liftPct * 100) / 100 : null,
    daily_breakdown: chResult.dailyRows,
    window_days: windowDays,
    generated_at: new Date().toISOString(),
    data_source: 'clickhouse' as const,
  };
}

// ─── Mock data (dev / CI fallback) ────────────────────────────────────────────
// MVP stub — replaced by FOLLOW-091 once pilot ClickHouse is live and
// receiving real inquiry.started events from app.estalara.com.

/** Deterministic integer hash. */
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

function buildMockResponse(tenantId: string, windowDays: number): InquiryStartsResponse {
  const seed = hash(tenantId);
  const adaptedCount = 50 + Math.floor(seededRandom(seed) * 200);
  const holdoutCount = 12 + Math.floor(seededRandom(seed + 1) * 50);
  const adaptedSessions = adaptedCount * (3 + Math.floor(seededRandom(seed + 2) * 7));
  const holdoutSessions = holdoutCount * (3 + Math.floor(seededRandom(seed + 3) * 7));
  const adaptedRate = adaptedSessions > 0 ? adaptedCount / adaptedSessions : 0;
  const holdoutRate = holdoutSessions > 0 ? holdoutCount / holdoutSessions : 0;
  const liftPct = computeLiftPct(adaptedCount, holdoutCount, adaptedRate, holdoutRate);

  const now = new Date();
  const dailyBreakdown: DailyBreakdownRow[] = Array.from({ length: windowDays }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (windowDays - 1 - i));
    const daySeed = seed + 200 + i;
    return {
      date: d.toISOString().slice(0, 10),
      adapted: Math.floor(seededRandom(daySeed) * 10),
      holdout: Math.floor(seededRandom(daySeed + 1) * 3),
    };
  });

  return {
    tenant_id: tenantId,
    total_inquiry_starts: adaptedCount + holdoutCount,
    adapted_count: adaptedCount,
    holdout_count: holdoutCount,
    adapted_rate: Math.round(adaptedRate * 10000) / 10000,
    holdout_rate: Math.round(holdoutRate * 10000) / 10000,
    lift_pct: liftPct !== null ? Math.round(liftPct * 100) / 100 : null,
    daily_breakdown: dailyBreakdown,
    window_days: windowDays,
    generated_at: new Date().toISOString(),
    data_source: 'mock' as const,
  };
}

// ─── Route handler ─────────────────────────────────────────────────────────────

/**
 * GET /api/pilot/inquiry-starts
 *
 * @returns 200 InquiryStartsResponse on success.
 * @returns 401 when no valid JWT or tenant_id claim is missing.
 * @returns 500 when CLICKHOUSE_URL is set but the ClickHouse query fails
 *   (Rule K.2 — fail loud; never silently fall back to mock when a real
 *   ClickHouse is configured).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims(req);
  if (!claims || !('tenant_id' in claims) || !claims.tenant_id) {
    return NextResponse.json(
      {
        error: {
          code: 'unauthorized',
          message: 'Valid Bearer JWT with tenant_id claim required',
        },
      },
      { status: 401 },
    );
  }

  const tenantId = claims.tenant_id;
  const windowDays = clampWindowDays(req.nextUrl.searchParams.get('window_days'));

  // fetchFromClickHouse returns null when CLICKHOUSE_URL is not set (dev / CI).
  // It throws when CLICKHOUSE_URL is set but the query fails (Rule K.2).
  let chResult: ClickHouseResult | null;
  try {
    chResult = await fetchFromClickHouse(tenantId, windowDays);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ClickHouse query failed (unknown error)';
    Sentry.captureException(err, {
      tags: { route: 'pilot/inquiry-starts', tenant_id: tenantId },
    });
    return NextResponse.json(
      {
        error: {
          code: 'clickhouse_error',
          message,
        },
      },
      { status: 500 },
    );
  }

  const response =
    chResult !== null
      ? buildResponseFromClickHouse(tenantId, chResult, windowDays)
      : buildMockResponse(tenantId, windowDays);

  return NextResponse.json(response, { status: 200 });
}
