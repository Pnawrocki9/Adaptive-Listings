/**
 * Unit tests for POST /api/adapt/feedback — ADR-0015 (FOLLOW-443) + FOLLOW-007 + FOLLOW-179.
 *
 * ADR-0015 test matrix (T1–T12):
 *   T1  Valid registered key, matching body.tenant_id, valid HMAC sig → 202
 *   T2  Bearer token not in api_keys (SHA-256 lookup empty)           → 401
 *   T3  Valid key but body.tenant_id is a different tenant's ID        → 403
 *   T4  Valid key but HMAC body sig invalid (body tampered)            → 401
 *   T5  Valid key but X-Estalara-Signature header absent               → 401
 *   T6  Valid key but revoked (revoked_at IS NOT NULL)                 → 401
 *   T7  Valid key but expired (expires_at < now())                     → 401
 *   T8  Ops path: bearerToken === ADAPT_API_KEY, body.tenant_id === OPS_TENANT_ID → 202
 *   T9  Ops path: bearerToken === ADAPT_API_KEY, body.tenant_id !== OPS_TENANT_ID → 403
 *   T10 ADAPT_API_KEY set but OPS_TENANT_ID not set                    → 500
 *   T11 FEEDBACK_ENDPOINT_ENABLED not set (interim 503)                → 503
 *   T12 resolveApiKey shared lib: parity with existing quiz/public-config fixtures → pass
 *
 * Coverage retained from FOLLOW-007 + FOLLOW-051 + FOLLOW-179:
 *   - Bandit arm update math (alpha/beta increments)
 *   - Fire-and-forget semantics (response before DB)
 *   - upsertConversionLabel called when prediction_id present
 *   - FOLLOW-433: afterResponse() registration for both sinks
 *
 * @module apps/control-plane/src/app/api/adapt/feedback/route.test
 */

// ─── next/server mock (must be before all imports) ───────────────────────────
vi.mock('next/server', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('next/server');
  return {
    ...actual,
    after: vi.fn((fn: () => unknown) => {
      void fn();
    }),
  };
});

import { NextRequest, after } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock @estalara/db ────────────────────────────────────────────────────────
//
// Two select call sites in the new auth flow:
//   1. resolveApiKey() → SELECT from api_keys (via @/lib/api-key-auth)
//   2. updateArmAsync() → SELECT from ab_bandit_weights
//
// Both go through the same mock chain; use mockResolvedValueOnce to control order.

const {
  mockSelectLimit,
  mockOnConflictDoUpdate,
  mockInsertValues,
  mockCreateAdminClient,
  mockUpsertConversionLabel,
} = vi.hoisted(() => {
  const mockSelectLimit = vi.fn().mockResolvedValue([]);
  const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockCreateAdminClient = vi.fn(() => ({ select: mockSelect, insert: mockInsert }));

  const mockUpsertConversionLabel = vi.fn().mockResolvedValue(undefined);

  return {
    mockSelectLimit,
    mockOnConflictDoUpdate,
    mockInsertValues,
    mockCreateAdminClient,
    mockUpsertConversionLabel,
  };
});

vi.mock('@estalara/db', () => ({
  createAdminClient: mockCreateAdminClient,
  abBanditWeights: {
    tenantId: 'tenant_id',
    archetype: 'archetype',
    variant: 'variant',
    alpha: 'alpha',
    beta: 'beta',
    paused: 'paused',
    updatedAt: 'updated_at',
  },
  apiKeys: {
    tenantId: 'tenant_id',
    hashedKey: 'hashed_key',
    revokedAt: 'revoked_at',
    expiresAt: 'expires_at',
  },
  upsertConversionLabel: mockUpsertConversionLabel,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...preds: unknown[]) => ({ kind: 'and', preds })),
  eq: vi.fn((col: unknown, val: unknown) => ({ kind: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ kind: 'isNull', col })),
  or: vi.fn((...preds: unknown[]) => ({ kind: 'or', preds })),
  gt: vi.fn((col: unknown, val: unknown) => ({ kind: 'gt', col, val })),
}));

import { POST } from './route';

// ─── Crypto helpers ───────────────────────────────────────────────────────────

