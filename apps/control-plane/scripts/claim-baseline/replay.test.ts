// @vitest-environment node
/**
 * FOLLOW-1311: replay the frozen model outputs (`fixtures/raw.v1.jsonl`) through the REAL
 * `generateDescription` and `callLlmGateway`, with only the SDK and the sinks replaced, and compare
 * every verdict with the current frozen verdicts, `fixtures/verdicts.v2.jsonl`.
 * `verdicts.v1.jsonl` stays as the baseline every target is measured from, and
 * `verdicts.v2.delta.json` classifies, by hand, every case that moved from v1 to v2.
 *
 * A change that moves no verdict leaves this green. A change that does move one must show it: run
 * with `CLAIM_REPLAY_OUT=<file>` and diff that file against the frozen verdicts, then classify every
 * new refusal by hand (targets: the FOLLOW-1311 amendment of 2026-10-31). A call the recording does
 * not hold (for instance a headline for a body that was refused when it was recorded) answers
 * `no_recording`, so such a case shows up in the diff instead of reaching a model.
 *
 * @module apps/control-plane/scripts/claim-baseline/replay.test
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FIXTURES,
  adaptInput,
  adaptVerdict,
  baselineCases,
  descriptionEvent,
  descriptionVerdict,
  type RecordedCall,
  type RecordedCase,
} from './shared';

const { replay, refusals } = vi.hoisted(() => ({
  replay: { queue: [] as unknown[] },
  refusals: { list: [] as { slot: string; violation: string }[] },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: () => {
        const call = replay.queue.shift() as RecordedCall | undefined;
        if (call === undefined) return Promise.reject(new Error('no_recording'));
        if (call.error !== undefined) return Promise.reject(new Error(call.error));
        return Promise.resolve({
          content: call.content,
          stop_reason: call.stop_reason,
          usage: call.usage,
        });
      },
    };
  },
}));
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(
    (
      _message: string,
      context?: { tags?: { kind?: string; violation?: string }; extra?: { slot?: string } },
    ) => {
      if (context?.tags?.kind === 'directive_fact_check_violation') {
        refusals.list.push({
          slot: context.extra?.slot ?? '',
          violation: context.tags.violation ?? '',
        });
      }
    },
  ),
}));
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

const { generateDescription } = await import('@/lib/description-generator');
const { callLlmGateway } = await import('@/lib/llm-gateway');

function readLines(file: string): string[] {
  return readFileSync(path.join(FIXTURES, file), 'utf8').split('\n').filter(Boolean);
}

describe('FOLLOW-1311 claim baseline replay', () => {
  it('reproduces every frozen verdict', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'replay-key-'.repeat(2));
    vi.stubGlobal('fetch', () => Promise.reject(new Error('replay: no network')));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const raw = new Map(
      readLines('raw.v1.jsonl').map((line) => {
        const r = JSON.parse(line) as RecordedCase;
        return [r.id, r.calls] as const;
      }),
    );
    const lines: string[] = [];
    for (const c of baselineCases()) {
      replay.queue = [...(raw.get(c.id) ?? [])];
      refusals.list = [];
      if (c.surface === 'description') {
        lines.push(descriptionVerdict(c.id, await generateDescription(descriptionEvent(c))));
      } else {
        let fallback: string | null = null;
        const output = await callLlmGateway(
          adaptInput(c, (reason) => {
            fallback = reason;
          }),
        );
        lines.push(adaptVerdict(c.id, output, fallback, refusals.list));
      }
    }
    if (process.env.CLAIM_REPLAY_OUT) {
      writeFileSync(process.env.CLAIM_REPLAY_OUT, `${lines.join('\n')}\n`);
      return;
    }
    expect(lines).toEqual(readLines('verdicts.v2.jsonl'));
  });

  it('v2 moves only the classified cases, and meets the targets', () => {
    const delta = JSON.parse(
      readFileSync(path.join(FIXTURES, 'verdicts.v2.delta.json'), 'utf8'),
    ) as {
      fit_before: number;
      new_body_refusals: number;
      true_positives: number;
      moved: Record<string, unknown>;
    };
    const v1 = readLines('verdicts.v1.jsonl');
    const v2 = readLines('verdicts.v2.jsonl');
    const moved = v1
      .filter((line, i) => line !== v2[i])
      .map((line) => (JSON.parse(line) as { id: string }).id);
    expect(moved.sort()).toEqual(Object.keys(delta.moved).sort());
    expect(delta.new_body_refusals / delta.fit_before).toBeLessThanOrEqual(0.1);
    expect(delta.true_positives / delta.new_body_refusals).toBeGreaterThanOrEqual(0.9);
  });
});
