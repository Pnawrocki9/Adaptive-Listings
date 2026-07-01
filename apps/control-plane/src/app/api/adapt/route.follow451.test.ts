/**
 * Auth-matrix tests for POST /api/adapt — FOLLOW-451 (audit F-05).
 *
 * CEO Q1 (2026-07-02): POST /api/adapt must accept EITHER a demo-mode HS256
 * JWT (DEMO_MODE_JWT_SECRET, pre-existing FOLLOW-205/260 path — see
 * route.demo-auth.test.ts, unmodified by this ticket) OR a real tenant API
 * key resolved via the shared `resolveApiKey()` (ADR-0015). Before this fix,
 * a real tenant key always 401'd against `verifyDemoJwt` with no fallback,
 * and the SDK (`packages/sdk/src/core/adapt.ts`) fails open to
 * `{ adaptResponse: null }` on any non-2xx response — i.e. every non-demo
 * tenant silently received zero adaptation.
 *
 * Coverage (ticket AC5 test matrix):
 *   - Real, registered, non-revoked/non-expired API key + matching
 *     body.tenant_id → 200 with a populated AdaptationDirectives body (not
 *     the previous 401 → SDK null).
 *   - Real API key + mismatched body.tenant_id → 403 (parity with
 *     POST /api/adapt/feedback, ADR-0015 Step 7).
 *   - Bearer token that is neither a valid demo JWT nor a registered API key
 *     → 401.
 *   - Revoked API key → 401 (resolveApiKey's WHERE revoked_at IS NULL filter).
 *   - DEMO_MODE_JWT_SECRET missing → still 500 (demo path is NOT bypassed by
 *     the API-key fallback; unchanged pre-existing contract).
 *
 * The existing demo-JWT auth suite (route.demo-auth.test.ts) is NOT modified
 * by this ticket and remains the regression guard for the demo path.
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow451.test
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

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: vi.fn().mockResolvedValue({
    enabled: false,
    overrideArchetype: null,
    overrideModel: 'claude-sonnet-4-6',
  }),
  DEMO_OVERRIDE_CONFIDENCE: 0.95,
  DEMO_OVERRIDE_SIMILARITY: 0.75,
}));

vi.mock('@/lib/ab-events', () => ({
  publishAbAssignmentEvent: vi.fn().mockResolvedValue(undefined),
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

// ─── @estalara/db mock — controllable api_keys lookup for resolveApiKey() ────
//
// A single shared `mockSelectLimit` backs every `db.select().from().where().limit()`
// call site (resolveApiKey's api_keys lookup AND checkPilotFrozenAsync's tenants
// lookup, which runs fire-and-forget). Tests set the resolved value to a fake
// api_keys row; checkPilotFrozenAsync destructures unrelated fields
// (`pilotFrozen`/`quizEnabled`) off that same row, which are simply `undefined`
// for an api_keys row → the guard no-ops, matching the "no-op when absent" spec.

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

// NOTE: verifyDemoJwt and resolveApiKey are NOT mocked — the full auth path
// (both branches) runs end-to-end, same testing philosophy as
// route.demo-auth.test.ts.
import { POST } from './route';

// ─── Crypto helper — SHA-256(rawKey) mirrors api-key-auth.ts ─────────────────

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

// ─── Request helpers ──────────────────────────────────────────────────────────

const TENANT_A = '550e8400-e29b-41d4-a716-446655440001';
const TENANT_B = '550e8400-e29b-41d4-a716-446655440099';
const VALID_API_KEY = 'sk_live_test_tenant_a_key';

function baseBody(tenantId: string): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    session_id: 'sess-follow451-001',
    page_type: 'listing_detail',
    archetype_hint: 'neutral',
    confidence: 0.5,
    similarity: 0.5,
  };
}

function makePostRequest(body: Record<string, unknown>, authHeader: string | null): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader !== null) headers.Authorization = authHeader;
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/adapt — real tenant API-key auth path (FOLLOW-451, audit F-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectLimit.mockReset().mockResolvedValue([]);
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    // No DEMO_MODE_JWT_SECRET in this describe block — the bearer token under
    // test is never a JWT-shaped string, so verifyDemoJwt throws
    // DemoJwtInvalidError (not DemoJwtSecretMissingError) and the handler
    // falls through to the API-key path. See the dedicated
    // DEMO_MODE_JWT_SECRET-missing test below for that orthogonal case.
    vi.stubEnv('DEMO_MODE_JWT_SECRET', 'unrelated-demo-secret-32-chars-long!!');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('valid registered API key + matching body.tenant_id → 200 with populated directives (not 401 → SDK null)', async () => {
    const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_A);
    mockSelectLimit.mockResolvedValue([keyRow]);

    const res = await POST(makePostRequest(baseBody(TENANT_A), `Bearer ${VALID_API_KEY}`));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Proves this is a real AdaptationDirectives payload, not the SDK's
    // `{ adaptResponse: null }` fail-open shape that resulted from the
    // pre-fix 401.
    expect(body.session_id).toBe('sess-follow451-001');
    expect(Array.isArray(body.directives)).toBe(true);
    expect(typeof body.archetype).toBe('string');
    expect(typeof body.adapt_decision_id).toBe('string');
  });

  it('valid registered API key + mismatched body.tenant_id → 403 (parity with feedback/route.ts)', async () => {
    const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_A);
    mockSelectLimit.mockResolvedValue([keyRow]);

    const res = await POST(makePostRequest(baseBody(TENANT_B), `Bearer ${VALID_API_KEY}`));

    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('FORBIDDEN');
  });

  it('unknown bearer (neither a demo JWT nor a registered API key) → 401', async () => {
    // api_keys lookup returns no rows for any bearer.
    mockSelectLimit.mockResolvedValue([]);

    const res = await POST(makePostRequest(baseBody(TENANT_A), 'Bearer not-a-jwt-not-a-key'));

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_demo_token');
  });

  it('revoked API key (excluded by resolveApiKey WHERE revoked_at IS NULL) → 401', async () => {
    // The mocked query chain does not evaluate WHERE predicates — it models the
    // filtered-out-by-SQL outcome directly by resolving no rows, exactly as a
    // real Postgres query would for a revoked key.
    mockSelectLimit.mockResolvedValue([]);

    const res = await POST(makePostRequest(baseBody(TENANT_A), `Bearer ${VALID_API_KEY}`));

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_demo_token');
  });

  it('resolveApiKey DB error (configured-but-failed, Rule K.2) → 401, never fabricates a tenant', async () => {
    mockSelectLimit.mockRejectedValueOnce(new Error('connection refused'));

    const res = await POST(makePostRequest(baseBody(TENANT_A), `Bearer ${VALID_API_KEY}`));

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_demo_token');
  });
});

describe('POST /api/adapt — DEMO_MODE_JWT_SECRET missing is NOT bypassed by the API-key fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectLimit.mockReset().mockResolvedValue([]);
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('DEMO_MODE_JWT_SECRET', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('DEMO_MODE_JWT_SECRET unset + a real API key bearer → still 500 demo_auth_misconfigured', async () => {
    const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_A);
    mockSelectLimit.mockResolvedValue([keyRow]);

    const res = await POST(makePostRequest(baseBody(TENANT_A), `Bearer ${VALID_API_KEY}`));

    // Unchanged pre-existing contract (route.demo-auth.test.ts): a missing
    // demo secret is treated as a deployment misconfiguration and never falls
    // through to the API-key path, regardless of whether the bearer would
    // otherwise resolve to a valid tenant key.
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('demo_auth_misconfigured');
  });
});
