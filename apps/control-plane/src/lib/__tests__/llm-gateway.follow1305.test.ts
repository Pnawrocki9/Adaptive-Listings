/**
 * FOLLOW-1305 (Codex WP01, FOLLOW-820 condition 1c) — the REAL gateway refuses unsupported
 * claims before it returns directives.
 *
 * Inverts the archive's reproduction (docs/audits/revalidation-2026-10-08/probes/gateway.test.ts),
 * which asserted that `callLlmGateway` SERVED an invented pool and sea view, a guarantee, and the
 * listing price re-read as an area. Here the same shapes must be refused with
 * `fallback_reason: 'fact_check_refused'` — and the positive control on the SAME listing must
 * still be served. Only the Anthropic client and the global `fetch` (spend counter / ClickHouse)
 * are replaced; the gateway, its fact check and the playbook are real.
 *
 * Whole-batch refusal is unchanged (CEO is deciding per-slot separately): one unsupported slot
 * takes the batch down, which the mixed-batch case pins.
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway.follow1305.test
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
const { getPlaybook } = await import('@estalara/sdk/playbooks');

const YIELD_HUNTER = getPlaybook('yield_hunter');

/** The Codex probe's listing, with the price and a location made explicit. */
const LISTING_CONTEXT: Record<string, string> = {
  listing_title: 'apartment',
  listing_description: 'an apartment with two bedrooms and no pool',
  listing_price: '400000',
  listing_location: 'Lisbon',
};

function anthropicResponse(pairs: [slot: string, value: string][]) {
  const text = JSON.stringify(
    pairs.map(([slot, value]) => ({
      type: 'text',
      slot,
      value,
      archetype: 'yield_hunter',
      confidence: 0.8,
    })),
  );
  return {
    content: [{ type: 'text' as const, text }],
    usage: { input_tokens: 150, output_tokens: 50 },
  };
}

type FallbackReason = NonNullable<AdaptationDirectives['fallback_reason']>;

async function run(pairs: [slot: string, value: string][]) {
  mockCreate.mockResolvedValue(anthropicResponse(pairs));
  const reasons: FallbackReason[] = [];
  const result = await callLlmGateway({
    archetypeId: 'yield_hunter',
    confidence: 0.75,
    similarity: 0.75, // Haiku tweak band → `llm_tweaked` at the route
    basePlaybook: YIELD_HUNTER,
    listingContext: LISTING_CONTEXT,
    onFallback: (reason) => reasons.push(reason),
  });
  return { result, reasons };
}

const NEGATIVE_CORPUS: Record<string, string> = {
  unsupported_yield: 'Apartment in Lisbon with a 9.9% yield',
  invented_pool: 'Apartment in Lisbon with a private pool',
  invented_sea_view: 'Apartment in Lisbon with sea views',
  pool_and_sea_view: 'Private pool and sea view',
  guarantee_income: 'Guaranteed rental income in Lisbon',
  guarantee_no_work: 'Nothing here needs work before it earns',
  price_as_area: 'Apartment with 400000 square metres',
};

describe('FOLLOW-1305 — the gateway refuses unsupported claims (both bands share the check)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1305';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: '0', data: [{ total: '0' }] }),
      text: () => Promise.resolve(''),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const [name, value] of Object.entries(NEGATIVE_CORPUS)) {
    it(`negative: ${name} — "${value}" is refused (fact_check_refused), no directives`, async () => {
      const { result, reasons } = await run([['headline', value]]);
      expect(result).toBeNull();
      expect(reasons).toEqual(['fact_check_refused']);
      // Deterministic: no judge round trip can overrule it.
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  }

  it('positive control: the same listing, a supported transformation only, is served', async () => {
    const { result, reasons } = await run([['headline', 'Two-bedroom apartment in Lisbon']]);
    expect(reasons).toEqual([]);
    expect(result?.directives.map((d) => d.value)).toEqual(['Two-bedroom apartment in Lisbon']);
  });

  it('whole-batch policy unchanged: one unsupported slot refuses the grounded ones with it', async () => {
    const { result, reasons } = await run([
      ['headline', 'Two-bedroom apartment in Lisbon'],
      ['cta', 'Ask about the private pool'],
    ]);
    expect(result).toBeNull();
    expect(reasons).toEqual(['fact_check_refused']);
  });

  it('a negated listing fact is not evidence: "no pool" does not ground a pool', async () => {
    const { result } = await run([['headline', 'Apartment with a pool']]);
    expect(result).toBeNull();
  });

  it('copy that itself negates an amenity asserts nothing about it and is served', async () => {
    const { result } = await run([['headline', 'Two-bedroom apartment, no pool to maintain']]);
    expect(result?.directives).toHaveLength(1);
  });
});
