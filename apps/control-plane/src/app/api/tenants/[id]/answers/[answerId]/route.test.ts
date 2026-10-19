/**
 * Tests for PATCH + DELETE /api/tenants/:id/answers/:answerId
 *
 * All DB and OpenAI calls are mocked.
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SessionAuthModule from '@/lib/session-auth';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// vi.mock factories are hoisted to top of file — use vi.hoisted() to share state.
const mockEmbedText = vi.hoisted(() => vi.fn());

vi.mock('@/lib/openai-client', () => ({
  embedText: mockEmbedText,
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  tenants: {},
  staffAuditLog: { _tag: 'staff_audit_log' },
  answers: {
    id: 'id',
    tenantId: 'tenant_id',
    listingId: 'listing_id',
    question: 'question',
    answer: 'answer',
    questionEmbedding: 'question_embedding',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
}));

// Auth (ADR-0018 §2, FOLLOW-1334; staff-only since FOLLOW-1335): the routes delegate staff resolution to
// `resolveTenantAccess` (via `lib/answers-access.ts`), whose own wiring is exercised by
// `src/lib/__tests__/resolve-tenant-access.test.ts`. Only `resolveTenantAccess` is a spy here;
// `AccessError` stays real so the legacy `{ error }` mapping runs for real.
vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

const mockCaptureException = vi.hoisted(() => vi.fn());

vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  captureMessage: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, _tag: 'eq' })),
  and: vi.fn((...args: unknown[]) => ({ args, _tag: 'and' })),
}));

import { createAdminClient, staffAuditLog } from '@estalara/db';
import { eq } from 'drizzle-orm';
import { resolveTenantAccess, AccessError, type TenantAccess } from '@/lib/session-auth';

const mockResolve = vi.mocked(resolveTenantAccess);

const { PATCH, DELETE } = await import('./route');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const ANSWER_ID = '33333333-3333-4333-8333-333333333333';
const FOREIGN_ANSWER_ID = '44444444-4444-4444-8444-444444444444';

/** A resolved Estalara-staff access acting on an explicit, validated tenant. */
function staffAccess(tenantId: string, canWrite = true): TenantAccess {
  const role = canWrite ? 'estalara:ops' : 'estalara:readonly';
  return {
    via: 'staff',
    tenantId,
    staff: {
      sub: 'staff-uuid',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: role,
      mfa_verified: true,
    },
    role,
    canWrite,
    isSuperadmin: false,
  };
}

const FORBIDDEN_403 = new AccessError(403, 'Unauthorized: no tenant access for this request');

const EXISTING_ROW = {
  id: ANSWER_ID,
  listingId: 'listing-001',
  question: 'Original question',
  answer: 'Original answer',
};

