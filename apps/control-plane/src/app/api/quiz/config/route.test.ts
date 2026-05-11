import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { GET, POST } from './route';

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

function makeGetRequest(tenantId?: string): NextRequest {
  return new NextRequest('http://localhost/api/quiz/config', {
    headers: tenantId ? { 'x-tenant-id': tenantId } : {},
  });
}

function makePostRequest(body: unknown, tenantId?: string): NextRequest {
  return new NextRequest('http://localhost/api/quiz/config', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  // Each test runs with a fresh tenant ID — no cross-test state leakage
});

describe('GET /api/quiz/config', () => {
  it('returns default config when no config has been saved', () => {
    const res = GET(makeGetRequest('tenant-fresh-001'));
    expect(res.status).toBe(200);
  });

  it('default config has expected shape', async () => {
    const res = GET(makeGetRequest('tenant-fresh-002'));
    const body = await parseBody<{
      enabled: boolean;
      trigger_after_n_listings: number;
      language: string;
    }>(res);
    expect(body.enabled).toBe(false);
    expect(body.trigger_after_n_listings).toBe(3);
    expect(body.language).toBe('en');
  });
});

describe('POST /api/quiz/config', () => {
  it('returns 401 when x-tenant-id header is missing', async () => {
    const res = await POST(makePostRequest({ enabled: true }));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toContain('x-tenant-id');
  });

  it('updates config fields and returns updated config', async () => {
    const res = await POST(
      makePostRequest(
        { enabled: true, language: 'pl', trigger_after_n_listings: 5 },
        'tenant-upd-001',
      ),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<{
      enabled: boolean;
      language: string;
      trigger_after_n_listings: number;
    }>(res);
    expect(body.enabled).toBe(true);
    expect(body.language).toBe('pl');
    expect(body.trigger_after_n_listings).toBe(5);
  });

  it('returns 400 when enabled is not a boolean', async () => {
    const res = await POST(makePostRequest({ enabled: 'yes' }, 'tenant-inv-001'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when trigger_after_n_listings is out of range', async () => {
    const res = await POST(makePostRequest({ trigger_after_n_listings: 99 }, 'tenant-inv-002'));
    expect(res.status).toBe(400);
  });

  it('partial update preserves unset fields', async () => {
    // First set a full config
    await POST(
      makePostRequest(
        { enabled: true, language: 'pl', trigger_after_n_listings: 7, sticky_widget: true },
        'tenant-partial-001',
      ),
    );
    // Then update only enabled
    const res = await POST(makePostRequest({ enabled: false }, 'tenant-partial-001'));
    const body = await parseBody<{
      enabled: boolean;
      language: string;
      trigger_after_n_listings: number;
    }>(res);
    expect(body.enabled).toBe(false);
    expect(body.language).toBe('pl');
    expect(body.trigger_after_n_listings).toBe(7);
  });
});
