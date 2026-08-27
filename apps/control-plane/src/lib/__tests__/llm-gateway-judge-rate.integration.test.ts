/**
 * FOLLOW-1173 AC(4) — the judge round-trip rate, measured rather than argued.
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

describe('FOLLOW-1173 — judge round-trip rate on the directive path', () => {
  it.skipIf(!process.env.ANTHROPIC_API_KEY)(
    'measures how many requests pay for a judge, and how many lose their batch',
    async () => {
      const rows: { run: number; calls: number; survived: boolean; value: string }[] = [];

      for (let run = 0; run < RUNS; run++) {
        counter.calls = 0;
        const result = await callLlmGateway({
          archetypeId: 'yield_hunter',
          confidence: 0.75,
          similarity: 0.75,
          basePlaybook: getPlaybook('yield_hunter'),
          listingContext: LISTING_CONTEXT,
          sessionId: `follow1173-judge-rate-${String(run)}`,
          tenantId: 'follow1173-judge-rate',
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
        `\nFOLLOW-1173-JUDGE-RATE runs=${String(RUNS)} judged=${String(judged)} ` +
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
    },
    600_000,
  );
});
