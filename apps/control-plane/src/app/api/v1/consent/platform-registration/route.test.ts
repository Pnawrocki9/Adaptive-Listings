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

import { createHash, createHmac } from 'crypto';
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

  it('uses caller-supplied tos_version when it matches the currently-served version', async () => {
    // FOLLOW-712: an arbitrary caller-supplied value ('platform-v2.0-custom') is no longer
    // accepted unvalidated — see the dedicated "POST tos_version validation (FOLLOW-712)"
    // describe block below for the superseded-version rejection this test used to miss.
    const { POST } = await import('./route');
    const { PLATFORM_REGISTRATION_TOS_VERSION } = await import('./lib');
    await POST(makeRequest(buildValidBody({ tos_version: PLATFORM_REGISTRATION_TOS_VERSION })));

    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.tosVersion).toBe(PLATFORM_REGISTRATION_TOS_VERSION);
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

// ─── FOLLOW-712: `tos_version` must match what this server currently serves ────
//
// Before this ticket, `body.tos_version` was accepted with no check against
// `PLATFORM_REGISTRATION_TOS_VERSION`, so a caller still sending a superseded version string
// (e.g. after a text bump) would write a consent_records row whose tos_version and hash
// attest two different texts (RETRO-228).

describe('POST tos_version validation (FOLLOW-712)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    vi.stubEnv('CONSENT_IP_ENCRYPTION_KEY', '');
    mockSelectLimit.mockResolvedValue([]);
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }]);
    mockTenantSelectLimit.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([{ id: 'consent-record-uuid-712' }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 422 tos_version_superseded when the submitted tos_version does not match the served version', async () => {
    const { POST } = await import('./route');
    const { PLATFORM_REGISTRATION_TOS_VERSION } = await import('./lib');
    const res = await POST(
      makeRequest(buildValidBody({ tos_version: 'platform-v1.2-2026-05-01' })),
    );

    expect(res.status).toBe(422);
    const body = await parseBody<{
      code: string;
      current_tos_version: string;
      error: string;
    }>(res);
    expect(body.code).toBe('tos_version_superseded');
    expect(body.current_tos_version).toBe(PLATFORM_REGISTRATION_TOS_VERSION);
    // Fail-closed: nothing is coerced or written — the evidence the caller is stale survives.
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it('returns 201 and writes the default tos_version when tos_version is omitted (unchanged)', async () => {
    const { POST } = await import('./route');
    const { PLATFORM_REGISTRATION_TOS_VERSION } = await import('./lib');
    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.tosVersion).toBe(PLATFORM_REGISTRATION_TOS_VERSION);
  });
});

// ─── FOLLOW-715: bounded, explicitly-configured grace window for the ONE ───────
// immediately-previous `tos_version` ────────────────────────────────────────────
//
// Before this ticket, ANY mismatch — including the single version immediately
// preceding a bump — hard-refused with `422 tos_version_superseded`, turning every
// `PLATFORM_REGISTRATION_TOS_VERSION` bump into an outage for the live out-of-repo
// caller (app.estalara.com) until it redeployed (RETRO-229 → FOLLOW-715).
// `PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS` (unset by default) lets an operator
// explicitly configure exactly ONE grace-window version. Three bands, red-first:
// current / previous-within-window / older-than-previous.

