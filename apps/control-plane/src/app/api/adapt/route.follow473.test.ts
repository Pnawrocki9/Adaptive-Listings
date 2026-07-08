/**
 * Auth-matrix tests for GET /api/adapt — FOLLOW-473 (RETRO-158 / FOLLOW-510).
 *
 * Closes the fail-open + spoofable-`x-tenant-id` gap on the highest-blast-radius
 * read route in the repo. Before this fix the handler accepted "any non-empty
 * bearer" whenever `ADAPT_API_KEY` was unset, and derived the tenant from an
 * unverified `x-tenant-id` header. It now runs the SAME two-step resolver used by
 * `POST /api/adapt/feedback` (ADR-0015): `resolveApiKey()` primary +
 * `ADAPT_API_KEY`/`OPS_TENANT_ID`-scoped ops-bypass.
 *
 * This suite exercises `resolveAdaptGetAuth` END-TO-END (it is NOT mocked here —
 * unlike the peripheral GET suites); the `api_keys` DB lookup actually executes
 * against a controllable `@estalara/db` mock, mirroring route.follow451.test.ts's
 * philosophy for the POST path.
 *
 * Coverage (ticket AC test matrix, parity with FOLLOW-451):
 *   - Valid registered api_keys row → 200, tenant taken from the KEY (not the
 *     spoofed x-tenant-id header).
 *   - Ops-bypass valid (ADAPT_API_KEY + OPS_TENANT_ID) → 200, tenant = OPS_TENANT_ID.
 *   - Ops-bypass misconfigured (ADAPT_API_KEY set, OPS_TENANT_ID unset) → 500.
 *   - ADAPT_API_KEY UNSET + non-empty bearer + no key row → 401 (FAILS CLOSED —
 *     the core regression guard for this ticket).
 *   - Unknown / revoked key → 401.
 *   - Configured-but-failed DB (Rule K.2) → 401, never fabricates a tenant.
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow473.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock decision-tree dependencies (not under test here) ───────────────────

vi.mock('@/lib/llm-gateway', () => ({
  callLlmGateway: vi.fn().mockResolvedValue(null),
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

vi.mock('@/lib/embedding-lookup', () => ({
  fetchArchetypeEmbedding: vi.fn().mockResolvedValue(null),
  fetchListingEmbeddings: vi.fn().mockResolvedValue(new Map()),
  LISTING_EMBEDDING_BATCH_LIMIT: 20,
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

// ─── @estalara/db mock — controllable api_keys lookup for resolveApiKey() ─────
//
// A single shared `mockSelectLimit` backs every db.select().from().where().limit()
// chain (resolveApiKey's api_keys lookup AND checkPilotFrozenAsync's tenants
// lookup, which runs fire-and-forget). Same scaffolding as route.follow451.test.ts.

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

// NOTE: resolveAdaptGetAuth / resolveApiKey / secret-compare are NOT mocked — the
// full two-step auth path runs end-to-end (the point of this suite).
import { GET } from './route';
import { getBanditArms } from '@/lib/bandit-query';

const mockGetBanditArms = vi.mocked(getBanditArms);

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
  session_id: 'sess-follow473-001',
  archetype: 'yield_hunter',
  confidence: '0.75',
  similarity: '0.90',
  tier: '1',
};

function makeGetRequest(
  authHeader: string | null,
  xTenantId: string | null = SPOOFED_TENANT,
): NextRequest {
  const url = new URL('http://localhost/api/adapt');
  for (const [k, v] of Object.entries(VALID_PARAMS)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (authHeader !== null) headers.Authorization = authHeader;
  // Deliberately include a SPOOFED x-tenant-id so tests can prove it is ignored.
  if (xTenantId !== null) headers['x-tenant-id'] = xTenantId;
  return new NextRequest(url, { headers });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/adapt — two-step auth (FOLLOW-473)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectLimit.mockReset().mockResolvedValue([]);
    mockGetBanditArms
      .mockReset()
      .mockResolvedValue([{ variant: 'control', alpha: 1, beta: 1, paused: false }]);
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
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
    // The bandit query is keyed on the RESOLVED tenant (TENANT_A), never the
    // spoofed x-tenant-id header — proving the header is no longer an authority.
    expect(mockGetBanditArms).toHaveBeenCalledWith(TENANT_A, 'yield_hunter');
    expect(mockGetBanditArms).not.toHaveBeenCalledWith(SPOOFED_TENANT, 'yield_hunter');
  });

  it('FAILS CLOSED: ADAPT_API_KEY unset + non-empty bearer + no key row → 401 (regression guard)', async () => {
    // This is the exact pre-fix fail-open case: no ADAPT_API_KEY, arbitrary bearer.
    mockSelectLimit.mockResolvedValue([]);

    const res = await GET(makeGetRequest('Bearer any_token_will_do', SPOOFED_TENANT));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
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
    // No decision was produced — auth failed before the decision tree ran.
    expect(mockGetBanditArms).not.toHaveBeenCalled();
  });

  it('ops-bypass valid (ADAPT_API_KEY + OPS_TENANT_ID) → 200; tenant = OPS_TENANT_ID, resolveApiKey skipped', async () => {
    vi.stubEnv('ADAPT_API_KEY', OPS_KEY);
    vi.stubEnv('OPS_TENANT_ID', OPS_TENANT);

    const res = await GET(makeGetRequest(`Bearer ${OPS_KEY}`, SPOOFED_TENANT));

    expect(res.status).toBe(200);
    expect(mockGetBanditArms).toHaveBeenCalledWith(OPS_TENANT, 'yield_hunter');
    // Proof the ops path skips resolveApiKey: the api_keys mock returns NO rows
    // (default []), yet the request still 200s. Had Step 2 (resolveApiKey) run, a
    // no-row lookup would 404→401 — so the tenant came from OPS_TENANT_ID, not the
    // api_keys table. (mockSelectLimit is also hit by the fire-and-forget
    // pilot-frozen tenants lookup, so it cannot be asserted "not called" here.)
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

  it('ADAPT_API_KEY set but bearer is a real tenant key (not the ops secret) → resolves via api_keys, 200', async () => {
    // Proves the ops-bypass does not shadow real tenant traffic: a non-matching
    // bearer falls through to resolveApiKey (Step 2) even when ADAPT_API_KEY is set.
    vi.stubEnv('ADAPT_API_KEY', OPS_KEY);
    vi.stubEnv('OPS_TENANT_ID', OPS_TENANT);
    mockSelectLimit.mockResolvedValue([await makeApiKeyRow(VALID_API_KEY, TENANT_A)]);

    const res = await GET(makeGetRequest(`Bearer ${VALID_API_KEY}`, SPOOFED_TENANT));

    expect(res.status).toBe(200);
    expect(mockGetBanditArms).toHaveBeenCalledWith(TENANT_A, 'yield_hunter');
  });

  it('missing Authorization header → 401 AUTH_REQUIRED (before the resolver)', async () => {
    const res = await GET(makeGetRequest(null));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });
});
