/**
 * Tests for POST /api/listings/embed (FOLLOW-019).
 *
 * Covers:
 *   - 401 auth paths (no / wrong internal secret; a Bearer JWT is not a credential here —
 *     FOLLOW-1335 removed the tenant-JWT path)
 *   - INTERNAL_API_SECRET service-to-service path (the only accepted credential)
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
  // FOLLOW-1193: the route reports the database it wrote to. The agreement
  // between this description and the URL createAdminClient() connects with is
  // proven in packages/db/src/__tests__/client.test.ts, not here.
  describeAdminDatabase: vi.fn(() => ({ host: '127.0.0.1', port: '5433', name: 'postgres' })),
  listingEmbeddings: {
    tenantId: 'tenant_id',
    listingId: 'listing_id',
    embedding: 'embedding',
    updatedAt: 'updated_at',
  },
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

// Dynamic import after mocks.
const { POST } = await import('./route');

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const LISTING_ID = 'listing-abc';
const SECRET = 'internal-secret-token';

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
  process.env.INTERNAL_API_SECRET = SECRET;
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
    const dbMock = makeDbMock();
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeRequest({ body: VALID_BODY, internalSecret: SECRET });
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

  it('accepts the INTERNAL_API_SECRET header', async () => {
    const dbMock = makeDbMock();
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeRequest({
      body: VALID_BODY,
      authHeader: null,
      internalSecret: SECRET,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  // FOLLOW-1193: `pnpm seed:listings` has no database of its own — the rows land
  // wherever THIS server's admin URL points. The response names that database
  // (host/port/name only) so the seeder can print it and a split-brain between
  // the two seeders is visible in the seeder's own output.
  it('internal-secret 200 names the database the upsert went to (host/port/name only)', async () => {
    const dbMock = makeDbMock();
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await POST(
      makeRequest({ body: VALID_BODY, authHeader: null, internalSecret: SECRET }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      listing_id: LISTING_ID,
      database: { host: '127.0.0.1', port: '5433', name: 'postgres' },
    });
  });

  it('accepts a body with only one text field populated', async () => {
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
      internalSecret: SECRET,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/listings/embed — auth', () => {
  it('returns 401 when the request carries no internal secret', async () => {
    const req = makeRequest({ body: VALID_BODY });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockEmbedTextWithDimensions).not.toHaveBeenCalled();
  });

  it('returns 401 when INTERNAL_API_SECRET is not configured, whatever the header says', async () => {
    delete process.env.INTERNAL_API_SECRET;
    const req = makeRequest({ body: VALID_BODY, internalSecret: SECRET });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('FOLLOW-1335: a Bearer JWT is not a credential here (the tenant-JWT path is gone) → 401', async () => {
    const req = makeRequest({ body: VALID_BODY, authHeader: 'Bearer some-staff-or-tenant-jwt' });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockEmbedTextWithDimensions).not.toHaveBeenCalled();
  });

  it.each([
    ['same length, wrong value', SECRET.replace(/.$/, 'X')],
    ['a prefix of the secret', SECRET.slice(0, -1)],
    ['the secret plus a suffix', `${SECRET}x`],
  ])('rejects an incorrect INTERNAL_API_SECRET (%s) → 401', async (_label, wrong) => {
    const req = makeRequest({ body: VALID_BODY, internalSecret: wrong });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockEmbedTextWithDimensions).not.toHaveBeenCalled();
  });
});

describe('POST /api/listings/embed — validation', () => {
  it('returns 400 when JSON body is invalid', async () => {
    const req = new NextRequest('http://localhost/api/listings/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: '{not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when tenant_id is missing', async () => {
    const req = makeRequest({
      body: { listing_id: LISTING_ID, text_fields: { title: 'x' } },
      internalSecret: SECRET,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when text_fields are all empty', async () => {
    const req = makeRequest({
      body: { tenant_id: TENANT_A, listing_id: LISTING_ID, text_fields: {} },
      internalSecret: SECRET,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/listings/embed — OpenAI / DB failure paths', () => {
  it('returns 503 when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY;

    const req = makeRequest({ body: VALID_BODY, internalSecret: SECRET });
    const res = await POST(req);
    expect(res.status).toBe(503);
    expect(mockEmbedTextWithDimensions).not.toHaveBeenCalled();
  });

  it('returns 503 when OpenAI call throws', async () => {
    mockEmbedTextWithDimensions.mockRejectedValueOnce(new Error('rate limit'));

    const req = makeRequest({ body: VALID_BODY, internalSecret: SECRET });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it('returns 503 when OpenAI returns wrong dimensionality', async () => {
    mockEmbedTextWithDimensions.mockResolvedValueOnce(Array.from({ length: 1536 }, () => 0.01));

    const req = makeRequest({ body: VALID_BODY, internalSecret: SECRET });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it('returns 500 when DB upsert throws', async () => {
    const dbMock = makeDbMock({ throws: true });
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeRequest({ body: VALID_BODY, internalSecret: SECRET });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/listings/embed — FOLLOW-567 self-fetch when text_fields absent', () => {
  it('Modal-shaped POST (tenant_id+listing_id, no text_fields) self-fetches → 200 + upsert', async () => {
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
      internalSecret: SECRET,
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
    mockFetchListingTextFields.mockResolvedValue(null);
    const dbMock = makeDbMock();
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeRequest({
      body: { tenant_id: TENANT_A, listing_id: LISTING_ID },
      internalSecret: SECRET,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockEmbedTextWithDimensions).not.toHaveBeenCalled();
    expect(dbMock._spies.onConflictDoUpdate).not.toHaveBeenCalled();
  });

  it('explicit text_fields present → does NOT self-fetch (direct-caller path unchanged)', async () => {
    const dbMock = makeDbMock();
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = makeRequest({ body: VALID_BODY, internalSecret: SECRET });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockFetchListingTextFields).not.toHaveBeenCalled();
  });
});
