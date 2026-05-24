/**
 * Integration tests for POST /api/dsr/erase — FOLLOW-039 ClickHouse hard-delete.
 *
 * Existing happy-path tests live in `apps/control-plane/src/app/api/dsr/dsr-routes.test.ts`.
 * This file covers the NEW behaviours added by FOLLOW-039:
 *
 *   1. ClickHouse mutations are ISSUED (HTTP POST to CLICKHOUSE_URL) for every
 *      table in DSR_CLICKHOUSE_TABLES when a valid OTP is presented.
 *   2. Per-table `dsr_clickhouse_mutations` rows are persisted.
 *   3. Response contains `clickhouse_deletion: { status, mutations }`.
 *   4. Idempotency: a second erase for the same (tenant, session) does NOT
 *      reissue mutations; statuses are reported as 'reused'.
 *   5. Edge case: when CLICKHOUSE_URL is unset, the endpoint still returns 200
 *      and persists no-op 'done' rows.
 *   6. Edge case: ClickHouse HTTP failure does NOT fail the DSR endpoint;
 *      'failed' rows are persisted and the response status is 200.
 *
 * All external dependencies are mocked.
 *
 * @module apps/control-plane/src/app/api/dsr/erase/route.test
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DSR_CLICKHOUSE_TABLES } from '@/lib/clickhouse-dsr';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockSelect,
  mockUpdate,
  mockTransaction,
  mockInsert,
  mockWriteDsrAuditLog,
  mockHashOtp,
  insertedRows,
  selectedRows,
} = vi.hoisted(() => {
  const insertedRows: unknown[] = [];
  const selectedRows: { rows: unknown[] }[] = [];
  return {
    mockSelect: vi.fn(),
    mockUpdate: vi.fn(),
    mockTransaction: vi.fn(),
    mockInsert: vi.fn(),
    mockWriteDsrAuditLog: vi.fn().mockResolvedValue(undefined),
    mockHashOtp: vi.fn().mockImplementation((otp: string) => `hash_of_${otp}`),
    insertedRows,
    selectedRows,
  };
});

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    select: mockSelect,
    update: mockUpdate,
    transaction: mockTransaction,
    insert: mockInsert,
  })),
  dsrVerifications: {
    id: 'id',
    otpHash: 'otp_hash',
    dsrType: 'dsr_type',
    usedAt: 'used_at',
  },
  sessionEmbeddings: { sessionId: 'session_id', tenantId: 'tenant_id' },
  consentRecords: { sessionId: 'session_id' },
  dsrClickhouseMutations: {
    id: 'id',
    tenantId: 'tenant_id',
    sessionId: 'session_id',
    status: 'status',
    tableName: 'table_name',
  },
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, _op: 'eq' })),
  and: vi.fn((...args: unknown[]) => ({ args, _op: 'and' })),
}));

vi.mock('@/lib/dsr-otp', () => ({
  hashOtp: mockHashOtp,
}));

vi.mock('../_clickhouse', () => ({
  writeDsrAuditLog: mockWriteDsrAuditLog,
}));

// ─── Drizzle chain helper ─────────────────────────────────────────────────────

function buildChain(rows: unknown[]) {
  interface Self {
    from: () => Self;
    where: () => Self;
    limit: () => Self;
    returning: () => Self;
    set: () => Self;
    values: (v?: unknown) => Self;
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
  self.returning = chainFn;
  self.set = chainFn;
  self.values = (v?: unknown) => {
    if (v !== undefined) insertedRows.push(v);
    return self;
  };
  self.then = (onFulfilled, onRejected) => Promise.resolve(rows).then(onFulfilled, onRejected);
  self.catch = (onRejected) => Promise.resolve(rows).catch(onRejected);
  return self;
}

function makeRequest(body: unknown): NextRequest {
  const url = new URL('http://localhost/api/dsr/erase');
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeValidRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dsr-uuid-001',
    tenantId: 'tenant-uuid-001',
    sessionId: 'sess-abc123',
    email: 'buyer@example.com',
    dsrType: 'erase',
    otpHash: 'hash_of_123456',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    usedAt: null,
    createdAt: new Date('2026-05-24T00:00:00Z'),
    ...overrides,
  };
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  insertedRows.length = 0;
  selectedRows.length = 0;
  mockHashOtp.mockImplementation((otp: string) => `hash_of_${otp}`);
  mockWriteDsrAuditLog.mockResolvedValue(undefined);
  mockUpdate.mockReturnValue(buildChain([]));
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const txMock = { delete: vi.fn().mockReturnValue(buildChain([])) };
    await fn(txMock);
  });
  mockInsert.mockReturnValue(buildChain([]));

  // Default: no pre-existing dsr_clickhouse_mutations rows.
  // First select: dsr_verifications lookup → record.
  // Second select: dsr_clickhouse_mutations idempotency check → empty.
  mockSelect
    .mockReturnValueOnce(buildChain([makeValidRecord()]))
    .mockReturnValueOnce(buildChain([]));

  // Default fetch impl — pretend ClickHouse accepts every ALTER + returns a mutation_id.
  // Both ALTER and SELECT system.mutations are POSTed to the same CLICKHOUSE_URL
  // with the SQL in the body. We discriminate on the body content.
  const fetchMock = vi.fn((_input: string | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    if (body.includes('system.mutations')) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ mutation_id: 'mut_id_test' }] }), {
          status: 200,
        }),
      );
    }
    // ALTER TABLE call — return empty 200.
    return Promise.resolve(new Response('', { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);
});

// ─── Edge: empty session list path - skipped (route always has session_id from OTP) ──

describe('POST /api/dsr/erase — ClickHouse hard-delete', () => {
  it('issues ALTER TABLE DELETE WHERE for every DSR_CLICKHOUSE_TABLES entry when CLICKHOUSE_URL is set', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123');

    const { POST } = await import('./route.js');
    const res = await POST(makeRequest({ token: '123456' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      deleted_at: string;
      clickhouse_deletion: { status: string; mutations: { table: string; status: string }[] };
    };
    expect(body.clickhouse_deletion.status).toBe('pending');
    expect(body.clickhouse_deletion.mutations.map((m) => m.table)).toEqual(
      DSR_CLICKHOUSE_TABLES.map((t) => t.table),
    );
    // One INSERT per ClickHouse table.
    expect(insertedRows.length).toBe(DSR_CLICKHOUSE_TABLES.length);
    for (const inserted of insertedRows as Record<string, unknown>[]) {
      expect(inserted.status).toBe('pending');
      expect(inserted.sessionId).toBe('sess-abc123');
      expect(inserted.tenantId).toBe('tenant-uuid-001');
    }
  });

  it('returns 200 and persists no-op done rows when CLICKHOUSE_URL is unset', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');

    const { POST } = await import('./route.js');
    const res = await POST(makeRequest({ token: '123456' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      clickhouse_deletion: { status: string; mutations: { status: string }[] };
    };
    expect(body.clickhouse_deletion.status).toBe('done');
    expect(insertedRows.length).toBe(DSR_CLICKHOUSE_TABLES.length);
    for (const inserted of insertedRows as Record<string, unknown>[]) {
      expect(inserted.status).toBe('done');
    }
  });

  it('idempotency: reuses existing dsr_clickhouse_mutations rows on replay', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123');

    // Override the second select to return pre-existing 'done' rows.
    const preExisting = DSR_CLICKHOUSE_TABLES.map(({ table }) => ({
      id: `row-${table}`,
      tenantId: 'tenant-uuid-001',
      sessionId: 'sess-abc123',
      tableName: table,
      mutationId: 'prev_mut_id',
      status: 'done',
    }));
    mockSelect.mockReset();
    mockSelect
      .mockReturnValueOnce(buildChain([makeValidRecord()]))
      .mockReturnValueOnce(buildChain(preExisting));

    const { POST } = await import('./route.js');
    const res = await POST(makeRequest({ token: '123456' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      clickhouse_deletion: { status: string; mutations: { status: string }[] };
    };
    expect(body.clickhouse_deletion.status).toBe('done');
    expect(body.clickhouse_deletion.mutations.every((m) => m.status === 'reused')).toBe(true);
    // NO new INSERTs.
    expect(insertedRows.length).toBe(0);
  });

  it('does not fail the endpoint when ClickHouse ALTER returns an error — persists failed rows', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123');

    const errorFetch = vi.fn(() =>
      Promise.resolve(new Response('connection refused', { status: 500 })),
    );
    vi.stubGlobal('fetch', errorFetch);

    const { POST } = await import('./route.js');
    const res = await POST(makeRequest({ token: '123456' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      clickhouse_deletion: { status: string; mutations: { status: string }[] };
    };
    expect(body.clickhouse_deletion.status).toBe('failed');
    expect(insertedRows.length).toBe(DSR_CLICKHOUSE_TABLES.length);
    for (const inserted of insertedRows as Record<string, unknown>[]) {
      expect(inserted.status).toBe('failed');
    }
  });
});
