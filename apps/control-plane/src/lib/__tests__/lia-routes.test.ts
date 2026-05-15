/**
 * Tests for LIA (Legitimate Interest Assessment) API routes.
 *
 * Tests cover:
 *   - LiaRecordSchema validation (correct payload, missing field, short field)
 *   - GET /api/tenants/:id/lia — 404 when no LIA exists
 *   - GET /api/tenants/:id/lia — 403 when JWT tenant mismatch
 *   - POST /api/tenants/:id/lia — 401 when no auth header
 *   - POST /api/tenants/:id/lia — 201 on valid payload (mock DB)
 *   - POST /api/tenants/:id/lia — 422 on validation failure
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
// Mock insert return value.
let mockInsertRow: unknown = null;

const { mockDbClient, mockCreateAdminClient } = vi.hoisted(() => {
  const mockDbClient = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  const mockCreateAdminClient = vi.fn(() => mockDbClient);
  return { mockDbClient, mockCreateAdminClient };
});

vi.mock('@estalara/db', () => ({
  createAdminClient: mockCreateAdminClient,
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

// Mock @estalara/auth — controls JWT verification results.
// Tenant JWT for TENANT_ID by default; staff JWT for staff tests.
let mockAuthClaims: Record<string, unknown> | null = {
  sub: 'user-001',
  email: 'admin@agency.com',
  tenant_id: TENANT_ID,
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
    // Default: tenant JWT matching TENANT_ID
    mockAuthClaims = {
      sub: 'user-001',
      email: 'admin@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:admin',
      estalara_staff: false,
      mfa_verified: false,
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

  it('returns 403 when JWT tenant does not match the URL param', async () => {
    // Override auth to return claims for a different tenant
    mockAuthClaims = {
      sub: 'user-002',
      email: 'other@agency.com',
      tenant_id: OTHER_TENANT_ID,
      agency_role: 'agency:admin',
      estalara_staff: false,
      mfa_verified: false,
    };

    const { GET } = await import('../../app/api/tenants/[id]/lia/route.js');
    const req = makeGetRequest(`http://localhost/api/tenants/${TENANT_ID}/lia`, 'tok');
    const res = await GET(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(403);
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

describe('POST /api/tenants/:id/lia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertRow = {
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

    // Default: matching tenant JWT
    mockAuthClaims = {
      sub: 'user-001',
      email: 'admin@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:admin',
      estalara_staff: false,
      mfa_verified: false,
    };

    // Set up the fluent insert chain.
    const returningFn = vi.fn().mockResolvedValue([mockInsertRow]);
    const valuesFn = vi.fn().mockReturnValue({ returning: returningFn });
    mockDbClient.insert.mockReturnValue({ values: valuesFn });
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

  it('returns 201 with the created LIA record on valid payload', async () => {
    const { POST } = await import('../../app/api/tenants/[id]/lia/route.js');
    const req = makePostRequest(
      `http://localhost/api/tenants/${TENANT_ID}/lia`,
      VALID_LIA_BODY,
      'valid-token',
    );
    const res = await POST(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(201);
    const body = await parseBody<{ lia: Record<string, unknown> }>(res);
    expect(body.lia).toBeDefined();
    expect(body.lia.id).toBe(RECORD_ID);
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

  it('returns 403 when JWT tenant does not match URL param', async () => {
    mockAuthClaims = {
      sub: 'user-002',
      email: 'other@agency.com',
      tenant_id: OTHER_TENANT_ID,
      agency_role: 'agency:admin',
      estalara_staff: false,
      mfa_verified: false,
    };

    const { POST } = await import('../../app/api/tenants/[id]/lia/route.js');
    const req = makePostRequest(
      `http://localhost/api/tenants/${TENANT_ID}/lia`,
      VALID_LIA_BODY,
      'valid-token',
    );
    const res = await POST(req, { params: Promise.resolve({ id: TENANT_ID }) });

    expect(res.status).toBe(403);
  });
});
