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
 * FOLLOW-1312 (CEO ruling 2026-10-11): the SLOT is the unit of refusal. One unsupported slot is
 * refused and the grounded slots of the same batch are served; only a batch whose every slot is
 * refused is refused as a whole. The mixed-batch cases pin both halves.
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
const { getPlaybook } = await import('@estalara/shared/playbooks');

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

/** The `llm_calls` sources the gateway wrote through the stubbed `fetch`, in order. */
function sources(): string[] {
  return (mockFetch.mock.calls as unknown as [unknown][])
    .map(([url]) => {
      try {
        return new URL(String(url)).searchParams.get('param_p_source');
      } catch {
        return null;
      }
    })
    .filter((src): src is string => !!src);
}
const generationSources = () => sources().filter((src) => src.startsWith('llm_'));
const slotRefusedSources = () =>
  sources().filter((src) => src.startsWith('fact_check_slot_refused_'));

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

  it('FOLLOW-1312 pinned case: one invented slot + two grounded → two served, one refused, llm_tweaked', async () => {
    process.env.CLICKHOUSE_URL = 'http://localhost:8123';
    try {
      const { result, reasons } = await run([
        ['headline', 'Two-bedroom apartment in Lisbon'],
        ['cta', 'Ask about the private pool'],
        ['feature', 'Apartment with two bedrooms'],
      ]);
      // Served (non-null, no fallback reason) is what makes the route answer `llm_tweaked` on
      // this band (`route.ts`: `if (gatewayResult) return { …, source: llmSource }`).
      expect(reasons).toEqual([]);
      expect(result?.directives.map((d) => d.slot)).toEqual(['headline', 'feature']);
      expect(generationSources()).toEqual(['llm_tweaked']);
      expect(slotRefusedSources()).toEqual(['fact_check_slot_refused_cta_unsupported_amenity']);
    } finally {
      delete process.env.CLICKHOUSE_URL;
    }
  });

  for (const [name, value] of Object.entries(NEGATIVE_CORPUS)) {
    it(`slot-level negative: ${name} in the cta is refused, the two grounded slots are served`, async () => {
      process.env.CLICKHOUSE_URL = 'http://localhost:8123';
      try {
        const { result, reasons } = await run([
          ['headline', 'Two-bedroom apartment in Lisbon'],
          ['cta', value],
          ['feature', 'Apartment with two bedrooms'],
        ]);
        expect(reasons).toEqual([]);
        expect(result?.directives.map((d) => d.slot)).toEqual(['headline', 'feature']);
        expect(result?.directives.map((d) => d.value)).not.toContain(value);
        const refused = slotRefusedSources();
        expect(refused).toHaveLength(1);
        expect(refused[0]).toMatch(/^fact_check_slot_refused_cta_/);
      } finally {
        delete process.env.CLICKHOUSE_URL;
      }
    });
  }

  it('every slot invented → the whole request is refused, exactly as before FOLLOW-1312', async () => {
    process.env.CLICKHOUSE_URL = 'http://localhost:8123';
    try {
      const { result, reasons } = await run([
        ['headline', 'Apartment in Lisbon with a private pool'],
        ['cta', 'Guaranteed rental income in Lisbon'],
        ['feature', 'Apartment with 400000 square metres'],
      ]);
      expect(result).toBeNull();
      expect(reasons).toEqual(['fact_check_refused']);
      expect(generationSources()).toEqual(['llm_tweaked_fact_check_rejected']);
      expect(slotRefusedSources()).toEqual([
        'fact_check_slot_refused_headline_unsupported_amenity',
        'fact_check_slot_refused_cta_unsupported_guarantee',
        'fact_check_slot_refused_feature_unit_mismatch',
      ]);
    } finally {
      delete process.env.CLICKHOUSE_URL;
    }
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
