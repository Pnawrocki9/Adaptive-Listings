/**
 * FOLLOW-1311: one allowed and one refused example per transformation, en and pl, es where the
 * recogniser covers it. `checkBodyClaims` is the description path; the adapt path runs the same
 * rules through `callLlmGateway` (`llm-gateway.follow1311.test.ts`).
 *
 * @module apps/control-plane/src/lib/__tests__/claim-transformations.follow1311.test
 */

import { describe, expect, it } from 'vitest';
import { checkBodyClaims, checkHeadlineFacts } from '@/lib/grounding-check';
import { checkTypedClaims } from '@/lib/typed-claims';

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

const body = (l: { original: string; ctx: Record<string, string> }, text: string) =>
  checkBodyClaims(text, l.original, l.ctx);

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

const BUILT_PL = {
  original: 'Kamienica z 1905 roku w Sopocie. Remont w 2021 roku. Czynsz 610 zł miesięcznie.',
  ctx: { listing_price: '1150000 PLN', listing_location: 'Sopot', living_area: '96 m²' },
};
const BEDROOMS_PL = {
  original: 'Mieszkanie z dwiema sypialniami i salonem w Gdańsku. Bez windy. Ma garaż.',
  ctx: { listing_price: '640000 PLN', listing_location: 'Gdańsk' },
};
const LET_ES = {
  original: 'Piso de cuatro habitaciones con piscina comunitaria en Valencia.',
  ctx: { listing_price: '240000 EUR', listing_location: 'Valencia', rent: '900 EUR' },
};
const ZIP_EN = {
  original:
    'A three-bedroom, two-bathroom home with a garage and a garden. 120 m² on a quiet street.',
  ctx: {
    listing_title: '9 Blackberry Pl, Palm Coast, FL 32137 — 3 bed, 2 bath',
    listing_price: '385000 USD',
    listing_location: 'Palm Coast, FL',
  },
};

describe('T1: the same value and unit, reformatted', () => {
  it.each([
    [ZIP_EN, 'Listed at $385,000'],
    [ZIP_EN, 'Priced at 385 000 USD'],
    [BUILT_PL, 'Cena 1 150 000 zł'],
    [ES, 'Precio 240.000 €'],
  ])('allowed: %#', (l, text) => {
    expect(body(l, text)).toBeNull();
  });

  it.each([
    [ZIP_EN, 'Listed at €385,000', 'another currency'],
    [ZIP_EN, 'Listed at $32,137', 'a number that is no price'],
    [ZIP_EN, 'Rent of $385,000 per month', 'the price as a rent'],
    [BUILT_PL, 'Cena 1 150 000 euro', 'another currency'],
    [ES, 'Precio 240.000 $', 'another currency'],
  ])('refused: %#', (l, text, _why) => {
    expect(body(l, text)).toBe('money_mismatch');
  });
});

describe('T2: an exact multiplier, and no rounding anywhere (CEO 2026-10-30)', () => {
  it.each([
    [ZIP_EN, 'Listed at $385k'],
    [BUILT_PL, 'Cena 1,15 mln zł'],
    [ES, 'Precio 240 mil €'],
  ])('allowed: %#', (l, text) => {
    expect(body(l, text)).toBeNull();
  });

  it.each([
    [ZIP_EN, 'Listed at $390k'],
    [BUILT_PL, 'Cena 1,2 mln zł'],
    [ES, 'Precio 250 mil €'],
  ])('refused: %#', (l, text) => {
    expect(body(l, text)).toBe('hallucinated_number');
  });

  it('a listing price of 1 149 000 is never written as 1,15 mln', () => {
    const l = { original: 'Dom w Sopocie.', ctx: { listing_price: '1149000 PLN' } };
    expect(checkBodyClaims('Cena 1,15 mln zł', l.original, l.ctx)).toBe('hallucinated_number');
  });
});

describe('T3, typed: a count keeps its key and its value', () => {
  it.each([
    [ZIP_EN, 'Three bedrooms, two bathrooms'],
    [ZIP_EN, 'Two bedrooms for the children and one for the parents'],
    [BEDROOMS_PL, 'Dwie sypialnie i salon'],
    [ES, 'Tres dormitorios y dos baños'],
  ])('allowed: %#', (l, text) => {
    expect(body(l, text)).toBeNull();
  });

  it.each([
    [ZIP_EN, 'A five-bedroom home'],
    [ZIP_EN, '3 bathrooms and 2 bedrooms'],
    [ZIP_EN, 'A two-bedroom home'],
    [BEDROOMS_PL, 'Trzy sypialnie i salon'],
    [ES, 'Cinco dormitorios'],
  ])('refused: %#', (l, text) => {
    expect(body(l, text)).toBe('count_mismatch');
  });
});

describe('T4: a year keeps its key', () => {
  it.each([
    [BUILT_PL, 'Budynek z 1905 roku, remont w 2021 roku'],
    [ZIP_EN, 'A lovely home'],
  ])('allowed: %#', (l, text) => {
    expect(body(l, text)).toBeNull();
  });

  it.each([
    [BUILT_PL, 'Wyremontowane w 1905 roku'],
    [BUILT_PL, 'Budynek z 2021 roku'],
    [
      { original: 'Built in 2015, a flat in Lisbon.', ctx: { listing_location: 'Lisbon' } },
      'Renovated in 2015',
    ],
  ])('refused: %#', (l, text) => {
    expect(checkBodyClaims(text, l.original, l.ctx)).toBe('year_mismatch');
  });
});

