/**
 * FOLLOW-1381 — the digit rule reads a grouped number as ONE number, on both sides.
 *
 * The FOLLOW-1380 comparison (docs/research/MODEL-COMPARE-HAIKU55-SONNET55-2026-10-22.md §3.1)
 * found 13 of 48 outputs refused as `hallucinated_number` although every number in them was the
 * listing's own: the text wrote it with a thousands separator ("949 000 PLN", "1 150 000 zł",
 * "45,000 zł") and the listing without one, or the other way round ("45 000 zł"). The tokeniser
 * split "949 000" into "949" and "000" and grounded neither.
 *
 * The rule now joins a thousands-grouped number before tokenising, in the text AND in the
 * grounding, and reads a comma before one, two or four-plus digits as a decimal comma. Everything
 * else is as strict as before; the negative controls below pin that.
 */
import { describe, expect, it } from 'vitest';
import { checkBodyClaims, checkHeadlineFacts } from '@/lib/grounding-check';

const NBSP = '\u00a0';
const NNBSP = '\u202f';
const THIN = '\u2009';

describe('FOLLOW-1381 — a grouped rendering of a grounded number is grounded', () => {
  // The study's refusal pattern: text grouped, listing ungrouped (and the reverse).
  it.each([
    ['949 000 PLN', 'Cena: 949000 PLN.'],
    [`949${NBSP}000 PLN`, 'Cena: 949000 PLN.'],
    [`949${NNBSP}000 PLN`, 'Cena: 949000 PLN.'],
    [`949${THIN}000 PLN`, 'Cena: 949000 PLN.'],
    ['949,000 PLN', 'Cena: 949000 PLN.'],
    ['949.000 PLN', 'Cena: 949000 PLN.'],
    ['1 150 000 zł', 'Cena 1150000 zł.'],
    ['1.150.000 €', 'Precio 1150000 €.'],
    ['1,150,000 EUR', 'Price 1 150 000 EUR.'],
    ['45,000 zł', 'Czynsz 45 000 zł rocznie.'],
    ['45 000 zł', 'Rent 45,000 zł a year.'],
    ['189 000 EUR', 'Price 189000 EUR'],
    ['189000 EUR', 'Precio 189.000 EUR'],
    [`189${NBSP}000 EUR`, `Price 189${NNBSP}000 EUR`],
    ['1 150 000,50 zł', 'Kwota 1150000.50 zł'],
  ])('body %j is grounded by %j', (text, original) => {
    expect(checkBodyClaims(`Mieszkanie za ${text}.`, original, {})).toBeNull();
  });

  it('a grouped number is grounded by the listing field that states it ungrouped', () => {
    expect(
      checkBodyClaims('Cena 949 000 PLN za trzy pokoje.', 'Trzy pokoje.', {
        listing_price: '949000 PLN',
      }),
    ).toBeNull();
  });

  it('the headline check reads the same grouped number the same way', () => {
    // The first word is checked as a capitalised word too, so it is one the listing uses.
    expect(
      checkHeadlineFacts('Cena 949 000 PLN za mieszkanie', 'Cena: 949000 PLN.', {}),
    ).toBeNull();
    expect(
      checkHeadlineFacts('Apartment for 949,000 PLN', 'Apartment, 949 000 PLN.', {}),
    ).toBeNull();
  });

  it('an area with a grouped number is grounded by the area field (unit rule)', () => {
    expect(checkBodyClaims('A plot of 1 200 m².', 'A plot.', { plot_area: '1200' })).toBeNull();
    expect(checkBodyClaims('A plot of 1200 m².', 'A plot of 1 200 m².', {})).toBeNull();
  });
});

describe('FOLLOW-1381 — negative controls: nothing else is loosened', () => {
  it('a different grouped number is still refused', () => {
    expect(checkBodyClaims('Cena 950 000 PLN.', 'Cena: 949000 PLN.', {})).toBe(
      'hallucinated_number',
    );
    expect(checkBodyClaims('Price 949,500 PLN.', 'Cena: 949000 PLN.', {})).toBe(
      'hallucinated_number',
    );
    expect(checkHeadlineFacts('Cena 950 000 PLN za mieszkanie', 'Cena: 949000 PLN.', {})).toBe(
      'hallucinated_number',
    );
  });

  it('a part of a grounded number is not grounded by it', () => {
    expect(checkBodyClaims('Only 949 PLN.', 'Cena: 949000 PLN.', {})).toBe('hallucinated_number');
    // Stricter than before: a grouped grounding no longer grounds its own groups.
    expect(checkBodyClaims('Only 949 PLN.', 'Cena: 949 000 PLN.', {})).toBe('hallucinated_number');
    expect(checkBodyClaims('Only 150 zł.', 'Cena 1 150 000 zł.', {})).toBe('hallucinated_number');
  });

  it('a group that is not three digits is not a thousands group', () => {
    expect(checkBodyClaims('Cena 94 90 PLN.', 'Cena: 9490 PLN.', {})).toBe('hallucinated_number');
    expect(checkBodyClaims('Cena 9490 PLN.', 'Cena: 9 4900 PLN.', {})).toBe('hallucinated_number');
  });

  it('separators must be the same within one number', () => {
    expect(checkBodyClaims('Cena 1 150,000 zł.', 'Cena 1150000 zł.', {})).toBe(
      'hallucinated_number',
    );
  });

  it('decimals keep working, and a decimal comma equals a decimal point', () => {
    expect(checkBodyClaims('Plaża 3,5 km.', 'Plaża 3,5 km.', {})).toBeNull();
    expect(checkBodyClaims('Beach 3.5 km.', 'Beach 3.5 km.', {})).toBeNull();
    expect(checkBodyClaims('Plaża 3,5 km.', 'Beach 3.5 km.', {})).toBeNull();
    expect(checkBodyClaims('Beach 3.5 km.', 'Plaża 3,5 km.', {})).toBeNull();
    expect(checkBodyClaims('Yield 6,25%.', 'Yield 6.25%.', {})).toBeNull();
    // A decimal is not its digits run together (it was: "3,5" canonicalised to "35").
    expect(checkBodyClaims('Beach 35 km.', 'Plaża 3,5 km.', {})).toBe('hallucinated_number');
    expect(checkBodyClaims('Plaża 3,5 km.', 'Beach 35 km.', {})).toBe('hallucinated_number');
    expect(checkBodyClaims('Beach 3.6 km.', 'Plaża 3,5 km.', {})).toBe('hallucinated_number');
  });

  it('dates, ranges and plain numbers are unchanged', () => {
    expect(checkBodyClaims('Built 12.05.2024.', 'Built 12.05.2024.', {})).toBeNull();
    expect(checkBodyClaims('Built 1205.', 'Built 12.05.2024.', {})).toBe('hallucinated_number');
    expect(checkBodyClaims('3 bedrooms, 2 bathrooms.', '3 bedrooms and 2 bathrooms.', {})).toBe(
      null,
    );
    expect(checkBodyClaims('5 bedrooms', '425000 eur', {})).toBe('hallucinated_number');
    expect(checkBodyClaims('€97,200', '97200 eur', {})).toBeNull();
  });

  it('an area stated with a grouped number that differs is still refused', () => {
    expect(checkBodyClaims('A plot of 1 250 m².', 'A plot.', { plot_area: '1200' })).toBe(
      'hallucinated_number',
    );
  });
});
