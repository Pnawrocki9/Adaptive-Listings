/**
 * Integration tests for POST /api/v1/consent/platform-registration
 *
 * Tests the consent_records INSERT wiring for the mandatory platform-wide
 * registration consent (FOLLOW-374). Covers:
 *   - 201 on valid request with correct HMAC signature
 *   - consent_records row has correct fields (consent_type, tos_version, etc.)
 *   - 401 on missing/invalid signature
 *   - 400 on invalid body (Zod)
 *   - 409 on duplicate (same tenant_id + session_id + consent_type)
 *   - 500 when DB is configured but throws (fail loud, no mock)
 *   - IP is encrypted, not stored as plaintext
 *
 * @module apps/control-plane/src/app/api/v1/consent/platform-registration/route.test
 */

import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── DB mock ──────────────────────────────────────────────────────────────────

const mockConsentRecordsTable = {
  id: 'id',
  tenantId: 'tenant_id',
  sessionId: 'session_id',
  consentType: 'consent_type',
  granted: 'granted',
  tosVersion: 'tos_version',
  consentTextHash: 'consent_text_hash',
  ipAddress: 'ip_address',
  userAgent: 'user_agent',
  grantedAt: 'granted_at',
};
// FOLLOW-654: GET leg 1 (and, as of FOLLOW-684, the POST brand-identity guard) resolves
// brand identity from tenants.brand_config.
const mockTenantsTable = { id: 'id', brandConfig: 'brand_config' };

const mockInsertReturning = vi.fn();
const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

// consentRecords select chain — nonce-check and duplicate-check in POST (route.ts `:398`/`:419`).
const mockSelectLimit = vi.fn();
const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));

// tenants select chain — brand identity lookup, used by GET (FOLLOW-654 leg 1) and, as of
// FOLLOW-684, the POST-side unprovisioned-external-brand guard. Kept on ITS OWN mock —
// separate from mockSelectLimit above — so the POST guard's extra tenant-row query never
// shifts the call order the pre-existing nonce/duplicate-check tests assert via
// `mockResolvedValueOnce` chains.
const mockTenantSelectLimit = vi.fn();
const mockTenantSelectWhere = vi.fn(() => ({ limit: mockTenantSelectLimit }));

// FOLLOW-660: the tenant-count guard selects WITHOUT a .where() —
// `db.select().from(tenants).limit(2)` — so `from()` must also expose `limit` directly.
// Shared across both tables since only the tenants-count guard ever calls it this way.
const mockCountLimit = vi.fn();

const mockSelectFrom = vi.fn((table: unknown) => {
  if (table === mockTenantsTable) {
    return { where: mockTenantSelectWhere, limit: mockCountLimit };
  }
  return { where: mockSelectWhere, limit: mockCountLimit };
});
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

const mockDb = { insert: mockInsert, select: mockSelect };

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => mockDb),
  consentRecords: mockConsentRecordsTable,
  tenants: mockTenantsTable,
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, op: 'eq' })),
  and: vi.fn((...args: unknown[]) => ({ args, op: 'and' })),
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-platform-registration-secret-32ch';
const TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const SESSION_ID = 'test-session-investor-001';
const NONCE = 'nonce-abcdef1234567890abcdef';

function buildValidBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenant_id: TENANT_ID,
    session_id: SESSION_ID,
    nonce: NONCE,
    ...overrides,
  };
}

function computeHmac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

