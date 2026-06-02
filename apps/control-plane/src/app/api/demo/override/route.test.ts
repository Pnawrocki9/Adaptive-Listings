/**
 * Unit tests for GET /api/demo/override and PUT /api/demo/override — DEMO-001.
 *
 * Coverage (AC2, AC3, AC7c):
 *   - GET: auth required (401 when no JWT), returns override state for viewer
 *   - GET: returns defaults when no row exists in DB
 *   - PUT: auth required (401 for no JWT / insufficient role)
 *   - PUT: validation — invalid archetype → 400, invalid model → 400
 *   - PUT: enabled=true without archetype → 400
 *   - PUT: happy path → 200 with persisted state
 *   - PUT: DB failure → 500 with error body (fail-loud per Rule K.2)
 *   - GET: DB failure → 500 (fail-loud)
 *
 * @module apps/control-plane/src/app/api/demo/override/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Hoisted stubs ────────────────────────────────────────────────────────────

const { mockGetDemoOverride, mockUpsertDemoOverride, mockRequireTenantAccess } = vi.hoisted(() => ({
  mockGetDemoOverride: vi.fn(),
  mockUpsertDemoOverride: vi.fn(),
  mockRequireTenantAccess: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: mockGetDemoOverride,
  upsertDemoOverride: mockUpsertDemoOverride,
  REACHABLE_ARCHETYPES: [
    'yield_hunter',
    'vacation_rental_investor',
    'flip_investor',
    'portfolio_builder',
    'family_buyer',
    'first_time_buyer',
    'upsizer',
    'downsizer',
    'luxury_buyer',
    'remote_worker',
    'lifestyle_expat',
    'second_home_buyer',
    'neutral',
  ] as const,
  DEMO_ALLOWED_MODELS: [
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-6',
    'claude-opus-4-8',
  ] as const,
  DEMO_DEFAULT_MODEL: 'claude-sonnet-4-6',
}));

vi.mock('@estalara/auth', () => ({
  requireTenantAccess: mockRequireTenantAccess,
}));

import { GET, PUT } from './route';

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440099';
const USER_ID = '11111111-1111-1111-1111-111111111111';

const ADMIN_CLAIMS = {
  sub: USER_ID,
  email: 'admin@example.com',
  tenant_id: TENANT_ID,
  agency_role: 'agency:admin' as const,
  estalara_staff: false as const,
  mfa_verified: false,
};

const VIEWER_CLAIMS = {
  sub: USER_ID,
  email: 'viewer@example.com',
  tenant_id: TENANT_ID,
  agency_role: 'agency:viewer' as const,
  estalara_staff: false as const,
  mfa_verified: false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/demo/override', {
    headers: { Authorization: 'Bearer test_token' },
  });
}

function makePutRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/demo/override', {
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/demo/override', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no valid JWT', async () => {
    mockRequireTenantAccess.mockRejectedValue(new Error('Unauthorized'));
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it('returns current override state for a viewer', async () => {
    mockRequireTenantAccess.mockResolvedValue(VIEWER_CLAIMS);
    mockGetDemoOverride.mockResolvedValue({
      enabled: true,
      overrideArchetype: 'family_buyer',
      overrideModel: 'claude-sonnet-4-6',
    });

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.enabled).toBe(true);
    expect(body.override_archetype).toBe('family_buyer');
    expect(body.override_model).toBe('claude-sonnet-4-6');
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(Array.isArray(body.archetypes)).toBe(true);
    expect(Array.isArray(body.models)).toBe(true);
  });

  it('returns default state (enabled=false) when no row exists', async () => {
    mockRequireTenantAccess.mockResolvedValue(VIEWER_CLAIMS);
    mockGetDemoOverride.mockResolvedValue({
      enabled: false,
      overrideArchetype: null,
      overrideModel: 'claude-sonnet-4-6',
    });

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.enabled).toBe(false);
    expect(body.override_archetype).toBeNull();
  });

  it('returns 500 when DB throws (fail-loud Rule K.2)', async () => {
    mockRequireTenantAccess.mockResolvedValue(VIEWER_CLAIMS);
    mockGetDemoOverride.mockRejectedValue(new Error('DB connection refused'));

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(500);

    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('internal_error');
  });
});

describe('PUT /api/demo/override', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no valid JWT', async () => {
    mockRequireTenantAccess.mockRejectedValue(new Error('Unauthorized'));
    const res = await PUT(makePutRequest({ enabled: false, override_model: 'claude-sonnet-4-6' }));
    expect(res.status).toBe(401);
  });

  it('returns 401 when caller has insufficient role', async () => {
    mockRequireTenantAccess.mockRejectedValue(new Error('Insufficient role'));
    const res = await PUT(makePutRequest({ enabled: false, override_model: 'claude-sonnet-4-6' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid archetype', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    const res = await PUT(
      makePutRequest({
        enabled: true,
        override_archetype: 'not_a_real_archetype',
        override_model: 'claude-sonnet-4-6',
      }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('returns 400 on invalid model', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    const res = await PUT(
      makePutRequest({
        enabled: true,
        override_archetype: 'family_buyer',
        override_model: 'gpt-4o',
      }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('returns 400 when enabled=true but archetype is missing', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    const res = await PUT(
      makePutRequest({
        enabled: true,
        override_model: 'claude-sonnet-4-6',
      }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { message: string } }>(res);
    expect(body.error.message).toMatch(/override_archetype is required/);
  });

  it('succeeds with enabled=false and null archetype', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    const mockRow = {
      id: 'uuid-123',
      tenantId: TENANT_ID,
      enabled: false,
      overrideArchetype: null,
      overrideModel: 'claude-sonnet-4-6',
      updatedBy: USER_ID,
      updatedAt: new Date('2026-06-02T10:00:00Z'),
      createdAt: new Date('2026-06-02T10:00:00Z'),
    };
    mockUpsertDemoOverride.mockResolvedValue(mockRow);

    const res = await PUT(makePutRequest({ enabled: false, override_model: 'claude-sonnet-4-6' }));
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.enabled).toBe(false);
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(typeof body.updated_at).toBe('string');
  });

  it('succeeds enabling DEMO MODE with valid archetype + model', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    const mockRow = {
      id: 'uuid-456',
      tenantId: TENANT_ID,
      enabled: true,
      overrideArchetype: 'yield_hunter',
      overrideModel: 'claude-opus-4-8',
      updatedBy: USER_ID,
      updatedAt: new Date('2026-06-02T10:00:00Z'),
      createdAt: new Date('2026-06-02T10:00:00Z'),
    };
    mockUpsertDemoOverride.mockResolvedValue(mockRow);

    const res = await PUT(
      makePutRequest({
        enabled: true,
        override_archetype: 'yield_hunter',
        override_model: 'claude-opus-4-8',
      }),
    );
    expect(res.status).toBe(200);

    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.enabled).toBe(true);
    expect(body.override_archetype).toBe('yield_hunter');
    expect(body.override_model).toBe('claude-opus-4-8');

    // Verify upsertDemoOverride was called with tenant_id from JWT (never from body)
    expect(mockUpsertDemoOverride).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        enabled: true,
        overrideArchetype: 'yield_hunter',
        overrideModel: 'claude-opus-4-8',
      }),
      USER_ID,
    );
  });

  it('returns 500 when DB throws on write (fail-loud Rule K.2)', async () => {
    mockRequireTenantAccess.mockResolvedValue(ADMIN_CLAIMS);
    mockUpsertDemoOverride.mockRejectedValue(new Error('DB write failed'));

    const res = await PUT(
      makePutRequest({
        enabled: true,
        override_archetype: 'neutral',
        override_model: 'claude-sonnet-4-6',
      }),
    );
    expect(res.status).toBe(500);

    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('internal_error');
  });
});
