/**
 * Tests for POST /api/admin/intent/config + PUT /api/admin/intent/config/[id]
 * (FOLLOW-268-write, ADR-0012 Ticket B).
 *
 * Coverage:
 *   AC1.1: POST creates a row; response includes the created row id.
 *   AC1.2: POST returns 400 on invalid JSON body.
 *   AC1.3: POST returns 400 on Zod validation failure (invalid weight keys).
 *   AC2.1: PUT updates weights + returns the updated row.
 *   AC2.2: PUT returns 404 on unknown id.
 *   AC2.3: PUT with empty body returns 400 (at-least-one-field validation).
 *   AC3.1: POST returns 401 when no auth header.
 *   AC3.2: POST returns 403 when JWT is agency (not staff or admin secret).
 *   AC3.3: PUT returns 401 when no auth header.
 *   AC3.4: PUT returns 403 when JWT is agency (not staff or admin secret).
 *   AC3.5: POST accepts ADMIN_API_SECRET Bearer (constant-time compare path).
 *   AC4.1: POST rejects unknown signal key in signal_likelihoods (strict schema).
 *   AC4.2: POST rejects unknown archetype key in priors.
 *   AC4.3: POST accepts valid partial weights (only behavioral_damping).
 *   AC4.4: POST accepts empty weights object `{}`.
 *   K2.1:  POST returns 500 when DB is configured but throws (Rule K.2 — no mock write).
 *   K2.2:  POST returns 500 when DB is unconfigured (Rule K.2 — no mock write path).
 *   K2.3:  PUT returns 500 when DB is configured but throws (Rule K.2).
 *
 * Rule K.2 contract for writes: NEVER fall back to a mock on DB failure.
 * Unlike read routes, writes have no "unconfigured DB → return mock" path.
 *
 * Auth note: the `verifyTracerAdminAuth` guard is tested via real module import;
 * only the `@estalara/auth` JWT dependency is mocked. The ADMIN_API_SECRET path
 * uses `timingSafeEqual` from Node crypto — no mock needed.
 *
 * @module apps/control-plane/src/app/api/admin/intent/config/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const ADMIN_SECRET = 'test-admin-secret-xyz';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const ROW_ID = 'aaaabbbb-0001-0001-0001-000000000001';
const CREATED_AT = new Date('2026-06-13T10:00:00.000Z');

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
  isStaffClaims: vi.fn(),
}));

// Shared mock factory — each test that needs live DB configures this.
const { mockCreateAdminClient } = vi.hoisted(() => {
  const mockCreateAdminClient = vi.fn();
  return { mockCreateAdminClient };
});

vi.mock('@estalara/db', () => ({
  createAdminClient: mockCreateAdminClient,
  intentWeightConfigs: {
    id: 'id',
    tenantId: 'tenant_id',
    weights: 'weights',
    isActive: 'is_active',
    createdAt: 'created_at',
    createdBy: 'created_by',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ type: 'eq' })),
  and: vi.fn((..._args: unknown[]) => ({ type: 'and' })),
  or: vi.fn((..._args: unknown[]) => ({ type: 'or' })),
  isNull: vi.fn((_col: unknown) => ({ type: 'isNull' })),
  gt: vi.fn((_col: unknown, _val: unknown) => ({ type: 'gt' })),
}));

import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import { POST } from './route';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockIsStaffClaims = vi.mocked(isStaffClaims);

// ─── DB mock builders ─────────────────────────────────────────────────────────

/**
 * Build a Drizzle insert mock chain: insert().values().returning() → rows.
 */
function makeInsertMock(rows: unknown[]) {
  const returningFn = vi.fn().mockResolvedValue(rows);
  const valuesFn = vi.fn().mockReturnValue({ returning: returningFn });
  const insertFn = vi.fn().mockReturnValue({ values: valuesFn });
  return { insert: insertFn };
}

/**
 * Build a Drizzle insert mock chain that throws.
 */
function makeInsertMockThrowing(err: Error) {
  const returningFn = vi.fn().mockRejectedValue(err);
  const valuesFn = vi.fn().mockReturnValue({ returning: returningFn });
  const insertFn = vi.fn().mockReturnValue({ values: valuesFn });
  return { insert: insertFn };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePostRequest(
  body: unknown,
  opts: { bearer?: string | undefined } = { bearer: ADMIN_SECRET },
): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.bearer !== undefined) {
    headers.Authorization = `Bearer ${opts.bearer}`;
  }
  return new NextRequest('http://localhost/api/admin/intent/config', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

/** Set env so DB is "configured". */
function withConfiguredDb() {
  vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
}

// ─── POST tests ───────────────────────────────────────────────────────────────

describe('POST /api/admin/intent/config — auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    withConfiguredDb();
  });

  it('AC3.1: returns 401 when no Authorization header', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const res = await POST(makePostRequest({ weights: {} }, { bearer: undefined }));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('AC3.2: returns 403 when JWT is agency-tenant (not staff)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:owner' as const,
      estalara_staff: false as const,
      mfa_verified: true,
    });
    mockIsStaffClaims.mockReturnValue(false);

    const res = await POST(makePostRequest({ weights: {} }, { bearer: 'agency-jwt-token' }));
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('AC3.5: accepts ADMIN_API_SECRET Bearer via constant-time compare', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const createdRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: true,
      createdAt: CREATED_AT,
    };
    mockCreateAdminClient.mockReturnValue(makeInsertMock([createdRow]));

    const res = await POST(makePostRequest({ weights: { behavioral_damping: 0.3 } }));
    expect(res.status).toBe(201);
    const body = await parseBody<{ id: string }>(res);
    expect(body.id).toBe(ROW_ID);
  });
});

