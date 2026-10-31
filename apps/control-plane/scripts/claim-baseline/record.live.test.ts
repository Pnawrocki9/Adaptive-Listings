// @vitest-environment node
/**
 * FOLLOW-1311 slice 0: record the frozen claim baseline against the real model. Skipped unless
 * `CLAIM_BASELINE_RECORD=1`. Run once, by hand, from `apps/control-plane`:
 *
 *   CLAIM_BASELINE_RECORD=1 doppler run -c dev --only-secrets ANTHROPIC_API_KEY -- \
 *     ./node_modules/.bin/vitest run scripts/claim-baseline/record.live.test.ts \
 *     --pool=forks --poolOptions.forks.singleFork=true
 *
 * Every sink is stubbed and `fetch` reaches api.anthropic.com only: nothing is written anywhere
 * except `fixtures/raw.v1.jsonl`. The run stops itself above `SPEND_STOP_USD`.
 *
 * @module apps/control-plane/scripts/claim-baseline/record.live.test
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, vi } from 'vitest';
import {
  FIXTURES,
  adaptInput,
  baselineCases,
  descriptionEvent,
  groupedSha256,
  type RecordedCall,
} from './shared';

const SPEND_STOP_USD = 5;
const RAW = path.join(FIXTURES, 'raw.v1.jsonl');

const { sink } = vi.hoisted(() => ({
  sink: { calls: [] as unknown[], inputTokens: 0, outputTokens: 0 },
}));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const real = (await importOriginal<{ default: new (o: unknown) => any }>()).default; // eslint-disable-line @typescript-eslint/no-explicit-any -- throwaway SDK wrapper of a recorder
  return {
    default: class {
      private readonly client: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- as above
      messages: { create: (params: any, options?: unknown) => Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any -- as above
      constructor(options: unknown) {
        this.client = new real(options);
        this.messages = {
          create: async (params, options) => {
            const prompt_sha256 = groupedSha256(JSON.stringify([params.system, params.messages]));
            try {
              const message = await this.client.messages.create(params, options);
              const content = message.content.map((b: { type: string; text?: string }) =>
                b.type === 'text' ? { type: 'text', text: b.text } : { type: b.type },
              );
              sink.calls.push({
                prompt_sha256,
                stop_reason: message.stop_reason,
                content,
                usage: {
                  input_tokens: message.usage.input_tokens,
                  output_tokens: message.usage.output_tokens,
                },
              } satisfies RecordedCall);
              sink.inputTokens += message.usage.input_tokens;
              sink.outputTokens += message.usage.output_tokens;
              return message;
            } catch (err) {
              sink.calls.push({
                prompt_sha256,
                stop_reason: null,
                content: [],
                usage: { input_tokens: 0, output_tokens: 0 },
                error: err instanceof Error ? err.name : 'error',
              } satisfies RecordedCall);
              throw err;
            }
          },
        };
      }
    },
  };
});
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/llm-spend-counter', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDailySpend: vi.fn().mockResolvedValue(0),
  recordLlmSpend: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/llm-calls-register', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logLlmCallAsync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/description-pg-cache', () => ({
  publishPgCachedDescription: vi.fn().mockResolvedValue('published'),
}));
vi.mock('@/lib/description-cache', () => ({
  setCachedDescription: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/description-generation-audit', () => ({
  writeDescriptionGenerationAudit: vi.fn().mockResolvedValue('written'),
}));

describe.skipIf(process.env.CLAIM_BASELINE_RECORD !== '1')('record the claim baseline', () => {
  it('records every case once', async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (new URL(url).hostname !== 'api.anthropic.com') {
        throw new Error(`baseline recorder: blocked fetch to ${new URL(url).hostname}`);
      }
      return realFetch(input, init);
    });
    const { generateDescription } = await import('@/lib/description-generator');
    const { callLlmGateway } = await import('@/lib/llm-gateway');
    const { computeCost } = await import('@/lib/llm-pricing');

    writeFileSync(RAW, '');
    const limit = Number(process.env.CLAIM_BASELINE_LIMIT ?? 'Infinity');
    for (const c of baselineCases().slice(0, limit)) {
      const spend = computeCost('claude-sonnet-5-5', sink.inputTokens, sink.outputTokens);
      if (spend > SPEND_STOP_USD) throw new Error(`stop: spend ${spend.toFixed(2)} USD`);
      sink.calls = [];
      if (c.surface === 'description') {
        await generateDescription(descriptionEvent(c));
      } else {
        await callLlmGateway(adaptInput(c, () => {}));
      }
      // A judge aborted by its deadline settles just after the gateway returns.
      await new Promise((resolve) => setTimeout(resolve, 50));
      appendFileSync(RAW, `${JSON.stringify({ id: c.id, calls: sink.calls })}\n`);
      console.info(`[baseline] ${c.id} calls=${String(sink.calls.length)} usd=${spend.toFixed(3)}`);
    }
    const total = computeCost('claude-sonnet-5-5', sink.inputTokens, sink.outputTokens);
    console.info(
      `[baseline] DONE in=${String(sink.inputTokens)} out=${String(sink.outputTokens)} usd=${total.toFixed(3)}`,
    );
  }, 3_000_000);
});
