/**
 * Integration tests for DSR endpoints.
 *
 * All external dependencies are mocked:
 *   - @estalara/db  — createAdminClient, table symbols
 *   - @estalara/auth — getAuthClaims, isTenantClaims
 *   - @/lib/dsr-otp — generateOtp, hashOtp
 *   - @/lib/email/resend — sendEmail
 *   - ./_clickhouse — writeDsrAuditLog
 *
 * Coverage:
 *   - POST /api/dsr/initiate with valid JWT + valid session → 202, email sent
 *   - POST /api/dsr/initiate with invalid session_id → 404
 *   - POST /api/dsr/initiate with missing auth → 401
 *   - POST /api/dsr/initiate with non-tenant JWT → 403
 *   - POST /api/dsr/initiate with invalid body → 400
 *   - GET  /api/dsr/access with valid OTP → 200 with correct shape
 *   - GET  /api/dsr/access with expired OTP → 401 { error.code: 'token_expired' }
 *   - GET  /api/dsr/access with already-used OTP → 401 { error.code: 'token_already_used' }
 *   - GET  /api/dsr/access with missing token param → 400
 *   - POST /api/dsr/erase with valid OTP → 200, session deleted from DB
 *   - POST /api/dsr/erase with expired OTP → 401
 *   - GET  /api/dsr/portability with valid OTP → 200 with Content-Disposition header
 *
 * FOLLOW-431: writeDsrAuditLog is now registered via after() in every DSR route.
 * after() is mocked as a synchronous pass-through so existing assertions about
 * writeDsrAuditLog being called remain valid.
 *
 * @module apps/control-plane/src/app/api/dsr/dsr-routes.test
 */

// ─── next/server mock (must be before all imports) ───────────────────────────
// Mock after() as a synchronous pass-through spy so DSR routes that call
// after(() => writeDsrAuditLog(...)) still invoke the mock synchronously.
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
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type * as DsrVerifyModule from '@/lib/dsr-verify';

// ─── Stable mock references (vi.hoisted for hoist safety) ────────────────────

const {
  mockSelect,
  mockInsert,
  mockUpdate,
  mockDelete,
  mockTransaction,
  mockSendEmail,
  mockWriteDsrAuditLog,
  mockGetAuthClaims,
  mockIsTenantClaims,
  mockHashOtp,
  mockVerifyAndConsumeOtp,
  mockCheckInitiateRateLimit,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockTransaction: vi.fn(),
  mockSendEmail: vi.fn(),
  mockWriteDsrAuditLog: vi.fn().mockResolvedValue(undefined),
  mockGetAuthClaims: vi.fn(),
  mockIsTenantClaims: vi.fn(),
  mockHashOtp: vi.fn().mockImplementation((otp: string) => `hash_of_${otp}`),
  // FOLLOW-455: request-scoped OTP verification is extracted into its own
  // module so route tests don't need to fabricate the full select/update
  // chain for the OTP check — see apps/control-plane/src/lib/dsr-verify.ts.
  mockVerifyAndConsumeOtp: vi.fn(),
  mockCheckInitiateRateLimit: vi.fn().mockResolvedValue({ allowed: true, count: 0 }),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    transaction: mockTransaction,
  })),
  dsrVerifications: {
    id: 'id',
    otpHash: 'otp_hash',
    dsrType: 'dsr_type',
    usedAt: 'used_at',
    expiresAt: 'expires_at',
    tenantId: 'tenant_id',
    sessionId: 'session_id',
    email: 'email',
    createdAt: 'created_at',
  },
  sessionEmbeddings: { sessionId: 'session_id', tenantId: 'tenant_id' },
  // FOLLOW-654: brand identity lookup for the DSR OTP email display name.
  tenants: { id: 'id', brandConfig: 'brand_config' },
  consentRecords: {
    sessionId: 'session_id',
    // FOLLOW-1108: tenantId present — every consent_records read/delete in the
    // DSR routes is tenant-scoped.
    tenantId: 'tenant_id',
    consentType: 'consent_type',
    granted: 'granted',
    grantedAt: 'granted_at',
    revokedAt: 'revoked_at',
  },
  // FOLLOW-039 — used by POST /api/dsr/erase for idempotency lookup + INSERT.
  dsrClickhouseMutations: {
    id: 'id',
    tenantId: 'tenant_id',
    sessionId: 'session_id',
    status: 'status',
    tableName: 'table_name',
  },
  // FOLLOW-172 / FOLLOW-246 — used by erase cascade AND access/portability read.
  conversionLabels: {
    id: 'id',
    tenantId: 'tenant_id',
    predictionId: 'prediction_id',
    leadId: 'lead_id',
    outcomeClass: 'outcome_class',
    labelSource: 'label_source',
    confidence: 'confidence',
    labeledAt: 'labeled_at',
    notes: 'notes',
  },
  // FOLLOW-193 / DPIA §8 line 773 — used by POST /api/dsr/erase for engagement_scores cascade.
  engagementScores: {
    sessionId: 'session_id',
    tenantId: 'tenant_id',
  },
  // FOLLOW-455 / audit F-20 — used by POST /api/dsr/erase for quiz_completions
  // and intent_sessions erasure cascades.
  quizCompletions: {
    sessionId: 'session_id',
    tenantId: 'tenant_id',
  },
  intentSessions: {
    id: 'id',
    sessionId: 'session_id',
    tenantId: 'tenant_id',
  },
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, _op: 'eq' })),
  and: vi.fn((...args: unknown[]) => ({ args, _op: 'and' })),
  ne: vi.fn((col: unknown, val: unknown) => ({ col, val, _op: 'ne' })),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: mockGetAuthClaims,
  isTenantClaims: mockIsTenantClaims,
}));

