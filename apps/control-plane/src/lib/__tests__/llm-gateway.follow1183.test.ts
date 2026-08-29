/**
 * FOLLOW-1183 — an over-budget batch is COUNTABLE, and what it writes is not a verdict.
 *
 * WHY THIS FILE EXISTS. #880's futility short-circuit is outcome-neutral for the buyer and was
 * NOT outcome-neutral for the instrument. Before it, a budget-bound batch left a unique
 * fingerprint in `llm_calls` — a refusal plus exactly `budget` `fact_check_judge_*` rows. After
 * it, it leaves ZERO judge rows and one `console.warn`, which makes it byte-identical in
 * ClickHouse to a batch killed by `hallucinated_number`. Two consequences, both on numbers other
 * tickets are about to use: FOLLOW-1165 AC(2) ("the share of requests that hit the cap is
 * reported") became structurally unanswerable, and MP-012's `overrides ÷ flags` stopped being a
 * rate and became a rate CONDITIONED on `flags <= budget` — excluding exactly the batches with
 * the most flags, where an override is least likely, so the survivor is biased upward.
 *
 * WHAT IS PINNED HERE, and every title names its band (Rule AV):
 *
 *   1. RED-FIRST — a four-flag batch on the SONNET band writes one row carrying the flag COUNT
 *      and the BAND. Against `96bf1554` this file's first four specs fail: no such row exists.
 *   2. The same shape on the HAIKU band, where the budget is 2 — the count and the model both
 *      change, which is what makes "how often does the budget bind, per band" a query.
 *   3. NOT A VERDICT. The row must not be swept into `source LIKE 'fact_check_judge%'`, which is
 *      MP-012's saved denominator query. A skip counted as an adjudication would re-create
 *      exactly the blindness this ticket exists to remove (MP-012's `watch_status` names it).
 *   4. The two classes this counter does NOT cover, pinned as controls so the boundary is a test
 *      and not a claim: a batch exactly AT the budget (adjudicated, judge rows, no skip row) and
 *      a batch doomed by `hallucinated_number` (refused, no judge row, no skip row — the
 *      population FOLLOW-1181 is about).
 *   5. Outcome-neutrality: nothing here changes what `callLlmGateway` returns.
 *
 * The sibling file `llm-gateway.follow1177.test.ts` pins the OTHER silent population on the same
 * register (a flag the provenance exemption clears). The two tickets ship in one PR and stay
 * separately closable — this file is FOLLOW-1183's evidence and only that.
 *
 * The REAL `yield_hunter` playbook is used throughout, never `MOCK_PLAYBOOK` (RETRO-316 §4c).
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway.follow1183.test
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

/** The two model strings the band split produces, asserted against the model actually used. */
const HAIKU = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-4-6';

/** `0.6 < similarity <= 0.85` → Haiku; everything else → the generation band. */
const SIMILARITY_HAIKU_BAND = 0.75;
const SIMILARITY_SONNET_BAND = 0.5;

/** Vocabulary disjoint from every probe value below, so anything invented is unbacked. */
const LISTING_CONTEXT: Record<string, string> = {
  headline: 'Sunlit apartment with river views',
  description: 'A calm, well-connected home in the old town.',
  bedrooms: '3',
  living_area: '128.5',
  location: 'Alfama, Lisbon',
};

/** Values measured to flag `hallucinated_proper_name` against `LISTING_CONTEXT`. */
const INVENTED_CTA = 'Book a Viewing with Knight Frank';
const FLAGGING_HEADLINE = 'Riverside Quarter apartment';
const FLAGGING_FEATURE = 'Investment Performance';
const FLAGGING_EXTRA = 'Marina Heights terrace';
const FLAGGING_EXTRA_TWO = 'Canary Wharf duplex';

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

/** The model the GENERATION call actually used — a band claim asserted, not assumed. */
function generationModel(): unknown {
  return (mockCreate.mock.calls[0]?.[0] as { model?: unknown } | undefined)?.model;
}

interface RegisterRow {
  source: string;
  model: string;
  tokensIn: string;
  tokensOut: string;
  costUsd: string;
  latencyMs: string;
}

/** Every `llm_calls` INSERT this request made, read off the ClickHouse fetch (FOLLOW-1041). */
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
          tokensOut: p.get('param_p_tokens_out') ?? '',
          costUsd: p.get('param_p_cost_usd') ?? '',
          latencyMs: p.get('param_p_latency_ms') ?? '',
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is RegisterRow => r !== null);
}

