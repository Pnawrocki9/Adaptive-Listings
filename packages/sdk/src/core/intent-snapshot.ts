/**
 * intent.snapshot emission helper — K.3.6 Archetype Identification Tracer.
 *
 * `emitIntentSnapshot` pushes an `intent.snapshot` CollectedEvent onto the shared
 * event queue.  The queue is flushed asynchronously by the batching timer
 * (`setInterval`) or on page unload (`sendBeacon`), so the call is ALWAYS
 * fire-and-forget with no `await` on the calling side — it MUST NOT block the
 * main thread.
 *
 * Emitted:
 *   - Every 5 behavioral signals (`signal_count % 5 === 0 && signal_count > 0`).
 *   - On `window.beforeunload` (final snapshot for the session).
 *
 * Imported types:
 *   - `IntentSnapshotPayload`, `INTENT_SNAPSHOT_EVENT_TYPE` from `@estalara/shared`.
 *     We MUST NOT redeclare these inline (guardrail: "MUST NOT redeclare a shared
 *     type inline; import it from `packages/shared`").
 *
 * @module @estalara/sdk/core/intent-snapshot
 */

import { INTENT_SNAPSHOT_EVENT_TYPE, type IntentSnapshotPayload } from '@estalara/shared';

import type { CollectedEvent } from './events.js';
import type { IntentState } from './intent.js';

/**
 * Context needed by `emitIntentSnapshot` to build the full snapshot payload.
 *
 * All fields are per-session values maintained inside `init()`.  Passing them
 * explicitly (rather than reading module-level globals) keeps the function
 * per-instance and avoids the singleton anti-pattern flagged in RETRO-006 LG-2.
 */
export interface IntentSnapshotContext {
  /** The shared event queue owned by `init()`. */
  eventQueue: CollectedEvent[];
  /** Number of buyer chat turns observed so far this session. */
  chatTurns: number;
  /** Whether the quiz widget has reached a leaf node this session. */
  quizCompleted: boolean;
  /** The leaf archetype string from the quiz (null until quiz_completed). */
  quizLeaf: string | null;
}

/**
 * Push an `intent.snapshot` event onto the event queue.
 *
 * This function is SYNCHRONOUS and FIRE-AND-FORGET: it pushes a
 * `CollectedEvent` onto the queue without `await`-ing any I/O.  The batching
 * timer in `init()` dispatches the queue asynchronously; on `beforeunload` the
 * keepalive `fetch` in `dispatchEvents` handles final delivery.
 *
 * Caller contract:
 *   - Call after every 5th `processSignal` that increments `signal_count`.
 *   - Call once more on `window.beforeunload` for the session-end snapshot.
 *   - NEVER `await` this function — it has no async surface.
 *
 * Rule K.2 compliance: the function DOES NOT swallow errors. The only
 * operation is an `Array.push` onto the caller-provided queue, which cannot
 * throw in practice; if it did the exception would propagate to the `init()`
 * catch-all (which logs in debug mode and continues).
 *
 * @param state   - Current intent engine state after the most-recent signal.
 * @param ctx     - Per-session context (event queue + chat/quiz counters).
 */
export function emitIntentSnapshot(state: IntentState, ctx: IntentSnapshotContext): void {
  const payload: IntentSnapshotPayload = {
    archetype: state.archetype,
    confidence: state.confidence,
    signal_count: state.signal_count,
    probabilities: state.probabilities,
    quiz_completed: ctx.quizCompleted,
    quiz_leaf: ctx.quizLeaf,
    chat_turns: ctx.chatTurns,
    // last_signal_delta is omitted here — the SDK does not currently track
    // per-signal deltas.  The field is optional in IntentSnapshotPayloadSchema,
    // so omitting it is valid and avoids a forward-compat leak.
    last_signal_delta: undefined,
  };

  ctx.eventQueue.push({
    type: INTENT_SNAPSHOT_EVENT_TYPE,
    payload: payload,
    ts: Date.now(),
  });
}
