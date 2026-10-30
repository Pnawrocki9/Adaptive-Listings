/**
 * FOLLOW-1413 — negation over a coordinated list, both paths (shared lexicon).
 *
 * "Ogłoszenie nie wymienia szkół, przedszkoli ani placów zabaw" negates all three amenities, but
 * the negation window stopped at the comma, so the middle item ("przedszkoli") read as asserted
 * and a correct family body was refused `unsupported_amenity`. The negation now carries through a
 * coordinated list: from a negated item, across "," and the list coordinators and short list
 * items, to the amenity — only when the list's FINAL connector is disjunctive or negative (or /
 * nor, ani / lub / albo / czy, ni / o; PM ruling, fail-closed). "No garage, gym and pool" and a
 * comma-only list do not carry it.
 *
 * Must still refuse: a contrast ("no garage, but a school nearby", "ale", "pero"), a sentence
 * boundary, an item that is not a bare list item ("no garage, a large garden"), and a positive
 * statement after the list ("…, there is a pool").
 */
import { describe, expect, it } from 'vitest';
import { checkBodyClaims } from '@/lib/grounding-check';
import { buildClaimGrounding, checkUnsupportedClaims } from '@/lib/claim-containment';

const KRK =
  'Bright two-bedroom apartment of 64 sqm in Krakow, Podgorze. A 7 sqm balcony. The building has a lift.';

/** Both paths, the same verdict: the description check and the adapt check. */
function bothPaths(text: string, original: string) {
  return {
    description: checkBodyClaims(text, original, {}),
    adapt: checkUnsupportedClaims(text, buildClaimGrounding({ listing_description: original })),
  };
}

const PASS = { description: null, adapt: null };
const REFUSED = { description: 'unsupported_amenity', adapt: 'unsupported_amenity' };

describe('FOLLOW-1413 — a negated list negates every item', () => {
  it.each([
    // pl
    'Ogłoszenie nie wymienia szkół, przedszkoli ani placów zabaw w okolicy.',
    'Nie ma basenu, garażu ani ogrodu.',
    'Opis nie podaje informacji o szkołach, przedszkolach czy placach zabaw.',
    // en
    'The listing names no schools, nurseries or playgrounds nearby.',
    'There is no pool, garage, garden or sauna.',
    'It has no gym, no sauna, and no pool.',
    'Neither a garden nor a garage is included.',
    'No schools, shops, nurseries or playgrounds are named.',
    // es
    'El anuncio no menciona colegios, guarderías ni parques infantiles.',
    'No hay piscina, garaje ni jardín.',
    'Sin piscina, jardín o garaje.',
  ])('%j passes', (text) => {
    expect(bothPaths(text, KRK)).toEqual(PASS);
  });
});

describe('FOLLOW-1413 — negation stops at a contrast, a sentence end or a new statement', () => {
  it.each([
    // contrast
    'No garage, but a school nearby.',
    'No garage, but schools nearby.',
    'There is no garage, however a pool is shared.',
    'Nie ma garażu, ale jest ogród.',
    'Brak garażu, lecz przedszkole jest blisko.',
    'No hay garaje, pero sí piscina.',
    'Sin garaje, pero con jardín.',
    // sentence boundary
    'There is no garage. Schools are close by.',
    'Nie ma garażu. Szkoła jest obok.',
    'No hay garaje. Colegios cerca.',
    // not a bare list item
    'No garage, a large garden.',
    'No garage, a garden.',
    'Nie ma garażu, jest basen.',
    'No garage, there is a pool.',
    'No hay garaje, tiene piscina.',
    // positive amenity before any negator
    'A pool, no garage.',
    // the list's final connector is "and" / "i" / "y" / none: the negation does not carry
    // [FOLLOW-1413, PM ruling, fail-closed]. ("Nie ma basenu i garażu" with no comma is still
    // negated by the older 30-character same-clause window, unchanged here.)
    'No garage, gym and pool included.',
    'There is no garage, garden and pool.',
    'Brak szkół, przedszkoli i placów zabaw w opisie.',
    'Nie ma basenu, garażu oraz ogrodu.',
    'No hay garaje, jardín y piscina.',
    'No garage, pool.',
  ])('%j is still refused', (text) => {
    expect(bothPaths(text, KRK)).toEqual(REFUSED);
  });

  it('a negated list in the LISTING no longer grounds its middle item', () => {
    // Before FOLLOW-1413 the listing's "garażu" after the comma read as asserted and grounded it.
    expect(bothPaths('Private garage.', 'Mieszkanie. Nie ma basenu, garażu ani ogrodu.')).toEqual(
      REFUSED,
    );
    expect(bothPaths('Private garage.', 'No pool, garage or garden.')).toEqual(REFUSED);
    // A list closed by "and" / "i" does not carry the negation: its middle item still grounds.
    expect(bothPaths('Private garage.', 'Nie ma basenu, garażu i ogrodu.')).toEqual(PASS);
  });

  it('a listing that states the amenity still grounds it', () => {
    expect(bothPaths('Close to a nursery.', `${KRK} A nursery is next door.`)).toEqual(PASS);
  });
});