describe('POST tos_version grace window (FOLLOW-715)', () => {
  const PREVIOUS_VERSION = 'platform-v1.2-2026-05-01';
  const OLDER_VERSION = 'platform-v1.1-2026-04-01';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    vi.stubEnv('CONSENT_IP_ENCRYPTION_KEY', '');
    mockSelectLimit.mockResolvedValue([]);
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }]);
    mockTenantSelectLimit.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([{ id: 'consent-record-uuid-715' }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Band 1: current version — unaffected by this ticket ──────────────────────
  it('band CURRENT: matches PLATFORM_REGISTRATION_TOS_VERSION → 201, written under the current version, no grace-window alert', async () => {
    vi.stubEnv('PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS', PREVIOUS_VERSION);
    const { POST } = await import('./route');
    const { PLATFORM_REGISTRATION_TOS_VERSION } = await import('./lib');
    const Sentry = await import('@sentry/nextjs');

    const res = await POST(
      makeRequest(buildValidBody({ tos_version: PLATFORM_REGISTRATION_TOS_VERSION })),
    );

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.tosVersion).toBe(PLATFORM_REGISTRATION_TOS_VERSION);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  // ── Band 2: immediately-previous version, grace window configured → accepted ─
  it('band PREVIOUS-WITHIN-WINDOW: the one grace-window version → 201, written under the SUBMITTED (previous) version — never coerced — and a warning alert fires', async () => {
    vi.stubEnv('PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS', PREVIOUS_VERSION);
    const { POST } = await import('./route');
    const Sentry = await import('@sentry/nextjs');

    const res = await POST(makeRequest(buildValidBody({ tos_version: PREVIOUS_VERSION })));

    expect(res.status).toBe(201);
    const body = await parseBody<{ consent_record_id: string }>(res);
    expect(body.consent_record_id).toBe('consent-record-uuid-715');

    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    // AC-1: the record attests the version the caller ACTUALLY attested — never
    // silently upgraded to the server's current version.
    expect(valuesArg.tosVersion).toBe(PREVIOUS_VERSION);

    // AC-1: every grace-window write raises a warning-level alert so the stale
    // caller is visible. Distinct tag key from `brand_identity` — coordinated with,
    // not a fourth value inside, the FOLLOW-700/708 registry (Rule AJ).
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        level: 'warning',
        tags: {
          route: 'consent/platform-registration',
          tos_version_grace: 'previous_version_accepted',
        },
      }),
    );
  });

  // ── Band 3: older than the previous version → hard 422, unconditionally ──────
  it('band OLDER-THAN-PREVIOUS: refused with 422 tos_version_superseded even WITH a grace window configured — migration ramp, not amnesty', async () => {
    vi.stubEnv('PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS', PREVIOUS_VERSION);
    const { POST } = await import('./route');
    const { PLATFORM_REGISTRATION_TOS_VERSION } = await import('./lib');
    const Sentry = await import('@sentry/nextjs');

    const res = await POST(makeRequest(buildValidBody({ tos_version: OLDER_VERSION })));

    expect(res.status).toBe(422);
    const body = await parseBody<{ code: string; current_tos_version: string }>(res);
    expect(body.code).toBe('tos_version_superseded');
    expect(body.current_tos_version).toBe(PLATFORM_REGISTRATION_TOS_VERSION);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
    // Nothing OLDER than the grace-window version ever reaches the alert branch.
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('the previous-version band is refused when NO grace window is configured (env unset) — byte-identical to pre-FOLLOW-715 behavior', async () => {
    // PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS deliberately left unset.
    const { POST } = await import('./route');
    const { PLATFORM_REGISTRATION_TOS_VERSION } = await import('./lib');

    const res = await POST(makeRequest(buildValidBody({ tos_version: PREVIOUS_VERSION })));

    expect(res.status).toBe(422);
    const body = await parseBody<{ code: string; current_tos_version: string }>(res);
    expect(body.code).toBe('tos_version_superseded');
    expect(body.current_tos_version).toBe(PLATFORM_REGISTRATION_TOS_VERSION);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

// ─── RETRO-229 DG-5: a rejected tos_version costs ZERO DB queries ──────────────
//
// The 4a refusal is ordered BEFORE step 7's `createAdminClient()` call today. This
// pins that invariant with a test, not just a code comment — it must fail if a
// future reorder moved the tos_version check below any DB access.

describe('POST tos_version rejection costs zero DB queries (RETRO-229 DG-5 / FOLLOW-715 AC-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    vi.stubEnv('CONSENT_IP_ENCRYPTION_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('a hard-refused (older-than-previous, no grace window) tos_version never creates a DB client and never queries', async () => {
    const { POST } = await import('./route');
    const { createAdminClient } = await import('@estalara/db');

    const res = await POST(makeRequest(buildValidBody({ tos_version: 'platform-v0.1-ancient' })));

    expect(res.status).toBe(422);
    // Zero DB queries: the DB client itself is never even constructed for a
    // rejected tos_version, let alone queried.
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('a hard-refused tos_version with a grace window CONFIGURED but not matched also costs zero DB queries', async () => {
    vi.stubEnv('PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS', 'platform-v1.2-2026-05-01');
    const { POST } = await import('./route');
    const { createAdminClient } = await import('@estalara/db');

    const res = await POST(makeRequest(buildValidBody({ tos_version: 'platform-v0.1-ancient' })));

    expect(res.status).toBe(422);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
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

  it('provisioned external tenant + ITS OWN correct hash → 201, no capture, no tenant-count query (AC-5)', async () => {
    // FOLLOW-697 grid cell `provisioned × own correct hash`. Before FOLLOW-697 this test paired
    // "provisioned" with an ARBITRARY hash ('e' + 63 zeros) and asserted no capture — which is
    // why the `provisioned × canonical` cell (the fabrication) was never written.
    mockTenantSelectLimit.mockResolvedValue([
      {
        id: EXTERNAL_TENANT_ID,
        brandConfig: { brand_name: 'Costa Sol Properties', legal_entity: 'Costa Sol S.L.' },
      },
    ]);
    const { POST } = await import('./route');
    const { computeConsentTextHash, renderPlatformConsentText } = await import('./lib');
    const Sentry = await import('@sentry/nextjs');

    const ownHash = computeConsentTextHash(
      renderPlatformConsentText({
        brandName: 'Costa Sol Properties',
        legalEntity: 'Costa Sol S.L.',
      }),
    );
    const res = await POST(makeRequest(buildExternalBody({ consent_text_hash: ownHash })));

    expect(res.status).toBe(201);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    // A provisioned brand's branch is decided from the identity already fetched plus the hash
    // submitted — the tenant-count probe never runs (Rule AA / FOLLOW-684 AC-5).
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

// ─── FOLLOW-697: the refusal is keyed on EVIDENCE, not on the un-provisioned diagnosis ──
//
// #631 entered the gate only via `isUnprovisionedExternalBrand`, which short-circuits to
// false the instant a brand IS provisioned — so a PROVISIONED external brand submitting the
// canonical Estalara hash got a silent 201, no 422 and no alert. These tests complete the
// `provisioned? × hash-kind` grid whose diagonal #631's AC-4 matrix enumerated.

describe('POST brand gate — provisioned brands (FOLLOW-697)', () => {
  const EXTERNAL_TENANT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const BRAND_NAME = 'Costa Sol Properties';
  const LEGAL_ENTITY = 'Costa Sol S.L.';

  function buildExternalBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return buildValidBody({ tenant_id: EXTERNAL_TENANT_ID, ...overrides });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    vi.stubEnv('CONSENT_IP_ENCRYPTION_KEY', '');
    vi.stubEnv('FIRST_PARTY_TENANT_ID', TENANT_ID);
    mockSelectLimit.mockResolvedValue([]);
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }]);
    // PROVISIONED: `brand_config.brand_name` is set, so `isFallbackIdentity` is false and
    // this route renders (and can hash) the brand's own consent text.
    mockTenantSelectLimit.mockResolvedValue([
      {
        id: EXTERNAL_TENANT_ID,
        brandConfig: { brand_name: BRAND_NAME, legal_entity: LEGAL_ENTITY },
      },
    ]);
    mockInsertReturning.mockResolvedValue([{ id: 'consent-record-uuid-697' }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('provisioned external brand + canonical Estalara hash → 422, nothing written (returned 201 before FOLLOW-697)', async () => {
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');
    const Sentry = await import('@sentry/nextjs');

    const res = await POST(
      makeRequest(buildExternalBody({ consent_text_hash: CANONICAL_CONSENT_TEXT_HASH })),
    );

    expect(res.status).toBe(422);
    const body = await parseBody<{ code: string; tenant_id: string; error: string }>(res);
    expect(body.code).toBe('consent_text_hash_fabricated');
    expect(body.tenant_id).toBe(EXTERNAL_TENANT_ID);
    // AC-4: the EN-only limit of this gate is stated on the wire, not only in a comment.
    expect(body.error).toContain('FOLLOW-379');
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        level: 'error',
        tags: expect.objectContaining({ brand_identity: 'consent_text_hash_mismatch' }),
      }),
    );
    // Decided from the identity + the submitted hash alone — no tenant-count probe.
    expect(mockCountLimit).not.toHaveBeenCalled();
  });

  it('provisioned external brand + a hash that is neither its own nor canonical → 201 + alert, NOT refused', async () => {
    // A legitimately TRANSLATED rendering lands here too, so this must alert and write —
    // refusing it is FOLLOW-701's policy question, not this ticket's (AC-2).
    const otherHash = 'f' + '0'.repeat(63);
    const { POST } = await import('./route');
    const Sentry = await import('@sentry/nextjs');

    const res = await POST(makeRequest(buildExternalBody({ consent_text_hash: otherHash })));

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentTextHash).toBe(otherHash);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({ brand_identity: 'consent_text_hash_mismatch' }),
      }),
    );
  });

  it('a tenant provisioned AS the Estalara identity + canonical hash → NOT refused', async () => {
    // Guards the `rendersFirstPartyIdentity` check. FOLLOW-815 CORRECTION: this comment used to
    // say CANONICAL_CONSENT_TEXT_HASH "is NOT equal to computeConsentTextHash(
    // renderPlatformConsentText()) for the Estalara identity" — true of the placeholder, false
    // now that the constant is derived from exactly that expression. The behaviour under test is
    // unchanged and still worth pinning: a tenant explicitly provisioned AS the Estalara identity
    // must be accepted, and its written hash must be the canonical one. It now passes because
    // `expectedHash === CANONICAL_CONSENT_TEXT_HASH`, i.e. the `!==` branch is never entered,
    // rather than because the guard rescued it from a spurious inequality.
    mockTenantSelectLimit.mockResolvedValue([
      {
        id: EXTERNAL_TENANT_ID,
        brandConfig: { brand_name: 'Estalara', legal_entity: 'Time2Show, Inc.' },
      },
    ]);
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');

    const res = await POST(
      makeRequest(buildExternalBody({ consent_text_hash: CANONICAL_CONSENT_TEXT_HASH })),
    );

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentTextHash).toBe(CANONICAL_CONSENT_TEXT_HASH);
  });
});

// ─── FOLLOW-707: the omitted-hash path must not bypass the provisioned-brand gate ──────
//
// #632's evidence check (FOLLOW-697) is guarded on `body.consent_text_hash !== undefined` —
// when the field is OMITTED, the check never runs, and before this ticket the write defaulted
// straight to `CANONICAL_CONSENT_TEXT_HASH`, even for a PROVISIONED tenant whose own correct
// hash (`expectedHash`) was already computable. Reachable in the documented go-live shape: a
// first-party tenant that is ALSO provisioned with a non-Estalara identity.

describe('POST brand gate — provisioned tenant omits consent_text_hash (FOLLOW-707)', () => {
  const EXTERNAL_TENANT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const BRAND_NAME = 'Costa Sol Properties';
  const LEGAL_ENTITY = 'Costa Sol S.L.';

  function buildExternalBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return buildValidBody({ tenant_id: EXTERNAL_TENANT_ID, ...overrides });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    vi.stubEnv('CONSENT_IP_ENCRYPTION_KEY', '');
    mockSelectLimit.mockResolvedValue([]);
    // PROVISIONED: `brand_config.brand_name` is set, so `isFallbackIdentity` is false.
    mockTenantSelectLimit.mockResolvedValue([
      {
        id: EXTERNAL_TENANT_ID,
        brandConfig: { brand_name: BRAND_NAME, legal_entity: LEGAL_ENTITY },
      },
    ]);
    mockInsertReturning.mockResolvedValue([{ id: 'consent-record-uuid-707' }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("FIRST_PARTY_TENANT_ID SET to the provisioned tenant + omitted hash → writes the brand's own computed hash, not the canonical constant", async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', EXTERNAL_TENANT_ID);
    mockCountLimit.mockResolvedValue([{ id: EXTERNAL_TENANT_ID }]);
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH, computeConsentTextHash, renderPlatformConsentText } =
      await import('./lib');

    const res = await POST(makeRequest(buildExternalBody()));

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    const expectedHash = computeConsentTextHash(
      renderPlatformConsentText({ brandName: BRAND_NAME, legalEntity: LEGAL_ENTITY }),
    );
    expect(valuesArg.consentTextHash).toBe(expectedHash);
    // Today's bug: this used to equal the canonical constant instead.
    expect(valuesArg.consentTextHash).not.toBe(CANONICAL_CONSENT_TEXT_HASH);
    // FIRST_PARTY_TENANT_ID matches exactly → zero tenant-count probes anywhere in the route.
    expect(mockCountLimit).not.toHaveBeenCalled();
  });

  it("FIRST_PARTY_TENANT_ID UNSET + single tenant + omitted hash → writes the brand's own computed hash, not the canonical constant", async () => {
    // Env unset entirely; the provisioned tenant is the only tenant row.
    mockCountLimit.mockResolvedValue([{ id: EXTERNAL_TENANT_ID }]);
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH, computeConsentTextHash, renderPlatformConsentText } =
      await import('./lib');

    const res = await POST(makeRequest(buildExternalBody()));

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    const expectedHash = computeConsentTextHash(
      renderPlatformConsentText({ brandName: BRAND_NAME, legalEntity: LEGAL_ENTITY }),
    );
    expect(valuesArg.consentTextHash).toBe(expectedHash);
    expect(valuesArg.consentTextHash).not.toBe(CANONICAL_CONSENT_TEXT_HASH);
    // Invariant established by PR #632: at most ONE `select id from tenants limit 2` per POST.
    // Here it is paid exactly once, by step 7b's FOLLOW-660 probe — the provisioned branch (a)
    // at step 7c (and this ticket's hash-default expression) adds no probe of its own.
    expect(mockCountLimit).toHaveBeenCalledTimes(1);
  });
});

// ─── FOLLOW-698: a fail-CLOSED count probe must not refuse Estalara's OWN consent ────────
//
// Estalara's tenant also carries `isFallbackIdentity: true` (nobody seeds `brand_name` for the
// brand that IS the fallback), so #631's boolean gate evaluated TRUE for Estalara itself
// whenever the first party was unidentifiable or the count probe threw — and then answered 422
// "provably the wrong text", discarding a consent the visitor actually gave.

describe('POST brand gate — tri-state scope on the write path (FOLLOW-698)', () => {
  const SECOND_TENANT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    vi.stubEnv('CONSENT_IP_ENCRYPTION_KEY', '');
    // FIRST_PARTY_TENANT_ID deliberately UNSET — the configuration running today.
    mockSelectLimit.mockResolvedValue([]);
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }]);
    // No tenant row → the Estalara fallback identity, exactly as the live first-party tenant.
    mockTenantSelectLimit.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([{ id: 'consent-record-uuid-698' }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('env UNSET + a SECOND tenant + the CANONICAL hash → 201, consent kept (was 422 before FOLLOW-698)', async () => {
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }, { id: SECOND_TENANT_ID }]);
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');
    const Sentry = await import('@sentry/nextjs');

    // Step 7b tells this caller to "send an explicit consent_text_hash"; for Estalara the
    // canonical hash IS that hash. 7c must not then refuse it 55 lines later.
    const res = await POST(
      makeRequest(buildValidBody({ consent_text_hash: CANONICAL_CONSENT_TEXT_HASH })),
    );

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentTextHash).toBe(CANONICAL_CONSENT_TEXT_HASH);
    // No FALSE assertion: the request is not tagged as a provably-unprovisioned external brand
    // when the code never established which tenant is the first party.
    expect(Sentry.captureMessage).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        tags: expect.objectContaining({ brand_identity: 'unprovisioned_external' }),
      }),
    );
    // The dangerous configuration is still surfaced — with an honest tag.
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({ brand_identity: 'first_party_unidentifiable' }),
      }),
    );
  });

  it('tenant-count probe THROWS + canonical hash → retryable 500, nothing written, no false accusation', async () => {
    mockCountLimit.mockRejectedValue(new Error('ECONNREFUSED'));
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');
    const Sentry = await import('@sentry/nextjs');

    const res = await POST(
      makeRequest(buildValidBody({ consent_text_hash: CANONICAL_CONSENT_TEXT_HASH })),
    );

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: string; data_source: string; degraded: boolean }>(res);
    expect(body.data_source).toBe('db');
    expect(body.degraded).toBe(true);
    // Not the 422, and no "provably the wrong text" accusation on a read that merely failed.
    expect((body as Record<string, unknown>).code).toBeUndefined();
    expect(body.error).not.toContain('provably');
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('tenant-count probe THROWS + a brand-specific hash → the same retryable 500 (never a silent write on unknown scope)', async () => {
    mockCountLimit.mockRejectedValue(new Error('ECONNREFUSED'));
    const brandSpecificHash = 'a' + '0'.repeat(63);
    const { POST } = await import('./route');

    const res = await POST(makeRequest(buildValidBody({ consent_text_hash: brandSpecificHash })));

    expect(res.status).toBe(500);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it('env UNSET + the sole tenant + OMITTED hash → 201 and at most ONE probe (today live flow, cost claim AC-4)', async () => {
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');
    const Sentry = await import('@sentry/nextjs');

    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentTextHash).toBe(CANONICAL_CONSENT_TEXT_HASH);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    // Step 7b's own FOLLOW-660 probe, and nothing added on top of it: step 7c does not
    // re-classify a request that reached it without an explicit hash.
    expect(mockCountLimit).toHaveBeenCalledTimes(1);
  });

  it('env UNSET + the sole tenant + EXPLICIT canonical hash → 201, exempt, exactly one probe', async () => {
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');
    const Sentry = await import('@sentry/nextjs');

    const res = await POST(
      makeRequest(buildValidBody({ consent_text_hash: CANONICAL_CONSENT_TEXT_HASH })),
    );

    expect(res.status).toBe(201);
    // The first-party exemption is explicit: Estalara's own canonical hash is never refused and
    // never alerted on.
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    // 7b short-circuits (hash present), 7c classifies once — the invariant is "at most one".
    expect(mockCountLimit).toHaveBeenCalledTimes(1);
  });

  it('env SET to the first-party tenant → 201 and ZERO tenant-count probes (go-live cost claim)', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', TENANT_ID);
    const { POST } = await import('./route');
    const Sentry = await import('@sentry/nextjs');

    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(201);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
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
    // FOLLOW-815 CORRECTION: this used to assert `not.toContain('Time2Show')`. The v1.4 text
    // deliberately names Estalara / Time2Show, Inc. ONCE, in the closing processor sentence
    // (FOLLOW-711 / FOLLOW-814 item 3) — the CEO chose an honest processor disclosure over a
    // per-brand `brand_config` contact. What must still hold is that the CONTROLLER-facing
    // opening names the brand and only the brand: the substitution is intact, and the single
    // Estalara mention is confined to the processor sentence.
    expect(body.consent_text.split('\n\n')[0]).not.toContain('Time2Show');
    expect(body.consent_text.match(/Time2Show, Inc\./g)).toHaveLength(1);
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

// ─── FOLLOW-815 — the consent bundle: derived hash + withdrawal channel + processor sentence ──
//
// Discharges FOLLOW-704 (hash derived, not asserted), FOLLOW-710 (Art. 7(3) withdrawal channel
// is a concrete monitored mailbox) and FOLLOW-711 (the one address in the text no longer
// pretends to be the white-label brand's own), under the FOLLOW-814 CEO+DPO ruling of
// 2026-08-07, on ONE `PLATFORM_REGISTRATION_TOS_VERSION` bump.
//
// TEST-DESIGN NOTE, and it is the whole point of this block (RETRO-227 §4c TG-1): the defect
// these tests exist to prevent survived six weeks precisely because every existing assertion
// compared `CANONICAL_CONSENT_TEXT_HASH` to ITSELF. Nothing below re-states a production
// expression. The canonical text is obtained by calling the REAL `GET` handler and reading the
// bytes it actually serves; the hash is then computed with `crypto.createHash` directly —
// NOT with `computeConsentTextHash`, so the assertion crosses an independent implementation of
// SHA-256 hex rather than re-running the same helper the route ran.

describe('FOLLOW-815 — canonical hash is DERIVED from the text the subject actually receives', () => {
  const FALLBACK_TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  function makeGetRequest(tenantId: string): NextRequest {
    return new NextRequest(
      `http://localhost/api/v1/consent/platform-registration?tenant_id=${tenantId}`,
      { method: 'GET', headers: { 'x-consent-signature': computeHmac(TEST_SECRET, tenantId) } },
    );
  }

  /** The exact bytes the GET leg serves for a tenant, straight out of the real handler. */
  async function servedConsentText(tenantId: string): Promise<string> {
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(tenantId));
    expect(res.status).toBe(200);
    const body = await parseBody<{ consent_text: string; consent_text_hash: string }>(res);
    return body.consent_text;
  }

  /** SHA-256 hex computed WITHOUT `computeConsentTextHash` — an independent path. */
  function sha256Hex(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    vi.stubEnv('CONSENT_IP_ENCRYPTION_KEY', '');
    mockSelectLimit.mockResolvedValue([]);
    mockCountLimit.mockResolvedValue([{ id: FALLBACK_TENANT_ID }]);
    mockTenantSelectLimit.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([{ id: 'consent-record-uuid-815' }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // FOLLOW-704 AC-2 — the one assertion that would have caught this on 2026-06-21. Red against
  // the pre-FOLLOW-815 constant (a hand-typed literal that was the digest of no text), green
  // now that the constant is derived from the renderer.
  it('CANONICAL_CONSENT_TEXT_HASH equals the SHA-256 of the text GET actually serves for the first-party identity', async () => {
    const text = await servedConsentText(FALLBACK_TENANT_ID);
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');

    expect(CANONICAL_CONSENT_TEXT_HASH).toBe(sha256Hex(text));
    expect(CANONICAL_CONSENT_TEXT_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  // FOLLOW-704 AC-3 — the GET leg's returned hash and the value the POST leg DEFAULTS to must
  // be the same for the same identity. Before FOLLOW-815 the two legs disagreed (RETRO-227
  // LG-2): GET returned the digest of the rendered text, POST wrote the placeholder constant.
  it('the hash GET returns and the hash POST defaults to are the same value for the same identity', async () => {
    const { GET, POST } = await import('./route');

    const getRes = await GET(makeGetRequest(FALLBACK_TENANT_ID));
    const getBody = await parseBody<{ consent_text: string; consent_text_hash: string }>(getRes);

    const postRes = await POST(makeRequest(buildValidBody({ tenant_id: FALLBACK_TENANT_ID })));
    expect(postRes.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;

    expect(valuesArg.consentTextHash).toBe(getBody.consent_text_hash);
    // …and both are the digest of the bytes GET served, not of anything else.
    expect(valuesArg.consentTextHash).toBe(sha256Hex(getBody.consent_text));
  });

  // FOLLOW-704 AC-4 — the threat vector the old constant could not catch. A caller that
  // FABRICATES by copying Estalara's rendered consent text and hashing it submits exactly this
  // value. Pre-FOLLOW-815 it landed in the alert-only branch and was WRITTEN; now it is the
  // canonical value and hits the refusal. The hash here is derived from the real GET output for
  // a fallback (Estalara) tenant — no identity strings are re-stated by this test.
  it('an external provisioned tenant submitting the hash of ESTALARA’s served text is refused 422, nothing written', async () => {
    const estalaraText = await servedConsentText(FALLBACK_TENANT_ID);
    const fabricatedHash = sha256Hex(estalaraText);

    const EXTERNAL_TENANT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    vi.stubEnv('FIRST_PARTY_TENANT_ID', FALLBACK_TENANT_ID);
    mockTenantSelectLimit.mockResolvedValue([
      {
        id: EXTERNAL_TENANT_ID,
        brandConfig: { brand_name: 'Costa Sol Properties', legal_entity: 'Costa Sol S.L.' },
      },
    ]);
    vi.clearAllMocks();
    mockSelectLimit.mockResolvedValue([]);
    mockTenantSelectLimit.mockResolvedValue([
      {
        id: EXTERNAL_TENANT_ID,
        brandConfig: { brand_name: 'Costa Sol Properties', legal_entity: 'Costa Sol S.L.' },
      },
    ]);
    mockInsertReturning.mockResolvedValue([{ id: 'must-not-be-written' }]);

    const { POST } = await import('./route');
    const res = await POST(
      makeRequest(
        buildValidBody({
          tenant_id: EXTERNAL_TENANT_ID,
          consent_text_hash: fabricatedHash,
        }),
      ),
    );

    expect(res.status).toBe(422);
    const body = await parseBody<{ code: string; error: string }>(res);
    expect(body.code).toBe('consent_text_hash_fabricated');
    expect(mockInsert).not.toHaveBeenCalled();

    // FOLLOW-815 AC-5 — the widened scope note states the boundary that exists AFTER the
    // constant became version-tracking, not only the translation axis it named before.
    const { PLATFORM_REGISTRATION_TOS_VERSION } = await import('./lib');
    expect(body.error).toContain(PLATFORM_REGISTRATION_TOS_VERSION);
    expect(body.error).toContain('translated');
    expect(body.error).toContain('PRIOR');
  });
});

describe('FOLLOW-815 — the consent text names a withdrawal channel and an honest contact', () => {
  const FALLBACK_TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const EXTERNAL_TENANT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const WITHDRAWAL_MAILBOX = 'compliance@estalara.com';

  function makeGetRequest(tenantId: string): NextRequest {
    return new NextRequest(
      `http://localhost/api/v1/consent/platform-registration?tenant_id=${tenantId}`,
      { method: 'GET', headers: { 'x-consent-signature': computeHmac(TEST_SECRET, tenantId) } },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    mockCountLimit.mockResolvedValue([{ id: FALLBACK_TENANT_ID }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // FOLLOW-710 — Art. 7(3). The text served from 2026-06-21 to this bump said withdrawal
  // happens "by contacting the agency's DSR contact", an address that existed in no artifact,
  // code path or product surface. It must now name a reachable one, IN the rights sentence.
  it('names the monitored mailbox as the withdrawal channel in the rights paragraph, not merely as a documentation contact', async () => {
    mockTenantSelectLimit.mockResolvedValue([]);
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(FALLBACK_TENANT_ID));
    const body = await parseBody<{ consent_text: string }>(res);

    // The WHOLE paragraph is asserted, not just the address. A `toContain` on the mailbox alone
    // still passes if a later edit weakens "a monitored mailbox for privacy requests" to
    // something non-committal — verified by perturbing exactly that phrase and watching a
    // contains-only assertion stay green while only the CI text-sync gate went red.
    const rightsParagraph = body.consent_text
      .split('\n\n')
      .find((p) => p.startsWith('Your rights:'));
    expect(rightsParagraph).toBe(
      `Your rights: You can withdraw this consent at any time by emailing ${WITHDRAWAL_MAILBOX}, ` +
        'a monitored mailbox for privacy requests; you can also contact the agency directly. ' +
        'Withdrawal stops new personalization processing. A data erasure request will result in ' +
        "deletion of your behavioral data from Estalara's systems within 30 days. Withdrawal " +
        'does not affect the lawfulness of processing before withdrawal.',
    );
    // The un-actionable phrasing this bump replaced must be gone from the whole disclosure.
    expect(body.consent_text).not.toContain("the agency's DSR contact");
  });

  // FOLLOW-711 AC-4 — the missing test axis: nothing in the repo asserted what a NON-Estalara
  // identity renders, which is exactly why the mis-attribution hid. The whole final paragraph
  // is asserted, not a substring, so a future edit that softens it cannot pass silently.
  it('renders the Estalara-as-processor sentence for a white-label brand instead of claiming the mailbox is the brand’s own', async () => {
    mockTenantSelectLimit.mockResolvedValue([
      {
        id: EXTERNAL_TENANT_ID,
        brandConfig: { brand_name: 'Costa Sol Properties', legal_entity: 'Costa Sol S.L.' },
      },
    ]);
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(EXTERNAL_TENANT_ID));
    const body = await parseBody<{ consent_text: string }>(res);

    const paragraphs = body.consent_text.split('\n\n');
    expect(paragraphs[paragraphs.length - 1]).toBe(
      'For full details, see the agency privacy policy. The Adaptive Listings technology ' +
        'described above is operated by Estalara (Time2Show, Inc.), which processes your data ' +
        `for Costa Sol Properties as a processor; ${WITHDRAWAL_MAILBOX} is Estalara's address ` +
        "and reaches Estalara's privacy team.",
    );

    // The pre-FOLLOW-815 wording asserted the Estalara mailbox was the CLIENT BRAND's own
    // privacy documentation contact. That exact claim must not reappear.
    expect(body.consent_text).not.toContain(
      `Costa Sol Properties's privacy documentation at ${WITHDRAWAL_MAILBOX}`,
    );
    // The controller-facing opening still names the brand, not Estalara — the processor
    // sentence is additive, it does not re-brand the disclosure back to Estalara.
    expect(paragraphs[0]).toContain('Costa Sol Properties Adaptive Listings service');
    expect(paragraphs[0]).toContain('provided by Costa Sol S.L.');
  });
});

// ─── FOLLOW-815 — the grace band has no honest default hash ───────────────────
//
// Interaction the bump created and this PR closes: FOLLOW-715's grace window accepts a caller
// still attesting the PREVIOUS `tos_version`, and writes the row under THAT version. Combined
// with a derived `CANONICAL_CONSENT_TEXT_HASH` (which tracks the CURRENT text), defaulting a
// hash on that path would produce a row whose `tos_version` and `consent_text_hash` attest two
// DIFFERENT texts — the exact Art. 7(1) defect FOLLOW-712 closed for the refusal path. Refusing
// instead is not available: that is the registration outage FOLLOW-715 exists to prevent. So
// the column is written NULL — a recorded absence, alerted, never a plausible-looking digest of
// the wrong text.

describe('FOLLOW-815 — grace-band write does not fabricate a consent_text_hash', () => {
  const PREVIOUS_VERSION = 'platform-v1.3-2026-06-21';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    vi.stubEnv('CONSENT_IP_ENCRYPTION_KEY', '');
    vi.stubEnv('PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS', PREVIOUS_VERSION);
    mockSelectLimit.mockResolvedValue([]);
    mockCountLimit.mockResolvedValue([{ id: TENANT_ID }]);
    mockTenantSelectLimit.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([{ id: 'consent-record-uuid-815-grace' }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('grace band + OMITTED hash → 201, tos_version as attested, consent_text_hash NULL (not the current version’s hash)', async () => {
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');
    const Sentry = await import('@sentry/nextjs');

    const res = await POST(makeRequest(buildValidBody({ tos_version: PREVIOUS_VERSION })));

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.tosVersion).toBe(PREVIOUS_VERSION);
    expect(valuesArg.consentTextHash).toBeNull();
    expect(valuesArg.consentTextHash).not.toBe(CANONICAL_CONSENT_TEXT_HASH);

    // The absence is observable on the wire the operator watches, not silent.
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('the stored hash is NULL'),
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({ tos_version_grace: 'previous_version_accepted' }),
      }),
    );
  });

  it('grace band + EXPLICIT hash → 201, the caller’s own value stored as submitted', async () => {
    const explicitHash = 'b'.repeat(64);
    const { POST } = await import('./route');

    const res = await POST(
      makeRequest(
        buildValidBody({ tos_version: PREVIOUS_VERSION, consent_text_hash: explicitHash }),
      ),
    );

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentTextHash).toBe(explicitHash);
  });

  it('CURRENT-version write is unaffected — the hash is still defaulted, never NULL', async () => {
    const { POST } = await import('./route');
    const { PLATFORM_REGISTRATION_TOS_VERSION, CANONICAL_CONSENT_TEXT_HASH } =
      await import('./lib');

    const res = await POST(
      makeRequest(buildValidBody({ tos_version: PLATFORM_REGISTRATION_TOS_VERSION })),
    );

    expect(res.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(valuesArg.consentTextHash).toBe(CANONICAL_CONSENT_TEXT_HASH);
  });
});