function makeRequest(
  body: Record<string, unknown>,
  options: {
    secret?: string;
    signature?: string | null;
    ip?: string;
  } = {},
): NextRequest {
  const { secret = TEST_SECRET, ip = '203.0.113.42' } = options;
  const bodyStr = JSON.stringify(body);
  const sig = options.signature !== undefined ? options.signature : computeHmac(secret, bodyStr);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-forwarded-for': ip,
  };
  if (sig !== null) {
    headers['x-consent-signature'] = sig;
  }

  return new NextRequest('http://localhost/api/v1/consent/platform-registration', {
    method: 'POST',
    headers,
    body: bodyStr,
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/consent/platform-registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    // No CONSENT_IP_ENCRYPTION_KEY → ip stored as null (not plaintext)
    vi.stubEnv('CONSENT_IP_ENCRYPTION_KEY', '');

    // Default DB mocks: no duplicate found, INSERT succeeds
    mockSelectLimit.mockResolvedValue([]);
    // FOLLOW-660: default to exactly ONE tenant — today's live single-tenant state.
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }]);
    // FOLLOW-684: no tenant row → Estalara fallback identity, first-party by default (not
    // an unprovisioned external brand).
    mockTenantSelectLimit.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([{ id: 'consent-record-uuid-001' }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── AC: consent_records row written with correct fields ────────────────────

  it('returns 201 with consent_record_id on valid request', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(201);
    const body = await parseBody<{ consent_record_id: string }>(res);
    expect(body.consent_record_id).toBe('consent-record-uuid-001');
  });

  it('inserts consent_records row with consent_type = platform_registration', async () => {
    const { POST } = await import('./route');
    await POST(makeRequest(buildValidBody()));

    expect(mockInsert).toHaveBeenCalledWith(expect.anything());
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentType).toBe('platform_registration');
    expect(valuesArg.granted).toBe(true);
  });

  it('inserts tos_version matching PLATFORM_REGISTRATION_TOS_VERSION when not supplied', async () => {
    const { POST } = await import('./route');
    const { PLATFORM_REGISTRATION_TOS_VERSION } = await import('./lib');
    await POST(makeRequest(buildValidBody()));

    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.tosVersion).toBe(PLATFORM_REGISTRATION_TOS_VERSION);
  });

  it('uses caller-supplied tos_version when provided', async () => {
    const { POST } = await import('./route');
    await POST(makeRequest(buildValidBody({ tos_version: 'platform-v2.0-custom' })));

    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.tosVersion).toBe('platform-v2.0-custom');
  });

  it('inserts canonical consent_text_hash when not supplied', async () => {
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');
    await POST(makeRequest(buildValidBody()));

    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentTextHash).toBe(CANONICAL_CONSENT_TEXT_HASH);
  });

  it('uses caller-supplied consent_text_hash (64-char hex)', async () => {
    const customHash = 'b' + '0'.repeat(63);
    const { POST } = await import('./route');
    await POST(makeRequest(buildValidBody({ consent_text_hash: customHash })));

    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentTextHash).toBe(customHash);
  });

  it('does NOT store raw ip_address when CONSENT_IP_ENCRYPTION_KEY is absent', async () => {
    const { POST } = await import('./route');
    await POST(makeRequest(buildValidBody(), { ip: '1.2.3.4' }));

    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    // ipAddress must NOT be the raw IP — either absent or encrypted (null here since key absent)
    expect(valuesArg.ipAddress).toBeUndefined();
  });

  // ── AC: auth — 401 on missing/invalid signature ───────────────────────────

  it('returns 401 when X-Consent-Signature header is missing', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody(), { signature: null }));

    expect(res.status).toBe(401);
  });

  it('returns 401 when signature is wrong', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      makeRequest(buildValidBody(), { signature: 'deadbeef' + '0'.repeat(56) }),
    );

    expect(res.status).toBe(401);
  });

  it('returns 401 when PLATFORM_REGISTRATION_CONSENT_SECRET is not configured', async () => {
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', '');
    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(401);
  });

  // ── AC: Zod validation ────────────────────────────────────────────────────

  it('returns 400 when tenant_id is not a UUID', async () => {
    const { POST } = await import('./route');
    const body = buildValidBody({ tenant_id: 'not-a-uuid' });
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    const resp = await parseBody<{ error: string }>(res);
    expect(resp.error).toBe('Validation failed');
  });

  it('returns 400 when session_id is too short', async () => {
    const { POST } = await import('./route');
    const body = buildValidBody({ session_id: 'short' });
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
  });

  it('returns 400 when nonce is missing', async () => {
    const { POST } = await import('./route');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { nonce: _nonce, ...bodyWithoutNonce } = buildValidBody() as {
      nonce: string;
      [key: string]: unknown;
    };
    const res = await POST(makeRequest(bodyWithoutNonce));

    expect(res.status).toBe(400);
  });

  it('returns 400 when consent_text_hash is not 64 hex chars', async () => {
    const { POST } = await import('./route');
    const body = buildValidBody({ consent_text_hash: 'abc123' });
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
  });

  // ── AC: duplicate / replay defense ────────────────────────────────────────

  it('returns 409 when a consent_record already exists for the same (tenant_id, session_id)', async () => {
    // Duplicate found in SELECT
    mockSelectLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'existing-id' }]);
    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(409);
    const body = await parseBody<{ error: string; consent_record_id: string }>(res);
    expect(body.error).toContain('already exists');
    expect(body.consent_record_id).toBe('existing-id');
  });

  // ── AC: fail loud on configured-but-failed DB ─────────────────────────────

  it('returns 500 when INSERT throws — no mock/fake data returned', async () => {
    mockInsertReturning.mockRejectedValueOnce(new Error('DB connection refused'));

    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: string; degraded: boolean }>(res);
    // Must surface error, not fabricate a consent_record_id
    expect(body.degraded).toBe(true);
    expect((body as Record<string, unknown>).consent_record_id).toBeUndefined();
  });

  it('returns 500 with data_source when duplicate-check SELECT throws', async () => {
    // First select (nonce check) succeeds, second (duplicate check) throws
    mockSelectLimit
      .mockResolvedValueOnce([]) // nonce check
      .mockRejectedValueOnce(new Error('DB timeout')); // duplicate check

    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: string; degraded: boolean; data_source: string }>(res);
    expect(body.data_source).toBe('db');
    expect(body.degraded).toBe(true);
  });

  // ── AC: body parsing edge cases ───────────────────────────────────────────

  it('returns 400 on invalid JSON body', async () => {
    const { POST } = await import('./route');
    const sig = computeHmac(TEST_SECRET, 'not json at all');
    const req = new NextRequest('http://localhost/api/v1/consent/platform-registration', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-consent-signature': sig,
      },
      body: 'not json at all',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ─── FOLLOW-654 leg 2: consent_text_hash required for non-first-party ──────────

describe('POST consent_text_hash requirement (FOLLOW-654 leg 2)', () => {
  // A distinct UUID from TENANT_ID so, with FIRST_PARTY_TENANT_ID set, the
  // request tenant is treated as a non-first-party external brand.
  const FIRST_PARTY_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    vi.stubEnv('CONSENT_IP_ENCRYPTION_KEY', '');
    mockSelectLimit.mockResolvedValue([]);
    // FOLLOW-660: default to exactly ONE tenant — today's live single-tenant state.
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }]);
    // FOLLOW-684: no tenant row → Estalara fallback identity.
    mockTenantSelectLimit.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([{ id: 'consent-record-uuid-leg2' }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 400 when a non-first-party tenant omits consent_text_hash', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', FIRST_PARTY_ID);
    const { POST } = await import('./route');
    // TENANT_ID !== FIRST_PARTY_ID → non-first-party → hash required.
    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(400);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toContain('consent_text_hash');
    // Fail-closed: no consent row is fabricated.
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns 201 when a non-first-party tenant supplies consent_text_hash', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', FIRST_PARTY_ID);
    const customHash = 'c' + '0'.repeat(63);
    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody({ consent_text_hash: customHash })));

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentTextHash).toBe(customHash);
  });

  it('allows the first-party tenant to omit consent_text_hash (backward compat)', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', TENANT_ID);
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');
    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentTextHash).toBe(CANONICAL_CONSENT_TEXT_HASH);
  });

  it('treats all tenants as first-party when FIRST_PARTY_TENANT_ID is unset (live-flow compat)', async () => {
    // No FIRST_PARTY_TENANT_ID stubbed → env unset. With exactly ONE tenant (the
    // beforeEach default) this stays today's behaviour — see FOLLOW-660 below for
    // what happens once a second tenant exists.
    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody()));
    expect(res.status).toBe(201);
  });
});

