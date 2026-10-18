/**
 * Tests for PUT /api/admin/intent/config/[id]
 * (FOLLOW-268-write, ADR-0012 Ticket B, FOLLOW-301 one-active-row invariant).
 *
 * Coverage:
 *   AC2.1:  PUT updates weights + returns the updated row.
 *   AC2.2:  PUT returns 404 on unknown id.
 *   AC2.3:  PUT with empty body returns 400 (at-least-one-field validation).
 *   AC2.4:  PUT with only is_active toggle updates row correctly.
 *   AC3.3:  PUT returns 401 when no auth header.
 *   AC3.4:  PUT returns 403 when JWT is agency (not staff or admin secret).
 *   AC4.1:  PUT rejects invalid signal key in signal_likelihoods.
 *   K2.3:   PUT returns 500 when DB is configured but throws (Rule K.2).
 *   K2.4:   PUT returns 500 when DB is unconfigured.
 *   VAL-1:  PUT returns 400 when [id] is not a valid UUID.
 *
 *   FOLLOW-301 additions:
 *   INV-1:  PUT {is_active:true} calls transaction() for atomic swap.
 *   INV-2:  PUT {is_active:true} deactivates sibling rows in same scope (not the target).
 *   INV-3:  PUT {is_active:false} updates without sibling deactivation, inside the audit tx.
 *   INV-4:  PUT residual 23505 (race) maps to 409 active_config_exists (not 500).
 *   INV-5:  PUT FK violation 23503 maps to 400 unknown_tenant (not 500).
 *   INV-6:  PUT {is_active:true} with unknown id returns 404 (not a DB error).
 *
 *   FOLLOW-1321 rank gate (ADR-0018 #3):
 *   RANK-1: ADMIN_API_SECRET Bearer → 403 (read-only), no DB write.
 *   RANK-2: estalara:readonly staff JWT → 403, no DB write.
 *   RANK-3: estalara:ops staff JWT → 200 + one staff_audit_log row in the same tx.
 *   RANK-4: estalara:superadmin staff JWT → 200.
 *   RANK-5: unknown id → 404 and NO audit row.
 *
 * @module apps/control-plane/src/app/api/admin/intent/config/[id]/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const ADMIN_SECRET = 'test-admin-secret-xyz';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const ROW_ID = 'aaaabbbb-0001-0001-0001-000000000001';
const CREATED_AT = new Date('2026-06-13T10:00:00.000Z');

const STAFF_JWT = 'staff-jwt-token';
const OPS_USER_ID = 'ccccdddd-0000-0000-0000-000000000002';
const OPS_CLAIMS = {
  sub: OPS_USER_ID,
  email: 'ops@estalara.com',
  tenant_id: null,
  estalara_staff: true as const,
  estalara_role: 'estalara:ops' as const,
  mfa_verified: true,
};
const READONLY_CLAIMS = { ...OPS_CLAIMS, estalara_role: 'estalara:readonly' as const };
const SUPERADMIN_CLAIMS = { ...OPS_CLAIMS, estalara_role: 'estalara:superadmin' as const };

/** Sentinel for the mocked `staffAuditLog` table (FOLLOW-1321); hoisted for vi.mock. */
const { STAFF_AUDIT_TABLE } = vi.hoisted(() => ({
  STAFF_AUDIT_TABLE: { __table: 'staff_audit_log' },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
  isStaffClaims: vi.fn(),
}));

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
  staffAuditLog: STAFF_AUDIT_TABLE,
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
import { PUT } from './route';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockIsStaffClaims = vi.mocked(isStaffClaims);

/** Authenticate as a verified staff JWT with the given claims (FOLLOW-1321). */
function asStaff(claims: typeof OPS_CLAIMS | typeof READONLY_CLAIMS | typeof SUPERADMIN_CLAIMS) {
  mockGetAuthClaims.mockResolvedValue(claims);
  mockIsStaffClaims.mockReturnValue(true);
}

/** tx.insert() that only accepts the staff audit table; returns the values() spy. */
function makeAuditInsert() {
  const auditValuesFn = vi.fn().mockResolvedValue(undefined);
  const insertFn = vi.fn().mockImplementation((table: unknown) => {
    if (table !== STAFF_AUDIT_TABLE) throw new Error('unexpected insert target');
    return { values: auditValuesFn };
  });
  return { insertFn, auditValuesFn };
}

