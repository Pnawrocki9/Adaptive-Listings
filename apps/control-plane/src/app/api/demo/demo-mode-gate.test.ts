// @vitest-environment node
/**
 * FOLLOW-1288 (WP-2.3): every `api/demo/*` handler answers 404 when `DEMO_MODE` is not `1`, before
 * it authenticates, parses or touches a store. With the flag on, the per-route suites next to each
 * handler cover the real behaviour (the test setup runs with `DEMO_MODE=1`).
 *
 * @module apps/control-plane/src/app/api/demo/demo-mode-gate.test
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { requireTenantSessionAccess, resolveTenantAccess } from '@/lib/session-auth';
import { POST as sessionsPOST, GET as sessionsGET } from './sessions/route';
import { POST as revokePOST } from './sessions/[id]/revoke/route';
import { POST as ingestPOST } from './ingest/route';
import { GET as overrideGET, PUT as overridePUT } from './override/route';

vi.mock('@/lib/session-auth', () => ({
  requireTenantSessionAccess: vi.fn(),
  resolveTenantAccess: vi.fn(),
}));

const URL_BASE = 'http://localhost/api/demo';
const req = (path: string, method: string) =>
  new NextRequest(`${URL_BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: '{}' }),
  });

const HANDLERS: readonly [string, () => Promise<Response>][] = [
  ['POST /api/demo/sessions', () => sessionsPOST(req('/sessions', 'POST'))],
  ['GET /api/demo/sessions', () => sessionsGET(req('/sessions', 'GET'))],
  [
    'POST /api/demo/sessions/[id]/revoke',
    () =>
      revokePOST(req('/sessions/x/revoke', 'POST'), {
        params: Promise.resolve({ id: 'x' }),
      }),
  ],
  ['POST /api/demo/ingest', () => ingestPOST(req('/ingest', 'POST'))],
  ['GET /api/demo/override', () => overrideGET(req('/override', 'GET'))],
  ['PUT /api/demo/override', () => overridePUT(req('/override', 'PUT'))],
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe.each([[''], ['true']])('api/demo/* with DEMO_MODE=%j', (value) => {
  it.each(HANDLERS)('%s → 404 not_found, no auth attempted', async (_name, call) => {
    vi.stubEnv('DEMO_MODE', value);
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(requireTenantSessionAccess).not.toHaveBeenCalled();
    expect(resolveTenantAccess).not.toHaveBeenCalled();
  });
});

describe('api/demo/* with DEMO_MODE=1', () => {
  it('POST /api/demo/ingest is served (the gate lets it through)', async () => {
    vi.stubEnv('DEMO_MODE', '1');
    const res = await ingestPOST(req('/ingest', 'POST'));
    expect(res.status).toBe(200);
  });
});
