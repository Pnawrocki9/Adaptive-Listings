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

const mockInsertReturning = vi.fn();
const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

const mockSelectLimit = vi.fn();
const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

const mockDb = { insert: mockInsert, select: mockSelect };

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => mockDb),
  consentRecords: {
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
  },
  // FOLLOW-654: GET leg 1 resolves brand identity from tenants.brand_config.
  tenants: { id: 'id', brandConfig: 'brand_config' },
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
    // No FIRST_PARTY_TENANT_ID stubbed → env unset → omission allowed for everyone.
    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody()));
    expect(res.status).toBe(201);
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders the brand display identity in the consent text (substitution)', async () => {
    mockSelectLimit.mockResolvedValue([
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

  it('falls back to Estalara identity when the tenant has no brand_name', async () => {
    mockSelectLimit.mockResolvedValue([
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
    mockSelectLimit.mockResolvedValue([]);
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
    mockSelectLimit.mockRejectedValueOnce(new Error('DB connection refused'));
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(TENANT_ID));

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: string; data_source: string; degraded: boolean }>(res);
    expect(body.data_source).toBe('db');
    expect(body.degraded).toBe(true);
    expect((body as Record<string, unknown>).consent_text).toBeUndefined();
  });
});
