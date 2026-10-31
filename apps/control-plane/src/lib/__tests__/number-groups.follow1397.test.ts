/**
 * FOLLOW-1397 — a number written with a multiplier word is the number it names, on both digit
 * rules.
 *
 * "Cena 1,15 mln PLN" for a listing priced 1150000 was refused `hallucinated_number`: the digit
 * rule read "1,15" as the number 1.15. A number followed by a multiplier — thousand (tys., tysięcy,
 * k, K, thousand, mil), million (mln, M, m attached, million, millones, millón, milion…), billion
 * (mld, miliard…, bn, billion) — is now read as the multiplied value, with a decimal comma or
 * point ("1,15 mln", "1.15M", "€1,15 mln", "850 tys. zł", "850k").
 *
 * A price is always exact (CEO 2026-10-30, "always show the exact price") [FOLLOW-1421]: the
 * multiplied value must EQUAL a number of the listing. "1,15 mln" is grounded by 1 150 000 and
 * refused for 1 149 000; "1149 tys." is grounded by 1 149 000 and refused for 1 149 500. The
 * rounding tolerance #1101 introduced (half the unit of the last written digit, three significant
 * digits or more) is kept ONLY for a count of people or an area written right after the number
 * ("1,78 mln mieszkańców", "2,5 tys. m²"); a number with no such unit is read as money. A
 * multiplied number that is not grounded is refused as before. The listing's own "1,15 mln"
 * grounds 1150000 too (exact only).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const MockAnthropic = vi.fn(() => ({ messages: { create: mockCreate } }));
  (MockAnthropic as unknown as Record<string, unknown>).__mockCreate = mockCreate;
  return { default: MockAnthropic };
});

import Anthropic from '@anthropic-ai/sdk';

const mockCreate = (Anthropic as unknown as { __mockCreate: ReturnType<typeof vi.fn> })
  .__mockCreate;
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { callLlmGateway } = await import('@/lib/llm-gateway');
const { checkBodyClaims, checkHeadlineFacts } = await import('@/lib/grounding-check');
const { getPlaybook } = await import('@estalara/shared/playbooks');

const WAW = 'Dwupokojowe mieszkanie na Mokotowie, Warszawa. Balkon.';
const WAW_CTX = { listing_price: '1150000 PLN', listing_location: 'Warszawa' };
const ROUNDED_CTX = { listing_price: '1149000 PLN', listing_location: 'Warszawa' };
const HALF_CTX = { listing_price: '1149500 PLN', listing_location: 'Warszawa' };
const NEAR_K_CTX = { listing_price: '849600 PLN', listing_location: 'Warszawa' };
const K_CTX = { listing_price: '850000 PLN', listing_location: 'Warszawa' };
const ES_CTX = { listing_price: '1150000 EUR', listing_location: 'Sevilla' };

describe('FOLLOW-1397 — the description path', () => {
  it.each([
    ['Cena: 1,15 mln PLN.', WAW_CTX],
    ['Cena: 1,15 mln zł.', WAW_CTX],
    ['Price: 1.15M PLN.', WAW_CTX],
    ['Price: PLN 1.15m.', WAW_CTX],
    ['Price: 1.15 million PLN.', WAW_CTX],
    ['Precio: 1,15 millones de euros.', ES_CTX],
    ['Price: €1,15 mln.', ES_CTX],
    ['Cena: 1150 tys. zł.', WAW_CTX],
    ['Cena: 850 tys. zł.', K_CTX],
    ['Cena: 850 tysięcy złotych.', K_CTX],
    ['Price: 850k PLN.', K_CTX],
    ['Price: 850K PLN.', K_CTX],
    ['Precio: 850 mil zł.', K_CTX],
    // exact [FOLLOW-1421]
    ['Cena: 1149 tys. zł.', ROUNDED_CTX],
  ] as const)('%j is grounded by %j', (text, ctx) => {
    expect(checkBodyClaims(text, WAW, ctx)).toBeNull();
  });

  it.each([
    // a wrong value
    ['Cena: 1,2 mln PLN.', WAW_CTX],
    ['Cena: 1,16 mln PLN.', WAW_CTX],
    ['Price: 1.1M PLN.', WAW_CTX],
    ['Cena: 1,25 mln zł.', WAW_CTX],
    // two significant digits or fewer must be exact
    ['Cena: 1 mln PLN.', WAW_CTX],
    ['Cena: 1,1 mln PLN.', ROUNDED_CTX],
    ['Cena: 1,2 mln PLN.', ROUNDED_CTX],
    // three digits, but outside half a unit
    ['Cena: 851 tys. zł.', K_CTX],
    ['Cena: 1,14 mln PLN.', WAW_CTX],
    // CEO 2026-10-30 [FOLLOW-1421]: a price is always exact. Each of these lies within half a
    // unit of the listing price, so each was grounded under the #1101 tolerance.
    ['Cena: 1,15 mln PLN.', ROUNDED_CTX],
    ['Price: 1.15M PLN.', ROUNDED_CTX],
    ['Precio: 1,15 millones de euros.', ROUNDED_CTX],
    ['Cena: 1149 tys. zł.', HALF_CTX],
    ['Cena: 850 tys. zł.', NEAR_K_CTX],
    ['Price: 850k PLN.', NEAR_K_CTX],
    // the wrong multiplier
    ['Cena: 1,15 mld PLN.', WAW_CTX],
    ['Cena: 1150 mln PLN.', WAW_CTX],
    ['Price: 1.15k PLN.', WAW_CTX],
  ] as const)('%j is still refused for %j', (text, ctx) => {
    expect(checkBodyClaims(text, WAW, ctx)).toBe('hallucinated_number');
  });

  it("the listing's own multiplied price grounds the full number (exact only)", () => {
    expect(checkBodyClaims('Cena: 1 150 000 zł.', 'Cena 1,15 mln zł.', {})).toBeNull();
    expect(checkBodyClaims('Price: 850000 PLN.', 'Cena 850 tys. zł.', {})).toBeNull();
    expect(checkBodyClaims('Cena: 1 149 000 zł.', 'Cena 1,15 mln zł.', {})).toBe(
      'hallucinated_number',
    );
    // CEO 2026-10-30 [FOLLOW-1419, FOLLOW-1421]: prices are always exact. 849 600 lies within
    // half a unit of "850 tys.", so this pin fails if the #1101 tolerance comes back for prices.
    expect(checkBodyClaims('Cena: 850 tys. zł.', 'Cena 849 600 zł.', {})).toBe(
      'hallucinated_number',
    );
    expect(checkBodyClaims('Cena: 1,15 mln zł.', 'Cena 1 149 000 zł.', {})).toBe(
      'hallucinated_number',
    );
  });

  it('a count of people or an area keeps the rounding tolerance; the same figure as money does not', () => {
    const city = 'Warszawa ma 1 784 000 mieszkańców. Działka 2 480 m².';
    expect(checkBodyClaims('Miasto ma 1,78 mln mieszkańców.', city, {})).toBeNull();
    expect(checkBodyClaims('Działka 2,48 tys. m².', city, {})).toBeNull();
    expect(checkBodyClaims('Cena: 1,78 mln zł.', city, {})).toBe('hallucinated_number');
    expect(checkBodyClaims('Miasto ma 1,8 mln mieszkańców.', city, {})).toBe('hallucinated_number');
  });

  it('a metre is not a million: "64 m" is checked as 64', () => {
    expect(checkBodyClaims('A 64 m flat.', WAW, WAW_CTX)).toBe('hallucinated_number');
    expect(checkBodyClaims('A 64 m² flat.', 'Flat of 64 m².', {})).toBeNull();
  });

  it('the headline reads multipliers the same way', () => {
    expect(checkHeadlineFacts('Mieszkanie na Mokotowie za 1,15 mln PLN', WAW, WAW_CTX, 'pl')).toBe(
      null,
    );
    expect(checkHeadlineFacts('Mieszkanie na Mokotowie za 1,2 mln PLN', WAW, WAW_CTX, 'pl')).toBe(
      'hallucinated_number',
    );
  });
});

async function servedOnAdapt(value: string, listingContext: Record<string, string>) {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify([
          { type: 'text', slot: 'cta', value, archetype: 'yield_hunter', confidence: 0.8 },
        ]),
      },
    ],
    usage: { input_tokens: 150, output_tokens: 50 },
  });
  const result = await callLlmGateway({
    archetypeId: 'yield_hunter',
    confidence: 0.75,
    similarity: 0.75,
    basePlaybook: getPlaybook('yield_hunter'),
    listingContext,
  });
  return result?.directives.some((d) => d.value === value) ?? false;
}

describe('FOLLOW-1397 — /api/adapt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1397';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: '0', data: [{ total: '0' }] }),
      text: () => Promise.resolve(''),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('a multiplied price the listing states is served', async () => {
    expect(await servedOnAdapt('Mieszkanie za 1,15 mln zł', WAW_CTX)).toBe(true);
  });

  it('a wrong multiplied price is refused', async () => {
    expect(await servedOnAdapt('Mieszkanie za 1,2 mln zł', WAW_CTX)).toBe(false);
  });

  it('a rounded price is refused: prices are always exact [FOLLOW-1421]', async () => {
    expect(await servedOnAdapt('Mieszkanie za 1,15 mln zł', ROUNDED_CTX)).toBe(false);
    expect(await servedOnAdapt('Mieszkanie za 1149 tys. zł', ROUNDED_CTX)).toBe(true);
  });
});
