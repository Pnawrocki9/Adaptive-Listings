/**
 * FOLLOW-1140 (b) — unit boundaries of the server-side placeholder resolver.
 *
 * The route-level contract is pinned in `app/api/adapt/route.follow1140.test.ts`. This file
 * covers the edges that are cheaper to state directly than to reach through a request: the
 * fetch-avoidance rules (which are a latency contract, not an optimisation detail), and the
 * per-token judgement calls where "unresolved" is the DELIBERATE answer.
 *
 * @module apps/control-plane/src/lib/placeholder-tokens.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

vi.mock('@/lib/listing-details', () => ({
  fetchListingPlaceholderFacts: vi.fn(),
}));

import { resolvePlaceholderDirectives } from './placeholder-tokens';
import { fetchListingPlaceholderFacts } from '@/lib/listing-details';
import type { TextDirective } from '@estalara/shared';

const mockFetch = vi.mocked(fetchListingPlaceholderFacts);

function directive(slot: string, value: string): TextDirective {
  return { type: 'text', slot, value, archetype: 'yield_hunter', confidence: 0.9 };
}

const FACTS = {
  bedrooms: 3,
  livingArea: 128.5,
  district: 'Alfama',
  city: 'Lisbon',
  publicLocationLabel: 'Alfama, Lisbon',
  highlights: ['Renovated kitchen', 'River views'],
};

describe('resolvePlaceholderDirectives — fetch avoidance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(FACTS);
  });

  it('no token anywhere → returns the directives untouched and never fetches', async () => {
    const input = [directive('headline', 'Buy From Abroad'), directive('cta', 'Book a Viewing')];
    const result = await resolvePlaceholderDirectives(input, 'listing-1', 'en');

    expect(result.directives).toEqual(input);
    expect(result.droppedTokens).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('every token-carrying directive names an unreachable token → drops without fetching', async () => {
    // No listing fact yields a rental yield, so this directive is doomed whatever the backend
    // says. Spending a network hop to learn that is latency bought for nothing — and this path
    // runs on the playbook-DIRECT branch, which otherwise does no I/O at all.
    const result = await resolvePlaceholderDirectives(
      [directive('headline', 'Rental Yield: {yield}% | Gross Income: {income}/yr')],
      'listing-1',
      'en',
    );

    expect(result.directives).toEqual([]);
    expect(result.droppedTokens).toEqual(['income', 'yield']);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('a mixed set fetches once, keeping what resolves and dropping what does not', async () => {
    const result = await resolvePlaceholderDirectives(
      [
        directive('headline', 'Upsize to {bedrooms}BR — {key_feature}'),
        directive('feature', 'Estimated ARV: {arv}'),
        directive('cta', 'Book a Viewing'),
      ],
      'listing-1',
      'en',
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.directives.map((d) => d.value)).toEqual([
      'Upsize to 3BR — Renovated kitchen',
      'Book a Viewing',
    ]);
    expect(result.droppedTokens).toEqual(['arv']);
  });

  it('facts unreadable → every token-carrying directive is dropped, none is guessed', async () => {
    mockFetch.mockResolvedValue(null);

    const result = await resolvePlaceholderDirectives(
      [directive('headline', 'Easy Living — {bedrooms}BR with Lift')],
      'listing-1',
      'en',
    );

    expect(result.directives).toEqual([]);
    expect(result.droppedTokens).toEqual(['bedrooms']);
  });
});

describe('resolvePlaceholderDirectives — per-token judgement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function resolveHeadline(
    value: string,
    facts: Partial<typeof FACTS>,
  ): Promise<string | undefined> {
    mockFetch.mockResolvedValue(facts);
    const result = await resolvePlaceholderDirectives([directive('headline', value)], 'l1', 'en');
    return result.directives[0]?.value;
  }

  it('{sqm} drops a trailing zero but keeps real precision', async () => {
    expect(await resolveHeadline('{sqm}m²', { livingArea: 120 })).toBe('120m²');
    expect(await resolveHeadline('{sqm}m²', { livingArea: 128.5 })).toBe('128.5m²');
  });

  it('a studio (bedrooms 0) is UNRESOLVED, not "0BR"', async () => {
    // 0 is a true number that makes "Easy Living — 0BR with Lift" a false sentence. The tenant's
    // own copy standing is the better outcome than a technically-accurate absurdity.
    expect(await resolveHeadline('Easy Living — {bedrooms}BR', { bedrooms: 0 })).toBeUndefined();
  });

  it('a blank fact is an absent fact, not an empty substitution', async () => {
    expect(await resolveHeadline('Expat Community — {neighborhood}', { district: '   ' })).toBe(
      undefined,
    );
  });

  it('{neighborhood} falls back from district to city', async () => {
    expect(await resolveHeadline('Expat Community — {neighborhood}', { city: 'Lisbon' })).toBe(
      'Expat Community — Lisbon',
    );
  });

  it('{location_highlight} prefers the disclosable label over the raw district', async () => {
    expect(
      await resolveHeadline('Your Holiday Home — {location_highlight}', {
        publicLocationLabel: 'Cascais, Lisbon',
        district: 'Cascais',
      }),
    ).toBe('Your Holiday Home — Cascais, Lisbon');
  });

  it('{key_feature} takes the agent’s first highlight, not a re-ranked one', async () => {
    expect(
      await resolveHeadline('More Space — {key_feature}', {
        highlights: ['Renovated kitchen', 'River views'],
      }),
    ).toBe('More Space — Renovated kitchen');
  });

  it('no highlights → {key_feature} is unresolved', async () => {
    expect(await resolveHeadline('More Space — {key_feature}', { highlights: [] })).toBeUndefined();
  });
});
