/**
 * Tests for LIA (Legitimate Interest Assessment) API routes.
 *
 * Tests cover:
 *   - LiaRecordSchema validation (correct payload, missing field, short field)
 *   - GET /api/tenants/:id/lia — 404 when no LIA exists
 *   - GET/POST /api/tenants/:id/lia — staff only since FOLLOW-1335: a verified token that is
 *     not staff (the former tenant-user JWT) is 401, whatever tenant it names
 *   - POST /api/tenants/:id/lia — 401 when no auth header; 422 on validation failure
 *   - POST + DELETE (FOLLOW-1335 review F3, ADR-0018 #3) drive the REAL resolveTenantAccess:
 *     readonly staff 403 before any read/write; ops 201/200 with the mutation and ONE
 *     staff_audit_log row in the same transaction; audit failure → 500 audit_write_failed and
 *     nothing kept; unknown tenant 404; the ADMIN_API_SECRET Bearer 403 (not attributable)
 *
 * Database is mocked throughout — no real Postgres required.
 *
 * TICKET-GDPR-003
 *
 * @module apps/control-plane/src/lib/__tests__/lia-routes.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { LiaRecordSchema } from '@estalara/shared';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports of the route modules
// ---------------------------------------------------------------------------

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const RECORD_ID = '00000000-0000-0000-0000-000000000002';
const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000099';

// Mock DB rows returned by the select query (GET).
// Initially empty — tests can override via mockSelectRows.
let mockSelectRows: unknown[] = [];

const { mockDbClient, mockCreateAdminClient, mockCaptureException } = vi.hoisted(() => {
  const mockDbClient = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  };
  const mockCreateAdminClient = vi.fn(() => mockDbClient);
  const mockCaptureException = vi.fn();
  return { mockDbClient, mockCreateAdminClient, mockCaptureException };
});

vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  captureMessage: vi.fn(),
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: mockCreateAdminClient,
  tenants: { id: 'tenants.id', deletedAt: 'tenants.deleted_at' },
  staffAuditLog: { __table: 'staff_audit_log' },
  tenantComplianceRecords: {
    id: 'id',
    tenantId: 'tenant_id',
    recordType: 'record_type',
    version: 'version',
    purposeStatement: 'purpose_statement',
    necessityJustification: 'necessity_justification',
    balancingConclusion: 'balancing_conclusion',
    optoutMechanism: 'optout_mechanism',
    signedByName: 'signed_by_name',
    signedByEmail: 'signed_by_email',
    signedAt: 'signed_at',
    metadata: 'metadata',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
}));

// Mock drizzle-orm operators used in the routes.
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ type: 'eq' })),
  and: vi.fn((..._args: unknown[]) => ({ type: 'and' })),
  or: vi.fn((..._args: unknown[]) => ({ type: 'or' })),
  desc: vi.fn((_col: unknown) => ({ type: 'desc' })),
  isNull: vi.fn((_col: unknown) => ({ type: 'isNull' })),
  sql: Object.assign(
    vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => ({ type: 'sql' })),
    { join: vi.fn(), empty: vi.fn() },
  ),
}));

// Mock @estalara/auth — controls JWT verification results. A staff JWT by default (the
// only caller since FOLLOW-1335).
let mockAuthClaims: Record<string, unknown> | null = {
  sub: 'staff-001',
  email: 'ops@estalara.com',
  tenant_id: null,
  estalara_staff: true,
  estalara_role: 'estalara:ops',
  mfa_verified: true,
};

/** The tenant-user claim shape @estalara/auth issued before FOLLOW-1335. */
const NON_STAFF_CLAIMS = {
  sub: 'user-002',
  email: 'other@agency.com',
  tenant_id: OTHER_TENANT_ID,
  agency_role: 'agency:admin',
  estalara_staff: false,
  mfa_verified: false,
};

