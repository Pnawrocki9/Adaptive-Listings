/**
 * Tests for PATCH /api/tenants/:id/bandit/weights/:archetype
 *
 * DATABASE_URL is not set in CI — route returns mock { resumed: true, mock: true }.
 * JWT is mocked via vi.mock('@estalara/auth').
 *
 * @module apps/control-plane/src/app/api/tenants/[id]/bandit/weights/[archetype]/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440003';
const ARCHETYPE = 'yield_hunter';

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
}));

// @estalara/db is not available in CI without a real DB — mock it to avoid import errors.
vi.mock('@estalara/db', () => ({
  createTenantClient: vi.fn(() => ({
    rls: vi.fn().mockResolvedValue(undefined),
  })),
  abBanditWeights: {
    tenantId: 'tenant_id',
    archetype: 'archetype',
    paused: 'paused',
    updatedAt: 'updated_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

import { getAuthClaims } from '@estalara/auth';
const mockGetAuthClaims = vi.mocked(getAuthClaims);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(tenantId?: string): NextRequest {
  const url = new URL(
    `http://localhost/api/tenants/${tenantId ?? TENANT_ID}/bandit/weights/${ARCHETYPE}`,
  );
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (tenantId) {
    headers.Authorization = `Bearer mock-token`;
  }
  return new NextRequest(url.toString(), { method: 'PATCH', headers });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/tenants/:id/bandit/weights/:archetype', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when getAuthClaims returns null (no JWT)', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const { PATCH } = await import('./route.js');
    const res = await PATCH(makeRequest(TENANT_ID), {
      params: Promise.resolve({ id: TENANT_ID, archetype: ARCHETYPE }),
    });

    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 401 for staff user without tenant_id', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'staff-uuid',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: 'estalara:ops',
      mfa_verified: false,
    });

    const { PATCH } = await import('./route.js');
    const res = await PATCH(makeRequest('some-tenant'), {
      params: Promise.resolve({ id: 'some-tenant', archetype: ARCHETYPE }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 when JWT tenant_id does not match URL :id', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: 'different-tenant-id',
      agency_role: 'agency:admin',
      estalara_staff: false,
      mfa_verified: true,
    });

    const { PATCH } = await import('./route.js');
    const res = await PATCH(makeRequest(TENANT_ID), {
      params: Promise.resolve({ id: TENANT_ID, archetype: ARCHETYPE }),
    });

    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
  });

  it('returns 403 for agency:viewer role', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:viewer',
      estalara_staff: false,
      mfa_verified: true,
    });

    const { PATCH } = await import('./route.js');
    const res = await PATCH(makeRequest(TENANT_ID), {
      params: Promise.resolve({ id: TENANT_ID, archetype: ARCHETYPE }),
    });

    expect(res.status).toBe(403);
  });

  it('returns 200 { resumed: true } for valid admin JWT (mock DB path)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:admin',
      estalara_staff: false,
      mfa_verified: true,
    });

    const { PATCH } = await import('./route.js');
    const res = await PATCH(makeRequest(TENANT_ID), {
      params: Promise.resolve({ id: TENANT_ID, archetype: ARCHETYPE }),
    });

    expect(res.status).toBe(200);
    const body = await parseBody<{ resumed: boolean; archetype: string }>(res);
    expect(body.resumed).toBe(true);
    expect(body.archetype).toBe(ARCHETYPE);
  });

  it('returns 200 { resumed: true } for owner role', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'owner-uuid',
      email: 'owner@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:owner',
      estalara_staff: false,
      mfa_verified: true,
    });

    const { PATCH } = await import('./route.js');
    const res = await PATCH(makeRequest(TENANT_ID), {
      params: Promise.resolve({ id: TENANT_ID, archetype: ARCHETYPE }),
    });

    expect(res.status).toBe(200);
  });
});