// FOLLOW-659: /api/dsr/initiate alerts (never blocks) when an EXTERNAL brand has no
// configured legal identity — the alarm is the Sentry capture, so it is asserted.
const { mockCaptureMessage } = vi.hoisted(() => ({ mockCaptureMessage: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({
  captureMessage: mockCaptureMessage,
  captureException: vi.fn(),
}));

vi.mock('@/lib/dsr-otp', () => ({
  generateOtp: vi.fn().mockReturnValue('123456'),
  hashOtp: mockHashOtp,
  verifyOtp: vi.fn(),
}));

// FOLLOW-455: keep the real (pure) dsrVerifyFailureResponse mapper; only
// mock verifyAndConsumeOtp so tests configure {ok, record|reason} directly
// instead of fabricating the underlying select/update chain.
vi.mock('@/lib/dsr-verify', async (importOriginal) => {
  const real = await importOriginal<typeof DsrVerifyModule>();
  return {
    ...real,
    verifyAndConsumeOtp: mockVerifyAndConsumeOtp,
  };
});

vi.mock('@/lib/dsr-rate-limit', () => ({
  checkInitiateRateLimit: mockCheckInitiateRateLimit,
  INITIATE_RATE_LIMIT_MAX: 5,
  INITIATE_RATE_LIMIT_WINDOW_MS: 60 * 60 * 1000,
}));

vi.mock('@/lib/email/resend', () => ({
  sendEmail: mockSendEmail,
  // FOLLOW-654: keep the real (pure) display-name builder so the DSR route's
  // per-brand `from` value is exercised end-to-end.
  brandSenderFrom: (displayName: string) =>
    `${displayName.trim() || 'Estalara'} <noreply@contact.estalara.com>`,
}));

vi.mock('./_clickhouse', () => ({
  writeDsrAuditLog: mockWriteDsrAuditLog,
  // FOLLOW-238 AC3: expose DSR_AUDIT_ACTIONS so routes that import it don't error.
  DSR_AUDIT_ACTIONS: {
    initiated: 'initiated',
    completed: 'completed',
    expired: 'expired',
    failed: 'failed',
    crm_unverifiable: 'crm_unverifiable',
    rate_limited: 'rate_limited',
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(
  method: 'GET' | 'POST',
  path: string,
  opts: {
    body?: unknown;
    searchParams?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  const url = new URL(`http://localhost${path}`);
  if (opts.searchParams) {
    for (const [k, v] of Object.entries(opts.searchParams)) {
      url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    return new NextRequest(url, { method, headers, body: JSON.stringify(opts.body) });
  }
  return new NextRequest(url, { method, headers });
}

/**
 * Build a thenable chain mock that resolves with `rows`.
 * Each call to a chain method (from/where/limit/etc.) returns `self`,
 * and `.then()` resolves with `rows` so `await db.select().from(...).where(...).limit(1)`
 * yields `rows`.
 */
function buildChain(rows: unknown[]) {
  interface Self {
    from: () => Self;
    where: () => Self;
    limit: () => Self;
    returning: () => Self;
    set: () => Self;
    values: () => Self;
    then: (
      onFulfilled: (v: unknown[]) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise<unknown>;
    catch: (onRejected: (e: unknown) => unknown) => Promise<unknown>;
  }

  const self = {} as Self;
  const chainFn = () => self;
  self.from = chainFn;
  self.where = chainFn;
  self.limit = chainFn;
  self.returning = chainFn;
  self.set = chainFn;
  self.values = chainFn;
  self.then = (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(onFulfilled, onRejected);
  self.catch = (onRejected: (e: unknown) => unknown) => Promise.resolve(rows).catch(onRejected);
  return self;
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const TENANT_CLAIMS = {
  sub: 'user-001',
  email: 'admin@agency.com',
  tenant_id: 'tenant-uuid-001',
  agency_role: 'agency:admin' as const,
  estalara_staff: false as const,
  mfa_verified: true,
};

function makeValidRecord(dsrType: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'dsr-uuid-001',
    tenantId: 'tenant-uuid-001',
    sessionId: 'sess-abc123',
    email: 'buyer@example.com',
    dsrType,
    otpHash: 'hash_of_123456',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    usedAt: null,
    createdAt: new Date(),
    // FOLLOW-246: durable CRM lead_id, nullable.
    durableLeadId: null,
    ...overrides,
  };
}

/** Build a conversion_labels row fixture for FOLLOW-246 tests. */
function makeLabelRow(leadId: string, predictionId = 'pred-001') {
  return {
    id: `label-${predictionId}`,
    predictionId,
    leadId,
    outcomeClass: 'viewing_booked',
    labelSource: 'system',
    confidence: null,
    labeledAt: new Date('2026-04-01T10:00:00Z'),
    notes: null,
  };
}

// ─── POST /api/dsr/initiate ───────────────────────────────────────────────────

describe('POST /api/dsr/initiate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue(undefined);
    mockWriteDsrAuditLog.mockResolvedValue(undefined);
    mockGetAuthClaims.mockResolvedValue(TENANT_CLAIMS);
    mockIsTenantClaims.mockReturnValue(true);
    mockCheckInitiateRateLimit.mockResolvedValue({ allowed: true, count: 0 });
  });

  it('returns 401 when Authorization header is missing', async () => {
    mockGetAuthClaims.mockResolvedValueOnce(null);

    const { POST } = await import('./initiate/route.js');
    const req = makeRequest('POST', '/api/dsr/initiate', {
      body: { session_id: 'sess-001', email: 'b@example.com', dsr_type: 'access' },
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('returns 403 when authenticated user is not a tenant user (staff)', async () => {
    mockIsTenantClaims.mockReturnValueOnce(false);

    const { POST } = await import('./initiate/route.js');
    const req = makeRequest('POST', '/api/dsr/initiate', {
      body: { session_id: 'sess-001', email: 'b@example.com', dsr_type: 'access' },
      headers: { Authorization: 'Bearer staff_token' },
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 when body is invalid', async () => {
    const { POST } = await import('./initiate/route.js');
    const req = makeRequest('POST', '/api/dsr/initiate', {
      body: { session_id: '', email: 'not-an-email', dsr_type: 'invalid' },
      headers: { Authorization: 'Bearer jwt_token' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 404 when session_id is not found for this tenant', async () => {
    mockSelect.mockReturnValue(buildChain([]));

    const { POST } = await import('./initiate/route.js');
    const req = makeRequest('POST', '/api/dsr/initiate', {
      body: { session_id: 'nonexistent-sess', email: 'b@example.com', dsr_type: 'access' },
      headers: { Authorization: 'Bearer jwt_token' },
    });
    const res = await POST(req);

    expect(res.status).toBe(404);
  });

  it('returns 202 with request_id and expires_at when everything is valid', async () => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    mockSelect
      .mockReturnValueOnce(buildChain([{ sessionId: 'sess-valid-001' }])) // session lookup
      .mockReturnValueOnce(buildChain([])); // FOLLOW-654 brand identity lookup (no row → Estalara)
    mockInsert.mockReturnValue(buildChain([{ id: 'dsr-uuid-001', expiresAt }]));

    const { POST } = await import('./initiate/route.js');
    const req = makeRequest('POST', '/api/dsr/initiate', {
      body: { session_id: 'sess-valid-001', email: 'buyer@example.com', dsr_type: 'access' },
      headers: { Authorization: 'Bearer jwt_token' },
    });
    const res = await POST(req);

    expect(res.status).toBe(202);
    const body = (await res.json()) as { request_id: string; expires_at: string };
    expect(body).toHaveProperty('request_id');
    expect(body).toHaveProperty('expires_at');
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@example.com',
        subject: 'Your Estalara data request',
      }),
    );
  });

  // ─── FOLLOW-654 leg 3: per-brand DSR OTP email display identity ────────────

  it('uses the brand display identity in the OTP email for a non-first-party tenant', async () => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    mockSelect
      .mockReturnValueOnce(buildChain([{ sessionId: 'sess-valid-001' }])) // session lookup
      .mockReturnValueOnce(
        buildChain([{ brandConfig: { brand_name: 'Costa Sol Properties' } }]), // brand identity
      );
    mockInsert.mockReturnValue(buildChain([{ id: 'dsr-uuid-002', expiresAt }]));

    const { POST } = await import('./initiate/route.js');
    const req = makeRequest('POST', '/api/dsr/initiate', {
      body: { session_id: 'sess-valid-001', email: 'buyer@example.com', dsr_type: 'access' },
      headers: { Authorization: 'Bearer jwt_token' },
    });
    const res = await POST(req);

    expect(res.status).toBe(202);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Costa Sol Properties <noreply@contact.estalara.com>',
        subject: 'Your Costa Sol Properties data request',
        html: expect.stringContaining('processed by Costa Sol Properties'),
      }),
    );
    // Sending domain/infrastructure is unchanged — only the display name differs.
    const call = mockSendEmail.mock.calls[0]?.[0] as { from: string };
    expect(call.from).toContain('noreply@contact.estalara.com');
  });

  it('falls back to the Estalara identity when the tenant has no brand_name (first-party)', async () => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    mockSelect
      .mockReturnValueOnce(buildChain([{ sessionId: 'sess-valid-001' }])) // session lookup
      .mockReturnValueOnce(
        buildChain([{ brandConfig: { primary_color: '#1a73e8' } }]), // no brand_name key
      );
    mockInsert.mockReturnValue(buildChain([{ id: 'dsr-uuid-003', expiresAt }]));

    const { POST } = await import('./initiate/route.js');
    const req = makeRequest('POST', '/api/dsr/initiate', {
      body: { session_id: 'sess-valid-001', email: 'buyer@example.com', dsr_type: 'access' },
      headers: { Authorization: 'Bearer jwt_token' },
    });
    const res = await POST(req);

    expect(res.status).toBe(202);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Estalara <noreply@contact.estalara.com>',
        subject: 'Your Estalara data request',
        html: expect.stringContaining('processed by Estalara'),
      }),
    );
  });

  // ─── FOLLOW-659: un-provisioned external brand → alert, but never drop the mail ──

  describe('brand identity provisioning alarm (FOLLOW-659)', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    function primeSelects(brandConfig: unknown): void {
      mockSelect
        .mockReturnValueOnce(buildChain([{ sessionId: 'sess-valid-001' }])) // session lookup
        .mockReturnValueOnce(buildChain([{ brandConfig }])); // brand identity lookup
      mockInsert.mockReturnValue(
        buildChain([{ id: 'dsr-uuid-659', expiresAt: new Date(Date.now() + 15 * 60 * 1000) }]),
      );
    }

    function initiateRequest(): NextRequest {
      return makeRequest('POST', '/api/dsr/initiate', {
        body: { session_id: 'sess-valid-001', email: 'buyer@example.com', dsr_type: 'access' },
        headers: { Authorization: 'Bearer jwt_token' },
      });
    }

    // [FOLLOW-678] Well-formed UUID, distinct from TENANT_CLAIMS.tenant_id — the env value must
    // be a well-formed UUID to reach the `valid` classification (a malformed value now degrades
    // to "unset", not "deny everyone"); it must also differ from the claims tenant id so these
    // tests still exercise the "external, non-matching" branch they exercise pre-fix.
    const OTHER_FIRST_PARTY_UUID = '99999999-9999-4999-8999-999999999999';

    it('external brand with no brand_name → STILL sends the OTP e-mail, and alerts Sentry', async () => {
      // Blocking here would obstruct the data subject's Art. 15 request over an operator
      // config gap — the alarm goes to ops, not to the data subject.
      vi.stubEnv('FIRST_PARTY_TENANT_ID', OTHER_FIRST_PARTY_UUID);
      primeSelects({ primary_color: '#1a73e8' });

      const { POST } = await import('./initiate/route.js');
      const res = await POST(initiateRequest());

      expect(res.status).toBe(202);
      expect(mockSendEmail).toHaveBeenCalledOnce();
      expect(mockCaptureMessage).toHaveBeenCalledOnce();
      const [msg, ctx] = mockCaptureMessage.mock.calls[0] as [string, Record<string, unknown>];
      expect(msg).toContain('brand_config.brand_name');
      expect(ctx.level).toBe('error');
    });

    it('THE first-party tenant with no brand_name → no alert (Estalara is its correct identity)', async () => {
      // [FOLLOW-678] TENANT_CLAIMS.tenant_id ('tenant-uuid-001') is not itself a well-formed
      // UUID, so it can never equal a well-formed FIRST_PARTY_TENANT_ID env value under the
      // canonicalized comparison. Override just this test's claims to a well-formed UUID so the
      // env and the tenant id can genuinely match (exercising the `valid`-match branch, not the
      // malformed→unset fallback).
      const FIRST_PARTY_UUID = '11111111-1111-4111-8111-111111111111';
      mockGetAuthClaims.mockResolvedValueOnce({ ...TENANT_CLAIMS, tenant_id: FIRST_PARTY_UUID });
      vi.stubEnv('FIRST_PARTY_TENANT_ID', FIRST_PARTY_UUID);
      primeSelects({ primary_color: '#1a73e8' });

      const { POST } = await import('./initiate/route.js');
      const res = await POST(initiateRequest());

      expect(res.status).toBe(202);
      expect(mockSendEmail).toHaveBeenCalledOnce();
      expect(mockCaptureMessage).not.toHaveBeenCalled();
    });

    it('external brand WITH a configured identity → no alert', async () => {
      vi.stubEnv('FIRST_PARTY_TENANT_ID', OTHER_FIRST_PARTY_UUID);
      primeSelects({ brand_name: 'Costa Sol Properties' });

      const { POST } = await import('./initiate/route.js');
      const res = await POST(initiateRequest());

      expect(res.status).toBe(202);
      expect(mockCaptureMessage).not.toHaveBeenCalled();
    });
  });

  // ─── FOLLOW-455 / audit F-20: anti email-bomb rate limiting ────────────────

  it('returns 429 and does NOT send an email when the rate limit is exceeded', async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ sessionId: 'sess-valid-001' }]));
    mockCheckInitiateRateLimit.mockResolvedValueOnce({ allowed: false, count: 5 });

    const { POST } = await import('./initiate/route.js');
    const req = makeRequest('POST', '/api/dsr/initiate', {
      body: { session_id: 'sess-valid-001', email: 'bombed@example.com', dsr_type: 'access' },
      headers: { Authorization: 'Bearer jwt_token' },
    });
    const res = await POST(req);

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

// ─── GET /api/dsr/access ──────────────────────────────────────────────────────

describe('GET /api/dsr/access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHashOtp.mockImplementation((otp: string) => `hash_of_${otp}`);
    mockWriteDsrAuditLog.mockResolvedValue(undefined);
  });

  it('returns 400 when token or request_id param is missing', async () => {
    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access');
    const res = await GET(req);

    expect(res.status).toBe(400);
  });

  it('returns 404 when the DSR request is not found (verifyAndConsumeOtp: not_found)', async () => {
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: false, reason: 'not_found' });

    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access', {
      searchParams: { request_id: 'dsr-uuid-001', token: '000000' },
    });
    const res = await GET(req);

    expect(res.status).toBe(404);
  });

  it('returns 401 with token_expired when the request has expired', async () => {
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: false, reason: 'expired' });

    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access', {
      searchParams: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('token_expired');
  });

  it('returns 401 with token_already_used when the request has already been consumed', async () => {
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: false, reason: 'already_used' });

    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access', {
      searchParams: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('token_already_used');
  });

  it('returns 429 with too_many_attempts when the request is locked out (FOLLOW-455)', async () => {
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: false, reason: 'locked' });

    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access', {
      searchParams: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await GET(req);

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('too_many_attempts');
  });

  it('returns 401 with invalid_code when a wrong code is submitted for a valid request_id (FOLLOW-455)', async () => {
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: false, reason: 'invalid_code' });

    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access', {
      searchParams: { request_id: 'dsr-uuid-001', token: '000001' },
    });
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_code');
  });

  it('returns 200 with correct shape for a valid (request_id, token)', async () => {
    const validRecord = makeValidRecord('access');
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: true, record: validRecord });

    const sessionRow = {
      sessionId: 'sess-abc123',
      tenantId: 'tenant-uuid-001',
      matchedArchetype: 'yield_hunter',
      finalArchetype: null,
      createdAt: new Date('2026-04-01T10:00:00Z'),
      updatedAt: new Date('2026-04-02T10:00:00Z'),
    };
    const consentRow = {
      consentType: 'behavioral_tracking',
      granted: true,
      grantedAt: new Date('2026-04-01T10:00:00Z'),
      revokedAt: null,
    };

    // Call order (OTP verification handled by mocked verifyAndConsumeOtp,
    // NOT via mockSelect): sessionEmbeddings → consentRecords →
    // conversion_labels Pass A → (no Pass B: durableLeadId null)
    mockSelect
      .mockReturnValueOnce(buildChain([sessionRow])) // 1st: session
      .mockReturnValueOnce(buildChain([consentRow])) // 2nd: consents
      .mockReturnValueOnce(buildChain([])); // 3rd: conversion_labels Pass A (empty)
    // Pass B skipped: durableLeadId is null.

    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access', {
      searchParams: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session_id: string;
      tenant_id: string;
      clickhouse: { available: boolean; note?: string; tables: unknown[] };
      matched_archetype: string | null;
      consent_records: unknown[];
      conversion_labels: unknown[];
    };
    expect(body).toHaveProperty('session_id');
    expect(body).toHaveProperty('tenant_id');
    // FOLLOW-574: ClickHouse leg exports actual rows from every
    // DSR_CLICKHOUSE_TABLES entry (derived set). No CLICKHOUSE_URL in the test
    // env → available:false with a note (Rule K.2: never fabricate or silently
    // omit), NOT the old aggregate count.
    expect(body).toHaveProperty('clickhouse');
    expect(body.clickhouse.available).toBe(false);
    expect(body.clickhouse.note).toBe('clickhouse_not_configured');
    expect(Array.isArray(body.clickhouse.tables)).toBe(true);
    expect(body).toHaveProperty('matched_archetype');
    expect(body).toHaveProperty('consent_records');
    expect(Array.isArray(body.consent_records)).toBe(true);
    // FOLLOW-246: conversion_labels must be present in response.
    expect(body).toHaveProperty('conversion_labels');
    expect(Array.isArray(body.conversion_labels)).toBe(true);
  });
});

