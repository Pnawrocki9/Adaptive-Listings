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

import { createAdminClient } from '@estalara/db';

import { POST as revokePost } from './route';

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

const TENANT_ID = '660e8400-e29b-41d4-a716-446655440099';

function makeRevokeRequest(sessionId: string, tenantId = TENANT_ID): NextRequest {
  return new NextRequest(`http://localhost/api/demo/sessions/${sessionId}/revoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
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

  it('missing x-tenant-id → 401', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-000000000002';
    const res = await revokePost(makeRevokeRequest(sessionId, ''), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('non-existent session → 404', async () => {
    const sessionId = '00000000-0000-0000-0000-000000000000';
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
