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
 *   - one tenant (FOLLOW-1332): only the Estalara tenant is accepted, and its record/text are
 *     pinned byte-for-byte to what the removed per-brand path produced for the first party
 *
 * @module apps/control-plane/src/app/api/v1/consent/platform-registration/route.test
 */

import { createHash, createHmac } from 'crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';

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
// GET reads the Estalara tenant row for `data_source` provenance only (FOLLOW-1332: the identity
// is a constant; `brand_config` is no longer read).
const mockTenantsTable = { id: 'id' };

const mockInsertReturning = vi.fn();
const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

// consentRecords select chain — nonce-check and duplicate-check in POST (route.ts `:398`/`:419`).
const mockSelectLimit = vi.fn();
const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));

// tenants select chain — the GET leg's tenant-row read. Kept on ITS OWN mock so a POST test can
// assert the POST never touches `tenants` (FOLLOW-1332 removed the brand lookup and the
// tenant-count probe the external-brand gates used).
const mockTenantSelectLimit = vi.fn();
const mockTenantSelectWhere = vi.fn(() => ({ limit: mockTenantSelectLimit }));

const mockSelectFrom = vi.fn((table: unknown) => {
  if (table === mockTenantsTable) {
    return { where: mockTenantSelectWhere };
  }
  return { where: mockSelectWhere };
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
/** The Estalara tenant — the only tenant the route accepts (FOLLOW-1332). Real module value. */
const TENANT_ID = ESTALARA_TENANT_ID;
/** Any other well-formed tenant id. */
const OTHER_TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
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

describe('POST one tenant — the Estalara path, pinned (FOLLOW-1332)', () => {
  // Before FOLLOW-1332 the route classified `tenant_id` as first-party or external (env
  // `FIRST_PARTY_TENANT_ID`, a tenant-count probe, per-brand `tenants.brand_config`) and ran
  // FOLLOW-654/659/660/684/697/698/707 gates for external brands. With one tenant those gates are
  // gone; these cases pin that the Estalara path through them is unchanged and that any other
  // tenant id is refused before anything is read or written.

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PLATFORM_REGISTRATION_CONSENT_SECRET', TEST_SECRET);
    vi.stubEnv('CONSENT_IP_ENCRYPTION_KEY', '');
    mockSelectLimit.mockResolvedValue([]);
    mockTenantSelectLimit.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([{ id: 'consent-record-uuid-1332' }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('Estalara + omitted hash → 201; the record is byte-for-byte the first-party record', async () => {
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH, PLATFORM_REGISTRATION_TOS_VERSION } =
      await import('./lib');
    const res = await POST(makeRequest(buildValidBody({ user_agent: 'UA/1.0' })));

    expect(res.status).toBe(201);
    expect(mockInsertValues).toHaveBeenCalledOnce();
    const values = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
    // Exact key set and values — no ipAddress key without CONSENT_IP_ENCRYPTION_KEY.
    expect(Object.keys(values).sort()).toEqual(
      [
        'consentTextHash',
        'consentType',
        'granted',
        'grantedAt',
        'sessionId',
        'tenantId',
        'tosVersion',
        'userAgent',
      ].sort(),
    );
    expect(values).toMatchObject({
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      consentType: 'platform_registration',
      granted: true,
      tosVersion: PLATFORM_REGISTRATION_TOS_VERSION,
      consentTextHash: CANONICAL_CONSENT_TEXT_HASH,
      userAgent: 'UA/1.0',
    });
    expect(values.grantedAt).toBeInstanceOf(Date);
  });

  it('Estalara + the canonical hash → 201, stored as submitted, no alert', async () => {
    const { POST } = await import('./route');
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');
    const Sentry = await import('@sentry/nextjs');
    const res = await POST(
      makeRequest(buildValidBody({ consent_text_hash: CANONICAL_CONSENT_TEXT_HASH })),
    );

    expect(res.status).toBe(201);
    const values = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
    expect(values.consentTextHash).toBe(CANONICAL_CONSENT_TEXT_HASH);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('Estalara + any other well-formed hash (e.g. a translation) → 201, stored as submitted, no alert', async () => {
    const translatedHash = 'b'.repeat(64);
    const { POST } = await import('./route');
    const Sentry = await import('@sentry/nextjs');
    const res = await POST(makeRequest(buildValidBody({ consent_text_hash: translatedHash })));

    expect(res.status).toBe(201);
    const values = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
    expect(values.consentTextHash).toBe(translatedHash);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('the Estalara id is recognised case-insensitively, as the former first-party check did (FOLLOW-678)', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody({ tenant_id: TENANT_ID.toUpperCase() })));
    expect(res.status).toBe(201);
  });

  it('the POST never reads `tenants` — no brand lookup, no tenant-count probe', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody()));

    expect(res.status).toBe(201);
    expect(mockSelectFrom).not.toHaveBeenCalledWith(mockTenantsTable);
    expect(mockTenantSelectLimit).not.toHaveBeenCalled();
  });

  it.each([
    ['omitted hash', {}],
    ['explicit hash', { consent_text_hash: 'c'.repeat(64) }],
  ])('any other tenant id (%s) → 400, nothing written, no DB client', async (_label, extra) => {
    const { createAdminClient } = await import('@estalara/db');
    const { POST } = await import('./route');
    const res = await POST(makeRequest(buildValidBody({ tenant_id: OTHER_TENANT_ID, ...extra })));

    expect(res.status).toBe(400);
    const body = await parseBody<{ error: string; code?: string }>(res);
    expect(body.error).toContain('not the Estalara tenant');
    expect(body.code).toBeUndefined();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

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

  it('serves the Estalara text — pinned against the renderer and the constant identity', async () => {
    mockTenantSelectLimit.mockResolvedValue([{ id: TENANT_ID }]);
    const { GET } = await import('./route');
    const { renderPlatformConsentText, computeConsentTextHash, PLATFORM_REGISTRATION_TOS_VERSION } =
      await import('./lib');
    const res = await GET(makeGetRequest(TENANT_ID));

    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    const expectedText = renderPlatformConsentText({
      brandName: 'Estalara',
      legalEntity: 'Time2Show, Inc.',
    });
    // The whole response, key for key — what the first-party tenant received before FOLLOW-1332
    // (no `brand_config.brand_name` → the Estalara fallback identity).
    expect(body).toEqual({
      tenant_id: TENANT_ID,
      brand_name: 'Estalara',
      legal_entity: 'Time2Show, Inc.',
      tos_version: PLATFORM_REGISTRATION_TOS_VERSION,
      consent_text: expectedText,
      consent_text_hash: computeConsentTextHash(expectedText),
      data_source: 'stored',
    });
    expect(expectedText).toContain('Estalara Adaptive Listings service');
    expect(expectedText).toContain('provided by Time2Show, Inc.');
  });

  it('non-Estalara tenant → 409 brand_identity_not_provisioned, no consent text, no DB read', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(OTHER_TENANT_ID));

    expect(res.status).toBe(409);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.code).toBe('brand_identity_not_provisioned');
    expect(body.tenant_id).toBe(OTHER_TENANT_ID);
    expect(body.consent_text).toBeUndefined();
    expect(mockTenantSelectLimit).not.toHaveBeenCalled();
  });

  it('returns data_source=default (Estalara) when no tenant row exists', async () => {
    mockTenantSelectLimit.mockResolvedValue([]);
    // FOLLOW-660: default to exactly ONE tenant — today's live single-tenant state.
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

describe('FOLLOW-815 — canonical hash is DERIVED from the text the subject actually receives', () => {
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
    const text = await servedConsentText(TENANT_ID);
    const { CANONICAL_CONSENT_TEXT_HASH } = await import('./lib');

    expect(CANONICAL_CONSENT_TEXT_HASH).toBe(sha256Hex(text));
    expect(CANONICAL_CONSENT_TEXT_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  // FOLLOW-704 AC-3 — the GET leg's returned hash and the value the POST leg DEFAULTS to must
  // be the same for the same identity. Before FOLLOW-815 the two legs disagreed (RETRO-227
  // LG-2): GET returned the digest of the rendered text, POST wrote the placeholder constant.
  it('the hash GET returns and the hash POST defaults to are the same value for the same identity', async () => {
    const { GET, POST } = await import('./route');

    const getRes = await GET(makeGetRequest(TENANT_ID));
    const getBody = await parseBody<{ consent_text: string; consent_text_hash: string }>(getRes);

    const postRes = await POST(makeRequest(buildValidBody({ tenant_id: TENANT_ID })));
    expect(postRes.status).toBe(201);
    const valuesArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >;

    expect(valuesArg.consentTextHash).toBe(getBody.consent_text_hash);
    // …and both are the digest of the bytes GET served, not of anything else.
    expect(valuesArg.consentTextHash).toBe(sha256Hex(getBody.consent_text));
  });
});

describe('FOLLOW-815 — the consent text names a withdrawal channel and an honest contact', () => {
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
    const res = await GET(makeGetRequest(TENANT_ID));
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

  // FOLLOW-711 AC-4 — the whole closing paragraph, not a substring, so a future edit that softens
  // the processor disclosure cannot pass silently. FOLLOW-1332: asserted for the Estalara text, the
  // only one served now (the white-label rendering this case used to drive no longer exists).
  it('renders the Estalara-as-processor closing paragraph with the monitored mailbox', async () => {
    mockTenantSelectLimit.mockResolvedValue([{ id: TENANT_ID }]);
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(TENANT_ID));
    const body = await parseBody<{ consent_text: string }>(res);

    const paragraphs = body.consent_text.split('\n\n');
    expect(paragraphs[paragraphs.length - 1]).toBe(
      'For full details, see the agency privacy policy. The Adaptive Listings technology ' +
        'described above is operated by Estalara (Time2Show, Inc.), which processes your data ' +
        `for Estalara as a processor; ${WITHDRAWAL_MAILBOX} is Estalara's address ` +
        "and reaches Estalara's privacy team.",
    );
    expect(paragraphs[0]).toContain('Estalara Adaptive Listings service');
    expect(paragraphs[0]).toContain('provided by Time2Show, Inc.');
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