// ─── FOLLOW-660: the FIRST_PARTY_TENANT_ID fail-open is closed in code ────────

describe('POST consent_text_hash — forgotten FIRST_PARTY_TENANT_ID (FOLLOW-660)', () => {
  const SECOND_TENANT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    vi.stubEnv('CONSENT_IP_ENCRYPTION_KEY', '');
    mockSelectLimit.mockResolvedValue([]);
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }]);
    // FOLLOW-684: no tenant row → Estalara fallback identity.
    mockTenantSelectLimit.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([{ id: 'consent-record-uuid-660' }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('env UNSET + a SECOND tenant + omitted hash → 400 instead of fabricating the canonical hash', async () => {
    // The exact production hazard: an operator onboards an external brand and forgets the env.
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }, { id: SECOND_TENANT_ID }]);

    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(400);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toContain('FIRST_PARTY_TENANT_ID');
    // The audit record must NOT have been written with a defaulted hash.
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it('env UNSET + a SECOND tenant + explicit hash → 201 (the caller attested its own text)', async () => {
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }, { id: SECOND_TENANT_ID }]);
    const customHash = 'c' + '0'.repeat(63);

    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody({ consent_text_hash: customHash })));

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentTextHash).toBe(customHash);
  });

  it('env UNSET + exactly ONE tenant + omitted hash → 201, canonical hash (today unchanged)', async () => {
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');
    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentTextHash).toBe(CANONICAL_CONSENT_TEXT_HASH);
  });

  it('env SET → the guard short-circuits and never runs the tenant-count query', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', TENANT_ID);

    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(201);
    // A correctly configured deployment pays no extra query on the hot path.
    expect(mockCountLimit).not.toHaveBeenCalled();
  });

  it('fails CLOSED — a tenant-count read error requires the hash rather than defaulting it', async () => {
    mockCountLimit.mockRejectedValue(new Error('ECONNREFUSED'));

    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(400);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});

