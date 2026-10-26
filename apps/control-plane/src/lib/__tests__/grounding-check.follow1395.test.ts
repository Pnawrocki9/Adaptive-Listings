/**
 * FOLLOW-1395 — a Polish headline may inflect the listing's own place name.
 *
 * Haiku 5.5 wrote "Dwupokojowe mieszkanie 64 m² na Podgórzu w Krakowie" and "Studio w
 * Albufeirze" (FOLLOW-1383 live run); the facts say "Kraków"/"Krakow", "Podgórze"/"Podgorze",
 * "Albufeira", so the proper-name rule refused the listing's own names. On a Polish page a
 * capitalised headline word is now accepted when it is a Polish case form of a capitalised word of
 * the listing under a small closed set of endings (`POLISH_CASE_ENDINGS`). An invented name is
 * still refused, and other locales are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { checkHeadlineFacts } from '@/lib/grounding-check';

const KRK = {
  original: 'Bright two-bedroom apartment of 64 sqm in Krakow, Podgorze district.',
  ctx: {
    listing_title: 'Two-bedroom apartment, Krakow Podgorze — 64 sqm',
    listing_price: '949000 PLN',
    listing_location: 'Krakow, Podgorze',
  },
};
const ALB = {
  original: 'Studio apartment, 32 sqm, second floor, Albufeira. Furnished. Shared pool.',
  ctx: { listing_location: 'Albufeira, Faro' },
};
const PL = {
  original:
    'Mieszkanie w Krakowie? Nie: dom wolnostojący w Straszynie pod Gdańskiem, Kraków, Warszawa, Podgórze, Mokotów, Praga.',
  ctx: { listing_location: 'Kraków, Gdańsk, Warszawa, Podgórze, Mokotów, Praga, Straszyn' },
};

describe('FOLLOW-1395 — inflected Polish place names', () => {
  it.each([
    ['Dwupokojowe mieszkanie 64 m² na Podgórzu w Krakowie', KRK],
    ['Dwupokojowe mieszkanie 64 m² w Krakowie, Podgórze', KRK],
    ['Studio w Albufeirze, 32 m², wspólny basen', ALB],
    ['Mieszkanie w Albufeirze', ALB],
    ['Dom pod Gdańskiem', PL],
    ['Dom w Gdańsku', PL],
    ['Mieszkanie na Mokotowie', PL],
    ['Mieszkanie w Warszawie', PL],
    ['Mieszkanie w Pradze', PL],
    ['Dom w Straszynie', PL],
  ])('%j is grounded on a Polish page', (headline, l) => {
    expect(checkHeadlineFacts(headline, l.original, l.ctx, 'pl')).toBeNull();
  });

  it.each([
    ['Mieszkanie w Poznaniu', KRK],
    ['Mieszkanie w Krakowiaku', KRK],
    ['Studio w Lagosie, 32 m²', ALB],
    ['Mieszkanie w Wrocławiu', PL],
    ['Dom w Gdyni', PL],
  ])('%j (an invented name) is still refused', (headline, l) => {
    expect(checkHeadlineFacts(headline, l.original, l.ctx, 'pl')).toBe('hallucinated_proper_name');
  });

  it('the case rules are Polish only: an English or Spanish page is unchanged', () => {
    expect(checkHeadlineFacts('Studio in Albufeirze', ALB.original, ALB.ctx, 'en')).toBe(
      'hallucinated_proper_name',
    );
    expect(checkHeadlineFacts('Estudio en Albufeirze', ALB.original, ALB.ctx, 'es')).toBe(
      'hallucinated_proper_name',
    );
  });
});
