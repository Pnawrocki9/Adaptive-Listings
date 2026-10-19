/**
 * Tests for POST + GET /api/tenants/:id/answers
 *
 * All DB and OpenAI calls are mocked.
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SessionAuthModule from '@/lib/session-auth';

// ---------------------------------------------------------------------------
// Mocks — must be declared before dynamic imports
// ---------------------------------------------------------------------------

// vi.mock factories are hoisted to the top of the file, so we cannot reference
// top-level variables declared below. Use vi.hoisted() to share state safely.
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
import { resolveTenantAccess, AccessError, type TenantAccess } from '@/lib/session-auth';

const mockResolve = vi.mocked(resolveTenantAccess);

// Dynamic import after mocks
const { POST, GET } = await import('./route');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const LISTING_ID = 'listing-001';

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

const MOCK_ANSWER_ROW = {
  id: 'answer-uuid-001',
  tenantId: TENANT_A,
  listingId: LISTING_ID,
  question: 'What is the yield?',
  answer: '6.5%',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// DB mock builders
// ---------------------------------------------------------------------------

function makeDbMock(opts: { insertResult?: unknown[]; selectResult?: unknown[] }) {
  const insertReturning = vi.fn().mockResolvedValue(opts.insertResult ?? [MOCK_ANSWER_ROW]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertCall = vi.fn().mockReturnValue({ values: insertValues });

  const selectResult = opts.selectResult ?? [MOCK_ANSWER_ROW];
  const selectWhere = vi.fn().mockResolvedValue(selectResult);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectCall = vi.fn().mockReturnValue({ from: selectFrom });

  return { insert: insertCall, select: selectCall };
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function makePostRequest(tenantId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/tenants/${tenantId}/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(tenantId: string, listingId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/tenants/${tenantId}/answers?listing_id=${encodeURIComponent(listingId)}`,
    { method: 'GET', headers: { Authorization: 'Bearer test-token' } },
  );
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const MOCK_EMBEDDING = Array.from({ length: 1536 }, () => 0.1);

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbedText.mockResolvedValue(MOCK_EMBEDDING);
});

describe('POST /api/tenants/:id/answers', () => {
  it('returns 201 and created row on valid body', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    vi.mocked(createAdminClient).mockReturnValue(
      makeStaffDb().db as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makePostRequest(TENANT_A, {
      listing_id: LISTING_ID,
      question: 'What is the yield?',
      answer: '6.5%',
    });

    const res = await POST(req, { params: Promise.resolve({ id: TENANT_A }) });
    expect(res.status).toBe(201);

    const body = await parseBody<{ id: string; question: string }>(res);
    expect(body.id).toBe('answer-uuid-001');
    expect(body.question).toBe('What is the yield?');
    expect(mockEmbedText).toHaveBeenCalledWith('What is the yield?');
  });

  it('returns 401 when no auth token', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized: no tenant access'));

    const req = makePostRequest(TENANT_A, {
      listing_id: LISTING_ID,
      question: 'Q?',
      answer: 'A.',
    });

    const res = await POST(req, { params: Promise.resolve({ id: TENANT_A }) });
    expect(res.status).toBe(401);
  });

  it('returns 403 when resolveTenantAccess refuses', async () => {
    mockResolve.mockRejectedValue(FORBIDDEN_403);

    const req = makePostRequest(TENANT_A, {
      // posting to tenant A's endpoint
      listing_id: LISTING_ID,
      question: 'Q?',
      answer: 'A.',
    });

    const res = await POST(req, { params: Promise.resolve({ id: TENANT_A }) });
    expect(res.status).toBe(403);
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid body (missing listing_id)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));

    const req = makePostRequest(TENANT_A, { question: 'Q?', answer: 'A.' });

    const res = await POST(req, { params: Promise.resolve({ id: TENANT_A }) });
    expect(res.status).toBe(400);
  });

  it('returns 503 when embedding call fails', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    mockEmbedText.mockRejectedValueOnce(new Error('OpenAI rate limit'));

    const req = makePostRequest(TENANT_A, {
      listing_id: LISTING_ID,
      question: 'Q?',
      answer: 'A.',
    });

    const res = await POST(req, { params: Promise.resolve({ id: TENANT_A }) });
    expect(res.status).toBe(503);
  });
});

describe('GET /api/tenants/:id/answers', () => {
  it('returns 200 and array of rows (without embedding)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, false));
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({ selectResult: [MOCK_ANSWER_ROW] }) as unknown as ReturnType<
        typeof createAdminClient
      >,
    );

    const req = makeGetRequest(TENANT_A, LISTING_ID);
    const res = await GET(req, { params: Promise.resolve({ id: TENANT_A }) });
    expect(res.status).toBe(200);

    const rows = await parseBody<{ id: string; question: string }[]>(res);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows[0]?.question).toBe('What is the yield?');
    // embedding column must NOT appear in response
    expect(JSON.stringify(rows)).not.toContain('questionEmbedding');
    expect(JSON.stringify(rows)).not.toContain('question_embedding');
  });

  it('returns 400 when listing_id query param is missing', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));

    const req = new NextRequest(`http://localhost/api/tenants/${TENANT_A}/answers`, {
      method: 'GET',
      headers: { Authorization: 'Bearer test-token' },
    });

    const res = await GET(req, { params: Promise.resolve({ id: TENANT_A }) });
    expect(res.status).toBe(400);
  });

  it('returns 403 when resolveTenantAccess refuses (GET)', async () => {
    mockResolve.mockRejectedValue(FORBIDDEN_403);

    const req = makeGetRequest(TENANT_A, LISTING_ID); // tenant A's endpoint
    const res = await GET(req, { params: Promise.resolve({ id: TENANT_A }) });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Staff override (ADR-0018, FOLLOW-1334)
// ---------------------------------------------------------------------------

/** A db whose `transaction` hands the callback a tx with answers + audit insert spies. */
function makeStaffDb(opts: { auditFails?: boolean } = {}) {
  const auditValues = vi
    .fn()
    .mockImplementation(() =>
      opts.auditFails ? Promise.reject(new Error('audit down')) : Promise.resolve(),
    );
  const answerReturning = vi.fn().mockResolvedValue([MOCK_ANSWER_ROW]);
  const answerValues = vi.fn().mockReturnValue({ returning: answerReturning });
  const txInsert = vi
    .fn()
    .mockImplementation((table: unknown) =>
      table === staffAuditLog ? { values: auditValues } : { values: answerValues },
    );
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ insert: txInsert }),
  );
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([MOCK_ANSWER_ROW]) }),
  });
  const outerInsert = vi.fn();
  return {
    db: { transaction, select, insert: outerInsert },
    auditValues,
    answerValues,
    outerInsert,
  };
}