// ─── FOLLOW-684: POST-side brand-identity fabrication gate ────────────────────
//
// FOLLOW-659 gave the GET leg a refusal for un-provisioned external brands. POST — the
// only surface that WRITES `consent_records` — had no equivalent: an unprovisioned
// external brand could submit `consent_text_hash: CANONICAL_CONSENT_TEXT_HASH` (public,
// computable) and get a 201 whose audit record falsely names Estalara / Time2Show, Inc.
// as the controller. This describe covers the AC-4 matrix.

describe('POST brand identity provisioning gate (FOLLOW-684)', () => {
  // Distinct from TENANT_ID so, with FIRST_PARTY_TENANT_ID pinned to TENANT_ID, this
  // tenant is unambiguously non-first-party (no reliance on the tenant-count fallback).
  const EXTERNAL_TENANT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  function buildExternalBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return buildValidBody({ tenant_id: EXTERNAL_TENANT_ID, ...overrides });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    vi.stubEnv('CONSENT_IP_ENCRYPTION_KEY', '');
    // Pinned to TENANT_ID (not EXTERNAL_TENANT_ID) — the real go-live shape per the
    // brand-provisioning runbook (FOLLOW-656 requires this be set before onboarding any
    // external brand).
    vi.stubEnv('FIRST_PARTY_TENANT_ID', TENANT_ID);
    mockSelectLimit.mockResolvedValue([]);
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }]);
    // Default: no tenant row → Estalara fallback identity. Individual tests override for
    // the "provisioned" scenario.
    mockTenantSelectLimit.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([{ id: 'consent-record-uuid-684' }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('unprovisioned external brand + canonical hash → 422, refused, nothing written', async () => {
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');
    const Sentry = await import('@sentry/nextjs');

    const res = await POST(
      makeRequest(buildExternalBody({ consent_text_hash: CANONICAL_CONSENT_TEXT_HASH })),
    );

    expect(res.status).toBe(422);
    const body = await parseBody<{ code: string; tenant_id: string }>(res);
    expect(body.code).toBe('consent_text_hash_fabricated');
    expect(body.tenant_id).toBe(EXTERNAL_TENANT_ID);
    // Nothing written.
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        level: 'error',
        tags: {
          route: 'consent/platform-registration',
          brand_identity: 'unprovisioned_external',
        },
      }),
    );
  });

  it('unprovisioned external brand + brand-specific (non-canonical) hash → 201, exactly one Sentry capture', async () => {
    const brandSpecificHash = 'd' + '0'.repeat(63);
    const { POST } = await import('./route');
    const Sentry = await import('@sentry/nextjs');

    const res = await POST(
      makeRequest(buildExternalBody({ consent_text_hash: brandSpecificHash })),
    );

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentTextHash).toBe(brandSpecificHash);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        level: 'error',
        tags: {
          route: 'consent/platform-registration',
          brand_identity: 'unprovisioned_external',
        },
      }),
    );
  });

  it('provisioned external tenant (brand_name configured) → 201, no capture, no tenant-count query (AC-5)', async () => {
    mockTenantSelectLimit.mockResolvedValue([
      { id: EXTERNAL_TENANT_ID, brandConfig: { brand_name: 'Costa Sol Properties' } },
    ]);
    const brandSpecificHash = 'e' + '0'.repeat(63);
    const { POST } = await import('./route');
    const Sentry = await import('@sentry/nextjs');

    const res = await POST(
      makeRequest(buildExternalBody({ consent_text_hash: brandSpecificHash })),
    );

    expect(res.status).toBe(201);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    // `identity.isFallbackIdentity` is false for a provisioned brand —
    // `isUnprovisionedExternalBrand` short-circuits before ever running the
    // tenant-count query (Rule AA / FOLLOW-684 AC-5).
    expect(mockCountLimit).not.toHaveBeenCalled();
  });

  it('first-party tenant → 201, no capture, byte-identical response, zero extra query (AC-5, no regression)', async () => {
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');
    const Sentry = await import('@sentry/nextjs');

    // TENANT_ID IS the FIRST_PARTY_TENANT_ID configured for this describe block.
    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(201);
    const body = await parseBody<Record<string, unknown>>(res);
    // Byte-identical shape to pre-FOLLOW-684 behavior — no new fields leak onto the
    // success response.
    expect(Object.keys(body)).toEqual(['consent_record_id']);
    expect(body.consent_record_id).toBe('consent-record-uuid-684');
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentTextHash).toBe(CANONICAL_CONSENT_TEXT_HASH);
    // The FIRST_PARTY_TENANT_ID exact-match branch inside `isUnprovisionedExternalBrand`
    // makes no DB call at all — the fast path for Estalara's own live traffic pays no
    // extra query (Rule AA).
    expect(mockCountLimit).not.toHaveBeenCalled();
  });
});

