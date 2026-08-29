/**
 * FOLLOW-1177 AC(5) / FOLLOW-1183 AC(3) — the two `FACT_CHECK_UNJUDGED_SOURCE` rows verified by
 * an EXECUTED run against a real ClickHouse, not by reading the code.
 *
 * WHY THIS FILE EXISTS. Both tickets ask for the signal to be seen firing. The unit specs
 * (`llm-gateway.follow1177.test.ts`, `llm-gateway.follow1183.test.ts`) assert on the INSERT URL a
 * stubbed `fetch` received, which proves the gateway asked for the row but not that a ClickHouse
 * accepts it — `source` is `LowCardinality(String)` and the whole no-DDL argument for putting a
 * flag COUNT in the value rests on that column taking new values without a migration. This spec
 * closes that gap: it runs `callLlmGateway` against a live instance and reads the rows back with
 * MP-012's own predicates.
 *
 * It also answers the half of FOLLOW-1177 AC(5) a stub cannot: the exemption is only interesting
 * if a real model really does reproduce the authored CTA, so the first case makes REAL Anthropic
 * calls and lets the model choose. **If that case ever goes red, the finding is not that the
 * counter broke — it is that the model stopped reproducing the authored `cta`, which is exactly
 * the quantity this register was added to make visible (RETRO-320 §4a LG-1 had to measure it by
 * hand with a throwaway probe).**
 *
 * Run it (local ClickHouse from the FOLLOW-819 substrate, real Anthropic key from Doppler):
 *   docker start estalara_ch_local
 *   CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=default CLICKHOUSE_PASSWORD=clickhouse \
 *     doppler run --project estalara-adaptive-listings --config dev --preserve-env -- \
 *     pnpm --filter @estalara/control-plane test:integration:unjudged-register
 *
 * Self-skips without `CLICKHOUSE_URL` (both cases) and without `ANTHROPIC_API_KEY` (the first),
 * so CI reports it skipped rather than failed — the contract `vitest.integration.config.ts`'s
 * docblock requires of every spec it runs.
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway-unjudged-register.integration.test
 */

import { describe, expect, it, vi } from 'vitest';

/**
 * The real Anthropic SDK, with an opt-in canned reply.
 *
 * The first case needs the real model (only it can answer "does it reproduce our CTA"); the
 * second needs a batch with four proper-name flags, which no prompt can be relied on to produce
 * on demand. One wrapper serves both: with `stub.reply` set, the call is answered locally and
 * Anthropic is never contacted.
 */
vi.mock('@anthropic-ai/sdk', async () => {
  const actual = await vi.importActual<{ default: new (o: unknown) => unknown }>(
    '@anthropic-ai/sdk',
  );
  const Real = actual.default;
  const stub: { reply: string | null } = { reply: null };
  const Wrapped = function (opts: unknown) {
    const real = new Real(opts) as { messages: { create: (a: unknown) => Promise<unknown> } };
    return {
      messages: {
        create: (args: unknown) => {
          if (stub.reply !== null) {
            return Promise.resolve({
              content: [{ type: 'text', text: stub.reply }],
              usage: { input_tokens: 0, output_tokens: 0 },
            });
          }
          return real.messages.create(args);
        },
      },
    };
  };
  (Wrapped as unknown as Record<string, unknown>).__stub = stub;
  return { default: Wrapped };
});

import Anthropic from '@anthropic-ai/sdk';

const stub = (Anthropic as unknown as { __stub: { reply: string | null } }).__stub;

const { callLlmGateway } = await import('@/lib/llm-gateway');
const { getPlaybook } = await import('@estalara/sdk/playbooks');
const { clickhouseAuthHeaders } = await import('@/lib/clickhouse-http');

/** Disjoint from `yield_hunter`'s template copy, so template wording carried over is unbacked. */
const LISTING_CONTEXT: Record<string, string> = {
  headline: 'Sunlit apartment with river views',
  description: 'A calm, well-connected home in the old town.',
  bedrooms: '3',
  living_area: '128.5',
  location: 'Alfama, Lisbon',
};

/** `llm_calls` rows this run wrote, read back from the live instance. */
async function rowsForTenant(tenantId: string): Promise<{ source: string; model: string }[]> {
  const url = new URL(process.env.CLICKHOUSE_URL ?? '');
  const res = await fetch(url.toString(), {
    method: 'POST',
    body:
      `SELECT source, model FROM llm_calls WHERE tenant_id = '${tenantId}' ` +
      `ORDER BY ts FORMAT JSONEachRow`,
    headers: {
      'Content-Type': 'text/plain',
      ...clickhouseAuthHeaders({
        user: process.env.CLICKHOUSE_USER ?? 'default',
        password: process.env.CLICKHOUSE_PASSWORD ?? '',
      }),
    },
  });
  const text = await res.text();
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as { source: string; model: string });
}

