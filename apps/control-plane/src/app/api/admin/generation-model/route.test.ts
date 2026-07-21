/**
 * Unit tests for GET /api/admin/generation-model and PUT /api/admin/generation-model
 * — FOLLOW-161.
 *
 * Coverage (AC2, AC1 contract, auth + allow-list validation, persistence, fail-loud):
 *   - GET: auth required (401 when no JWT / insufficient role)
 *   - GET: returns current model, allowed_models, is_default, updated_at
 *   - GET: returns default values when DB not configured
 *   - GET: DB failure → 500 (fail-loud Rule K.2)
 *   - PUT: auth required — Estalara staff ONLY (FOLLOW-456 / audit F-13):
 *       - 401 when no auth at all
 *       - 403 when caller has a valid tenant agency:admin JWT (NOT staff) — the hole this
 *         ticket closes: a tenant admin must NOT be able to mutate the platform-global model
 *       - 200 via Bearer <ADMIN_API_SECRET> (constant-time compare path)
 *       - 200 via a verified estalara_staff:true JWT
 *   - PUT: validation — invalid model → 400 with allowed_models hint
 *   - PUT: happy path — persists and returns updated state
 *   - PUT: DB failure → 500 (fail-loud Rule K.2)
 *
 * @module apps/control-plane/src/app/api/admin/generation-model/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted stubs ────────────────────────────────────────────────────────────

const {
  mockGetGlobalGenerationModel,
  mockSetGlobalGenerationModel,
  mockRequireTenantAccess,
  mockCreateAdminClient,
  mockGetAuthClaims,
  mockIsStaffClaims,
} = vi.hoisted(() => ({
  mockGetGlobalGenerationModel: vi.fn(),
  mockSetGlobalGenerationModel: vi.fn(),
  mockRequireTenantAccess: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockGetAuthClaims: vi.fn(),
  mockIsStaffClaims: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/global-config-store', () => ({
  getGlobalGenerationModel: mockGetGlobalGenerationModel,
  setGlobalGenerationModel: mockSetGlobalGenerationModel,
  ALLOWED_GENERATION_MODELS: [
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-6',
    'claude-opus-4-8',
  ] as const,
  DEFAULT_GENERATION_MODEL: 'claude-sonnet-4-6',
  GENERATION_MODEL_KEY: 'generation_model',
}));

// verifyTracerAdminAuth (PUT's guard) is exercised via the real module — only its
// own @estalara/auth dependencies (getAuthClaims/isStaffClaims) are mocked, same
// pattern as apps/control-plane/src/app/api/admin/intent/config/route.test.ts.
// requireTenantAccess (GET's guard) is mocked directly since GET does not go
// through verifyTracerAdminAuth.
vi.mock('@estalara/auth', () => ({
  requireTenantAccess: mockRequireTenantAccess,
  getAuthClaims: mockGetAuthClaims,
  isStaffClaims: mockIsStaffClaims,
  // Faithful reimplementation of the real `requireStaffRole` rank gate (FOLLOW-598
  // Part 2) — throws when the claims are not staff or the role rank is insufficient.
  requireStaffRole: (
    claims: { estalara_staff?: boolean; estalara_role?: string } | null,
    minimum: string,
  ) => {
    const rank: Record<string, number> = {
      'estalara:superadmin': 3,
      'estalara:ops': 2,
      'estalara:readonly': 1,
    };
    if (claims?.estalara_staff !== true || !claims.estalara_role) {
      throw new Error('Access denied: agency users cannot access staff resources');
    }
    if ((rank[claims.estalara_role] ?? 0) < (rank[minimum] ?? 0)) {
      throw new Error(`Access denied: role '${claims.estalara_role}' is insufficient`);
    }
  },
}));

vi.mock('@estalara/db', () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue([]),
  };
  mockCreateAdminClient.mockReturnValue(mockDb);
  return {
    createAdminClient: mockCreateAdminClient,
    appConfig: {
      key: 'key',
      value: 'value',
      updatedAt: 'updated_at',
      updatedBy: 'updated_by',
    },
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}));

import { GET, PUT } from './route';

// ─── Constants ────────────────────────────────────────────────────────────────

const USER_ID = 'aaaabbbb-0000-0000-0000-000000000001';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440099';

const ADMIN_CLAIMS = {
  sub: USER_ID,
  email: 'admin@estalara.com',
  tenant_id: TENANT_ID,
  agency_role: 'agency:admin' as const,
  estalara_staff: false as const,
  mfa_verified: false,
};

const STAFF_USER_ID = 'ccccdddd-0000-0000-0000-000000000002';
const STAFF_CLAIMS = {
  sub: STAFF_USER_ID,
  email: 'staff@estalara.com',
  tenant_id: null,
  estalara_staff: true as const,
  estalara_role: 'estalara:ops' as const,
  mfa_verified: true,
};

const SUPERADMIN_USER_ID = 'eeeeffff-0000-0000-0000-000000000003';
const SUPERADMIN_CLAIMS = {
  sub: SUPERADMIN_USER_ID,
  email: 'super@estalara.com',
  tenant_id: null,
  estalara_staff: true as const,
  estalara_role: 'estalara:superadmin' as const,
  mfa_verified: true,
};

const ADMIN_SECRET = 'test-admin-secret-xyz';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/admin/generation-model', {
    headers: { Authorization: 'Bearer test_token' },
  });
}

function makePutRequest(
  body: Record<string, unknown>,
  opts: { bearer?: string | undefined } = { bearer: ADMIN_SECRET },
): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer !== undefined) {
    headers.Authorization = `Bearer ${opts.bearer}`;
  }
  return new NextRequest('http://localhost/api/admin/generation-model', {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// ─── GET tests ────────────────────────────────────────────────────────────────

describe('GET /api/admin/generation-model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no valid JWT', async () => {
    mockRequireTenantAccess.mockRejectedValue(new Error('Unauthorized'));
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 401 when caller has viewer role (insufficient)', async () => {
    mockRequireTenantAccess.mockRejectedValue(new Error('Insufficient role'));
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it('returns current model config for admin user', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    mockGetGlobalGenerationModel.mockResolvedValue('claude-sonnet-4-6');
    // readConfigRow will use mocked createAdminClient which returns []

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.generation_model).toBe('claude-sonnet-4-6');
    expect(Array.isArray(body.allowed_models)).toBe(true);
    expect((body.allowed_models as string[]).length).toBe(3);
    expect(typeof body.is_default).toBe('boolean');
  });

  it('is_default=true when no DB row has been written', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    mockGetGlobalGenerationModel.mockResolvedValue('claude-sonnet-4-6');
    // DB returns empty rows (no configured override yet)

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.is_default).toBe(true);
    expect(body.updated_at).toBeNull();
  });

  it('returns 500 when getGlobalGenerationModel throws (fail-loud Rule K.2)', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    mockGetGlobalGenerationModel.mockRejectedValue(new Error('DB connection refused'));

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('internal_error');
  });

  // ─── Staff path (Phase 0 superadmin-access, 2026-07-20) ────────────────────
  // The /admin/settings page is used by staff sessions that carry NO agency_role,
  // so GET must accept the same staff auth PUT already does. Additive: the agency
  // path above is untouched (a non-staff caller falls through to it).
  describe('staff auth path (/admin/settings page)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.unstubAllEnvs();
      vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
      mockGetAuthClaims.mockResolvedValue(null);
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('succeeds via ADMIN_API_SECRET Bearer without any agency session', async () => {
      // Agency guard must NOT be consulted on the staff path — reject if called.
      mockRequireTenantAccess.mockRejectedValue(new Error('should not be called'));
      mockGetGlobalGenerationModel.mockResolvedValue('claude-sonnet-4-6');

      const req = new NextRequest('http://localhost/api/admin/generation-model', {
        headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
      });
      const res = await GET(req);
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.generation_model).toBe('claude-sonnet-4-6');
      expect(mockRequireTenantAccess).not.toHaveBeenCalled();
    });

    it('succeeds via a verified estalara_staff:true JWT without any agency session', async () => {
      mockIsStaffClaims.mockReturnValue(true);
      mockGetAuthClaims.mockResolvedValue(STAFF_CLAIMS);
      mockRequireTenantAccess.mockRejectedValue(new Error('should not be called'));
      mockGetGlobalGenerationModel.mockResolvedValue('claude-opus-4-8');

      const req = new NextRequest('http://localhost/api/admin/generation-model', {
        headers: { Authorization: 'Bearer staff-jwt-token' },
      });
      const res = await GET(req);
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.generation_model).toBe('claude-opus-4-8');
      expect(mockRequireTenantAccess).not.toHaveBeenCalled();
    });

    it('still 401 for a caller that is neither staff nor agency:admin', async () => {
      // Not staff (JWT path rejects), and the agency fallback rejects too.
      mockIsStaffClaims.mockReturnValue(false);
      mockGetAuthClaims.mockResolvedValue(null);
      mockRequireTenantAccess.mockRejectedValue(new Error('Unauthorized'));

      const req = new NextRequest('http://localhost/api/admin/generation-model', {
        headers: { Authorization: 'Bearer some-random-token' },
      });
      const res = await GET(req);
      expect(res.status).toBe(401);
    });
  });
});

// ─── PUT tests ────────────────────────────────────────────────────────────────

describe('PUT /api/admin/generation-model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when no auth at all (no Bearer, no ADMIN_API_SECRET match)', async () => {
    const res = await PUT(makePutRequest({ generation_model: 'claude-sonnet-4-6' }, {}));
    expect(res.status).toBe(401);
  });

  // FOLLOW-456 / audit F-13 — the hole this ticket closes: a tenant's own
  // agency:admin/agency:owner role must NOT be sufficient to mutate the
  // platform-global model.
  it('returns 403 when caller has a valid tenant agency:admin JWT (NOT staff)', async () => {
    mockGetAuthClaims.mockResolvedValue(ADMIN_CLAIMS);
    const res = await PUT(
      makePutRequest({ generation_model: 'claude-sonnet-4-6' }, { bearer: 'tenant-jwt-token' }),
    );
    expect(res.status).toBe(403);
    expect(mockSetGlobalGenerationModel).not.toHaveBeenCalled();
  });

  it('returns 400 when model is not in allow-list (via ADMIN_API_SECRET)', async () => {
    const res = await PUT(makePutRequest({ generation_model: 'gpt-4o' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string; allowed_models: string[] } }>(res);
    expect(body.error.code).toBe('validation_failed');
    expect(Array.isArray(body.error.allowed_models)).toBe(true);
  });

  it('returns 400 when generation_model is missing', async () => {
    const res = await PUT(makePutRequest({}));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('returns 400 when body is not valid JSON', async () => {
    const req = new NextRequest('http://localhost/api/admin/generation-model', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ADMIN_SECRET}`, 'Content-Type': 'application/json' },
      body: 'not json {{{',
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('succeeds via ADMIN_API_SECRET Bearer (constant-time compare path)', async () => {
    mockSetGlobalGenerationModel.mockResolvedValue(undefined);

    const res = await PUT(makePutRequest({ generation_model: 'claude-opus-4-8' }));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.generation_model).toBe('claude-opus-4-8');
    expect(body.is_default).toBe(false);
    expect(typeof body.updated_at).toBe('string');

    // ADMIN_API_SECRET path has no user identity — updated_by is null, never a
    // sentinel string in the uuid column.
    expect(mockSetGlobalGenerationModel).toHaveBeenCalledWith('claude-opus-4-8', null);
  });

  it('succeeds via a verified estalara:superadmin JWT', async () => {
    mockIsStaffClaims.mockReturnValue(true);
    mockGetAuthClaims.mockResolvedValue(SUPERADMIN_CLAIMS);
    mockSetGlobalGenerationModel.mockResolvedValue(undefined);

    const res = await PUT(
      makePutRequest({ generation_model: 'claude-opus-4-8' }, { bearer: 'staff-jwt-token' }),
    );
    expect(res.status).toBe(200);
    expect(mockSetGlobalGenerationModel).toHaveBeenCalledWith(
      'claude-opus-4-8',
      SUPERADMIN_USER_ID,
    );
  });

  // RETRO-187 §4a LG-2 / CEO Q3 (FOLLOW-598): a below-superadmin staff account can
  // no longer mutate the platform-global generation model.
  it('returns 403 for an ops-rank staff JWT (superadmin required)', async () => {
    mockIsStaffClaims.mockReturnValue(true);
    mockGetAuthClaims.mockResolvedValue(STAFF_CLAIMS);

    const res = await PUT(
      makePutRequest({ generation_model: 'claude-opus-4-8' }, { bearer: 'staff-jwt-token' }),
    );
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
    expect(mockSetGlobalGenerationModel).not.toHaveBeenCalled();
  });

  it('succeeds with claude-haiku-4-5-20251001', async () => {
    mockSetGlobalGenerationModel.mockResolvedValue(undefined);

    const res = await PUT(makePutRequest({ generation_model: 'claude-haiku-4-5-20251001' }));
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.generation_model).toBe('claude-haiku-4-5-20251001');
  });

  it('is_default=true when setting the default model', async () => {
    mockSetGlobalGenerationModel.mockResolvedValue(undefined);

    const res = await PUT(makePutRequest({ generation_model: 'claude-sonnet-4-6' }));
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.is_default).toBe(true);
  });

  it('returns 500 when DB throws on write (fail-loud Rule K.2)', async () => {
    mockSetGlobalGenerationModel.mockRejectedValue(new Error('DB write failed'));

    const res = await PUT(makePutRequest({ generation_model: 'claude-opus-4-8' }));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('internal_error');
  });
});

// ─── getGlobalGenerationModel default fallback ────────────────────────────────

describe('getGlobalGenerationModel default fallback (AC1)', () => {
  it('returns allowed_models list containing all 3 curated models on GET', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    mockGetGlobalGenerationModel.mockResolvedValue('claude-sonnet-4-6');

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<{ allowed_models: string[] }>(res);
    expect(body.allowed_models).toContain('claude-haiku-4-5-20251001');
    expect(body.allowed_models).toContain('claude-sonnet-4-6');
    expect(body.allowed_models).toContain('claude-opus-4-8');
  });
});