// ─── FOLLOW-654 leg 1: GET brand-correct consent text ─────────────────────────

describe('GET /api/v1/consent/platform-registration (FOLLOW-654 leg 1)', () => {
  function makeGetRequest(
    tenantId: string,
    options: { secret?: string; signature?: string | null } = {},
  ): NextRequest {
    const { secret = TEST_SECRET } = options;
    const sig = options.signature !== undefined ? options.signature : computeHmac(secret, tenantId);
    const headers: Record<string, string> = {};
    if (sig !== null) headers['x-consent-signature'] = sig;
    return new NextRequest(
      `http://localhost/api/v1/consent/platform-registration?tenant_id=${tenantId}`,
      { method: 'GET', headers },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    // FOLLOW-659: the un-provisioned-brand gate shares FOLLOW-660's first-party
    // detection, so it reads the tenant count when FIRST_PARTY_TENANT_ID is unset.
    // Default to exactly ONE tenant — today's live single-tenant state.
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders the brand display identity in the consent text (substitution)', async () => {
    mockTenantSelectLimit.mockResolvedValue([
      {
        id: TENANT_ID,
        brandConfig: { brand_name: 'Costa Sol Properties', legal_entity: 'Costa Sol S.L.' },
      },
    ]);
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(TENANT_ID));

    expect(res.status).toBe(200);
    const body = await parseBody<{
      brand_name: string;
      legal_entity: string;
      consent_text: string;
      consent_text_hash: string;
      data_source: string;
    }>(res);
    expect(body.brand_name).toBe('Costa Sol Properties');
    expect(body.consent_text).toContain('Costa Sol Properties Adaptive Listings service');
    expect(body.consent_text).toContain('provided by Costa Sol S.L.');
    expect(body.consent_text).not.toContain('Time2Show');
    expect(body.data_source).toBe('stored');
    // The hash matches the exact rendered text.
    const { computeConsentTextHash } = await import('./lib');
    expect(body.consent_text_hash).toBe(computeConsentTextHash(body.consent_text));
  });

  it('falls back to Estalara identity when the tenant has no brand_name (single-tenant, first-party)', async () => {
    mockTenantSelectLimit.mockResolvedValue([
      { id: TENANT_ID, brandConfig: { primary_color: '#1a73e8' } },
    ]);
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(TENANT_ID));

    expect(res.status).toBe(200);
    const body = await parseBody<{ brand_name: string; consent_text: string; data_source: string }>(
      res,
    );
    expect(body.brand_name).toBe('Estalara');
    expect(body.consent_text).toContain('Estalara Adaptive Listings service');
    expect(body.consent_text).toContain('provided by Time2Show, Inc.');
    expect(body.data_source).toBe('stored');
  });

  it('returns data_source=default (Estalara) when no tenant row exists', async () => {
    mockTenantSelectLimit.mockResolvedValue([]);
    // FOLLOW-660: default to exactly ONE tenant — today's live single-tenant state.
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }]);
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(TENANT_ID));

    expect(res.status).toBe(200);
    const body = await parseBody<{ brand_name: string; data_source: string }>(res);
    expect(body.brand_name).toBe('Estalara');
    expect(body.data_source).toBe('default');
  });

  it('returns 401 when the HMAC signature is missing', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(TENANT_ID, { signature: null }));
    expect(res.status).toBe(401);
  });

  it('returns 401 when the HMAC signature is wrong', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(TENANT_ID, { signature: 'deadbeef' + '0'.repeat(56) }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when tenant_id is not a UUID', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest('not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('returns 500 (fail loud) when the tenant lookup throws — no fabricated 200', async () => {
    mockTenantSelectLimit.mockRejectedValueOnce(new Error('DB connection refused'));
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(TENANT_ID));

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: string; data_source: string; degraded: boolean }>(res);
    expect(body.data_source).toBe('db');
    expect(body.degraded).toBe(true);
    expect((body as Record<string, unknown>).consent_text).toBeUndefined();
  });
});

