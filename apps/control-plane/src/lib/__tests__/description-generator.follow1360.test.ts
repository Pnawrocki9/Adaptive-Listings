/**
 * FOLLOW-1360 — buyer traits in the description generator.
 *
 * The trait rules join the archetype's hard rules in the user prompt only when the event carries
 * traits; an event without them renders the prompt it always rendered (the parity corpus, 98/98,
 * pins that independently). The claim contract that checks the description afterwards is not
 * touched: for every trait, an ungrounded claim the rules exist to prevent is REFUSED.
 *
 * @module apps/control-plane/src/lib/__tests__/description-generator.follow1360.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/description-pg-cache', () => ({
  publishPgCachedDescription: vi.fn().mockResolvedValue('published'),
}));
vi.mock('@/lib/description-cache', () => ({
  setCachedDescription: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/description-generation-audit', () => ({
  writeDescriptionGenerationAudit: vi.fn().mockResolvedValue('written'),
}));
vi.mock('@/lib/llm-calls-register', () => ({
  logLlmCallAsync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/llm-spend-counter', () => ({
  DAILY_SPEND_CAP_USD: 100,
  getDailySpend: vi.fn().mockResolvedValue(0),
}));

import type { DescriptionRequestedEvent } from '@estalara/shared';
import { CANONICAL_TRAIT_IDS } from '@estalara/shared';
import { generateDescription } from '@/lib/description-generator';

const EVENT: DescriptionRequestedEvent = {
  tenant_id: '00000000-0000-4000-8000-000000001360',
  listing_id: 'listing-1360',
  archetype: 'family_buyer',
  locale: 'en',
  copy_template: 'VOICE PATTERN:\nPlain.\n\nHARD RULES:\nNo invented schools.',
  original_description: 'A house with two bedrooms and a garden in Lisbon.',
  listing_context: { price: '400000', location: 'Lisbon' },
  cache_key: 'desc:t:listing-1360:family_buyer:en:claude-sonnet-4-6:r0',
  generation_model: 'claude-sonnet-4-6',
};

function response(text: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 40 },
  };
}

const fit = (body: string): string =>
  `<adaptation_verdict>FIT</adaptation_verdict>\n${body}\n` +
  '<verified_facts_used>\n["bedrooms: 2"]\n</verified_facts_used>';

const userPrompt = (): string => {
  const arg = mockCreate.mock.calls[0]?.[0] as { messages: { content: string }[] };
  return arg.messages[0]?.content ?? '';
};

describe('description generator — traits', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    mockCreate.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(CANONICAL_TRAIT_IDS)(
    '%s: rules are in the prompt iff the trait is present',
    async (trait) => {
      mockCreate.mockResolvedValue(response(fit('A two-bedroom house with a garden in Lisbon.')));
      await generateDescription({ ...EVENT, traits: [trait] });
      const withTrait = userPrompt();
      expect(withTrait).toContain(`[${trait}]`);
      // After the archetype's hard rules, before the listing text.
      expect(withTrait.indexOf('archetype_hard_rules:')).toBeLessThan(
        withTrait.indexOf(`[${trait}]`),
      );
      expect(withTrait.indexOf(`[${trait}]`)).toBeLessThan(
        withTrait.indexOf('original_description:'),
      );

      mockCreate.mockReset();
      mockCreate.mockResolvedValue(response(fit('A two-bedroom house with a garden in Lisbon.')));
      await generateDescription(EVENT);
      expect(userPrompt()).not.toContain('Buyer traits');
    },
  );

  it('an empty trait list renders the same prompt as no field', async () => {
    mockCreate.mockResolvedValue(response(fit('A two-bedroom house with a garden in Lisbon.')));
    await generateDescription(EVENT);
    const without = userPrompt();
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(response(fit('A two-bedroom house with a garden in Lisbon.')));
    await generateDescription({ ...EVENT, traits: [] });
    expect(userPrompt()).toBe(without);
  });

  describe('no trait bypasses the claim contract — one ungrounded claim per trait is REFUSED', () => {
    const UNGROUNDED: Record<string, string> = {
      premium: 'A two-bedroom house with a private pool and sea views in Lisbon.',
      works_from_home: 'A two-bedroom house in Lisbon with a dedicated office and 1000 Mbps fibre.',
      residency_goal: 'A two-bedroom house in Lisbon, from a 500,000 investment for residency.',
      seasoned_investor: 'A two-bedroom house in Lisbon with guaranteed income.',
      buying_from_abroad: 'A two-bedroom house in Lisbon, completion in 14 days from abroad.',
      will_let: 'A two-bedroom house in Lisbon with a terrace, ideal for letting.',
      has_children: 'A two-bedroom house in Lisbon with a garden and 3 schools nearby.',
    };

    it('covers every trait (guards the guard)', () => {
      expect(Object.keys(UNGROUNDED).sort()).toEqual([...CANONICAL_TRAIT_IDS].sort());
    });

    it.each(CANONICAL_TRAIT_IDS)('%s', async (trait) => {
      mockCreate.mockResolvedValue(response(fit(UNGROUNDED[trait] ?? '')));
      const report = await generateDescription({ ...EVENT, traits: [trait] });
      expect(report.outcome.verdict).toBe('REFUSED');
    });
  });
});
