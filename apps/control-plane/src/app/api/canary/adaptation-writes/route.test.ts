/**
 * Tests for GET /api/canary/adaptation-writes (FOLLOW-441 / audit finding F-06).
 *
 * Rule K.2 fail-loud contract — every failure mode returns HTTP 500 + Sentry;
 * a configured-store failure NEVER returns 200 or silently fabricates a healthy
 * signal.
 *
 * Coverage:
 *   Auth:
 *     - CRON_SECRET env var absent → 401
 *     - Authorization header does not match → 401
 *   Unconfigured (dev / CI):
 *     - CLICKHOUSE_URL unset → 200 no-op, no Sentry call
 *   Schema check (DESCRIBE TABLE):
 *     - CH returns HTTP error (e.g. 516 auth) → 500 + Sentry (DESCRIBE_FAILED)
 *     - CH throws network error (ECONNREFUSED) → 500 + Sentry (DESCRIBE_FAILED)
 *     - page_context_source column absent (migration-0019 unapplied) → 500 + Sentry
 *       (SCHEMA_DRIFT); error message references 'migration 0019'
 *   Count check:
 *     - Count query returns HTTP error → 500 + Sentry (COUNT_QUERY_FAILED)
 *     - Count returns 0 → 500 + Sentry (ZERO_ROWS); count field is 0
 *   Healthy path:
 *     - DESCRIBE ok + count > 0 → 200 with { ok, count, schema_ok, column_verified }
 *
 * CH transport is mocked via vi.stubGlobal('fetch', ...) — the same approach
 * used by apps/control-plane/src/app/api/pilot/cta-lift/route.test.ts.
 *
 * @module apps/control-plane/src/app/api/canary/adaptation-writes/route.test
 */

import { NextRequest } from 'next/server';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// ─── Mock @sentry/nextjs ──────────────────────────────────────────────────────

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

import * as Sentry from '@sentry/nextjs';
const mockCaptureException = vi.mocked(Sentry.captureException);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CRON_SECRET = 'test-cron-secret-441';

function makeRequest(overrides: { auth?: string | null } = {}): NextRequest {
  const url = 'http://localhost/api/canary/adaptation-writes';
  const headers: Record<string, string> = {};
  // Default: valid cron auth. Pass auth: null to omit the header entirely.
  const auth = overrides.auth !== undefined ? overrides.auth : `Bearer ${CRON_SECRET}`;
  if (auth !== null) headers.authorization = auth;
  return new NextRequest(url, { headers });
}

/** Build a single JSONEachRow line that DESCRIBE TABLE adaptation_decisions returns. */
function makeDescribeRow(name: string): string {
  return JSON.stringify({
    name,
    type: 'String',
    default_type: '',
    default_expression: '',
    comment: '',
    codec_expression: '',
    ttl_expression: '',
  });
}

/**
 * Build a mock DESCRIBE TABLE response containing exactly the given column
 * names (one JSONEachRow line per column).
 */
function makeDescribeBody(columns: string[]): string {
  return columns.map(makeDescribeRow).join('\n');
}

/** Build a mock count() response with the given row count. */
function makeCountBody(n: number): string {
  // ClickHouse returns numeric aggregates as strings in JSONEachRow.
  return JSON.stringify({ n: String(n) });
}

/**
 * The full column list that a migration-0019-current prod table has, including
 * page_context_source. Used for the happy-path and count-failure tests.
 */
