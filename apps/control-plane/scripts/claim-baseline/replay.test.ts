// @vitest-environment node
/**
 * FOLLOW-1311: replay the frozen model outputs (`fixtures/raw.v1.jsonl`) through the REAL
 * `generateDescription` and `callLlmGateway`, with only the SDK and the sinks replaced, and compare
 * every verdict with the current frozen verdicts, `fixtures/verdicts.v3.jsonl`.
 * `verdicts.v1.jsonl` stays as the baseline every target is measured from, and
 * `verdicts.v2.delta.json` and `verdicts.v3.delta.json` classify, by hand, every case that moved
 * from v1 to v2 and from v2 to v3.
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
    expect(lines).toEqual(readLines('verdicts.v3.jsonl'));
  });

  it('v2 moves only the classified cases, and the refusal target is computed from the verdicts', () => {
    interface Verdict {
      id: string;
      verdict?: string;
      refused?: unknown[];
      served?: unknown[];
    }
    const read = (file: string) => readLines(file).map((l) => JSON.parse(l) as Verdict);
    const v1 = read('verdicts.v1.jsonl');
    const v2 = read('verdicts.v2.jsonl');
    const raw1 = readLines('verdicts.v1.jsonl');
    const raw2 = readLines('verdicts.v2.jsonl');
    const delta = JSON.parse(
      readFileSync(path.join(FIXTURES, 'verdicts.v2.delta.json'), 'utf8'),
    ) as { moved: Record<string, { classified: string }> };
    expect(
      raw1
        .map((line, i) => (line === raw2[i] ? null : (JSON.parse(line) as Verdict).id))
        .filter((id) => id !== null)
        .sort(),
    ).toEqual(Object.keys(delta.moved).sort());

    // Computed: these follow from the replay itself, so a verdict that moves can fail them.
    const fit = v1.filter((v) => v.verdict === 'FIT');
    const refused = fit.filter((v) => v2.find((x) => x.id === v.id)?.verdict !== 'FIT');
    expect(fit.length).toBe(57);
    expect(refused.length / fit.length).toBeLessThanOrEqual(0.1);
    const unRefused = v1.filter(
      (v) => v.verdict === 'REFUSED' && v2.find((x) => x.id === v.id)?.verdict === 'FIT',
    );
    expect(unRefused).toEqual([]);
    const slots = (vs: Verdict[]) => vs.reduce((n, v) => n + (v.refused?.length ?? 0), 0);
    expect(slots(v2) - slots(v1)).toBeLessThanOrEqual(8);

    // NOT computed: the true-positive share is a recorded human classification (single rater, in
    // `verdicts.v2.delta.json`). This only checks each refusal has one and reads the record; it
    // cannot tell whether the rater was right.
    const classified = refused.map((v) => delta.moved[v.id]?.classified);
    expect(classified.every((c) => c === 'true' || c === 'false')).toBe(true);
    const share = classified.filter((c) => c === 'true').length / Math.max(1, classified.length);
    expect(share).toBeGreaterThanOrEqual(0.9);
  });

  it('v3 moves only the classified cases, and the targets hold for the whole programme since v1', () => {
    interface Verdict {
      id: string;
      verdict?: string;
      refused?: unknown[];
      served?: unknown[];
      headline_sha?: string | null;
    }
    const read = (file: string) => readLines(file).map((l) => JSON.parse(l) as Verdict);
    const v1 = read('verdicts.v1.jsonl');
    const v3 = read('verdicts.v3.jsonl');
    const raw2 = readLines('verdicts.v2.jsonl');
    const raw3 = readLines('verdicts.v3.jsonl');
    const deltas = ['verdicts.v2.delta.json', 'verdicts.v3.delta.json'].map(
      (file) =>
        JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf8')) as {
          moved: Record<string, { classified: string }>;
        },
    );
    expect(
      raw2
        .map((line, i) => (line === raw3[i] ? null : (JSON.parse(line) as Verdict).id))
        .filter((id) => id !== null)
        .sort(),
    ).toEqual(Object.keys(deltas[1]?.moved ?? {}).sort());

    // Computed from the verdicts: body refusals new since the baseline, against the amendment's 10 %.
    const fit = v1.filter((v) => v.verdict === 'FIT');
    const refused = fit.filter((v) => v3.find((x) => x.id === v.id)?.verdict !== 'FIT');
    expect(fit.length).toBe(57);
    expect(refused.length).toBe(5);
    expect(refused.length / fit.length).toBeLessThanOrEqual(0.1);
    expect(
      v1.filter((v) => v.verdict === 'REFUSED' && v3.find((x) => x.id === v.id)?.verdict === 'FIT'),
    ).toEqual([]);
    const slots = (vs: Verdict[]) => vs.reduce((n, v) => n + (v.refused?.length ?? 0), 0);
    expect(slots(v3) - slots(v1)).toBeLessThanOrEqual(8);

    // The headers of the delta files are read from the frozen verdicts, not taken on trust.
    const v2 = read('verdicts.v2.jsonl');
    const slotTotal = (vs: Verdict[]) =>
      vs.reduce((n, v) => n + (v.refused?.length ?? 0) + (v.served?.length ?? 0), 0);
    const lostFit = (from: Verdict[], to: Verdict[]) =>
      from.filter((v) => v.verdict === 'FIT' && to.find((x) => x.id === v.id)?.verdict !== 'FIT')
        .length;
    const unRefused = (from: Verdict[], to: Verdict[]) =>
      from.filter(
        (v) => v.verdict === 'REFUSED' && to.find((x) => x.id === v.id)?.verdict === 'FIT',
      ).length;
    const headlineLost = (from: Verdict[], to: Verdict[]) =>
      from.filter((v) => {
        const after = to.find((x) => x.id === v.id);
        return (
          v.verdict === 'FIT' && after?.verdict === 'FIT' && v.headline_sha && !after.headline_sha
        );
      }).length;
    const header = (index: number) =>
      deltas[index] as unknown as Record<string, number> & {
        moved: Record<string, { classified: string }>;
      };
    const trueCount = (index: number) =>
      Object.values(header(index).moved).filter((m) => m.classified === 'true').length;
    expect({
      fit_before: header(0).fit_before,
      new_body_refusals: header(0).new_body_refusals,
      adapt_slots_newly_refused: header(0).adapt_slots_newly_refused,
      adapt_slots_total: header(0).adapt_slots_total,
      un_refused: header(0).un_refused,
    }).toEqual({
      fit_before: fit.length,
      new_body_refusals: lostFit(v1, v2),
      adapt_slots_newly_refused: slots(v2) - slots(v1),
      adapt_slots_total: slotTotal(v2),
      un_refused: unRefused(v1, v2),
    });
    expect(header(0).true_positives).toBe(
      Object.entries(header(0).moved).filter(
        ([id, m]) =>
          m.classified === 'true' &&
          v1.find((v) => v.id === id)?.verdict === 'FIT' &&
          v2.find((v) => v.id === id)?.verdict !== 'FIT',
      ).length,
    );
    expect({
      fit_before: header(1).fit_before,
      fit_baseline: header(1).fit_baseline,
      new_body_refusals: header(1).new_body_refusals,
      new_body_refusals_since_baseline: header(1).new_body_refusals_since_baseline,
      true_positives: header(1).true_positives,
      headlines_newly_suppressed: header(1).headlines_newly_suppressed,
      adapt_slots_newly_refused: header(1).adapt_slots_newly_refused,
      adapt_slots_total: header(1).adapt_slots_total,
      un_refused: header(1).un_refused,
    }).toEqual({
      fit_before: v2.filter((v) => v.verdict === 'FIT').length,
      fit_baseline: fit.length,
      new_body_refusals: lostFit(v2, v3),
      new_body_refusals_since_baseline: refused.length,
      true_positives: trueCount(1),
      headlines_newly_suppressed: headlineLost(v2, v3),
      adapt_slots_newly_refused: slots(v3) - slots(v2),
      adapt_slots_total: slotTotal(v3),
      un_refused: unRefused(v2, v3),
    });

    // NOT computed: the true-positive share is a recorded human classification (single rater). The
    // 5 of 5 says nothing about the precision of the attributes that refuse nothing on this corpus.
    const classified = refused.map((v) => {
      const own = deltas[1]?.moved[v.id] ?? deltas[0]?.moved[v.id];
      return own?.classified;
    });
    expect(classified.every((c) => c === 'true' || c === 'false')).toBe(true);
    const share = classified.filter((c) => c === 'true').length / classified.length;
    expect(share).toBeGreaterThanOrEqual(0.9);
  });
});
