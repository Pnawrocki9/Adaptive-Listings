/**
 * FOLLOW-1405 — a decade is checked as a decade, on both digit rules.
 *
 * "…na drugim piętrze kamienicy z lat 30." for a listing that says "a 1930s building" was refused
 * as `hallucinated_number` four times in the FOLLOW-1399 comparison (Lisbon, both models): the
 * digit rule read "30" as a number. A decade expression is now grounded by a year of that decade
 * in the listing (or by the same two-digit decade), and refused OUTRIGHT otherwise — even where
 * its digits occur elsewhere in the listing ("lata 50." against "50 m²" passed before).
 *
 * Boundary, stated: any four-digit number from 1000 to 2099 in the listing counts as a year, so
 * "1950 sqft" would ground "the 1950s" — as the digit rule already did before (it read "1950s" as
 * "1950").
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

// The FOLLOW-1399 Lisbon listing (`lis`), verbatim.
const LIS =
  'Renovated two-bedroom apartment of 85 sqm on the second floor of a 1930s building in Campo de Ourique, Lisbon. The renovation was completed in 2021 and kept the original pine floors and high ceilings. The living room has two French windows with small balconies over a tree-lined street. Equipped kitchen, one bathroom and a guest WC. The building has no lift. The Jardim da Estrela is a 7-minute walk away, and the neighbourhood has a covered market, cafes and the tram 28 terminus. Energy certificate C. Condominium fees 65 EUR per month.';
const LIS_CTX = {
  listing_title: '2-bedroom apartment, Campo de Ourique, Lisbon — 85 sqm',
  listing_price: '640000 EUR',
  listing_location: 'Campo de Ourique, Lisboa',
};
// The four refused sentences: three distinct, verbatim.
const STUDY = [
  'Mieszkanie o powierzchni 85 m² na drugim piętrze kamienicy z lat 30.',
  'Wyremontowane mieszkanie o powierzchni 85 m² w Campo de Ourique w Lizbonie, na drugim piętrze kamienicy z lat 30.',
];

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

describe('FOLLOW-1405 — the description path', () => {
  it.each(STUDY)('the study sentence %j is grounded by "a 1930s building"', (text) => {
    expect(checkBodyClaims(text, LIS, LIS_CTX)).toBeNull();
  });

  it.each([
    // A four-digit decade or a year of it, in the listing.
    ['Kamienica z lat 30-tych.', 'A building from 1934.'],
    ['W latach 30-tych zbudowana kamienica.', 'Built in 1938.'],
    ['A 1930s building.', 'Kamienica z 1932 roku.'],
    ["A '30s building.", 'Built 1935.'],
    ['Un edificio de los años 30.', 'Edificio de 1930.'],
    ['Edificio de la década de los 30.', 'A 1930s building.'],
    ['Kamienica z lat 1930.', 'Edificio de 1936.'],
    // A two-digit decade in the listing grounds the same two-digit decade.
    ['Kamienica z lat 30.', 'Kamienica z lat 30-tych.'],
  ])('%j is grounded by the listing %j', (text, original) => {
    expect(checkBodyClaims(text, original, {})).toBeNull();
  });

  it.each([
    // The decade the listing does not state.
    ['Kamienica z lat 20.', LIS],
    ['A 1920s building.', LIS],
    ['Un edificio de los años 50.', LIS],
    // Its digits elsewhere in the listing do not ground a decade (passed before FOLLOW-1405).
    ['Kamienica z lat 50.', 'Mieszkanie 50 m² w kamienicy.'],
    // A two-digit decade in the listing does not supply a century.
    ['A 1930s building.', 'Kamienica z lat 30.'],
  ])('%j is refused for the listing %j', (text, original) => {
    expect(checkBodyClaims(text, original, {})).toBe('hallucinated_number');
  });

  it('a bare number is still a number, not a decade', () => {
    expect(checkBodyClaims('A flat with 30 m² of terrace.', LIS, LIS_CTX)).toBe(
      'hallucinated_number',
    );
    expect(checkBodyClaims('Built in 1934.', 'A 1930s building.', {})).toBe('hallucinated_number');
  });

  it('the headline reads decades the same way', () => {
    expect(
      checkHeadlineFacts('Campo de Ourique: mieszkanie w kamienicy z lat 30.', LIS, LIS_CTX, 'pl'),
    ).toBeNull();
    expect(
      checkHeadlineFacts('Campo de Ourique: mieszkanie w kamienicy z lat 20.', LIS, LIS_CTX, 'pl'),
    ).toBe('hallucinated_number');
  });
});

describe('FOLLOW-1405 — /api/adapt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1405';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: '0', data: [{ total: '0' }] }),
      text: () => Promise.resolve(''),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('a grounded decade is served', async () => {
    expect(
      await servedOnAdapt('Mieszkanie w kamienicy z lat 30.', { listing_description: LIS }),
    ).toBe(true);
  });

  it('an ungrounded decade is refused, even where its digits occur in the listing', async () => {
    expect(
      await servedOnAdapt('Mieszkanie w kamienicy z lat 20.', { listing_description: LIS }),
    ).toBe(false);
    expect(
      await servedOnAdapt('Kamienica z lat 50.', { listing_description: 'Mieszkanie 50 m².' }),
    ).toBe(false);
  });
});