// ─── POST /api/dsr/erase ──────────────────────────────────────────────────────

describe('POST /api/dsr/erase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHashOtp.mockImplementation((otp: string) => `hash_of_${otp}`);
    mockWriteDsrAuditLog.mockResolvedValue(undefined);
  });

  it('returns 400 when body is missing request_id or token', async () => {
    const { POST } = await import('./erase/route.js');
    const req = makeRequest('POST', '/api/dsr/erase', { body: {} });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 401 with token_expired when the request has expired', async () => {
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: false, reason: 'expired' });

    const { POST } = await import('./erase/route.js');
    const req = makeRequest('POST', '/api/dsr/erase', {
      body: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('token_expired');
  });

  it('returns 429 with too_many_attempts when locked out (FOLLOW-455)', async () => {
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: false, reason: 'locked' });

    const { POST } = await import('./erase/route.js');
    const req = makeRequest('POST', '/api/dsr/erase', {
      body: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await POST(req);

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('too_many_attempts');
  });

  it('returns 200 and deletes session data for a valid (request_id, token)', async () => {
    const validRecord = makeValidRecord('erase');
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: true, record: validRecord });
    // FOLLOW-039: select is the idempotency check against
    // dsr_clickhouse_mutations — return empty so the route issues fresh
    // (no-op when CLICKHOUSE_URL is unset) mutation rows.
    mockSelect.mockReturnValueOnce(buildChain([]));
    mockUpdate.mockReturnValue(buildChain([]));
    mockInsert.mockReturnValue(buildChain([]));
    mockTransaction.mockImplementation((fn: (tx: unknown) => Promise<void>) => {
      const txMock = { delete: vi.fn().mockReturnValue(buildChain([])) };
      return fn(txMock);
    });

    const { POST } = await import('./erase/route.js');
    const req = makeRequest('POST', '/api/dsr/erase', {
      body: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    // FOLLOW-039: clickhouse_deletion is now an object { status, mutations[] }
    // not the legacy 'scheduled_in_24h' literal.
    const body = (await res.json()) as {
      deleted_at: string;
      clickhouse_deletion: { status: string; mutations: unknown[] };
    };
    expect(body).toHaveProperty('deleted_at');
    expect(body.clickhouse_deletion).toHaveProperty('status');
    expect(body.clickhouse_deletion).toHaveProperty('mutations');
    expect(mockTransaction).toHaveBeenCalledOnce();
  });
});

