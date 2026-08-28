/**
 * FOLLOW-1178 — the judge budget is a property of the BAND, and every number here says which.
 *
 * WHY THIS FILE EXISTS. #875 and #877 each reported a judge-round-trip price as one number
 * (`0/12 judged, 0/12 discarded, 12/12 at one call`, _"#875's win costs nothing to keep"_).
 * Both measurements ran at `similarity: 0.75`, which `llm-gateway.ts` routes to Haiku — the band
 * where the price is near zero BY CONSTRUCTION, because `buildHaikuPrompt` shows the model the
 * archetype's authored `cta` and the model reproduces it, so #877's provenance exemption fires.
 * `buildSonnetPrompt` shows it nothing of the kind, so on the full-generation band the exemption
 * is satisfiable only by coincidence and the `cta` is an ordinary flag. Every one of the nine
 * `follow1176` specs and both `follow1173` cap specs runs at `0.75`; this band had ZERO coverage
 * in the repository (RETRO-320 §4c TG-1).
 *
 * WHY THE SONNET BAND IS NOT AN EDGE CASE. The SDK sends the RAW ARCHETYPE PROBABILITY as
 * `similarity` (`packages/sdk/src/core/adapt.ts`), and a behaviour-only session's probability sits
 * well below the 0.6 floor of the Haiku window — FOLLOW-819 measured `confidence 0.3655` on
 * exactly that path. `route.ts` additionally defaults `similarity` to `0.5` when the field is
 * absent. So this band is where a real behaviour-only buyer lands, and on branch 4 a refusal there
 * is a ZERO-directive response: §E.7.0 removed the template fallback.
 *
 * WHAT IS PINNED, and every title names its band (Rule AV):
 *
 *   1. RED-FIRST — the RETRO-320 §4a LG-1 batch on the SONNET band, with a judge that grounds
 *      everything it is asked. Discarded before this ticket through budget starvation, served
 *      after it. Paired with the CONTROL row (same batch, same band, the SHIPPED cta) so a reader
 *      can see that the provenance conjunct and nothing else produces the difference.
 *   2. The band asymmetry itself — the same batch behaves differently on Haiku and Sonnet, and
 *      the assertions read the MODEL the gateway actually chose rather than trusting a
 *      `similarity` literal to imply it.
 *   3. Futility — an over-budget batch spends ZERO judge calls instead of `budget` of them, and
 *      reaches the same verdict. Outcome-neutral, latency-positive, and countable: it writes no
 *      `fact_check_judge_*` row.
 *   4. Both FOLLOW-1176 CONTROL rows, transposed onto the SONNET band: an ungrounded FIGURE in a
 *      `cta` is still rejected deterministically and unjudged, and an invented name in a
 *      `headline` is still adjudicated.
 *
 * The REAL `yield_hunter` playbook is used throughout, never `MOCK_PLAYBOOK` (RETRO-316 §4c).
 *
 * **AMENDED BY FOLLOW-1180.** This file's premise — that the tweak band's budget of 2 is
 * complete because the prompt makes the `cta` exempt-able — holds only for an ENGLISH listing:
 * both halves of the exemption are keyed on `s.en`. `JUDGE_CALL_BUDGET_TWEAK_BAND` is now 3,
 * the cross-locale worst case, so the ONE case here that exhibited over-budget futility on the
 * tweak band needed a fourth flag. Nothing else in the file moved, and the asymmetry pinned
 * below is unchanged: the same batch still costs two adjudications on Haiku and three on
 * Sonnet, because the prompts differ even where the budgets now coincide. The non-English
 * counterpart lives in `llm-gateway.follow1180.test.ts`.
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway.follow1178.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { TextDirective } from '@estalara/shared';

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

/** Read from the playbook, not retyped — a re-authoring must fail this file loudly. */
const SHIPPED_CTA = YIELD_HUNTER.slots.find((s) => s.slot === 'cta')?.en ?? '';

/**
 * The two model strings the band split produces. `HAIKU_MODEL` / `SONNET_MODEL` are
 * module-private in `llm-gateway.ts`, so they are restated here and asserted against the model
 * the gateway actually passed to Anthropic — which is what makes "this ran on band X" a
 * measurement rather than a comment.
 */
const HAIKU = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-4-6';

/**
 * `similarity` values, named for the band `llm-gateway.ts` routes them to
 * (`0.6 < similarity <= 0.85` → Haiku, everything else → `getGlobalGenerationModel()`).
 * `SIMILARITY_SONNET_BAND` is the value `route.ts` itself defaults to when the field is absent.
 */
const SIMILARITY_HAIKU_BAND = 0.75;
const SIMILARITY_SONNET_BAND = 0.5;

/**
 * Vocabulary deliberately disjoint from the template's and from the probes': it contains none of
 * the proper names below, so anything the model invents is unbacked and the token scan sees it.
 */
const LISTING_CONTEXT: Record<string, string> = {
  headline: 'Sunlit apartment with river views',
  description: 'A calm, well-connected home in the old town.',
  bedrooms: '3',
  living_area: '128.5',
  location: 'Alfama, Lisbon',
};