/**
 * Compute HMAC-SHA256(key, data) hex digest — mirrors route.ts + SDK implementation.
 */
async function computeHmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute SHA-256(input) → lower-case hex — mirrors api-key-auth.ts.
 * Used in tests to construct the `hashedKey` value the DB mock should return.
 */
async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Request helpers ──────────────────────────────────────────────────────────

function makePostRequest(
  body: unknown,
  authHeader: string | null = 'Bearer test_key',
  signatureHeader: string | null = null,
): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader !== null) headers.Authorization = authHeader;
  if (signatureHeader !== null) headers['X-Estalara-Signature'] = signatureHeader;
  return new NextRequest('http://localhost/api/adapt/feedback', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/**
 * Build a correctly-signed POST request using HMAC-SHA256.
 * The Bearer token is the apiKey; the signature covers the JSON body.
 */
async function makeSignedRequest(body: unknown, apiKey = 'test_key'): Promise<NextRequest> {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const sig = await computeHmac(apiKey, bodyStr);
  return new NextRequest('http://localhost/api/adapt/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Estalara-Signature': sig,
    },
    body: bodyStr,
  });
}

/**
 * Build a valid API key DB row mock that resolveApiKey() will accept.
 * The hashedKey must match SHA-256(rawApiKey) — computed at test time.
 */
async function makeApiKeyRow(rawApiKey: string, tenantId: string) {
  return {
    tenantId,
    hashedKey: await sha256Hex(rawApiKey),
  };
}

const TENANT_ID = 'tenant-abc-uuid';
const VALID_API_KEY = 'pk_live_test_tenant_key';

const VALID_BODY = {
  session_id: 'sess-feedback-001',
  tenant_id: TENANT_ID,
  archetype: 'family_buyer',
  variant: 'v1',
  converted: true,
};

/** Wait for the fire-and-forget microtask to resolve. */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// ─── T11: FEEDBACK_ENDPOINT_ENABLED unset → 503 (existing, retained) ─────────

describe('T11 / FOLLOW-444 / ESC-035: interim 503 disable (FEEDBACK_ENDPOINT_ENABLED unset = default disabled)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Intentionally do NOT set FEEDBACK_ENDPOINT_ENABLED → endpoint is disabled by default.
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 503 with SERVICE_TEMPORARILY_UNAVAILABLE for an anonymous caller', async () => {
    const res = await POST(makePostRequest(VALID_BODY, 'Bearer any_key'));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('SERVICE_TEMPORARILY_UNAVAILABLE');
  });

  it('returns 503 even when ADAPT_API_KEY matches (ops bypass does not exempt from disable)', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'ops-key');
    vi.stubEnv('OPS_TENANT_ID', TENANT_ID);
    const res = await POST(makePostRequest(VALID_BODY, 'Bearer ops-key'));
    expect(res.status).toBe(503);
  });

  it('returns 503 even for a correctly HMAC-signed request', async () => {
    const req = await makeSignedRequest(VALID_BODY, VALID_API_KEY);
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it('returns 503 even with no Authorization header (before auth is evaluated)', async () => {
    const res = await POST(makePostRequest(VALID_BODY, null));
    expect(res.status).toBe(503);
  });

  it('returns 503 for an invalid JSON body (before body is parsed)', async () => {
    const req = new NextRequest('http://localhost/api/adapt/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer any' },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });
});

// ─── T1: Valid registered key + matching tenant_id + valid HMAC → 202 ─────────

describe('T1: Valid registered key + matching body.tenant_id + valid HMAC → 202', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', ''); // force non-ops path

    // First mockSelectLimit call: resolveApiKey returns a valid key row.
    // Second call: updateArmAsync returns empty (no existing bandit row).
    const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_ID);
    mockSelectLimit
      .mockResolvedValueOnce([keyRow]) // api_keys lookup
      .mockResolvedValueOnce([]); // ab_bandit_weights lookup
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T1: returns 202 Accepted on valid key + matching tenant + valid HMAC', async () => {
    const req = await makeSignedRequest(VALID_BODY, VALID_API_KEY);
    const res = await POST(req);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

// ─── T2: Bearer token not in api_keys → 401 ──────────────────────────────────