// ─── GET /api/dsr/portability ─────────────────────────────────────────────────

describe('GET /api/dsr/portability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHashOtp.mockImplementation((otp: string) => `hash_of_${otp}`);
    mockWriteDsrAuditLog.mockResolvedValue(undefined);
  });

  it('returns 200 with Content-Disposition attachment header for a valid (request_id, token)', async () => {
    const validRecord = makeValidRecord('portability');
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: true, record: validRecord });

    const sessionRow = {
      sessionId: 'sess-abc123',
      tenantId: 'tenant-uuid-001',
      matchedArchetype: 'yield_hunter',
      finalArchetype: null,
      createdAt: new Date('2026-04-01T10:00:00Z'),
      updatedAt: new Date('2026-04-02T10:00:00Z'),
    };

    mockSelect
      .mockReturnValueOnce(buildChain([sessionRow])) // session
      .mockReturnValueOnce(buildChain([])) // consents (empty)
      .mockReturnValueOnce(buildChain([])); // conversion_labels Pass A (empty; no Pass B: durableLeadId null)

    const { GET } = await import('./portability/route.js');
    const req = makeRequest('GET', '/api/dsr/portability', {
      searchParams: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const contentDisposition = res.headers.get('Content-Disposition');
    expect(contentDisposition).toContain('attachment');
    expect(contentDisposition).toContain('estalara-data-export-');
    expect(contentDisposition).toContain('.json');

    const contentType = res.headers.get('Content-Type');
    expect(contentType).toContain('application/json');
  });
});

