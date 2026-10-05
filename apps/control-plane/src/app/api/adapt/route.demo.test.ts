/**
 * `POST /api/adapt` — stage: DEMO MODE (FOLLOW-1288, WP-2.3).
 *
 * The demo-only behaviour of the decision route lives in `lib/demo/adapt-demo-context.ts` and runs
 * only when the control plane is started with `DEMO_MODE=1` (`lib/demo/demo-mode.ts`, the one place
 * the flag is read). This file pins both sides of that switch:
 *
 *   - FLAG ON — characterisation, written against the route BEFORE the move and kept green after
 *     it: (a) a real HS256 demo JWT is accepted and its `tenant_id` claim is authoritative, (b) the
 *     per-tenant archetype override replaces the SDK hint and forces the operator's model, (c) a
 *     revoked demo session is cut off at runtime, plus the ops caller (`ADAPT_API_KEY`) and the
 *     `demo_auth_misconfigured` 500.
 *   - FLAG OFF — the route behaves as if the demo code did not exist: the same demo JWT goes to the
 *     tenant API-key path and gets that path's normal `401 invalid_demo_token`; the override store is
 *     never read; the ops bearer is just an unknown key; a missing `DEMO_MODE_JWT_SECRET` no longer
 *     500s a real tenant key.
 *
 * The JWTs are real (signed with Web Crypto, verified by the unmocked `verifyDemoJwt`), so "a demo
 * JWT is rejected with the flag off" is proven with a token the flag-on path accepts.
 *
 * @module apps/control-plane/src/app/api/adapt/route.demo.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { callLlmGateway } from '@/lib/llm-gateway';
import { getDemoOverride } from '@/lib/demo-override-store';
import { resolveDemoSessionRevocation } from '@/lib/demo-session-revocation';
import { resolveApiKey } from '@/lib/api-key-auth';
import { POST } from './route';

vi.mock('@/lib/llm-gateway', () => ({ callLlmGateway: vi.fn().mockResolvedValue(null) }));
vi.mock('@estalara/auth', () => ({ getAuthClaims: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi
    .fn()
    .mockResolvedValue([{ variant: 'control', alpha: 1, beta: 1, paused: false }]),
}));
vi.mock('@/lib/rag-retrieval', () => ({ retrieveListingContext: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/tenant-schema', () => ({ getTenantSchema: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/embedding-lookup', () => ({
  fetchArchetypeEmbedding: vi.fn().mockResolvedValue(null),
  fetchListingEmbeddings: vi.fn().mockResolvedValue(new Map()),
  LISTING_EMBEDDING_BATCH_LIMIT: 20,
}));
vi.mock('@/lib/al-enablement', () => ({
  resolveAlEnablement: vi.fn().mockResolvedValue({ off: false, reason: null }),
}));
vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: vi.fn(),
  DEMO_OVERRIDE_CONFIDENCE: 0.95,
  DEMO_OVERRIDE_SIMILARITY: 0.75,
}));
vi.mock('@/lib/demo-session-revocation', () => ({
  resolveDemoSessionRevocation: vi.fn(),
}));
vi.mock('@/lib/api-key-auth', () => ({ resolveApiKey: vi.fn() }));
vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  })),
  tenants: {},
}));
vi.mock('@estalara/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    assignHoldout: vi.fn().mockResolvedValue({
      holdout_group: false,
      skipped: false,
      assigned_at: new Date().toISOString(),
    }),
    thompsonSample: vi.fn().mockReturnValue('control'),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Built with `.repeat()` so no token-shaped literal lands in the repo (gitleaks). */
const TEST_SECRET = 'route-demo-test-secret.'.repeat(2);
const OPS_KEY = 'route-demo-ops-key.'.repeat(2);
const JWT_TENANT = '550e8400-e29b-41d4-a716-446655440001';
const BODY_TENANT = '550e8400-e29b-41d4-a716-446655440002';
const OPS_TENANT = '550e8400-e29b-41d4-a716-446655440003';
const DEMO_SESSION_ID = '7f1f3a4e-0000-4000-8000-000000000001';