vi.mock('@estalara/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/require-await
  getAuthClaims: vi.fn(async () => mockAuthClaims),
  isStaffClaims: vi.fn((claims: Record<string, unknown> | null) => {
    return claims?.estalara_staff === true;
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGetRequest(url: string, bearerToken?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  return new NextRequest(url, { method: 'GET', headers });
}

function makePostRequest(url: string, body: unknown, bearerToken?: string): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Minimal valid LIA payload satisfying all constraints. */
const VALID_LIA_BODY = {
  purpose_statement:
    'We process visitor behavioral data to adapt property listings to buyer intent profiles in real time.',
  necessity_justification:
    'Behavioral signals are necessary because static listings cannot distinguish investor from family buyer intent.',
  balancing_conclusion:
    'Our interest in serving relevant listings outweighs minimal privacy impact given the opt-out.',
  optout_mechanism: 'Users may opt out via the consent banner present on every page.',
  signed_by_name: 'Piotr Nawrocki',
  signed_by_email: 'piotr@agency.com',
  signed_at: '2026-05-15T12:00:00.000Z',
};

// ---------------------------------------------------------------------------
// LiaRecordSchema unit tests
// ---------------------------------------------------------------------------

describe('LiaRecordSchema', () => {
  it('validates a correct payload successfully', () => {
    const result = LiaRecordSchema.safeParse(VALID_LIA_BODY);
    expect(result.success).toBe(true);
  });

  it('rejects payload missing purpose_statement', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { purpose_statement: _omitted, ...without } = VALID_LIA_BODY;
    const result = LiaRecordSchema.safeParse(without);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('purpose_statement');
    }
  });

  it('rejects purpose_statement shorter than 50 characters', () => {
    const result = LiaRecordSchema.safeParse({
      ...VALID_LIA_BODY,
      purpose_statement: 'Too short',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('purpose_statement');
    }
  });

  it('rejects necessity_justification shorter than 50 characters', () => {
    const result = LiaRecordSchema.safeParse({
      ...VALID_LIA_BODY,
      necessity_justification: 'Short',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('necessity_justification');
    }
  });

  it('rejects an invalid signed_by_email', () => {
    const result = LiaRecordSchema.safeParse({
      ...VALID_LIA_BODY,
      signed_by_email: 'not-an-email',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('signed_by_email');
    }
  });

  it('rejects a non-ISO-8601 signed_at', () => {
    const result = LiaRecordSchema.safeParse({
      ...VALID_LIA_BODY,
      signed_at: '15/05/2026',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('signed_at');
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/tenants/:id/lia
// ---------------------------------------------------------------------------

describe('GET /api/tenants/:id/lia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectRows = [];
    // Default: a staff JWT (FOLLOW-1335 — staff is the only caller)
    mockAuthClaims = {
      sub: 'staff-001',
      email: 'ops@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: 'estalara:ops',
      mfa_verified: true,
    };

    // Set up the fluent select chain.
    const limitFn = vi.fn().mockResolvedValue(mockSelectRows);
    const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
    const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    mockDbClient.select.mockReturnValue({ from: fromFn });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 404 with error "no_lia_on_file" when no LIA exists', async () => {
    mockSelectRows = []; // ensure empty
    // Re-wire limit to return empty array.
    const limitFn = vi.fn().mockResolvedValue([]);
    const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
    const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    mockDbClient.select.mockReturnValue({ from: fromFn });

    const { GET } = await import('../../app/api/tenants/[id]/lia/route.js');
    const req = makeGetRequest(`http://localhost/api/tenants/${TENANT_ID}/lia`, 'tok');
    const res = await GET(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(404);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toBe('no_lia_on_file');
  });

  it('returns 401 for a verified token that is not staff, even naming this tenant (FOLLOW-1335)', async () => {
    // The former tenant-user JWT shape — no longer a caller at all.
    mockAuthClaims = { ...NON_STAFF_CLAIMS, tenant_id: TENANT_ID };

    const { GET } = await import('../../app/api/tenants/[id]/lia/route.js');
    const req = makeGetRequest(`http://localhost/api/tenants/${TENANT_ID}/lia`, 'tok');
    const res = await GET(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(401);
  });

  it('returns 401 when no auth header is present', async () => {
    mockAuthClaims = null;

    const { GET } = await import('../../app/api/tenants/[id]/lia/route.js');
    const req = makeGetRequest(`http://localhost/api/tenants/${TENANT_ID}/lia`);
    const res = await GET(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(401);
  });

  it('returns 200 with lia when record exists', async () => {
    const fakeRecord = {
      id: RECORD_ID,
      tenantId: TENANT_ID,
      recordType: 'lia',
      version: 'lia-v1.0',
      purposeStatement: VALID_LIA_BODY.purpose_statement,
      necessityJustification: VALID_LIA_BODY.necessity_justification,
      balancingConclusion: VALID_LIA_BODY.balancing_conclusion,
      optoutMechanism: VALID_LIA_BODY.optout_mechanism,
      signedByName: VALID_LIA_BODY.signed_by_name,
      signedByEmail: VALID_LIA_BODY.signed_by_email,
      signedAt: new Date(VALID_LIA_BODY.signed_at),
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const limitFn = vi.fn().mockResolvedValue([fakeRecord]);
    const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
    const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    mockDbClient.select.mockReturnValue({ from: fromFn });

    const { GET } = await import('../../app/api/tenants/[id]/lia/route.js');
    const req = makeGetRequest(`http://localhost/api/tenants/${TENANT_ID}/lia`, 'tok');
    const res = await GET(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(200);
    const body = await parseBody<{ lia: Record<string, unknown> }>(res);
    expect(body.lia).toBeDefined();
    expect(body.lia.id).toBe(RECORD_ID);
  });
});

// ---------------------------------------------------------------------------
// POST /api/tenants/:id/lia
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Writes — POST + DELETE (FOLLOW-1335 review F3, ADR-0018 #3)
// ---------------------------------------------------------------------------

const STAFF = (role: 'estalara:readonly' | 'estalara:ops' | 'estalara:superadmin') => ({
  sub: `staff-${role}`,
  email: 'staff@estalara.com',
  tenant_id: null,
  estalara_staff: true,
  estalara_role: role,
  mfa_verified: true,
});

/**
 * Wire the fake admin client: `select().from().where().limit()` answers resolveTenantAccess's
 * tenantExists() lookup; `transaction(cb)` hands the route a tx whose writes are STAGED and only
 * committed when the callback resolves (a rejection discards them — the rollback).
 */
function wireWriteDb(
  opts: { tenantExists?: boolean; failAudit?: boolean; rowFound?: boolean } = {},
) {
  const committed = {
    records: [] as Record<string, unknown>[],
    audit: [] as Record<string, unknown>[],
    updates: 0,
  };
  mockDbClient.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(opts.tenantExists === false ? [] : [{ id: TENANT_ID }]),
      }),
    }),
  });
  mockDbClient.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    const staged = {
      records: [] as Record<string, unknown>[],
      audit: [] as Record<string, unknown>[],
      updates: 0,
    };
    const tx = {
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((v: Record<string, unknown>) => {
          if ((table as { __table?: string }).__table === 'staff_audit_log') {
            if (opts.failAudit) return Promise.reject(new Error('audit sink down'));
            staged.audit.push(v);
            return Promise.resolve([]);
          }
          staged.records.push(v);
          return {
            returning: vi.fn().mockResolvedValue([
              {
                ...v,
                id: RECORD_ID,
                version: 'lia-v1.0',
                signedAt: new Date(VALID_LIA_BODY.signed_at),
              },
            ]),
          };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => {
              staged.updates += 1;
              return Promise.resolve(opts.rowFound === false ? [] : [{ id: RECORD_ID }]);
            }),
          })),
        })),
      })),
    };
    const out = await cb(tx);
    committed.records.push(...staged.records);
    committed.audit.push(...staged.audit);
    committed.updates += staged.updates;
    return out;
  });
  return committed;
}