// ─── FOLLOW-659: un-provisioned external brand → refuse mis-branded consent text ──

describe('GET brand identity provisioning gate (FOLLOW-659)', () => {
  const SECOND_TENANT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  function makeGetRequest(tenantId: string): NextRequest {
    return new NextRequest(
      `http://localhost/api/v1/consent/platform-registration?tenant_id=${tenantId}`,
      { method: 'GET', headers: { 'x-consent-signature': computeHmac(TEST_SECRET, tenantId) } },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    // Tenant row exists but carries NO legal identity — the fail-silent shape.
    mockTenantSelectLimit.mockResolvedValue([
      { id: TENANT_ID, brandConfig: { primary_color: '#fff' } },
    ]);
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('env SET + a DIFFERENT tenant with no brand_name → 409, never Estalara-branded text', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', SECOND_TENANT_ID);

    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(TENANT_ID));

    expect(res.status).toBe(409);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.code).toBe('brand_identity_not_provisioned');
    expect(body.tenant_id).toBe(TENANT_ID);
    // The whole point: no consent text and no hash for the deployment to attest.
    expect(body.consent_text).toBeUndefined();
    expect(body.consent_text_hash).toBeUndefined();
  });

  it('env UNSET + a SECOND tenant + no brand_name → 409 (forgotten env cannot mask it)', async () => {
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }, { id: SECOND_TENANT_ID }]);

    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(TENANT_ID));

    expect(res.status).toBe(409);
  });

  it('env SET + THE first-party tenant with no brand_name → 200 Estalara (unchanged)', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', TENANT_ID);

    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(TENANT_ID));

    expect(res.status).toBe(200);
    const body = await parseBody<{ brand_name: string; consent_text: string }>(res);
    expect(body.brand_name).toBe('Estalara');
    expect(body.consent_text).toContain('provided by Time2Show, Inc.');
    // A configured deployment pays no extra query for this gate.
    expect(mockCountLimit).not.toHaveBeenCalled();
  });

  it('external tenant WITH a configured brand_name → 200, and the gate costs no query', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', SECOND_TENANT_ID);
    mockTenantSelectLimit.mockResolvedValue([
      { id: TENANT_ID, brandConfig: { brand_name: 'Costa Sol Properties' } },
    ]);

    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(TENANT_ID));

    expect(res.status).toBe(200);
    const body = await parseBody<{ brand_name: string }>(res);
    expect(body.brand_name).toBe('Costa Sol Properties');
    expect(mockCountLimit).not.toHaveBeenCalled();
  });

  it('fails CLOSED — a tenant-count read error refuses rather than serving Estalara text', async () => {
    mockCountLimit.mockRejectedValue(new Error('ECONNREFUSED'));

    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(TENANT_ID));

    expect(res.status).toBe(409);
  });
});
