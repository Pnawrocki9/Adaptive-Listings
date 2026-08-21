/**
 * Pre-LLM segment timing for `POST /api/adapt` (FOLLOW-1061).
 *
 * ## What this measures, and why the estate had nothing that did
 *
 * `llm_calls.latency_ms` is computed immediately after `client.messages.create` returns
 * (`latencyMs` in `llm-gateway.ts`), so it measures the Anthropic round trip and nothing else.
 * That is correct and should stay that way. The consequence is that a request which spends its
 * whole life BEFORE issuing the model call is recorded in the register as a fast call — the
 * 2026-08-20 12:45:51 UTC production invocation ran for 103 551 ms, issued its model call
 * 101 470 ms in, and booked `latency_ms = 1962`. Three separate artefacts then read that number
 * and reached three different wrong conclusions about what had happened. [MP-014]
 *
 * ## What is deliberately NOT here
 *
 * **End-to-end route wall clock is not re-measured**, because the platform already records it
 * and nobody had looked: every Vercel request row carries
 * `functionEvents[].durationMs` / `functionStartType` / `functionColdStartDurationMs`. The
 * `vercel logs` CLI drops those fields; the underlying API does not. The command is in
 * [MP-014]'s `measure_with`. A second wall clock in application code would be a parallel store
 * for a number that already exists.
 *
 * What genuinely had no home is the BREAKDOWN — which awaited dependency consumed the time —
 * and that is all this module adds.
 *
 * ## Where the numbers in the thresholds come from
 *
 * [MP-014], measured over three days of production `/api/adapt` traffic. Healthy pre-LLM
 * segments sit in a 233–1515 ms band; stalls form a plateau whose floor is ~28.5 s. The warn
 * threshold sits between the two by construction, asserted in
 * `__tests__/adapt-segment-timing.test.ts` so it cannot drift into either.
 *
 * @module apps/control-plane/src/lib/adapt-segment-timing
 */

/**
 * `llm_calls.source` for a pre-LLM segment row.
 *
 * Rule AJ, the same adjudication `JUDGE_VERDICT_SOURCE` and `GenerationOutcome` recorded in
 * `llm-gateway.ts`: `source` is `LowCardinality(String)`
 * (`infra/clickhouse/migrations/0004_create_llm_calls.sql`), so a new value needs no DDL — which
 * matters here because the control plane's ClickHouse role holds no column-DDL grant at all
 * ([MP-014]), so adding a column was never an option this ticket could exercise.
 *
 * The value is namespaced OUTSIDE `llm_*` on purpose: `WHERE source LIKE 'llm\_%'` is live in
 * MEASURED_PREMISES MP-010/MP-012 and in the FOLLOW-1022 canary's failure message, and a segment
 * row must not be counted as a generation by any of them.
 *
 * Consumer of record: [MP-014]'s saved query.
 */
export const PRE_LLM_SEGMENT_SOURCE = 'route_pre_llm';

/**
 * Above this, the pre-LLM segment is reported as a stall with its per-step breakdown.
 *
 * Not a budget and not a cut-off: nothing is aborted at this value. FOLLOW-1040's recorded
 * decision — that a wall-clock budget must not be set before the cause is known — is unchanged
 * by this ticket. This threshold only decides when the breakdown is worth a log line and a
 * Sentry message.
 */
export const PRE_LLM_STALL_WARN_MS = 5_000;

// The three interfaces below are deliberately NOT exported. Nothing outside this module names
// them — `route.ts` uses inference and the tests build object literals — and an exported type with
// no importer is a Rule I violation, which is the gate's way of saying the same thing.

/** One awaited step of the pre-LLM segment and how long it took. */
interface SegmentMark {
  /** Stable, low-cardinality step name — it becomes a Sentry tag. */
  readonly step: string;
  /** Milliseconds from the previous mark (or from timer creation, for the first). */
  readonly ms: number;
}

/** A monotonic-ish stopwatch that records one duration per named step. */
interface SegmentTimer {
  /** Close the current step under `step` and open the next one. */
  mark(step: string): void;
  /** The marks recorded so far, in order. */
  marks(): readonly SegmentMark[];
  /** Milliseconds since the timer was created, regardless of marks. */
  elapsedMs(): number;
}

/**
 * Create a segment timer.
 *
 * @param now - Clock source. Injected so tests assert arithmetic rather than wall time.
 */
export function createSegmentTimer(now: () => number = Date.now): SegmentTimer {
  const startedAt = now();
  let lastAt = startedAt;
  const marks: SegmentMark[] = [];

  return {
    mark(step: string): void {
      const at = now();
      marks.push({ step, ms: Math.max(0, at - lastAt) });
      lastAt = at;
    },
    marks(): readonly SegmentMark[] {
      return marks;
    },
    elapsedMs(): number {
      return Math.max(0, now() - startedAt);
    },
  };
}

/** A pre-LLM segment reduced to the numbers a log line and a ClickHouse row need. */
interface PreLlmSegmentSummary {
  /** Sum of every recorded step. */
  readonly totalMs: number;
  /** The step that consumed the most time, or `'none'` for an empty segment. */
  readonly slowestStep: string;
  /** That step's duration. */
  readonly slowestMs: number;
  /** `totalMs >= PRE_LLM_STALL_WARN_MS`. */
  readonly stalled: boolean;
  /** Per-step durations, for the structured log line and the Sentry extras. */
  readonly breakdown: Readonly<Record<string, number>>;
}

/**
 * Reduce recorded marks to a summary.
 *
 * Pure: it does no I/O and reads no clock, so the stall classification is testable without
 * waiting five seconds for it.
 */
export function summarizePreLlmSegment(marks: readonly SegmentMark[]): PreLlmSegmentSummary {
  const breakdown: Record<string, number> = {};
  let totalMs = 0;
  let slowestStep = 'none';
  let slowestMs = 0;

  for (const { step, ms } of marks) {
    breakdown[step] = (breakdown[step] ?? 0) + ms;
    totalMs += ms;
    if (ms > slowestMs) {
      slowestMs = ms;
      slowestStep = step;
    }
  }

  return {
    totalMs,
    slowestStep,
    slowestMs,
    stalled: totalMs >= PRE_LLM_STALL_WARN_MS,
    breakdown,
  };
}
