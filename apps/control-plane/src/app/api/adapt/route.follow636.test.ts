/**
 * FOLLOW-636 — end-to-end enforcement of demo-session revocation on POST /api/adapt.
 *
 * Proves the runtime gap is closed at the ACTUAL adapt demo-JWT path (not just in
 * the unit helper): a demo token whose signature + `exp` are perfectly valid is
 * STILL refused once its `demo_sessions.revoked_at` is set. Coverage:
 *
 *   1. Signature-valid demo JWT, session row NOT revoked → 200 (serves).
 *   2. Signature-valid demo JWT, session row revoked      → 401 invalid_demo_token.
 *   3. Signature-valid demo JWT, revocation lookup THROWS  → 200 (fail-open — a DB
 *      blip must not break a legitimate live demo; signature+exp stayed fail-closed).
 *
 * Test strategy mirrors route.demo-auth.test.ts: stub DEMO_MODE_JWT_SECRET, mint a
 * REAL HS256 JWT carrying `session_id`, and drive the full POST handler with a
 * controllable createAdminClient so the demo_sessions row (and its throw) is
 * exercised through the real code path — verifyDemoJwt is NOT mocked.
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow636.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Controllable service-role DB (shared by resolveDemoSessionRevocation + resolveAlEnablement) ──
const { dbRef, createAdminClientMock } = vi.hoisted(() => {
  const ref: { rows: unknown[]; throwOnQuery: boolean } = { rows: [], throwOnQuery: false };
  const builder = {
    select: () => builder,
    from: () => builder,
    where: () => builder,
    limit: () => {
      if (ref.throwOnQuery) return Promise.reject(new Error('simulated demo_sessions DB failure'));
      return Promise.resolve(ref.rows);
    },
  };
  return { dbRef: ref, createAdminClientMock: vi.fn(() => builder) };
});

// ─── Mock external dependencies (not under test here) ─────────────────────────

vi.mock('@/lib/llm-gateway', () => ({
  callLlmGateway: vi.fn().mockResolvedValue(null),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn().mockResolvedValue(null),
}));

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
  createAdminClient: createAdminClientMock,
  tenants: { id: 'id', alEnabled: 'al_enabled', status: 'status' },
  demoSessions: { id: 'id', revokedAt: 'revoked_at' },
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

// verifyDemoJwt + resolveDemoSessionRevocation are NOT mocked — full path runs.
import { POST } from './route';

// ─── JWT helpers ──────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-demo-secret-at-least-32-chars-long!!';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function encodeSegment(obj: Record<string, unknown>): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function buildDemoJwt(extra: Record<string, unknown>): Promise<string> {
  const header = encodeSegment({ alg: 'HS256', typ: 'JWT' });
  const nowSecs = Math.floor(Date.now() / 1000);
  const payload = encodeSegment({ sub: 'demo', iat: nowSecs, exp: nowSecs + 3600, ...extra });
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(TEST_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(sig))}`;
}

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';
const SESSION_ID = '22222222-2222-2222-2222-222222222222';

const BASE_BODY = {
  tenant_id: TENANT_ID,
  session_id: 'sess-runtime-001',
  page_type: 'listing_detail',
  archetype_hint: 'neutral',
  confidence: 0.5,
  similarity: 0.5,
};

function makePostRequest(authHeader: string): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify(BASE_BODY),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/adapt — demo-session revocation enforcement (FOLLOW-636)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRef.rows = [];
    dbRef.throwOnQuery = false;
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubEnv('DEMO_MODE_JWT_SECRET', TEST_SECRET);
    // "configured" so resolveDemoSessionRevocation runs the query path, not the dev short-circuit.
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgres://test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('valid demo JWT + NON-revoked session row → 200 (serves)', async () => {
    dbRef.rows = [{ revokedAt: null }];
    const token = await buildDemoJwt({ tenant_id: TENANT_ID, session_id: SESSION_ID });
    const res = await POST(makePostRequest(`Bearer ${token}`));
    expect(res.status).toBe(200);
  });

  it('valid demo JWT + REVOKED session row → 401 invalid_demo_token (runtime cut-off)', async () => {
    dbRef.rows = [{ revokedAt: new Date('2026-07-24T00:00:00Z') }];
    const token = await buildDemoJwt({ tenant_id: TENANT_ID, session_id: SESSION_ID });
    const res = await POST(makePostRequest(`Bearer ${token}`));
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_demo_token');
  });

  it('valid demo JWT + revocation lookup THROWS → 200 (fail-open, demo not broken)', async () => {
    dbRef.throwOnQuery = true;
    const token = await buildDemoJwt({ tenant_id: TENANT_ID, session_id: SESSION_ID });
    const res = await POST(makePostRequest(`Bearer ${token}`));
    expect(res.status).toBe(200);
  });
});
