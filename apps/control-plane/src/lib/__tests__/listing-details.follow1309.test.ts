// @vitest-environment node
/**
 * FOLLOW-1309: the listing-details reader goes through the outbound guard (`lib/pinned-fetch.ts`).
 *
 * No network stub: a real `http` server on 127.0.0.1 plays the backend, the fixture
 * listing-details server plays the `:8081` substrate, and the guard runs for real. The global
 * `fetch` is spied only to prove the reader no longer uses it.
 *
 * @module apps/control-plane/src/lib/__tests__/listing-details.follow1309.test
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: mockCapture, captureMessage: vi.fn() }));

import { fetchListingPlaceholderFacts, fetchListingTextFields } from '../listing-details';

const LISTING_ID = '839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c';
const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../../../tests/e2e/follow-819/fixture-listing.html',
);
/** The `:8081` substrate itself (plain ESM outside this tsconfig, hence a path, not a specifier). */
const FIXTURE_SERVER = path.resolve(
  __dirname,
  '../../../../../scripts/dev/fixture-listing-details-server.mjs',
);

let fixture: http.Server;
let fixtureOrigin = '';
let redirector: http.Server;
let redirectorOrigin = '';
let redirectorHits: string[] = [];

beforeAll(async () => {
  const devServer = (await import(/* @vite-ignore */ FIXTURE_SERVER)) as {
    createFixtureListingDetailsServer: (o: { fixturePath: string }) => http.Server;
  };
  fixture = devServer.createFixtureListingDetailsServer({ fixturePath: FIXTURE_PATH });
  await new Promise<void>((resolve) => {
    fixture.listen(0, '127.0.0.1', resolve);
  });
  fixtureOrigin = `http://127.0.0.1:${String((fixture.address() as AddressInfo).port)}`;

  redirector = http.createServer((req, res) => {
    redirectorHits.push(req.url ?? '');
    res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
    res.end();
  });
  await new Promise<void>((resolve) => {
    redirector.listen(0, '127.0.0.1', resolve);
  });
  redirectorOrigin = `http://localhost:${String((redirector.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  for (const s of [fixture, redirector]) {
    await new Promise<void>((resolve) => {
      s.close(() => {
        resolve();
      });
    });
  }
});

beforeEach(() => {
  mockCapture.mockClear();
  redirectorHits = [];
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('ESTALARA_ALLOW_LOOPBACK_BACKEND', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function refusalCaptures(): unknown[] {
  return mockCapture.mock.calls.filter(
    (c) => (c[1] as { tags?: { kind?: string } } | undefined)?.tags?.kind === 'outbound_refused',
  );
}

describe('listing-details through the guard', () => {
  it('refuses a metadata-address backend, says so in Sentry, and never calls the global fetch', async () => {
    vi.stubEnv('ESTALARA_BACKEND_URL', 'http://169.254.169.254');
    const globalFetch = vi.spyOn(globalThis, 'fetch');

    expect(await fetchListingTextFields(LISTING_ID, 'en')).toBeNull();
    expect(await fetchListingPlaceholderFacts(LISTING_ID, 'en')).toBeNull();

    expect(globalFetch).not.toHaveBeenCalled();
    expect(refusalCaptures()).toHaveLength(2);
  });

  it('refuses the loopback substrate when the allowance flag is absent', async () => {
    vi.stubEnv('ESTALARA_BACKEND_URL', fixtureOrigin);

    expect(await fetchListingTextFields(LISTING_ID, 'en')).toBeNull();
    expect(refusalCaptures()).toHaveLength(1);
  });

  it('refuses the loopback substrate on Vercel even with the flag and NODE_ENV=production', async () => {
    vi.stubEnv('ESTALARA_BACKEND_URL', fixtureOrigin);
    vi.stubEnv('ESTALARA_ALLOW_LOOPBACK_BACKEND', '1');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');

    expect(await fetchListingTextFields(LISTING_ID, 'en')).toBeNull();
    expect(refusalCaptures()).toHaveLength(1);
  });

  it('grounds from the :8081 fixture under the allowance — the harness / N3 path', async () => {
    vi.stubEnv('ESTALARA_BACKEND_URL', fixtureOrigin);
    vi.stubEnv('ESTALARA_ALLOW_LOOPBACK_BACKEND', '1');

    const fields = await fetchListingTextFields(LISTING_ID, 'en');

    expect(fields?.title).toBeTruthy();
    expect(fields?.description).toBeTruthy();
    expect(fields?.price).toBe('385000 USD');
    expect(refusalCaptures()).toHaveLength(0);
  });

  it('grounds under CP_MODE=prod too (NODE_ENV=production, off Vercel)', async () => {
    vi.stubEnv('ESTALARA_BACKEND_URL', fixtureOrigin);
    vi.stubEnv('ESTALARA_ALLOW_LOOPBACK_BACKEND', '1');
    vi.stubEnv('NODE_ENV', 'production');

    expect((await fetchListingTextFields(LISTING_ID, 'en'))?.description).toBeTruthy();
  });

  it('a 3xx to the metadata address is not followed; the reader returns null', async () => {
    vi.stubEnv('ESTALARA_BACKEND_URL', redirectorOrigin);
    vi.stubEnv('ESTALARA_ALLOW_LOOPBACK_BACKEND', '1');

    expect(await fetchListingTextFields(LISTING_ID, 'en')).toBeNull();
    expect(redirectorHits).toHaveLength(1);
  });
});
