/**
 * FOLLOW-943 — an ORIGIN refusal must be distinguishable from an auth failure, on the route's
 * ACTUAL response.
 *
 * Why this file exists rather than an extra case in `route.test.ts`: the ticket's finding was that
 * four of six consumers collapse the shared helper's 403 into a 401, and that **no route in the set
 * had a test asserting the status the caller actually returns** — every existing assertion stopped
 * at `resolveOriginDecision` returning `deny`. A policy function returning the right verdict while
 * the route answers 401 is precisely the Rule AU shape, so these cases drive the real
 * `resolveApiKey` against a mocked DB and read the HTTP response.
 *
 * @module apps/control-plane/src/app/api/adapt/feedback/route.follow943.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Keyed by TABLE, not by call order. An ordered mock silently mis-primes the moment the route
// adds an unrelated SELECT, which is exactly what happened while writing this file: the first
// `mockResolvedValueOnce` was consumed elsewhere and the api_keys lookup saw `[]`, so a test
// asserting "403 not 401" failed for the wrong reason — a false red is as misleading as a false
// green.
const { rowsByTable, mockCreateAdminClient } = vi.hoisted(() => {
  const rowsByTable = new Map<unknown, unknown[]>();
  let lastTable: unknown = null;
  const mockSelectLimit = vi.fn(() => Promise.resolve(rowsByTable.get(lastTable) ?? []));
  const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
  const mockSelectFrom = vi.fn((t: unknown) => {
    lastTable = t;
    return { where: mockSelectWhere, limit: mockSelectLimit };
  });
  const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });
  const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn() });
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
  return {
    rowsByTable,
    mockCreateAdminClient: vi.fn(() => ({ select: mockSelect, insert: mockInsert })),
  };
});

vi.mock('@estalara/db', () => ({
  createAdminClient: mockCreateAdminClient,
  apiKeys: {
    tenantId: 'tenant_id',
    hashedKey: 'hashed_key',
    allowedOrigins: 'allowed_origins',
    revokedAt: 'revoked_at',
    expiresAt: 'expires_at',
  },
  tenants: { id: 'id', allowedOrigins: 'allowed_origins' },
  abBanditWeights: {},
  conversionLabels: {},
}));

vi.mock('@/lib/conversion-labels', () => ({ upsertConversionLabel: vi.fn() }));

const TENANT_ID = 'cbc51cfa-1056-40aa-b0a9-6e982b52b1de';
const RAW_KEY = 'pk_live_test_follow943_key';

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmac(key: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** A VALID key for a real tenant — the point is that the refusal is about the ORIGIN, not the key. */
async function primeValidKeyWithTenantOrigins(tenantOrigins: string[]): Promise<void> {
  const db = await import('@estalara/db');
  rowsByTable.set(db.apiKeys, [
    { tenantId: TENANT_ID, hashedKey: await sha256Hex(RAW_KEY), keyOrigins: null },
  ]);
  rowsByTable.set(db.tenants, [{ allowedOrigins: tenantOrigins }]);
}

async function post(origin: string): Promise<Response> {
  const body = JSON.stringify({
    session_id: 'sess-follow943',
    tenant_id: TENANT_ID,
    archetype: 'family_buyer',
    variant: 'v1',
    converted: true,
  });
  const { POST } = await import('./route');
  return POST(
    new NextRequest('http://localhost/api/adapt/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RAW_KEY}`,
        'X-Estalara-Signature': await hmac(RAW_KEY, body),
        Origin: origin,
      },
      body,
    }),
  );
}

describe('FOLLOW-943 — POST /api/adapt/feedback answers 403 on an origin refusal, not 401', () => {
  beforeEach(() => {
    // Without this, `resolveApiKey` returns 401 BEFORE it ever reaches the DB or the origin gate
    // (`api-key-auth.ts:113-119`) — so an un-stubbed run makes these cases fail for a reason that
    // has nothing to do with what they assert. Cost me one debugging cycle; named here so it does
    // not cost the next reader one.
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgres://stub/not-used-the-client-is-mocked');
    vi.stubEnv('API_KEY_HMAC_SECRET', '');
    vi.stubEnv('FEEDBACK_ENDPOINT_ENABLED', 'true');
    rowsByTable.clear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('a VALID key from a disallowed origin → 403 `forbidden_origin`, never 401', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', TENANT_ID);
    await primeValidKeyWithTenantOrigins(['https://homes.clientbrand.com']);

    const res = await post('https://evil.example.com');

    // The regression: this answered 401 "Invalid or missing API key" on a key that is valid.
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain('forbidden_origin');
  });

  it('FOLLOW-957: an unresolvable first party → 403 `first_party_unverified`, a DIFFERENT reason', async () => {
    // The lockout shape. Under the old code this was a 401 on a correct key with nothing, in any
    // log or response, naming the cause.
    vi.stubEnv('FIRST_PARTY_TENANT_ID', '');
    await primeValidKeyWithTenantOrigins(['https://homes.clientbrand.com']);

    const res = await post('https://app.estalara.com');

    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain('first_party_unverified');
  });

  it('an UNKNOWN key still normalises to 401 — the oracle protection is untouched', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', TENANT_ID);
    // no api_keys row primed at all

    const res = await post('https://app.estalara.com');

    expect(res.status).toBe(401);
  });
});