// ─── FOLLOW-246: conversion_labels on both namespaces (access + portability) ──
//
// These tests assert the four scenarios from FOLLOW-246 AC5:
//   (a) session-only subject → SDK rows returned
//   (b) CRM subject (durable_lead_id set) → CRM rows returned
//   (c) both namespaces → union without duplicates
//   (d) null durable_lead_id → SDK rows only, no error

describe('FOLLOW-246: GET /api/dsr/access — conversion_labels on both namespaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHashOtp.mockImplementation((otp: string) => `hash_of_${otp}`);
    mockWriteDsrAuditLog.mockResolvedValue(undefined);
  });

  it('(a) returns SDK-ping labels when durable_lead_id is null', async () => {
    const validRecord = makeValidRecord('access', { durableLeadId: null });
    const sdkLabel = makeLabelRow(validRecord.sessionId, 'pred-sdk-001');
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: true, record: validRecord });

    // Call order (OTP verification handled by mocked verifyAndConsumeOtp):
    // session → consents → engagement_score → quiz_completions → intent_session
    // (FOLLOW-558) → labels Pass A (SDK rows) → (no Pass B)
    mockSelect
      .mockReturnValueOnce(buildChain([])) // session (absent — that's fine)
      .mockReturnValueOnce(buildChain([])) // consents (empty)
      .mockReturnValueOnce(buildChain([])) // engagement_score (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])) // quiz_completions (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])) // intent_session (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([sdkLabel])); // Pass A: SDK labels

    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access', {
      searchParams: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversion_labels: { lead_id: string }[] };
    expect(body.conversion_labels).toHaveLength(1);
    expect(body.conversion_labels[0]?.lead_id).toBe(validRecord.sessionId);
  });

  it('(b) returns CRM labels when durable_lead_id is set and different from session_id', async () => {
    const CRM_LEAD_ID = 'crm-opaque-token-xyz';
    const validRecord = makeValidRecord('access', { durableLeadId: CRM_LEAD_ID });
    const crmLabel = makeLabelRow(CRM_LEAD_ID, 'pred-crm-001');
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: true, record: validRecord });

    // Call order: session → consents → engagement_score → quiz_completions →
    // intent_session (FOLLOW-558) → Pass A (empty, no sdk labels) → Pass B (CRM labels)
    mockSelect
      .mockReturnValueOnce(buildChain([])) // session (absent)
      .mockReturnValueOnce(buildChain([])) // consents (empty)
      .mockReturnValueOnce(buildChain([])) // engagement_score (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])) // quiz_completions (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])) // intent_session (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])) // Pass A: no SDK labels for this session
      .mockReturnValueOnce(buildChain([crmLabel])); // Pass B: CRM labels

    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access', {
      searchParams: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversion_labels: { lead_id: string }[] };
    expect(body.conversion_labels).toHaveLength(1);
    expect(body.conversion_labels[0]?.lead_id).toBe(CRM_LEAD_ID);
  });

  it('(c) returns union of SDK + CRM labels without duplicates when both namespaces have rows', async () => {
    const CRM_LEAD_ID = 'crm-opaque-token-abc';
    const validRecord = makeValidRecord('access', { durableLeadId: CRM_LEAD_ID });
    const sdkLabel = makeLabelRow(validRecord.sessionId, 'pred-sdk-002');
    const crmLabel = makeLabelRow(CRM_LEAD_ID, 'pred-crm-002');
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: true, record: validRecord });

    mockSelect
      .mockReturnValueOnce(buildChain([])) // session
      .mockReturnValueOnce(buildChain([])) // consents
      .mockReturnValueOnce(buildChain([])) // engagement_score (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])) // quiz_completions (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])) // intent_session (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([sdkLabel])) // Pass A: SDK label
      .mockReturnValueOnce(buildChain([crmLabel])); // Pass B: CRM label

    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access', {
      searchParams: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      conversion_labels: { id: string; lead_id: string }[];
    };
    // Two distinct rows — no duplicates.
    expect(body.conversion_labels).toHaveLength(2);
    const ids = body.conversion_labels.map((l) => l.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('(d) null durable_lead_id → only Pass A runs, no error, empty labels when no SDK rows', async () => {
    const validRecord = makeValidRecord('access', { durableLeadId: null });
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: true, record: validRecord });

    mockSelect
      .mockReturnValueOnce(buildChain([])) // session
      .mockReturnValueOnce(buildChain([])) // consents
      .mockReturnValueOnce(buildChain([])) // engagement_score (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])) // quiz_completions (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])) // intent_session (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])); // Pass A: no SDK labels
    // Pass B must NOT be called when durableLeadId is null.

    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access', {
      searchParams: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversion_labels: unknown[] };
    // No labels but no error — graceful skip.
    expect(body.conversion_labels).toHaveLength(0);
    // Pass B (7th select call) must NOT have been made. OTP verification is
    // now handled by the mocked verifyAndConsumeOtp, not mockSelect.
    expect(mockSelect).toHaveBeenCalledTimes(6);
  });
});