function makeDeleteRequest(bearer = 'staff-jwt'): NextRequest {
  return new NextRequest(`http://localhost/api/tenants/${TENANT_ID}/lia/${RECORD_ID}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${bearer}` },
  });
}

describe('LIA writes — staff rank, tenant existence, audited in ONE transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockAuthClaims = STAFF('estalara:ops');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const post = async () => {
    const { POST } = await import('../../app/api/tenants/[id]/lia/route.js');
    return POST(
      makePostRequest(`http://localhost/api/tenants/${TENANT_ID}/lia`, VALID_LIA_BODY, 'staff-jwt'),
      { params: Promise.resolve({ id: TENANT_ID }) },
    );
  };
  const del = async (bearer?: string) => {
    const { DELETE } = await import('../../app/api/tenants/[id]/lia/[recordId]/route.js');
    return DELETE(makeDeleteRequest(bearer), {
      params: Promise.resolve({ id: TENANT_ID, recordId: RECORD_ID }),
    });
  };

  it('readonly staff → 403 on POST and DELETE, before any read or write', async () => {
    mockAuthClaims = STAFF('estalara:readonly');
    const db = wireWriteDb();

    expect((await post()).status).toBe(403);
    expect((await del()).status).toBe(403);
    expect(mockDbClient.transaction).not.toHaveBeenCalled();
    expect(db.records).toHaveLength(0);
    expect(db.updates).toBe(0);
  });

  it('ops POST → 201; the record and ONE lia.create audit row commit together (no personal data in the payload)', async () => {
    const db = wireWriteDb();

    const res = await post();

    expect(res.status).toBe(201);
    expect(mockDbClient.transaction).toHaveBeenCalledOnce();
    expect(db.records).toHaveLength(1);
    expect(db.records[0]?.tenantId).toBe(TENANT_ID);
    expect(db.audit).toHaveLength(1);
    expect(db.audit[0]).toMatchObject({
      adminUserId: 'staff-estalara:ops',
      action: 'lia.create',
      targetTenantId: TENANT_ID,
      payload: { record_id: RECORD_ID, record_type: 'lia', version: 'lia-v1.0' },
    });
    const payload = JSON.stringify(db.audit[0]?.payload);
    expect(payload).not.toContain(VALID_LIA_BODY.signed_by_email);
    expect(payload).not.toContain(VALID_LIA_BODY.signed_by_name);
    expect(payload).not.toContain(VALID_LIA_BODY.purpose_statement);
  });

  it('ops DELETE → 200; the soft-delete and ONE lia.delete audit row commit together', async () => {
    const db = wireWriteDb();

    const res = await del();

    expect(res.status).toBe(200);
    expect(await parseBody<{ deleted: boolean }>(res)).toEqual({ deleted: true });
    expect(db.updates).toBe(1);
    expect(db.audit).toEqual([
      expect.objectContaining({
        action: 'lia.delete',
        targetTenantId: TENANT_ID,
        payload: { record_id: RECORD_ID },
      }),
    ]);
  });

  it('DELETE of a record that is not this tenant’s → 404, no audit row', async () => {
    const db = wireWriteDb({ rowFound: false });

    expect((await del()).status).toBe(404);
    expect(db.audit).toHaveLength(0);
  });

  it('audit insert fails → 500 audit_write_failed, nothing committed, Sentry once (POST and DELETE)', async () => {
    const db = wireWriteDb({ failAudit: true });

    const p = await post();
    expect(p.status).toBe(500);
    expect((await parseBody<{ code: string }>(p)).code).toBe('audit_write_failed');
    const d = await del();
    expect(d.status).toBe(500);
    expect((await parseBody<{ code: string }>(d)).code).toBe('audit_write_failed');

    expect(db.records).toHaveLength(0);
    expect(db.updates).toBe(0);
    expect(db.audit).toHaveLength(0);
    expect(mockCaptureException).toHaveBeenCalledTimes(2);
  });

  it('unknown tenant → 404 on POST and DELETE, no transaction', async () => {
    wireWriteDb({ tenantExists: false });

    expect((await post()).status).toBe(404);
    expect((await del()).status).toBe(404);
    expect(mockDbClient.transaction).not.toHaveBeenCalled();
  });

  it('the ADMIN_API_SECRET Bearer → 403 (no identity to audit), no transaction', async () => {
    vi.stubEnv('ADMIN_API_SECRET', 'shared-admin-secret-value');
    mockAuthClaims = null;
    wireWriteDb();

    expect((await del('shared-admin-secret-value')).status).toBe(403);
    const { POST } = await import('../../app/api/tenants/[id]/lia/route.js');
    const res = await POST(
      makePostRequest(
        `http://localhost/api/tenants/${TENANT_ID}/lia`,
        VALID_LIA_BODY,
        'shared-admin-secret-value',
      ),
      { params: Promise.resolve({ id: TENANT_ID }) },
    );
    expect(res.status).toBe(403);
    expect(mockDbClient.transaction).not.toHaveBeenCalled();
  });

  it('DELETE with a malformed record id → 404 before any transaction', async () => {
    wireWriteDb();
    const { DELETE } = await import('../../app/api/tenants/[id]/lia/[recordId]/route.js');
    const res = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: TENANT_ID, recordId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(404);
    expect(mockDbClient.transaction).not.toHaveBeenCalled();
  });
});

