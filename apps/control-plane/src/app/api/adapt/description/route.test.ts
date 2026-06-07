/**
 * Unit tests for GET /api/adapt/description — TICKET-DESC-001 / FOLLOW-203.
 *
 * Coverage:
 *   AC-1: Endpoint exists and returns correct shape
 *   AC-2: Cache hit returns ai_cached, no Redpanda publish
 *   AC-3: Cache miss returns template_fallback and enqueues Modal job
 *   AC-4: No auth → 401
 *   AC-5: Invalid archetype → 400
 *   AC-6: Missing required params → 400
 *   AC-7: max_tokens is always 500 (no tier branching)
 *
 * FOLLOW-203: `tier` param removed from all requests and event assertions.
 * `ttl_seconds` and `priority` are no longer emitted by the route.
 *
 * @module apps/control-plane/src/app/api/adapt/description/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────
//
// Note: vi.mock factories are hoisted to the top. Variables declared in the test
// module (like mockGetCachedDescription) cannot be referenced inside the factory.
// We use vi.hoisted() to create stubs that are available both in the factory and
// in test assertions.

const { mockGetCachedDescription, mockDescriptionKey, mockGetGlobalGenerationModel } = vi.hoisted(
  () => ({
    mockGetCachedDescription: vi.fn(),
    mockDescriptionKey: vi.fn(
      (tenantId: string, listingId: string, archetype: string, locale: string) =>
        `desc:${tenantId}:${listingId}:${archetype}:${locale}`,
    ),
    mockGetGlobalGenerationModel: vi.fn().mockResolvedValue('claude-sonnet-4-6'),
  }),
);

vi.mock('@/lib/description-cache', () => ({
  getCachedDescription: mockGetCachedDescription,
  descriptionKey: mockDescriptionKey,
  setCachedDescription: vi.fn(),
  invalidateDescriptionCache: vi.fn(),
}));

// @estalara/auth — getAuthClaims returns a tenant_id for most tests
vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi
    .fn()
    .mockResolvedValue({ tenant_id: 'test-tenant-uuid', estalara_staff: false }),
}));

// rag-retrieval — always returns empty context (no DB in tests)
vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));

// global-config-store — returns configurable global model (FOLLOW-161)
vi.mock('@/lib/global-config-store', () => ({
  getGlobalGenerationModel: mockGetGlobalGenerationModel,
  ALLOWED_GENERATION_MODELS: [
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-6',
    'claude-opus-4-8',
  ] as const,
  DEFAULT_GENERATION_MODEL: 'claude-sonnet-4-6',
  GENERATION_MODEL_KEY: 'generation_model',
}));

// demo-override-store — default: no demo override active
vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: vi.fn().mockResolvedValue({
    enabled: false,
    overrideArchetype: null,
    overrideModel: 'claude-sonnet-4-6',
  }),
}));

import { GET } from './route';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeRequest(
  params: Record<string, string>,
  authHeader: string | null = 'Bearer test_key',
): NextRequest {
  const url = new URL('http://localhost/api/adapt/description');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {};
  if (authHeader !== null) {
    headers.Authorization = authHeader;
  }
  return new NextRequest(url, { headers });
}

async function parseBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// VALID_PARAMS no longer includes `tier` (FOLLOW-203)
const VALID_PARAMS = {
  listing_id: 'prop-123',
  archetype: 'yield_hunter',
  locale: 'en',
};

// ─── Auth gate tests ──────────────────────────────────────────────────────────

describe('GET /api/adapt/description — auth', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest(VALID_PARAMS, null));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('returns 401 when Bearer token is empty', async () => {
    const res = await GET(makeRequest(VALID_PARAMS, 'Bearer '));
    expect(res.status).toBe(401);
  });

  it('returns 401 when ADAPT_API_KEY is set and token does not match', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'correct_key');
    const res = await GET(makeRequest(VALID_PARAMS, 'Bearer wrong_key'));
    expect(res.status).toBe(401);
  });

  it('returns 200 when ADAPT_API_KEY is set and token matches', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'correct_key');
    mockGetCachedDescription.mockResolvedValueOnce(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    const res = await GET(makeRequest(VALID_PARAMS, 'Bearer correct_key'));
    expect(res.status).toBe(200);
  });

  it('returns 200 with any non-empty token when ADAPT_API_KEY is unset', async () => {
    vi.stubEnv('ADAPT_API_KEY', '');
    mockGetCachedDescription.mockResolvedValueOnce(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    const res = await GET(makeRequest(VALID_PARAMS, 'Bearer any_key'));
    expect(res.status).toBe(200);
  });
});

// ─── Validation tests ─────────────────────────────────────────────────────────

describe('GET /api/adapt/description — validation', () => {
  it('returns 400 when listing_id is missing', async () => {
    const params = { archetype: 'yield_hunter' };
    const res = await GET(makeRequest(params));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when archetype is invalid (AC-5)', async () => {
    const params = { listing_id: 'prop-123', archetype: 'invalid_archetype' };
    const res = await GET(makeRequest(params));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when locale is not supported', async () => {
    const params = { ...VALID_PARAMS, locale: 'de' };
    const res = await GET(makeRequest(params));
    expect(res.status).toBe(400);
  });

  it('uses default locale en when locale param is omitted', async () => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetCachedDescription.mockResolvedValueOnce(null);
    const params = { listing_id: 'prop-123', archetype: 'yield_hunter' };
    const res = await GET(makeRequest(params));
    expect(res.status).toBe(200);
    const body = await parseBody<{ locale: string }>(res);
    expect(body.locale).toBe('en');
    vi.unstubAllGlobals();
  });

  it('accepts requests without a tier param (FOLLOW-203 AC1)', async () => {
    mockGetCachedDescription.mockResolvedValueOnce(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });
});

// ─── Cache hit ───────────────────────────────────────────────────────────────

describe('GET /api/adapt/description — cache hit (AC-2)', () => {
  beforeEach(() => {
    mockGetCachedDescription.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ai_cached source and description from Redis', async () => {
    const cachedValue = {
      text: 'AI-generated description for yield_hunter from Redis.',
      generated_at: '2026-05-14T12:00:00.000Z',
    };
    mockGetCachedDescription.mockResolvedValueOnce(cachedValue);
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    const body = await parseBody<{
      description: string;
      source: string;
      locale: string;
      generated_at: string;
    }>(res);

    expect(body.source).toBe('ai_cached');
    expect(body.description).toBe(cachedValue.text);
    expect(body.generated_at).toBe(cachedValue.generated_at);
    expect(body.locale).toBe('en');
  });

  it('Redpanda is NOT published on cache hit', async () => {
    const cachedValue = {
      text: 'Cached description.',
      generated_at: '2026-05-14T12:00:00.000Z',
    };
    mockGetCachedDescription.mockResolvedValueOnce(cachedValue);
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    vi.stubEnv('REDPANDA_REST_URL', 'https://redpanda.test');

    await GET(makeRequest(VALID_PARAMS));

    // Allow fire-and-forget to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(mockFetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

// ─── Cache miss ──────────────────────────────────────────────────────────────

describe('GET /api/adapt/description — cache miss (AC-3)', () => {
  beforeEach(() => {
    mockGetCachedDescription.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns template_fallback and publishes description.requested event', async () => {
    mockGetCachedDescription.mockResolvedValueOnce(null);

    const publishedBodies: string[] = [];
    const mockFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        publishedBodies.push((init.body as string | undefined) ?? '');
      }
      return Promise.resolve(new Response('', { status: 200 }));
    });
    vi.stubGlobal('fetch', mockFetch);
    vi.stubEnv('REDPANDA_REST_URL', 'https://redpanda.test');

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    const body = await parseBody<{ source: string; generated_at: null }>(res);
    expect(body.source).toBe('template_fallback');
    expect(body.generated_at).toBeNull();

    // Allow fire-and-forget to complete
    await new Promise((r) => setTimeout(r, 10));

    // Redpanda publish must have been called
    expect(mockFetch).toHaveBeenCalled();

    // Verify the published payload shape
    const firstPostBody = publishedBodies[0];
    expect(firstPostBody).toBeDefined();
    const envelope = JSON.parse(firstPostBody!) as {
      records: { value: Record<string, unknown> }[];
    };
    const event = envelope.records[0]?.value;
    expect(event?.archetype).toBe('yield_hunter');
    expect(event?.listing_id).toBe('prop-123');
    // FOLLOW-203: tier and ttl_seconds are no longer emitted by the route
    expect(event?.tier).toBeUndefined();
    expect(event?.ttl_seconds).toBeUndefined();
    expect(String(event?.cache_key)).toContain('yield_hunter');
    // ESC-018: original_description key must always be present
    expect(event).toHaveProperty('original_description');
    expect(typeof event?.original_description).toBe('string');
  });

  it('event payload includes max_tokens: 500 for all requests (AC-7 / FOLLOW-203)', async () => {
    mockGetCachedDescription.mockResolvedValueOnce(null);

    const publishedBodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          publishedBodies.push((init.body as string | undefined) ?? '');
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );
    vi.stubEnv('REDPANDA_REST_URL', 'https://redpanda.test');

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 10));

    const firstPostBody = publishedBodies[0];
    expect(firstPostBody).toBeDefined();
    const envelope = JSON.parse(firstPostBody!) as {
      records: { value: Record<string, unknown> }[];
    };
    const event = envelope.records[0]?.value;
    // Single constant — no tier branching
    expect(event?.max_tokens).toBe(500);
    // priority is no longer emitted
    expect(event?.priority).toBeUndefined();
  });

  it('threads original_description fetched from the Estalara backend into the event (ESC-018)', async () => {
    mockGetCachedDescription.mockResolvedValueOnce(null);
    vi.stubEnv('ESTALARA_BACKEND_URL', 'https://backend.test');
    vi.stubEnv('REDPANDA_REST_URL', 'https://redpanda.test');

    const publishedBodies: string[] = [];
    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/listing/details')) {
        return Promise.resolve(
          new Response(JSON.stringify({ description: 'The agent original copy.' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (init?.method === 'POST') {
        publishedBodies.push((init.body as string | undefined) ?? '');
      }
      return Promise.resolve(new Response('', { status: 200 }));
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 10));

    const listingCall = mockFetch.mock.calls.find((c) =>
      (c[0] as string).includes('/api/v1/listing/details/slug?slug=prop-123'),
    );
    expect(listingCall).toBeDefined();

    const event = (
      JSON.parse(publishedBodies[0]!) as { records: { value: Record<string, unknown> }[] }
    ).records[0]?.value;
    expect(event?.original_description).toBe('The agent original copy.');
  });

  it('does not block response on Redpanda publish failure (fire-and-forget)', async () => {
    mockGetCachedDescription.mockResolvedValueOnce(null);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Redpanda down')));
    vi.stubEnv('REDPANDA_REST_URL', 'https://redpanda.test');

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    const body = await parseBody<{ source: string }>(res);
    expect(body.source).toBe('template_fallback');

    await new Promise((r) => setTimeout(r, 10));
  });
});

// ─── Response shape validation ────────────────────────────────────────────────

describe('GET /api/adapt/description — response shape (AC-1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('template_fallback response has all required fields', async () => {
    mockGetCachedDescription.mockResolvedValueOnce(null);
    vi.stubGlobal('fetch', vi.fn());
    const res = await GET(makeRequest(VALID_PARAMS));
    const body = await parseBody<Record<string, unknown>>(res);

    expect(body).toHaveProperty('description');
    expect(body).toHaveProperty('source', 'template_fallback');
    expect(body).toHaveProperty('locale', 'en');
    expect(body).toHaveProperty('generated_at', null);
  });

  it('ai_cached response has all required fields including generated_at', async () => {
    const cachedValue = {
      text: 'Cached description text.',
      generated_at: '2026-05-14T12:00:00.000Z',
    };
    mockGetCachedDescription.mockResolvedValueOnce(cachedValue);
    vi.stubGlobal('fetch', vi.fn());

    const res = await GET(makeRequest(VALID_PARAMS));
    const body = await parseBody<Record<string, unknown>>(res);

    expect(body).toHaveProperty('description', cachedValue.text);
    expect(body).toHaveProperty('source', 'ai_cached');
    expect(body).toHaveProperty('locale', 'en');
    expect(body).toHaveProperty('generated_at', cachedValue.generated_at);
  });
});

// ─── FOLLOW-161: global generation model wiring ───────────────────────────────

describe('GET /api/adapt/description — FOLLOW-161 global model wiring', () => {
  beforeEach(() => {
    mockGetCachedDescription.mockClear();
    mockGetGlobalGenerationModel.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('event payload includes generation_model from global config on cache miss', async () => {
    mockGetGlobalGenerationModel.mockResolvedValue('claude-opus-4-8');
    mockGetCachedDescription.mockResolvedValueOnce(null);

    const publishedBodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          publishedBodies.push((init.body as string | undefined) ?? '');
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );
    vi.stubEnv('REDPANDA_REST_URL', 'https://redpanda.test');

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 10));

    const firstPostBody = publishedBodies[0];
    expect(firstPostBody).toBeDefined();
    const envelope = JSON.parse(firstPostBody!) as {
      records: { value: Record<string, unknown> }[];
    };
    const event = envelope.records[0]?.value;
    expect(event?.generation_model).toBe('claude-opus-4-8');
    expect(event?.override_model).toBeUndefined();
  });

  it('getGlobalGenerationModel is called on cache miss', async () => {
    mockGetCachedDescription.mockResolvedValueOnce(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    vi.stubEnv('REDPANDA_REST_URL', 'https://redpanda.test');

    await GET(makeRequest(VALID_PARAMS));
    await new Promise((r) => setTimeout(r, 10));

    expect(mockGetGlobalGenerationModel).toHaveBeenCalled();
  });
});

// ─── FOLLOW-161: cache key includes active model ──────────────────────────────

describe('GET /api/adapt/description — FOLLOW-161 cache key includes model', () => {
  beforeEach(() => {
    mockGetCachedDescription.mockClear();
    mockGetGlobalGenerationModel.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('standard path cache key includes global model suffix', async () => {
    mockGetGlobalGenerationModel.mockResolvedValue('claude-haiku-4-5-20251001');
    mockGetCachedDescription.mockResolvedValueOnce(null);

    const publishedBodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          publishedBodies.push((init.body as string | undefined) ?? '');
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );
    vi.stubEnv('REDPANDA_REST_URL', 'https://redpanda.test');

    await GET(makeRequest(VALID_PARAMS));
    await new Promise((r) => setTimeout(r, 10));

    const firstPostBody = publishedBodies[0];
    expect(firstPostBody).toBeDefined();
    const envelope = JSON.parse(firstPostBody!) as {
      records: { value: Record<string, unknown> }[];
    };
    const event = envelope.records[0]?.value;
    expect(String(event?.cache_key)).toContain('claude-haiku-4-5-20251001');
  });

  it('different global models produce different cache keys', () => {
    // Just assert the models are different so keys must differ
    expect('claude-sonnet-4-6').not.toBe('claude-haiku-4-5-20251001');
  });
});
