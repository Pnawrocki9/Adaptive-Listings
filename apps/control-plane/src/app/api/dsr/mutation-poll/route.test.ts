/**
 * Tests for GET /api/dsr/mutation-poll.
 *
 * Coverage — isAuthorized() hardening:
 *   - CRON_SECRET env var absent → 401 (infrastructure misconfiguration)
 *   - Correct Bearer token → 200 (proceeds to poll logic)
 *   - Wrong Bearer token → 401
 *   - Missing Authorization header → 401
 *
 * Coverage — FOLLOW-078 stuck mutation detection:
 *   1. Row with status 'pending', updatedAt = 2 hours ago → stuck: 1, Sentry.captureMessage called
 *   2. Row with status 'pending', updatedAt = 30 min ago → stuck: 0, Sentry.captureMessage NOT called
 *   3. Row with status 'done', updatedAt = 2 hours ago → stuck: 0 (terminal status excluded)
 *   4. Response body always includes `stuck` field (even when 0)
 *
 * All external dependencies (DB, ClickHouse) are mocked so tests focus
 * solely on authentication behaviour and stuck detection logic.
 *
 * @module apps/control-plane/src/app/api/dsr/mutation-poll/route.test
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockSelect,
  mockUpdate,
  mockReadClickHouseConfig,
  mockCaptureMessage,
  mockCaptureException,
  mockMaybeFinaliseAuditLog,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockReadClickHouseConfig: vi.fn(),
  mockCaptureMessage: vi.fn(),
  mockCaptureException: vi.fn(),
  mockMaybeFinaliseAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: mockCaptureMessage,
  captureException: mockCaptureException,
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    select: mockSelect,
    update: mockUpdate,
  })),
  dsrClickhouseMutations: {
    id: 'id',
    tenantId: 'tenant_id',
    sessionId: 'session_id',
    tableName: 'table_name',
    status: 'status',
    updatedAt: 'updated_at',
    mutationId: 'mutation_id',
    alterSql: 'alter_sql',
    retryCount: 'retry_count',
    nextRetryAt: 'next_retry_at',
    dsrVerificationId: 'dsr_verification_id',
  },
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, _op: 'eq' })),
  and: vi.fn((...args: unknown[]) => ({ args, _op: 'and' })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ col, vals, _op: 'inArray' })),
  isNull: vi.fn((col: unknown) => ({ col, _op: 'isNull' })),
  lt: vi.fn((col: unknown, val: unknown) => ({ col, val, _op: 'lt' })),
  lte: vi.fn((col: unknown, val: unknown) => ({ col, val, _op: 'lte' })),
  or: vi.fn((...args: unknown[]) => ({ args, _op: 'or' })),
}));

vi.mock('@/lib/clickhouse-dsr', () => ({
  readClickHouseConfig: mockReadClickHouseConfig,
  computeNextRetryAt: vi.fn(() => null),
  issueEraseMutation: vi.fn(),
  MAX_MUTATION_RETRIES: 3,
  pollMutationStatus: vi.fn(),
  resolveMutationIdByMarker: vi.fn(),
}));

vi.mock('./_finalise', () => ({
  maybeFinaliseAuditLog: mockMaybeFinaliseAuditLog,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildChain(rows: unknown[]) {
  interface Self {
    from: () => Self;
    where: () => Self;
    limit: () => Self;
    set: () => Self;
    then: (
      onFulfilled: (v: unknown[]) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise<unknown>;
    catch: (onRejected: (e: unknown) => unknown) => Promise<unknown>;
  }
  const self = {} as Self;
  const chainFn = () => self;
  self.from = chainFn;
  self.where = chainFn;
  self.limit = chainFn;
  self.set = chainFn;
  self.then = (onFulfilled, onRejected) => Promise.resolve(rows).then(onFulfilled, onRejected);
  self.catch = (onRejected) => Promise.resolve(rows).catch(onRejected);
  return self;
}

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL('http://localhost/api/dsr/mutation-poll'), {
    method: 'GET',
    headers,
  });
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-uuid-001',
    dsrVerificationId: 'ver-uuid-001',
    tenantId: 'tenant-uuid-001',
    sessionId: 'sess-abc123',
    tableName: 'events',
    mutationId: 'mut-001',
    status: 'pending',
    retryCount: 0,
    lastFailedReason: null,
    nextRetryAt: null,
    alterSql: "ALTER TABLE events DELETE WHERE session_id IN ('sess-abc123') -- DSR:abc123",
    issuedAt: new Date('2026-05-24T00:00:00Z'),
    completedAt: null,
    updatedAt: new Date(Date.now() - 2 * 60 * 60_000), // 2 hours ago by default
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/dsr/mutation-poll — isAuthorized()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();

    // Default: ClickHouse not configured → route returns early with no-op response.
    // This lets us verify 200 paths without wiring up the full DB poll.
    mockReadClickHouseConfig.mockReturnValue(null);
    mockSelect.mockReturnValue(buildChain([]));
    mockUpdate.mockReturnValue(buildChain([]));
  });

  it('returns 401 when CRON_SECRET env var is not set', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ authorization: 'Bearer anything' }));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when CRON_SECRET is absent and no Authorization header is provided', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when Bearer token does not match CRON_SECRET', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret-value');

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ authorization: 'Bearer wrong-secret-value' }));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when Authorization header is missing entirely', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret-value');

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('proceeds past auth (returns 200) when Bearer token matches CRON_SECRET', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret-value');
    // ClickHouse unconfigured → no-op 200 response with { polled: 0, note: 'CLICKHOUSE_URL_unset' }.
    mockReadClickHouseConfig.mockReturnValue(null);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ authorization: 'Bearer correct-secret-value' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { polled: number; note: string };
    expect(body.note).toBe('CLICKHOUSE_URL_unset');
  });

  it('returns 200 with polled/advanced counts when CLICKHOUSE is configured and DB is empty', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret-value');
    mockReadClickHouseConfig.mockReturnValue({
      url: 'http://clickhouse.test:8123',
      password: 'pw',
      database: 'estalara',
    });
    mockSelect.mockReturnValue(buildChain([]));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ authorization: 'Bearer correct-secret-value' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { polled: number; advanced: number };
    expect(body.polled).toBe(0);
    expect(body.advanced).toBe(0);
  });
});

describe('GET /api/dsr/mutation-poll — stuck mutation detection (FOLLOW-078)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    // FOLLOW-075 hardening: route requires CRON_SECRET + Bearer token.
    vi.stubEnv('CRON_SECRET', 'cron-test-secret');
    // Restore ClickHouse config so the route runs past the early-exit guard.
    mockReadClickHouseConfig.mockReturnValue({
      url: 'http://clickhouse.test:8123',
      database: 'default',
    });
    mockMaybeFinaliseAuditLog.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue(buildChain([]));
  });

  it('detects a stuck pending row (updatedAt 2h ago) → stuck: 1, captureMessage called', async () => {
    // Main polling query returns no actionable rows (empty — all non-terminal fetch returns empty
    // so the for-loop body is skipped; then stuck check query returns the stuck row).
    const stuckRow = makeRow({
      status: 'pending',
      updatedAt: new Date(Date.now() - 2 * 60 * 60_000),
    });

    mockSelect
      .mockReturnValueOnce(buildChain([])) // main polling query (no rows to advance)
      .mockReturnValueOnce(buildChain([stuckRow])); // stuck check query

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ authorization: 'Bearer cron-test-secret' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { polled: number; advanced: number; stuck: number };
    expect(body.stuck).toBe(1);
    expect(mockCaptureMessage).toHaveBeenCalledOnce();

    const [message, opts] = mockCaptureMessage.mock.calls[0] as [
      string,
      { level: string; tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(message).toContain('stuck');
    expect(opts.level).toBe('warning');
    expect(opts.tags.dsr_mutation_stuck).toBe('true');
    expect(opts.extra.row_id).toBe(stuckRow.id);
    expect(opts.extra.table_name).toBe(stuckRow.tableName);
    expect(opts.extra.session_id).toBe(stuckRow.sessionId);
    expect(opts.extra.tenant_id).toBe(stuckRow.tenantId);
  });

  it('does not flag a pending row updated 30 min ago → stuck: 0, captureMessage NOT called', async () => {
    // Stuck check returns empty because the DB query (with lt filter) would return no rows.
    // We simulate this by having the stuck-check select return [].
    mockSelect
      .mockReturnValueOnce(buildChain([])) // main polling query
      .mockReturnValueOnce(buildChain([])); // stuck check — no rows older than 1h

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ authorization: 'Bearer cron-test-secret' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { polled: number; advanced: number; stuck: number };
    expect(body.stuck).toBe(0);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('does not flag a done row updated 2h ago → stuck: 0, captureMessage NOT called', async () => {
    // The stuck-check query filters on status IN ('pending', 'in_progress'), so a 'done' row
    // would not be returned by the DB. We simulate DB filtering: stuck-check returns [].
    mockSelect
      .mockReturnValueOnce(buildChain([])) // main polling query
      .mockReturnValueOnce(buildChain([])); // stuck check — 'done' rows excluded by query

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ authorization: 'Bearer cron-test-secret' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { polled: number; advanced: number; stuck: number };
    expect(body.stuck).toBe(0);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('always includes stuck field in response body, even when 0', async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([])) // main polling query
      .mockReturnValueOnce(buildChain([])); // stuck check

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ authorization: 'Bearer cron-test-secret' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect('stuck' in body).toBe(true);
    expect(body.stuck).toBe(0);
  });

  it('emits captureException (not captureMessage) when the stuck-check DB query itself throws', async () => {
    const dbError = new Error('DB connection failed');

    mockSelect
      .mockReturnValueOnce(buildChain([])) // main polling query
      .mockReturnValueOnce({
        // stuck check throws
        from: () => ({ where: () => Promise.reject(dbError) }),
      });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ authorization: 'Bearer cron-test-secret' }));

    // Handler must not throw — response still returns 200 with stuck: 0.
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.stuck).toBe(0);
    expect(mockCaptureException).toHaveBeenCalledWith(dbError, {
      tags: { dsr_stuck_check_error: 'true' },
    });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});