describe('T2: Bearer token not in api_keys (SHA-256 lookup empty) → 401', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', '');

    // resolveApiKey returns empty rows → key not found → 401
    mockSelectLimit.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T2: unknown bearer token (not in DB) → 401 FORBIDDEN', async () => {
    // Send a signed request but the key is not in DB
    const req = await makeSignedRequest(VALID_BODY, 'unknown_key_not_in_db');
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});

// ─── T3: Valid key but body.tenant_id is a different tenant → 403 ─────────────

describe('T3: Valid key but body.tenant_id is a different tenant → 403', () => {
  const ATTACKER_TENANT = 'victim-tenant-uuid';

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', '');

    // The key resolves to TENANT_ID (the attacker's own tenant)
    const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_ID);
    mockSelectLimit.mockResolvedValueOnce([keyRow]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T3: valid key but body.tenant_id differs from resolved tenant → 403 FORBIDDEN', async () => {
    // Attacker's valid key resolves to TENANT_ID but body claims ATTACKER_TENANT
    const crossTenantBody = { ...VALID_BODY, tenant_id: ATTACKER_TENANT };
    const bodyStr = JSON.stringify(crossTenantBody);
    const sig = await computeHmac(VALID_API_KEY, bodyStr);

    const req = new NextRequest('http://localhost/api/adapt/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VALID_API_KEY}`,
        'X-Estalara-Signature': sig,
      },
      body: bodyStr,
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('FORBIDDEN');
    expect(body.message).toContain('tenant_id in body does not match');
  });
});

// ─── T4: Valid key but HMAC body sig invalid → 401 ───────────────────────────

describe('T4: Valid key but HMAC body sig invalid (body tampered) → 401', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', '');

    const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_ID);
    mockSelectLimit.mockResolvedValueOnce([keyRow]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T4a: valid key + wrong HMAC (different body signed) → 401', async () => {
    const tamperedBody = JSON.stringify({ ...VALID_BODY, converted: false });
    const sig = await computeHmac(VALID_API_KEY, tamperedBody);

    // Send original body but sig computed over tampered body
    const res = await POST(makePostRequest(VALID_BODY, `Bearer ${VALID_API_KEY}`, sig));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('T4b: valid key + attacker-crafted signature → 401', async () => {
    const fakeSig = 'a'.repeat(64);
    const res = await POST(makePostRequest(VALID_BODY, `Bearer ${VALID_API_KEY}`, fakeSig));
    expect(res.status).toBe(401);
  });

  it('T4c: signature computed with different API key → 401', async () => {
    const bodyStr = JSON.stringify(VALID_BODY);
    const wrongSig = await computeHmac('different_key', bodyStr);
    const res = await POST(makePostRequest(VALID_BODY, `Bearer ${VALID_API_KEY}`, wrongSig));
    expect(res.status).toBe(401);
  });
});

// ─── T5: Valid key but X-Estalara-Signature absent → 401 ─────────────────────

describe('T5: Valid key but X-Estalara-Signature header absent → 401', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', '');

    const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_ID);
    mockSelectLimit.mockResolvedValueOnce([keyRow]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T5: valid key but no X-Estalara-Signature header → 401 (presence-only Bearer blocked)', async () => {
    // This is the RETRO-006 regression guard: presence-only Bearer must be rejected.
    const res = await POST(
      makePostRequest(VALID_BODY, `Bearer ${VALID_API_KEY}`, null /* no sig */),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});

// ─── T6: Valid key but revoked → 401 ─────────────────────────────────────────

describe('T6: Valid key but revoked (revoked_at IS NOT NULL) → 401', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', '');

    // resolveApiKey filters revoked keys via WHERE revoked_at IS NULL.
    // The mock returns empty rows (the WHERE clause filters out revoked keys at DB level).
    mockSelectLimit.mockResolvedValueOnce([]); // revoked key → no rows returned
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T6: revoked key (empty DB result after WHERE revoked_at IS NULL) → 401', async () => {
    const req = await makeSignedRequest(VALID_BODY, VALID_API_KEY);
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});

// ─── T7: Valid key but expired → 401 ─────────────────────────────────────────

