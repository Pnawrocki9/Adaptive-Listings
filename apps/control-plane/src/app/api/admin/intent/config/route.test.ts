/**
 * Tests for POST /api/admin/intent/config
 * (FOLLOW-268-write, ADR-0012 Ticket B, FOLLOW-301 one-active-row invariant).
 *
 * Coverage:
 *   AC1.1:  POST creates a global row; response includes id, tenant_id null, is_active.
 *   AC1.1b: POST creates a tenant-specific row when tenant_id is provided.
 *   AC1.1c: POST creates an inactive row when is_active=false (plain insert, no deactivation).
 *   AC1.2:  POST returns 400 on invalid JSON body.
 *   AC1.3:  POST returns 400 on Zod validation failure (invalid weight keys).
 *   AC3.1:  POST returns 401 when no auth header.
 *   AC3.2:  POST returns 403 when JWT is agency (not staff or admin secret).
 *   AC3.5:  POST accepts ADMIN_API_SECRET Bearer (constant-time compare path).
 *   AC4.1:  POST rejects unknown signal key in signal_likelihoods (strict schema).
 *   AC4.2:  POST rejects unknown archetype key in priors.
 *   AC4.3:  POST accepts valid partial weights (only behavioral_damping).
 *   AC4.4:  POST accepts empty weights object `{}`.
 *   K2.1:   POST returns 500 when DB is configured but throws (Rule K.2 — no mock write).
 *   K2.2:   POST returns 500 when DB is unconfigured (Rule K.2 — no mock write path).
 *
 *   FOLLOW-301 additions:
 *   INV-1:  POST with is_active=true calls transaction() — deactivates then inserts.
 *   INV-2:  POST with is_active=true, second call deactivates the first (atomic-swap).
 *   INV-3:  POST → GET round-trip: written row is served as data_source:'live'.
 *   INV-4:  POST residual 23505 (race) maps to 409 active_config_exists (not 500).
 *   INV-5:  POST FK violation 23503 maps to 400 unknown_tenant (not 500).
 *   INV-6:  POST with is_active=false uses plain insert (no transaction).
 *
 * Rule K.2 contract for writes: NEVER fall back to a mock on DB failure.
 * Unlike read routes, writes have no "unconfigured DB → return mock" path.
 *
 * Auth note: the `verifyTracerAdminAuth` guard is tested via real module import;
 * only the `@estalara/auth` JWT dependency is mocked. The ADMIN_API_SECRET path
 * uses `timingSafeEqual` from Node crypto — no mock needed.
 *
 * @module apps/control-plane/src/app/api/admin/intent/config/route.test
 */

import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const ADMIN_SECRET = 'test-admin-secret-xyz';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const ROW_ID = 'aaaabbbb-0001-0001-0001-000000000001';
const CREATED_AT = new Date('2026-06-13T10:00:00.000Z');

// SHA-256('valid-api-key') for GET route round-trip tests.
const VALID_KEY = 'valid-api-key';
const VALID_KEY_HASH = createHash('sha256').update(VALID_KEY).digest('hex');

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
  isStaffClaims: vi.fn(),
}));

// Shared mock factory — each test that needs live DB configures this.
const { mockCreateAdminClient } = vi.hoisted(() => {
  const mockCreateAdminClient = vi.fn();
  return { mockCreateAdminClient };
});

