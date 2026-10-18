/**
 * /admin/tenants is no longer a fleet list (FOLLOW-1329, ESC-085): it must 307 to the Estalara
 * tenant hub so bookmarks and old links keep working.
 *
 * @module apps/control-plane/src/app/admin/tenants/route.test
 */

import { describe, expect, it } from 'vitest';

import { ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';

import { GET } from './route';

describe('GET /admin/tenants — FOLLOW-1329', () => {
  it('307-redirects to the Estalara tenant hub on the same origin', () => {
    const res = GET(new Request('https://admin.example.test/admin/tenants?x=1'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      `https://admin.example.test/admin/tenants/${ESTALARA_TENANT_ID}`,
    );
  });
});
