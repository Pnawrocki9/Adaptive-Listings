// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason ac1-verdict.test.ts and control-plane-probe.test.ts
// pin this)

/**
 * FOLLOW-1225 — the FOLLOW-819 harness's GROUNDING source, driven through the REAL control-plane
 * reader, never through typed-in responses.
 *
 * WHAT THIS CLOSES. Measured 2026-09-20 at `241e762b` (README §5.10, FOLLOW-1185): nothing on
 * localhost serves the fixture listing's facts. `fetchListingJson()`
 * (`apps/control-plane/src/lib/listing-details.ts:71`) resolves
 * `ESTALARA_BACKEND_URL ?? http://localhost:8081`, no bring-up step starts anything there, the
 * control plane logs `[listing-details] fetch failed: fetch failed`, and three layers later the
 * adapted arm reads `source: playbook_fallback_llm_unavailable`,
 * `fallback_reason: listing_context_unavailable` with `outcomes.adapted: 0`. AC(1) — FOLLOW-820
 * condition 1 clause 1 — is structurally unreachable on that substrate.
 *
 * What is real here:
 *   - the SERVER: `createFixtureListingDetailsServer()` out of
 *     `scripts/dev/fixture-listing-details-server.mjs`, on an ephemeral port, serving the SAME
 *     `tests/e2e/follow-819/fixture-listing.html` the harness drives the browser against;
 *   - the READER: `fetchListingTextFields()` / `withListingFacts()` / `hasListingFacts()` imported
 *     from `apps/control-plane/src/lib/*`, unmocked, over a real HTTP hop;
 *   - the PROBE: `buildGroundingProbeRequest()` / `evaluateGroundingProbe()` out of
 *     `differentiator-e2e.mjs`, the functions `assertGroundingSource()` puts on the wire.
 *
 * RED-FIRST (Rule AS / Rule AV). The first `describe` below is the world as it was measured: NO
 * grounding source. It asserts the bug — `hasListingFacts()` false, `groundingMissing` true — and it
 * passed against the pre-FOLLOW-1225 tree, where the rest of this file could not even import
 * (`scripts/dev/fixture-listing-details-server.mjs` did not exist and the harness exported no
 * probe). The transcript of that failing run is in the FOLLOW-1225 PR body.
 *
 * WHAT THIS FILE MUST NEVER BECOME. It must not assert that a fact the fixture page does not
 * publish is served. The fixture listing's facts ARE the fixture page; a grounding source that
 * serves more than the page shows is the prompt injection this harness exists to catch
 * (FOLLOW-1225 scope note, ESC-076 / MASTER_DESIGN §E.7.0). Every field assertion below is checked
 * back against the bytes of `fixture-listing.html`.
 *
 * Collected by `tests/e2e/vitest.config.ts` (`**\/*.test.ts`); run by `pnpm e2e:smoke`, which
 * `.github/workflows/e2e-smoke.yml` executes nightly. It needs no substrate and takes no flag.
 *
 * @module tests/e2e/follow-819/grounding-source.test
 */

import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { hasListingFacts, withListingFacts } from '@/lib/listing-facts-context';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const FIXTURE_PATH = path.join(REPO_ROOT, 'tests/e2e/follow-819/fixture-listing.html');

/** The fixture page's own `data-estalara-listing-id`. */
const FIXTURE_LISTING_ID = '839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c';

/**
 * A port nothing listens on — the measured world. 1 is privileged and unbindable, so this cannot
 * accidentally hit a server a developer happens to be running.
 */
const DEAD_ORIGIN = 'http://127.0.0.1:1';

/**
 * Below `LLM_BRANCH_SIMILARITY_CEILING` (0.85) so `withListingFacts()` actually fetches. Above it
 * the playbook-direct branch never calls the LLM and deliberately never reads the listing.
 */
const LLM_BRANCH_SIMILARITY = 0.7;