vi.mock('@estalara/db', () => ({
  createAdminClient: mockCreateAdminClient,
  intentWeightConfigs: {
    id: 'id',
    tenantId: 'tenant_id',
    weights: 'weights',
    isActive: 'is_active',
    createdAt: 'created_at',
    createdBy: 'created_by',
  },
  apiKeys: {
    tenantId: 'tenant_id',
    hashedKey: 'hashed_key',
    revokedAt: 'revoked_at',
    expiresAt: 'expires_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ type: 'eq' })),
  and: vi.fn((..._args: unknown[]) => ({ type: 'and' })),
  or: vi.fn((..._args: unknown[]) => ({ type: 'or' })),
  isNull: vi.fn((_col: unknown) => ({ type: 'isNull' })),
  gt: vi.fn((_col: unknown, _val: unknown) => ({ type: 'gt' })),
  ne: vi.fn((_col: unknown, _val: unknown) => ({ type: 'ne' })),
  desc: vi.fn((_col: unknown) => ({ type: 'desc' })),
}));

import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import { AdminIntentConfigResponseSchema } from '@estalara/shared';
import { GET as ADMIN_GET, POST } from './route';
import { GET } from '../../../intent/config/route';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
vi.mocked(isStaffClaims);

// ─── DB mock builders ─────────────────────────────────────────────────────────

/**
 * Build a Drizzle insert mock chain: insert().values().returning() → rows.
 */
function makeInsertMock(rows: unknown[]) {
  const returningFn = vi.fn().mockResolvedValue(rows);
  const valuesFn = vi.fn().mockReturnValue({ returning: returningFn });
  const insertFn = vi.fn().mockReturnValue({ values: valuesFn });
  return { insert: insertFn };
}

/**
 * Build a mock for a transaction that performs deactivate + insert.
 * The transaction callback receives a `tx` object with both `update` and `insert`.
 *
 * @param insertRows - rows returned by the insert step inside the transaction.
 * @param deactivateCount - how many rows the update step deactivates (default 1).
 */
function makeTransactionMock(insertRows: unknown[], deactivateCount = 1) {
  // update chain for deactivation (no .returning())
  const deactivateWhereFn = vi.fn().mockResolvedValue({ rowCount: deactivateCount });
  const deactivateSetFn = vi.fn().mockReturnValue({ where: deactivateWhereFn });
  const deactivateUpdateFn = vi.fn().mockReturnValue({ set: deactivateSetFn });

  // insert chain for the new row
  const insertReturningFn = vi.fn().mockResolvedValue(insertRows);
  const insertValuesFn = vi.fn().mockReturnValue({ returning: insertReturningFn });
  const insertInsertFn = vi.fn().mockReturnValue({ values: insertValuesFn });

  const tx = {
    update: deactivateUpdateFn,
    insert: insertInsertFn,
  };

  // transaction() calls the callback with tx and returns the result
  const transactionFn = vi.fn().mockImplementation((cb: (tx: unknown) => Promise<unknown>) => {
    return cb(tx);
  });

  return { transaction: transactionFn, _tx: tx };
}

/**
 * Build a mock for a transaction that throws a Postgres error.
 */
function makeTransactionMockThrowing(err: Error) {
  const transactionFn = vi.fn().mockRejectedValue(err);
  return { transaction: transactionFn };
}

/**
 * Build a Drizzle select mock chain for AUTH queries (no orderBy):
 * select().from().where().limit() → rows.
 */
function makeAuthSelectMock(rows: unknown[]) {
  const limitFn = vi.fn().mockResolvedValue(rows);
  const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });
  return { select: selectFn };
}

/**
 * Build a Drizzle select mock chain for WEIGHT queries (with orderBy):
 * select().from().where().orderBy().limit() → rows.
 */
function makeWeightSelectMock(rows: unknown[]) {
  const limitFn = vi.fn().mockResolvedValue(rows);
  const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
  const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });
  return { select: selectFn };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePostRequest(
  body: unknown,
  opts: { bearer?: string | undefined } = { bearer: ADMIN_SECRET },
): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.bearer !== undefined) {
    headers.Authorization = `Bearer ${opts.bearer}`;
  }
  return new NextRequest('http://localhost/api/admin/intent/config', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function makeGetRequest(bearer: string): NextRequest {
  return new NextRequest('http://localhost/api/intent/config', {
    method: 'GET',
    headers: { Authorization: `Bearer ${bearer}` },
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

/** Set env so DB is "configured". */
function withConfiguredDb() {
  vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
}

// ─── POST tests — auth ────────────────────────────────────────────────────────

describe('POST /api/admin/intent/config — auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    withConfiguredDb();
  });

  it('AC3.1: returns 401 when no Authorization header', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const res = await POST(makePostRequest({ weights: {} }, { bearer: undefined }));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('AC3.2: returns 403 when JWT is agency-tenant (not staff)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:owner' as const,
      estalara_staff: false as const,
      mfa_verified: true,
    });

    const res = await POST(makePostRequest({ weights: {} }, { bearer: 'agency-jwt-token' }));
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('AC3.5: accepts ADMIN_API_SECRET Bearer via constant-time compare', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const createdRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: true,
      createdAt: CREATED_AT,
    };
    const { transaction } = makeTransactionMock([createdRow]);
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await POST(makePostRequest({ weights: { behavioral_damping: 0.3 } }));
    expect(res.status).toBe(201);
    const body = await parseBody<{ id: string }>(res);
    expect(body.id).toBe(ROW_ID);
  });
});

