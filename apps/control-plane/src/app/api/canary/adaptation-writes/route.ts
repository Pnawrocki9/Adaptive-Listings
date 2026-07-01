/**
 * GET /api/canary/adaptation-writes
 *
 * Vercel Cron handler — write-verification canary for `adaptation_decisions`
 * (FOLLOW-441, audit finding F-06 / RETRO-133).
 *
 * **Problem:** `logDecisionAsync` INSERTs into `adaptation_decisions` using
 * columns introduced by ClickHouse migrations. If prod ClickHouse is behind
 * (migration not applied), CH rejects the entire INSERT and the route swallows
 * it with no alerting → zero analytics rows silently. RETRO-133 found exactly
 * this: the table returned zero rows in prod after ESC-031. No ongoing mechanism
 * existed to catch recurrence.
 *
 * **What this canary verifies (every 15 minutes):**
 *   1. **Schema:** `DESCRIBE TABLE adaptation_decisions` must list the
 *      `page_context_source` column (migration 0019). A missing column means the
 *      prod schema is behind and every `logDecisionAsync` INSERT is being silently
 *      rejected.
 *   2. **Writes:** `SELECT count() FROM adaptation_decisions WHERE ts >= now() - INTERVAL 1 DAY`
 *      must return >0. Zero rows in the 24h window = writes are not landing.
 *
 * **Rule K.2 — fail loud:** Any CH error, a missing expected column, or a
 * zero-row 24h window triggers `Sentry.captureException` + HTTP 500. This
 * canary NEVER returns HTTP 200 on a configured-store failure. A CH error is not
 * "0 writes" — it is a loud failure.
 *
 * **When CLICKHOUSE_URL is unset (dev / CI):** the route is a deliberate no-op
 * and returns 200 with `note: 'CLICKHOUSE_URL_unset'`. This mirrors the existing
 * "unconfigured ≠ error" pattern across all CH routes in this control-plane
 * (FOLLOW-094, pilot/cta-lift, dsr/mutation-poll).
 *
 * **Auth:** Protected by `CRON_SECRET` header per Vercel Cron security guidance
 * (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * Vercel injects `Authorization: Bearer ${CRON_SECRET}` automatically for
 * cron-triggered invocations. Returns 401 when CRON_SECRET is not set
 * (infrastructure misconfiguration) or the header does not match.
 *
 * **Operator response when the canary fires:**
 *   - `SCHEMA_DRIFT` alert: apply the pending CH migration(s) to prod:
 *       doppler run --config prd -- ./infra/clickhouse/scripts/migrate.sh
 *     Then verify: `DESCRIBE TABLE adaptation_decisions` should include the
 *     missing column. Reference: docs/runbooks/clickhouse-migrations.md
 *     (FOLLOW-404 attestation section) and infra/clickhouse/scripts/migrate.sh.
 *   - `ZERO_ROWS` alert: inspect Sentry for CH INSERT errors tagged
 *     `{ sink: 'clickhouse', area: 'adapt' }`. Check that the pilot is receiving
 *     traffic and that CLICKHOUSE_USER / CLICKHOUSE_PASSWORD are set correctly in
 *     the Vercel prod environment. If the schema is healthy but no rows exist,
 *     verify that the pilot tenant is active and requests are reaching the
 *     GET /api/adapt handler.
 *   - `DESCRIBE_FAILED` / `COUNT_QUERY_FAILED` alert: a direct CH connectivity
 *     failure. Check CLICKHOUSE_URL, network access, and CH Cloud cluster status.
 *
 * **Uses `@/lib/clickhouse-http`** so CLICKHOUSE_USER defaults are respected and
 * the empty-username Code-516 pitfall is avoided (same as all other CH callers in
 * this app).
 *
 * **Idempotency:** Read-only (two SELECT queries). Safe to invoke multiple times
 * concurrently.
 *
 * **Cron schedule:** `* /15 * * * *` (every 15 minutes) — satisfies FOLLOW-441 AC-1
 * "runs at least every 15 minutes in prod".
 *
 * @module apps/control-plane/src/app/api/canary/adaptation-writes/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';

// ─── Migration-0019 sentinel column ──────────────────────────────────────────

/**
 * The column added by migration 0019_adaptation_decisions_page_context_source.sql.
 *
 * If this column is absent from the live prod table, every INSERT from
 * `logDecisionAsync` is being silently rejected by ClickHouse (unknown column →
 * the entire INSERT fails). This is the key schema-drift signal from ESC-031 /
 * RETRO-133.
 */
const EXPECTED_COLUMN = 'page_context_source';

// ─── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Reject when CRON_SECRET is not set — unconfigured secret is an
  // infrastructure misconfiguration, not a valid dev/CI bypass.
  if (!secret) return false;
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

// ─── ClickHouse config ────────────────────────────────────────────────────────

interface ChConfig {
  url: string;
  user: string;
  password: string;
}

function readChConfig(): ChConfig | null {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  return {
    url,
    user: process.env.CLICKHOUSE_USER ?? 'default',
    password: process.env.CLICKHOUSE_PASSWORD ?? '',
  };
}

// ─── ClickHouse query helper ──────────────────────────────────────────────────

/**
 * Execute a single ClickHouse query over the HTTP interface and return the raw
 * text body (JSONEachRow format).
 *
 * Throws on a non-2xx HTTP response — the caller is responsible for fail-loud
 * handling (Rule K.2). Network-layer rejections also propagate as thrown errors.
 */