describe('POST /api/tenants/:id/lia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: a staff JWT (FOLLOW-1335 — staff is the only caller)
    mockAuthClaims = {
      sub: 'staff-001',
      email: 'ops@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: 'estalara:ops',
      mfa_verified: true,
    };

    // resolveTenantAccess's tenantExists() lookup + the audited transaction.
    wireWriteDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when no Authorization header is present', async () => {
    mockAuthClaims = null;

    const { POST } = await import('../../app/api/tenants/[id]/lia/route.js');
    const req = makePostRequest(`http://localhost/api/tenants/${TENANT_ID}/lia`, VALID_LIA_BODY);
    const res = await POST(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(401);
  });

  it('returns 422 on Zod validation failure (short purpose_statement)', async () => {
    const { POST } = await import('../../app/api/tenants/[id]/lia/route.js');
    const req = makePostRequest(
      `http://localhost/api/tenants/${TENANT_ID}/lia`,
      { ...VALID_LIA_BODY, purpose_statement: 'Too short' },
      'valid-token',
    );
    const res = await POST(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(422);
    const body = await parseBody<{ error: string; details: unknown }>(res);
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeDefined();
  });

  it('returns 401 for a verified token that is not staff (FOLLOW-1335)', async () => {
    mockAuthClaims = { ...NON_STAFF_CLAIMS };

    const { POST } = await import('../../app/api/tenants/[id]/lia/route.js');
    const req = makePostRequest(
      `http://localhost/api/tenants/${TENANT_ID}/lia`,
      VALID_LIA_BODY,
      'valid-token',
    );
    const res = await POST(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(401);
    expect(mockDbClient.transaction).not.toHaveBeenCalled();
  });
});
