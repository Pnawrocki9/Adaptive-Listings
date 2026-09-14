// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason ac1-verdict.test.ts pins this)

/**
 * FOLLOW-1205 + FOLLOW-1206 — the FOLLOW-819 harness's `/api/adapt` preflight probe, driven through
 * the REAL control-plane code, never through typed-in responses.
 *
 * What is real here:
 *   - the REQUEST: `buildControlPlaneProbeRequest()` out of `differentiator-e2e.mjs`, the function
 *     `assertRealControlPlane()` sends to the wire;
 *   - the STATUS and BODY: `POST` imported from `apps/control-plane/src/app/api/adapt/route.ts`,
 *     with `verifyDemoJwt()`, `resolveApiKey()`, `resolveOriginDecision()` and
 *     `AdaptPostBodySchema` all unmocked;
 *   - the `access-control-allow-origin` header: `middleware()` imported from
 *     `apps/control-plane/src/middleware.ts`, unmocked, under both `NODE_ENV` branches;
 *   - the VERDICT: `evaluateControlPlaneProbe()` and `assertRealControlPlane()` out of the harness.
 *
 * What is faked, and why that is the lowest level that still runs the real code (Rule AI amendment 4
 * item 3): `createAdminClient()` from `@estalara/db`, so the key lookup returns the row README §6.3
 * tells the operator to register (`hashed_key = SHA-256(fixture key)`, `allowed_origins` covering
 * the fixture origin), no row, or a Postgres error. Environment variables are the world under test.
 *
 * What only a live `next dev` can show, and was shown (transcript in the FOLLOW-1205 PR body): that
 * Next merges middleware's `NextResponse.next()` headers onto the route's response, including a
 * non-2xx one, and that a caller-set `Origin` from Node's `fetch` reaches middleware. The HTTP
 * adapter below reproduces that merge; it does not prove it.
 *
 * Red-first on the INPUT (Rule AS, Rule AV): every world is ALSO sent the pre-FOLLOW-1205 request
 * (reproduced from `differentiator-e2e.mjs` at `b2221236`) and graded by the pre-FOLLOW-1205
 * evaluator. The real handler answers it `401 invalid_demo_token` in every world, L-1 included, and
 * the old evaluator passed that. That column is executed on every run, not pasted.
 *
 * Collected by `tests/e2e/vitest.config.ts` (`**\/*.test.ts`); run by `pnpm e2e:smoke`, which
 * `.github/workflows/e2e-smoke.yml` executes nightly. It needs no substrate and takes no flag.
 *
 * @module tests/e2e/follow-819/control-plane-probe.test
 */

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/** The fixture's `data-tenant-id` (`fixture-listing.html`) and the seeded local tenant. */
const FIXTURE_TENANT_ID = '00000000-0000-0000-0000-0000000000e2';
/** What README §6.3 and `seed-local-tenant.mts` register for the fixture origins. */
const SEEDED_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'];
const LISTING_URL = 'http://localhost:5173/fixture-listing.html';
const LISTING_ORIGIN = 'http://localhost:5173';
/** Any non-empty value; the handler checks presence, never content, before a JWT parse. */
const DEMO_SECRET_SET = 'probe-secret.'.repeat(4);

const fakeDb = vi.hoisted(() => ({
  mode: 'registered',
  keyHash: '',
  keyOrigins: [] as string[],
  tenantId: '',
}));

vi.mock('@estalara/db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@estalara/db');
  return {
    ...actual,
    createAdminClient: () => {
      let table: unknown = null;
      const query = {
        select: () => query,
        from: (t: unknown) => {
          table = t;
          return query;
        },
        where: () => query,
        // Rejects rather than throws: drizzle surfaces a Postgres failure when the query is awaited.
        limit: (): Promise<unknown[]> => {
          if (fakeDb.mode === 'throws') {
            return Promise.reject(new Error('PostgresError: sorry, too many clients already'));
          }
          if (table === actual.apiKeys) {
            const row = {
              tenantId: fakeDb.tenantId,
              hashedKey: fakeDb.keyHash,
              keyOrigins: fakeDb.keyOrigins,
            };
            return Promise.resolve(fakeDb.mode === 'registered' ? [row] : []);
          }
          if (table === actual.tenants) {
            return Promise.resolve([{ allowedOrigins: fakeDb.keyOrigins }]);
          }
          return Promise.reject(
            new Error('control-plane-probe.test: query against an unexpected table'),
          );
        },
      };
      return query;
    },
  };
});