/** The exact three values RETRO-320 §4a LG-1 drove across the merge boundary. */
const INVENTED_CTA = 'Book a Viewing with Knight Frank';
const FLAGGING_HEADLINE = 'Riverside Quarter apartment';
const FLAGGING_FEATURE = 'Investment Performance';

function anthropicResponse(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    usage: { input_tokens: 150, output_tokens: 50 },
  };
}

function directives(...pairs: [slot: string, value: string][]): string {
  const list: TextDirective[] = pairs.map(([slot, value]) => ({
    type: 'text',
    slot,
    value,
    archetype: 'yield_hunter',
    confidence: 0.8,
  }));
  return JSON.stringify(list);
}

/** The three-slot batch, parameterised only by the `cta` — the axis under test. */
function threeSlotBatch(cta: string): string {
  return directives(['cta', cta], ['headline', FLAGGING_HEADLINE], ['feature', FLAGGING_FEATURE]);
}

const BASE_INPUT = {
  archetypeId: 'yield_hunter' as const,
  confidence: 0.75,
  basePlaybook: YIELD_HUNTER,
  listingContext: LISTING_CONTEXT,
};

/**
 * The model the GENERATION call actually used. Asserting this — rather than the `similarity`
 * literal that was passed in — is what makes a band claim here a measurement: it survives a
 * future change to the routing thresholds by going red instead of quietly re-labelling itself.
 */
function generationModel(): unknown {
  return (mockCreate.mock.calls[0]?.[0] as { model?: unknown } | undefined)?.model;
}

/** `fact_check_judge_*` rows the judge tier wrote, read off the ClickHouse fetch (FOLLOW-1041). */
function judgeSourcesFromFetch(): string[] {
  return (mockFetch.mock.calls as unknown as [string][])
    .map(([url]) => {
      try {
        return new URL(url).searchParams.get('param_p_source');
      } catch {
        return null;
      }
    })
    .filter((s: string | null): s is string => !!s && s.startsWith('fact_check_judge_'));
}

