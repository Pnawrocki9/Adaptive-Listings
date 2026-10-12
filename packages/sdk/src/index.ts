/**
 * Estalara Adaptive Listings SDK — Tier 1 Observer
 *
 * Initialized by a <script> tag with data-api-key attribute.
 * Collects behavioral signals and sends them to the Ingest Worker.
 *
 * NEVER throws — designed to be resilient on third-party websites.
 * All errors are caught and silenced (debug mode logs to console).
 *
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

// FOLLOW-1296: `init()` is composed from four phases — `core/boot.ts` (config, session, consent
// gate), `core/consent-flow.ts` (banner + opt-out toggle), `core/intent-loop.ts` and
// `core/adapt-loop.ts`. These symbols were defined in this file before the split; re-exported so
// the public surface is unchanged.
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

/**
 * Main SDK initialization — called automatically when DOM is ready.
 * Wraps everything in try/catch to ensure the host page is never broken.
 *
 * Returns the final resolved IntentState after all priors and rehydration have
 * been applied, or `null` when init exits early (no script tag, consent denied,
 * or an unrecoverable error). This return value is used ONLY by `_initForTest`.
 *
 * FOLLOW-1296: the phases run in the order the former single body ran them; every piece of
 * state they share is on the boot context (`ctx`) or in a closure one phase hands the next.
 */
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

    // 7. Flush events on interval and page unload.
    // FOLLOW-1242: a failed send no longer loses the batch — retryable failures are held in
    // pendingBatches (per SDK instance) and re-sent with the same Idempotency-Key; see
    // dispatchEvents().
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

    // K.3.6 FOLLOW-266 Phase 3: emit a final intent.snapshot on beforeunload so the
    // ingest pipeline always receives the session-end archetype state.
    // Bound to the instance lifetime so teardown removes it — avoids a memory leak on SPA
    // navigations where destroy() is called without a page reload.
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
      // FOLLOW-791 AC5: disconnect the generic directive pipeline's resilience observers
      // too, mirroring teardownDescriptionObservers() above — resetAdaptState() (called on
      // cross-listing nav / archetype change) already covers those cases; this covers the
      // explicit SDK destroy() / SPA-teardown path, which does not call resetAdaptState().
      teardownAdaptObservers();
      profilingToggle?.destroy();
      shadowHost?.destroy();
      // FOLLOW-1306 (F-24): detach every host listener bound to the instance lifetime (chat,
      // live.signup, inquiry.completed, favorites, visibilitychange, and K.3.6 FOLLOW-266's
      // beforeunload), then cancel a pending chat refresh (FOLLOW-1026) and invalidate the
      // current generation so a reply still in flight cannot apply to a torn-down page.
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

// ─── Auto-detect sub-module ────────────────────────────────────────────────────
// detectSiteSchema is available via the '@estalara/sdk/auto-detect' sub-path export.
// It is NOT re-exported from the top-level index to keep the IIFE (Tier 1+2) bundle
// under the 40KB gzip limit. All production consumers (apps/control-plane/src/app/api/detect)
// already import from '@estalara/sdk/auto-detect' directly. (FOLLOW-324)
// DetectionResult is re-exported from pipeline.ts directly (not via index.ts) to avoid
// pulling auto-detect/index.ts into the bundle chain — index.ts exports value symbols
// (detectInquirySubmitSelector etc.) that would be bundled otherwise.
export type { DetectionResult } from './auto-detect/pipeline.js';

/**
 * Test-only seam: invoke the real `init()` body from jsdom integration tests.
 *
 * Returns the final resolved `IntentState` after all priors, rehydration, and
 * cold-start gates have been applied — giving tests direct in-memory access to
 * the state without re-implementing any logic. Returns `null` on early-exit paths
 * (no script tag, consent denied, banner denied, unrecoverable error).
 *
 * This export exists so tests can drive the PRODUCTION wiring (rehydration gate,
 * cold-start prior gate, LG-2 persist gate) without reimplementing its logic
 * locally. It MUST NOT be called from production code.
 *
 * Rule Q (amended 2026-06-08): acceptance tests must import + invoke the real
 * entrypoint, never re-implement its body. This seam satisfies that requirement:
 * mutating a gate in `init()` (e.g. dropping a `!`) will turn any test that
 * calls `_initForTest()` RED, because the test drives the real gate. The returned
 * state makes ALL four gates catchable — including referrer/device priors that only
 * live in-memory and are never written back to sessionStorage on a rehydrated session.
 *
 * @internal — exported for test infrastructure only. Tree-shaken in production
 * by the loader (the loader never imports from the SDK entry point directly;
 * it `import()`s the tier bundle, which does not call _initForTest).
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
