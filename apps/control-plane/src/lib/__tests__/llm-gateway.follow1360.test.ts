/**
 * FOLLOW-1360 — buyer traits in the REAL gateway.
 *
 * Three claims, each pinned against the real gateway with only the Anthropic client and `fetch`
 * replaced:
 *   1. a trait's rules reach the prompt iff the trait is present (and a request without traits
 *      builds the prompt it always built);
 *   2. no trait text bypasses grounding: for every trait, a claim its rules exist to prevent, once
 *      a model writes it anyway, is refused by the same deterministic checks as without the trait;
 *   3. `has_children` never emits familial-status steering, even where the listing's own words
 *      contain it.
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway.follow1360.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { AdaptationDirectives } from '@estalara/shared';

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
const { CANONICAL_TRAIT_IDS } = await import('@estalara/shared');

const PLAYBOOK = getPlaybook('family_buyer');

/** A plain listing: two bedrooms, a garden, nothing else. */
const LISTING_CONTEXT: Record<string, string> = {
  listing_title: 'house',
  listing_description: 'a house with two bedrooms and a garden',
  listing_price: '400000',
  listing_location: 'Lisbon',
};

type FallbackReason = NonNullable<AdaptationDirectives['fallback_reason']>;

function anthropicResponse(pairs: [slot: string, value: string][]) {
  const text = JSON.stringify(
    pairs.map(([slot, value]) => ({
      type: 'text',
      slot,
      value,
      archetype: 'family_buyer',
      confidence: 0.8,
    })),
  );
  return {
    content: [{ type: 'text' as const, text }],
    usage: { input_tokens: 150, output_tokens: 50 },
  };
}

async function run(pairs: [slot: string, value: string][], traits?: string[]) {
  mockCreate.mockResolvedValue(anthropicResponse(pairs));
  const reasons: FallbackReason[] = [];
  const result = await callLlmGateway({
    archetypeId: 'family_buyer',
    confidence: 0.75,
    similarity: 0.75,
    basePlaybook: PLAYBOOK,
    listingContext: LISTING_CONTEXT,
    ...(traits ? { traits } : {}),
    onFallback: (reason) => reasons.push(reason),
  });
  return { result, reasons };
}

const promptOf = (): string => JSON.stringify(mockCreate.mock.calls[0]?.[0]);

describe('FOLLOW-1360 — traits in the gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1360';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: '0', data: [{ total: '0' }] }),
      text: () => Promise.resolve(''),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('the rules reach the prompt iff the trait is present', () => {
    it.each(CANONICAL_TRAIT_IDS)('%s', async (trait) => {
      await run([['headline', 'two-bedroom house in Lisbon']], [trait]);
      const withTrait = promptOf();
      expect(withTrait).toContain(`[${trait}]`);
      // And only that trait's rules.
      for (const other of CANONICAL_TRAIT_IDS.filter((t) => t !== trait)) {
        expect(withTrait).not.toContain(`[${other}]`);
      }

      vi.clearAllMocks();
      await run([['headline', 'two-bedroom house in Lisbon']]);
      expect(promptOf()).not.toContain(`[${trait}]`);
      expect(promptOf()).not.toContain('Buyer traits');
    });

    it('a request with an empty trait list builds the same prompt as one without the field', async () => {
      await run([['headline', 'two-bedroom house in Lisbon']]);
      const without = promptOf();
      vi.clearAllMocks();
      await run([['headline', 'two-bedroom house in Lisbon']], []);
      expect(promptOf()).toBe(without);
    });

    it('unknown ids add no rules', async () => {
      await run([['headline', 'two-bedroom house in Lisbon']], ['made_up']);
      expect(promptOf()).not.toContain('Buyer traits');
    });
  });

  describe('no trait bypasses the grounding checks — one ungrounded claim per trait is refused', () => {
    // The claim each trait's rules exist to prevent, written the way a model would write it
    // against a listing that states none of it.
    const UNGROUNDED: Record<string, string> = {
      premium: 'private pool and sea views throughout',
      works_from_home: 'dedicated office with 1gbps fibre',
      residency_goal: 'residency from a 500,000 investment',
      seasoned_investor: 'guaranteed income across your portfolio',
      buying_from_abroad: 'completion in 14 days from abroad',
      will_let: 'terrace ideal for holiday letting',
      has_children: 'family-friendly area close to 3 schools',
    };

    it('covers every trait (guards the guard)', () => {
      expect(Object.keys(UNGROUNDED).sort()).toEqual([...CANONICAL_TRAIT_IDS].sort());
    });

    it.each(CANONICAL_TRAIT_IDS)(
      '%s: refused as fact_check_refused, no directives',
      async (trait) => {
        const { result, reasons } = await run([['headline', UNGROUNDED[trait] ?? '']], [trait]);
        expect(result).toBeNull();
        expect(reasons).toEqual(['fact_check_refused']);
      },
    );

    it.each(CANONICAL_TRAIT_IDS)(
      '%s: the same listing and a grounded transformation is still served',
      async (trait) => {
        const { result, reasons } = await run(
          [['headline', 'two-bedroom house with a garden in Lisbon']],
          [trait],
        );
        expect(reasons).toEqual([]);
        expect(result?.directives.map((d) => d.value)).toEqual([
          'two-bedroom house with a garden in Lisbon',
        ]);
      },
    );
  });

  describe('has_children never steers by familial status', () => {
    const STEERING = [
      'family-friendly house in Lisbon',
      'ideal for families, with a garden',
      'a safe neighbourhood for children',
      'your children will love the garden',
    ];

    it.each(STEERING)('refuses %j even though every word is otherwise harmless', async (value) => {
      const { result, reasons } = await run([['headline', value]], ['has_children']);
      expect(result).toBeNull();
      expect(reasons).toEqual(['fact_check_refused']);
    });

    it('refuses it even where the listing itself says it (the seller is no licence)', async () => {
      mockCreate.mockResolvedValue(
        anthropicResponse([['headline', 'family-friendly house in Lisbon']]),
      );
      const reasons: FallbackReason[] = [];
      const result = await callLlmGateway({
        archetypeId: 'family_buyer',
        confidence: 0.75,
        similarity: 0.75,
        basePlaybook: PLAYBOOK,
        listingContext: {
          ...LISTING_CONTEXT,
          listing_description: 'a family-friendly house in Lisbon with two bedrooms',
        },
        traits: ['has_children'],
        onFallback: (reason) => reasons.push(reason),
      });
      expect(result).toBeNull();
      expect(reasons).toEqual(['fact_check_refused']);
    });

    it('serves only the physical fact when one slot steers and another states it', async () => {
      const { result } = await run(
        [
          ['headline', 'family-friendly house in Lisbon'],
          ['feature', 'two bedrooms and a garden'],
        ],
        ['has_children'],
      );
      expect(result?.directives.map((d) => d.value)).toEqual(['two bedrooms and a garden']);
    });

    it('refuses steering on EVERY request, with or without the trait', async () => {
      const { result, reasons } = await run([['headline', 'family-friendly house in Lisbon']]);
      expect(result).toBeNull();
      expect(reasons).toEqual(['fact_check_refused']);
    });

    it('refuses PL and ES steering without any trait', async () => {
      for (const value of ['okolica przyjazna rodzinom', 'ideal para familias']) {
        const { result } = await run([['headline', value]]);
        expect(result).toBeNull();
      }
    });
  });
});