describe('FOLLOW-246: GET /api/dsr/portability — conversion_labels on both namespaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHashOtp.mockImplementation((otp: string) => `hash_of_${otp}`);
    mockWriteDsrAuditLog.mockResolvedValue(undefined);
  });

  it('exports SDK-ping labels when durable_lead_id is null', async () => {
    const validRecord = makeValidRecord('portability', { durableLeadId: null });
    const sdkLabel = makeLabelRow(validRecord.sessionId, 'pred-sdk-port-001');
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: true, record: validRecord });

    mockSelect
      .mockReturnValueOnce(buildChain([])) // session
      .mockReturnValueOnce(buildChain([])) // consents
      .mockReturnValueOnce(buildChain([])) // engagement_score (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])) // quiz_completions (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])) // intent_session (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([sdkLabel])); // Pass A

    const { GET } = await import('./portability/route.js');
    const req = makeRequest('GET', '/api/dsr/portability', {
      searchParams: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as { conversion_labels: { lead_id: string }[] };
    expect(body.conversion_labels).toHaveLength(1);
    expect(body.conversion_labels[0]?.lead_id).toBe(validRecord.sessionId);
    // Verify Art. 20 machine-readable format: Content-Type must be application/json.
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('exports CRM labels when durable_lead_id is set', async () => {
    const CRM_LEAD_ID = 'crm-opaque-port-token';
    const validRecord = makeValidRecord('portability', { durableLeadId: CRM_LEAD_ID });
    const crmLabel = makeLabelRow(CRM_LEAD_ID, 'pred-crm-port-001');
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: true, record: validRecord });

    mockSelect
      .mockReturnValueOnce(buildChain([])) // session
      .mockReturnValueOnce(buildChain([])) // consents
      .mockReturnValueOnce(buildChain([])) // engagement_score (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])) // quiz_completions (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])) // intent_session (FOLLOW-558, empty)
      .mockReturnValueOnce(buildChain([])) // Pass A: no SDK labels
      .mockReturnValueOnce(buildChain([crmLabel])); // Pass B: CRM labels

    const { GET } = await import('./portability/route.js');
    const req = makeRequest('GET', '/api/dsr/portability', {
      searchParams: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as { conversion_labels: { lead_id: string }[] };
    expect(body.conversion_labels).toHaveLength(1);
    expect(body.conversion_labels[0]?.lead_id).toBe(CRM_LEAD_ID);
  });
});