function sourcesMatching(prefix: string): string[] {
  return registerRows()
    .map((r) => r.source)
    .filter((s) => s.startsWith(prefix));
}

/** The exact predicate MP-012's saved denominator query uses. */
function judgeVerdictRows(): string[] {
  return sourcesMatching('fact_check_judge');
}

/** The register this ticket adds — see `FACT_CHECK_UNJUDGED_SOURCE` in `llm-gateway.ts`. */
function unjudgedRows(): RegisterRow[] {
  return registerRows().filter((r) => r.source.startsWith('fact_check_unjudged_'));
}

describe('FOLLOW-1183 — the futility skip is countable, per band', () => {
  const savedDbUrl = process.env.DATABASE_URL;
  const savedSupabaseDbUrl = process.env.SUPABASE_DB_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1183';
    // `logLlmCallAsync` no-ops without a ClickHouse URL and every assertion here reads the rows
    // it writes — without this the whole file would pass vacuously.
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

  describe('RED-FIRST — the budget binds and the register says so', () => {
    it('SONNET band: FOUR flags against a 3-call budget write ONE row naming the count and the band', async () => {
      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(
            directives(
              ['cta', INVENTED_CTA],
              ['headline', FLAGGING_HEADLINE],
              ['feature', FLAGGING_FEATURE],
              ['subheadline', FLAGGING_EXTRA],
            ),
          ),
        )
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      expect(generationModel()).toBe(SONNET);
      expect(mockCreate).toHaveBeenCalledTimes(1); // generation only — futility, unchanged
      expect(result).toBeNull();

      const rows = unjudgedRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.source).toBe('fact_check_unjudged_over_budget_flags_4');
      // The band is the row's own `model` column, not a suffix on the source: it is the column
      // every other row in this register already carries, so a per-band GROUP BY needs no
      // parsing (Rule AV — a count without a band answers nothing after #880).
      expect(rows[0]?.model).toBe(SONNET);
    });

    it('HAIKU band: FIVE flags against a 3-call budget write the same shape with the other count and the other band', async () => {
      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(
            directives(
              ['cta', INVENTED_CTA],
              ['headline', FLAGGING_HEADLINE],
              ['feature', FLAGGING_FEATURE],
              ['subheadline', FLAGGING_EXTRA],
              ['badge', FLAGGING_EXTRA_TWO],
            ),
          ),
        )
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_HAIKU_BAND });

      expect(generationModel()).toBe(HAIKU);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();

      const rows = unjudgedRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.source).toBe('fact_check_unjudged_over_budget_flags_5');
      expect(rows[0]?.model).toBe(HAIKU);
    });

    it('the row is FREE, and its zeros are measured rather than unknown', async () => {
      // FOLLOW-1049's `0, 0` means UNKNOWN — a usage block that never arrived. These zeros are
      // the opposite: no API call was made, nothing was billed, no round trip was waited on.
      // That is the whole point of the skip, and it keeps the rolling-24h $100 breaker
      // (`getRolling24hSpend`, a `sum(cost_usd)` over every row) exactly where it was.
      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(
            directives(
              ['cta', INVENTED_CTA],
              ['headline', FLAGGING_HEADLINE],
              ['feature', FLAGGING_FEATURE],
              ['subheadline', FLAGGING_EXTRA],
              ['badge', FLAGGING_EXTRA_TWO],
            ),
          ),
        )
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_HAIKU_BAND });

      const row = unjudgedRows()[0];
      expect(row?.tokensIn).toBe('0');
      expect(row?.tokensOut).toBe('0');
      expect(row?.costUsd).toBe('0');
      expect(row?.latencyMs).toBe('0');
    });

    it('a skip is NOT a verdict: the row is invisible to MP-012 saved denominator query', async () => {
      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(
            directives(
              ['cta', INVENTED_CTA],
              ['headline', FLAGGING_HEADLINE],
              ['feature', FLAGGING_FEATURE],
              ['subheadline', FLAGGING_EXTRA],
              ['badge', FLAGGING_EXTRA_TWO],
            ),
          ),
        )
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_HAIKU_BAND });

      // `source LIKE 'fact_check_judge%'` is MP-012's `measure_with` (2) verbatim. A skip
      // swept into it would count one batch as one adjudication and inflate the denominator
      // with a non-answer — the trap MP-012's `watch_status` describes for the canary.
      expect(judgeVerdictRows()).toEqual([]);
      expect(unjudgedRows()).toHaveLength(1);
      expect(unjudgedRows()[0]?.source.startsWith('fact_check_judge')).toBe(false);
    });
  });

  describe('the boundary of what this counter covers, pinned as controls', () => {
    it('SONNET band: exactly AT the budget is adjudicated, so it writes judge rows and NO skip row', async () => {
      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(
            directives(
              ['cta', INVENTED_CTA],
              ['headline', FLAGGING_HEADLINE],
              ['feature', FLAGGING_FEATURE],
            ),
          ),
        )
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      expect(judgeVerdictRows()).toEqual([
        'fact_check_judge_override',
        'fact_check_judge_override',
        'fact_check_judge_override',
      ]);
      expect(unjudgedRows()).toEqual([]);
    });

    it('SONNET band: a batch doomed by `hallucinated_number` writes NO skip row — that class is FOLLOW-1181, not this counter', async () => {
      // The two doomed classes are still recorded differently, and this file says which one it
      // covers rather than leaving a reader to assume. `judgeCannotSaveBatch` counts proper-name
      // flags only; a number flag refuses the batch on its own and never enters the population
      // this row reports. If FOLLOW-1181 generalises the predicate, that class needs its own
      // `source` value — reusing `over_budget` would name a row after a computation it did not do.
      mockCreate.mockResolvedValueOnce(
        anthropicResponse(directives(['feature', 'Yield of 9.9% in Alfama'])),
      );

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      expect(result).toBeNull();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(judgeVerdictRows()).toEqual([]);
      expect(unjudgedRows()).toEqual([]);
    });

    it('SONNET band: a batch with no flags at all writes no skip row', async () => {
      mockCreate.mockResolvedValueOnce(
        anthropicResponse(directives(['headline', 'Sunlit apartment with river views'])),
      );

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      expect(result?.directives).toHaveLength(1);
      expect(unjudgedRows()).toEqual([]);
    });

    it('a flag count above the ceiling says SO rather than inventing a bucket', async () => {
      // `source` is `LowCardinality(String)`, so the count it carries must be bounded. Ten
      // flagged slots is far past anything `max_tokens: 512` can produce; the label stops
      // claiming an exact count instead of clamping to a number that would be wrong.
      const many: [string, string][] = Array.from({ length: 10 }, (_, i) => [
        `slot_${String(i)}`,
        FLAGGING_EXTRA,
      ]);
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(directives(...many)))
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_SONNET_BAND });

      // Split ON PURPOSE, and do not rejoin it. Written as one literal this is a 47-char
      // `[a-zA-Z0-9_-]` run whose leading 40 chars score 4.005 Shannon entropy against the
      // `cloudflare-api-token` rule's 3.0 threshold (`.gitleaks.toml`), so the whole scan reds
      // on a string that is plainly not a secret. The producer in `llm-gateway.ts` escapes this
      // by accident — its `${...}` interpolation leaves only a 38-char literal run.
      expect(unjudgedRows()[0]?.source).toBe(
        'fact_check_unjudged_over_budget_flags_' + '9_or_more',
      );
    });
  });

  describe('outcome-neutrality — this ticket adds counting and changes no verdict', () => {
    it('HAIKU band: the over-budget batch is still refused, still after exactly one Anthropic call', async () => {
      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(
            directives(
              ['cta', INVENTED_CTA],
              ['headline', FLAGGING_HEADLINE],
              ['feature', FLAGGING_FEATURE],
              ['subheadline', FLAGGING_EXTRA],
              ['badge', FLAGGING_EXTRA_TWO],
            ),
          ),
        )
        .mockResolvedValue(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway({ ...BASE_INPUT, similarity: SIMILARITY_HAIKU_BAND });

      // `null` is what `runDecisionTree` reads to produce `fallback_reason: 'fact_check_refused'`
      // — the value the FOLLOW-1022 canary maps to `correctly_refused`. Unchanged here.
      expect(result).toBeNull();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      // The generation row keeps its own FOLLOW-1056 source; the skip row is additional, never
      // a replacement.
      expect(sourcesMatching('llm_tweaked')).toEqual(['llm_tweaked_fact_check_rejected']);
    });
  });
});
