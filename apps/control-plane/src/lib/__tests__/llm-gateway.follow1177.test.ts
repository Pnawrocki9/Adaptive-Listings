/**
 * FOLLOW-1177 — a flag the provenance exemption clears is COUNTABLE, and a flag that never
 * happened is still distinguishable from it.
 *
 * WHY THIS FILE EXISTS. #875/#877's exemption sets `violation = null` and falls through. Traced
 * register by register (RETRO-319 §3 CHECK B′), a `cta` flag that used to write a
 * `fact_check_judge_*` row, a `*_fact_check_rejected` row, a `console.warn` and a Sentry event
 * now writes NOTHING. MP-012's `overrides ÷ flags` therefore silently became a rate over the
 * non-exempt slots only, and a green FOLLOW-1022 canary became weaker evidence about the CTA
 * axis than it was before the deploy — a change in what a green means, recorded nowhere.
 *
 * THE ONE THAT MATTERS, and it is this ticket's AC(2): a counter that cannot separate **"the
 * scan flagged it and the slot is exempt"** from **"the scan never flagged it"** is worthless —
 * it re-creates precisely the blindness MP-012's `watch_status` describes for the canary, where
 * a served batch looks identical whether a flag was cleared or never raised. Both populations
 * are exercised here against the same slot on the same band, and the shipped CTA is measured to
 * belong to the first: `Request Investment Pack` DOES flag `hallucinated_proper_name` (the
 * `Pack` token, RETRO-319) and is cleared only by provenance.
 *
 * WHAT ELSE IS PINNED:
 *
 *   1. RED-FIRST — the exemption fires on the shipped CTA and writes one row tagged with the
 *      BAND. Against `96bf1554` this fails: no row of any kind exists.
 *   2. EXEMPTION FIRED vs FELL THROUGH (RETRO-320's added AC) — a model-written CTA is
 *      adjudicated and writes a judge row, not an exemption row, on the same slot.
 *   3. A `{token}` in the authored CTA silently disables the exemption for that archetype
 *      (FOLLOW-1179). This register is the signal that makes it visible: the row moves from the
 *      exemption bucket to the judge's.
 *   4. NOT A VERDICT — the row is invisible to `source LIKE 'fact_check_judge%'`.
 *
 * The sibling file `llm-gateway.follow1183.test.ts` pins the OTHER silent population on the same
 * register (an over-budget batch). The two tickets ship in one PR and stay separately closable —
 * this file is FOLLOW-1177's evidence and only that.
 *
 * The REAL `yield_hunter` playbook is used throughout, never `MOCK_PLAYBOOK` (RETRO-316 §4c).
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway.follow1177.test
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

const SIMILARITY_HAIKU_BAND = 0.75;
const SIMILARITY_SONNET_BAND = 0.5;

const LISTING_CONTEXT: Record<string, string> = {
  headline: 'Sunlit apartment with river views',
  description: 'A calm, well-connected home in the old town.',
  bedrooms: '3',
  living_area: '128.5',
  location: 'Alfama, Lisbon',
};

/** Measured to flag: a model-written CTA carrying an invented agency name. */
const INVENTED_CTA = 'Book a Viewing with Knight Frank';

/**
 * Measured NOT to flag: every capitalised word is segment-initial, which the token scan exempts
 * (MP-012's own table, row 4). This is the "the scan never flagged it" arm of AC(2), and it must
 * be a value the scan really passes rather than one assumed to.
 */
const NEVER_FLAGGING_CTA = 'Request a viewing today';

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

const BASE_INPUT = {
  archetypeId: 'yield_hunter' as const,
  confidence: 0.75,
  basePlaybook: YIELD_HUNTER,
  listingContext: LISTING_CONTEXT,
};

/**
 * The real playbook with ONE authored `cta` swapped, and no variant arms.
 *
 * `isTemplateAuthoredValue` matches against `[slot.en, ...variants.en]`, so an empty `variants.en`
 * makes the authored population exactly the string passed here — which is what lets a spec below
 * isolate the provenance conjunct from everything else in the entry.
 */
function playbookWithCta(en: string) {
  return {
    ...YIELD_HUNTER,
    slots: YIELD_HUNTER.slots.map((s) =>
      s.slot === 'cta' ? { ...s, en, variants: { en: [] } } : s,
    ),
  };
}

function generationModel(): unknown {
  return (mockCreate.mock.calls[0]?.[0] as { model?: unknown } | undefined)?.model;
}

interface RegisterRow {
  source: string;
  model: string;
  tokensIn: string;
  costUsd: string;
}

