/**
 * Tests for GET /api/analytics
 * Handler is called directly — no HTTP server needed.
 */

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { GET } from './route';
import type { AnalyticsResponse } from './route';

// Helper: parse a Response body with an explicit type (avoids TS18046 unknown).
async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

function makeRequest(params?: Record<string, string>, tenantId = TENANT_ID): NextRequest {
  const url = new URL('http://localhost/api/analytics');
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return new NextRequest(url, {
    headers: tenantId ? { 'x-tenant-id': tenantId } : {},
  });
}

describe('GET /api/analytics', () => {
  it('valid x-tenant-id → 200 with correct shape', async () => {
    const res = GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<AnalyticsResponse>(res);
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.period).toBe('30d');
    expect(typeof body.summary.total_sessions).toBe('number');
    expect(typeof body.summary.adaptation_rate).toBe('number');
    expect(typeof body.summary.top_archetype).toBe('string');
    expect(Array.isArray(body.archetypes)).toBe(true);
    expect(Array.isArray(body.daily)).toBe(true);
    expect(typeof body.generated_at).toBe('string');
  });

  it('period=7d → daily array has 7 entries', async () => {
    const res = GET(makeRequest({ period: '7d' }));
    expect(res.status).toBe(200);
    const body = await parseBody<AnalyticsResponse>(res);
    expect(body.period).toBe('7d');
    expect(body.daily).toHaveLength(7);
  });

  it('period=90d → daily array has 90 entries', async () => {
    const res = GET(makeRequest({ period: '90d' }));
    expect(res.status).toBe(200);
    const body = await parseBody<AnalyticsResponse>(res);
    expect(body.period).toBe('90d');
    expect(body.daily).toHaveLength(90);
  });

  it('missing x-tenant-id → 401', async () => {
    const res = GET(makeRequest(undefined, ''));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('invalid period → defaults to 30d', async () => {
    const res = GET(makeRequest({ period: 'invalid' }));
    expect(res.status).toBe(200);
    const body = await parseBody<AnalyticsResponse>(res);
    expect(body.period).toBe('30d');
    expect(body.daily).toHaveLength(30);
  });
});