const BASE_BODY = {
  tenant_id: BODY_TENANT,
  session_id: 'sess-route-demo-001',
  page_type: 'listing_detail',
  archetype_hint: 'neutral',
  confidence: 0.5,
  similarity: 0.5,
};

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** A real HS256 JWT signed with `TEST_SECRET`, valid for an hour. */
async function signDemoJwt(claims: Record<string, unknown>): Promise<string> {
  const enc = (o: Record<string, unknown>) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const now = Math.floor(Date.now() / 1000);
  const input = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: 'demo', iat: now, exp: now + 3600, ...claims })}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(TEST_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

function post(body: Record<string, unknown>, bearer: string): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

const mockGetDemoOverride = vi.mocked(getDemoOverride);
const mockRevocation = vi.mocked(resolveDemoSessionRevocation);
const mockResolveApiKey = vi.mocked(resolveApiKey);
const mockGateway = vi.mocked(callLlmGateway);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CLICKHOUSE_URL', '');
  vi.stubEnv('DEMO_MODE_JWT_SECRET', TEST_SECRET);
  vi.stubEnv('ADAPT_API_KEY', OPS_KEY);
  vi.stubEnv('OPS_TENANT_ID', OPS_TENANT);
  mockGetDemoOverride.mockResolvedValue({
    enabled: false,
    overrideArchetype: null,
    overrideModel: 'claude-sonnet-4-6',
  });
  mockRevocation.mockResolvedValue({ revoked: false });
  // The normal path for anything that is not a registered tenant key.
  mockResolveApiKey.mockResolvedValue({ ok: false, status: 401, error: 'invalid_api_key' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── FLAG ON — characterisation ───────────────────────────────────────────────

describe('POST /api/adapt with DEMO_MODE=1 — characterisation of the demo paths', () => {
  beforeEach(() => {
    vi.stubEnv('DEMO_MODE', '1');
  });

  it('(a) a valid demo JWT is accepted; its tenant_id claim supersedes the body; no API-key lookup', async () => {
    const jwt = await signDemoJwt({ tenant_id: JWT_TENANT });
    const res = await POST(post(BASE_BODY, jwt));

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.archetype).toBe('neutral');
    expect(body).not.toHaveProperty('demo_override');
    expect(mockResolveApiKey).not.toHaveBeenCalled();
    expect(mockGetDemoOverride).toHaveBeenCalledWith(JWT_TENANT);
  });

  it('(b) an enabled archetype override replaces the SDK hint and forces the operator model', async () => {
    mockGetDemoOverride.mockResolvedValue({
      enabled: true,
      overrideArchetype: 'luxury_buyer',
      overrideModel: 'claude-haiku-4-5',
    });
    const jwt = await signDemoJwt({ tenant_id: JWT_TENANT });
    const res = await POST(post(BASE_BODY, jwt));

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.archetype).toBe('luxury_buyer');
    expect(body.confidence).toBe(0.95);
    expect(body.similarity).toBe(0.75);
    expect(body.demo_override).toBe(true);
    expect(mockGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        archetypeId: 'luxury_buyer',
        forceModel: 'claude-haiku-4-5',
      }),
    );
  });

  it('(b) an override store failure degrades to the SDK hint (no demo_override flag)', async () => {
    mockGetDemoOverride.mockRejectedValue(new Error('db down'));
    const jwt = await signDemoJwt({ tenant_id: JWT_TENANT });
    const res = await POST(post({ ...BASE_BODY, archetype_hint: 'yield_hunter' }, jwt));

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.archetype).toBe('yield_hunter');
    expect(body).not.toHaveProperty('demo_override');
  });

  it('(c) a REVOKED demo session is cut off with 401 invalid_demo_token', async () => {
    mockRevocation.mockResolvedValue({ revoked: true });
    const jwt = await signDemoJwt({ tenant_id: JWT_TENANT, session_id: DEMO_SESSION_ID });
    const res = await POST(post(BASE_BODY, jwt));

    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe('invalid_demo_token');
    expect(mockRevocation).toHaveBeenCalledWith(DEMO_SESSION_ID);
  });

  it('(c) a non-revoked demo session serves', async () => {
    const jwt = await signDemoJwt({ tenant_id: JWT_TENANT, session_id: DEMO_SESSION_ID });
    const res = await POST(post(BASE_BODY, jwt));

    expect(res.status).toBe(200);
    expect(mockRevocation).toHaveBeenCalledWith(DEMO_SESSION_ID);
  });

  it('the ops caller (ADAPT_API_KEY) is pinned to OPS_TENANT_ID and never reaches resolveApiKey', async () => {
    const ok = await POST(post({ ...BASE_BODY, tenant_id: OPS_TENANT }, OPS_KEY));
    expect(ok.status).toBe(200);

    const crossTenant = await POST(post(BASE_BODY, OPS_KEY));
    expect(crossTenant.status).toBe(403);
    expect((await json(crossTenant)).error).toBe('FORBIDDEN');
    expect(mockResolveApiKey).not.toHaveBeenCalled();
    expect(mockRevocation).not.toHaveBeenCalled();
  });

  it('the ops caller with OPS_TENANT_ID unset → 500 ops_auth_misconfigured', async () => {
    vi.stubEnv('OPS_TENANT_ID', '');
    const res = await POST(post(BASE_BODY, OPS_KEY));
    expect(res.status).toBe(500);
    expect((await json(res)).error).toBe('ops_auth_misconfigured');
  });

  it('DEMO_MODE_JWT_SECRET unset → 500 demo_auth_misconfigured, even for a real tenant key', async () => {
    vi.stubEnv('DEMO_MODE_JWT_SECRET', '');
    mockResolveApiKey.mockResolvedValue({ ok: true, tenantId: BODY_TENANT });
    const res = await POST(post(BASE_BODY, 'pk_live_route_demo_fixture'));
    expect(res.status).toBe(500);
    expect((await json(res)).error).toBe('demo_auth_misconfigured');
  });

  it('a bearer that is neither a demo JWT nor the ops key falls back to resolveApiKey', async () => {
    mockResolveApiKey.mockResolvedValue({ ok: true, tenantId: BODY_TENANT });
    const res = await POST(post(BASE_BODY, 'pk_live_route_demo_fixture'));
    expect(res.status).toBe(200);
    expect(mockResolveApiKey).toHaveBeenCalledTimes(1);
  });
});

