import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { POST as revokePost } from './route';
import { POST as sessionsPost } from '../../route';
import { sessionStore } from '../../store';

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

const TENANT_ID = '660e8400-e29b-41d4-a716-446655440099';

async function createSession(tenantId = TENANT_ID): Promise<string> {
  const req = new NextRequest('http://localhost/api/demo/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
    body: JSON.stringify({ scope: 'mockup', visibility: 'self', duration: 'session' }),
  });
  const res = await sessionsPost(req);
  const body = await parseBody<{ session_id: string }>(res);
  return body.session_id;
}

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

describe('POST /api/demo/sessions/:id/revoke', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  it('revoke valid session → 200 { revoked: true }', async () => {
    const sessionId = await createSession();
    const res = await revokePost(makeRevokeRequest(sessionId), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(res.status).toBe(200);
    const body = await parseBody<{ revoked: boolean; session_id: string }>(res);
    expect(body.revoked).toBe(true);
    expect(body.session_id).toBe(sessionId);
  });

  it('missing x-tenant-id → 401', async () => {
    const sessionId = await createSession();
    const res = await revokePost(makeRevokeRequest(sessionId, ''), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('non-existent session → 404', async () => {
    const res = await revokePost(makeRevokeRequest('00000000-0000-0000-0000-000000000000'), {
      params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }),
    });
    expect(res.status).toBe(404);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('not_found');
  });
});