async function chExec(cfg: ChConfig, query: string): Promise<string> {
  const url = new URL(cfg.url);
  url.searchParams.set('query', `${query.trim()} FORMAT JSONEachRow`);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'text/plain',
      ...clickhouseAuthHeaders({ user: cfg.user, password: cfg.password }),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable body>');
    throw new Error(`ClickHouse HTTP ${String(res.status)}: ${body.slice(0, 500)}`);
  }

  return res.text();
}

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/canary/adaptation-writes
 *
 * @returns 200 `{ ok: true, count, schema_ok, column_verified }` when both
 *   the schema and the 24h write count are healthy.
 * @returns 200 `{ ok: true, note: 'CLICKHOUSE_URL_unset' }` when CH is not
 *   configured (dev / CI deliberate no-op).
 * @returns 401 when CRON_SECRET is invalid or not set.
 * @returns 500 on schema drift, zero-row window, or any CH error (Rule K.2 —
 *   a CH error is a loud failure, never "0 writes").
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Cron secret invalid' } },
      { status: 401 },
    );
  }

  const cfg = readChConfig();
  if (!cfg) {
    // CLICKHOUSE_URL unset — dev / CI. Deliberate no-op per Rule K.2:
    // "unconfigured dependency" is not an error; only "configured but failed" is.
    return NextResponse.json({ ok: true, note: 'CLICKHOUSE_URL_unset' });
  }

  // ── Step 1: Schema check — verify migration-0019 column is present ─────────
  //
  // If page_context_source is absent, logDecisionAsync's INSERT will fail
  // with "unknown column" and ClickHouse rejects the ENTIRE batch silently
  // (the route swallows it via .catch()). This is the ESC-031 / RETRO-133 mode.

  let columnNames: string[];
  try {
    const raw = await chExec(cfg, 'DESCRIBE TABLE adaptation_decisions');
    columnNames = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        return typeof parsed.name === 'string' ? parsed.name : '';
      });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const error = new Error(`[canary] DESCRIBE TABLE adaptation_decisions failed: ${msg}`);
    Sentry.captureException(error, {
      tags: {
        canary: 'adaptation_writes',
        check: 'describe_table',
        area: 'canary',
      },
      extra: { table: 'adaptation_decisions' },
    });
    return NextResponse.json(
      { ok: false, error: { code: 'DESCRIBE_FAILED', message: error.message } },
      { status: 500 },
    );
  }

  if (!columnNames.includes(EXPECTED_COLUMN)) {
    const error = new Error(
      `[canary] Schema drift detected: column '${EXPECTED_COLUMN}' is absent from ` +
        `adaptation_decisions. Migration 0019 (0019_adaptation_decisions_page_context_source.sql) ` +
        `has NOT been applied to prod ClickHouse. Every logDecisionAsync INSERT is being ` +
        `silently rejected. ` +
        `Fix: doppler run --config prd -- ./infra/clickhouse/scripts/migrate.sh`,
    );
    Sentry.captureException(error, {
      tags: {
        canary: 'adaptation_writes',
        check: 'schema_drift',
        area: 'canary',
        missing_column: EXPECTED_COLUMN,
      },
      extra: {
        table: 'adaptation_decisions',
        present_columns: columnNames,
        missing_column: EXPECTED_COLUMN,
      },
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SCHEMA_DRIFT',
          message: error.message,
          missing_column: EXPECTED_COLUMN,
          present_columns: columnNames,
        },
      },
      { status: 500 },
    );
  }

  // ── Step 2: Write-flow check — 24h row count must be > 0 ───────────────────
  //
  // Parameterized query (no string-interpolated user values; INTERVAL is a
  // SQL keyword constant). The platform-wide canary is intentionally
  // tenant-agnostic: a single platform-level count catches any write-flow
  // failure regardless of which tenant's session triggered it.

  let rowCount: number;
  try {
    const raw = await chExec(
      cfg,
      'SELECT count() AS n FROM adaptation_decisions WHERE ts >= now() - INTERVAL 1 DAY',
    );
    const rows = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    rowCount = rows.length > 0 ? Number(rows[0]?.n ?? 0) : 0;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const error = new Error(`[canary] adaptation_decisions 24h count query failed: ${msg}`);
    Sentry.captureException(error, {
      tags: {
        canary: 'adaptation_writes',
        check: 'count_query',
        area: 'canary',
      },
      extra: { table: 'adaptation_decisions', window: '1 DAY' },
    });
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'COUNT_QUERY_FAILED', message: error.message },
      },
      { status: 500 },
    );
  }

  if (rowCount === 0) {
    // Zero rows in the 24h window means logDecisionAsync is not writing to prod.
    // This could be: (a) silent INSERT rejection, (b) bad credentials, (c) no pilot
    // traffic. All three are production failures that need immediate investigation.
    // Rule K.2: do NOT return 200 here — zero is not healthy.
    const error = new Error(
      `[canary] Zero adaptation_decisions rows in the last 24h. ` +
        `logDecisionAsync may be silently failing (rejected INSERT, wrong credentials, ` +
        `or no pilot traffic). ` +
        `Check Sentry for tags { sink: 'clickhouse', area: 'adapt' } and verify ` +
        `CLICKHOUSE_USER / CLICKHOUSE_PASSWORD in Vercel prod env.`,
    );
    Sentry.captureException(error, {
      tags: {
        canary: 'adaptation_writes',
        check: 'zero_rows',
        area: 'canary',
      },
      extra: { table: 'adaptation_decisions', window: '1 DAY', count: 0 },
    });
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'ZERO_ROWS', message: error.message },
        count: 0,
      },
      { status: 500 },
    );
  }

  // Both checks passed: schema is consistent with migration 0019 and writes
  // are landing in prod.
  return NextResponse.json({
    ok: true,
    count: rowCount,
    schema_ok: true,
    column_verified: EXPECTED_COLUMN,
  });
}
