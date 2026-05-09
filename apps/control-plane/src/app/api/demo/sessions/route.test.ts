import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { GET, POST } from './route';
import { sessionStore } from './_store';

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440099';

const VALID_BODY = {
  scope: 'mockup',
  visibility: 'self',
  duration: 'session',
} as const;

function makePostRequest(body: Record<string, unknown>, tenantId = TENANT_ID): NextRequest {
  return new NextRequest('http://localhost/api/demo/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
    },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(tenantId = TENANT_ID): NextRequest {
  return new NextRequest('http://localhost/api/demo/sessions', {
    headers: tenantId ? { 'x-tenant-id': tenantId } : {},
  });
}

describe('POST /api/demo/sessions', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  it('valid body → 201 with token and session_id', async () => {
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(201);
    const body = await parseBody<{ session_id: string; token: string; expires_at: string }>(res);
    expect(typeof body.session_id).toBe('string');
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.')).toHaveLength(3);
    expect(typeof body.expires_at).toBe('string');
  });

  it('missing x-tenant-id → 401', async () => {
    const res = await POST(makePostRequest(VALID_BODY, ''));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('scope=production without production_domain → 400', async () => {
    const res = await POST(
      makePostRequest({ scope: 'production', visibility: 'self', duration: 'session' }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.message).toContain('production_domain');
  });

  it('scope=production with domain → 201', async () => {
    const res = await POST(
      makePostRequest({
        scope: 'production',
        visibility: 'self',
        duration: '24h',
        production_domain: 'listings.example.com',
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe('GET /api/demo/sessions', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  it('valid x-tenant-id → 200 with sessions array', async () => {
    const res = GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<{ tenant_id: string; sessions: unknown[] }>(res);
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it('missing x-tenant-id → 401', async () => {
    const res = GET(makeGetRequest(''));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });
});