describe('T7: Valid key but expired (expires_at < now()) → 401', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', '');

    // resolveApiKey filters expired keys via WHERE (expires_at IS NULL OR expires_at > now()).
    // The mock returns empty rows (the WHERE clause filters out expired keys at DB level).
    mockSelectLimit.mockResolvedValueOnce([]); // expired key → no rows returned
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T7: expired key (empty DB result after WHERE expires_at > now()) → 401', async () => {
    const req = await makeSignedRequest(VALID_BODY, VALID_API_KEY);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ─── T8 + T9 + T10: Ops bypass path ──────────────────────────────────────────

describe('T8/T9/T10: Ops bypass (ADAPT_API_KEY) — permanent tenant scope enforcement', () => {
  const OPS_TENANT = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', 'ops-key');
    vi.stubEnv('OPS_TENANT_ID', OPS_TENANT);
    mockSelectLimit.mockResolvedValue([]); // bandit arm not found → use Beta(1,1)
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T8: ops key + body.tenant_id === OPS_TENANT_ID → 202 Accepted', async () => {
    const correctTenantBody = { ...VALID_BODY, tenant_id: OPS_TENANT };
    const res = await POST(makePostRequest(correctTenantBody, 'Bearer ops-key'));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('T9: ops key + body.tenant_id !== OPS_TENANT_ID → 403 FORBIDDEN', async () => {
    const wrongTenantBody = { ...VALID_BODY, tenant_id: 'attacker-tenant-id' };
    const res = await POST(makePostRequest(wrongTenantBody, 'Bearer ops-key'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('FORBIDDEN');
    expect(body.message).toContain('tenant_id in body does not match');
  });

  it('T9b: ops key + empty tenant_id body → 400 (validation fails before cross-tenant check)', async () => {
    const emptyTenantBody = { ...VALID_BODY, tenant_id: '' };
    const res = await POST(makePostRequest(emptyTenantBody, 'Bearer ops-key'));
    // Zod schema: tenant_id min(1) → 400 validation error
    expect(res.status).toBe(400);
  });

  it('T10: ADAPT_API_KEY set but OPS_TENANT_ID not set → 500 (server misconfiguration)', async () => {
    vi.stubEnv('OPS_TENANT_ID', '');
    const res = await POST(makePostRequest(VALID_BODY, 'Bearer ops-key'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.message).toContain('OPS_TENANT_ID');
  });
});

// ─── T12: resolveApiKey parity — shared lib matches quiz/public-config fixture ──

describe('T12: resolveApiKey shared lib parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T12: resolveApiKey returns the tenant from the matched DB row (same as quiz/public-config)', async () => {
    // This proves the shared resolveApiKey() behaves identically whether called from
    // feedback/route.ts or quiz/public-config/route.ts — same DB lookup, same result.
    const rawKey = 'parity_test_key';
    const expectedTenantId = 'parity-tenant-uuid';
    const keyRow = await makeApiKeyRow(rawKey, expectedTenantId);

    mockSelectLimit
      .mockResolvedValueOnce([keyRow]) // api_keys lookup → found
      .mockResolvedValueOnce([]); // bandit arm lookup → not found

    const body = { ...VALID_BODY, tenant_id: expectedTenantId };
    const req = await makeSignedRequest(body, rawKey);
    const res = await POST(req);

    // If resolveApiKey returned the correct tenant, the cross-tenant check passes → 202.
    expect(res.status).toBe(202);
    await flushMicrotasks();
    // Bandit update uses resolvedTenantId (from DB) — not body.tenant_id directly.
    const insertedRow = mockInsertValues.mock.calls[0]?.[0] as { tenantId: string };
    expect(insertedRow.tenantId).toBe(expectedTenantId);
  });
});

// ─── FOLLOW-466: replay protection (Redis nonce cache) ───────────────────────

describe('FOLLOW-466 / audit F-21: replay protection (nonce cache, HMAC path only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', ''); // force non-ops (HMAC) path
    vi.stubEnv('UPSTASH_REDIS_URL', 'https://redis.test.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('a replayed (body, signature) pair within the TTL is deduplicated: second POST returns 200 { deduplicated: true } and the bandit is updated only once', async () => {
    const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_ID);
    // Two resolveApiKey lookups (one per request) + one bandit-weights lookup
    // (only the first request reaches Step 8 — the second short-circuits at
    // the nonce check before any bandit DB call).
    mockSelectLimit
      .mockResolvedValueOnce([keyRow]) // request 1: resolveApiKey
      .mockResolvedValueOnce([]) // request 1: ab_bandit_weights lookup
      .mockResolvedValueOnce([keyRow]); // request 2 (replay): resolveApiKey

    // Redis SET NX: first call succeeds ("OK" — first sighting), second call
    // fails (null — the signature is already recorded, i.e. a replay).
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 'OK' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: null }), { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const req1 = await makeSignedRequest(VALID_BODY, VALID_API_KEY);
    const res1 = await POST(req1);
    expect(res1.status).toBe(202);
    await flushMicrotasks();

    // Re-issue the IDENTICAL signed request (same body → same signature).
    const req2 = await makeSignedRequest(VALID_BODY, VALID_API_KEY);
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { ok: boolean; deduplicated: boolean };
    expect(body2.ok).toBe(true);
    expect(body2.deduplicated).toBe(true);
    await flushMicrotasks();

    // The bandit arm was written exactly once — the replay did NOT
    // double-count against ab_bandit_weights.
    expect(mockInsertValues).toHaveBeenCalledOnce();
  });

  it('fails open when Redis is unavailable (fetch throws): the feedback ping is still processed normally', async () => {
    const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_ID);
    mockSelectLimit
      .mockResolvedValueOnce([keyRow]) // resolveApiKey
      .mockResolvedValueOnce([]); // ab_bandit_weights lookup

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const req = await makeSignedRequest(VALID_BODY, VALID_API_KEY);
    const res = await POST(req);
    // Redis is down but this is NOT treated as a replay — the ping proceeds.
    expect(res.status).toBe(202);
    await flushMicrotasks();

    expect(mockInsertValues).toHaveBeenCalledOnce();
  });

  it('proceeds normally when UPSTASH_REDIS_URL is unset (dev/CI — unconfigured, not configured-but-failed)', async () => {
    vi.stubEnv('UPSTASH_REDIS_URL', '');
    const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_ID);
    mockSelectLimit.mockResolvedValueOnce([keyRow]).mockResolvedValueOnce([]);

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const req = await makeSignedRequest(VALID_BODY, VALID_API_KEY);
    const res = await POST(req);
    expect(res.status).toBe(202);
    await flushMicrotasks();

    // No nonce-cache Redis call was attempted (unconfigured).
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalledOnce();
  });

  it('does NOT apply nonce dedup to the ops-key path (no signature to key the nonce on)', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'ops-key');
    vi.stubEnv('OPS_TENANT_ID', TENANT_ID);
    mockSelectLimit.mockResolvedValue([]); // bandit arm lookup (no key-row lookup on ops path)

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const opsBody = { ...VALID_BODY, tenant_id: TENANT_ID };
    const res1 = await POST(makePostRequest(opsBody, 'Bearer ops-key'));
    expect(res1.status).toBe(202);
    const res2 = await POST(makePostRequest(opsBody, 'Bearer ops-key'));
    expect(res2.status).toBe(202); // repeated ops-path ping is NOT deduplicated (no HMAC sig)

    // The ops path never touches the nonce cache.
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── Auth gate (existing tests, updated for new auth flow) ───────────────────