/** Collapse HTML whitespace the way the server does, so substring checks are comparable. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The probe's response facts, as `assertGroundingSource()` assembles them from a real fetch. */
interface GroundingProbeFacts {
  status: number | null;
  bodyText: string | null;
  factsSource: string | null;
  networkError: string | null;
}
type BuildGroundingProbeRequest = (input: {
  groundingOrigin: string;
  listingId: string;
  locale?: string;
}) => { url: string; listingId: string; groundingOrigin: string };
type EvaluateGroundingProbe = (
  probe: GroundingProbeFacts,
  listingId: string,
) => {
  ok: boolean;
  failureClass: string | null;
  factsKeys: string[];
  factsSource: string | null;
  reason: string;
};
type CreateFixtureListingDetailsServer = (options: { fixturePath: string }) => Server;

describe('FOLLOW-1225 red-first — the world as measured at 241e762b: no grounding source', () => {
  it('leaves the listing context ungrounded, which is exactly what route.ts turns into groundingMissing', async () => {
    vi.stubEnv('ESTALARA_BACKEND_URL', DEAD_ORIGIN);
    const context = await withListingFacts({}, FIXTURE_LISTING_ID, LLM_BRANCH_SIMILARITY, 'en');
    vi.unstubAllEnvs();

    expect(context).toEqual({});
    expect(hasListingFacts(context)).toBe(false);
    // `route.ts:2008` — the flag the run's `fallback_reason: listing_context_unavailable` came from.
    expect(Boolean(FIXTURE_LISTING_ID) && !hasListingFacts(context)).toBe(true);
  });
});

