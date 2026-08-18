// @vitest-environment jsdom
/**
 * FOLLOW-1027 — the buyer must not read copy written for someone else.
 *
 * The SDK loader is `async` off the host's `onMount`, so it cannot start until after first
 * paint. Measured on the local stack against a listing whose adapted copy was ALREADY
 * generated: original visible at 125ms, adapted applied at 903ms — 778ms of original copy on
 * screen, with no model work in that window. Two changes address it:
 *
 *   1. a host-side cloak that hides the slots until the SDK signals (tested in the browser,
 *      not here — it is an inline `<head>` script in the tenant app);
 *   2. this cache, which re-applies the copy the session already saw for a (listing,
 *      archetype) pair before any network call.
 *
 * @module packages/sdk/src/__tests__/follow-1027
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cacheAppliedCopy,
  cachedCopyToDirectives,
  clearCachedCopy,
  readCachedCopy,
} from '../core/copy-cache.js';

const LISTING = 'listing-uuid-1';
const ARCHETYPE = 'yield_hunter';

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  sessionStorage.clear();
});

describe('FOLLOW-1027 — applied-copy cache', () => {
  it('round-trips the applied text slots', () => {
    cacheAppliedCopy(LISTING, ARCHETYPE, [
      { type: 'text', slot: 'headline', value: 'Strong rental demand' },
      { type: 'text', slot: 'description', value: 'A long-form pitch.' },
    ]);
    expect(readCachedCopy(LISTING, ARCHETYPE)).toEqual({
      headline: 'Strong rental demand',
      description: 'A long-form pitch.',
    });
  });

  it('never caches an empty value — that is the fit gate declining, not copy', () => {
    // ADR-0010: an empty directive means "this archetype does not fit this listing". Caching
    // it would turn a deliberate no-op into a stored instruction to blank the slot next time.
    cacheAppliedCopy(LISTING, ARCHETYPE, [
      { type: 'text', slot: 'headline', value: '   ' },
      { type: 'text', slot: 'description', value: '' },
    ]);
    expect(readCachedCopy(LISTING, ARCHETYPE)).toBeNull();
  });

  it('does not serve one archetype’s copy under another’s key', () => {
    cacheAppliedCopy(LISTING, ARCHETYPE, [
      { type: 'text', slot: 'headline', value: 'Investor copy' },
    ]);
    expect(readCachedCopy(LISTING, 'family_buyer')).toBeNull();
    expect(readCachedCopy('another-listing', ARCHETYPE)).toBeNull();
  });

  it('ignores non-text directives — reorder/class depend on live DOM', () => {
    cacheAppliedCopy(LISTING, ARCHETYPE, [
      { type: 'reorder' },
      { type: 'class' },
      { type: 'text', slot: 'headline', value: 'Kept' },
    ]);
    expect(readCachedCopy(LISTING, ARCHETYPE)).toEqual({ headline: 'Kept' });
  });

  it('rebuilds directives the normal apply path understands', () => {
    const directives = cachedCopyToDirectives({ headline: 'Hi' }, ARCHETYPE);
    expect(directives).toEqual([
      { type: 'text', slot: 'headline', value: 'Hi', archetype: ARCHETYPE, confidence: 1 },
    ]);
  });

  it('bounds how much of the session it can occupy', () => {
    for (let i = 0; i < 20; i++) {
      cacheAppliedCopy(`listing-${String(i)}`, ARCHETYPE, [
        { type: 'text', slot: 'headline', value: `copy ${String(i)}` },
      ]);
    }
    let kept = 0;
    for (let i = 0; i < sessionStorage.length; i++) {
      if (sessionStorage.key(i)?.startsWith('estalara_copy_')) kept++;
    }
    expect(kept).toBeLessThanOrEqual(12);
    // The most recent write always survives eviction.
    expect(readCachedCopy('listing-19', ARCHETYPE)).not.toBeNull();
  });

  it('clearCachedCopy removes every entry and nothing else', () => {
    sessionStorage.setItem('unrelated', 'keep me');
    cacheAppliedCopy(LISTING, ARCHETYPE, [{ type: 'text', slot: 'headline', value: 'x' }]);
    clearCachedCopy();
    expect(readCachedCopy(LISTING, ARCHETYPE)).toBeNull();
    expect(sessionStorage.getItem('unrelated')).toBe('keep me');
  });

  it('survives a corrupted entry without throwing', () => {
    sessionStorage.setItem(`estalara_copy_${LISTING}__${ARCHETYPE}`, '{not json');
    expect(() => readCachedCopy(LISTING, ARCHETYPE)).not.toThrow();
    expect(readCachedCopy(LISTING, ARCHETYPE)).toBeNull();
  });
});
