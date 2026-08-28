/**
 * FOLLOW-1173 AC(4) — the judge round-trip rate, measured rather than argued.
 *
 * FOLLOW-1178 AC(2) — **and measured PER BAND, because one number here answered the wrong
 * question.** This spec used to run at a hardcoded `similarity: 0.75`, which `llm-gateway.ts`
 * routes to Haiku. #875 and #877 each reported its output as the price of the fact check
 * (`0/12 judged, 0/12 discarded`, _"#875's win costs nothing to keep"_) with no band beside the
 * number. That is the band where the price is near zero BY CONSTRUCTION: `buildHaikuPrompt`
 * shows the model the archetype's authored `cta`, the model reproduces it, and #877's provenance
 * exemption fires. `buildSonnetPrompt` shows it nothing of the kind, so on the full-generation
 * band the `cta` is an ordinary flag — and that band is where a behaviour-only buyer lands
 * (`route.ts` defaults `similarity` to `0.5`; FOLLOW-819 measured `confidence 0.3655`). The loop
 * below therefore runs BOTH bands and reports them as two rows. **A figure taken from this file
 * is quotable only with the word Haiku or Sonnet beside it (Rule AV).**
 *
 * WHY THIS FILE EXISTS AND THE FOLLOW-1166 ONE DOES NOT. #873 measured the same quantity with a
 * throwaway spec that was deleted before commit, so its number survives only as prose in a PR
 * body and nobody can re-run it. RETRO-318 filed that as FOLLOW-1175. This is the artefact: it
 * makes REAL Anthropic calls, so it lives under `vitest.integration.config.ts` (which the standard
 * `pnpm test` excludes) and self-skips without a key — CI reports it skipped, never failed.
 *
 * Run it:
 *   doppler run -c dev -- pnpm --filter @estalara/control-plane test:integration:judge-rate
 *
 * WHAT IT COUNTS. The Anthropic SDK is WRAPPED, not stubbed — the real prompt, the real fact
 * check and the real judge all run — and every `messages.create` is counted per request. One call
 * means nothing was flagged; two or more mean the token scan flagged something and the judge was
 * asked to adjudicate it. `discarded` counts requests where the batch was rejected outright.
 *
 * WHAT A GREEN RUN DOES AND DOES NOT PROVE. The assertion is only that every request completed.
 * The measurement is the logged table — read it, do not infer it from the pass. Numbers move with
 * the model, the playbook and the listing fixture, so a recorded figure is evidence about the day
 * it was taken (Rule AS: production reports false positives and is silent about false negatives).
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway-judge-rate.integration.test
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', async () => {
  const actual = await vi.importActual<{ default: new (o: unknown) => unknown }>(
    '@anthropic-ai/sdk',
  );
  const Real = actual.default;
  const counter = { calls: 0 };
  const Wrapped = function (opts: unknown) {
    const real = new Real(opts) as {
      messages: { create: (a: unknown) => Promise<unknown> };
    };
    return {
      messages: {
        create: (args: unknown) => {
          counter.calls += 1;
          return real.messages.create(args);
        },
      },
    };
  };
  (Wrapped as unknown as Record<string, unknown>).__counter = counter;
  return { default: Wrapped };
});

import Anthropic from '@anthropic-ai/sdk';

const counter = (Anthropic as unknown as { __counter: { calls: number } }).__counter;

const { callLlmGateway } = await import('@/lib/llm-gateway');
const { getPlaybook } = await import('@estalara/sdk/playbooks');

/**
 * Vocabulary deliberately disjoint from `yield_hunter`'s template copy: it contains neither
 * `Pack` nor `Performance`, so any template wording the model carries over is unbacked and the
 * scan sees it. Changing this fixture changes the number — say so if you do.
 */
const LISTING_CONTEXT: Record<string, string> = {
  headline: 'Sunlit apartment with river views',
  description:
    'A calm, well-connected home in the old town, recently renovated, with a south-facing balcony.',
  bedrooms: '3',
  living_area: '128.5',
  location: 'Alfama, Lisbon',
};

/** Enough runs to separate "every request" from "most requests"; small enough to be cheap. */
const RUNS = 12;

/**
 * The two bands, named for what `llm-gateway.ts` routes them to
 * (`0.6 < similarity <= 0.85` → Haiku, everything else → `getGlobalGenerationModel()`).
 * `0.5` is not an arbitrary "other" value: it is what `route.ts` itself defaults to when the
 * field is absent, so the Sonnet row measures the DEFAULT request, not an exotic one.
 */
const BANDS = [
  { band: 'haiku-tweak', similarity: 0.75, budget: 2 },
  { band: 'sonnet-generation', similarity: 0.5, budget: 3 },
] as const;

describe('FOLLOW-1173/1178 — judge round-trip rate on the directive path, per band', () => {
  it.skipIf(!process.env.ANTHROPIC_API_KEY)(
    'measures how many requests pay for a judge, and how many lose their batch — on BOTH bands',
    async () => {
      for (const { band, similarity, budget } of BANDS) {
        const rows: { run: number; calls: number; survived: boolean; value: string }[] = [];

        for (let run = 0; run < RUNS; run++) {
          counter.calls = 0;
          const result = await callLlmGateway({
            archetypeId: 'yield_hunter',
            confidence: 0.75,
            similarity,
            basePlaybook: getPlaybook('yield_hunter'),
            listingContext: LISTING_CONTEXT,
            sessionId: `follow1178-judge-rate-${band}-${String(run)}`,
            tenantId: 'follow1178-judge-rate',
          });
          rows.push({
            run,
            calls: counter.calls,
            survived: result !== null,
            value: result?.directives.map((d) => d.value).join(' | ') ?? '(discarded)',
          });
        }

        const judged = rows.filter((r) => r.calls > 1).length;
        const discarded = rows.filter((r) => !r.survived).length;

        console.log(
          `\nFOLLOW-1178-JUDGE-RATE band=${band} similarity=${String(similarity)} ` +
            `budget=${String(budget)} runs=${String(RUNS)} judged=${String(judged)} ` +
            `discarded=${String(discarded)}\n` +
            rows
              .map(
                (r) =>
                  `  run ${String(r.run)}: calls=${String(r.calls)} ` +
                  `survived=${String(r.survived)} :: ${r.value}`,
              )
              .join('\n'),
        );

        // The measurement is the table above. This only asserts the harness itself ran.
        expect(rows).toHaveLength(RUNS);
      }
    },
    1_200_000,
  );
});