describe('T5, typed: no unit conversion', () => {
  it.each([
    [BUILT_PL, 'Ma 96 m²'],
    [BUILT_PL, 'Ma 96 mkw.'],
    [BUILT_PL, 'Ma 96 metrów kwadratowych'],
    [
      { original: 'Piso de 80 metros cuadrados.', ctx: { listing_location: 'Valencia' } },
      'Tiene 80 m²',
    ],
  ])('allowed: %#', (l, text) => {
    expect(checkBodyClaims(text, l.original, l.ctx)).toBeNull();
  });

  it.each([
    [ZIP_EN, '120 sq ft of living space'],
    [BUILT_PL, 'Ma 96 stóp kwadratowych'],
    [
      { original: 'Piso de 80 m².', ctx: { listing_location: 'Valencia' } },
      'Tiene 80 pies cuadrados',
    ],
  ])('refused: %#', (l, text) => {
    expect(checkBodyClaims(text, l.original, l.ctx)).toBe('unit_mismatch');
  });

  it('a price written with an area word is refused', () => {
    expect(body(BUILT_PL, 'Ma 610 mkw.')).toBe('unit_mismatch');
  });
});

describe('T6: translation, same key', () => {
  it.each([
    [PL, 'Trzypokojowe mieszkanie'],
    [PL, 'A three-room flat'],
    [BEDROOMS_PL, 'A two-bedroom flat'],
    [BEDROOMS_PL, 'Dwa pokoje to sypialnia dla rodziców i dla dziecka'],
  ])('allowed: %#', (l, text) => {
    expect(body(l, text)).toBeNull();
  });

  it.each([
    [BEDROOMS_PL, 'Dwupokojowe mieszkanie'],
    [BEDROOMS_PL, 'A two-room flat'],
    [ZIP_EN, 'Trzypokojowy dom'],
    [
      { original: 'Mieszkanie dwupokojowe w Gdańsku.', ctx: { listing_location: 'Gdańsk' } },
      'A two-bedroom flat',
    ],
    [
      { original: 'Mieszkanie dwupokojowe w Gdańsku.', ctx: { listing_location: 'Gdańsk' } },
      'Dos dormitorios',
    ],
  ])('refused: %#', (l, text) => {
    expect(checkBodyClaims(text, l.original, l.ctx)).toBe('count_mismatch');
  });
});

describe('T9: negation kept', () => {
  it.each([
    [BEDROOMS_PL, 'Budynek bez windy'],
    [ZIP_EN, 'No parking hassle with the garage'],
    [ZIP_EN, 'The garage means no hunting for parking'],
    [ZIP_EN, 'No pool to maintain'],
  ])('allowed: %#', (l, text) => {
    expect(body(l, text)).toBeNull();
  });

  it.each([
    [ZIP_EN, 'There is no garage here'],
    [ZIP_EN, 'A home without a garden'],
    [BEDROOMS_PL, 'Mieszkanie bez garażu'],
    [LET_ES, 'Un piso sin piscina'],
  ])('refused: %#', (l, text) => {
    expect(body(l, text)).toBe('negation_contradiction');
  });
});

describe('the rulings stand', () => {
  it('ESC-089: family wording is no typed claim', () => {
    for (const text of ['Great for a family with kids', 'Rodzinna okolica dla dzieci']) {
      expect(body(ZIP_EN, text)).toBeNull();
    }
  });

  it('a street address passes: its numbers are not counts, money or years', () => {
    const l = {
      original: 'Mieszkanie przy ul. 3 Maja 12 w Gdyni.',
      ctx: { listing_location: 'ul. 3 Maja 12, Gdynia' },
    };
    expect(checkBodyClaims('Adres: ul. 3 Maja 12, Gdynia', l.original, l.ctx)).toBeNull();
  });
});

describe('the checker AC(1b) calls', () => {
  it('returns each typed claim with the field that grounds it', () => {
    const checks = checkTypedClaims('Three bedrooms, listed at $385,000', [
      { field: 'original_description', text: ZIP_EN.original },
      { field: 'listing_price', text: 'listing price: 385000 USD' },
    ]);
    expect(checks).toEqual([
      expect.objectContaining({
        kind: 'count',
        key: 'bedroom',
        value: '3',
        source: 'original_description',
        violation: null,
      }),
      expect.objectContaining({
        kind: 'money',
        key: 'USD',
        value: '385000',
        source: 'listing_price',
        violation: null,
      }),
    ]);
  });

  it('a refused claim names no source', () => {
    const [check] = checkTypedClaims('Listed at €385,000', [
      { field: 'listing_price', text: 'listing price: 385000 USD' },
    ]);
    expect(check).toEqual(
      expect.objectContaining({ kind: 'money', source: null, violation: 'money_mismatch' }),
    );
  });
});