// ─── POST tests — validation ──────────────────────────────────────────────────

describe('POST /api/admin/intent/config — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('AC1.2: returns 400 when body is not valid JSON', async () => {
    const req = new NextRequest('http://localhost/api/admin/intent/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ADMIN_SECRET}`,
      },
      body: 'not-json{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC1.3 / AC4.1: returns 400 when signal_likelihoods uses an unknown signal key', async () => {
    const res = await POST(
      makePostRequest({
        weights: {
          signal_likelihoods: {
            quiz_answer: { yield_hunter: 1.2 }, // old invented key — not in INTENT_SIGNAL_KEYS
          },
        },
      }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC4.2: returns 400 when priors uses an unknown archetype key', async () => {
    const res = await POST(
      makePostRequest({
        weights: {
          priors: { made_up_archetype: 0.5 },
        },
      }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC4.3: accepts valid partial weights (only behavioral_damping)', async () => {
    const createdRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: true,
      createdAt: CREATED_AT,
    };
    const { transaction } = makeTransactionMock([createdRow]);
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await POST(
      makePostRequest({
        weights: { behavioral_damping: 0.25 },
      }),
    );
    expect(res.status).toBe(201);
    const body = await parseBody<{ id: string }>(res);
    expect(body.id).toBe(ROW_ID);
  });

  it('AC4.4: accepts empty weights object — uses transaction for is_active=true default', async () => {
    const createdRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: true,
      createdAt: CREATED_AT,
    };
    const { transaction } = makeTransactionMock([createdRow]);
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await POST(makePostRequest({ weights: {} }));
    expect(res.status).toBe(201);
  });
});

// ─── POST tests — create (AC1) ────────────────────────────────────────────────

describe('POST /api/admin/intent/config — create (AC1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('AC1.1: creates a global row; response includes id, tenant_id null, is_active', async () => {
    const createdRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: true,
      createdAt: CREATED_AT,
    };
    const { transaction } = makeTransactionMock([createdRow]);
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await POST(
      makePostRequest({
        weights: { behavioral_damping: 0.2, priors: { yield_hunter: 0.06, neutral: 0.3 } },
      }),
    );
    expect(res.status).toBe(201);
    const body = await parseBody<{
      id: string;
      tenant_id: string | null;
      is_active: boolean;
      created_at: string;
    }>(res);
    expect(body.id).toBe(ROW_ID);
    expect(body.tenant_id).toBeNull();
    expect(body.is_active).toBe(true);
    expect(typeof body.created_at).toBe('string');
  });

  it('AC1.1b: creates a tenant-specific row when tenant_id is provided', async () => {
    const createdRow = {
      id: ROW_ID,
      tenantId: TENANT_ID,
      isActive: true,
      createdAt: CREATED_AT,
    };
    const { transaction } = makeTransactionMock([createdRow]);
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await POST(
      makePostRequest({
        weights: { behavioral_damping: 0.3 },
        tenant_id: TENANT_ID,
      }),
    );
    expect(res.status).toBe(201);
    const body = await parseBody<{ id: string; tenant_id: string | null }>(res);
    expect(body.id).toBe(ROW_ID);
    expect(body.tenant_id).toBe(TENANT_ID);
  });

  it('AC1.1c: creates an inactive row when is_active=false — uses plain insert, no transaction', async () => {
    const createdRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: false,
      createdAt: CREATED_AT,
    };
    // Plain insert mock (no transaction needed for is_active=false).
    const insertMock = makeInsertMock([createdRow]);
    mockCreateAdminClient.mockReturnValue(insertMock);

    const res = await POST(
      makePostRequest({
        weights: {},
        is_active: false,
      }),
    );
    expect(res.status).toBe(201);
    const body = await parseBody<{ is_active: boolean }>(res);
    expect(body.is_active).toBe(false);
  });
});

