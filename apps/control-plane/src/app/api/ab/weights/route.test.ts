/**
 * Tests for GET /api/ab/weights
 *
 * @module apps/control-plane/src/app/api/ab/weights/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import type { AbWeightsResponse } from './route.js';
import { GET } from './route.js';

function makeRequest(params: Record<string, string> = {}, tenantId?: string): NextRequest {
  const url = new URL('http://localhost/api/ab/weights');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (tenantId) headers['x-tenant-id'] = tenantId;
  return new NextRequest(url.toString(), { headers });
}

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('GET /api/ab/weights', () => {
  it('returns 401 when x-tenant-id is missing', () => {
    const res = GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 200 with valid tenant', () => {
    const res = GET(makeRequest({}, TENANT_ID));
    expect(res.status).toBe(200);
  });

  it('response includes tenant_id, rows, total, generated_at', async () => {
    const res = GET(makeRequest({}, TENANT_ID));
    const body = (await res.json()) as AbWeightsResponse;
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(typeof body.generated_at).toBe('string');
  });

  it('rows contain required BanditWeightRow fields', async () => {
    const res = GET(makeRequest({}, TENANT_ID));
    const body = (await res.json()) as AbWeightsResponse;
    expect(body.rows.length).toBeGreaterThan(0);

    const row = body.rows[0]!;
    expect(row.tenant_id).toBe(TENANT_ID);
    expect(typeof row.archetype).toBe('string');
    expect(typeof row.variant).toBe('string');
    expect(typeof row.alpha).toBe('number');
    expect(typeof row.beta).toBe('number');
    expect(typeof row.estimated_rate).toBe('number');
    expect(typeof row.paused).toBe('boolean');
    expect(typeof row.updated_at).toBe('string');
  });

  it('estimated_rate is alpha / (alpha + beta)', async () => {
    const res = GET(makeRequest({}, TENANT_ID));
    const body = (await res.json()) as AbWeightsResponse;
    for (const row of body.rows) {
      const expected = row.alpha / (row.alpha + row.beta);
      expect(Math.abs(row.estimated_rate - expected)).toBeLessThan(0.001);
    }
  });

  it('filters by archetype query param', async () => {
    const res = GET(makeRequest({ archetype: 'investor' }, TENANT_ID));
    const body = (await res.json()) as AbWeightsResponse;
    for (const row of body.rows) {
      expect(row.archetype).toBe('investor');
    }
  });

  it('returns deterministic results for same tenant', async () => {
    const res1 = GET(makeRequest({}, TENANT_ID));
    const res2 = GET(makeRequest({}, TENANT_ID));
    const body1 = (await res1.json()) as AbWeightsResponse;
    const body2 = (await res2.json()) as AbWeightsResponse;
    // rows should be identical (mock data is deterministic) except generated_at
    expect(body1.rows.map((r) => r.alpha)).toEqual(body2.rows.map((r) => r.alpha));
    expect(body1.rows.map((r) => r.beta)).toEqual(body2.rows.map((r) => r.beta));
    expect(body1.rows.map((r) => r.paused)).toEqual(body2.rows.map((r) => r.paused));
  });

  it('total matches rows.length', async () => {
    const res = GET(makeRequest({}, TENANT_ID));
    const body = (await res.json()) as AbWeightsResponse;
    expect(body.total).toBe(body.rows.length);
  });
});
