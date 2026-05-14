/**
 * Tests for PATCH + DELETE /api/tenants/:id/answers/:answerId
 *
 * All DB and OpenAI calls are mocked.
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, _tag: 'eq' })),
  and: vi.fn((...args: unknown[]) => ({ args, _tag: 'and' })),
}));

import { createAdminClient } from '@estalara/db';
import { getAuthClaims } from '@estalara/auth';

const { PATCH, DELETE } = await import('./route');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const ANSWER_ID = 'answer-uuid-001';

const MOCK_CLAIMS_A = {
  sub: 'user-a',
  email: 'a@test.com',
  tenant_id: TENANT_A,
  agency_role: 'agency:viewer' as const,
  estalara_staff: false as const,
  mfa_verified: true,
};

const MOCK_CLAIMS_B = {
  sub: 'user-b',
  email: 'b@test.com',
  tenant_id: TENANT_B,
  agency_role: 'agency:viewer' as const,
  estalara_staff: false as const,
  mfa_verified: true,
};

const EXISTING_ROW = {
  id: ANSWER_ID,
  question: 'Original question',
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
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({}) as unknown as ReturnType<typeof createAdminClient>,
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
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({
        existingRows: [{ id: ANSWER_ID, question: 'Same question text' }],
        updateResult: [
          {
            id: ANSWER_ID,
            tenantId: TENANT_A,
            listingId: 'listing-001',
            question: 'Same question text',
            answer: 'New answer only',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }) as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makePatchRequest(TENANT_A, ANSWER_ID, { answer: 'New answer only' });

    const res = await PATCH(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(200);
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  it('does NOT call embedText when question text is unchanged', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({
        existingRows: [{ id: ANSWER_ID, question: 'Same exact question' }],
      }) as unknown as ReturnType<typeof createAdminClient>,
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
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({ existingRows: [] }) as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makePatchRequest(TENANT_A, ANSWER_ID, { answer: 'new answer' });

    const res = await PATCH(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 403 when tenant B tries to update tenant A answer', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_B);

    const req = makePatchRequest(TENANT_A, ANSWER_ID, { answer: 'hacked' });

    const res = await PATCH(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(403);
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  it('returns 401 when no auth token', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(null);

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
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({}) as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeDeleteRequest(TENANT_A, ANSWER_ID);
    const res = await DELETE(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(204);
  });

  it('returns 404 when answer not found', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({ deleteResult: [] }) as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeDeleteRequest(TENANT_A, ANSWER_ID);
    const res = await DELETE(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 403 when tenant B tries to delete tenant A answer', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_B);

    const req = makeDeleteRequest(TENANT_A, ANSWER_ID);
    const res = await DELETE(req, {
      params: Promise.resolve({ id: TENANT_A, answerId: ANSWER_ID }),
    });
    expect(res.status).toBe(403);
  });
});
