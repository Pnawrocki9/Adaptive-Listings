/**
 * Tests for POST /api/detect
 *
 * Coverage:
 *   Auth (TICKET-033):
 *   - Missing JWT                          → 401 UNAUTHORIZED
 *
 *   SSRF (TICKET-033):
 *   - Private IPv4 (192.168.1.1)           → 400 SSRF_BLOCKED
 *   - localhost                            → 400 SSRF_BLOCKED
 *   - Valid public URL passes              → no block
 *
 *   Request validation:
 *   - Missing body                         → 400 VALIDATION_ERROR
 *   - Invalid URL                          → 400 VALIDATION_ERROR
 *
 *   Detection engine:
 *   - detectSiteSchema throws "Not implemented" → 501 DETECTION_NOT_IMPLEMENTED
 *   - fetch fails (network error)          → 400 FETCH_FAILED
 *   - fetch returns non-2xx               → 400 FETCH_FAILED
 *
 *   Cache guard (TICKET-033):
 *   - Row with updatedAt=30s ago           → 200 cached:true, detection NOT called
 *
 *   Successful detection (TICKET-033):
 *   - Valid result with non-null schema    → 200, wizard response shape, upsert called
 *   - Valid result with null schema        → 200, null body shape
 *
 * @module apps/control-plane/src/app/api/detect/route.test
 */

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks (must be at top level, before any imports that use them) ──────

vi.mock('@estalara/sdk/auto-detect', () => ({
  detectSiteSchema: vi.fn(),
}));

// Mock the dynamic AI-vision import inside detect/route.ts.
// Without this, Vite fails to resolve the dynamic '@estalara/sdk/auto-detect/ai-vision'
// import at transform time (package not built in test env).
vi.mock('@estalara/sdk/auto-detect/ai-vision', () => ({
  detectAiVision: vi.fn().mockResolvedValue(null),
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  tenantSiteSchemas: {
    tenantId: 'tenant_id',
    domain: 'domain',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...args: unknown[]) => args),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
}));

// FOLLOW-555: @supabase/ssr is called by the REAL getSessionAuthClaims() fallback
// (session-auth.ts) when the legacy getAuthClaims path finds nothing — i.e. a
// same-origin browser session with the chunked sb-<ref>-auth-token cookie and no
// Authorization header. mockGetUser lets the SSR-session test drive that path.
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn().mockImplementation(() => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  })),
}));

// ── Actual module imports ──────────────────────────────────────────────────────

import { detectSiteSchema } from '@estalara/sdk/auto-detect';
import { createAdminClient } from '@estalara/db';
import { getAuthClaims } from '@estalara/auth';
import { POST } from './route';
import { checkSsrf, SsrfBlockedError } from '@/lib/ssrf';
import type { DetectionResult } from '@estalara/sdk/auto-detect';
import type { TenantSiteSchema } from '@estalara/shared';

const mockDetectSiteSchema = vi.mocked(detectSiteSchema);
const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockGetAuthClaims = vi.mocked(getAuthClaims);

// ── Default auth claims ────────────────────────────────────────────────────────

const DEFAULT_CLAIMS = {
  sub: 'user-uuid-001',
  email: 'test@agency.com',
  tenant_id: 'tenant-abc',
  agency_role: 'agency:admin' as const,
  estalara_staff: false as const,
  mfa_verified: true,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/detect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    },
    body: JSON.stringify(body),
  });
}

function makeRequestRaw(body: string): NextRequest {
  return new NextRequest('http://localhost/api/detect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    },
    body,
  });
}

