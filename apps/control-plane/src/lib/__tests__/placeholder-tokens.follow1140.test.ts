/**
 * FOLLOW-1140 (b) / ESC-074 — server-side `{token}` resolution, tested where the mechanism
 * still lives.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT A ROUTE TEST ANY MORE. These cases were route tests
 * (`route.follow1140.test.ts`) because ESC-074 is a property of the RESPONSE BODY: playbook copy
 * carries `{token}` placeholders, the SDK discards a whole directive on one unresolved token
 * (FOLLOW-1018), and the ruling was that `/api/adapt` must fill them from the facts it already
 * holds so no unresolved token leaves the server.
 *
 * FOLLOW-1163 / MASTER_DESIGN §E.7.0 removed that observation point. Every surviving `{token}`
 * in every shipped playbook is on a `headline` (RETRO-315, confirmed by extraction), and §E.7.0
 * withholds the headline on both paths that serve template copy — branch 2 and branch 3's
 * fallback. `resolvePlaceholderDirectives` still RUNS on those paths; its output is simply no
 * longer served, so the route can no longer show that a token was filled correctly. It can only
 * show that no token reached the wire, which is now trivially true.
 *
 * **So the coverage moved rather than being deleted.** The resolver is exported and its contract
 * is unchanged, so every behaviour ESC-074 (b) ruled on is asserted here directly, against the
 * REAL playbooks — the defect was always a property of the copy that actually ships, and a mocked
 * slot would prove nothing about it. What the route can still observe stays in
 * `route.follow1163.test.ts` and in the surviving assertions of `route.follow1140.test.ts`.
 *
 * If FOLLOW-1164 puts tokens on a slot that survives the withhold, these cases become
 * route-observable again and should move back.
 *
 * @module apps/control-plane/src/lib/__tests__/placeholder-tokens.follow1140.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { TextDirective } from '@estalara/shared';

import { getAllPlaybooks, getPlaybook } from '@estalara/sdk/playbooks';
import { resolvePlaceholderDirectives } from '@/lib/placeholder-tokens';

const LISTING_ID = 'follow-1140-fixture-listing';

/** A listing-details payload in the shape the Estalara backend returns (`ListingResponseTO`). */
const LISTING_JSON = {
  uuid: '11111111-2222-3333-4444-555555555555',
  headline: 'Sunlit apartment with river views',
  description: 'A calm, well-connected home in the old town.',
  bedrooms: 3,
  livingArea: 128.5,
  district: 'Alfama',
  city: 'Lisbon',
  publicLocationLabel: 'Alfama, Lisbon',
  highlights: ['Renovated kitchen', 'River views'],
  price: 450000,
  currency: 'EUR',
};

/** The playbook's directives for one archetype, exactly as `runDecisionTree` builds them. */
function directivesFor(archetype: string): TextDirective[] {
  return getPlaybook(archetype as Parameters<typeof getPlaybook>[0]).slots.map((s) => ({
    type: 'text' as const,
    slot: s.slot,
    value: s.en,
    archetype: archetype as TextDirective['archetype'],
    confidence: 0.9,
  }));
}

const headlineOf = (directives: TextDirective[]): string | undefined =>
  directives.find((d) => d.slot === 'headline')?.value;

function stubListingBackend(response: Response | (() => Response)): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url.includes('/api/v1/listing/details')) {
        return Promise.resolve(typeof response === 'function' ? response() : response.clone());
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }),
  );
}

describe('resolvePlaceholderDirectives — FOLLOW-1140 (b) / ESC-074', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ESTALARA_BACKEND_URL', 'http://listing-backend.test');
    stubListingBackend(
      () =>
        new Response(JSON.stringify(LISTING_JSON), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const resolve = (archetype: string, listingId: string | undefined = LISTING_ID) =>
    resolvePlaceholderDirectives(directivesFor(archetype), listingId, 'en');

  // Enumerated from the registry rather than a literal list, so a 19th archetype is covered the
  // day it ships (Rule AC). The floor guards the guard: an empty registry would pass vacuously.
  it('no directive keeps an unresolved {token}, for EVERY archetype (ESC-075)', async () => {
    const archetypes = [...getAllPlaybooks().keys()];
    expect(archetypes.length).toBeGreaterThanOrEqual(18);

    for (const archetype of archetypes) {
      const { directives, droppedTokens } = await resolve(archetype);
      const withBraces = directives.filter((d) => /\{[a-z][a-z0-9_]*\}/i.test(d.value));
      expect(withBraces, `archetype ${archetype} kept an unresolved token`).toEqual([]);
      expect(
        droppedTokens,
        `archetype ${archetype} dropped a directive against a complete listing`,
      ).toEqual([]);
    }
  });

  it('{bedrooms} is filled from the listing bedroom count (downsizer)', async () => {
    const { directives } = await resolve('downsizer');
    expect(headlineOf(directives)).toBe('Easy Living — 3BR with Lift & No Garden Maintenance');
  });

  it('{bedrooms} + {key_feature} are both filled in one directive (upsizer)', async () => {
    const { directives } = await resolve('upsizer');
    expect(headlineOf(directives)).toBe('Upsize to 3BR — Renovated kitchen');
  });

  it('{neighborhood} is filled from the listing district (lifestyle_expat)', async () => {
    const { directives } = await resolve('lifestyle_expat');
    expect(headlineOf(directives)).toBe('Expat Community — Alfama | International Schools Nearby');
  });

  it('no listing_id → nothing to resolve FROM, so the token directive is discarded', async () => {
    // ESC-074 reaffirms FOLLOW-1018 rather than relaxing it: partial render stays refused, and
    // nothing is defaulted, estimated or fabricated.
    //
    // Called directly rather than through `resolve()`: passing `undefined` to a parameter with a
    // default binds the DEFAULT, so the helper would have supplied a listing id and the test
    // would have asserted the opposite of its own name.
    const { directives, droppedTokens } = await resolvePlaceholderDirectives(
      directivesFor('downsizer'),
      undefined,
      'en',
    );
    expect(headlineOf(directives)).toBeUndefined();
    expect(droppedTokens).toContain('bedrooms');
  });

  it('listing-details unavailable → discarded, never fabricated', async () => {
    stubListingBackend(() => new Response('', { status: 503 }));
    const { directives, droppedTokens } = await resolve('downsizer');
    expect(headlineOf(directives)).toBeUndefined();
    expect(droppedTokens).toContain('bedrooms');
  });

  it('a listing missing the fact a token needs still DISCARDS that directive, per-directive', async () => {
    // A studio: `bedrooms: 0` resolves for `> 0` only, so the headline drops while every
    // directive that needs no token survives. The drop is per-directive, not per-response.
    stubListingBackend(
      () =>
        new Response(JSON.stringify({ ...LISTING_JSON, bedrooms: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const { directives, droppedTokens } = await resolve('downsizer');
    expect(headlineOf(directives)).toBeUndefined();
    expect(droppedTokens).toContain('bedrooms');
    // The token-free slots are untouched.
    expect(directives.map((d) => d.slot)).toContain('cta');
  });
});