interface ProbeRequest {
  url: string;
  listingOrigin: string;
  credentialClass: string;
  init: { method: string; headers: Record<string, string>; body: string };
}
interface Probe {
  status: number | null;
  bodyText: string | null;
  allowOrigin: string | null;
  networkError: string | null;
}
interface ProbeVerdict {
  ok: boolean;
  failureClass: string | null;
  bodyCode: string | null;
  reason: string;
}
interface Harness {
  buildControlPlaneProbeRequest: (input: {
    decisionOrigin: string;
    listingUrl: string;
    apiKey: string;
  }) => ProbeRequest;
  evaluateControlPlaneProbe: (probe: Probe, listingOrigin: string) => ProbeVerdict;
  assertRealControlPlane: () => Promise<{
    credentialClass: string;
    listingOrigin: string;
    status: number | null;
    bodyCode: string | null;
    allowOrigin: string | null;
    reason: string;
  }>;
  readFixtureApiKey: () => Promise<string>;
}
type Handler = (req: unknown) => Promise<Response>;

let harness: Harness;
let POST: Handler;
let middleware: Handler;
let NextRequestCtor: new (url: string, init: Record<string, unknown>) => unknown;
let fixtureKey: string;
let server: Server;
const savedEnv = {
  DECISION_ORIGIN: process.env.DECISION_ORIGIN,
  LISTING_URL: process.env.LISTING_URL,
};

/** Send one request to the real middleware and the real handler, as Next would. */
async function serve(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
): Promise<{ status: number; bodyText: string; allowOrigin: string | null }> {
  const mw = await middleware(new NextRequestCtor(url, init));
  const res = await POST(new NextRequestCtor(url, init));
  return {
    status: res.status,
    bodyText: await res.text(),
    allowOrigin: mw.headers.get('access-control-allow-origin'),
  };
}

beforeAll(async () => {
  // An HTTP adapter in front of the real code, so `assertRealControlPlane()` itself is exercised
  // over a socket, with the request it builds and the headers it reads back.
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const url = `http://localhost:3000${req.url ?? '/'}`;
        if (req.method !== 'POST' || new URL(url).pathname !== '/api/adapt') {
          res.writeHead(404).end('Not Found');
          return;
        }
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
        const out = await serve(url, {
          method: 'POST',
          headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(out.status, {
          'content-type': 'application/json',
          ...(out.allowOrigin ? { 'access-control-allow-origin': out.allowOrigin } : {}),
        });
        res.end(out.bodyText);
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  // The harness reads these once, at import.
  process.env.DECISION_ORIGIN = `http://127.0.0.1:${String(port)}`;
  process.env.LISTING_URL = LISTING_URL;
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  harness = (await import('./differentiator-e2e.mjs')) as Harness;

  const requireFromControlPlane = createRequire(
    new URL('../../../apps/control-plane/package.json', import.meta.url),
  );
  NextRequestCtor = requireFromControlPlane('next/server').NextRequest;
  POST = (await import('../../../apps/control-plane/src/app/api/adapt/route')).POST as Handler;
  middleware = (await import('../../../apps/control-plane/src/middleware')).middleware as Handler;

  fixtureKey = await harness.readFixtureApiKey();
  fakeDb.keyHash = createHash('sha256').update(fixtureKey, 'utf8').digest('hex');
  fakeDb.tenantId = FIXTURE_TENANT_ID;
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  process.env.DECISION_ORIGIN = savedEnv.DECISION_ORIGIN;
  process.env.LISTING_URL = savedEnv.LISTING_URL;
});

interface World {
  name: string;
  secret: string;
  db: 'registered' | 'unregistered' | 'throws' | 'unset';
  nodeEnv: 'development' | 'production';
  keyOrigins?: string[];
  listingUrl?: string;
}

function enter(world: World): void {
  vi.stubEnv('DEMO_MODE_JWT_SECRET', world.secret);
  vi.stubEnv('DATABASE_URL_ADMIN', world.db === 'unset' ? '' : 'postgresql://probe-test/unused');
  vi.stubEnv('DATABASE_URL_DIRECT', '');
  vi.stubEnv('FIRST_PARTY_TENANT_ID', '');
  vi.stubEnv('NODE_ENV', world.nodeEnv);
  fakeDb.mode = world.db === 'unset' ? 'registered' : world.db;
  fakeDb.keyOrigins = world.keyOrigins ?? SEEDED_ORIGINS;
}

/** `assertRealControlPlane()`'s request at `b2221236`, before FOLLOW-1205. */
const legacyRequest = () => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({}),
});