// ─── DB mock builders ─────────────────────────────────────────────────────────

/**
 * Build a transaction mock for a non-activating PUT (is_active=false or absent):
 * tx.update().set().where().returning() → rows, plus tx.insert(staffAuditLog).
 * Since FOLLOW-1321 this path runs inside the audit transaction.
 */
function makeUpdateMock(rows: unknown[]) {
  const returningFn = vi.fn().mockResolvedValue(rows);
  const whereFn = vi.fn().mockReturnValue({ returning: returningFn });
  const setFn = vi.fn().mockReturnValue({ where: whereFn });
  const updateFn = vi.fn().mockReturnValue({ set: setFn });
  const { insertFn, auditValuesFn } = makeAuditInsert();
  const tx = { update: updateFn, insert: insertFn };
  const transactionFn = vi.fn().mockImplementation((cb: (tx: unknown) => Promise<unknown>) => {
    return cb(tx);
  });
  return { transaction: transactionFn, update: updateFn, _audit: auditValuesFn };
}

/**
 * Build a transaction mock whose update throws.
 */
function makeUpdateMockThrowing(err: Error) {
  const returningFn = vi.fn().mockRejectedValue(err);
  const whereFn = vi.fn().mockReturnValue({ returning: returningFn });
  const setFn = vi.fn().mockReturnValue({ where: whereFn });
  const updateFn = vi.fn().mockReturnValue({ set: setFn });
  const { insertFn } = makeAuditInsert();
  const tx = { update: updateFn, insert: insertFn };
  const transactionFn = vi.fn().mockImplementation((cb: (tx: unknown) => Promise<unknown>) => {
    return cb(tx);
  });
  return { transaction: transactionFn };
}

/**
 * Build a transaction mock for PUT {is_active:true}.
 *
 * The transaction callback receives a `tx` with:
 *   - select().from().where().limit() → targetRow (the row being activated)
 *   - update().set().where()          → deactivate siblings
 *   - update().set().where().returning() → update the target row
 *
 * @param targetRow   - the row fetched inside the transaction to learn its scope.
 * @param updatedRows - rows returned by the final update().returning().
 */
function makeActivateTransactionMock(
  targetRow: { id: string; tenantId: string | null } | null,
  updatedRows: unknown[],
) {
  // select chain (fetch target row to learn scope)
  const selectLimitFn = vi.fn().mockResolvedValue(targetRow ? [targetRow] : []);
  const selectWhereFn = vi.fn().mockReturnValue({ limit: selectLimitFn });
  const selectFromFn = vi.fn().mockReturnValue({ where: selectWhereFn });
  const selectFn = vi.fn().mockReturnValue({ from: selectFromFn });

  // update chain for sibling deactivation (no .returning())
  const deactivateWhereFn = vi.fn().mockResolvedValue({ rowCount: 1 });
  const deactivateSetFn = vi.fn().mockReturnValue({ where: deactivateWhereFn });

  // update chain for target row update (.returning())
  const updateReturningFn = vi.fn().mockResolvedValue(updatedRows);
  const updateWhereFn = vi.fn().mockReturnValue({ returning: updateReturningFn });
  const updateSetFn = vi.fn().mockReturnValue({ where: updateWhereFn });

  // The tx.update() is called twice: once for deactivation, once for the target update.
  // We use mockReturnValueOnce to differentiate the two calls.
  const updateFn = vi
    .fn()
    .mockReturnValueOnce({ set: deactivateSetFn }) // call 1: deactivate siblings
    .mockReturnValueOnce({ set: updateSetFn }); // call 2: update target

  const { insertFn, auditValuesFn } = makeAuditInsert();

  const tx = {
    select: selectFn,
    update: updateFn,
    insert: insertFn,
  };

  const transactionFn = vi.fn().mockImplementation((cb: (tx: unknown) => Promise<unknown>) => {
    return cb(tx);
  });

  return { transaction: transactionFn, _tx: tx, _audit: auditValuesFn };
}

/**
 * Build a transaction mock that throws.
 */
