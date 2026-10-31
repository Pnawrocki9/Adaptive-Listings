/**
 * FOLLOW-1396 — a headline may name the listing's own place by its exonym or without diacritics.
 *
 * Haiku 5.5 wrote "Two-bedroom flat in Warsaw" for a listing that says "Warszawa" — the main
 * English headline refusal after FOLLOW-1395 (`hallucinated_proper_name`). The headline's proper
 * name rule now also accepts:
 *   1. a name from a CLOSED exonym table (`PLACE_EXONYMS`: Warszawa / Warsaw / Varsovia, Kraków /
 *      Cracow / Cracovia, Sevilla / Seville / Sewilla, Zaragoza / Saragossa, Lisboa / Lisbon /
 *      Lizbona, …) when another name of the same place is in the listing;
 *   2. the listing's own name with its diacritics folded ("Krakow" for "Kraków", "Lodz" for
 *      "Łódź", "Javea" for "Jávea") — the same letters, nothing more.
 * On a Polish page the inflected exonym counts too ("w Warszawie" for a listing that says
 * "Warsaw"). An invented place, or an exonym of ANOTHER place, is still refused.
 */
import { describe, expect, it } from 'vitest';
import { checkHeadlineFacts } from '@/lib/grounding-check';

const WAW = {
  original: 'Dwupokojowe mieszkanie 48 m² na Mokotowie, Warszawa. Balkon, piwnica.',
  ctx: { listing_location: 'Warszawa, Mokotów' },
};
const WAW_EN = {
  original: 'Two-bedroom flat of 48 sqm in Mokotow, Warsaw. Balcony.',
  ctx: { listing_location: 'Warsaw' },
};
const KRK = {
  original: 'Mieszkanie 64 m² w Krakowie, Podgórze.',
  ctx: { listing_location: 'Kraków, Podgórze' },
};
const LDZ = { original: 'Loft w Łodzi, 70 m².', ctx: { listing_location: 'Łódź' } };
const SVQ = {
  original: 'Piso de tres dormitorios en Sevilla, barrio de Triana.',
  ctx: { listing_location: 'Sevilla' },
};
const ZAZ = { original: 'Ático en Zaragoza con terraza.', ctx: { listing_location: 'Zaragoza' } };
const LIS = { original: 'Apartamento T2 em Lisboa.', ctx: { listing_location: 'Lisboa' } };
const JAV = { original: 'Villa en Jávea con piscina.', ctx: { listing_location: 'Jávea' } };

describe('FOLLOW-1396 — exonyms and diacritic-free names of the listing’s own place', () => {
  it.each([
    ['en', 'Two-room flat in Warsaw with a balcony', WAW],
    ['en', 'Warsaw flat with a balcony', WAW],
    ['es', 'Piso en Varsovia', WAW],
    ['pl', 'Mieszkanie w Warszawie z balkonem', WAW_EN],
    ['pl', 'Warszawa, Mokotów: mieszkanie z balkonem', WAW_EN],
    ['en', 'Flat in Cracow, Podgórze', KRK],
    ['en', 'Flat in Krakow, Podgorze', KRK],
    ['es', 'Piso en Cracovia', KRK],
    ['en', 'Loft in Lodz', LDZ],
    ['en', 'Three-bedroom flat in Seville, Triana', SVQ],
    ['pl', 'Mieszkanie w Sewilli, Triana', SVQ],
    ['en', 'Penthouse in Saragossa with a terrace', ZAZ],
    ['en', 'Two-bedroom apartment in Lisbon', LIS],
    ['pl', 'Mieszkanie w Lizbonie', LIS],
    ['en', 'Villa in Javea with a pool', JAV],
    ['en', 'Villa in Xàbia with a pool', JAV],
  ] as const)('%s: %j is grounded', (locale, headline, l) => {
    expect(checkHeadlineFacts(headline, l.original, l.ctx, locale)).toBeNull();
  });

  it.each([
    // an exonym of ANOTHER place
    ['en', 'Two-room flat in Cracow', WAW],
    ['en', 'Flat in Seville', ZAZ],
    ['pl', 'Mieszkanie w Krakowie', WAW_EN],
    // an invented place, with or without diacritics
    ['en', 'Two-room flat in Poznan', WAW],
    ['en', 'Flat in Gdansk', KRK],
    ['en', 'Villa in Marbella with a pool', JAV],
    // a country or region the listing does not name
    ['en', 'Flat in Warsaw, Poland', WAW],
    ['en', 'Villa in Javea, Andalusia', JAV],
  ] as const)('%s: %j is still refused', (locale, headline, l) => {
    expect(checkHeadlineFacts(headline, l.original, l.ctx, locale)).toBe(
      'hallucinated_proper_name',
    );
  });
});