/** `evaluateControlPlaneProbe()` at `b2221236`, before FOLLOW-1205. */
function legacyProbeOk(p: { status: number; bodyText: string }): boolean {
  if (p.status === 404) return false;
  if (p.status >= 500) return false;
  const non2xx = p.status < 200 || p.status >= 300;
  return !(non2xx && p.bodyText.includes('demo_auth_misconfigured'));
}

interface Row extends World {
  status: number;
  bodyCode: string;
  allowOrigin: string | null;
  ok: boolean;
  failureClass: string | null;
}

const HEALTHY: World = {
  name: 'healthy: secret present, fixture key registered, origin allowed, next dev',
  secret: DEMO_SECRET_SET,
  db: 'registered',
  nodeEnv: 'development',
};

const ROWS: readonly Row[] = [
  {
    ...HEALTHY,
    status: 400,
    bodyCode: 'Validation failed',
    allowOrigin: LISTING_ORIGIN,
    ok: true,
    failureClass: null,
  },
  // L-1, the defect FOLLOW-1205 exists for: README §6.5, Turbo strips the secret.
  {
    ...HEALTHY,
    name: "L-1: DEMO_MODE_JWT_SECRET='' (Turbo-stripped)",
    secret: '',
    status: 500,
    bodyCode: 'demo_auth_misconfigured',
    allowOrigin: LISTING_ORIGIN,
    ok: false,
    failureClass: 'demo_secret_missing',
  },
  {
    ...HEALTHY,
    name: 'fixture key not registered in api_keys (README §6.3)',
    db: 'unregistered',
    status: 401,
    bodyCode: 'invalid_demo_token',
    allowOrigin: LISTING_ORIGIN,
    ok: false,
    failureClass: 'fixture_key_not_authenticated',
  },
  {
    ...HEALTHY,
    name: 'Postgres out of connections (README §6.7)',
    db: 'throws',
    status: 401,
    bodyCode: 'invalid_demo_token',
    allowOrigin: LISTING_ORIGIN,
    ok: false,
    failureClass: 'fixture_key_not_authenticated',
  },
  {
    ...HEALTHY,
    name: 'DATABASE_URL_ADMIN unset',
    db: 'unset',
    status: 401,
    bodyCode: 'invalid_demo_token',
    allowOrigin: LISTING_ORIGIN,
    ok: false,
    failureClass: 'fixture_key_not_authenticated',
  },
  {
    ...HEALTHY,
    name: "key allowed_origins exclude the listing origin (the SDK's request 403s too)",
    keyOrigins: ['http://localhost:3000'],
    status: 403,
    bodyCode: 'forbidden_origin',
    allowOrigin: LISTING_ORIGIN,
    ok: false,
    failureClass: 'origin_refused_by_key_policy',
  },
  // FOLLOW-1206: the branch the regex reader could not see.
  {
    ...HEALTHY,
    name: 'production build (next start, NODE_ENV=production): CORS_PROD_ORIGINS only',
    nodeEnv: 'production',
    status: 400,
    bodyCode: 'Validation failed',
    allowOrigin: null,
    ok: false,
    failureClass: 'cors_origin_not_echoed',
  },
  {
    ...HEALTHY,
    name: 'fixture served on the old :9200 default (README §6.2)',
    listingUrl: 'http://localhost:9200/fixture-listing.html',
    status: 403,
    bodyCode: 'forbidden_origin',
    allowOrigin: null,
    ok: false,
    failureClass: 'origin_refused_by_key_policy',
  },
];

describe('FOLLOW-1205 — the probe, sent to the REAL POST /api/adapt and middleware', () => {
  it.each(ROWS)('$name → $status $bodyCode, ok=$ok', async (row) => {
    enter(row);
    const request = harness.buildControlPlaneProbeRequest({
      decisionOrigin: 'http://localhost:3000',
      listingUrl: row.listingUrl ?? LISTING_URL,
      apiKey: fixtureKey,
    });
    const observed = await serve(request.url, request.init);

    // The consequence the verdict encodes, read off the producer — never typed into the probe.
    expect(observed.status).toBe(row.status);
    expect(JSON.parse(observed.bodyText).error).toBe(row.bodyCode);
    expect(observed.allowOrigin).toBe(row.allowOrigin);

    const verdict = harness.evaluateControlPlaneProbe(
      { ...observed, networkError: null },
      request.listingOrigin,
    );
    expect(verdict.ok).toBe(row.ok);
    expect(verdict.failureClass).toBe(row.failureClass);
    expect(verdict.bodyCode).toBe(row.bodyCode);
  });

  it.each(ROWS)(
    '$name → the PRE-FIX probe reads 401 and passes (red-first on the input)',
    async (row) => {
      enter(row);
      const observed = await serve('http://localhost:3000/api/adapt', legacyRequest());
      expect(observed.status).toBe(401);
      expect(JSON.parse(observed.bodyText).error).toBe('invalid_demo_token');
      expect(legacyProbeOk(observed)).toBe(true);
    },
  );

  it('the L-1 row and the healthy row are indistinguishable to the pre-fix probe, and distinct to the fixed one', async () => {
    const answer = async (world: World, send: 'legacy' | 'fixed') => {
      enter(world);
      const init =
        send === 'legacy'
          ? legacyRequest()
          : harness.buildControlPlaneProbeRequest({
              decisionOrigin: 'http://localhost:3000',
              listingUrl: LISTING_URL,
              apiKey: fixtureKey,
            }).init;
      const o = await serve('http://localhost:3000/api/adapt', init);
      vi.unstubAllEnvs();
      return `${String(o.status)} ${o.bodyText}`;
    };
    const l1: World = { ...HEALTHY, secret: '' };
    expect(await answer(l1, 'legacy')).toBe(await answer(HEALTHY, 'legacy'));
    expect(await answer(l1, 'fixed')).not.toBe(await answer(HEALTHY, 'fixed'));
  });
});