// ─── FOLLOW-431: after() registration for writeDsrAuditLog ───────────────────
//
// AC-1: each DSR route must register writeDsrAuditLog via after() so the async
// ClickHouse write completes after the response is sent on Vercel.
// The after() mock is a synchronous pass-through (see top of file) so the
// existing writeDsrAuditLog call assertions above remain valid.

describe('FOLLOW-431: writeDsrAuditLog registered via after() in DSR initiate route', () => {
  let mockAfter: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAfter = vi.mocked(after);
    mockAfter.mockReset();
    mockAfter.mockImplementation((fn: () => unknown) => {
      void fn();
    });
    mockWriteDsrAuditLog.mockResolvedValue(undefined);
    mockSendEmail.mockResolvedValue(undefined);
    mockGetAuthClaims.mockResolvedValue(TENANT_CLAIMS);
    mockIsTenantClaims.mockReturnValue(true);
  });

  it('FOLLOW-431: POST /api/dsr/initiate registers writeDsrAuditLog via after()', async () => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    mockSelect
      .mockReturnValueOnce(buildChain([{ sessionId: 'sess-431-test' }])) // session lookup
      .mockReturnValueOnce(buildChain([])); // FOLLOW-654 brand identity lookup
    mockInsert.mockReturnValue(buildChain([{ id: 'dsr-uuid-431', expiresAt }]));

    const { POST } = await import('./initiate/route.js');
    const req = makeRequest('POST', '/api/dsr/initiate', {
      body: { session_id: 'sess-431-test', dsr_type: 'access', email: 'buyer431@example.com' },
      headers: { Authorization: 'Bearer jwt_token' },
    });
    const res = await POST(req);

    expect(res.status).toBe(202);

    // after() must have been called (not void writeDsrAuditLog directly)
    expect(mockAfter).toHaveBeenCalled();
    // The callback inside after() must have invoked writeDsrAuditLog
    expect(mockWriteDsrAuditLog).toHaveBeenCalledOnce();
  });
});

