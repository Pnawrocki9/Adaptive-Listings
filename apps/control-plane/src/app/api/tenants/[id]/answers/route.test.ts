/**
 * Tests for POST + GET /api/tenants/:id/answers
 *
 * All DB and OpenAI calls are mocked.
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// Dynamic import after mocks
const { POST, GET } = await import('./route');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const LISTING_ID = 'listing-001';

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
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({}) as unknown as ReturnType<typeof createAdminClient>,
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
    vi.mocked(getAuthClaims).mockResolvedValue(null);

    const req = makePostRequest(TENANT_A, {
      listing_id: LISTING_ID,
      question: 'Q?',
      answer: 'A.',
    });

    const res = await POST(req, { params: Promise.resolve({ id: TENANT_A }) });
    expect(res.status).toBe(401);
  });

  it('returns 403 when tenant in JWT does not match URL param', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_B); // tenant B

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
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);

    const req = makePostRequest(TENANT_A, { question: 'Q?', answer: 'A.' });

    const res = await POST(req, { params: Promise.resolve({ id: TENANT_A }) });
    expect(res.status).toBe(400);
  });

  it('returns 503 when embedding call fails', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
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
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
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
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);

    const req = new NextRequest(`http://localhost/api/tenants/${TENANT_A}/answers`, {
      method: 'GET',
      headers: { Authorization: 'Bearer test-token' },
    });

    const res = await GET(req, { params: Promise.resolve({ id: TENANT_A }) });
    expect(res.status).toBe(400);
  });

  it('returns 403 when tenant B tries to access tenant A answers', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_B);

    const req = makeGetRequest(TENANT_A, LISTING_ID); // tenant A's endpoint
    const res = await GET(req, { params: Promise.resolve({ id: TENANT_A }) });
    expect(res.status).toBe(403);
  });
});
