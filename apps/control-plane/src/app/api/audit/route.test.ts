import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { GET } from './route';
import type { AuditResponse } from './route';

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

function makeRequest(params?: Record<string, string>, tenantId = TENANT_ID): NextRequest {
  const url = new URL('http://localhost/api/audit');
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return new NextRequest(url, {
    headers: tenantId ? { 'x-tenant-id': tenantId } : {},
  });
}

describe('GET /api/audit', () => {
  it('valid x-tenant-id → 200 with entries array', () => {
    const res = GET(makeRequest());
    expect(res.status).toBe(200);
  });

  it('returns correct response shape', async () => {
    const res = GET(makeRequest());
    const body = await parseBody<AuditResponse>(res);
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(typeof body.total).toBe('number');
    expect(Array.isArray(body.entries)).toBe(true);
    const first = body.entries[0];
    if (first) {
      expect(typeof first.id).toBe('string');
      expect(typeof first.action).toBe('string');
      expect(typeof first.created_at).toBe('string');
    }
  });

  it('missing x-tenant-id → 401', async () => {
    const res = GET(makeRequest(undefined, ''));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('limit=50 is reflected in response', async () => {
    const res = GET(makeRequest({ limit: '50' }));
    const body = await parseBody<AuditResponse>(res);
    expect(body.limit).toBe(50);
  });

  it('page=2 is reflected in response', async () => {
    const res = GET(makeRequest({ page: '2' }));
    const body = await parseBody<AuditResponse>(res);
    expect(body.page).toBe(2);
  });
});