describe('FOLLOW-1178 — judge budget per band', () => {
  const savedDbUrl = process.env.DATABASE_URL;
  const savedSupabaseDbUrl = process.env.SUPABASE_DB_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1178';
    // `logLlmCallAsync` no-ops without a ClickHouse URL, and `judgeSourcesFromFetch` reads the
    // rows it writes — without this the judge-row assertions below would pass vacuously.
    process.env.CLICKHOUSE_URL = 'http://localhost:8123';
    // The Sonnet band resolves its model through `getGlobalGenerationModel()`, which returns
    // `DEFAULT_GENERATION_MODEL` when no DB is configured and THROWS when one is configured but
    // unreachable. Unsetting both makes the band deterministic here instead of dependent on
    // whatever a developer happens to have exported.
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_DB_URL;
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ total: '0' }] }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLICKHOUSE_URL;
    if (savedDbUrl !== undefined) process.env.DATABASE_URL = savedDbUrl;
    if (savedSupabaseDbUrl !== undefined) process.env.SUPABASE_DB_URL = savedSupabaseDbUrl;
  });

  describe('RED-FIRST — SONNET band (full generation, similarity 0.5): the batch RETRO-320 measured', () => {
    it('SONNET band: serves a three-slot batch whose flags the judge grounds — it was DISCARDED by budget starvation', async () => {
      // The measured failure, verbatim: `cta` and `headline` consumed both budgeted calls and
      // the `feature` — which the judge grounds, as it grounds the other two — was rejected
      // deterministically and took the whole batch with it. On branch 4 that is `directives: []`.
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(threeSlotBatch(INVENTED_CTA)))
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      expect(generationModel()).toBe(SONNET);
      // 1 generation + 3 adjudications. Pre-FOLLOW-1178 this was 1 + 2 and a null result.
      expect(mockCreate).toHaveBeenCalledTimes(4);
      expect(result?.directives).toHaveLength(3);
      expect(result?.directives.map((d) => d.value)).toEqual([
        INVENTED_CTA,
        FLAGGING_HEADLINE,
        FLAGGING_FEATURE,
      ]);
    });

    it('SONNET band CONTROL: the same batch with the SHIPPED cta was served before this ticket and still is', async () => {
      // The conjunct isolator. Only the `cta` differs from the row above; the provenance
      // exemption removes it from the flag population, two flags remain, and two flags always
      // fitted the old budget. A reader can therefore attribute the row above to the budget and
      // to nothing else in the batch.
      expect(SHIPPED_CTA).toBe('Request Investment Pack');
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(threeSlotBatch(SHIPPED_CTA)))
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      expect(generationModel()).toBe(SONNET);
      expect(mockCreate).toHaveBeenCalledTimes(3); // 1 generation + 2 adjudications
      expect(result?.directives).toHaveLength(3);
    });
  });

  describe('the band asymmetry, asserted on both sides', () => {
    it('HAIKU band (tweak, similarity 0.75): two flags fit the 2-call budget and the batch is served', async () => {
      // The population the Haiku budget is sized for: the prompt carries the authored `cta`,
      // the model returns it, provenance exempts it, and the two assertive slots are adjudicated.
      // This is #875's win, restated on the band it was actually measured on.
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(threeSlotBatch(SHIPPED_CTA)))
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_HAIKU_BAND });

      expect(generationModel()).toBe(HAIKU);
      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(result?.directives).toHaveLength(3);
    });

    it('HAIKU band: FOUR flags exceed the budget, so the batch is refused without paying for a single adjudication', async () => {
      // The over-budget shape on the tweak band. WRITTEN WITH THREE FLAGS BY #880, when
      // `JUDGE_CALL_BUDGET_TWEAK_BAND` was 2 "because the prompt makes the `cta` exempt-able";
      // FOLLOW-1180 measured that the exemption fires only in ENGLISH and re-derived the
      // constant to the cross-locale worst case of 3, so the same PROPERTY — more flags than
      // this band's budget costs zero adjudications — now needs a fourth flag to exhibit.
      // The three-flag Haiku batch this ticket moved from refused-for-free to adjudicated is
      // pinned, paired against its English control, in `llm-gateway.follow1180.test.ts`.
      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(
            directives(
              ['cta', INVENTED_CTA],
              ['headline', FLAGGING_HEADLINE],
              ['feature', FLAGGING_FEATURE],
              ['subheadline', 'Marina Heights terrace'],
            ),
          ),
        )
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_HAIKU_BAND });

      expect(generationModel()).toBe(HAIKU);
      expect(mockCreate).toHaveBeenCalledTimes(1); // generation only
      expect(result).toBeNull();
    });
  });

  describe('futility — an over-budget batch is refused for free, and says so countably', () => {
    it('SONNET band: FOUR proper-name flags exceed the 3-call budget and write ZERO judge-verdict rows', async () => {
      // The judge can only ever CLEAR a flag, so with more flags than budget at least one
      // survives unadjudicated and the batch is refused whatever the judge would have said.
      // Spending the budget first is therefore guaranteed waste — up to `budget ×
      // JUDGE_DEADLINE_MS` of a buyer's wait, thrown away. FOLLOW-1041's accounting contract
      // holds: a flag that is never adjudicated contributes no `fact_check_judge_*` row.
      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(
            directives(
              ['cta', INVENTED_CTA],
              ['headline', FLAGGING_HEADLINE],
              ['feature', FLAGGING_FEATURE],
              ['subheadline', 'Marina Heights terrace'],
            ),
          ),
        )
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      expect(generationModel()).toBe(SONNET);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
      expect(judgeSourcesFromFetch()).toEqual([]);
    });

    it('SONNET band: exactly at the budget the judge still runs — futility is > budget, not >= budget', async () => {
      // The off-by-one this rule must not have. Three flags with a budget of three is the case
      // the ticket exists to save, so it must NOT be classified as futile.
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(threeSlotBatch(INVENTED_CTA)))
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      expect(judgeSourcesFromFetch()).toEqual([
        'fact_check_judge_override',
        'fact_check_judge_override',
        'fact_check_judge_override',
      ]);
    });

    it('SONNET band: a within-budget batch the judge REFUSES is still discarded — the budget decides who is asked, not the answer', async () => {
      // The other half of "outcome-neutral": raising the budget must not turn a refusal into a
      // service. One flag, one adjudication, judge says no, batch dies.
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(directives(['headline', FLAGGING_HEADLINE])))
        .mockResolvedValueOnce(anthropicResponse('{"grounded": false}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      expect(generationModel()).toBe(SONNET);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result).toBeNull();
      expect(judgeSourcesFromFetch()).toEqual(['fact_check_judge_flag_confirmed']);
    });
  });

  describe('CONTROL rows from FOLLOW-1176, transposed onto the SONNET band', () => {
    it('SONNET band: an ungrounded FIGURE in a `cta` is still rejected deterministically, unjudged', async () => {
      // Numbers are exempt from nothing on any band. `hallucinated_number` is returned before
      // the proper-name scan, so this never enters the flag population the budget counts.
      mockCreate.mockResolvedValueOnce(
        anthropicResponse(directives(['cta', 'Get the 7.4% Yield Report'])),
      );

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      expect(generationModel()).toBe(SONNET);
      expect(result).toBeNull();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(judgeSourcesFromFetch()).toEqual([]);
    });

    it('SONNET band: an invented name in a `headline` is still adjudicated and still discarded', async () => {
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(directives(['headline', INVENTED_CTA])))
        .mockResolvedValueOnce(anthropicResponse('{"grounded": false}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      expect(generationModel()).toBe(SONNET);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result).toBeNull();
    });

    it('SONNET band: an invented `cta` the judge REFUSES is still discarded — #877 is not weakened by the bigger budget', async () => {
      // FOLLOW-1176's finding must survive this ticket: a model-written CTA is adjudicated, not
      // exempt, and a refusal still costs the batch. Raising the budget changes how many
      // questions get asked; it never changes what counts as an answer.
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(directives(['cta', INVENTED_CTA])))
        .mockResolvedValueOnce(anthropicResponse('{"grounded": false}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      expect(generationModel()).toBe(SONNET);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result).toBeNull();
    });
  });
});