/** Make a request with no Authorization header — for testing 401 responses. */
function makeUnauthRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_SCHEMA: TenantSiteSchema = {
  tenant_id: 'tenant-abc',
  domain: 'example.com',
  detected_at: new Date().toISOString(),
  detection_source: 'data_estalara',
  detection_confidence: 0.99,
  index_schema: {
    url_patterns: ['https://example.com/**'],
    listing_card_selector: '[data-estalara-listing]',
    card_field_mappings: {
      price: {
        primary: '[data-estalara-price]',
        fallbacks: [],
        type: 'currency',
        currency: 'EUR',
      },
      headline: {
        primary: '[data-estalara-headline]',
        fallbacks: [],
        type: 'text',
      },
    },
    data_extractors_per_card: {},
    reorder_capable: true,
    container_selector: '[data-estalara-listings]',
  },
  detail_schema: {
    url_patterns: ['https://example.com/listing/*'],
    slot_selectors: {
      tagline: {
        primary: '[data-estalara-tagline]',
        fallbacks: [],
        type: 'text',
      },
    },
    data_extractors: {},
  },
  archetype_hints: [],
};

const VALID_RESULT: DetectionResult = {
  schema: VALID_SCHEMA,
  confidence: 0.99,
  technique: 'data_estalara',
  warnings: [],
};

/** Builds a Drizzle mock that records calls for the upsert chain. */
function makeDbMock() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue([]);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  // select chain: .select().from().where().limit()
  const limit = vi.fn().mockResolvedValue([]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { insert, values, onConflictDoUpdate, select, from, where, limit };
}

/** Type alias for the mock DB shape (the vi.mock() of createAdminClient never calls real Drizzle). */
type DbMock = ReturnType<typeof makeDbMock>;

/**
 * Wire a db mock into the mocked createAdminClient factory.
 * Cast is intentional: the mock only implements the methods called by route.ts,
 * not the full PostgresJsDatabase interface — this is safe because createAdminClient
 * is fully replaced by vi.mock('@estalara/db').
 */
function withDbMock(db: DbMock) {
  mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);
}

/** Mock global fetch to return a successful HTML response. */
function mockFetchSuccess(html = '<html><body>Test</body></html>') {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(html),
    }),
  );
}

/** Mock global fetch to throw an error. */
function mockFetchError(message = 'network error') {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)));
}

/** Mock global fetch to return a non-2xx status. */
function mockFetchNon2xx(status = 404) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      text: () => Promise.resolve('Not Found'),
    }),
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  // Default: auth succeeds
  mockGetAuthClaims.mockResolvedValue(DEFAULT_CLAIMS);
});

// ─────────────────────────────────────────────────────────────────────────────
// TICKET-033: JWT authentication
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/detect — JWT authentication (TICKET-033)', () => {
  it('missing JWT → 401 UNAUTHORIZED', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const res = await POST(makeUnauthRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(typeof body.error.message).toBe('string');
  });

  it('invalid token (getAuthClaims returns null) → 401 UNAUTHORIZED', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('valid JWT proceeds past auth gate', async () => {
    // Auth passes, but fetch will fail — just confirm we get past 401
    mockFetchError('connection refused');

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    // Should get FETCH_FAILED (past auth), not UNAUTHORIZED
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('FETCH_FAILED');
  });

  it('staff JWT (tenant_id: null) → 403 STAFF_TENANT_CONTEXT_MISSING', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'staff-user-001',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true as const,
      estalara_role: 'estalara:ops' as const,
      mfa_verified: true,
    });

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(403);

    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('STAFF_TENANT_CONTEXT_MISSING');
    expect(typeof body.error.message).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-555 (A3-F-04): @supabase/ssr browser-session fallback
