/**
 * FOLLOW-1180 — the tweak band's judge budget was derived from an exemption that can only fire
 * in ENGLISH, and this file is the first non-English case anywhere on this path.
 *
 * WHY THIS FILE EXISTS. #880 replaced a flat `MAX_JUDGE_CALLS_PER_REQUEST = 2` with a per-band
 * budget and DERIVED each number. The tweak band's derivation read _"Three slots minus the one
 * the prompt makes exempt-able leaves two adjudicable flags."_ The exempt-able one is the `cta`,
 * and it is exempt-able only because `buildHaikuPrompt` renders `value: s.en` and
 * `isTemplateAuthoredValue` compares against `[s.en, ...(s.variants?.en ?? [])]`. There is no
 * non-English authored string anywhere in the playbooks for that predicate to match (RETRO-321
 * §4a LG-1 census: 17 `slot: 'cta'` entries, every one `{ slot, en }` only).
 *
 * It needs nothing authored to bite. `GROUNDING_RULE` tells the model, in the prompt, that the
 * context may be in another language and to quote its nouns AS WRITTEN, the estate serves
 * EU/UK/UAE, and [MP-012]'s third act is a fully obedient FRENCH headline dying on `Potentiel`.
 * So on a French listing the model writes a French `cta`, the provenance exemption cannot fire,
 * and the tweak band has THREE adjudicable flags against a budget that was sized for two — the
 * exact starvation FOLLOW-1178 fixed on the Sonnet band, left standing on the band FOLLOW-819's
 * harness actually drives (`similarity: 0.85` → Haiku).
 *
 * WHAT IS PINNED, and every title names its band (Rule AV):
 *
 *   1. RED-FIRST, PAIRED — RETRO-321 §4a LG-1's two probe rows on the HAIKU band, judge
 *      grounding everything: a French `cta` and, as CONTROL, the SHIPPED English `cta` read off
 *      the playbook. Same batch, same band, same judge; only the CTA's LANGUAGE differs. The
 *      CONTROL is green on both sides of the fix, so a reader can attribute the difference to
 *      the language and to nothing else in the batch.
 *   2. A whole French batch on a French listing — the realistic shape, not just the isolator.
 *   3. The futility rule survives the bigger budget: FOUR flags still exceed it and still cost
 *      zero judge round trips on the HAIKU band.
 *   4. The BAND control: the same French batch on the Sonnet band was already served before this
 *      ticket, because that band's budget was already the worst case. It is the second half of
 *      the isolation — the tweak band, not the language alone, was the outlier.
 *
 * The REAL `yield_hunter` playbook is used throughout, never `MOCK_PLAYBOOK` (RETRO-316 §4c).
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway.follow1180.test
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

const HAIKU = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-4-6';

/** `0.6 < similarity <= 0.85` → Haiku (the band FOLLOW-819's harness drives); else Sonnet. */
const SIMILARITY_HAIKU_BAND = 0.75;
const SIMILARITY_SONNET_BAND = 0.5;

/**
 * The ENGLISH listing context RETRO-321's probe used, kept byte-identical to
 * `llm-gateway.follow1178.test.ts` so the paired rows below are comparable across the two files.
 * Its vocabulary contains none of the proper names the probes write.
 */
const LISTING_CONTEXT: Record<string, string> = {
  headline: 'Sunlit apartment with river views',
  description: 'A calm, well-connected home in the old town.',
  bedrooms: '3',
  living_area: '128.5',
  location: 'Alfama, Lisbon',
};

/**
 * The same property, described in French — what a Paris or Lisbon agency actually serves, and
 * what `GROUNDING_RULE` then instructs the model to quote as written.
 */
const LISTING_CONTEXT_FR: Record<string, string> = {
  headline: 'Appartement lumineux avec vue sur le fleuve',
  description: 'Un logement calme et bien desservi dans la vieille ville.',
  bedrooms: '3',
  living_area: '128.5',
  location: 'Alfama, Lisbonne',
};