describe('FOLLOW-1205 — assertRealControlPlane() over a socket, with the request it builds', () => {
  it('healthy: returns the observed status, body code, ACAO and credential class (Rule Q am. 1 cl. 5)', async () => {
    enter(HEALTHY);
    const result = await harness.assertRealControlPlane();
    expect(result).toMatchObject({
      status: 400,
      bodyCode: 'Validation failed',
      allowOrigin: LISTING_ORIGIN,
      listingOrigin: LISTING_ORIGIN,
    });
    expect(result.credentialClass).toContain('data-api-key');
    expect(result.reason).toContain('status 400');
  });

  it('L-1: throws, naming the failure class and the observed 500', async () => {
    enter({ ...HEALTHY, secret: '' });
    await expect(harness.assertRealControlPlane()).rejects.toThrow(
      /\[demo_secret_missing\].*status 500, body code demo_auth_misconfigured/,
    );
  });

  it('production build: throws on the unechoed origin even though auth passed', async () => {
    enter({ ...HEALTHY, nodeEnv: 'production' });
    await expect(harness.assertRealControlPlane()).rejects.toThrow(
      /\[cors_origin_not_echoed\].*access-control-allow-origin null/,
    );
  });
});

describe('FOLLOW-1205 — evaluateControlPlaneProbe() on answers the real handler cannot give', () => {
  // Literal rows, labelled as such: no world of the real handler produces these, which is exactly
  // why each one must fail.
  const LITERAL: readonly [name: string, probe: Probe, failureClass: string][] = [
    [
      'no answer (timeout)',
      { status: null, bodyText: null, allowOrigin: null, networkError: 'TimeoutError' },
      'unreachable',
    ],
    [
      '404 (not the decision route)',
      { status: 404, bodyText: 'Not Found', allowOrigin: null, networkError: null },
      'not_the_decision_route',
    ],
    [
      '200 to a {} body (something that accepts anything)',
      {
        status: 200,
        bodyText: '{"directives":[]}',
        allowOrigin: LISTING_ORIGIN,
        networkError: null,
      },
      'unexpected_answer',
    ],
    [
      '502 with a non-JSON body',
      { status: 502, bodyText: '<html>Bad Gateway</html>', allowOrigin: null, networkError: null },
      'server_error',
    ],
    [
      '400 with a different code',
      {
        status: 400,
        bodyText: '{"error":"Invalid JSON body"}',
        allowOrigin: LISTING_ORIGIN,
        networkError: null,
      },
      'unexpected_answer',
    ],
  ];

  it.each(LITERAL.map(([name, probe, failureClass]) => ({ name, probe, failureClass })))(
    '$name → $failureClass',
    ({ probe, failureClass }) => {
      const v = harness.evaluateControlPlaneProbe(probe, LISTING_ORIGIN);
      expect(v.ok).toBe(false);
      expect(v.failureClass).toBe(failureClass);
      expect(v.reason).toContain(`status ${String(probe.status)}`);
    },
  );

  it('buildControlPlaneProbeRequest() refuses an unparseable LISTING_URL rather than probing', () => {
    expect(() =>
      harness.buildControlPlaneProbeRequest({
        decisionOrigin: 'http://localhost:3000',
        listingUrl: 'not-a-url',
        apiKey: 'k',
      }),
    ).toThrow('LISTING_URL is not a parseable URL: not-a-url');
  });
});
