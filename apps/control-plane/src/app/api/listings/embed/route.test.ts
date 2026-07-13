/**
 * Tests for POST /api/listings/embed (FOLLOW-019).
 *
 * Covers:
 *   - 401 / 403 auth paths (no JWT, mismatched tenant)
 *   - INTERNAL_API_SECRET service-to-service path
 *   - 400 validation (missing fields, empty text_fields)
 *   - 503 when OPENAI_API_KEY missing
 *   - 503 when OpenAI call fails
 *   - 200 happy path → upsert called
 *   - DB upsert failure → 500
 *
 * All DB and OpenAI calls are mocked.
 */

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockEmbedTextWithDimensions = vi.hoisted(() => vi.fn());

vi.mock('@/lib/openai-client', () => ({
  embedTextWithDimensions: mockEmbedTextWithDimensions,
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  listingEmbeddings: {
    tenantId: 'tenant_id',
    listingId: 'listing_id',
    embedding: 'embedding',
    updatedAt: 'updated_at',
  },
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
}));

// FOLLOW-567: the route self-fetches listing text when text_fields is absent.
const mockFetchListingTextFields = vi.hoisted(() => vi.fn());
vi.mock('@/lib/listing-details', () => ({
  fetchListingTextFields: mockFetchListingTextFields,
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn(() => 'sql-tag'),
}));

import { createAdminClient } from '@estalara/db';
import { getAuthClaims } from '@estalara/auth';

// Dynamic import after mocks.
const { POST } = await import('./route');

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const LISTING_ID = 'listing-abc';

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

const MOCK_EMBEDDING_1024 = Array.from({ length: 1024 }, () => 0.01);
const VALID_BODY = {
  tenant_id: TENANT_A,
  listing_id: LISTING_ID,
  text_fields: {
    title: '3-bed apartment in central Madrid',
    description: 'Sunny apartment with terrace and parking',
    price: '€450,000',
    location: 'Madrid, Salamanca',
  },
};

// ─── DB mock helpers ──────────────────────────────────────────────────────────

function makeDbMock(opts: { upsertResult?: unknown; throws?: boolean } = {}) {
  const onConflictDoUpdate = vi.fn().mockImplementation(() => {
    if (opts.throws) return Promise.reject(new Error('DB connection refused'));
    return Promise.resolve(opts.upsertResult ?? []);
  });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, _spies: { insert, values, onConflictDoUpdate } };
}

// ─── Request helpers ──────────────────────────────────────────────────────────

function makeRequest(opts: {
  body?: unknown;
  authHeader?: string | null;
  internalSecret?: string | null;
}): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.authHeader !== null && opts.authHeader !== undefined) {
    headers.Authorization = opts.authHeader;
  }
  if (opts.internalSecret !== null && opts.internalSecret !== undefined) {
    headers['x-internal-api-secret'] = opts.internalSecret;
  }
  // NextRequest expects its own RequestInit shape — keep init narrow so
  // exactOptionalPropertyTypes is satisfied (body is omitted, never undefined).
  if (opts.body === undefined) {
    return new NextRequest('http://localhost/api/listings/embed', { method: 'POST', headers });
  }
  return new NextRequest('http://localhost/api/listings/embed', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body),
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_INTERNAL_SECRET = process.env.INTERNAL_API_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbedTextWithDimensions.mockResolvedValue(MOCK_EMBEDDING_1024);
  process.env.OPENAI_API_KEY = 'sk-test-dummy';
  delete process.env.INTERNAL_API_SECRET;
});

afterEach(() => {
  if (ORIGINAL_OPENAI_KEY === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
  }
  if (ORIGINAL_INTERNAL_SECRET === undefined) {
    delete process.env.INTERNAL_API_SECRET;
  } else {
    process.env.INTERNAL_API_SECRET = ORIGINAL_INTERNAL_SECRET;
  }
});

