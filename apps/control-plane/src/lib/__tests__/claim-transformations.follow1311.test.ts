/**
 * FOLLOW-1311: one allowed and one refused example per transformation, en and pl, es where the
 * recogniser covers it. `checkBodyClaims` is the description path; the adapt path runs the same
 * rules through `callLlmGateway` (`llm-gateway.follow1311.test.ts`).
 *
 * @module apps/control-plane/src/lib/__tests__/claim-transformations.follow1311.test
 */

import { describe, expect, it } from 'vitest';
import { checkBodyClaims, checkHeadlineFacts } from '@/lib/grounding-check';

const EN = {
  original:
    'A three-bedroom, two-bathroom single-family home on a quiet residential street. Attached two-car garage and a mature garden.',
  ctx: {
    listing_title: 'Family home',
    listing_price: '385000 USD',
    listing_location: 'Palm Coast, FL',
  },
};
const PL = {
  original:
    'Trzypokojowe mieszkanie o powierzchni 64 mkw. na cichej ulicy w Krakowie. Otwarty salon, dwie łazienki, balkon. Rok budowy 2015.',
  ctx: {
    listing_title: 'Mieszkanie, ul. Długa 5',
    listing_price: '949000 PLN',
    listing_location: 'Stare Miasto, Kraków',
  },
};
const ES = {
  original: 'Piso de tres dormitorios y dos baños en Valencia. Garaje para dos coches.',
  ctx: { listing_title: 'Piso', listing_price: '240000 EUR', listing_location: 'Valencia' },
};

const body = (l: typeof EN, text: string) => checkBodyClaims(text, l.original, l.ctx);

describe('T3: a number word and its digit, same key', () => {
  it.each([
    [EN, '3 bedrooms and 2 bathrooms'],
    [EN, 'A 2-car garage'],
    [PL, '3 pokoje i 2 łazienki'],
    [ES, '3 dormitorios y 2 baños'],
    [ES, 'Garaje para 2 coches'],
  ])('allowed: %#', (l, text) => {
    expect(body(l, text)).toBeNull();
  });

  it.each([
    [EN, '4 bedrooms'],
    [EN, '3 rooms'],
    [EN, 'A 3-car garage'],
    [PL, '3 sypialnie'],
    [ES, '3 habitaciones y 3 baños'],
  ])('refused, another value or key: %#', (l, text) => {
    expect(body(l, text)).toBe('hallucinated_number');
  });

  it('a count never grounds the same digit elsewhere', () => {
    expect(body(EN, 'A 3% yield and 3 bedrooms')).toBe('hallucinated_number');
  });
});

describe('T5: an area unit of the same family', () => {
  it.each([
    [PL, 'Ma 64 m²'],
    [PL, 'Ma 64 sqm'],
  ])('allowed, the listing says "64 mkw.": %#', (l, text) => {
    expect(body(l, text)).toBeNull();
  });

  it('refused: another area number', () => {
    expect(body(PL, 'Ma 65 m²')).toBe('hallucinated_number');
  });

  it('refused: a number the listing does not state as an area', () => {
    expect(body(PL, 'Ma 2015 m²')).toBe('unit_mismatch');
  });
});

describe('T7: the listing own place in another form (the headline, as before)', () => {
  it.each([
    ['Mieszkanie w Krakowie', 'pl'],
    ['Flat in Cracow', 'en'],
    ['Flat in Krakow', 'en'],
  ] as const)('allowed: %s', (text, locale) => {
    expect(checkHeadlineFacts(text, PL.original, PL.ctx, locale)).toBeNull();
  });

  it.each([
    ['Mieszkanie w Warszawie', 'pl'],
    ['Flat in Warsaw', 'en'],
  ] as const)('refused: %s', (text, locale) => {
    expect(checkHeadlineFacts(text, PL.original, PL.ctx, locale)).toBe('hallucinated_proper_name');
  });
});
