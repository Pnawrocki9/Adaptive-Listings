/**
 * FOLLOW-1394 — two English amenity misfires, fixed in the shared lexicon (both paths).
 *
 *   1. "the pool of buyers" / "a pool of tenants" / "the demand pool" read as a swimming pool, so a
 *      yield-hunter body was refused `unsupported_amenity` (FOLLOW-1383 live run,
 *      `krk.yield_hunter.en`, `gda.flip_investor.en`). A pool OF people, or a people-noun pool, is
 *      no amenity claim; "a pool of 10 x 5 m" still is.
 *   2. "sea views" was not grounded by the listing's "views of the Montgó mountain and, from the
 *      upper terrace, of the sea" (`jav.*.en`). A views-of-the-sea phrasing now grounds it, in
 *      en / pl / es ("widokiem na góry i morze", "vistas a la montaña y al mar").
 *
 * Negative controls: a private pool with no pool in the facts, and sea views with no sea in the
 * facts, are still refused.
 */
import { describe, expect, it } from 'vitest';
import { checkBodyClaims } from '@/lib/grounding-check';
import { buildClaimGrounding, checkUnsupportedClaims } from '@/lib/claim-containment';

const KRK =
  'Bright two-bedroom apartment of 64 sqm in Krakow, Podgorze. A 7 sqm balcony. The building has a lift and a gated underground garage.';
const JAV =
  'Detached villa in Jávea with a living-dining room opening onto a covered terrace with views of the Montgó mountain and, from the upper terrace, of the sea. Private 10 x 5 m swimming pool.';
const NO_SEA = 'Detached villa in Jávea with a covered terrace with views of the Montgó mountain.';

/** Both paths, the same verdict: the description check and the adapt check. */
function bothPaths(text: string, original: string) {
  return {
    description: checkBodyClaims(text, original, {}),
    adapt: checkUnsupportedClaims(text, buildClaimGrounding({ listing_description: original })),
  };
}

describe('FOLLOW-1394 — a pool of people is not a pool', () => {
  it.each([
    'Two separate bedrooms widen the pool of households that can rent it.',
    'The location widens the pool of finished-product buyers at exit.',
    'A large pool of tenants keeps void risk low.',
    'The demand pool is deep, and the tenant pool is local.',
    'It narrows the buyer pool but simplifies turnover.',
  ])('%j is not an amenity claim', (text) => {
    expect(bothPaths(text, KRK)).toEqual({ description: null, adapt: null });
  });

  it.each([
    'A private pool sits in the garden.',
    'The swimming pool of the complex is shared.',
    'A pool of ten by five metres runs along the terrace.',
    'Pools and a gym are on site.',
  ])('%j is still an amenity claim the listing does not ground', (text) => {
    expect(bothPaths(text, KRK)).toEqual({
      description: 'unsupported_amenity',
      adapt: 'unsupported_amenity',
    });
  });

  it('a listing that only mentions a pool of buyers grounds no swimming pool', () => {
    expect(
      bothPaths('A private pool.', 'A flat that appeals to a wide pool of buyers in Krakow.'),
    ).toEqual({ description: 'unsupported_amenity', adapt: 'unsupported_amenity' });
  });
});

describe('FOLLOW-1394 — views of the sea ground sea views', () => {
  it.each([
    'The upper terrace adds sea views.',
    'The upper terrace has a sea view.',
    'The upper terrace gives views over the sea.',
  ])('%j is grounded by "views of the Montgó mountain and … of the sea"', (text) => {
    expect(bothPaths(text, JAV)).toEqual({ description: null, adapt: null });
  });

  it.each([
    ['Willa z widokiem na góry i morze.', 'Sea views from every room.'],
    ['Villa con vistas a la montaña y al mar.', 'Sea views from every room.'],
    ['Villa with views over the bay.', 'Widok na zatokę z salonu.'],
  ])('the listing %j grounds %j', (original, text) => {
    expect(bothPaths(text, original)).toEqual({ description: null, adapt: null });
  });

  it.each([
    'The upper terrace adds sea views.',
    'Views of the sea from every room.',
    'Z tarasu widok na morze.',
    'Vistas al mar desde la terraza.',
  ])('%j is still refused when the listing has no sea', (text) => {
    expect(bothPaths(text, NO_SEA)).toEqual({
      description: 'unsupported_amenity',
      adapt: 'unsupported_amenity',
    });
  });

  it('a sea in the listing that is not a view does not ground sea views', () => {
    expect(bothPaths('Sea views from the terrace.', 'A flat 200 m from the sea.')).toEqual({
      description: 'unsupported_amenity',
      adapt: 'unsupported_amenity',
    });
  });
});
