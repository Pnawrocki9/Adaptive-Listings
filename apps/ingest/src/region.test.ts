import { describe, expect, it } from 'vitest';

import { mapCountryToRegion } from './region.js';

describe('mapCountryToRegion', () => {
  it.each([
    ['GB', 'uk'],
    ['gb', 'uk'],
    ['US', 'us'],
    ['CA', 'us'],
    ['MX', 'us'],
    ['AE', 'uae'],
    ['DE', 'eu'],
    ['ES', 'eu'],
    ['PL', 'eu'],
    ['JP', 'eu'],
    ['', 'eu'],
  ])('maps %s → %s', (country, region) => {
    expect(mapCountryToRegion(country)).toBe(region);
  });

  it('treats null / undefined as eu (default region)', () => {
    expect(mapCountryToRegion(null)).toBe('eu');
    expect(mapCountryToRegion(undefined)).toBe('eu');
  });
});
