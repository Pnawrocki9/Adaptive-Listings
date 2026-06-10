/**
 * Tests for PATCH /api/tenants/:id — tenant settings update.
 * FOLLOW-102 AC2: quiz_enabled toggle, auth, invalid payload.
 *
 * DATABASE_URL_ADMIN is not set in CI — route returns a mock response.
 * Auth is mocked via vi.mock('@estalara/auth').
 *
 * @module apps/control-plane/src/app/api/tenants/[id]/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock @estalara/db to avoid a real database connection.
vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([
      {
        id: 'tenant-uuid-001',
        quizEnabled: false,
      },
    ]),
  })),
  tenants: {
    id: 'id',
    quizEnabled: 'quiz_enabled',
    updatedAt: 'updated_at',
  },
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

// Re-export eq from drizzle-orm for the route — mock it too.
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

// Mock auth — default to an authenticated tenant-scoped JWT.
const mockGetAuthClaims = vi.fn<(req: unknown) => Promise<{ tenant_id: string } | null>>();
vi.mock('@estalara/auth', () => ({
   
  getAuthClaims: (req: unknown): Promise<{ tenant_id: string } | null> => mockGetAuthClaims(req),
}));

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makePatchRequest(
  body: Record<string, unknown>,
  tenantId = 'tenant-uuid-001',
): NextRequest {
  return new NextRequest(`http://localhost/api/tenants/${tenantId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test.jwt.token' },
    body: JSON.stringify(body),
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/tenants/:id — no DB in CI (mock path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated as tenant-uuid-001
    mockGetAuthClaims.mockResolvedValue({ tenant_id: 'tenant-uuid-001' });
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // AC2 test 1: toggle quiz OFF
  it('returns 200 with quiz_enabled=false when toggling quiz OFF (mock path)', async () => {
    const { PATCH } = await import('./route.js');
    const res = await PATCH(makePatchRequest({ quiz_enabled: false }), {
      params: Promise.resolve({ id: 'tenant-uuid-001' }),
    });

    expect(res.status).toBe(200);
    const body = await parseBody<{ id: string; quiz_enabled: boolean; mock: boolean }>(res);
    expect(body.id).toBe('tenant-uuid-001');
    expect(body.quiz_enabled).toBe(false);
    expect(body.mock).toBe(true);
  });

  // AC2 test 2: toggle quiz ON
  it('returns 200 with quiz_enabled=true when toggling quiz ON (mock path)', async () => {
    const { PATCH } = await import('./route.js');
    const res = await PATCH(makePatchRequest({ quiz_enabled: true }), {
      params: Promise.resolve({ id: 'tenant-uuid-001' }),
    });

    expect(res.status).toBe(200);
    const body = await parseBody<{ id: string; quiz_enabled: boolean; mock: boolean }>(res);
    expect(body.quiz_enabled).toBe(true);
  });

  // AC2 test 3: invalid payload — string instead of boolean
  it('returns 400 for invalid payload (string instead of boolean)', async () => {
    const { PATCH } = await import('./route.js');
    const res = await PATCH(makePatchRequest({ quiz_enabled: 'yes' }), {
      params: Promise.resolve({ id: 'tenant-uuid-001' }),
    });

    expect(res.status).toBe(400);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toBe('Validation failed');
  });

  // AC2 test 4: no updatable fields
  it('returns 400 when no updatable fields are provided', async () => {
    const { PATCH } = await import('./route.js');
    const res = await PATCH(makePatchRequest({}), {
      params: Promise.resolve({ id: 'tenant-uuid-001' }),
    });

    expect(res.status).toBe(400);
  });

  // AC2 auth: missing token → 401
  it('returns 401 when auth token is missing', async () => {
    mockGetAuthClaims.mockResolvedValueOnce(null);

    const { PATCH } = await import('./route.js');
    const res = await PATCH(makePatchRequest({ quiz_enabled: false }), {
      params: Promise.resolve({ id: 'tenant-uuid-001' }),
    });

    expect(res.status).toBe(401);
  });

  // AC2 auth: mismatched tenant → 403
  it('returns 403 when the JWT tenant does not match the :id param', async () => {
    mockGetAuthClaims.mockResolvedValueOnce({ tenant_id: 'other-tenant-uuid' });

    const { PATCH } = await import('./route.js');
    const res = await PATCH(makePatchRequest({ quiz_enabled: false }), {
      params: Promise.resolve({ id: 'tenant-uuid-001' }),
    });

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/tenants/:id — with DB configured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthClaims.mockResolvedValue({ tenant_id: 'tenant-uuid-001' });
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // AC2 DB test: successful update returns id + quiz_enabled
  it('returns 200 with id and quiz_enabled from DB row on success', async () => {
    const { PATCH } = await import('./route.js');
    const res = await PATCH(makePatchRequest({ quiz_enabled: false }), {
      params: Promise.resolve({ id: 'tenant-uuid-001' }),
    });

    expect(res.status).toBe(200);
    const body = await parseBody<{ id: string; quiz_enabled: boolean }>(res);
    expect(body.id).toBe('tenant-uuid-001');
    expect(body.quiz_enabled).toBe(false);
    // DB path does not include 'mock' field
    expect((body as Record<string, unknown>).mock).toBeUndefined();
  });
});