describe('POST /api/tenants/:id/answers — staff override', () => {
  const body = { listing_id: LISTING_ID, question: 'What is the yield?', answer: '6.5%' };

  it('staff ops → 201; the insert and its staff_audit_log row share ONE transaction', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const { db, auditValues, answerValues, outerInsert } = makeStaffDb();
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await POST(makePostRequest(TENANT_A, body), {
      params: Promise.resolve({ id: TENANT_A }),
    });

    expect(res.status).toBe(201);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(outerInsert).not.toHaveBeenCalled();
    expect(answerValues).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A, listingId: LISTING_ID }),
    );
    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 'staff-uuid',
        action: 'listing_answer.create',
        targetTenantId: TENANT_A,
        payload: expect.objectContaining({ listing_id: LISTING_ID, answer: '6.5%' }),
      }),
    );
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStaffOverride: true, tenantId: TENANT_A }),
    );
  });

  it('staff readonly → 403 before any embedding call or write', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, false));
    const { db } = makeStaffDb();
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await POST(makePostRequest(TENANT_A, body), {
      params: Promise.resolve({ id: TENANT_A }),
    });

    expect(res.status).toBe(403);
    expect(mockEmbedText).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('staff + unknown tenant → 404 (resolve throws AccessError(404))', async () => {
    mockResolve.mockRejectedValue(new AccessError(404, 'Unknown tenant'));

    const res = await POST(makePostRequest(TENANT_A, body), {
      params: Promise.resolve({ id: TENANT_A }),
    });

    expect(res.status).toBe(404);
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  it('audit insert fails → 500 audit_write_failed, Sentry capture, nothing returned as created (K.2)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const { db } = makeStaffDb({ auditFails: true });
    // A real transaction rolls the answer insert back when the audit insert throws; the route must
    // surface that as an error, never a 201.
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await POST(makePostRequest(TENANT_A, body), {
      params: Promise.resolve({ id: TENANT_A }),
    });

    expect(res.status).toBe(500);
    const json = await parseBody<{ code: string }>(res);
    expect(json.code).toBe('audit_write_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });
});

describe('GET /api/tenants/:id/answers — staff override', () => {
  it('staff readonly may read → 200 fenced to the path tenant', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, false));
    const { db } = makeStaffDb();
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await GET(makeGetRequest(TENANT_A, LISTING_ID), {
      params: Promise.resolve({ id: TENANT_A }),
    });

    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStaffOverride: true, tenantId: TENANT_A }),
    );
  });

  it('no session → 401 with the legacy { error } body', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized: no tenant access'));

    const res = await GET(makeGetRequest(TENANT_A, LISTING_ID), {
      params: Promise.resolve({ id: TENANT_A }),
    });

    expect(res.status).toBe(401);
    expect(await parseBody<{ error: string }>(res)).toEqual({ error: 'Unauthorized' });
  });
});
