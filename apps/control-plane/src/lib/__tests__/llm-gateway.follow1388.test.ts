/**
 * FOLLOW-1388 — the `/api/adapt` digit and area rules read a grouped number as ONE number, on both
 * sides, with the SAME normaliser as the description path (FOLLOW-1381, `lib/number-groups.ts`).
 *
 * Before: `checkDirectiveFacts` tokenised "949 000 PLN" into "949" and "000" and grounded neither,
 * so a correctly formatted Polish price was refused (`hallucinated_number`), and the area rule read
 * "1 200 m²" as "200 m²". The cases mirror `grounding-check.follow1381.test.ts`, driven through the
 * REAL gateway (only the Anthropic client and `fetch` are replaced), plus the negative controls:
 * nothing but the grouping is loosened.
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway.follow1388.test
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
const { buildClaimGrounding, checkUnsupportedClaims } = await import('@/lib/claim-containment');
const { getPlaybook } = await import('@estalara/shared/playbooks');

const YIELD_HUNTER = getPlaybook('yield_hunter');

const NBSP = '\u00a0';
const NNBSP = '\u202f';
const THIN = '\u2009';

/** One cta directive through the real gateway; `served` is whether it came back. */
async function served(value: string, listingContext: Record<string, string>): Promise<boolean> {
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
    basePlaybook: YIELD_HUNTER,
    listingContext,
  });
  // A digit or unit verdict is deterministic: no judge round trip.
  expect(mockCreate).toHaveBeenCalledTimes(1);
  return result?.directives.some((d) => d.value === value) ?? false;
}

const desc = (listing_description: string): Record<string, string> => ({ listing_description });

describe('FOLLOW-1388 — a grouped rendering of a grounded number is grounded on /api/adapt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1388';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: '0', data: [{ total: '0' }] }),
      text: () => Promise.resolve(''),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['949 000 pln', 'cena: 949000 pln.'],
    [`949${NBSP}000 pln`, 'cena: 949000 pln.'],
    [`949${NNBSP}000 pln`, 'cena: 949000 pln.'],
    [`949${THIN}000 pln`, 'cena: 949000 pln.'],
    ['949,000 pln', 'cena: 949000 pln.'],
    ['949.000 pln', 'cena: 949000 pln.'],
    ['1 150 000 zł', 'cena 1150000 zł.'],
    ['1.150.000 €', 'precio 1150000 €.'],
    ['1,150,000 eur', 'price 1 150 000 eur.'],
    ['45,000 zł', 'czynsz 45 000 zł rocznie.'],
    ['45 000 zł', 'rent 45,000 zł a year.'],
    ['189 000 eur', 'price 189000 eur'],
    ['189000 eur', 'precio 189.000 eur'],
    [`189${NBSP}000 eur`, `price 189${NNBSP}000 eur`],
    ['1 150 000,50 zł', 'kwota 1150000.50 zł'],
  ])('value "mieszkanie za %s" is grounded by %j', async (text, listing) => {
    expect(await served(`mieszkanie za ${text}`, desc(listing))).toBe(true);
  });

  it('a grouped number is grounded by the listing price field that states it ungrouped', async () => {
    expect(await served('Cena 949 000 PLN za trzy pokoje', { listing_price: '949000 PLN' })).toBe(
      true,
    );
  });

  it('an area with a grouped number is grounded by the area field and by the text (unit rule)', async () => {
    expect(await served('plot of 1 200 m²', { plot_area: '1200' })).toBe(true);
    expect(await served('plot of 1200 m²', desc('a plot of 1 200 m².'))).toBe(true);
    expect(
      checkUnsupportedClaims('plot of 1 200 m²', buildClaimGrounding({ plot_area: '1200' })),
    ).toBeNull();
    expect(
      checkUnsupportedClaims('plot of 1200 m²', buildClaimGrounding(desc('a plot of 1 200 m².'))),
    ).toBeNull();
  });
});

describe('FOLLOW-1388 — negative controls: nothing else is loosened on /api/adapt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1388';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: '0', data: [{ total: '0' }] }),
      text: () => Promise.resolve(''),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('a different grouped number is still refused', async () => {
    expect(await served('cena 950 000 pln', desc('cena: 949000 pln.'))).toBe(false);
    expect(await served('price 949,500 pln', desc('cena: 949000 pln.'))).toBe(false);
  });

  it('a part of a grounded number is not grounded by it', async () => {
    expect(await served('only 949 pln', desc('cena: 949000 pln.'))).toBe(false);
    // Stricter than before: a grouped grounding no longer grounds its own groups.
    expect(await served('only 949 pln', desc('cena: 949 000 pln.'))).toBe(false);
    expect(await served('only 150 zł', desc('cena 1 150 000 zł.'))).toBe(false);
  });

  it('a group that is not three digits is not a thousands group', async () => {
    expect(await served('cena 94 90 pln', desc('cena: 9490 pln.'))).toBe(false);
    expect(await served('cena 9490 pln', desc('cena: 9 4900 pln.'))).toBe(false);
  });

  it('separators must be the same within one number', async () => {
    expect(await served('cena 1 150,000 zł', desc('cena 1150000 zł.'))).toBe(false);
  });

  it('decimals keep working, and a decimal comma equals a decimal point', async () => {
    expect(await served('plaża 3,5 km', desc('plaża 3,5 km.'))).toBe(true);
    expect(await served('beach 3.5 km', desc('plaża 3,5 km.'))).toBe(true);
    expect(await served('plaża 3,5 km', desc('beach 3.5 km.'))).toBe(true);
    // A decimal is not its digits run together (it was: "3,5" canonicalised to "35").
    expect(await served('beach 35 km', desc('plaża 3,5 km.'))).toBe(false);
    expect(await served('plaża 3,5 km', desc('beach 35 km.'))).toBe(false);
    expect(await served('beach 3.6 km', desc('plaża 3,5 km.'))).toBe(false);
  });

  it('plain numbers are unchanged', async () => {
    expect(await served('5 bedrooms', { listing_price: '425000' })).toBe(false);
    expect(await served('€97,200', { listing_price: '97200 eur' })).toBe(true);
  });

  it('an area stated with a grouped number that differs is still refused', async () => {
    expect(await served('plot of 1 250 m²', { plot_area: '1200' })).toBe(false);
    expect(
      checkUnsupportedClaims('plot of 1 250 m²', buildClaimGrounding({ plot_area: '1200' })),
    ).toBe('unit_mismatch');
  });
});