/**
 * The register write is fire-and-forget (`afterResponse` falls back to un-awaited outside a
 * request scope), so the INSERT is in flight when `callLlmGateway` returns. This waits for it
 * rather than racing it.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2000));
}

describe('FOLLOW-1177 / FOLLOW-1183 — the unjudged register, against a live ClickHouse', () => {
  it.skipIf(!process.env.CLICKHOUSE_URL || !process.env.ANTHROPIC_API_KEY)(
    'FOLLOW-1177: a REAL Haiku-band request books `fact_check_unjudged_exempt_authored`',
    async () => {
      stub.reply = null;
      const tenantId = `follow1177-exempt-${String(Date.now())}`;
      const rows: { source: string; model: string }[] = [];

      for (let run = 0; run < 3; run++) {
        await callLlmGateway({
          archetypeId: 'yield_hunter',
          confidence: 0.75,
          similarity: 0.75, // Haiku tweak band — the prompt carries the authored `cta`
          basePlaybook: getPlaybook('yield_hunter'),
          listingContext: LISTING_CONTEXT,
          sessionId: `follow1177-exempt-${String(run)}`,
          tenantId,
        });
      }
      await settle();
      rows.push(...(await rowsForTenant(tenantId)));

      console.log(
        `\nFOLLOW-1177-EXEMPT-LIVE tenant=${tenantId}\n` +
          rows.map((r) => `  ${r.source}  model=${r.model}`).join('\n'),
      );

      const exempt = rows.filter((r) => r.source === 'fact_check_unjudged_exempt_authored');
      expect(exempt.length).toBeGreaterThanOrEqual(1);
      expect(exempt.every((r) => r.model === 'claude-haiku-4-5')).toBe(true);
      // A skip is not a verdict: MP-012's denominator predicate must not see these rows.
      expect(exempt.every((r) => !r.source.startsWith('fact_check_judge'))).toBe(true);
    },
    120_000,
  );

  it.skipIf(!process.env.CLICKHOUSE_URL)(
    'FOLLOW-1183: an over-budget batch books `fact_check_unjudged_over_budget_flags_4`, and ClickHouse takes the value',
    async () => {
      // Four proper-name flags against the Sonnet band's budget of three. Canned, because a
      // real model cannot be asked for this shape on demand — what is being verified here is
      // that the row reaches a real `LowCardinality(String)` column, not the model's behaviour.
      stub.reply = JSON.stringify(
        [
          ['cta', 'Book a Viewing with Knight Frank'],
          ['headline', 'Riverside Quarter apartment'],
          ['feature', 'Investment Performance'],
          ['subheadline', 'Marina Heights terrace'],
        ].map(([slot, value]) => ({
          type: 'text',
          slot,
          value,
          archetype: 'yield_hunter',
          confidence: 0.8,
        })),
      );
      const tenantId = `follow1183-overbudget-${String(Date.now())}`;
      // `callLlmGateway` returns before doing anything without a key. The stub above answers
      // every call, so a placeholder is enough here and no Anthropic request is made — which is
      // why this case skips on ClickHouse alone while the FOLLOW-1177 case skips on both.
      const savedKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = savedKey ?? 'stubbed-no-call-is-made';

      const result = await callLlmGateway({
        archetypeId: 'yield_hunter',
        confidence: 0.75,
        similarity: 0.5, // Sonnet generation band — budget 3
        basePlaybook: getPlaybook('yield_hunter'),
        listingContext: LISTING_CONTEXT,
        sessionId: 'follow1183-overbudget',
        tenantId,
      });
      await settle();
      const rows = await rowsForTenant(tenantId);
      stub.reply = null;
      if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;

      console.log(
        `\nFOLLOW-1183-OVERBUDGET-LIVE tenant=${tenantId} refused=${String(result === null)}\n` +
          rows.map((r) => `  ${r.source}  model=${r.model}`).join('\n'),
      );

      expect(result).toBeNull(); // outcome-neutral: still refused
      const skip = rows.filter((r) => r.source.startsWith('fact_check_unjudged_over_budget'));
      expect(skip).toHaveLength(1);
      expect(skip[0]?.source).toBe('fact_check_unjudged_over_budget_flags_4');
      expect(skip[0]?.model).toBe('claude-sonnet-4-6');
      // MP-012's `measure_with` (2) predicate, run against the live rows this batch produced.
      expect(rows.filter((r) => r.source.startsWith('fact_check_judge'))).toEqual([]);
    },
    120_000,
  );
});
