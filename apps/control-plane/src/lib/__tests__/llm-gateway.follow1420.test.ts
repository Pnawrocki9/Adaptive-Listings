/**
 * FOLLOW-1420 — `/api/adapt` refuses composition stated through a majority (`protected_ground`),
 * the same guard as the description path (`describesResidentsByProtectedGround`, one
 * implementation). Each refused value was served before FOLLOW-1420.
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
const { getPlaybook } = await import('@estalara/shared/playbooks');

const CTX = { listing_price: '1150000 PLN', listing_location: 'Warszawa' };

/** The `protected_ground` refusals the gateway logged for `value`. */
async function protectedGroundRefusals(value: string): Promise<number> {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
  await callLlmGateway({
    archetypeId: 'yield_hunter',
    confidence: 0.75,
    similarity: 0.75,
    basePlaybook: getPlaybook('yield_hunter'),
    listingContext: CTX,
  });
  return warn.mock.calls.filter((c) => String(c[0]).includes('violation: protected_ground')).length;
}

describe('FOLLOW-1420 — /api/adapt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1420';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: '0', data: [{ total: '0' }] }),
      text: () => Promise.resolve(''),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    'Most residents are Catholic',
    'A Muslim-majority neighbourhood',
    'Większość mieszkańców to katolicy',
    'La mayoría de los vecinos son musulmanes',
  ])('a majority composition is refused protected_ground: %j', async (value) => {
    expect(await protectedGroundRefusals(value)).toBe(1);
  });

  it.each(['Większość mieszkań ma balkon', 'Mieszkanie przy ul. Bohaterów Getta'])(
    'no protected_ground refusal for %j',
    async (value) => {
      expect(await protectedGroundRefusals(value)).toBe(0);
    },
  );
});
