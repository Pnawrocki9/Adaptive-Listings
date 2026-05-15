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
 * @module apps/control-plane/src/app/api/dsr/dsr-routes.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

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
  consentRecords: {
    sessionId: 'session_id',
    consentType: 'consent_type',
    granted: 'granted',
    grantedAt: 'granted_at',
    revokedAt: 'revoked_at',
  },
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, _op: 'eq' })),
  and: vi.fn((...args: unknown[]) => ({ args, _op: 'and' })),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: mockGetAuthClaims,
  isTenantClaims: mockIsTenantClaims,
}));

vi.mock('@/lib/dsr-otp', () => ({
  generateOtp: vi.fn().mockReturnValue('123456'),
  hashOtp: mockHashOtp,
  verifyOtp: vi.fn(),
}));

vi.mock('@/lib/email/resend', () => ({
  sendEmail: mockSendEmail,
}));

vi.mock('./_clickhouse', () => ({
  writeDsrAuditLog: mockWriteDsrAuditLog,
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
    ...overrides,
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
    mockSelect.mockReturnValueOnce(buildChain([{ sessionId: 'sess-valid-001' }]));
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
});

// ─── GET /api/dsr/access ──────────────────────────────────────────────────────

describe('GET /api/dsr/access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHashOtp.mockImplementation((otp: string) => `hash_of_${otp}`);
    mockWriteDsrAuditLog.mockResolvedValue(undefined);
  });

  it('returns 400 when token param is missing', async () => {
    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access');
    const res = await GET(req);

    expect(res.status).toBe(400);
  });

  it('returns 404 when OTP is not found', async () => {
    mockSelect.mockReturnValue(buildChain([]));

    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access', { searchParams: { token: '000000' } });
    const res = await GET(req);

    expect(res.status).toBe(404);
  });

  it('returns 401 with token_expired when OTP is expired', async () => {
    const expiredRecord = makeValidRecord('access', {
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
    });
    mockSelect.mockReturnValueOnce(buildChain([expiredRecord]));

    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access', { searchParams: { token: '123456' } });
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('token_expired');
  });

  it('returns 401 with token_already_used when OTP has been consumed', async () => {
    const usedRecord = makeValidRecord('access', {
      usedAt: new Date(Date.now() - 60_000), // used 1 min ago
    });
    mockSelect.mockReturnValueOnce(buildChain([usedRecord]));

    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access', { searchParams: { token: '123456' } });
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('token_already_used');
  });

  it('returns 200 with correct shape for a valid OTP', async () => {
    const validRecord = makeValidRecord('access');
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

    // Call order: dsrVerifications lookup → update usedAt → sessionEmbeddings → consentRecords
    mockSelect
      .mockReturnValueOnce(buildChain([validRecord])) // 1st: dsr record
      .mockReturnValueOnce(buildChain([sessionRow])) // 2nd: session
      .mockReturnValueOnce(buildChain([consentRow])); // 3rd: consents
    mockUpdate.mockReturnValue(buildChain([]));

    const { GET } = await import('./access/route.js');
    const req = makeRequest('GET', '/api/dsr/access', { searchParams: { token: '123456' } });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session_id: string;
      tenant_id: string;
      events_summary: { count: number };
      matched_archetype: string | null;
      consent_records: unknown[];
    };
    expect(body).toHaveProperty('session_id');
    expect(body).toHaveProperty('tenant_id');
    expect(body).toHaveProperty('events_summary');
    expect(body.events_summary).toHaveProperty('count');
    expect(body).toHaveProperty('matched_archetype');
    expect(body).toHaveProperty('consent_records');
    expect(Array.isArray(body.consent_records)).toBe(true);
  });
});

// ─── POST /api/dsr/erase ──────────────────────────────────────────────────────

describe('POST /api/dsr/erase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHashOtp.mockImplementation((otp: string) => `hash_of_${otp}`);
    mockWriteDsrAuditLog.mockResolvedValue(undefined);
  });

  it('returns 400 when body is missing token', async () => {
    const { POST } = await import('./erase/route.js');
    const req = makeRequest('POST', '/api/dsr/erase', { body: {} });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 401 with token_expired when OTP is expired', async () => {
    const expiredRecord = makeValidRecord('erase', {
      expiresAt: new Date(Date.now() - 1000),
    });
    mockSelect.mockReturnValueOnce(buildChain([expiredRecord]));

    const { POST } = await import('./erase/route.js');
    const req = makeRequest('POST', '/api/dsr/erase', { body: { token: '123456' } });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('token_expired');
  });

  it('returns 200 and deletes session data for a valid OTP', async () => {
    const validRecord = makeValidRecord('erase');
    mockSelect.mockReturnValueOnce(buildChain([validRecord]));
    mockUpdate.mockReturnValue(buildChain([]));
    mockTransaction.mockImplementation((fn: (tx: unknown) => Promise<void>) => {
      const txMock = { delete: vi.fn().mockReturnValue(buildChain([])) };
      return fn(txMock);
    });

    const { POST } = await import('./erase/route.js');
    const req = makeRequest('POST', '/api/dsr/erase', { body: { token: '123456' } });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted_at: string; clickhouse_deletion: string };
    expect(body).toHaveProperty('deleted_at');
    expect(body.clickhouse_deletion).toBe('scheduled_in_24h');
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

  it('returns 200 with Content-Disposition attachment header for a valid OTP', async () => {
    const validRecord = makeValidRecord('portability');
    const sessionRow = {
      sessionId: 'sess-abc123',
      tenantId: 'tenant-uuid-001',
      matchedArchetype: 'yield_hunter',
      finalArchetype: null,
      createdAt: new Date('2026-04-01T10:00:00Z'),
      updatedAt: new Date('2026-04-02T10:00:00Z'),
    };

    mockSelect
      .mockReturnValueOnce(buildChain([validRecord])) // dsr record
      .mockReturnValueOnce(buildChain([sessionRow])) // session
      .mockReturnValueOnce(buildChain([])); // consents (empty)
    mockUpdate.mockReturnValue(buildChain([]));

    const { GET } = await import('./portability/route.js');
    const req = makeRequest('GET', '/api/dsr/portability', { searchParams: { token: '123456' } });
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