function makeTransactionMockThrowing(err: Error) {
  const transactionFn = vi.fn().mockRejectedValue(err);
  return { transaction: transactionFn };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePutRequest(
  id: string,
  body: unknown,
  opts: { bearer?: string | undefined } = { bearer: STAFF_JWT },
): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.bearer !== undefined) {
    headers.Authorization = `Bearer ${opts.bearer}`;
  }
  return new NextRequest(`http://localhost/api/admin/intent/config/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── PUT tests — auth ─────────────────────────────────────────────────────────

describe('PUT /api/admin/intent/config/[id] — auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockIsStaffClaims.mockReturnValue(false);
  });

  it('AC3.3: returns 401 when no Authorization header', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const res = await PUT(
      makePutRequest(ROW_ID, { is_active: false }, { bearer: undefined }),
      makeParams(ROW_ID),
    );
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('AC3.4: returns 403 when JWT is agency-tenant (not staff)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:owner' as const,
      estalara_staff: false as const,
      mfa_verified: true,
    });

    const res = await PUT(
      makePutRequest(ROW_ID, { is_active: false }, { bearer: 'agency-jwt-token' }),
      makeParams(ROW_ID),
    );
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });
});

describe('PUT /api/admin/intent/config/[id] — FOLLOW-1321 rank gate', () => {
  const updatedRow = {
    id: ROW_ID,
    tenantId: null,
    isActive: true,
    weights: { behavioral_damping: 0.3 },
    createdAt: CREATED_AT,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockGetAuthClaims.mockResolvedValue(null);
    mockIsStaffClaims.mockReturnValue(false);
  });

  it('RANK-1: ADMIN_API_SECRET Bearer → 403 (read-only), no DB write', async () => {
    const res = await PUT(
      makePutRequest(ROW_ID, { weights: {} }, { bearer: ADMIN_SECRET }),
      makeParams(ROW_ID),
    );
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('RANK-2: estalara:readonly staff JWT → 403, no DB write', async () => {
    asStaff(READONLY_CLAIMS);
    const res = await PUT(makePutRequest(ROW_ID, { weights: {} }), makeParams(ROW_ID));
    expect(res.status).toBe(403);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('RANK-3: estalara:ops staff JWT → 200 + one staff_audit_log row in the same tx', async () => {
    asStaff(OPS_CLAIMS);
    const updateMock = makeUpdateMock([updatedRow]);
    mockCreateAdminClient.mockReturnValue(updateMock);

    const weights = { behavioral_damping: 0.3 };
    const req = makePutRequest(ROW_ID, { weights });
    req.headers.set('x-real-ip', '198.51.100.4');
    req.headers.set('user-agent', 'vitest-agent');
    const res = await PUT(req, makeParams(ROW_ID));
    expect(res.status).toBe(200);
    expect(updateMock.transaction).toHaveBeenCalledOnce();
    expect(updateMock._audit).toHaveBeenCalledOnce();
    expect(updateMock._audit).toHaveBeenCalledWith({
      adminUserId: OPS_USER_ID,
      action: 'intent_config.update',
      targetTenantId: null,
      payload: { config_id: ROW_ID, weights },
      ipAddress: '198.51.100.4',
      userAgent: 'vitest-agent',
    });
  });

  it('RANK-4: estalara:superadmin staff JWT → 200 (activation path audited too)', async () => {
    asStaff(SUPERADMIN_CLAIMS);
    const { transaction, _audit } = makeActivateTransactionMock({ id: ROW_ID, tenantId: null }, [
      updatedRow,
    ]);
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await PUT(makePutRequest(ROW_ID, { is_active: true }), makeParams(ROW_ID));
    expect(res.status).toBe(200);
    expect(_audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'intent_config.update',
        payload: { config_id: ROW_ID, is_active: true },
      }),
    );
  });

  it('RANK-5: unknown id → 404 and NO audit row', async () => {
    asStaff(OPS_CLAIMS);
    const updateMock = makeUpdateMock([]);
    mockCreateAdminClient.mockReturnValue(updateMock);

    const res = await PUT(makePutRequest(ROW_ID, { weights: {} }), makeParams(ROW_ID));
    expect(res.status).toBe(404);
    expect(updateMock._audit).not.toHaveBeenCalled();
  });

  it('RANK-6: audit insert fails inside the tx → 500, never a 200 without its audit row', async () => {
    asStaff(OPS_CLAIMS);
    const updateMock = makeUpdateMock([updatedRow]);
    updateMock._audit.mockRejectedValue(new Error('staff_audit_log insert failed'));
    mockCreateAdminClient.mockReturnValue(updateMock);

    const res = await PUT(makePutRequest(ROW_ID, { weights: {} }), makeParams(ROW_ID));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('db_error');
  });
});

// ─── PUT tests — validation ───────────────────────────────────────────────────

describe('PUT /api/admin/intent/config/[id] — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    asStaff(OPS_CLAIMS);
  });

  it('VAL-1: returns 400 when [id] is not a valid UUID', async () => {
    const res = await PUT(
      makePutRequest('not-a-uuid', { is_active: false }),
      makeParams('not-a-uuid'),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC2.3: returns 400 when body is empty (neither weights nor is_active provided)', async () => {
    const res = await PUT(makePutRequest(ROW_ID, {}), makeParams(ROW_ID));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC4.1: returns 400 when weights contains unknown signal key', async () => {
    const res = await PUT(
      makePutRequest(ROW_ID, {
        weights: {
          signal_likelihoods: {
            chat_turn: { yield_hunter: 1.5 }, // old invented key
          },
        },
      }),
      makeParams(ROW_ID),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });
});

// ─── PUT tests — update (AC2) ─────────────────────────────────────────────────

describe('PUT /api/admin/intent/config/[id] — update (AC2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    asStaff(OPS_CLAIMS);
  });

  it('AC2.1: updates weights + returns the updated row (no is_active change — plain update)', async () => {
    const newWeights = { behavioral_damping: 0.25, priors: { yield_hunter: 0.06, neutral: 0.3 } };
    const updatedRow = {
      id: ROW_ID,
      tenantId: TENANT_ID,
      isActive: true,
      weights: newWeights,
      createdAt: CREATED_AT,
    };
    mockCreateAdminClient.mockReturnValue(makeUpdateMock([updatedRow]));

    const res = await PUT(makePutRequest(ROW_ID, { weights: newWeights }), makeParams(ROW_ID));
    expect(res.status).toBe(200);
    const body = await parseBody<{
      id: string;
      tenant_id: string;
      is_active: boolean;
      weights: object;
      created_at: string;
    }>(res);
    expect(body.id).toBe(ROW_ID);
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.is_active).toBe(true);
    expect(body.weights).toEqual(newWeights);
    expect(typeof body.created_at).toBe('string');
  });

  it('AC2.4: updates only is_active=false (no weights field) — no sibling deactivation', async () => {
    const existingWeights = { behavioral_damping: 0.3 };
    const updatedRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: false,
      weights: existingWeights,
      createdAt: CREATED_AT,
    };
    mockCreateAdminClient.mockReturnValue(makeUpdateMock([updatedRow]));

    const res = await PUT(makePutRequest(ROW_ID, { is_active: false }), makeParams(ROW_ID));
    expect(res.status).toBe(200);
    const body = await parseBody<{ is_active: boolean }>(res);
    expect(body.is_active).toBe(false);
  });

  it('AC2.2: returns 404 when no row found with the given id (plain update path)', async () => {
    // Drizzle update returns empty array when WHERE matched no rows.
    mockCreateAdminClient.mockReturnValue(makeUpdateMock([]));

    const res = await PUT(makePutRequest(ROW_ID, { is_active: false }), makeParams(ROW_ID));
    expect(res.status).toBe(404);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('not_found');
  });
});

// ─── PUT tests — Rule K.2 fail-loud ──────────────────────────────────────────

describe('PUT /api/admin/intent/config/[id] — Rule K.2 fail-loud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    asStaff(OPS_CLAIMS);
  });

  it('K2.3: returns 500 when DB is configured but throws (Rule K.2 — no mock fallback)', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockCreateAdminClient.mockReturnValue(
      makeUpdateMockThrowing(new Error('Postgres connection refused')),
    );

    const res = await PUT(makePutRequest(ROW_ID, { is_active: false }), makeParams(ROW_ID));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('db_error');
  });

  it('K2.4: returns 500 when DB is unconfigured (no mock write path for mutations)', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    const res = await PUT(makePutRequest(ROW_ID, { is_active: false }), makeParams(ROW_ID));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('db_unconfigured');
  });
});

// ─── PUT tests — FOLLOW-301 one-active-row invariant ─────────────────────────

describe('PUT /api/admin/intent/config/[id] — FOLLOW-301 one-active-row invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    asStaff(OPS_CLAIMS);
  });

  it('INV-1: PUT {is_active:true} calls transaction() for atomic deactivate-siblings-then-update', async () => {
    const targetRow = { id: ROW_ID, tenantId: TENANT_ID };
    const updatedRow = {
      id: ROW_ID,
      tenantId: TENANT_ID,
      isActive: true,
      weights: { behavioral_damping: 0.3 },
      createdAt: CREATED_AT,
    };
    const { transaction } = makeActivateTransactionMock(targetRow, [updatedRow]);
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await PUT(makePutRequest(ROW_ID, { is_active: true }), makeParams(ROW_ID));
    expect(res.status).toBe(200);
    // Verify the transaction was called (atomic-swap happened).
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('INV-2: PUT {is_active:true} deactivates sibling rows — tx.update() called twice', async () => {
    const targetRow = { id: ROW_ID, tenantId: null }; // global scope
    const updatedRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: true,
      weights: {},
      createdAt: CREATED_AT,
    };
    const { transaction, _tx } = makeActivateTransactionMock(targetRow, [updatedRow]);
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await PUT(makePutRequest(ROW_ID, { is_active: true }), makeParams(ROW_ID));
    expect(res.status).toBe(200);
    // tx.update should be called twice: once to deactivate siblings, once to update target.
    expect(_tx.update).toHaveBeenCalledTimes(2);
  });

  it('INV-3: PUT {is_active:false} — single update (no sibling deactivation), audited tx', async () => {
    const updatedRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: false,
      weights: {},
      createdAt: CREATED_AT,
    };
    const updateMock = makeUpdateMock([updatedRow]);
    mockCreateAdminClient.mockReturnValue(updateMock);

    const res = await PUT(makePutRequest(ROW_ID, { is_active: false }), makeParams(ROW_ID));
    expect(res.status).toBe(200);
    // FOLLOW-1321 supersedes "no transaction": one update (no deactivation step), in the
    // tx that also carries the staff audit row (ADR-0018 §3a).
    expect(updateMock.update).toHaveBeenCalledOnce();
    expect(updateMock.transaction).toHaveBeenCalledOnce();
    expect(updateMock._audit).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: OPS_USER_ID,
        action: 'intent_config.update',
        payload: { config_id: ROW_ID, is_active: false },
      }),
    );
  });

  it('INV-4: PUT residual 23505 unique violation (race) maps to 409 active_config_exists', async () => {
    const pgUniqueError = Object.assign(new Error('unique violation'), { code: '23505' });
    const { transaction } = makeTransactionMockThrowing(pgUniqueError);
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await PUT(makePutRequest(ROW_ID, { is_active: true }), makeParams(ROW_ID));
    expect(res.status).toBe(409);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('active_config_exists');
    expect(body.error.code).not.toBe('db_error');
  });

  it('INV-5: PUT FK violation 23503 maps to 400 unknown_tenant (not 500)', async () => {
    const pgFkError = Object.assign(new Error('foreign key violation'), { code: '23503' });
    const { transaction } = makeTransactionMockThrowing(pgFkError);
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await PUT(makePutRequest(ROW_ID, { is_active: true }), makeParams(ROW_ID));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unknown_tenant');
    expect(body.error.code).not.toBe('db_error');
  });

  it('INV-6: PUT {is_active:true} returns 404 when target row not found in transaction', async () => {
    // The transaction fetches the target row first; if not found, returns [] → 404.
    const { transaction } = makeActivateTransactionMock(null, []);
    mockCreateAdminClient.mockReturnValue({ transaction });

    const res = await PUT(makePutRequest(ROW_ID, { is_active: true }), makeParams(ROW_ID));
    expect(res.status).toBe(404);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('not_found');
  });
});