// ─── FLAG OFF — the demo code does not exist ──────────────────────────────────

describe.each([
  ['unset', ''],
  ['any value other than "1"', 'true'],
])('POST /api/adapt with DEMO_MODE %s — the demo paths are absent', (_label, value) => {
  beforeEach(() => {
    vi.stubEnv('DEMO_MODE', value);
  });

  it('a VALID demo JWT is rejected by the normal API-key path with its normal 401 invalid_demo_token', async () => {
    const jwt = await signDemoJwt({ tenant_id: JWT_TENANT, session_id: DEMO_SESSION_ID });
    const res = await POST(post(BASE_BODY, jwt));

    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe('invalid_demo_token');
    // It went to the tenant API-key path, and nothing demo-specific ran.
    expect(mockResolveApiKey).toHaveBeenCalledTimes(1);
    expect(mockRevocation).not.toHaveBeenCalled();
    expect(mockGetDemoOverride).not.toHaveBeenCalled();
  });

  it('the answer to a demo JWT is byte-identical to the answer to an unknown bearer', async () => {
    const jwt = await signDemoJwt({ tenant_id: JWT_TENANT });
    const demo = await POST(post(BASE_BODY, jwt));
    const unknown = await POST(post(BASE_BODY, 'not-a-registered-key'));
    expect(demo.status).toBe(unknown.status);
    expect(await demo.text()).toBe(await unknown.text());
  });

  it('the ADAPT_API_KEY ops bearer is just an unregistered key → 401 invalid_demo_token', async () => {
    const res = await POST(post({ ...BASE_BODY, tenant_id: OPS_TENANT }, OPS_KEY));
    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe('invalid_demo_token');
    expect(mockResolveApiKey).toHaveBeenCalledTimes(1);
  });

  it('an enabled override is never read: a real tenant key gets its own hint, no demo_override', async () => {
    mockGetDemoOverride.mockResolvedValue({
      enabled: true,
      overrideArchetype: 'luxury_buyer',
      overrideModel: 'claude-haiku-4-5',
    });
    mockResolveApiKey.mockResolvedValue({ ok: true, tenantId: BODY_TENANT });
    // confidence > 0.6 and similarity in the tweak band, so the request reaches the LLM call.
    const res = await POST(
      post(
        { ...BASE_BODY, archetype_hint: 'yield_hunter', confidence: 0.9, similarity: 0.7 },
        'pk_live_fixture',
      ),
    );

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.archetype).toBe('yield_hunter');
    expect(body).not.toHaveProperty('demo_override');
    expect(mockGetDemoOverride).not.toHaveBeenCalled();
    expect(mockGateway).toHaveBeenCalledTimes(1);
    expect(mockGateway).toHaveBeenCalledWith(
      expect.not.objectContaining({ forceModel: expect.anything() as unknown }),
    );
  });

  it('DEMO_MODE_JWT_SECRET unset does NOT 500 a real tenant key (the secret is not read)', async () => {
    vi.stubEnv('DEMO_MODE_JWT_SECRET', '');
    mockResolveApiKey.mockResolvedValue({ ok: true, tenantId: BODY_TENANT });
    const res = await POST(post(BASE_BODY, 'pk_live_fixture'));
    expect(res.status).toBe(200);
  });
});