const UPDATED_ROW = {
  id: ANSWER_ID,
  tenantId: TENANT_A,
  listingId: 'listing-001',
  question: 'Updated question',
  answer: 'Updated answer',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// DB mock builder
// ---------------------------------------------------------------------------

function makeDbMock(opts: {
  existingRows?: unknown[];
  updateResult?: unknown[];
  deleteResult?: unknown[];
}) {
  // Chain: .select({...}).from(table).where(cond).limit(n) → Promise<row[]>
  const selectLimit = vi.fn().mockResolvedValue(opts.existingRows ?? [EXISTING_ROW]);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectCall = vi.fn().mockReturnValue({ from: selectFrom });

  // Chain: .update(table).set({...}).where(cond).returning({...}) → Promise<row[]>
  const updateReturning = vi.fn().mockResolvedValue(opts.updateResult ?? [UPDATED_ROW]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateCall = vi.fn().mockReturnValue({ set: updateSet });

  // Chain: .delete(table).where(cond).returning({...}) → Promise<row[]>
  const deleteReturning = vi.fn().mockResolvedValue(opts.deleteResult ?? [{ id: ANSWER_ID }]);
  const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
  const deleteCall = vi.fn().mockReturnValue({ where: deleteWhere });

  return { select: selectCall, update: updateCall, delete: deleteCall };
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function makePatchRequest(tenantId: string, answerId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/tenants/${tenantId}/answers/${answerId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(tenantId: string, answerId: string): NextRequest {
  return new NextRequest(`http://localhost/api/tenants/${tenantId}/answers/${answerId}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer test-token' },
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ---------------------------------------------------------------------------
// PATCH tests
// ---------------------------------------------------------------------------

const MOCK_EMBEDDING = Array.from({ length: 1536 }, () => 0.2);

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbedText.mockResolvedValue(MOCK_EMBEDDING);
});

describe('PATCH /api/tenants/:id/answers/:answerId', () => {
  it('returns 200 with updated row when both question and answer change', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    vi.mocked(createAdminClient).mockReturnValue(
      makeStaffDb().db as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makePatchRequest(TENANT_A, ANSWER_ID, {
      question: 'Updated question',
      answer: 'Updated answer',
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(200);

    const body = await parseBody<{ id: string; question: string }>(res);
    expect(body.id).toBe(ANSWER_ID);
    // question changed → re-embed
    expect(mockEmbedText).toHaveBeenCalledWith('Updated question');
  });

  it('does NOT call embedText when only answer changes', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    vi.mocked(createAdminClient).mockReturnValue(
      makeStaffDb({
        outerRows: [{ id: ANSWER_ID, question: 'Same question text' }],
        lockedRows: [{ ...EXISTING_ROW, question: 'Same question text' }],
      }).db as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makePatchRequest(TENANT_A, ANSWER_ID, { answer: 'New answer only' });

    const res = await PATCH(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(200);
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  it('does NOT call embedText when question text is unchanged', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    vi.mocked(createAdminClient).mockReturnValue(
      makeStaffDb({
        outerRows: [{ id: ANSWER_ID, question: 'Same exact question' }],
        lockedRows: [{ ...EXISTING_ROW, question: 'Same exact question' }],
      }).db as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makePatchRequest(TENANT_A, ANSWER_ID, {
      question: 'Same exact question',
      answer: 'Different answer',
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(200);
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  it('returns 404 when answer not found for this tenant', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    vi.mocked(createAdminClient).mockReturnValue(
      makeStaffDb({ outerRows: [] }).db as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makePatchRequest(TENANT_A, ANSWER_ID, { answer: 'new answer' });

    const res = await PATCH(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 403 when resolveTenantAccess refuses (mapped to the legacy { error } body)', async () => {
    mockResolve.mockRejectedValue(FORBIDDEN_403);

    const req = makePatchRequest(TENANT_A, ANSWER_ID, { answer: 'hacked' });

    const res = await PATCH(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(403);
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  it('returns 401 when no auth token', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized: no tenant access'));

    const req = makePatchRequest(TENANT_A, ANSWER_ID, { answer: 'test' });

    const res = await PATCH(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE tests
// ---------------------------------------------------------------------------

describe('DELETE /api/tenants/:id/answers/:answerId', () => {
  it('returns 204 on successful delete', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    vi.mocked(createAdminClient).mockReturnValue(
      makeStaffDb().db as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeDeleteRequest(TENANT_A, ANSWER_ID);
    const res = await DELETE(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(204);
  });

  it('returns 404 when answer not found', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    vi.mocked(createAdminClient).mockReturnValue(
      makeStaffDb({ deleteResult: [] }).db as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeDeleteRequest(TENANT_A, ANSWER_ID);
    const res = await DELETE(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 403 when resolveTenantAccess refuses', async () => {
    mockResolve.mockRejectedValue(FORBIDDEN_403);

    const req = makeDeleteRequest(TENANT_A, ANSWER_ID);
    const res = await DELETE(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Staff override (ADR-0018, FOLLOW-1334)
// ---------------------------------------------------------------------------

/** A db whose `transaction` hands the callback a tx with update/delete + audit insert spies. */
function makeStaffDb(
  opts: {
    auditFails?: boolean;
    deleteResult?: unknown[];
    lockedRows?: unknown[];
    outerRows?: unknown[];
  } = {},
) {
  const base = makeDbMock(opts.outerRows === undefined ? {} : { existingRows: opts.outerRows });
  const auditValues = vi
    .fn()
    .mockImplementation(() =>
      opts.auditFails ? Promise.reject(new Error('audit down')) : Promise.resolve(),
    );
  const txInsert = vi.fn().mockImplementation((table: unknown) => {
    if (table !== staffAuditLog) throw new Error('only the audit row is inserted');
    return { values: auditValues };
  });
  const txUpdateReturning = vi.fn().mockResolvedValue([UPDATED_ROW]);
  const txUpdate = vi.fn().mockReturnValue({
    set: vi
      .fn()
      .mockReturnValue({ where: vi.fn().mockReturnValue({ returning: txUpdateReturning }) }),
  });
  const txDeleteReturning = vi.fn().mockResolvedValue(opts.deleteResult ?? [{ ...EXISTING_ROW }]);
  const txDelete = vi
    .fn()
    .mockReturnValue({ where: vi.fn().mockReturnValue({ returning: txDeleteReturning }) });
  // tx.select().from().where().limit().for('update') -> the locked re-read of `before`.
  const txFor = vi.fn().mockResolvedValue(opts.lockedRows ?? [EXISTING_ROW]);
  const txSelect = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ for: txFor }) }),
    }),
  });
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ insert: txInsert, update: txUpdate, delete: txDelete, select: txSelect }),
  );
  return { db: { ...base, transaction }, auditValues, txUpdate, txDelete, txFor };
}

describe('PATCH /api/tenants/:id/answers/:answerId — staff override', () => {
  it('staff ops → 200; update + audit (before/after) share ONE transaction, outer update unused', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const { db, auditValues, txUpdate } = makeStaffDb();
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await PATCH(makePatchRequest(TENANT_A, ANSWER_ID, { answer: 'Updated answer' }), {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });

    expect(res.status).toBe(200);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(txUpdate).toHaveBeenCalledOnce();
    expect(db.update).not.toHaveBeenCalled();
    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 'staff-uuid',
        action: 'listing_answer.update',
        targetTenantId: TENANT_A,
        payload: expect.objectContaining({
          answer_id: ANSWER_ID,
          before: { question: 'Original question', answer: 'Original answer' },
          after: { question: 'Updated question', answer: 'Updated answer' },
        }),
      }),
    );
  });

  it('staff readonly → 403 before any read, embedding or write', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, false));
    const { db } = makeStaffDb();
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await PATCH(makePatchRequest(TENANT_A, ANSWER_ID, { question: 'x' }), {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });

    expect(res.status).toBe(403);
    expect(mockEmbedText).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('staff + unknown tenant → 404', async () => {
    mockResolve.mockRejectedValue(new AccessError(404, 'Unknown tenant'));

    const res = await PATCH(makePatchRequest(TENANT_A, ANSWER_ID, { answer: 'x' }), {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });

    expect(res.status).toBe(404);
  });

  it('audit insert fails → 500 audit_write_failed + Sentry, never a 200 (K.2)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const { db } = makeStaffDb({ auditFails: true });
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await PATCH(makePatchRequest(TENANT_A, ANSWER_ID, { answer: 'x' }), {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });

    expect(res.status).toBe(500);
    expect((await parseBody<{ code: string }>(res)).code).toBe('audit_write_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });
});

describe('DELETE /api/tenants/:id/answers/:answerId — staff override', () => {
  it('staff ops → 204; delete + audit (keeps the deleted text) share ONE transaction', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const { db, auditValues, txDelete } = makeStaffDb();
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await DELETE(makeDeleteRequest(TENANT_A, ANSWER_ID), {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });

    expect(res.status).toBe(204);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(txDelete).toHaveBeenCalledOnce();
    expect(db.delete).not.toHaveBeenCalled();
    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'listing_answer.delete',
        targetTenantId: TENANT_A,
        payload: expect.objectContaining({
          answer_id: ANSWER_ID,
          question: 'Original question',
          answer: 'Original answer',
        }),
      }),
    );
  });

  it('staff readonly → 403, nothing deleted', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, false));
    const { db } = makeStaffDb();
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await DELETE(makeDeleteRequest(TENANT_A, ANSWER_ID), {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });

    expect(res.status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('staff + nothing matched → 404 and NO audit row', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const { db, auditValues } = makeStaffDb({ deleteResult: [] });
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await DELETE(makeDeleteRequest(TENANT_A, ANSWER_ID), {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });

    expect(res.status).toBe(404);
    expect(auditValues).not.toHaveBeenCalled();
  });

  it('audit insert fails → 500 audit_write_failed + Sentry (K.2)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const { db } = makeStaffDb({ auditFails: true });
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await DELETE(makeDeleteRequest(TENANT_A, ANSWER_ID), {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });

    expect(res.status).toBe(500);
    expect((await parseBody<{ code: string }>(res)).code).toBe('audit_write_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Security review follow-ups (FOLLOW-1334: RC-1, locked `before`, cross-tenant answer id)
// ---------------------------------------------------------------------------

describe('malformed answer id (RC-1)', () => {
  for (const bad of ['answer-uuid-001', '123', 'not-a-uuid', "1'; DROP TABLE answers;--"]) {
    it(`staff PATCH ${JSON.stringify(bad)} -> 404, no query, no transaction, no Sentry`, async () => {
      mockResolve.mockResolvedValue(staffAccess(TENANT_A));
      const { db } = makeStaffDb();
      vi.mocked(createAdminClient).mockReturnValue(
        db as unknown as ReturnType<typeof createAdminClient>,
      );

      const res = await PATCH(makePatchRequest(TENANT_A, bad, { answer: 'x' }), {
        params: Promise.resolve({ id: TENANT_A, answerId: bad }),
      });

      expect(res.status).toBe(404);
      expect(db.select).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
      expect(mockEmbedText).not.toHaveBeenCalled();
      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it(`staff DELETE ${JSON.stringify(bad)} -> 404, no transaction, no audit_write_failed, no Sentry`, async () => {
      mockResolve.mockResolvedValue(staffAccess(TENANT_A));
      const { db, auditValues } = makeStaffDb();
      vi.mocked(createAdminClient).mockReturnValue(
        db as unknown as ReturnType<typeof createAdminClient>,
      );

      const res = await DELETE(makeDeleteRequest(TENANT_A, bad), {
        params: Promise.resolve({ id: TENANT_A, answerId: bad }),
      });

      expect(res.status).toBe(404);
      expect(await parseBody<{ error: string }>(res)).toEqual({ error: 'Answer not found' });
      expect(db.transaction).not.toHaveBeenCalled();
      expect(auditValues).not.toHaveBeenCalled();
      expect(mockCaptureException).not.toHaveBeenCalled();
    });
  }
});

describe('staff PATCH — audited `before` is read under a row lock', () => {
  it('re-reads the row inside the transaction with FOR UPDATE and audits THAT as `before`', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const { db, auditValues, txFor } = makeStaffDb({
      // A concurrent edit landed after the unlocked pre-read: the locked row is the truth.
      lockedRows: [
        { listingId: 'listing-001', question: 'Original question', answer: 'Edited by B' },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await PATCH(makePatchRequest(TENANT_A, ANSWER_ID, { answer: 'Updated answer' }), {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });

    expect(res.status).toBe(200);
    expect(txFor).toHaveBeenCalledWith('update');
    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          before: { question: 'Original question', answer: 'Edited by B' },
        }),
      }),
    );
  });

  it('a row deleted between the pre-read and the lock -> 404, no update, no audit row, no Sentry', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const { db, auditValues, txUpdate } = makeStaffDb({ lockedRows: [] });
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await PATCH(makePatchRequest(TENANT_A, ANSWER_ID, { answer: 'x' }), {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });

    expect(res.status).toBe(404);
    expect(txUpdate).not.toHaveBeenCalled();
    expect(auditValues).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('the question changed under us after the embedding was skipped -> 409, nothing written', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    // Unlocked pre-read says the question already equals the new one (no embedding computed) ...
    const { db, auditValues, txUpdate } = makeStaffDb({
      outerRows: [{ id: ANSWER_ID, question: 'Q-new' }],
      // ... but by the time the lock is taken another editor had changed it.
      lockedRows: [{ listingId: 'listing-001', question: 'Q-other', answer: 'A' }],
    });
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await PATCH(makePatchRequest(TENANT_A, ANSWER_ID, { question: 'Q-new' }), {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });

    expect(res.status).toBe(409);
    expect(txUpdate).not.toHaveBeenCalled();
    expect(auditValues).not.toHaveBeenCalled();
  });
});

describe('staff + an answer id that belongs to ANOTHER tenant', () => {
  it('PATCH -> 404; nothing locked, written or audited; every lookup is fenced on tenant A', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    // The row exists, but under tenant B: the two-column WHERE matches nothing for tenant A.
    const { db, auditValues, txUpdate } = makeStaffDb({ outerRows: [], lockedRows: [] });
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await PATCH(makePatchRequest(TENANT_A, FOREIGN_ANSWER_ID, { answer: 'x' }), {
      params: Promise.resolve({ id: TENANT_A, answerId: FOREIGN_ANSWER_ID }),
    });

    expect(res.status).toBe(404);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();
    expect(auditValues).not.toHaveBeenCalled();
    expect(mockEmbedText).not.toHaveBeenCalled();
    expect(vi.mocked(eq)).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(vi.mocked(eq)).toHaveBeenCalledWith('id', FOREIGN_ANSWER_ID);
  });

  it('DELETE -> 404; nothing deleted, no audit row, no Sentry; fenced on tenant A', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const { db, auditValues } = makeStaffDb({ deleteResult: [] });
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await DELETE(makeDeleteRequest(TENANT_A, FOREIGN_ANSWER_ID), {
      params: Promise.resolve({ id: TENANT_A, answerId: FOREIGN_ANSWER_ID }),
    });

    expect(res.status).toBe(404);
    expect(auditValues).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(vi.mocked(eq)).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(vi.mocked(eq)).toHaveBeenCalledWith('id', FOREIGN_ANSWER_ID);
  });
});
