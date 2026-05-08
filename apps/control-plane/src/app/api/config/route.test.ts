import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { GET, PATCH } from './route';
import type { TenantConfig } from './route';

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

const TENANT_ID = '660e8400-e29b-41d4-a716-446655440001';

function makeGetRequest(tenantId = TENANT_ID): NextRequest {
  return new NextRequest('http://localhost/api/config', {
    headers: tenantId ? { 'x-tenant-id': tenantId } : {},
  });
}

function makePatchRequest(
  body: Record<string, unknown>,
  role = 'agency:admin',
  tenantId = TENANT_ID,
): NextRequest {
  return new NextRequest('http://localhost/api/config', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
      ...(role ? { 'x-agency-role': role } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('GET /api/config', () => {
  it('valid x-tenant-id → 200 with config shape', async () => {
    const res = GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<TenantConfig>(res);
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(typeof body.plan).toBe('string');
    expect(typeof body.brand.primary_color).toBe('string');
    expect(typeof body.quiz.enabled).toBe('boolean');
    expect(Array.isArray(body.sdk.allowed_origins)).toBe(true);
    expect(typeof body.updated_at).toBe('string');
  });

  it('missing x-tenant-id → 401', async () => {
    const res = GET(makeGetRequest(''));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });
});

describe('PATCH /api/config', () => {
  // Use a unique tenant per describe block to avoid state cross-contamination
  const PATCH_TENANT = '770e8400-e29b-41d4-a716-446655440002';

  beforeEach(() => {
    // Reset by GETting fresh config first (no reset needed — Map holds state)
  });

  it('agency:admin role → 200 with updated quiz.enabled', async () => {
    const res = await PATCH(
      makePatchRequest({ quiz: { enabled: true } }, 'agency:admin', PATCH_TENANT),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<TenantConfig>(res);
    expect(body.quiz.enabled).toBe(true);
  });

  it('agency:viewer role → 403', async () => {
    const res = await PATCH(
      makePatchRequest({ quiz: { enabled: true } }, 'agency:viewer', PATCH_TENANT),
    );
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
  });

  it('missing x-tenant-id → 401', async () => {
    const res = await PATCH(makePatchRequest({ quiz: { enabled: true } }, 'agency:admin', ''));
    expect(res.status).toBe(401);
  });
});
