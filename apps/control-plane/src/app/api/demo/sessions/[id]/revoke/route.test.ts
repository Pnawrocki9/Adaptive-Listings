import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  demoSessions: {
    id: 'id',
    tenantId: 'tenant_id',
    revokedAt: 'revoked_at',
    revokeReason: 'revoke_reason',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
}));

const { mockRequireTenantAccess } = vi.hoisted(() => ({
  mockRequireTenantAccess: vi.fn(),
}));

vi.mock('@estalara/auth', () => ({
  requireTenantAccess: mockRequireTenantAccess,
}));

import { createAdminClient } from '@estalara/db';

import { POST as revokePost } from './route';

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

const TENANT_ID = '660e8400-e29b-41d4-a716-446655440099';
const OTHER_TENANT_ID = '770e8400-e29b-41d4-a716-446655440000';

const VIEWER_CLAIMS = {
  sub: 'aaaabbbb-0000-0000-0000-000000000001',
  email: 'viewer@estalara.com',
  tenant_id: TENANT_ID,
  agency_role: 'agency:viewer' as const,
  estalara_staff: false as const,
  mfa_verified: false,
};

function makeRevokeRequest(sessionId: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/demo/sessions/${sessionId}/revoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test_token',
      ...headers,
    },
    body: JSON.stringify({}),
  });
}

function makeUpdateDbMock(rowsUpdated: { id: string }[]) {
  return {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(rowsUpdated),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/demo/sessions/:id/revoke', () => {
  it('revoke valid session → 200 { revoked: true }', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-000000000001';
    mockRequireTenantAccess.mockResolvedValue(VIEWER_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue(
      makeUpdateDbMock([{ id: sessionId }]) as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await revokePost(makeRevokeRequest(sessionId), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(res.status).toBe(200);
    const body = await parseBody<{ revoked: boolean; session_id: string }>(res);
    expect(body.revoked).toBe(true);
    expect(body.session_id).toBe(sessionId);
  });

  it('missing/invalid JWT → 401', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-000000000002';
    mockRequireTenantAccess.mockRejectedValue(new Error('Unauthorized'));

    const res = await revokePost(makeRevokeRequest(sessionId), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('spoofed x-tenant-id (disagrees with JWT-derived tenant) → 403', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-000000000003';
    mockRequireTenantAccess.mockResolvedValue(VIEWER_CLAIMS);

    const res = await revokePost(makeRevokeRequest(sessionId, { 'x-tenant-id': OTHER_TENANT_ID }), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
    // The DB must never be touched when the spoofed header is rejected up front.
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('x-tenant-id matching the JWT-derived tenant is accepted (not spoofing)', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-000000000004';
    mockRequireTenantAccess.mockResolvedValue(VIEWER_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue(
      makeUpdateDbMock([{ id: sessionId }]) as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await revokePost(makeRevokeRequest(sessionId, { 'x-tenant-id': TENANT_ID }), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(res.status).toBe(200);
  });

  it('non-existent session (scoped to JWT tenant) → 404', async () => {
    const sessionId = '00000000-0000-0000-0000-000000000000';
    mockRequireTenantAccess.mockResolvedValue(VIEWER_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue(
      makeUpdateDbMock([]) as unknown as ReturnType<typeof createAdminClient>,
    );

    const res = await revokePost(makeRevokeRequest(sessionId), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(res.status).toBe(404);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('not_found');
  });
});
