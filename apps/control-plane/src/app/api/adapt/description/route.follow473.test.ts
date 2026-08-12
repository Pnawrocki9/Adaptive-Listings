/**
 * Auth-matrix tests for GET /api/adapt/description — FOLLOW-473 (RETRO-158 / FOLLOW-510).
 *
 * Rule S sibling of route.follow473.test.ts: GET /api/adapt/description had the
 * identical fail-open + spoofable-`x-tenant-id` shape and is fixed at the SAME
 * tier with the SAME two-step resolver (`resolveAdaptGetAuth`). This suite runs
 * that resolver END-TO-END (NOT mocked) against a controllable `@estalara/db`
 * mock, so the `api_keys` lookup actually executes.
 *
 * Coverage (parity with route.follow473.test.ts):
 *   - Valid registered api_keys row → 200, tenant taken from the KEY (not the
 *     spoofed x-tenant-id header).
 *   - Ops-bypass valid (ADAPT_API_KEY + OPS_TENANT_ID) → 200, tenant = OPS_TENANT_ID.
 *   - Ops-bypass misconfigured (ADAPT_API_KEY set, OPS_TENANT_ID unset) → 500.
 *   - ADAPT_API_KEY UNSET + non-empty bearer + no key row → 401 (FAILS CLOSED).
 *   - Unknown / revoked key → 401.
 *   - Configured-but-failed DB (Rule K.2) → 401, never fabricates a tenant.
 *
 * @module apps/control-plane/src/app/api/adapt/description/route.follow473.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock description-pipeline dependencies (not under test here) ─────────────

const { mockGetPgCachedDescription } = vi.hoisted(() => ({
  mockGetPgCachedDescription: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/description-cache', () => ({
  getCachedDescription: vi.fn().mockResolvedValue(null),
  descriptionKey: vi.fn(
    (tenantId: string, listingId: string, archetype: string, locale: string) =>
      `desc:${tenantId}:${listingId}:${archetype}:${locale}`,
  ),
  setCachedDescription: vi.fn(),
  invalidateDescriptionCache: vi.fn(),
}));

vi.mock('@/lib/description-pg-cache', () => ({
  getPgCachedDescription: mockGetPgCachedDescription,
  insertPgCachedDescription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));

// fetchListingOriginalDescription → '' makes the cache-miss path skip Modal enqueue
// entirely and return 200 template_fallback (no fetch/MODAL_DESCRIPTION_URL needed).
vi.mock('@/lib/listing-details', () => ({
  fetchListingOriginalDescription: vi.fn().mockResolvedValue(''),
}));

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: vi.fn().mockResolvedValue({
    enabled: false,
    overrideArchetype: null,
    overrideModel: 'claude-sonnet-4-6',
  }),
}));

vi.mock('@/lib/global-config-store', () => ({
  getGlobalGenerationModel: vi.fn().mockResolvedValue('claude-sonnet-4-6'),
  ALLOWED_GENERATION_MODELS: [
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-6',
    'claude-opus-4-8',
  ] as const,
  DEFAULT_GENERATION_MODEL: 'claude-sonnet-4-6',
  GENERATION_MODEL_KEY: 'generation_model',
}));

// ─── @estalara/db mock — controllable api_keys lookup for resolveApiKey() ─────

const { mockSelectLimit } = vi.hoisted(() => ({
  mockSelectLimit: vi.fn().mockResolvedValue([]),
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: mockSelectLimit,
  })),
  tenants: {},
  apiKeys: {
    tenantId: 'tenant_id',
    hashedKey: 'hashed_key',
    revokedAt: 'revoked_at',
    expiresAt: 'expires_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...preds: unknown[]) => ({ kind: 'and', preds })),
  eq: vi.fn((col: unknown, val: unknown) => ({ kind: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ kind: 'isNull', col })),
  or: vi.fn((...preds: unknown[]) => ({ kind: 'or', preds })),
  gt: vi.fn((col: unknown, val: unknown) => ({ kind: 'gt', col, val })),
}));

// resolveAdaptGetAuth / resolveApiKey / secret-compare run end-to-end (NOT mocked).
import { GET } from './route';
import { getPgCachedDescription } from '@/lib/description-pg-cache';

const mockGetPg = vi.mocked(getPgCachedDescription);

// ─── SHA-256(rawKey) mirror of api-key-auth.ts ───────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function makeApiKeyRow(rawApiKey: string, tenantId: string) {
  return { tenantId, hashedKey: await sha256Hex(rawApiKey) };
}

// ─── Request helper ───────────────────────────────────────────────────────────

const TENANT_A = '550e8400-e29b-41d4-a716-446655440001';
const OPS_TENANT = '550e8400-e29b-41d4-a716-4466554400ff';
const SPOOFED_TENANT = '550e8400-e29b-41d4-a716-4466554400aa';
const VALID_API_KEY = 'sk_live_test_tenant_a_key';
const OPS_KEY = 'ops_shared_secret_value';

const VALID_PARAMS: Record<string, string> = {
  listing_id: 'prop-123',
  archetype: 'yield_hunter',
  locale: 'en',
};

function makeGetRequest(
  authHeader: string | null,
  xTenantId: string | null = SPOOFED_TENANT,
  origin?: string,
): NextRequest {
  const url = new URL('http://localhost/api/adapt/description');
  for (const [k, v] of Object.entries(VALID_PARAMS)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (authHeader !== null) headers.Authorization = authHeader;
  if (xTenantId !== null) headers['x-tenant-id'] = xTenantId;
  // [FOLLOW-943] The origin gate short-circuits without an `Origin`, so only a browser-shaped
  // request reaches it. Every other case here is a server-side caller and stays on that path.
  if (origin !== undefined) headers.Origin = origin;
  return new NextRequest(url, { headers });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/adapt/description — two-step auth (FOLLOW-473, Rule S sibling)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectLimit.mockReset().mockResolvedValue([]);
    mockGetPg.mockReset().mockResolvedValue(null);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('MODAL_DESCRIPTION_URL', '');
    vi.stubEnv('ADAPT_API_KEY', '');
    vi.stubEnv('OPS_TENANT_ID', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('valid registered API key → 200; tenant taken from the KEY, spoofed x-tenant-id ignored', async () => {
    mockSelectLimit.mockResolvedValue([await makeApiKeyRow(VALID_API_KEY, TENANT_A)]);

    const res = await GET(makeGetRequest(`Bearer ${VALID_API_KEY}`, SPOOFED_TENANT));

    expect(res.status).toBe(200);
    // The Postgres cache lookup is keyed on the RESOLVED tenant (TENANT_A), never
    // the spoofed x-tenant-id header — proving the header is no longer trusted.
    expect(mockGetPg).toHaveBeenCalledWith(
      TENANT_A,
      'prop-123',
      'yield_hunter',
      'en',
      expect.anything(),
    );
    expect(mockGetPg).not.toHaveBeenCalledWith(
      SPOOFED_TENANT,
      'prop-123',
      'yield_hunter',
      'en',
      expect.anything(),
    );
  });

  it('FAILS CLOSED: ADAPT_API_KEY unset + non-empty bearer + no key row → 401 (regression guard)', async () => {
    mockSelectLimit.mockResolvedValue([]);
    const res = await GET(makeGetRequest('Bearer any_token_will_do', SPOOFED_TENANT));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(mockGetPg).not.toHaveBeenCalled();
  });

  it('unknown bearer (no matching api_keys row) → 401', async () => {
    mockSelectLimit.mockResolvedValue([]);
    const res = await GET(makeGetRequest('Bearer not-a-registered-key'));
    expect(res.status).toBe(401);
  });

  it('revoked API key (filtered out by WHERE revoked_at IS NULL → no rows) → 401', async () => {
    mockSelectLimit.mockResolvedValue([]);
    const res = await GET(makeGetRequest(`Bearer ${VALID_API_KEY}`));
    expect(res.status).toBe(401);
  });

  it('resolveApiKey DB error (configured-but-failed, Rule K.2) → 401, never fabricates a tenant', async () => {
    mockSelectLimit.mockRejectedValueOnce(new Error('connection refused'));
    const res = await GET(makeGetRequest(`Bearer ${VALID_API_KEY}`));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(mockGetPg).not.toHaveBeenCalled();
  });

  it('ops-bypass valid (ADAPT_API_KEY + OPS_TENANT_ID) → 200; tenant = OPS_TENANT_ID, resolveApiKey skipped', async () => {
    vi.stubEnv('ADAPT_API_KEY', OPS_KEY);
    vi.stubEnv('OPS_TENANT_ID', OPS_TENANT);

    const res = await GET(makeGetRequest(`Bearer ${OPS_KEY}`, SPOOFED_TENANT));

    expect(res.status).toBe(200);
    expect(mockGetPg).toHaveBeenCalledWith(
      OPS_TENANT,
      'prop-123',
      'yield_hunter',
      'en',
      expect.anything(),
    );
    // The ops path never consults the api_keys table.
    expect(mockSelectLimit).not.toHaveBeenCalled();
  });

  it('ops-bypass misconfigured (ADAPT_API_KEY set, OPS_TENANT_ID unset) → 500 INTERNAL_ERROR', async () => {
    vi.stubEnv('ADAPT_API_KEY', OPS_KEY);
    vi.stubEnv('OPS_TENANT_ID', '');

    const res = await GET(makeGetRequest(`Bearer ${OPS_KEY}`));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toContain('OPS_TENANT_ID');
  });

  it('missing Authorization header → 401 AUTH_REQUIRED (before the resolver)', async () => {
    const res = await GET(makeGetRequest(null));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });
});

describe('GET /api/adapt/description — FOLLOW-943: an origin refusal is 403, not 401', () => {
  // Asserted on the ROUTE's response and not on `resolveAdaptGetAuth`'s return value. The route
  // passes `authResult.status` through verbatim, which is exactly the kind of one-line hop that
  // looked safe for `Vary: Origin` and was not (FOLLOW-956) — so the assertion sits where the
  // caller answers.
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectLimit.mockReset().mockResolvedValue([]);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('OPS_TENANT_ID', '');
    vi.stubEnv('ADAPT_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('valid key, disallowed origin → 403 (was 401 "Invalid API key" on a VALID key)', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', TENANT_A);
    mockSelectLimit
      .mockResolvedValueOnce([await makeApiKeyRow(VALID_API_KEY, TENANT_A)])
      .mockResolvedValueOnce([{ allowedOrigins: ['https://homes.clientbrand.com'] }]);

    const res = await GET(makeGetRequest(`Bearer ${VALID_API_KEY}`, null, 'https://evil.test'));

    expect(res.status).toBe(403);
  });

  it('FOLLOW-957: valid key, unresolvable first party → 403, and the reason names the cause', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', '');
    mockSelectLimit
      .mockResolvedValueOnce([await makeApiKeyRow(VALID_API_KEY, TENANT_A)])
      .mockResolvedValueOnce([{ allowedOrigins: ['https://homes.clientbrand.com'] }]);

    const res = await GET(
      makeGetRequest(`Bearer ${VALID_API_KEY}`, null, 'https://app.estalara.com'),
    );

    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain('first_party_unverified');
  });

  it('an unknown key is still 401 — the key-existence oracle protection is untouched', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', TENANT_A);
    mockSelectLimit.mockResolvedValue([]);

    const res = await GET(makeGetRequest('Bearer nope', null, 'https://app.estalara.com'));

    expect(res.status).toBe(401);
  });
});