/** The two values RETRO-321 §4a LG-1 held constant across its paired rows. */
const FLAGGING_HEADLINE = 'Riverside Quarter apartment';
const FLAGGING_FEATURE = 'Investment Performance';

/**
 * The axis under test: the `cta` the model writes on a French listing. Title-Cased French, i.e.
 * [MP-012]'s coinage class — `Dossier` is mid-segment, capitalised and absent from the grounding,
 * so the scan flags it exactly as it flags an English invention. The judge tier is the control
 * designed for this class; the budget is what decides whether the judge is ever asked.
 */
const FRENCH_CTA = 'Demander le Dossier Investissement';

/** A fully French batch: `Potentiel`, `Dossier` and `Locatif` each flag, one per slot. */
const FRENCH_HEADLINE = 'Appartement calme à Lisbonne, fort Potentiel locatif';
const FRENCH_FEATURE = 'Rendement Locatif attractif';

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

/** The model the GENERATION call actually used — a band claim here is read, never assumed. */
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

describe('FOLLOW-1180 — the tweak-band budget on a non-English listing', () => {
  const savedDbUrl = process.env.DATABASE_URL;
  const savedSupabaseDbUrl = process.env.SUPABASE_DB_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1180';
    // `logLlmCallAsync` no-ops without a ClickHouse URL and `judgeSourcesFromFetch` reads the
    // rows it writes — without this the judge-row assertions below would pass vacuously.
    process.env.CLICKHOUSE_URL = 'http://localhost:8123';
    // The Sonnet band resolves its model through `getGlobalGenerationModel()`, which returns
    // `DEFAULT_GENERATION_MODEL` with no DB configured and THROWS when one is configured but
    // unreachable. Unsetting both makes the band deterministic here.
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

  describe('RED-FIRST, PAIRED — HAIKU band (tweak, similarity 0.75), judge grounds everything', () => {
    it('HAIKU band: serves a batch whose only non-English element is the `cta` — it was REFUSED by budget starvation', async () => {
      // RETRO-321 §4a LG-1 row 1, measured at `97048606`: 1 Anthropic call, zero judge rows,
      // REFUSED. Nothing about this batch is ungrounded that the CONTROL's is not; the French
      // `cta` simply cannot satisfy a predicate that only knows `s.en`, so it joins the flag
      // population and pushes it past a budget derived on the assumption that it would not.
      // On branch 4 that refusal is a ZERO-directive response (§E.7.0 removed the template
      // fallback), so the buyer sees the agent's own copy and the differentiator does not fire.
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(threeSlotBatch(FRENCH_CTA)))
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_HAIKU_BAND });

      expect(generationModel()).toBe(HAIKU);
      // 1 generation + 3 adjudications. Before this ticket: 1 and a null result.
      expect(mockCreate).toHaveBeenCalledTimes(4);
      expect(result?.directives).toHaveLength(3);
      expect(result?.directives.map((d) => d.value)).toEqual([
        FRENCH_CTA,
        FLAGGING_HEADLINE,
        FLAGGING_FEATURE,
      ]);
      expect(judgeSourcesFromFetch()).toEqual([
        'fact_check_judge_override',
        'fact_check_judge_override',
        'fact_check_judge_override',
      ]);
    });

    it('HAIKU band CONTROL: the same batch with the SHIPPED English cta was served before this ticket and still is', async () => {
      // The isolator. Only the `cta` differs from the row above. The provenance exemption fires
      // — because this string IS `s.en` — two flags remain, and two flags fitted the old budget
      // as they fit the new one. GREEN ON BOTH SIDES OF THE FIX, which is what licenses reading
      // the row above as an effect of the LANGUAGE and of nothing else.
      expect(SHIPPED_CTA).toBe('Request Investment Pack');
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(threeSlotBatch(SHIPPED_CTA)))
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_HAIKU_BAND });

      expect(generationModel()).toBe(HAIKU);
      expect(mockCreate).toHaveBeenCalledTimes(3); // 1 generation + 2 adjudications
      expect(result?.directives).toHaveLength(3);
      expect(judgeSourcesFromFetch()).toEqual([
        'fact_check_judge_override',
        'fact_check_judge_override',
      ]);
    });
  });

  describe('the realistic shape — a French listing answered in French, HAIKU band', () => {
    it('HAIKU band: a wholly French batch on a French listing is adjudicated rather than starved', async () => {
      // Not a probe artefact: this is what `GROUNDING_RULE` ASKS the model for on a French
      // listing ("if the context is in another language, do not translate its nouns — quote them
      // as written"). Every slot carries one Title-Cased French token the token scan cannot
      // ground — `Potentiel` is [MP-012]'s own measured act — and `stemLoose` is English-only,
      // so French inflection is a standing false-positive class that the judge tier, and only
      // the judge tier, resolves. With a budget of two the judge was never asked.
      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(
            directives(
              ['headline', FRENCH_HEADLINE],
              ['cta', FRENCH_CTA],
              ['feature', FRENCH_FEATURE],
            ),
          ),
        )
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({
        ...BASE_INPUT,
        listingContext: LISTING_CONTEXT_FR,
        similarity: SIMILARITY_HAIKU_BAND,
      });

      expect(generationModel()).toBe(HAIKU);
      expect(mockCreate).toHaveBeenCalledTimes(4);
      expect(result?.directives).toHaveLength(3);
      expect(judgeSourcesFromFetch()).toHaveLength(3);
    });

    it('HAIKU band: a French batch the judge REFUSES is still discarded — the budget decides who is asked, not the answer', async () => {
      // The other half of the trade. Raising the budget buys adjudication, never absolution:
      // one confirmed flag still takes the batch, in French exactly as in English.
      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(
            directives(
              ['headline', FRENCH_HEADLINE],
              ['cta', FRENCH_CTA],
              ['feature', FRENCH_FEATURE],
            ),
          ),
        )
        .mockResolvedValue(anthropicResponse('{"grounded": false}'));

      const result = await callLlmGateway({
        ...BASE_INPUT,
        listingContext: LISTING_CONTEXT_FR,
        similarity: SIMILARITY_HAIKU_BAND,
      });

      expect(result).toBeNull();
      expect(judgeSourcesFromFetch()).toContain('fact_check_judge_flag_confirmed');
    });
  });

  describe('the futility rule survives the bigger budget', () => {
    it('HAIKU band: FOUR proper-name flags still exceed the budget and still write ZERO judge rows', async () => {
      // GREEN ON BOTH SIDES OF THE FIX (4 > 2 and 4 > 3). #880's price control is not weakened
      // by widening the budget by one: a batch the judge provably cannot save still costs the
      // buyer nothing to refuse.
      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(
            directives(
              ['cta', FRENCH_CTA],
              ['headline', FLAGGING_HEADLINE],
              ['feature', FLAGGING_FEATURE],
              ['subheadline', 'Marina Heights terrace'],
            ),
          ),
        )
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_HAIKU_BAND });

      expect(generationModel()).toBe(HAIKU);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
      expect(judgeSourcesFromFetch()).toEqual([]);
    });
  });

  describe('the BAND control — the same French batch was never starved on Sonnet', () => {
    it('SONNET band (similarity 0.5): the French batch was served before this ticket and still is', async () => {
      // GREEN ON BOTH SIDES OF THE FIX. The generation band's budget was already the worst case
      // ("nothing is exempt-able here"), which is precisely the condition a non-English listing
      // puts the TWEAK band into. This row is why the defect is read as the tweak band's
      // derivation being locale-conditional, rather than as anything about French copy.
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(threeSlotBatch(FRENCH_CTA)))
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      expect(generationModel()).toBe(SONNET);
      expect(mockCreate).toHaveBeenCalledTimes(4);
      expect(result?.directives).toHaveLength(3);
    });
  });
});
