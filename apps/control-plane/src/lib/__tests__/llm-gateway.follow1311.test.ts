/**
 * FOLLOW-1311: the transformations on `/api/adapt`, through the REAL gateway. Only the Anthropic
 * client and the global `fetch` are replaced.
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway.follow1311.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const MockAnthropic = vi.fn(() => ({ messages: { create: mockCreate } }));
  (MockAnthropic as unknown as Record<string, unknown>).__mockCreate = mockCreate;
  return { default: MockAnthropic };
});

import Anthropic from '@anthropic-ai/sdk';

const mockCreate = (Anthropic as unknown as { __mockCreate: ReturnType<typeof vi.fn> })
  .__mockCreate;

vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ result: '0', data: [{ total: '0' }] }),
    text: () => Promise.resolve(''),
  }),
);

const { callLlmGateway } = await import('@/lib/llm-gateway');
const { getPlaybook } = await import('@estalara/shared/playbooks');

const EN = {
  listing_title: 'Family home',
  listing_description:
    'A three-bedroom, two-bathroom single-family home on a quiet residential street. Attached two-car garage and a mature garden.',
  listing_price: '385000 USD',
  listing_location: 'Palm Coast, FL',
};
const PL = {
  listing_title: 'Mieszkanie, ul. Długa 5',
  listing_description:
    'Trzypokojowe mieszkanie o powierzchni 64 mkw. na cichej ulicy w Krakowie. Otwarty salon, dwie łazienki, balkon.',
  listing_price: '949000 PLN',
  listing_location: 'Warszawa Mokotów',
};

/** The directive's fate: served, or the words of the refusal. `judge` answers a name flag. */
async function run(
  listingContext: Record<string, string>,
  value: string,
  judge = false,
): Promise<{ served: boolean; judged: boolean }> {
  mockCreate.mockReset();
  mockCreate.mockImplementation((req: { messages: { content: string }[] }) => {
    const isJudge = String(req.messages[0]?.content).includes('strict grounding auditor');
    const text = isJudge
      ? JSON.stringify({ grounded: judge })
      : JSON.stringify([
          { type: 'text', slot: 'headline', value, archetype: 'yield_hunter', confidence: 0.8 },
        ]);
    return Promise.resolve({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });
  const result = await callLlmGateway({
    archetypeId: 'yield_hunter',
    confidence: 0.75,
    similarity: 0.75,
    basePlaybook: getPlaybook('yield_hunter'),
    listingContext,
  });
  return { served: result !== null, judged: mockCreate.mock.calls.length > 1 };
}

describe('FOLLOW-1311 on /api/adapt', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1311';
  });

  it.each([
    [EN, 'Home with 3 bedrooms and 2 bathrooms'],
    [EN, 'Home with a 2-car garage'],
    [PL, 'Mieszkanie: 3 pokoje i 2 łazienki'],
  ])('T3 allowed: %#', async (ctx, value) => {
    expect((await run(ctx, value)).served).toBe(true);
  });

  it.each([
    [EN, 'Home with 4 bedrooms'],
    [PL, 'Mieszkanie: 3 sypialnie'],
  ])('T3 refused: %#', async (ctx, value) => {
    expect((await run(ctx, value)).served).toBe(false);
  });

  it('T5 allowed: "64 mkw." grounds "64 m²"', async () => {
    expect((await run(PL, 'Mieszkanie 64 m² z balkonem')).served).toBe(true);
  });

  it.each([
    ['a Polish case form', 'Mieszkanie w centrum Mokotowie'],
    ['no diacritics', 'Mieszkanie w centrum Mokotow'],
    ['another name of the place', 'Mieszkanie w centrum Warsaw'],
    ['an inflected other name', 'Mieszkanie w centrum Warszawie'],
  ])('T7 allowed without a judge call: %s', async (_name, value) => {
    const { served, judged } = await run(PL, value);
    expect(served).toBe(true);
    expect(judged).toBe(false);
  });

  it('T7 refused: another place still goes to the judge, and the judge can refuse it', async () => {
    const { served, judged } = await run(PL, 'Mieszkanie w centrum Gdańska');
    expect(served).toBe(false);
    expect(judged).toBe(true);
  });

  it.each([
    [EN, 'Home at $385,000'],
    [EN, 'Home with three bedrooms'],
    [PL, 'Trzypokojowe mieszkanie'],
  ])('typed, allowed: %#', async (ctx, value) => {
    expect((await run(ctx, value)).served).toBe(true);
  });

  it.each([
    ['T1', EN, 'Home at €385,000'],
    ['T3', EN, 'A five-bedroom home'],
    ['T3', EN, 'Home with 3 bathrooms'],
    ['T5', PL, 'Mieszkanie 64 sq ft'],
    ['T6', EN, 'Dom trzypokojowy'],
    ['T9', EN, 'Home without a garage'],
    ['T9', PL, 'Mieszkanie bez balkonu'],
  ])('typed, refused without a judge call: %s %#', async (_t, ctx, value) => {
    const { served, judged } = await run(ctx, value);
    expect(served).toBe(false);
    expect(judged).toBe(false);
  });

  // Slice 5: the first word of a headline is read, and goes to the judge like any other capital.
  describe('the first word of the headline slot', () => {
    it.each([
      ['a place the listing does not name', EN, 'Miami flat with a mature garden'],
      ['pl: a place the listing does not name', PL, 'Gdynia: mieszkanie z balkonem'],
    ])('%s is judged, and the judge refuses it', async (_name, ctx, value) => {
      expect(await run(ctx, value)).toEqual({ served: false, judged: true });
    });

    it('the judge may clear it', async () => {
      expect(await run(EN, 'Miami flat with a mature garden', true)).toEqual({
        served: true,
        judged: true,
      });
    });

    it.each([
      ['the listing own place', EN, 'Palm Coast home with a mature garden'],
      ['the listing own word', EN, 'Attached two-car garage and a mature garden'],
      ['pl: a case form of its place', PL, 'Krakowie, mieszkanie z balkonem'],
      ['an opening word', EN, 'Three-bedroom home with a mature garden'],
      ['pl: an opening word', PL, 'Przestronne mieszkanie z balkonem'],
      ['an imperative', EN, 'Make Palm Coast home'],
      ['the English live', EN, 'Live like a local in Palm Coast'],
      ['es: a determiner', EN, 'Un piso en Palm Coast'],
    ])('%s passes with no judge call', async (_name, ctx, value) => {
      expect(await run(ctx, value)).toEqual({ served: true, judged: false });
    });

    it('an opener does not excuse the name after it', async () => {
      expect(await run(EN, 'Live like a local in Miami')).toEqual({ served: false, judged: true });
    });

    it('still exempt: the first word of any other slot', async () => {
      mockCreate.mockReset();
      mockCreate.mockImplementation(() =>
        Promise.resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify([
                {
                  type: 'text',
                  slot: 'cta',
                  value: 'Miami tour',
                  archetype: 'yield_hunter',
                  confidence: 0.8,
                },
              ]),
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
      const result = await callLlmGateway({
        archetypeId: 'yield_hunter',
        confidence: 0.75,
        similarity: 0.75,
        basePlaybook: getPlaybook('yield_hunter'),
        listingContext: EN,
      });
      expect(result).not.toBeNull();
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('KNOWN_LIMIT: the word after a colon in a headline still carries no name signal', async () => {
      expect(await run(EN, 'Home: Miami views')).toEqual({ served: true, judged: false });
    });

    it('the street claim is final on the slot: no judge call overrules it', async () => {
      expect(await run(EN, 'Home on Ocean Drive with a mature garden', true)).toEqual({
        served: false,
        judged: false,
      });
    });
  });
});