//
// Drives the REAL POST handler with NO Authorization header — the legacy
// getAuthClaims path (mocked → null) finds nothing, forcing the real
// getSessionAuthClaims() fallback to authorize via the Supabase SSR session
// cookie (@supabase/ssr mocked above). This is exactly what a logged-in onboarding
// DetectWizard fetch() hits; before FOLLOW-555 it 401'd.
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/detect — @supabase/ssr session fallback (FOLLOW-555)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
    // Legacy Bearer/cookie path finds nothing → forces the SSR fallback.
    mockGetAuthClaims.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('browser session (SSR cookie), agency tenant user, no Bearer header → past auth (not 401)', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-uuid',
          email: 'agent@agency.com',
          app_metadata: { tenant_id: DEFAULT_CLAIMS.tenant_id, agency_role: 'agency:admin' },
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00Z',
        },
      },
      error: null,
    });
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'ssr-session-jwt' } },
      error: null,
    });
    // Auth should pass via the SSR session; fetch then fails → FETCH_FAILED, proving
    // we got PAST the 401 auth gate purely on the browser session.
    mockFetchError('connection refused');

    const res = await POST(makeUnauthRequest({ url: 'https://example.com' }));

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('FETCH_FAILED');
  });

  it('no Bearer AND no SSR session (getUser → null) → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const res = await POST(makeUnauthRequest({ url: 'https://example.com' }));

    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TICKET-033: SSRF protection (unit tests for checkSsrf helper)
// ─────────────────────────────────────────────────────────────────────────────

describe('checkSsrf (unit tests)', () => {
  it('private IPv4 192.168.x.x → throws SsrfBlockedError', () => {
    expect(() => {
      checkSsrf('http://192.168.1.1/page');
    }).toThrow(SsrfBlockedError);
  });

  it('private IPv4 10.x.x.x → throws SsrfBlockedError', () => {
    expect(() => {
      checkSsrf('http://10.0.0.1/');
    }).toThrow(SsrfBlockedError);
  });

  it('private IPv4 172.16.x.x → throws SsrfBlockedError', () => {
    expect(() => {
      checkSsrf('http://172.16.0.1/');
    }).toThrow(SsrfBlockedError);
  });

  it('private IPv4 172.31.x.x → throws SsrfBlockedError', () => {
    expect(() => {
      checkSsrf('http://172.31.255.255/');
    }).toThrow(SsrfBlockedError);
  });

  it('loopback 127.0.0.1 → throws SsrfBlockedError', () => {
    expect(() => {
      checkSsrf('http://127.0.0.1/');
    }).toThrow(SsrfBlockedError);
  });

  it('localhost → throws SsrfBlockedError', () => {
    expect(() => {
      checkSsrf('http://localhost/internal');
    }).toThrow(SsrfBlockedError);
  });

  it('bare hostname "internal" → throws SsrfBlockedError', () => {
    expect(() => {
      checkSsrf('http://internal/');
    }).toThrow(SsrfBlockedError);
  });

  it('bare hostname "db" → throws SsrfBlockedError', () => {
    expect(() => {
      checkSsrf('http://db:5432/');
    }).toThrow(SsrfBlockedError);
  });

  it('IPv6 loopback ::1 → throws SsrfBlockedError', () => {
    expect(() => {
      checkSsrf('http://[::1]/');
    }).toThrow(SsrfBlockedError);
  });

  it('IPv6 fc prefix → throws SsrfBlockedError', () => {
    expect(() => {
      checkSsrf('http://[fc00::1]/');
    }).toThrow(SsrfBlockedError);
  });

  it('IPv6 fd prefix → throws SsrfBlockedError', () => {
    expect(() => {
      checkSsrf('http://[fd12:3456:789a::1]/');
    }).toThrow(SsrfBlockedError);
  });

  it('valid public URL passes', () => {
    expect(() => {
      checkSsrf('https://www.rightmove.co.uk/listing/123');
    }).not.toThrow();
  });

  it('another valid public URL passes', () => {
    expect(() => {
      checkSsrf('https://idealista.com/venta-viviendas/');
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TICKET-033: SSRF protection (via route)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/detect — SSRF protection (TICKET-033)', () => {
  it('private IPv4 (192.168.1.1) → 400 SSRF_BLOCKED', async () => {
    const res = await POST(makeRequest({ url: 'http://192.168.1.1/page' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('SSRF_BLOCKED');
  });

  it('localhost → 400 SSRF_BLOCKED', async () => {
    const res = await POST(makeRequest({ url: 'http://localhost/internal' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('SSRF_BLOCKED');
  });

  it('bare hostname → 400 SSRF_BLOCKED', async () => {
    const res = await POST(makeRequest({ url: 'http://internal/api' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('SSRF_BLOCKED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Request validation
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/detect — request validation', () => {
  it('non-JSON body → 400 VALIDATION_ERROR', async () => {
    const res = await POST(makeRequestRaw('not json!!!'));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('missing body fields → 400 VALIDATION_ERROR', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string; request_id: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof body.error.request_id).toBe('string');
    expect(body.error.request_id.length).toBeGreaterThan(0);
  });

  it('invalid URL (not http/https) → 400 VALIDATION_ERROR', async () => {
    const res = await POST(makeRequest({ url: 'ftp://example.com' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('plain string instead of URL → 400 VALIDATION_ERROR', async () => {
    const res = await POST(makeRequest({ url: 'not-a-url' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fetch failures
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/detect — fetch failures', () => {
  it('fetch throws network error → 400 FETCH_FAILED', async () => {
    const db = makeDbMock();

    withDbMock(db);
    mockFetchError('connection refused');

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('FETCH_FAILED');
    expect(body.error.message).toBe('Could not fetch the provided URL');
  });

  it('fetch returns 404 → 400 FETCH_FAILED', async () => {
    const db = makeDbMock();

    withDbMock(db);
    mockFetchNon2xx(404);

    const res = await POST(makeRequest({ url: 'https://example.com/missing' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('FETCH_FAILED');
  });

  it('fetch returns 500 → 400 FETCH_FAILED', async () => {
    const db = makeDbMock();

    withDbMock(db);
    mockFetchNon2xx(500);

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('FETCH_FAILED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Detection engine not implemented
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/detect — detection engine not implemented', () => {
  it('detectSiteSchema throws "Not implemented" → 501 DETECTION_NOT_IMPLEMENTED', async () => {
    const db = makeDbMock();

    withDbMock(db);
    mockFetchSuccess();
    mockDetectSiteSchema.mockRejectedValue(
      new Error('Not implemented — detection techniques ship in AUTO-003 and AUTO-004'),
    );

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(501);
    const body = await parseBody<{ error: { code: string; message: string; request_id: string } }>(
      res,
    );
    expect(body.error.code).toBe('DETECTION_NOT_IMPLEMENTED');
    expect(body.error.message).toContain('Detection engine is being deployed');
    expect(typeof body.error.request_id).toBe('string');
  });

  it('detectSiteSchema throws "Not Implemented" (capitalised) → 501', async () => {
    const db = makeDbMock();

    withDbMock(db);
    mockFetchSuccess();
    mockDetectSiteSchema.mockRejectedValue(new Error('Not Implemented'));

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(501);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('DETECTION_NOT_IMPLEMENTED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TICKET-033: Cache guard
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/detect — 60-second cache guard (TICKET-033)', () => {
  it('row with updatedAt=30s ago → 200 cached:true, detection NOT called', async () => {
    const thirtySecondsAgo = new Date(Date.now() - 30_000);
    const db = makeDbMock();
    // Return a cached row with updatedAt within the last 60 seconds
    db.limit.mockResolvedValue([
      {
        id: 'row-uuid-001',
        tenantId: 'tenant-abc',
        domain: 'example.com',
        schema: VALID_SCHEMA,
        detectionSource: 'data_estalara',
        detectionConfidence: 0.99,
        createdAt: thirtySecondsAgo,
        updatedAt: thirtySecondsAgo,
      },
    ]);

    withDbMock(db);

    const res = await POST(makeRequest({ url: 'https://example.com/listings' }));
    expect(res.status).toBe(200);

    const body = await parseBody<{
      cached: boolean;
      detection_source: string;
      detection_confidence: number;
      fields: unknown[];
      request_id: string;
    }>(res);

    expect(body.cached).toBe(true);
    expect(body.detection_source).toBe('data_estalara');
    expect(body.detection_confidence).toBe(0.99);
    expect(Array.isArray(body.fields)).toBe(true);
    expect(typeof body.request_id).toBe('string');

    // Detection pipeline must NOT have been called
    expect(mockDetectSiteSchema).not.toHaveBeenCalled();
  });

  it('row with updatedAt=90s ago → cache miss, runs detection', async () => {
    const ninetySecondsAgo = new Date(Date.now() - 90_000);
    const db = makeDbMock();
    // Return a stale row (older than 60s)
    db.limit.mockResolvedValue([
      {
        id: 'row-uuid-002',
        tenantId: 'tenant-abc',
        domain: 'example.com',
        schema: VALID_SCHEMA,
        detectionSource: 'data_estalara',
        detectionConfidence: 0.99,
        createdAt: ninetySecondsAgo,
        updatedAt: ninetySecondsAgo,
      },
    ]);

    withDbMock(db);
    mockFetchSuccess();
    mockDetectSiteSchema.mockResolvedValue(VALID_RESULT);

    const res = await POST(makeRequest({ url: 'https://example.com/listings' }));
    expect(res.status).toBe(200);

    // Detection should have been called since cache is stale
    expect(mockDetectSiteSchema).toHaveBeenCalled();

    const body = await parseBody<{ cached: boolean }>(res);
    expect(body.cached).toBe(false);
  });

  it('no cached row → runs detection normally', async () => {
    const db = makeDbMock();
    db.limit.mockResolvedValue([]); // no row

    withDbMock(db);
    mockFetchSuccess();
    mockDetectSiteSchema.mockResolvedValue(VALID_RESULT);

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(200);
    expect(mockDetectSiteSchema).toHaveBeenCalled();

    const body = await parseBody<{ cached: boolean }>(res);
    expect(body.cached).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TICKET-033: Wizard-ready response shape (successful detection)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/detect — wizard response shape (TICKET-033)', () => {
  it('valid result with non-null schema → 200 + wizard response + DB upsert called', async () => {
    const db = makeDbMock();

    withDbMock(db);
    mockFetchSuccess();
    mockDetectSiteSchema.mockResolvedValue(VALID_RESULT);

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(200);

    const body = await parseBody<{
      schema: TenantSiteSchema;
      detection_source: string;
      detection_confidence: number;
      fields: {
        name: string;
        selector: string;
        sample_value: string | null;
        confidence: number;
      }[];
      cached: boolean;
      request_id: string;
    }>(res);

    // Wizard response shape
    expect(body.schema).not.toBeNull();
    expect(body.detection_source).toBe('data_estalara');
    expect(body.detection_confidence).toBe(0.99);
    expect(body.cached).toBe(false);
    expect(typeof body.request_id).toBe('string');
    expect(body.request_id.length).toBeGreaterThan(0);

    // fields[] must be populated from card_field_mappings + slot_selectors
    expect(Array.isArray(body.fields)).toBe(true);
    expect(body.fields.length).toBeGreaterThan(0);

    const priceField = body.fields.find((f) => f.name === 'price');
    expect(priceField).toBeDefined();
    expect(priceField?.selector).toBe('[data-estalara-price]');
    expect(priceField?.sample_value).toBeNull();
    expect(typeof priceField?.confidence).toBe('number');

    // DB insert should have been called
    expect(db.insert).toHaveBeenCalled();
  });

  it('fields[] includes detail_schema slot_selectors', async () => {
    const db = makeDbMock();

    withDbMock(db);
    mockFetchSuccess();
    mockDetectSiteSchema.mockResolvedValue(VALID_RESULT);

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    const body = await parseBody<{
      fields: { name: string; selector: string }[];
    }>(res);

    const taglineField = body.fields.find((f) => f.name === 'tagline');
    expect(taglineField).toBeDefined();
    expect(taglineField?.selector).toBe('[data-estalara-tagline]');
  });

  it('fields[] deduplicates by name (index schema takes precedence)', async () => {
    // Build a schema where the same field name appears in both index and detail schemas.
    // 'headline' exists in both CardFieldMappings and SlotSelectors — use it to test dedup.
    const schemaWithDupe: TenantSiteSchema = {
      ...VALID_SCHEMA,
      detail_schema: {
        ...VALID_SCHEMA.detail_schema,
        slot_selectors: {
          // 'headline' also appears in card_field_mappings — should be deduplicated
          headline: { primary: '.detail-headline', fallbacks: [], type: 'text' as const },
        },
      },
    };
    const resultWithDupe: DetectionResult = { ...VALID_RESULT, schema: schemaWithDupe };

    const db = makeDbMock();

    withDbMock(db);
    mockFetchSuccess();
    mockDetectSiteSchema.mockResolvedValue(resultWithDupe);

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    const body = await parseBody<{ fields: { name: string; selector: string }[] }>(res);

    const headlineFields = body.fields.filter((f) => f.name === 'headline');
    expect(headlineFields).toHaveLength(1);
    // Index schema (card_field_mappings) takes precedence
    expect(headlineFields[0]?.selector).toBe('[data-estalara-headline]');
  });

  it('valid result with null schema → 200, null body shape', async () => {
    const db = makeDbMock();

    withDbMock(db);
    mockFetchSuccess();
    const nullResult: DetectionResult = {
      schema: null,
      confidence: 0,
      technique: 'ai_vision',
      warnings: ['No deterministic technique matched'],
    };
    mockDetectSiteSchema.mockResolvedValue(nullResult);

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(200);

    const body = await parseBody<{
      schema: null;
      detection_source: null;
      detection_confidence: number;
      fields: unknown[];
      cached: boolean;
      request_id: string;
    }>(res);

    expect(body.schema).toBeNull();
    expect(body.detection_source).toBeNull();
    expect(body.detection_confidence).toBe(0);
    expect(body.fields).toHaveLength(0);
    expect(body.cached).toBe(false);
    expect(typeof body.request_id).toBe('string');

    // No DB write when schema is null
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('DB failure does not block the 200 response', async () => {
    const db = makeDbMock();
    db.onConflictDoUpdate.mockRejectedValue(new Error('DB connection failed'));

    withDbMock(db);
    mockFetchSuccess();
    mockDetectSiteSchema.mockResolvedValue(VALID_RESULT);

    // Should still return 200 even if DB fails
    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(200);
  });

  it('tenant_id from JWT is used (not from body)', async () => {
    const db = makeDbMock();

    withDbMock(db);
    mockFetchSuccess();
    mockDetectSiteSchema.mockResolvedValue(VALID_RESULT);

    await POST(makeRequest({ url: 'https://example.com' }));

    // detectSiteSchema should be called with tenant_id from JWT claims ('tenant-abc')
    expect(mockDetectSiteSchema).toHaveBeenCalledWith(
      expect.any(String),
      'https://example.com',
      'tenant-abc',
    );
  });

  it('schema.inquiry_submit_selector is preserved in the wizard response (FOLLOW-127)', async () => {
    // Build a schema that already has inquiry_submit_selector (populated by the pipeline)
    const schemaWithSelector: TenantSiteSchema = {
      ...VALID_SCHEMA,
      inquiry_submit_selector: "button[type='submit'].contact-btn",
    };
    const resultWithSelector: DetectionResult = {
      ...VALID_RESULT,
      schema: schemaWithSelector,
    };

    const db = makeDbMock();
    withDbMock(db);
    mockFetchSuccess();
    mockDetectSiteSchema.mockResolvedValue(resultWithSelector);

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(200);

    const body = await parseBody<{ schema: TenantSiteSchema }>(res);
    // The inquiry_submit_selector must be present and non-empty in the response schema
    expect(body.schema.inquiry_submit_selector).toBe("button[type='submit'].contact-btn");
    expect(body.schema.inquiry_submit_selector).not.toBe('');
  });

  it('schema without inquiry_submit_selector does not emit empty string (TG-1 guard)', async () => {
    // VALID_SCHEMA has no inquiry_submit_selector — the response must not have "" in it
    const db = makeDbMock();
    withDbMock(db);
    mockFetchSuccess();
    mockDetectSiteSchema.mockResolvedValue(VALID_RESULT);

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(200);

    const body = await parseBody<{ schema: TenantSiteSchema }>(res);
    // Must be absent or undefined — never ""
    expect(body.schema.inquiry_submit_selector).not.toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unexpected errors
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/detect — unexpected errors', () => {
  it('detectSiteSchema throws unexpected error → 500 INTERNAL_ERROR', async () => {
    const db = makeDbMock();

    withDbMock(db);
    mockFetchSuccess();
    mockDetectSiteSchema.mockRejectedValue(new Error('Segfault in WASM'));

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