const FULL_COLUMN_LIST = [
  'session_id',
  'tenant_id',
  'archetype',
  'confidence',
  'similarity',
  'source',
  'page_context',
  'directive_count',
  'ts',
  'holdout_group',
  'gate_reason',
  'variant',
  'adapt_decision_id',
  'demo_override',
  'model_version',
  'features_snapshot',
  'lead_id',
  'page_context_source', // migration 0019
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/canary/adaptation-writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    delete process.env.CLICKHOUSE_URL;
    delete process.env.CLICKHOUSE_USER;
    delete process.env.CLICKHOUSE_PASSWORD;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CRON_SECRET;
    delete process.env.CLICKHOUSE_URL;
    delete process.env.CLICKHOUSE_USER;
    delete process.env.CLICKHOUSE_PASSWORD;
  });

  // ─── Auth ─────────────────────────────────────────────────────────────────

  it('returns 401 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    // No Sentry on auth failures — not a CH error.
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header does not match CRON_SECRET', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ auth: 'Bearer wrong-secret' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  // ─── Unconfigured (dev / CI) ───────────────────────────────────────────────

  it('returns 200 no-op when CLICKHOUSE_URL is unset (dev / CI)', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; note: string };
    expect(body.ok).toBe(true);
    expect(body.note).toBe('CLICKHOUSE_URL_unset');
    // Unconfigured CH is not an error — no Sentry call (Rule K.2 distinction).
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  // ─── Schema check: DESCRIBE TABLE failures ────────────────────────────────

  it('returns 500 + Sentry when DESCRIBE TABLE returns a non-2xx HTTP status', async () => {
    process.env.CLICKHOUSE_URL = 'http://ch.test:8123';
    vi.stubGlobal(
      'fetch',
      // ClickHouse Code 516 = AUTHENTICATION_FAILED (empty-username pitfall)
      vi.fn().mockResolvedValue(new Response('AUTHENTICATION_FAILED Code: 516', { status: 516 })),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('DESCRIBE_FAILED');
    expect(body.error.message).toContain('DESCRIBE TABLE');
    expect(mockCaptureException).toHaveBeenCalledOnce();
    const [capturedErr] = mockCaptureException.mock.calls[0] as [Error, unknown];
    expect(capturedErr.message).toContain('DESCRIBE TABLE');
  });

  it('returns 500 + Sentry when DESCRIBE TABLE throws a network error', async () => {
    process.env.CLICKHOUSE_URL = 'http://ch.test:8123';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('DESCRIBE_FAILED');
    expect(mockCaptureException).toHaveBeenCalledOnce();
    const [capturedErr] = mockCaptureException.mock.calls[0] as [Error, unknown];
    expect(capturedErr.message).toContain('ECONNREFUSED');
  });

  // ─── Schema check: column absent (migration-0019 not applied) ─────────────

  it('returns 500 + Sentry (SCHEMA_DRIFT) when page_context_source is absent', async () => {
    process.env.CLICKHOUSE_URL = 'http://ch.test:8123';

    // DESCRIBE returns a column list WITHOUT page_context_source — migration 0019
    // has not been applied to this prod instance.
    const describeBody = makeDescribeBody([
      'session_id',
      'tenant_id',
      'archetype',
      'confidence',
      'page_context',
      'directive_count',
      'ts',
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(describeBody, { status: 200 })));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string; missing_column: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('SCHEMA_DRIFT');
    expect(body.error.missing_column).toBe('page_context_source');
    // The error message must reference migration 0019 so the operator knows
    // exactly which migration to apply.
    expect(body.error.message).toContain('page_context_source');
    expect(body.error.message).toContain('Migration 0019');

    // Sentry is called and the error message carries the key context.
    expect(mockCaptureException).toHaveBeenCalledOnce();
    const [capturedErr, capturedCtx] = mockCaptureException.mock.calls[0] as [
      Error,
      { tags: { check: string; missing_column: string } },
    ];
    expect(capturedErr.message).toContain('page_context_source');
    expect(capturedErr.message).toContain('Migration 0019');
    expect(capturedCtx.tags.check).toBe('schema_drift');
    expect(capturedCtx.tags.missing_column).toBe('page_context_source');

    // The count query must NOT be issued when the schema check fails — only one
    // fetch call (the DESCRIBE) should have been made.
    const fetchMock = vi.mocked(global.fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  // ─── Count check failures ─────────────────────────────────────────────────

  it('returns 500 + Sentry (COUNT_QUERY_FAILED) when the count query returns HTTP error', async () => {
    process.env.CLICKHOUSE_URL = 'http://ch.test:8123';

    const fetchMock = vi
      .fn()
      // First call: DESCRIBE succeeds with full column list.
      .mockResolvedValueOnce(new Response(makeDescribeBody(FULL_COLUMN_LIST), { status: 200 }))
      // Second call: count query times out.
      .mockResolvedValueOnce(new Response('Gateway Timeout', { status: 504 }));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('COUNT_QUERY_FAILED');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });

  // ─── Zero-rows alert (RETRO-133 recurrence-prevention) ────────────────────

  it('returns 500 + Sentry (ZERO_ROWS) when count returns 0 — fails loud per Rule K.2', async () => {
    process.env.CLICKHOUSE_URL = 'http://ch.test:8123';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(makeDescribeBody(FULL_COLUMN_LIST), { status: 200 }))
      .mockResolvedValueOnce(new Response(makeCountBody(0), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
      count: number;
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('ZERO_ROWS');
    // count must be exposed in the body so dashboards and runbooks have the
    // actual value, not just the error code.
    expect(body.count).toBe(0);
    // The error message must explain the likely causes so an operator can triage.
    expect(body.error.message).toContain('Zero adaptation_decisions');

    // Sentry must be called — ZERO_ROWS is a configured-store failure.
    expect(mockCaptureException).toHaveBeenCalledOnce();
    const [capturedErr, capturedCtx] = mockCaptureException.mock.calls[0] as [
      Error,
      { tags: { check: string } },
    ];
    expect(capturedErr.message).toContain('Zero adaptation_decisions');
    expect(capturedCtx.tags.check).toBe('zero_rows');
  });

  // ─── Healthy path ─────────────────────────────────────────────────────────

  it('returns 200 with { ok, count, schema_ok, column_verified } when healthy', async () => {
    process.env.CLICKHOUSE_URL = 'http://ch.test:8123';
    process.env.CLICKHOUSE_USER = 'ingest_worker';
    process.env.CLICKHOUSE_PASSWORD = 'prod-password';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(makeDescribeBody(FULL_COLUMN_LIST), { status: 200 }))
      .mockResolvedValueOnce(new Response(makeCountBody(142), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      count: number;
      schema_ok: boolean;
      column_verified: string;
    };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(142);
    expect(body.schema_ok).toBe(true);
    expect(body.column_verified).toBe('page_context_source');

    // No Sentry on a healthy run.
    expect(mockCaptureException).not.toHaveBeenCalled();

    // CLICKHOUSE_USER must be included in the Authorization header (avoid
    // empty-username Code-516 pitfall — clickhouseAuthHeaders contract).
    const firstCallInit = fetchMock.mock.calls[0] as [string, RequestInit];
    const authHeader = (firstCallInit[1].headers as Record<string, string>).Authorization;
    // "Basic " + base64("ingest_worker:prod-password")
    const expected = `Basic ${Buffer.from('ingest_worker:prod-password').toString('base64')}`;
    expect(authHeader).toBe(expected);
  });
});
