/**
 * FOLLOW-1061 — unit tests for the `/api/adapt` pre-LLM segment timer.
 *
 * The behaviour under test is the one the ticket exists for: when the pre-LLM segment stalls,
 * the estate must be able to NAME the step that stalled. A total with no step name is what we
 * already had (the Vercel invocation's own `durationMs`), and it is not enough.
 *
 * @module apps/control-plane/src/lib/__tests__/adapt-segment-timing.test
 */

import { describe, expect, it } from 'vitest';
import {
  createSegmentTimer,
  summarizePreLlmSegment,
  PRE_LLM_SEGMENT_SOURCE,
  PRE_LLM_STALL_WARN_MS,
} from '@/lib/adapt-segment-timing';

/** A scripted clock, so these assertions are about arithmetic and never about wall time. */
function scriptedClock(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe('FOLLOW-1061 — createSegmentTimer', () => {
  it('records one mark per step, each measured from the previous mark', () => {
    // t0=1000, then marks at 1010, 1310, 1315
    const timer = createSegmentTimer(scriptedClock([1000, 1010, 1310, 1315]));
    timer.mark('auth');
    timer.mark('al_enablement');
    timer.mark('bandit_arms');

    expect(timer.marks()).toEqual([
      { step: 'auth', ms: 10 },
      { step: 'al_enablement', ms: 300 },
      { step: 'bandit_arms', ms: 5 },
    ]);
  });

  it('elapsedMs is the whole segment, not the last step', () => {
    const timer = createSegmentTimer(scriptedClock([1000, 1010, 1310, 1315, 1400]));
    timer.mark('auth');
    timer.mark('al_enablement');
    timer.mark('bandit_arms');

    expect(timer.elapsedMs()).toBe(400);
  });

  it('never reports a negative duration when the clock goes backwards', () => {
    const timer = createSegmentTimer(scriptedClock([1000, 900]));
    timer.mark('auth');

    expect(timer.marks()).toEqual([{ step: 'auth', ms: 0 }]);
  });
});

describe('FOLLOW-1061 — summarizePreLlmSegment', () => {
  it('names the slowest step, which is the whole point of the breakdown', () => {
    const summary = summarizePreLlmSegment([
      { step: 'auth', ms: 12 },
      { step: 'al_enablement', ms: 30_140 },
      { step: 'bandit_arms', ms: 8 },
    ]);

    expect(summary.slowestStep).toBe('al_enablement');
    expect(summary.slowestMs).toBe(30_140);
    expect(summary.totalMs).toBe(30_160);
    expect(summary.breakdown).toEqual({ auth: 12, al_enablement: 30_140, bandit_arms: 8 });
  });

  it('flags a stall at, and above, PRE_LLM_STALL_WARN_MS — and not below it', () => {
    const under = summarizePreLlmSegment([{ step: 'auth', ms: PRE_LLM_STALL_WARN_MS - 1 }]);
    const at = summarizePreLlmSegment([{ step: 'auth', ms: PRE_LLM_STALL_WARN_MS }]);

    expect(under.stalled).toBe(false);
    expect(at.stalled).toBe(true);
  });

  it('an empty segment is well-defined rather than NaN', () => {
    const summary = summarizePreLlmSegment([]);

    expect(summary).toEqual({
      totalMs: 0,
      slowestStep: 'none',
      slowestMs: 0,
      stalled: false,
      breakdown: {},
    });
  });

  it('the warn threshold sits above every healthy production pre-LLM segment [MP-014]', () => {
    // MP-014 measured the healthy band at 233–1515 ms over 3 days of production traffic and
    // the stall plateau at ~28.5–31 s. 5 s is between them by construction; if this constant
    // is ever raised past the plateau floor the alarm stops firing for the thing it is for.
    expect(PRE_LLM_STALL_WARN_MS).toBeGreaterThan(1_515);
    expect(PRE_LLM_STALL_WARN_MS).toBeLessThan(28_500);
  });

  it('the ClickHouse `source` value is namespaced away from the llm_* generation values', () => {
    // `WHERE source LIKE 'llm\_%'` is a live query in MEASURED_PREMISES MP-010/MP-012 and in
    // the FOLLOW-1022 canary's failure message. A segment row must not be caught by it.
    expect(PRE_LLM_SEGMENT_SOURCE).toBe('route_pre_llm');
    expect(PRE_LLM_SEGMENT_SOURCE.startsWith('llm_')).toBe(false);
  });
});
