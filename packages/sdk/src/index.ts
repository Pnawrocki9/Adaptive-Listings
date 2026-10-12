/**
 * Estalara Adaptive Listings SDK; NEVER throws on a host page.
 * @module @estalara/sdk
 */

import { boot } from './core/boot.js';
import { mountOptOutToggle } from './core/consent-flow.js';
import { createAdaptLoop } from './core/adapt-loop.js';
import { createIntentLoop } from './core/intent-loop.js';
import { dispatchEvents } from './core/events.js';
import type { CollectedEvent, EventBatch } from './core/events.js';
import { emitIntentSnapshot } from './core/intent-snapshot.js';
import { setEventQueueRef, teardownAdaptObservers } from './core/adapt.js';
import {
  setDescriptionEventQueueRef,
  teardownDescriptionObservers,
} from './core/adapt-description.js';
import { mark } from './core/boot-timing.js';
import type { IntentState } from './core/intent.js';

// init() phases live in core/*; re-exported to keep the public surface [FOLLOW-1296].
export { mergeQuizConfig } from './core/boot.js';
export { DRIFT_HOLD_COUNT, detectPageType, detectListingId } from './core/adapt-loop.js';
export type { PageType } from './core/adapt-loop.js';

/** Current SDK version string. */
export const SDK_VERSION = '0.0.0' as const;

/** Event queue flushed every BATCH_INTERVAL_MS or on page unload. */
const eventQueue: CollectedEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

// Wire event queue into adapt module for adapt.applied / adapt.skipped event logging
setEventQueueRef(eventQueue);
// Wire event queue into description adapt module for adapt.description.* event logging
setDescriptionEventQueueRef(eventQueue);

const BATCH_INTERVAL_MS = 5_000;

/** Main SDK init, never breaks the host; returns state for `_initForTest` only [FOLLOW-1296]. */
async function init(): Promise<IntentState | null> {
  // FOLLOW-1033: first line of our own code — everything before this is host hydration,
  // loader injection, bundle fetch and parse, none of which this package can shrink.
  mark('init-start');
  try {
    // 1–4a. Bot gate, script tag + config, consent gate, session, opt-out read, page.view and
    // session.started, intent-state rehydration, the parallel server-config fetch.
    const ctx = await boot(eventQueue);
    if (!ctx) return null;
    // FOLLOW-1242: event batches held for retry by flush() (step 7). Declared here, before any
    // listener that can call flush(), so no early caller can hit its temporal dead zone.
    const pendingBatches: EventBatch[] = [];

    // 7. Flush on interval and unload; failed batches are retried [FOLLOW-1242].
    const flush = (force?: boolean): Promise<void> =>
      dispatchEvents(eventQueue, ctx.config, ctx.session, pendingBatches, force);

    // Cold-start priors (ADR-0012 step 6), then the first decision cycle (4b) and its
    // `estalara:adapt:settled` signal.
    const intent = createIntentLoop(ctx);
    const adapt = createAdaptLoop(ctx, intent, flush);
    await adapt.start();

    // 5. Reuse the Shadow DOM host created by boot's consent gate. 5b. Opt-out toggle.
    const shadowHost = ctx.host;
    const profilingToggle = mountOptOutToggle(ctx, adapt);

    // 6. Behavioral observers, the quiz and the favorites bridge; then the chat bridge and the
    // live.signup / inquiry.completed listeners.
    const cleanupObservers = intent.wire(adapt);
    adapt.listen();

    flushTimer = setInterval(() => void flush(), BATCH_INTERVAL_MS);

    // Flush remaining events before page unload (keepalive fetch).
    const handleSessionEnd = (): void => {
      // Forced: possibly the last chance, so held retries go now instead of waiting out backoff.
      void flush(true);
    };

    ctx.on(window, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        intent.stopDwell();
        handleSessionEnd();
      }
    });

    // Final intent.snapshot on unload, bound to the instance lifetime [FOLLOW-266].
    ctx.on(window, 'beforeunload', () => {
      emitIntentSnapshot(ctx.state, intent.snapshot);
      handleSessionEnd();
    });

    if (ctx.config.debug) {
      console.log(`[Estalara] SDK ${SDK_VERSION} initialized`, {
        sessionId: ctx.session.sessionId.slice(0, 8) + '...',
      });
    }

    // Store cleanup on window for testing / SPA teardown
    (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown = () => {
      if (flushTimer) clearInterval(flushTimer);
      intent.stopDwell();
      cleanupObservers();
      teardownDescriptionObservers();
      // destroy() does not call resetAdaptState() [FOLLOW-791].
      teardownAdaptObservers();
      profilingToggle?.destroy();
      shadowHost?.destroy();
      // Detach listeners and invalidate in-flight replies on teardown [FOLLOW-1306].
      ctx.lifetime.abort();
      adapt.stop();
    };

    // Return the final resolved intent state (used only by _initForTest seam).
    return ctx.state;
  } catch (err) {
    // SDK initialization failed — log in debug mode, never propagate
    try {
      if (
        typeof window !== 'undefined' &&
        (window as unknown as Record<string, unknown>).__estalara_debug
      ) {
        console.error('[Estalara] Initialization error:', err);
      }
    } catch {
      // double-catch — truly silent
    }
    return null;
  }
}

// ─── Intent engine public API (re-exported for FOLLOW-101 chat-intent bridge) ──
export { applyChatIntentPrior, CHAT_INTENT_LIKELIHOODS } from './core/intent.js';
export type { Archetype, ArchetypeProbabilities, IntentState } from './core/intent.js';

// ─── FOLLOW-343: cold-start DOM-adaptation floor (re-exported for tests + observability) ──
export { DOM_ADAPT_CONFIDENCE_FLOOR, DOM_ADAPT_MIN_SIGNAL_COUNT } from './core/adapt-floor.js';

// Auto-detect stays on its own sub-path, out of the IIFE bundle [FOLLOW-324].
export type { DetectionResult } from './auto-detect/pipeline.js';

/**
 * Test-only seam running the real `init()` (Rule Q); never call from production.
 * @internal — exported for test infrastructure only.
 */
export async function _initForTest(): Promise<IntentState | null> {
  return init();
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init());
  } else {
    void init();
  }
}