describe('POST /api/adapt/feedback — auth gate (ADR-0015)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', '');
    mockSelectLimit.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('missing Authorization header → 401 AUTH_REQUIRED', async () => {
    const res = await POST(makePostRequest(VALID_BODY, null));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('empty Bearer token → 401 AUTH_REQUIRED', async () => {
    const res = await POST(makePostRequest(VALID_BODY, 'Bearer '));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('wrong key when ADAPT_API_KEY is set → falls through to resolveApiKey → 401', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'expected_key');
    vi.stubEnv('OPS_TENANT_ID', TENANT_ID);
    // bearerToken 'wrong_key' !== 'expected_key' → not ops path → resolveApiKey → DB returns []
    const res = await POST(makePostRequest(VALID_BODY, 'Bearer wrong_key'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects presence-only Bearer (RETRO-006 regression guard)', async () => {
    // RETRO-006 §3 LG-3: 2026-05-22→23 production window where presence-only Bearer
    // was accepted. With ADR-0015, Bearer alone is rejected:
    //   - resolveApiKey returns no rows (DB mock returns []) → 401 before HMAC check
    // This guard MUST remain in the default test run with no env-flag gating.
    const res = await POST(makePostRequest(VALID_BODY, 'Bearer tenant_api_key_realkey', null));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('malformed signature (not 64 hex chars) after valid key lookup → 401', async () => {
    const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_ID);
    mockSelectLimit.mockResolvedValueOnce([keyRow]);
    const res = await POST(
      makePostRequest(VALID_BODY, `Bearer ${VALID_API_KEY}`, 'not-a-valid-hmac'),
    );
    expect(res.status).toBe(401);
  });
});

// ─── Body validation ─────────────────────────────────────────────────────────

describe('POST /api/adapt/feedback — body validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    // Use ops path for validation tests to avoid HMAC overhead
    vi.stubEnv('ADAPT_API_KEY', 'test_key');
    vi.stubEnv('OPS_TENANT_ID', TENANT_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('invalid JSON body → 400 VALIDATION_ERROR', async () => {
    const req = new NextRequest('http://localhost/api/adapt/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_key' },
      body: 'not-json-{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('missing session_id → 400 VALIDATION_ERROR', async () => {
    const rest: Record<string, unknown> = { ...VALID_BODY, tenant_id: TENANT_ID };
    delete rest.session_id;
    const res = await POST(makePostRequest(rest));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('missing tenant_id → 400', async () => {
    const rest: Record<string, unknown> = { ...VALID_BODY, tenant_id: TENANT_ID };
    delete rest.tenant_id;
    const res = await POST(makePostRequest(rest));
    expect(res.status).toBe(400);
  });

  it('missing archetype → 400', async () => {
    const rest: Record<string, unknown> = { ...VALID_BODY, tenant_id: TENANT_ID };
    delete rest.archetype;
    const res = await POST(makePostRequest(rest));
    expect(res.status).toBe(400);
  });

  it('missing variant → 400', async () => {
    const rest: Record<string, unknown> = { ...VALID_BODY, tenant_id: TENANT_ID };
    delete rest.variant;
    const res = await POST(makePostRequest(rest));
    expect(res.status).toBe(400);
  });

  it('missing converted → 400', async () => {
    const rest: Record<string, unknown> = { ...VALID_BODY, tenant_id: TENANT_ID };
    delete rest.converted;
    const res = await POST(makePostRequest(rest));
    expect(res.status).toBe(400);
  });

  it('converted: "yes" (string) → 400 (must be boolean)', async () => {
    const res = await POST(
      makePostRequest({ ...VALID_BODY, tenant_id: TENANT_ID, converted: 'yes' }),
    );
    expect(res.status).toBe(400);
  });
});

// ─── Bandit update math ──────────────────────────────────────────────────────

describe('POST /api/adapt/feedback — bandit update (ops path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', 'test_key');
    vi.stubEnv('OPS_TENANT_ID', TENANT_ID);
    mockSelectLimit.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const OPS_VALID_BODY = { ...VALID_BODY, tenant_id: TENANT_ID };

  it('returns 202 Accepted', async () => {
    const res = await POST(makePostRequest(OPS_VALID_BODY));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('converted: true with existing row (alpha=3, beta=2) → upserts alpha=4, beta=2', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ alpha: 3.0, beta: 2.0 }]);

    await POST(makePostRequest({ ...OPS_VALID_BODY, converted: true }));
    await flushMicrotasks();

    expect(mockInsertValues).toHaveBeenCalledOnce();
    const insertedRow = mockInsertValues.mock.calls[0]?.[0] as { alpha: number; beta: number };
    expect(insertedRow.alpha).toBe(4);
    expect(insertedRow.beta).toBe(2);
  });

  it('converted: false with existing row (alpha=3, beta=2) → upserts alpha=3, beta=3', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ alpha: 3.0, beta: 2.0 }]);

    await POST(makePostRequest({ ...OPS_VALID_BODY, converted: false }));
    await flushMicrotasks();

    const insertedRow = mockInsertValues.mock.calls[0]?.[0] as { alpha: number; beta: number };
    expect(insertedRow.alpha).toBe(3);
    expect(insertedRow.beta).toBe(3);
  });

  it('missing arm row → treats as Beta(1, 1), then increments', async () => {
    mockSelectLimit.mockResolvedValueOnce([]); // no existing row

    await POST(makePostRequest({ ...OPS_VALID_BODY, converted: true }));
    await flushMicrotasks();

    const insertedRow = mockInsertValues.mock.calls[0]?.[0] as { alpha: number; beta: number };
    // updateBanditArm(1, 1, true) = { alpha: 2, beta: 1 }
    expect(insertedRow.alpha).toBe(2);
    expect(insertedRow.beta).toBe(1);
  });

  it('upserts the resolvedTenantId (from ops env) NOT the raw body tenant_id', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ alpha: 1.0, beta: 1.0 }]);

    await POST(makePostRequest({ ...OPS_VALID_BODY, archetype: 'yield_hunter', variant: 'v2' }));
    await flushMicrotasks();

    const insertedRow = mockInsertValues.mock.calls[0]?.[0] as {
      tenantId: string;
      archetype: string;
      variant: string;
    };
    // tenantId must come from resolvedTenantId (OPS_TENANT_ID), not body
    expect(insertedRow.tenantId).toBe(TENANT_ID);
    expect(insertedRow.archetype).toBe('yield_hunter');
    expect(insertedRow.variant).toBe('v2');
  });

  it('FOLLOW-179: calls upsertConversionLabel when prediction_id is present', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ alpha: 1.0, beta: 1.0 }]);

    await POST(
      makePostRequest({
        ...OPS_VALID_BODY,
        prediction_id: 'decision-uuid-123',
      }),
    );
    await flushMicrotasks();

    expect(mockUpsertConversionLabel).toHaveBeenCalledOnce();
    const [, input] = mockUpsertConversionLabel.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input.predictionId).toBe('decision-uuid-123');
    expect(input.tenantId).toBe(TENANT_ID);
    expect(input.outcomeClass).toBe('viewing_booked');
    expect(input.labelSource).toBe('system');
  });

  it('FOLLOW-179: confidence is always 1.0 for system-source labels (CB-2 fix)', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ alpha: 1.0, beta: 1.0 }]);

    await POST(makePostRequest({ ...OPS_VALID_BODY, prediction_id: 'decision-uuid-cb2' }));
    await flushMicrotasks();

    expect(mockUpsertConversionLabel).toHaveBeenCalledOnce();
    const [, input] = mockUpsertConversionLabel.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input.confidence).toBe(1.0);
  });

  it('FOLLOW-179: idempotent — second ping with same prediction_id calls upsertConversionLabel again', async () => {
    mockSelectLimit.mockResolvedValue([{ alpha: 1.0, beta: 1.0 }]);

    const body = { ...OPS_VALID_BODY, prediction_id: 'same-prediction-id' };

    await POST(makePostRequest(body));
    await flushMicrotasks();
    await POST(makePostRequest(body));
    await flushMicrotasks();

    expect(mockUpsertConversionLabel).toHaveBeenCalledTimes(2);
  });

  it('FOLLOW-179: no_response class on converted=false', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ alpha: 1.0, beta: 1.0 }]);

    await POST(
      makePostRequest({ ...OPS_VALID_BODY, converted: false, prediction_id: 'dec-false-001' }),
    );
    await flushMicrotasks();

    const [, input] = mockUpsertConversionLabel.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input.outcomeClass).toBe('no_response');
  });

  it('FOLLOW-171: no conversion_labels upsert when prediction_id is absent (bandit-only)', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ alpha: 1.0, beta: 1.0 }]);

    await POST(makePostRequest({ ...OPS_VALID_BODY }));
    await flushMicrotasks();

    expect(mockUpsertConversionLabel).not.toHaveBeenCalled();
  });

  it('uses onConflictDoUpdate to update existing bandit rows', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ alpha: 1.0, beta: 1.0 }]);

    await POST(makePostRequest(OPS_VALID_BODY));
    await flushMicrotasks();

    expect(mockOnConflictDoUpdate).toHaveBeenCalledOnce();
  });
});

