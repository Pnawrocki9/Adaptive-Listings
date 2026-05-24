/**
 * Unit tests for GET /api/dsr/mutation-poll — isAuthorized() hardening.
 *
 * Coverage:
 *   - CRON_SECRET env var absent → 401 (infrastructure misconfiguration)
 *   - Correct Bearer token → 200 (proceeds to poll logic)
 *   - Wrong Bearer token → 401
 *   - Missing Authorization header → 401
 *
 * All external dependencies (DB, ClickHouse) are mocked so tests focus
 * solely on authentication behaviour.
 *
 * @module apps/control-plane/src/app/api/dsr/mutation-poll/route.test
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockSelect, mockUpdate, mockReadClickHouseConfig, mockMaybeFinaliseAuditLog } = vi.hoisted(
  () => ({
    mockSelect: vi.fn(),
    mockUpdate: vi.fn(),
    mockReadClickHouseConfig: vi.fn(),
    mockMaybeFinaliseAuditLog: vi.fn().mockResolvedValue(undefined),
  }),
);

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
    status: 'status',
    tableName: 'table_name',
    nextRetryAt: 'next_retry_at',
    mutationId: 'mutation_id',
    alterSql: 'alter_sql',
    retryCount: 'retry_count',
    dsrVerificationId: 'dsr_verification_id',
    updatedAt: 'updated_at',
  },
  and: vi.fn((...args: unknown[]) => ({ args, _op: 'and' })),
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, _op: 'eq' })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ col, vals, _op: 'inArray' })),
  isNull: vi.fn((col: unknown) => ({ col, _op: 'isNull' })),
  lte: vi.fn((col: unknown, val: unknown) => ({ col, val, _op: 'lte' })),
  or: vi.fn((...args: unknown[]) => ({ args, _op: 'or' })),
}));

vi.mock('@/lib/clickhouse-dsr', () => ({
  readClickHouseConfig: mockReadClickHouseConfig,
  computeNextRetryAt: vi.fn(),
  issueEraseMutation: vi.fn(),
  MAX_MUTATION_RETRIES: 3,
  pollMutationStatus: vi.fn(),
  resolveMutationIdByMarker: vi.fn(),
}));

vi.mock('./_finalise', () => ({
  maybeFinaliseAuditLog: mockMaybeFinaliseAuditLog,
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
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