function registerRows(): RegisterRow[] {
  return (mockFetch.mock.calls as unknown as [string][])
    .map(([url]) => {
      try {
        const p = new URL(url).searchParams;
        const source = p.get('param_p_source');
        if (!source) return null;
        return {
          source,
          model: p.get('param_p_model') ?? '',
          tokensIn: p.get('param_p_tokens_in') ?? '',
          costUsd: p.get('param_p_cost_usd') ?? '',
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is RegisterRow => r !== null);
}

/** The exact predicate MP-012's saved denominator query uses. */
function judgeVerdictRows(): string[] {
  return registerRows()
    .map((r) => r.source)
    .filter((s) => s.startsWith('fact_check_judge'));
}

function exemptionRows(): RegisterRow[] {
  return registerRows().filter((r) => r.source === 'fact_check_unjudged_exempt_authored');
}

describe('FOLLOW-1177 — the provenance exemption is countable', () => {
  const savedDbUrl = process.env.DATABASE_URL;
  const savedSupabaseDbUrl = process.env.SUPABASE_DB_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1177';
    process.env.CLICKHOUSE_URL = 'http://localhost:8123';
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

  describe('RED-FIRST — the exemption fires and the register says so', () => {
    it('HAIKU band: the shipped CTA is exempted and writes ONE row tagged with the band', async () => {
      expect(SHIPPED_CTA).toBe('Request Investment Pack');
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(directives(['cta', SHIPPED_CTA])))
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_HAIKU_BAND });

      expect(generationModel()).toBe(HAIKU);
      expect(mockCreate).toHaveBeenCalledTimes(1); // no judge round trip — the exemption's win
      expect(result?.directives).toHaveLength(1);

      const rows = exemptionRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.model).toBe(HAIKU);
      // Free by construction: the exemption clears the flag without calling anything.
      expect(rows[0]?.tokensIn).toBe('0');
      expect(rows[0]?.costUsd).toBe('0');
    });

    it('SONNET band: the same exemption on the other band is tagged with the other model', async () => {
      // `buildSonnetPrompt` never shows the model the authored CTA, so this is the coincidence
      // case — and it is exactly the case whose RATE distinguishes the two bands (RETRO-320).
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(directives(['cta', SHIPPED_CTA])))
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      expect(generationModel()).toBe(SONNET);
      expect(result?.directives).toHaveLength(1);
      expect(exemptionRows()).toHaveLength(1);
      expect(exemptionRows()[0]?.model).toBe(SONNET);
    });
  });

  describe('AC(2) — flagged-and-exempt is distinguishable from never-flagged', () => {
    it('HAIKU band: a CTA the scan never flags writes NO exemption row', async () => {
      // Same slot, same band, same served outcome, one Anthropic call in both cases. Before this
      // register the two were indistinguishable everywhere — in `llm_calls`, in the logs and in
      // the canary's verdict. A counter that could not separate them would restate the problem.
      mockCreate.mockResolvedValueOnce(anthropicResponse(directives(['cta', NEVER_FLAGGING_CTA])));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_HAIKU_BAND });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(result?.directives).toHaveLength(1);
      expect(exemptionRows()).toEqual([]);
      expect(judgeVerdictRows()).toEqual([]);
    });

    it('HAIKU band: the shipped CTA really does FLAG — the exemption is what clears it, not the scan', async () => {
      // The control that makes the row above mean something. Under a playbook whose authored
      // CTA cannot match, the identical value takes a judge round trip: the scan flags it, and
      // only provenance was ever standing between it and the judge.
      const otherCta = playbookWithCta('See this home');
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(directives(['cta', SHIPPED_CTA])))
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      await callLlmGateway({
        ...BASE_INPUT,
        basePlaybook: otherCta,
        similarity: SIMILARITY_HAIKU_BAND,
      });

      expect(mockCreate).toHaveBeenCalledTimes(2); // generation + one adjudication
      expect(judgeVerdictRows()).toEqual(['fact_check_judge_override']);
      expect(exemptionRows()).toEqual([]);
    });
  });

  describe('exemption FIRED vs FELL THROUGH — the distinction RETRO-320 had to measure by hand', () => {
    it('HAIKU band: a model-written CTA is adjudicated, and the register says adjudicated, not exempt', async () => {
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(directives(['cta', INVENTED_CTA])))
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_HAIKU_BAND });

      expect(judgeVerdictRows()).toEqual(['fact_check_judge_override']);
      expect(exemptionRows()).toEqual([]);
    });

    it('HAIKU band: a `{token}` in the authored CTA moves the row from exempt to judged [FOLLOW-1179]', async () => {
      // FOLLOW-1179's finding, made visible. `isTemplateAuthoredValue` compares the model's
      // RENDERED output against the RAW authored string, so an archetype whose CTA carries a
      // placeholder can never satisfy the provenance conjunct — the exemption is silently off
      // for that archetype. It stops being silent here: the flag lands in the judge's bucket.
      const tokenisedCta = playbookWithCta('Request the {city} Investment Pack');
      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(directives(['cta', 'Request the Alfama Investment Pack'])),
        )
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      await callLlmGateway({
        ...BASE_INPUT,
        basePlaybook: tokenisedCta,
        similarity: SIMILARITY_HAIKU_BAND,
      });

      expect(judgeVerdictRows()).toEqual(['fact_check_judge_override']);
      expect(exemptionRows()).toEqual([]);
    });
  });

  describe('not a verdict, and not a change of verdict', () => {
    it('HAIKU band: the exemption row is invisible to MP-012 saved denominator query', async () => {
      mockCreate.mockResolvedValueOnce(anthropicResponse(directives(['cta', SHIPPED_CTA])));

      await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_HAIKU_BAND });

      expect(exemptionRows()).toHaveLength(1);
      expect(judgeVerdictRows()).toEqual([]);
    });

    it('HAIKU band: the batch is still SERVED and the generation row still says so', async () => {
      mockCreate.mockResolvedValueOnce(
        anthropicResponse(
          directives(['cta', SHIPPED_CTA], ['headline', 'Sunlit apartment with river views']),
        ),
      );

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_HAIKU_BAND });

      expect(result?.directives).toHaveLength(2);
      expect(registerRows().map((r) => r.source)).toContain('llm_tweaked');
    });
  });
});
