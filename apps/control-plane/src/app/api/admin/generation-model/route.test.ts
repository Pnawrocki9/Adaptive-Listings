/**
 * Unit tests for GET /api/admin/generation-model and PUT /api/admin/generation-model
 * — FOLLOW-161.
 *
 * Coverage (AC2, AC1 contract, auth + allow-list validation, persistence, fail-loud):
 *   - GET: auth required (401 when no JWT / insufficient role)
 *   - GET: returns current model, allowed_models, is_default, updated_at
 *   - GET: returns default values when DB not configured
 *   - GET: DB failure → 500 (fail-loud Rule K.2)
 *   - PUT: auth required (401 for no JWT / insufficient role)
 *   - PUT: validation — invalid model → 400 with allowed_models hint
 *   - PUT: happy path — persists and returns updated state
 *   - PUT: DB failure → 500 (fail-loud Rule K.2)
 *
 * @module apps/control-plane/src/app/api/admin/generation-model/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Hoisted stubs ────────────────────────────────────────────────────────────

const {
  mockGetGlobalGenerationModel,
  mockSetGlobalGenerationModel,
  mockRequireTenantAccess,
  mockCreateAdminClient,
} = vi.hoisted(() => ({
  mockGetGlobalGenerationModel: vi.fn(),
  mockSetGlobalGenerationModel: vi.fn(),
  mockRequireTenantAccess: vi.fn(),
  mockCreateAdminClient: vi.fn(),
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

vi.mock('@estalara/auth', () => ({
  requireTenantAccess: mockRequireTenantAccess,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/admin/generation-model', {
    headers: { Authorization: 'Bearer test_token' },
  });
}

function makePutRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/admin/generation-model', {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer test_token',
      'Content-Type': 'application/json',
    },
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
});

// ─── PUT tests ────────────────────────────────────────────────────────────────

describe('PUT /api/admin/generation-model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no valid JWT', async () => {
    mockRequireTenantAccess.mockRejectedValue(new Error('Unauthorized'));
    const res = await PUT(makePutRequest({ generation_model: 'claude-sonnet-4-6' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when model is not in allow-list', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    const res = await PUT(makePutRequest({ generation_model: 'gpt-4o' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string; allowed_models: string[] } }>(res);
    expect(body.error.code).toBe('validation_failed');
    expect(Array.isArray(body.error.allowed_models)).toBe(true);
  });

  it('returns 400 when generation_model is missing', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    const res = await PUT(makePutRequest({}));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('returns 400 when body is not valid JSON', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    const req = new NextRequest('http://localhost/api/admin/generation-model', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test_token', 'Content-Type': 'application/json' },
      body: 'not json {{{',
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('succeeds with a valid allowed model', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    mockSetGlobalGenerationModel.mockResolvedValue(undefined);

    const res = await PUT(makePutRequest({ generation_model: 'claude-opus-4-8' }));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.generation_model).toBe('claude-opus-4-8');
    expect(body.is_default).toBe(false);
    expect(typeof body.updated_at).toBe('string');

    // Verify setGlobalGenerationModel was called with correct args
    expect(mockSetGlobalGenerationModel).toHaveBeenCalledWith('claude-opus-4-8', USER_ID);
  });

  it('succeeds with claude-haiku-4-5-20251001', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    mockSetGlobalGenerationModel.mockResolvedValue(undefined);

    const res = await PUT(makePutRequest({ generation_model: 'claude-haiku-4-5-20251001' }));
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.generation_model).toBe('claude-haiku-4-5-20251001');
  });

  it('is_default=true when setting the default model', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    mockSetGlobalGenerationModel.mockResolvedValue(undefined);

    const res = await PUT(makePutRequest({ generation_model: 'claude-sonnet-4-6' }));
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.is_default).toBe(true);
  });

  it('returns 500 when DB throws on write (fail-loud Rule K.2)', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
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