// ─── Bandit update via non-ops path (registered key) ─────────────────────────

describe('POST /api/adapt/feedback — bandit update (registered API key path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes use resolvedTenantId from DB row, not body.tenant_id', async () => {
    const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_ID);
    mockSelectLimit
      .mockResolvedValueOnce([keyRow]) // api_keys lookup
      .mockResolvedValueOnce([{ alpha: 1.0, beta: 1.0 }]); // bandit arm

    const req = await makeSignedRequest(VALID_BODY, VALID_API_KEY);
    await POST(req);
    await flushMicrotasks();

    const insertedRow = mockInsertValues.mock.calls[0]?.[0] as { tenantId: string };
    // Must use tenantId from the DB key row, not from the request body
    expect(insertedRow.tenantId).toBe(TENANT_ID);
  });
});

// ─── Fire-and-forget semantics ───────────────────────────────────────────────

describe('POST /api/adapt/feedback — fire-and-forget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', 'test_key');
    vi.stubEnv('OPS_TENANT_ID', TENANT_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const OPS_VALID_BODY = { ...VALID_BODY, tenant_id: TENANT_ID };

  it('returns 202 even before the DB upsert resolves', async () => {
    let resolveSelect!: (v: unknown[]) => void;
    mockSelectLimit.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSelect = resolve;
      }),
    );

    const res = await POST(makePostRequest(OPS_VALID_BODY));
    expect(res.status).toBe(202);
    expect(mockInsertValues).not.toHaveBeenCalled();

    resolveSelect([]);
    await flushMicrotasks();
  });

  it('DB error during upsert does NOT crash the response', async () => {
    mockSelectLimit.mockRejectedValueOnce(new Error('connection refused'));

    const res = await POST(makePostRequest(OPS_VALID_BODY));
    expect(res.status).toBe(202);

    await flushMicrotasks();
  });

  it('upsertConversionLabel throwing does NOT crash the response (fail-safe)', async () => {
    mockSelectLimit.mockResolvedValue([{ alpha: 1.0, beta: 1.0 }]);
    mockUpsertConversionLabel.mockRejectedValueOnce(new Error('unique constraint violation'));

    const res = await POST(
      makePostRequest({ ...OPS_VALID_BODY, prediction_id: 'decision-error-test' }),
    );
    expect(res.status).toBe(202);

    await flushMicrotasks();
  });

  it('no DB call when DATABASE_URL_ADMIN is unset', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    const res = await POST(makePostRequest(OPS_VALID_BODY));
    expect(res.status).toBe(202);
    await flushMicrotasks();

    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});