describe('FOLLOW-1225 — the fixture listing-details server grounds the REAL reader', () => {
  let server: Server;
  let origin: string;
  let fixtureHtml: string;
  let buildGroundingProbeRequest: BuildGroundingProbeRequest;
  let evaluateGroundingProbe: EvaluateGroundingProbe;

  beforeAll(async () => {
    // The harness runs main() at import unless told not to — see the guard at its foot.
    (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
    const harness = (await import('./differentiator-e2e.mjs')) as {
      buildGroundingProbeRequest: BuildGroundingProbeRequest;
      evaluateGroundingProbe: EvaluateGroundingProbe;
    };
    buildGroundingProbeRequest = harness.buildGroundingProbeRequest;
    evaluateGroundingProbe = harness.evaluateGroundingProbe;

    const devServer = (await import('../../../scripts/dev/fixture-listing-details-server.mjs')) as {
      createFixtureListingDetailsServer: CreateFixtureListingDetailsServer;
    };
    fixtureHtml = await readFile(FIXTURE_PATH, 'utf8');
    server = devServer.createFixtureListingDetailsServer({ fixturePath: FIXTURE_PATH });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    delete (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  it('serves the fixture page‘s OWN headline and description, and nothing the page does not publish', async () => {
    const res = await fetch(
      `${origin}/api/v1/listing/details?listing-uuid=${FIXTURE_LISTING_ID}&locale=EN`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-estalara-facts-source')).toContain('fixture-listing.html');

    const listing = (await res.json()) as Record<string, unknown>;
    // Provenance, not a typed-in expectation: every string served must be IN the fixture page.
    expect(collapse(fixtureHtml)).toContain(collapse(String(listing.headline)));
    expect(collapse(fixtureHtml)).toContain(collapse(String(listing.description)));
    expect(listing.uuid).toBe(FIXTURE_LISTING_ID);
    // The page publishes no price and no structured address: the server must not invent them.
    expect(listing.price).toBeUndefined();
    expect(listing.city).toBeUndefined();
    expect(listing.bedrooms).toBeUndefined();
  });

  it('makes hasListingFacts() true through the REAL withListingFacts()', async () => {
    vi.stubEnv('ESTALARA_BACKEND_URL', origin);
    const context = await withListingFacts({}, FIXTURE_LISTING_ID, LLM_BRANCH_SIMILARITY, 'en');
    vi.unstubAllEnvs();

    expect(hasListingFacts(context)).toBe(true);
    expect(Object.keys(context).sort()).toEqual(['listing_description', 'listing_title']);
    expect(collapse(fixtureHtml)).toContain(collapse(context.listing_title));
    expect(collapse(fixtureHtml)).toContain(collapse(context.listing_description));
  });

  it('still does NOT fetch on the playbook-direct branch (similarity above the LLM ceiling)', async () => {
    vi.stubEnv('ESTALARA_BACKEND_URL', origin);
    const context = await withListingFacts({}, FIXTURE_LISTING_ID, 0.99, 'en');
    vi.unstubAllEnvs();
    expect(hasListingFacts(context)).toBe(false);
  });

  it('404s an unknown listing id instead of serving the fixture for it', async () => {
    const res = await fetch(
      `${origin}/api/v1/listing/details?listing-uuid=00000000-0000-4000-8000-000000000000&locale=EN`,
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as Record<string, unknown>).error).toBe('unknown_listing');
  });

  it('404s a locale the fixture page does not publish', async () => {
    const res = await fetch(
      `${origin}/api/v1/listing/details?listing-uuid=${FIXTURE_LISTING_ID}&locale=PL`,
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as Record<string, unknown>).error).toBe('unsupported_locale');
  });

  it('the harness probe accepts this server and names the source', async () => {
    const request = buildGroundingProbeRequest({
      groundingOrigin: origin,
      listingId: FIXTURE_LISTING_ID,
    });
    const res = await fetch(request.url);
    const verdict = evaluateGroundingProbe(
      {
        status: res.status,
        bodyText: await res.text(),
        factsSource: res.headers.get('x-estalara-facts-source'),
        networkError: null,
      },
      FIXTURE_LISTING_ID,
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.factsKeys).toEqual(['listing_title', 'listing_description']);
    expect(verdict.factsSource).toContain('fixture-listing.html');
  });

  it('the harness probe REFUSES every shape of missing grounding, and names which', () => {
    const rows = [
      {
        probe: { status: null, bodyText: null, factsSource: null, networkError: 'fetch failed' },
        failureClass: 'unreachable',
      },
      {
        probe: {
          status: 404,
          bodyText: '{"error":"unknown_listing"}',
          factsSource: null,
          networkError: null,
        },
        failureClass: 'listing_not_served',
      },
      {
        probe: { status: 500, bodyText: 'boom', factsSource: null, networkError: null },
        failureClass: 'upstream_non_ok',
      },
      {
        probe: { status: 200, bodyText: '<html>', factsSource: null, networkError: null },
        failureClass: 'not_json',
      },
      {
        probe: {
          status: 200,
          bodyText: '{"uuid":"839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c"}',
          factsSource: null,
          networkError: null,
        },
        failureClass: 'no_usable_fields',
      },
    ];
    for (const row of rows) {
      const verdict = evaluateGroundingProbe(row.probe, FIXTURE_LISTING_ID);
      expect(verdict.ok, `${row.failureClass}: ${verdict.reason}`).toBe(false);
      expect(verdict.failureClass).toBe(row.failureClass);
    }
  });

  it('the probe URL is the one the control-plane reader builds for the same listing', async () => {
    // Mirror check (the probe copies `fetchListingJson()`'s URL shape): drive the REAL reader at
    // this server and assert the server saw the path the probe sends.
    const seen: string[] = [];
    server.on('request', (req) => {
      seen.push(req.url ?? '');
    });
    vi.stubEnv('ESTALARA_BACKEND_URL', origin);
    await withListingFacts({}, FIXTURE_LISTING_ID, LLM_BRANCH_SIMILARITY, 'en');
    vi.unstubAllEnvs();

    const probeUrl = buildGroundingProbeRequest({
      groundingOrigin: origin,
      listingId: FIXTURE_LISTING_ID,
    }).url;
    expect(seen.at(-1)).toBe(probeUrl.slice(origin.length));
  });
});