// ─── FOLLOW-433: after() registration for deleteSessionFromRedis in DSR erase ─
//
// AC: POST /api/dsr/erase must register deleteSessionFromRedis via after()
// so the Redis session DEL (RODO Art. 17 active erasure) completes after the
// response is sent on Vercel — not silently dropped on instance suspension
// (ESC-033 / FOLLOW-433).

describe('FOLLOW-433: deleteSessionFromRedis registered via after() in DSR erase route', () => {
  let mockAfter: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHashOtp.mockImplementation((otp: string) => `hash_of_${otp}`);
    mockWriteDsrAuditLog.mockResolvedValue(undefined);
    mockAfter = vi.mocked(after);
    mockAfter.mockReset();
    mockAfter.mockImplementation((fn: () => unknown) => {
      void fn();
    });
  });

  it('FOLLOW-433: POST /api/dsr/erase registers deleteSessionFromRedis via after()', async () => {
    const validRecord = makeValidRecord('erase');
    mockVerifyAndConsumeOtp.mockResolvedValueOnce({ ok: true, record: validRecord });
    mockSelect.mockReturnValueOnce(buildChain([])); // idempotency check (no prior CH mutations)
    mockUpdate.mockReturnValue(buildChain([]));
    mockInsert.mockReturnValue(buildChain([]));
    mockTransaction.mockImplementation((fn: (tx: unknown) => Promise<void>) => {
      const txMock = { delete: vi.fn().mockReturnValue(buildChain([])) };
      return fn(txMock);
    });

    const { POST } = await import('./erase/route.js');
    const req = makeRequest('POST', '/api/dsr/erase', {
      body: { request_id: 'dsr-uuid-001', token: '123456' },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    // after() must have been called at least once — both the Redis DEL and the
    // audit log are registered via afterResponse().
    expect(mockAfter).toHaveBeenCalled();
  });
});