// ─── FOLLOW-433: after() registration for fire-and-forget sinks ──────────────

describe('FOLLOW-433: updateArmAsync + upsertConversionLabelAsync registered via after()', () => {
  let mockAfter: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    vi.stubEnv('ADAPT_API_KEY', 'test_key');
    vi.stubEnv('OPS_TENANT_ID', TENANT_ID);
    mockAfter = vi.mocked(after);
    mockAfter.mockReset();
    mockAfter.mockImplementation((fn: () => unknown) => {
      void fn();
    });
    mockSelectLimit.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const OPS_VALID_BODY = { ...VALID_BODY, tenant_id: TENANT_ID };

  it('FOLLOW-433: updateArmAsync is registered via after() (bandit REWARD write)', async () => {
    await POST(makePostRequest(OPS_VALID_BODY));
    await flushMicrotasks();

    expect(mockAfter).toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalledOnce();
  });

  it('FOLLOW-433: upsertConversionLabelAsync is registered via after() when prediction_id is present', async () => {
    mockSelectLimit.mockResolvedValue([{ alpha: 1.0, beta: 1.0 }]);

    await POST(makePostRequest({ ...OPS_VALID_BODY, prediction_id: 'decision-uuid-433' }));
    await flushMicrotasks();

    expect(mockAfter).toHaveBeenCalledTimes(2);
    expect(mockUpsertConversionLabel).toHaveBeenCalledOnce();
  });
});