describe('POST /api/listings/embed — happy path', () => {
  it('returns 200 + upserts listing_embeddings with the OpenAI vector', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    const dbMock = makeDbMock();
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeRequest({ body: VALID_BODY, authHeader: 'Bearer test-token' });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await parseBody<{ ok: boolean; listing_id: string }>(res);
    expect(body.ok).toBe(true);
    expect(body.listing_id).toBe(LISTING_ID);

    // Embedding was computed at 1024 dims with concatenated text.
    expect(mockEmbedTextWithDimensions).toHaveBeenCalledTimes(1);
    const [embedInput, embedDims] = mockEmbedTextWithDimensions.mock.calls[0] ?? [];
    expect(embedInput).toContain('3-bed apartment in central Madrid');
    expect(embedInput).toContain('Madrid, Salamanca');
    expect(embedDims).toBe(1024);

    // Insert pipeline was called → values → onConflictDoUpdate.
    expect(dbMock._spies.insert).toHaveBeenCalledTimes(1);
    expect(dbMock._spies.values).toHaveBeenCalledTimes(1);
    expect(dbMock._spies.onConflictDoUpdate).toHaveBeenCalledTimes(1);

    // Verify the values payload shape (tenantId/listingId/embedding).
    const valuesArg = dbMock._spies.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesArg.tenantId).toBe(TENANT_A);
    expect(valuesArg.listingId).toBe(LISTING_ID);
    expect(Array.isArray(valuesArg.embedding)).toBe(true);
    expect((valuesArg.embedding as number[]).length).toBe(1024);
  });

  it('accepts INTERNAL_API_SECRET header in place of JWT', async () => {
    process.env.INTERNAL_API_SECRET = 'internal-secret-token';
    // getAuthClaims should NOT be called when INTERNAL_API_SECRET path succeeds.
    vi.mocked(getAuthClaims).mockResolvedValue(null);
    const dbMock = makeDbMock();
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeRequest({
      body: VALID_BODY,
      authHeader: null,
      internalSecret: 'internal-secret-token',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('accepts a body with only one text field populated', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    const dbMock = makeDbMock();
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeRequest({
      body: {
        tenant_id: TENANT_A,
        listing_id: LISTING_ID,
        text_fields: { title: 'A property' },
      },
      authHeader: 'Bearer test-token',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/listings/embed — auth', () => {
  it('returns 401 when no JWT and no INTERNAL_API_SECRET', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(null);

    const req = makeRequest({ body: VALID_BODY, authHeader: null });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockEmbedTextWithDimensions).not.toHaveBeenCalled();
  });

  it('returns 403 when JWT tenant_id does not match body tenant_id', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_B);

    const req = makeRequest({ body: VALID_BODY, authHeader: 'Bearer test-token' });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mockEmbedTextWithDimensions).not.toHaveBeenCalled();
  });

  it('rejects an incorrect INTERNAL_API_SECRET (falls through to JWT check → 401)', async () => {
    process.env.INTERNAL_API_SECRET = 'real-secret';
    vi.mocked(getAuthClaims).mockResolvedValue(null);

    const req = makeRequest({
      body: VALID_BODY,
      authHeader: null,
      internalSecret: 'wrong-secret',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/listings/embed — validation', () => {
  it('returns 400 when JSON body is invalid', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    const req = new NextRequest('http://localhost/api/listings/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: '{not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when tenant_id is missing', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    const req = makeRequest({
      body: { listing_id: LISTING_ID, text_fields: { title: 'x' } },
      authHeader: 'Bearer test-token',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when text_fields are all empty', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    const req = makeRequest({
      body: { tenant_id: TENANT_A, listing_id: LISTING_ID, text_fields: {} },
      authHeader: 'Bearer test-token',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/listings/embed — OpenAI / DB failure paths', () => {
  it('returns 503 when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY;
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);

    const req = makeRequest({ body: VALID_BODY, authHeader: 'Bearer test-token' });
    const res = await POST(req);
    expect(res.status).toBe(503);
    expect(mockEmbedTextWithDimensions).not.toHaveBeenCalled();
  });

  it('returns 503 when OpenAI call throws', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    mockEmbedTextWithDimensions.mockRejectedValueOnce(new Error('rate limit'));

    const req = makeRequest({ body: VALID_BODY, authHeader: 'Bearer test-token' });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it('returns 503 when OpenAI returns wrong dimensionality', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    mockEmbedTextWithDimensions.mockResolvedValueOnce(Array.from({ length: 1536 }, () => 0.01));

    const req = makeRequest({ body: VALID_BODY, authHeader: 'Bearer test-token' });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it('returns 500 when DB upsert throws', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    const dbMock = makeDbMock({ throws: true });
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeRequest({ body: VALID_BODY, authHeader: 'Bearer test-token' });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/listings/embed — FOLLOW-567 self-fetch when text_fields absent', () => {
  it('Modal-shaped POST (tenant_id+listing_id, no text_fields) self-fetches → 200 + upsert', async () => {
    process.env.INTERNAL_API_SECRET = 'internal-secret-token';
    mockFetchListingTextFields.mockResolvedValue({
      title: '2-bed Lisbon apartment',
      description: 'Tenant in place, sound energy performance',
      price: '320000 EUR',
      location: 'Alvalade, Lisbon',
    });
    const dbMock = makeDbMock();
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    // Exactly what the Modal embed-seed consumer sends: no text_fields.
    const req = makeRequest({
      body: { tenant_id: TENANT_A, listing_id: LISTING_ID },
      internalSecret: 'internal-secret-token',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Self-fetch invoked for this listing (Modal omits locale → default 'en').
    expect(mockFetchListingTextFields).toHaveBeenCalledWith(LISTING_ID, 'en');
    // Fetched text was concatenated into the embedding input.
    const [embedInput] = mockEmbedTextWithDimensions.mock.calls[0] ?? [];
    expect(embedInput).toContain('2-bed Lisbon apartment');
    expect(embedInput).toContain('Alvalade, Lisbon');
    // Upsert happened.
    expect(dbMock._spies.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('no text_fields AND backend fetch returns null → 400, does not embed or upsert', async () => {
    process.env.INTERNAL_API_SECRET = 'internal-secret-token';
    mockFetchListingTextFields.mockResolvedValue(null);
    const dbMock = makeDbMock();
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeRequest({
      body: { tenant_id: TENANT_A, listing_id: LISTING_ID },
      internalSecret: 'internal-secret-token',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockEmbedTextWithDimensions).not.toHaveBeenCalled();
    expect(dbMock._spies.onConflictDoUpdate).not.toHaveBeenCalled();
  });

  it('explicit text_fields present → does NOT self-fetch (direct-caller path unchanged)', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(MOCK_CLAIMS_A);
    const dbMock = makeDbMock();
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeRequest({ body: VALID_BODY, authHeader: 'Bearer test-token' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockFetchListingTextFields).not.toHaveBeenCalled();
  });
});
