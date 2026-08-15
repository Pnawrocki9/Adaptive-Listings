/**
 * Auth hardening tests for POST /api/adapt — FOLLOW-205.
 *
 * Verifies that the demo-mode endpoint performs real HS256 JWT verification
 * rather than a presence-only Bearer check. Coverage:
 *
 *   AC1: Arbitrary non-empty Bearer string (not a valid JWT) → 401
 *          with JSON body { error: 'invalid_demo_token' }
 *   AC2: Valid JWT signed by DEMO_MODE_JWT_SECRET → proceeds normally (200)
 *   AC3: Expired JWT (exp in the past) → 401
 *          with JSON body { error: 'invalid_demo_token' }
 *
 * Test strategy: stub DEMO_MODE_JWT_SECRET via vi.stubEnv, generate real
 * HS256 JWTs using crypto.subtle (Web Crypto API, available in Node 15+),
 * and import the POST handler without mocking verifyDemoJwt so the full
 * auth path runs end-to-end.
 *
 * All other external dependencies are mocked so the test does not require
 * a live database, ClickHouse, Redis, or LLM connection.
 *
 * @module apps/control-plane/src/app/api/adapt/route.demo-auth.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock external dependencies (not under test here) ─────────────────────────

vi.mock('@/lib/llm-gateway', () => ({
  callLlmGateway: vi.fn().mockResolvedValue(null),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn().mockResolvedValue(null),
}));

// FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi
    .fn()
    .mockResolvedValue([{ variant: 'control', alpha: 1, beta: 1, paused: false }]),
}));

vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/embedding-lookup', () => ({
  fetchArchetypeEmbedding: vi.fn().mockResolvedValue(null),
  fetchListingEmbeddings: vi.fn().mockResolvedValue(new Map()),
  LISTING_EMBEDDING_BATCH_LIMIT: 20,
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  })),
  tenants: {},
  demoOverrides: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: vi.fn().mockResolvedValue({
    enabled: false,
    overrideArchetype: null,
    overrideModel: 'claude-sonnet-4-6',
  }),
  DEMO_OVERRIDE_CONFIDENCE: 0.95,
  DEMO_OVERRIDE_SIMILARITY: 0.75,
}));

vi.mock('@estalara/shared', async () => {
  const mod = await vi.importActual<Record<string, unknown>>('@estalara/shared');
  return {
    ...mod,
    assignHoldout: vi.fn().mockResolvedValue({
      holdout_group: false,
      skipped: false,
      assigned_at: new Date().toISOString(),
    }),
    thompsonSample: vi.fn().mockReturnValue('control'),
  };
});

// NOTE: verifyDemoJwt is NOT mocked here — we test the full auth path.
import { POST } from './route';
import { getDemoOverride } from '@/lib/demo-override-store';

// ─── JWT helpers ──────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-demo-secret-at-least-32-chars-long!!';

/** Base64url-encode a Uint8Array. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Encode a JSON object as base64url. */
function encodeSegment(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(json);
  return toBase64Url(bytes);
}

/**
 * Build a real HS256 JWT signed with TEST_SECRET.
 * `expOffsetSeconds` is relative to now: positive = expires in future, negative = already expired.
 */