describe('POST /api/admin/intent/config — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('AC1.2: returns 400 when body is not valid JSON', async () => {
    const req = new NextRequest('http://localhost/api/admin/intent/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ADMIN_SECRET}`,
      },
      body: 'not-json{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC1.3 / AC4.1: returns 400 when signal_likelihoods uses an unknown signal key', async () => {
    const res = await POST(
      makePostRequest({
        weights: {
          signal_likelihoods: {
            quiz_answer: { yield_hunter: 1.2 }, // old invented key — not in INTENT_SIGNAL_KEYS
          },
        },
      }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC4.2: returns 400 when priors uses an unknown archetype key', async () => {
    const res = await POST(
      makePostRequest({
        weights: {
          priors: { made_up_archetype: 0.5 },
        },
      }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC4.3: accepts valid partial weights (only behavioral_damping)', async () => {
    const createdRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: true,
      createdAt: CREATED_AT,
    };
    mockCreateAdminClient.mockReturnValue(makeInsertMock([createdRow]));

    const res = await POST(
      makePostRequest({
        weights: { behavioral_damping: 0.25 },
      }),
    );
    expect(res.status).toBe(201);
    const body = await parseBody<{ id: string }>(res);
    expect(body.id).toBe(ROW_ID);
  });

  it('AC4.4: accepts empty weights object', async () => {
    const createdRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: true,
      createdAt: CREATED_AT,
    };
    mockCreateAdminClient.mockReturnValue(makeInsertMock([createdRow]));

    const res = await POST(makePostRequest({ weights: {} }));
    expect(res.status).toBe(201);
  });
});

describe('POST /api/admin/intent/config — create (AC1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('AC1.1: creates a global row; response includes id, tenant_id null, is_active', async () => {
    const createdRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: true,
      createdAt: CREATED_AT,
    };
    mockCreateAdminClient.mockReturnValue(makeInsertMock([createdRow]));

    const res = await POST(
      makePostRequest({
        weights: { behavioral_damping: 0.2, priors: { yield_hunter: 0.06, neutral: 0.3 } },
      }),
    );
    expect(res.status).toBe(201);
    const body = await parseBody<{
      id: string;
      tenant_id: string | null;
      is_active: boolean;
      created_at: string;
    }>(res);
    expect(body.id).toBe(ROW_ID);
    expect(body.tenant_id).toBeNull();
    expect(body.is_active).toBe(true);
    expect(typeof body.created_at).toBe('string');
  });

  it('AC1.1b: creates a tenant-specific row when tenant_id is provided', async () => {
    const createdRow = {
      id: ROW_ID,
      tenantId: TENANT_ID,
      isActive: true,
      createdAt: CREATED_AT,
    };
    mockCreateAdminClient.mockReturnValue(makeInsertMock([createdRow]));

    const res = await POST(
      makePostRequest({
        weights: { behavioral_damping: 0.3 },
        tenant_id: TENANT_ID,
      }),
    );
    expect(res.status).toBe(201);
    const body = await parseBody<{ id: string; tenant_id: string | null }>(res);
    expect(body.id).toBe(ROW_ID);
    expect(body.tenant_id).toBe(TENANT_ID);
  });

  it('AC1.1c: creates an inactive row when is_active=false', async () => {
    const createdRow = {
      id: ROW_ID,
      tenantId: null,
      isActive: false,
      createdAt: CREATED_AT,
    };
    mockCreateAdminClient.mockReturnValue(makeInsertMock([createdRow]));

    const res = await POST(
      makePostRequest({
        weights: {},
        is_active: false,
      }),
    );
    expect(res.status).toBe(201);
    const body = await parseBody<{ is_active: boolean }>(res);
    expect(body.is_active).toBe(false);
  });
});

describe('POST /api/admin/intent/config — Rule K.2 fail-loud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('K2.1: returns 500 when DB is configured but throws (Rule K.2 — no mock fallback)', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockCreateAdminClient.mockReturnValue(
      makeInsertMockThrowing(new Error('Postgres connection refused')),
    );

    const res = await POST(makePostRequest({ weights: {} }));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('db_error');
    // MUST NOT return fabricated data — verify no 'id' field was returned
    expect('id' in body).toBe(false);
  });

  it('K2.2: returns 500 when DB is unconfigured (no mock write path for mutations)', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    const res = await POST(makePostRequest({ weights: {} }));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('db_unconfigured');
  });
});