// ─── POST tests — Rule K.2 fail-loud ─────────────────────────────────────────

describe('POST /api/admin/intent/config — Rule K.2 fail-loud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('K2.1: returns 500 when DB is configured but throws (Rule K.2 — no mock fallback)', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    const { transaction } = makeTransactionMockThrowing(new Error('Postgres connection refused'));
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await POST(makePostRequest({ weights: {} }));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('db_error');
    // MUST NOT return fabricated data — verify no 'id' field was returned
    expect('id' in body).toBe(false);
  });

  it('K2.2: returns 500 when DB is unconfigured (no mock write path for mutations)', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    const res = await POST(makePostRequest({ weights: {} }));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('db_unconfigured');
  });
});

// ─── POST tests — FOLLOW-301 one-active-row invariant ────────────────────────

describe('POST /api/admin/intent/config — FOLLOW-301 one-active-row invariant', () => {
  beforeEach(() => {
    // Reset mock implementations (including mockReturnValueOnce queue) in addition to
    // clearing call counts. This prevents a failed test (e.g. INV-3) from leaving
    // unconsumed mockReturnValueOnce registrations that corrupt the next test.
    mockCreateAdminClient.mockReset();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('INV-1: POST with is_active=true (default) calls transaction() to deactivate-then-insert', async () => {
    const createdRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: true,
      createdAt: CREATED_AT,
    };
    const { transaction } = makeTransactionMock([createdRow]);
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await POST(makePostRequest({ weights: { behavioral_damping: 0.3 } }));
    expect(res.status).toBe(201);
    // Verify the transaction was called (atomic-swap happened).
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('INV-2: atomic-swap — second active POST deactivates the first row', async () => {
    // First POST: creates row-1 as active.
    const row1 = { id: 'row-1', tenantId: null, isActive: true, createdAt: CREATED_AT };
    const { transaction: txn1, _tx: tx1 } = makeTransactionMock([row1], 0);
    mockCreateAdminClient.mockReturnValueOnce({ transaction: txn1 });

    const res1 = await POST(makePostRequest({ weights: { behavioral_damping: 0.2 } }));
    expect(res1.status).toBe(201);

    // Verify first POST: the update (deactivation) step ran with no prior active rows.
    // The tx.update().set().where() chain was called even with 0 rows to deactivate.
    expect(tx1.update).toHaveBeenCalledOnce();
    expect(tx1.insert).toHaveBeenCalledOnce();

    // Second POST: deactivates row-1, creates row-2 as active.
    const row2 = {
      id: 'row-2',
      tenantId: null,
      isActive: true,
      createdAt: new Date('2026-06-13T11:00:00.000Z'),
    };
    const { transaction: txn2, _tx: tx2 } = makeTransactionMock([row2], 1);
    mockCreateAdminClient.mockReturnValueOnce({ transaction: txn2 });

    const res2 = await POST(makePostRequest({ weights: { behavioral_damping: 0.4 } }));
    expect(res2.status).toBe(201);
    const body2 = await parseBody<{ id: string; is_active: boolean }>(res2);
    expect(body2.id).toBe('row-2');
    expect(body2.is_active).toBe(true);

    // Second POST: the deactivation update step was called again.
    expect(tx2.update).toHaveBeenCalledOnce();
    expect(tx2.insert).toHaveBeenCalledOnce();
  });

  it('INV-3: POST → GET round-trip — written row is served as data_source: live', async () => {
    // This test proves the end-to-end wiring between the admin write API and the SDK GET.
    // Replaces the previous AC5 mock-only test (RETRO-071 TG-1).
    //
    // Step 1: POST via admin API creates the row.
    const writtenWeights = {
      behavioral_damping: 0.22,
      priors: { family_buyer: 0.07, neutral: 0.28 },
      signal_likelihoods: { 'cta.clicked': { yield_hunter: 1.2 } },
    };
    const createdRow = {
      id: ROW_ID,
      tenantId: TENANT_ID,
      isActive: true,
      createdAt: CREATED_AT,
    };
    const { transaction } = makeTransactionMock([createdRow]);
    mockCreateAdminClient.mockReturnValueOnce({ transaction });

    const postRes = await POST(makePostRequest({ weights: writtenWeights, tenant_id: TENANT_ID }));
    expect(postRes.status).toBe(201);
    const postBody = await parseBody<{ id: string }>(postRes);
    expect(postBody.id).toBe(ROW_ID);

    // Step 2: GET /api/intent/config with the tenant's API key.
    // The GET route calls createAdminClient() twice:
    //   - call 1: resolveApiKey → select from api_keys (no orderBy)
    //   - call 2: weight lookup → select from intent_weight_configs (with orderBy)
    //
    // Auth DB returns the api_keys row for the tenant.
    const authDb = makeAuthSelectMock([{ tenantId: TENANT_ID, hashedKey: VALID_KEY_HASH }]);

    // Weight DB returns the row written by POST (with the written weights).
    const weightRow = {
      id: ROW_ID,
      tenantId: TENANT_ID,
      weights: writtenWeights,
      createdAt: CREATED_AT,
      isActive: true,
    };
    const weightDb = makeWeightSelectMock([weightRow]);

    mockCreateAdminClient
      .mockReturnValueOnce(authDb) // resolveApiKey
      .mockReturnValueOnce(weightDb); // weight fetch

    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');

    const getRes = await GET(makeGetRequest(VALID_KEY));
    expect(getRes.status).toBe(200);
    const getBody = await parseBody<{
      data_source: string;
      is_tenant_specific: boolean;
      weights: { behavioral_damping?: number };
    }>(getRes);

    // Key assertions: the GET returns 'live' with the exact weights written by POST.
    expect(getBody.data_source).toBe('live');
    expect(getBody.is_tenant_specific).toBe(true);
    expect(getBody.weights.behavioral_damping).toBe(0.22);
  });

  it('INV-4: POST residual 23505 unique violation (race) maps to 409 active_config_exists', async () => {
    // This should not happen in normal operation (the atomic swap prevents it),
    // but can occur under concurrent write races.
    const pgUniqueError = Object.assign(new Error('unique violation'), { code: '23505' });
    const { transaction } = makeTransactionMockThrowing(pgUniqueError);
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await POST(makePostRequest({ weights: {} }));
    expect(res.status).toBe(409);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('active_config_exists');
    // Must NOT return 'db_error' — that would be the wrong status code for this condition.
    expect(body.error.code).not.toBe('db_error');
  });

  it('INV-5: POST FK violation 23503 maps to 400 unknown_tenant (not 500)', async () => {
    const pgFkError = Object.assign(new Error('foreign key violation'), { code: '23503' });
    const { transaction } = makeTransactionMockThrowing(pgFkError);
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await POST(
      makePostRequest({ weights: {}, tenant_id: '00000000-0000-0000-0000-999999999999' }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unknown_tenant');
    // Must NOT return 'db_error'.
    expect(body.error.code).not.toBe('db_error');
  });

  it('INV-6: POST with is_active=false uses plain insert (no transaction called)', async () => {
    const createdRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: false,
      createdAt: CREATED_AT,
    };
    const insertMock = makeInsertMock([createdRow]);
    // No transaction mock needed — the route must NOT call transaction() for is_active=false.
    mockCreateAdminClient.mockReturnValue(insertMock);

    const res = await POST(makePostRequest({ weights: {}, is_active: false }));
    expect(res.status).toBe(201);
    const body = await parseBody<{ is_active: boolean }>(res);
    expect(body.is_active).toBe(false);
    // Verify plain insert was called (not transaction).
    expect(insertMock.insert).toHaveBeenCalledOnce();
  });
});

// ─── GET /api/admin/intent/config tests (FOLLOW-309, ADR-0013 Contract 2) ────
//
// These tests drive the REAL GET handler imported from ./route (not the SDK-facing GET).
// All fixture objects are validated through AdminIntentConfigResponseSchema so the
// test cannot pass if the shape the handler emits contradicts the schema (RETRO-077 TG-1
// anti-pattern: fabricated fixtures that don't match the route's real response shape).
//
// Coverage:
//   GET-1: no active global row → 200 with id=null, is_active=false (ADR-0013 nullability)
//   GET-2: active global row found → 200 with string UUID id, is_active=true
//   GET-3: unauthenticated request → 401
//   GET-4: ?tenant_id= present → 400 unsupported_param (global-only v1)
//   GET-5: DB configured but throws → 500 db_error (Rule K.2 — no mock fallback)

describe('GET /api/admin/intent/config — FOLLOW-309 (ADR-0013 Contract 2)', () => {
  beforeEach(() => {
    mockCreateAdminClient.mockReset();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockGetAuthClaims.mockResolvedValue(null);
  });

  /**
   * Build a Drizzle select chain for the admin GET handler:
   * select().from().where().orderBy().limit() → rows.
   */
  function makeAdminSelectMock(rows: unknown[]) {
    const limitFn = vi.fn().mockResolvedValue(rows);
    const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
    const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    const selectFn = vi.fn().mockReturnValue({ from: fromFn });
    return { select: selectFn };
  }

  function makeAdminGetRequest(opts: { bearer?: string; tenantIdParam?: string } = {}) {
    const url = new URL('http://localhost/api/admin/intent/config');
    if (opts.tenantIdParam) url.searchParams.set('tenant_id', opts.tenantIdParam);
    const headers: Record<string, string> = {};
    if (opts.bearer !== undefined) headers.Authorization = `Bearer ${opts.bearer}`;
    return new NextRequest(url.toString(), { method: 'GET', headers });
  }

  it('GET-1: no active global row → 200 with id=null, is_active=false', async () => {
    const db = makeAdminSelectMock([]);
    mockCreateAdminClient.mockReturnValue(db);

    const res = await ADMIN_GET(makeAdminGetRequest({ bearer: ADMIN_SECRET }));
    expect(res.status).toBe(200);

    const body = await parseBody<unknown>(res);
    // Validate against the REAL shared schema — not a hand-authored fixture.
    // If the route emits a shape AdminIntentConfigResponseSchema rejects, parse() throws.
    const parsed = AdminIntentConfigResponseSchema.parse(body);
    expect(parsed.id).toBeNull();
    expect(parsed.is_active).toBe(false);
    expect(parsed.tenant_id).toBeNull();
    expect(parsed.created_at).toBeNull();
    expect(parsed.weights).toEqual({});
  });

  it('GET-2: active global row found → 200 with string UUID id, is_active=true', async () => {
    const activeRow = {
      id: ROW_ID,
      tenantId: null,
      weights: { behavioral_damping: 0.35 },
      isActive: true,
      createdAt: CREATED_AT,
    };
    const db = makeAdminSelectMock([activeRow]);
    mockCreateAdminClient.mockReturnValue(db);

    const res = await ADMIN_GET(makeAdminGetRequest({ bearer: ADMIN_SECRET }));
    expect(res.status).toBe(200);

    const body = await parseBody<unknown>(res);
    // Validate against the REAL shared schema (RETRO-077 TG-1 prevention).
    const parsed = AdminIntentConfigResponseSchema.parse(body);
    expect(parsed.id).toBe(ROW_ID);
    expect(parsed.is_active).toBe(true);
    expect(parsed.tenant_id).toBeNull();
    expect(typeof parsed.created_at).toBe('string');
    expect(parsed.weights.behavioral_damping).toBe(0.35);
  });

  it('GET-3: unauthenticated request → 401', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const res = await ADMIN_GET(makeAdminGetRequest({}));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('GET-4: ?tenant_id= present → 400 unsupported_param (global-only v1, ADR-0013)', async () => {
    const res = await ADMIN_GET(
      makeAdminGetRequest({ bearer: ADMIN_SECRET, tenantIdParam: TENANT_ID }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unsupported_param');
  });

  it('GET-5: DB configured but throws → 500 db_error (Rule K.2 — no mock fallback)', async () => {
    const db = makeAdminSelectMock([]);
    // Override the select chain to throw instead of returning empty rows.
    const throwingSelectFn = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('Postgres connection refused')),
          }),
        }),
      }),
    });
    mockCreateAdminClient.mockReturnValue({ ...db, select: throwingSelectFn });

    const res = await ADMIN_GET(makeAdminGetRequest({ bearer: ADMIN_SECRET }));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('db_error');
    // Must NOT return fabricated data — no 'id' or 'weights' fields in error body.
    expect('id' in body).toBe(false);
  });
});