async function buildJwt(
  expOffsetSeconds: number,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const header = encodeSegment({ alg: 'HS256', typ: 'JWT' });
  const nowSecs = Math.floor(Date.now() / 1000);
  const payload = encodeSegment({
    sub: 'demo',
    iat: nowSecs,
    exp: nowSecs + expOffsetSeconds,
    ...extra,
  });

  const signingInput = `${header}.${payload}`;
  const keyMaterial = new TextEncoder().encode(TEST_SECRET);
  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput),
  );
  const signature = toBase64Url(new Uint8Array(signatureBuffer));

  return `${signingInput}.${signature}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';

const BASE_BODY = {
  tenant_id: TENANT_ID,
  session_id: 'sess-auth-test-001',
  page_type: 'listing_detail',
  archetype_hint: 'neutral',
  confidence: 0.5,
  similarity: 0.5,
};

function makePostRequest(body: Record<string, unknown>, authHeader: string): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/adapt — demo JWT auth hardening (FOLLOW-205)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubEnv('DEMO_MODE_JWT_SECRET', TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('AC1: arbitrary non-empty Bearer string (not a JWT) → 401 invalid_demo_token', async () => {
    const res = await POST(makePostRequest(BASE_BODY, 'Bearer not-a-jwt-at-all'));

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_demo_token');
  });

  it('AC1: missing Authorization header → 401 invalid_demo_token', async () => {
    const req = new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BASE_BODY),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_demo_token');
  });

  it('AC2: valid JWT signed by DEMO_MODE_JWT_SECRET → 200', async () => {
    const token = await buildJwt(3600); // expires in 1 hour

    const res = await POST(makePostRequest(BASE_BODY, `Bearer ${token}`));

    expect(res.status).toBe(200);
  });

  it('AC2: JWT signed by wrong secret → 401 invalid_demo_token', async () => {
    // Build JWT with a different secret than what is configured
    const wrongSecretHeader = encodeSegmentDirect({ alg: 'HS256', typ: 'JWT' });
    const nowSecs = Math.floor(Date.now() / 1000);
    const wrongSecretPayload = encodeSegmentDirect({
      sub: 'demo',
      iat: nowSecs,
      exp: nowSecs + 3600,
    });
    const wrongKeyMaterial = new TextEncoder().encode('wrong-secret-32chars-long-enough!');
    const wrongKey = await crypto.subtle.importKey(
      'raw',
      wrongKeyMaterial,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const wrongSigBuffer = await crypto.subtle.sign(
      'HMAC',
      wrongKey,
      new TextEncoder().encode(`${wrongSecretHeader}.${wrongSecretPayload}`),
    );
    const wrongSig = toBase64Url(new Uint8Array(wrongSigBuffer));
    const wrongToken = `${wrongSecretHeader}.${wrongSecretPayload}.${wrongSig}`;

    const res = await POST(makePostRequest(BASE_BODY, `Bearer ${wrongToken}`));

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_demo_token');
  });

  it('AC3: expired JWT → 401 invalid_demo_token', async () => {
    const token = await buildJwt(-60); // expired 60 seconds ago

    const res = await POST(makePostRequest(BASE_BODY, `Bearer ${token}`));

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_demo_token');
  });

  it('missing DEMO_MODE_JWT_SECRET → 500 demo_auth_misconfigured', async () => {
    vi.stubEnv('DEMO_MODE_JWT_SECRET', '');

    const res = await POST(makePostRequest(BASE_BODY, 'Bearer some-token'));

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('demo_auth_misconfigured');
  });

  it('FOLLOW-260: JWT tenant_id supersedes body tenant_id (cross-tenant escalation blocked)', async () => {
    const jwtTenantId = '550e8400-e29b-41d4-a716-446655440099';
    const bodyTenantId = '550e8400-e29b-41d4-a716-446655440001';
    expect(jwtTenantId).not.toBe(bodyTenantId);

    const token = await buildJwt(3600, { tenant_id: jwtTenantId });

    const body = { ...BASE_BODY, tenant_id: bodyTenantId };
    const res = await POST(makePostRequest(body, `Bearer ${token}`));

    expect(res.status).toBe(200);
    // getDemoOverride must have been called with the JWT tenant, not the body tenant.
    const mockGetDemoOverride = vi.mocked(getDemoOverride);
    expect(mockGetDemoOverride).toHaveBeenCalledWith(jwtTenantId);
    expect(mockGetDemoOverride).not.toHaveBeenCalledWith(bodyTenantId);
  });
});

// ─── Internal duplicate for wrong-secret test (avoids circular import) ────────

function encodeSegmentDirect(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(json);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
