/**
 * Integration tests for DSR endpoints.
 *
 * All external dependencies are mocked:
 *   - @estalara/db  — createAdminClient, table symbols
 *   - @/lib/session-auth — resolveTenantAccess (FOLLOW-1308: the staff initiator)
 *   - @/lib/dsr-otp — generateOtp, hashOtp
 *   - @/lib/email/resend — sendEmail
 *   - ./_clickhouse — writeDsrAuditLog
 *
 * Coverage:
 *   - POST /api/dsr/initiate as ops staff + a known session → 202, email sent, staff audit row
 *   - POST /api/dsr/initiate with an unknown session_id → 404; ClickHouse down → 503
 *   - POST /api/dsr/initiate with no staff caller → 401; readonly / ADMIN_API_SECRET → 403
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
import { describe, expect, it, vi, beforeEach } from 'vitest';
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
  mockResolveTenantAccess,
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
  mockResolveTenantAccess: vi.fn(),
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
  // FOLLOW-1308: /api/dsr/initiate writes its staff audit row in the verification transaction.
  staffAuditLog: { id: 'id' },
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

// FOLLOW-1308: /api/dsr/initiate resolves its staff caller through `resolveTenantAccess`; the real
// `AccessError` is kept so the route's status mapping is exercised.
vi.mock('@/lib/session-auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveTenantAccess: mockResolveTenantAccess,
}));

// FOLLOW-1332: /api/dsr/initiate no longer captures to Sentry (the FOLLOW-659 external-brand
// alarm went with `lib/brand-identity.ts`); asserted silent on the first-party path.
const { mockCaptureMessage } = vi.hoisted(() => ({ mockCaptureMessage: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({
  captureMessage: mockCaptureMessage,
  captureException: vi.fn(),
}));

// FOLLOW-1358: quiz_runs is a handover table read/erased through raw SQL in `@/lib/quiz-runs`
// (covered route-driven against PGlite in dsr/quiz-runs-route-driven-pglite.test.ts). This file's
// hand-built db mock has no `execute` / nested `transaction`, so the helpers are stubbed here.
vi.mock('@/lib/quiz-runs', () => ({
  eraseQuizRunsForSession: vi.fn().mockResolvedValue(0),
  readQuizRunsForSession: vi.fn().mockResolvedValue([]),
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
    // FOLLOW-1316: erase verifies first and spends inside its transaction.
    verifyOtpWithoutConsuming: mockVerifyAndConsumeOtp,
    consumeVerifiedOtp: () => Promise.resolve(true),
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

/** A verified ops staff caller (the only claim shape @estalara/auth verifies since FOLLOW-1335). */
const STAFF_CLAIMS = {
  sub: 'staff-001',
  email: 'ops@estalara.com',
  tenant_id: null,
  estalara_staff: true,
  estalara_role: 'estalara:ops',
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
//
// FOLLOW-1308 (absorbs FOLLOW-1279): the initiator is identified ops+ staff on the Estalara tenant
// (`resolveTenantAccess`, mocked here; its own rules are pinned in session-auth tests and the
// mutation-permission matrix), and the ownership proof is "some store holds this session".

describe('POST /api/dsr/initiate', () => {
  const STAFF_ACCESS = {
    via: 'staff',
    tenantId: 'tenant-uuid-001',
    staff: STAFF_CLAIMS,
    role: 'estalara:ops',
    canWrite: true,
    isSuperadmin: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mockSendEmail.mockResolvedValue(undefined);
    mockWriteDsrAuditLog.mockResolvedValue(undefined);
    mockResolveTenantAccess.mockResolvedValue(STAFF_ACCESS);
    mockCheckInitiateRateLimit.mockResolvedValue({ allowed: true, count: 0 });
    mockTransaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert: mockInsert }),
    );
  });

  const initiate = async (body: unknown): Promise<Response> => {
    const { POST } = await import('./initiate/route.js');
    return POST(makeRequest('POST', '/api/dsr/initiate', { body }));
  };
  const validBody = {
    session_id: 'sess-valid-001',
    email: 'buyer@example.com',
    dsr_type: 'access',
  };

  it('returns 401 when there is no staff caller', async () => {
    const { AccessError } = await import('@/lib/session-auth');
    mockResolveTenantAccess.mockRejectedValueOnce(new AccessError(401, 'Unauthorized'));

    const res = await initiate(validBody);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('returns 403 for the unattributable ADMIN_API_SECRET (resolveTenantAccess refuses it)', async () => {
    const { AccessError } = await import('@/lib/session-auth');
    mockResolveTenantAccess.mockRejectedValueOnce(new AccessError(403, 'not attributable'));

    const res = await initiate(validBody);

    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns 403 for readonly staff, before any read or write', async () => {
    mockResolveTenantAccess.mockResolvedValueOnce({
      ...STAFF_ACCESS,
      role: 'estalara:readonly',
      canWrite: false,
    });

    const res = await initiate(validBody);

    expect(res.status).toBe(403);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('resolves the caller against the Estalara tenant, explicitly', async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ sessionId: 'sess-valid-001' }]));
    mockInsert.mockReturnValue(buildChain([{ id: 'dsr-uuid-001', expiresAt: new Date() }]));
    const { ESTALARA_TENANT_ID } = await import('@/lib/estalara-tenant');

    await initiate(validBody);

    expect(mockResolveTenantAccess).toHaveBeenCalledWith(expect.anything(), {
      allowStaffOverride: true,
      tenantId: ESTALARA_TENANT_ID,
    });
  });

  it('returns 400 when body is invalid', async () => {
    const res = await initiate({ session_id: '', email: 'not-an-email', dsr_type: 'invalid' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when no store holds the session (no ClickHouse, no Postgres row)', async () => {
    mockSelect.mockReturnValue(buildChain([]));

    const res = await initiate({ ...validBody, session_id: 'nonexistent-sess' });

    expect(res.status).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns 202 with request_id and expires_at, and writes the staff audit row in the same transaction', async () => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    mockSelect.mockReturnValueOnce(buildChain([{ sessionId: 'sess-valid-001' }])); // consent_records
    const inserted: unknown[] = [];
    mockInsert.mockImplementation(() => {
      const chain = buildChain([{ id: 'dsr-uuid-001', expiresAt }]);
      chain.values = (...args: unknown[]) => {
        inserted.push(args[0]);
        return chain;
      };
      return chain;
    });

    const res = await initiate(validBody);

    expect(res.status).toBe(202);
    const body = (await res.json()) as { request_id: string; expires_at: string };
    expect(body.request_id).toBe('dsr-uuid-001');
    expect(body).toHaveProperty('expires_at');
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(inserted).toHaveLength(2);
    expect(inserted[1]).toMatchObject({
      adminUserId: 'staff-001',
      action: 'dsr.initiate',
      targetTenantId: 'tenant-uuid-001',
      payload: { request_id: 'dsr-uuid-001', dsr_type: 'access', lead_id_supplied: false },
    });
    // The audit payload names the request, never the subject.
    expect(JSON.stringify(inserted[1])).not.toContain('buyer@example.com');
    expect(JSON.stringify(inserted[1])).not.toContain('sess-valid-001');
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@example.com',
        subject: 'Your Estalara data request',
      }),
    );
  });

  // ─── FOLLOW-1308: the ownership proof reads ClickHouse by session_id only ──────

  it('accepts a session ClickHouse holds, keyed on session_id with no tenant predicate', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'https://ch.example.test:8443');
    const chSql: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init?: RequestInit) => {
        chSql.push(typeof init?.body === 'string' ? init.body : '');
        return Promise.resolve(new Response(JSON.stringify({ data: [{ one: 1 }] })));
      }),
    );
    mockInsert.mockReturnValue(buildChain([{ id: 'dsr-uuid-ch', expiresAt: new Date() }]));

    const res = await initiate(validBody);

    expect(res.status).toBe(202);
    expect(chSql).toHaveLength(1);
    expect(chSql[0]).toContain('FROM events WHERE session_id = {session_id:String}');
    expect(chSql[0]).not.toContain('tenant_id');
    expect(mockSelect).not.toHaveBeenCalled(); // no Postgres fallback needed
  });

  it('a ClickHouse failure is 503, never a 404, and nothing is written', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'https://ch.example.test:8443');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 500 })));

    const res = await initiate(validBody);

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('OWNERSHIP_CHECK_UNAVAILABLE');
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  // ─── FOLLOW-1332: the OTP e-mail names Estalara, the only tenant ─────────────
  // Pins the first-party e-mail byte-identical to what the per-brand resolver (FOLLOW-654 leg 3)
  // produced for the Estalara tenant, and that the ownership check runs before it.

  it('sends the OTP e-mail as Estalara, after the session-ownership check, with no brand lookup', async () => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    mockSelect.mockReturnValueOnce(buildChain([{ sessionId: 'sess-valid-001' }])); // consent_records
    mockInsert.mockReturnValue(buildChain([{ id: 'dsr-uuid-003', expiresAt }]));

    const res = await initiate(validBody);

    expect(res.status).toBe(202);
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledOnce();
    const call = mockSendEmail.mock.calls[0]?.[0] as {
      from: string;
      to: string;
      subject: string;
      html: string;
    };
    expect(call.from).toBe('Estalara <noreply@contact.estalara.com>');
    expect(call.to).toBe('buyer@example.com');
    expect(call.subject).toBe('Your Estalara data request');
    expect(call.html).toBe(
      [
        '<p>You requested access to your personal data processed by Estalara.</p>',
        '        <p>Your one-time verification code is:</p>',
        '        <p style="font-size: 2em; letter-spacing: 0.2em; font-weight: bold;">123456</p>',
        '        <p>This code is valid for <strong>15 minutes</strong>.</p>',
        '        <p>If you did not request this, you can safely ignore this email.</p>',
      ].join('\n'),
    );
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  // FOLLOW-1308 (Codex F-19): an e-mail Resend did not accept is not reported as sent.
  it('returns 500 EMAIL_SEND_FAILED when the send fails, and audits no initiation', async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ sessionId: 'sess-valid-001' }]));
    mockInsert.mockReturnValue(buildChain([{ id: 'dsr-uuid-004', expiresAt: new Date() }]));
    mockSendEmail.mockRejectedValueOnce(new Error('Resend rejected the send: invalid_api_key'));

    const res = await initiate(validBody);

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('EMAIL_SEND_FAILED');
    expect(mockWriteDsrAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'initiated' }),
    );
  });

  // ─── FOLLOW-455 / audit F-20: anti email-bomb rate limiting ────────────────

  it('returns 429 and does NOT send an email when the rate limit is exceeded', async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ sessionId: 'sess-valid-001' }]));
    mockCheckInitiateRateLimit.mockResolvedValueOnce({ allowed: false, count: 5 });

    const res = await initiate({ ...validBody, email: 'bombed@example.com' });

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

    const consentRow = {
      consentType: 'behavioral_tracking',
      granted: true,
      grantedAt: new Date('2026-04-01T10:00:00Z'),
      revokedAt: null,
    };

    // Call order (OTP verification handled by mocked verifyAndConsumeOtp,
    // NOT via mockSelect): consentRecords →
    // conversion_labels Pass A → (no Pass B: durableLeadId null)
    mockSelect
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
      export_complete: boolean;
      resume_cursor: string | null;
      buyer_profile: { result: string };
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
    // FOLLOW-1308: `session_embeddings` (the old matched_archetype source) is no longer read, and
    // a complete disclosure spends the OTP and says so.
    expect(body).not.toHaveProperty('matched_archetype');
    expect(body.export_complete).toBe(true);
    expect(body.resume_cursor).toBeNull();
    expect(body.buyer_profile).toEqual({ result: 'not_requested' });
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

    mockSelect
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
    // consents → quiz_completions → intent_session
    // (FOLLOW-558) → labels Pass A (SDK rows) → (no Pass B)
    mockSelect
      .mockReturnValueOnce(buildChain([])) // consents (empty)
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

    // Call order: consents → quiz_completions →
    // intent_session (FOLLOW-558) → Pass A (empty, no sdk labels) → Pass B (CRM labels)
    mockSelect
      .mockReturnValueOnce(buildChain([])) // consents (empty)
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
      .mockReturnValueOnce(buildChain([])) // consents
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
      .mockReturnValueOnce(buildChain([])) // consents
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
    // Pass B (5th select call) must NOT have been made. OTP verification is
    // now handled by the mocked verifyAndConsumeOtp, not mockSelect (and since FOLLOW-1308 there
    // is no session_embeddings select).
    expect(mockSelect).toHaveBeenCalledTimes(4);
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
      .mockReturnValueOnce(buildChain([])) // consents
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
      .mockReturnValueOnce(buildChain([])) // consents
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
    mockResolveTenantAccess.mockResolvedValue({
      via: 'staff',
      tenantId: 'tenant-uuid-001',
      staff: STAFF_CLAIMS,
      role: 'estalara:ops',
      canWrite: true,
      isSuperadmin: false,
    });
    mockTransaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert: mockInsert }),
    );
  });

  it('FOLLOW-431: POST /api/dsr/initiate registers writeDsrAuditLog via after()', async () => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    mockSelect.mockReturnValueOnce(buildChain([{ sessionId: 'sess-431-test' }])); // session lookup
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

// ─── FOLLOW-433 → FOLLOW-1308: the Redis session erase is awaited, not after() ─
//
// FOLLOW-433 moved the Redis DEL into after() so it was not dropped on instance suspension.
// FOLLOW-1308 (Codex R-01) goes further: the erase is awaited and checked BEFORE the OTP is spent,
// so its outcome is in the response (`redis_erasure`). after() still carries the audit write.

describe('FOLLOW-1308 (was FOLLOW-433): the Redis erase is awaited; after() carries the audit', () => {
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

  it('POST /api/dsr/erase reports redis_erasure in the response and registers the audit via after()', async () => {
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
    // No UPSTASH_REDIS_URL in this file: nothing is held, and the response says so.
    expect(((await res.json()) as { redis_erasure: string }).redis_erasure).toBe('not_configured');
    expect(mockAfter).toHaveBeenCalled();
  });
});
