/**
 * GET /api/pilot/cta-lift answers 410 with the successor path (FOLLOW-1289).
 *
 * @module apps/control-plane/src/app/api/pilot/cta-lift/route.test
 */

import { describe, expect, it } from 'vitest';

import { GET } from './route.js';

describe('GET /api/pilot/cta-lift (retired)', () => {
  it('returns 410 Gone naming /api/dashboard/analytics/lift', async () => {
    const res = GET();
    expect(res.status).toBe(410);
    expect(res.headers.get('Link')).toContain('/api/dashboard/analytics/lift');
    const body = (await res.json()) as {
      error: { code: string; message: string; moved_to: string };
    };
    expect(body.error.code).toBe('gone');
    expect(body.error.moved_to).toBe('/api/dashboard/analytics/lift');
  });
});
