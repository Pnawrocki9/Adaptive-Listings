/**
 * Integration tests for POST /api/dsr/erase — FOLLOW-039 ClickHouse hard-delete
 * + FOLLOW-172 conversion_labels DSR cascade
 * + FOLLOW-193 engagement_scores DSR cascade (DPIA §8 line 773).
 *
 * Existing happy-path tests live in `apps/control-plane/src/app/api/dsr/dsr-routes.test.ts`.
 * This file covers the NEW behaviours added by FOLLOW-039, FOLLOW-172, and FOLLOW-193:
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
 *   FOLLOW-172 (compliance condition 7):
 *   7. conversion_labels rows are deleted inside the Postgres transaction when
 *      lead_id == session_id (non-empty) for the erased subject.
 *   8. Empty session_id MUST NOT trigger a conversion_labels delete (FOLLOW-180/LG-2
 *      guard — blank lead_id would erase ALL system labels for the tenant).
 *   FOLLOW-193 / DPIA §8 line 773 (compliance conditions 9-10):
 *   9. engagement_scores rows are deleted inside the Postgres transaction for the
 *      erased (session_id, tenant_id) -- AC3.
 *  10. engagement_scores row is absent after erasure -- AC4.
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
  conversionLabels: {
    tenantId: 'tenant_id',
    leadId: 'lead_id',
  },
  // FOLLOW-193 / DPIA §8 line 773: engagement_scores mock -- object identity used
  // in test assertions to verify the correct table is passed to tx.delete().
  engagementScores: {
    sessionId: 'session_id',
    tenantId: 'tenant_id',
  },
  dsrClickhouseMutations: {
    id: 'id',
    tenantId: 'tenant_id',
    sessionId: 'session_id',
    status: 'status',
    tableName: 'table_name',
  },
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, _op: 'eq' })),
  and: vi.fn((...args: unknown[]) => ({ args, _op: 'and' })),
  ne: vi.fn((col: unknown, val: unknown) => ({ col, val, _op: 'ne' })),
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
  // First select:  dsr_verifications lookup → record.
  // Second select: dsr_clickhouse_mutations idempotency check → empty.
  // Third select:  FOLLOW-239 CRM completeness count query → 0 surviving rows
  //                (default: no CRM-namespace conversion_labels rows exist).
  mockSelect
    .mockReturnValueOnce(buildChain([makeValidRecord()]))
    .mockReturnValueOnce(buildChain([]))
    .mockReturnValueOnce(buildChain([{ count: 0 }]));

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
      .mockReturnValueOnce(buildChain(preExisting))
      // FOLLOW-239: 3rd select = CRM completeness count query (no surviving rows).
      .mockReturnValueOnce(buildChain([{ count: 0 }]));

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

// ─── FOLLOW-172: conversion_labels DSR erasure cascade ────────────────────────

describe('POST /api/dsr/erase — FOLLOW-172 conversion_labels cascade', () => {
  it('deletes conversion_labels rows keyed by lead_id=session_id inside the Postgres transaction', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');

    // Import the mocked conversionLabels object reference so we can identify it
    // when the delete() call lands on the transaction mock.
    const { conversionLabels: mockConversionLabels } = await import('@estalara/db');

    // Track the delete calls on the transaction mock.
    const deletedTables: string[] = [];
    mockTransaction.mockImplementationOnce(
      async (fn: (tx: { delete: (table: unknown) => unknown }) => Promise<void>) => {
        const txMock = {
          delete: vi.fn((table: unknown) => {
            // Discriminate by object reference — the mock for conversionLabels is the
            // same object each time vi.mock factories run (singleton per vi.mock scope).
            if (table === mockConversionLabels) {
              deletedTables.push('conversion_labels');
            }
            return buildChain([]);
          }),
        };
        await fn(txMock);
      },
    );

    const { POST } = await import('./route.js');
    const res = await POST(makeRequest({ token: '123456' }));
    expect(res.status).toBe(200);

    // conversion_labels delete must have been issued.
    expect(deletedTables).toContain('conversion_labels');
  });

  it('FOLLOW-180/LG-2 guard: does NOT delete conversion_labels when session_id is empty', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');

    // Return a DSR record with an empty session_id (edge case — should not happen in production
    // but guard must hold regardless).
    mockSelect.mockReset();
    mockSelect
      .mockReturnValueOnce(buildChain([makeValidRecord({ sessionId: '' })]))
      .mockReturnValueOnce(buildChain([]))
      // FOLLOW-239: 3rd select = CRM completeness count query.
      .mockReturnValueOnce(buildChain([{ count: 0 }]));

    const { conversionLabels: mockConversionLabels } = await import('@estalara/db');

    const deletedTables: string[] = [];
    mockTransaction.mockImplementationOnce(
      async (fn: (tx: { delete: (table: unknown) => unknown }) => Promise<void>) => {
        const txMock = {
          delete: vi.fn((table: unknown) => {
            if (table === mockConversionLabels) {
              deletedTables.push('conversion_labels');
            }
            return buildChain([]);
          }),
        };
        await fn(txMock);
      },
    );

    const { POST } = await import('./route.js');
    const res = await POST(makeRequest({ token: '123456' }));
    expect(res.status).toBe(200);

    // With empty session_id, the guard must prevent the conversion_labels delete.
    expect(deletedTables).not.toContain('conversion_labels');
  });
});

// ─── FOLLOW-184: Pass B — CRM lead_id erasure cascade ────────────────────────

describe('POST /api/dsr/erase — FOLLOW-184 Pass B: durable CRM lead_id erasure', () => {
  it('deletes conversion_labels by durable_lead_id when it is non-empty and != session_id', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');

    const CRM_LEAD_ID = 'crm-opaque-token-xyz789';

    // Return a DSR record with a durable_lead_id (CRM token, different from session_id).
    mockSelect.mockReset();
    mockSelect
      .mockReturnValueOnce(buildChain([makeValidRecord({ durableLeadId: CRM_LEAD_ID })]))
      .mockReturnValueOnce(buildChain([]));

    const { conversionLabels: mockConversionLabels } = await import('@estalara/db');

    // Track delete calls — count how many times conversion_labels is deleted.
    const deletedTablesWithArgs: string[] = [];
    mockTransaction.mockImplementationOnce(
      async (fn: (tx: { delete: (table: unknown) => unknown }) => Promise<void>) => {
        const txMock = {
          delete: vi.fn((table: unknown) => {
            if (table === mockConversionLabels) {
              deletedTablesWithArgs.push('conversion_labels');
            }
            return buildChain([]);
          }),
        };
        await fn(txMock);
      },
    );

    const { POST } = await import('./route.js');
    const res = await POST(makeRequest({ token: '123456' }));
    expect(res.status).toBe(200);

    // Both Pass A (session_id) and Pass B (durable_lead_id) must delete conversion_labels.
    // So the table must be deleted TWICE.
    expect(deletedTablesWithArgs.filter((t) => t === 'conversion_labels')).toHaveLength(2);
  });

  it('does NOT run Pass B when durable_lead_id is null/undefined (no CRM record)', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');

    // Record without durableLeadId (standard SDK-only session).
    mockSelect.mockReset();
    mockSelect
      .mockReturnValueOnce(buildChain([makeValidRecord()])) // no durableLeadId
      .mockReturnValueOnce(buildChain([]))
      // FOLLOW-239: 3rd select = CRM completeness count query (no surviving rows).
      .mockReturnValueOnce(buildChain([{ count: 0 }]));

    const { conversionLabels: mockConversionLabels } = await import('@estalara/db');

    const deletedTablesWithArgs: string[] = [];
    mockTransaction.mockImplementationOnce(
      async (fn: (tx: { delete: (table: unknown) => unknown }) => Promise<void>) => {
        const txMock = {
          delete: vi.fn((table: unknown) => {
            if (table === mockConversionLabels) {
              deletedTablesWithArgs.push('conversion_labels');
            }
            return buildChain([]);
          }),
        };
        await fn(txMock);
      },
    );

    const { POST } = await import('./route.js');
    const res = await POST(makeRequest({ token: '123456' }));
    expect(res.status).toBe(200);

    // Only Pass A runs — exactly one delete for conversion_labels.
    expect(deletedTablesWithArgs.filter((t) => t === 'conversion_labels')).toHaveLength(1);
  });

  it('dedup guard: does NOT run Pass B when durable_lead_id equals session_id', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');

    const SESSION_ID = 'sess-abc123'; // matches makeValidRecord default sessionId

    // durable_lead_id = same as session_id → dedup guard fires, Pass B skipped.
    mockSelect.mockReset();
    mockSelect
      .mockReturnValueOnce(buildChain([makeValidRecord({ durableLeadId: SESSION_ID })]))
      .mockReturnValueOnce(buildChain([]))
      // FOLLOW-239: 3rd select = CRM completeness count query (dedup: durable_lead_id = session_id
      // means passBRan = false, so count query runs; no surviving rows expected).
      .mockReturnValueOnce(buildChain([{ count: 0 }]));

    const { conversionLabels: mockConversionLabels } = await import('@estalara/db');

    const deletedTablesWithArgs: string[] = [];
    mockTransaction.mockImplementationOnce(
      async (fn: (tx: { delete: (table: unknown) => unknown }) => Promise<void>) => {
        const txMock = {
          delete: vi.fn((table: unknown) => {
            if (table === mockConversionLabels) {
              deletedTablesWithArgs.push('conversion_labels');
            }
            return buildChain([]);
          }),
        };
        await fn(txMock);
      },
    );

    const { POST } = await import('./route.js');
    const res = await POST(makeRequest({ token: '123456' }));
    expect(res.status).toBe(200);

    // Pass B skipped (dedup) → only Pass A ran → exactly one delete.
    expect(deletedTablesWithArgs.filter((t) => t === 'conversion_labels')).toHaveLength(1);
  });
});

// --- FOLLOW-193 / DPIA §8 line 773: engagement_scores DSR erasure cascade ---
//
// AC3: integration test covering POST /api/dsr/erase erasure cascade for
//      engagement_scores -- verifies the DELETE is issued inside the transaction.
// AC4: engagement_scores row is absent after erasure (verified via the mock:
//      the delete call is recorded and the mock table state reflects the absence).

describe('POST /api/dsr/erase -- FOLLOW-193 engagement_scores cascade (DPIA §8)', () => {
  it('AC3: deletes engagement_scores rows by (session_id, tenant_id) inside the Postgres transaction', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');

    const { engagementScores: mockEngagementScores } = await import('@estalara/db');

    const deletedTables: string[] = [];
    mockTransaction.mockImplementationOnce(
      async (fn: (tx: { delete: (table: unknown) => unknown }) => Promise<void>) => {
        const txMock = {
          delete: vi.fn((table: unknown) => {
            if (table === mockEngagementScores) {
              deletedTables.push('engagement_scores');
            }
            return buildChain([]);
          }),
        };
        await fn(txMock);
      },
    );

    const { POST } = await import('./route.js');
    const res = await POST(makeRequest({ token: '123456' }));

    expect(res.status).toBe(200);

    // AC3: engagement_scores delete was issued inside the transaction.
    expect(deletedTables).toContain('engagement_scores');
  });

  it('AC4: engagement_scores row is absent after erasure (mock state confirms no residual row)', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');

    const { engagementScores: mockEngagementScores } = await import('@estalara/db');

    // Simulate a seeded engagement_scores row for the test session.
    const seededRows = [
      {
        id: 'es-uuid-001',
        tenantId: 'tenant-uuid-001',
        sessionId: 'sess-abc123',
        engagementScore: '0.72000',
        dwellScore: '0.80000',
        interactionScore: '0.65000',
        scrollScore: '0.71000',
        computedAt: new Date('2026-06-05T10:00:00Z'),
        createdAt: new Date('2026-06-05T10:00:00Z'),
        updatedAt: new Date('2026-06-05T10:00:00Z'),
      },
    ];

    // Track which rows remain after the delete call.
    let remainingRows = [...seededRows];

    mockTransaction.mockImplementationOnce(
      async (fn: (tx: { delete: (table: unknown) => unknown }) => Promise<void>) => {
        const txMock = {
          delete: vi.fn((table: unknown) => {
            // Simulate the DELETE: remove matching rows from the in-memory set.
            if (table === mockEngagementScores) {
              remainingRows = remainingRows.filter(
                (r) => !(r.sessionId === 'sess-abc123' && r.tenantId === 'tenant-uuid-001'),
              );
            }
            return buildChain([]);
          }),
        };
        await fn(txMock);
      },
    );

    const { POST } = await import('./route.js');
    const res = await POST(makeRequest({ token: '123456' }));

    expect(res.status).toBe(200);

    // AC4: no engagement_scores row remains for the erased (session_id, tenant_id).
    const residual = remainingRows.filter(
      (r) => r.sessionId === 'sess-abc123' && r.tenantId === 'tenant-uuid-001',
    );
    expect(residual).toHaveLength(0);
  });

  it('AC3/AC4 combined: engagement_scores deletion is inside the SAME transaction as session_embeddings (atomicity)', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');

    const { engagementScores: mockEngagementScores, sessionEmbeddings: mockSessionEmbeddings } =
      await import('@estalara/db');

    // Track which tables were deleted INSIDE the transaction (not outside it).
    const tablesDeletedInsideTx: string[] = [];
    let txCallCount = 0;

    mockTransaction.mockImplementationOnce(
      async (fn: (tx: { delete: (table: unknown) => unknown }) => Promise<void>) => {
        txCallCount++;
        const txMock = {
          delete: vi.fn((table: unknown) => {
            if (table === mockEngagementScores) tablesDeletedInsideTx.push('engagement_scores');
            if (table === mockSessionEmbeddings) tablesDeletedInsideTx.push('session_embeddings');
            return buildChain([]);
          }),
        };
        await fn(txMock);
      },
    );

    const { POST } = await import('./route.js');
    const res = await POST(makeRequest({ token: '123456' }));

    expect(res.status).toBe(200);

    // Both tables must be deleted inside the SAME transaction call.
    expect(txCallCount).toBe(1);
    expect(tablesDeletedInsideTx).toContain('engagement_scores');
    expect(tablesDeletedInsideTx).toContain('session_embeddings');

    // DSR request completes -- the response must contain a deleted_at timestamp.
    const body = (await res.json()) as { deleted_at: string; clickhouse_deletion: unknown };
    expect(typeof body.deleted_at).toBe('string');
    expect(new Date(body.deleted_at).getTime()).toBeGreaterThan(0);
  });
});
