/**
 * Intent loop (FOLLOW-1296): everything in `init()` that moves the Bayesian intent state from
 * the page after boot — persistence, the dwell timer, the behavioral observers, the quiz and the
 * favorites bridge (the cold-start priors are the last step of `boot()`). Directive fetching lives in the adapt loop; this module calls it
 * through the {@link AdaptLoop} handed to {@link IntentLoop.wire}.
 *
 * The live state is `ctx.state` on the shared {@link BootContext}; nothing here is module-level.
 *
 * @module
 */

import { emitIntentSnapshot } from './intent-snapshot.js';
import type { IntentSnapshotContext } from './intent-snapshot.js';
import type { CollectedEvent } from './events.js';
import { persistIntentState, persistResolvedArchetype } from './session.js';
import { setupObservers } from './observer.js';
import {
  isQuizCompleted,
  isQuizDismissed,
  markQuizCompleted,
  markQuizDismissed,
} from '../ui/quiz-session-state.js';
import { DEFAULT_QUIZ_DEFINITION, renderQuizWidget } from '../ui/quiz-widget.js';
import type { QuizWidgetConfig } from '../ui/quiz-widget.js';
import { postQuizCompletionPing } from './adapt.js';
import {
  applyBehavioralSignal,
  applyDwellSignal,
  applyListingViewRate,
  applyQuizLeaf,
  calculateBehavioralOnlyState,
  detectMismatch,
  DWELL_MAX_SESSION_CONTRIBUTION,
} from './intent.js';
import type { BootContext } from './boot.js';
import type { AdaptLoop } from './adapt-loop.js';

/** Re-fetch directives from Decision API every N behavioral signals. */
const REFETCH_SIGNAL_INTERVAL = 5;

const DWELL_THRESHOLDS_MS = [30_000, 90_000, 180_000] as const;
const DWELL_TICK_MS = 5_000;
const DWELL_TICK_TOLERANCE_MS = DWELL_TICK_MS - 500;

/** Behavioral signals seen this page view, for quiz-vs-behavior mismatch detection. */
type SignalHistory = { eventType: string; payload?: Record<string, unknown> }[];

/** What the intent loop hands the rest of `init()`. */
export interface IntentLoop {
  /** Persist `ctx.state` to sessionStorage — call after every intent-engine update. */
  persist: () => void;
  /** Start (or restart) the dwell-time boost timer. */
  startDwell: () => void;
  stopDwell: () => void;
  /** Signal history (FOLLOW-201 drift detection reads it). */
  signals: SignalHistory;
  /** intent.snapshot emission context (K.3.6 FOLLOW-266). */
  snapshot: IntentSnapshotContext;
  /**
   * Set up the behavioral observers, open the quiz and register the favorites bridge.
   * @returns The observers' cleanup.
   */
  wire: (adapt: AdaptLoop) => () => void;
}

/**
 * Create the intent loop.
 *
 * @param ctx - The boot context; `ctx.state` is updated in place.
 */
export function createIntentLoop(ctx: BootContext): IntentLoop {
  const { config, session: currentSession, overrides: intentOverrides, queue } = ctx;

  // FOLLOW-208: Per-session listing view counter, incremented inside the listing.viewed
  // branch of the setupObservers callback below.
  let listingViewCount = 0;

  /** Call after every intent-engine update. */
  function onIntentUpdate(): void {
    // FOLLOW-176: persist the latest intent state to sessionStorage so subsequent
    // listing page loads in this tab can rehydrate immediately.
    // Consent is guaranteed at this point — all denial paths return early in boot().
    persistIntentState(currentSession.sessionId, ctx.state);
  }

  let dwellTimer: ReturnType<typeof setInterval> | null = null;
  let adaptedAt = 0;
  const firedThresholds = new Set<number>();

  // Populated by the observer callback below.
  // FOLLOW-201: also used for drift detection inside the adapt loop's refreshDirectives().
  const signalHistory: SignalHistory = [];

  // K.3.6 FOLLOW-266 Phase 3 — intent.snapshot emission context.
  // A mutable object so quizCompleted / quizLeaf / chatTurns can be updated in-place
  // by the quiz and chat-message callbacks without redeclaring.
  // Per-instance (not module-level) to satisfy RETRO-006 LG-2.
  const snapshotCtx: IntentSnapshotContext = {
    eventQueue: queue,
    chatTurns: 0,
    quizCompleted: false,
    quizLeaf: null,
  };

  function stopDwellTimer(): void {
    if (dwellTimer !== null) {
      clearInterval(dwellTimer);
      dwellTimer = null;
    }
  }
  /**
   * Start (or restart) the dwell-time boost timer for the current listing page.
   *
   * Rehydrate strategy (Rule R / FOLLOW-227):
   *   `IntentState.dwell_ticks_applied` is persisted to sessionStorage and carried
   *   across the rehydrate boundary on every cross-listing navigation.  Each tick
   *   below checks whether `(ctx.state.dwell_ticks_applied ?? 0)` has
   *   already reached `DWELL_MAX_SESSION_CONTRIBUTION` before calling
   *   `applyDwellSignal` — so a rehydrated state that already received all three
   *   threshold boosts on listing A will NOT receive them again on listing B.
   *
   *   The timer itself is always started when the Decision API returns a non-neutral
   *   archetype (including on a rehydrated session), because the elapsed-time clock
   *   resets per page.  What changes is whether each tick is allowed to apply a boost.
   */
  function startDwellTimer(): void {
    stopDwellTimer();
    adaptedAt = Date.now();
    firedThresholds.clear();
    dwellTimer = setInterval(() => {
      if (ctx.state.archetype === 'neutral') return;
      // LG-2 (FOLLOW-227): enforce per-session cap before applying any boost.
      // `dwell_ticks_applied` is persisted so it survives the rehydrate boundary.
      if ((ctx.state.dwell_ticks_applied ?? 0) >= DWELL_MAX_SESSION_CONTRIBUTION) {
        return;
      }
      const elapsed = Date.now() - adaptedAt;
      for (const threshold of DWELL_THRESHOLDS_MS) {
        if (
          !firedThresholds.has(threshold) &&
          Math.abs(elapsed - threshold) < DWELL_TICK_TOLERANCE_MS
        ) {
          firedThresholds.add(threshold);
          // LG-2: re-check cap inside the loop — a single tick may hit several
          // thresholds if the interval fires late.
          if ((ctx.state.dwell_ticks_applied ?? 0) >= DWELL_MAX_SESSION_CONTRIBUTION) {
            break;
          }
          ctx.state = applyDwellSignal(ctx.state, elapsed);
          onIntentUpdate();
        }
      }
    }, DWELL_TICK_MS);
  }

  function wire(adapt: AdaptLoop): () => void {
    const quizConfig: QuizWidgetConfig = {
      accentColor: config.accentColor,
      language: config.language,
      // FOLLOW-639 / ADR-0019 D5: walk the tenant's served editable tree, or the built-in
      // default when none is configured (byte-identical to pre-ADR-0019 for every path).
      definition: config.quizDefinition ?? DEFAULT_QUIZ_DEFINITION,
      // FOLLOW-623 / ADR-0019: brand logo atop the quiz card. `string | null` (never
      // undefined) — null renders no logo (byte-identical to pre-ADR-0019). D4 color
      // precedence keeps the card accent on `accent_color`. FOLLOW-1015 deleted the sticky
      // trigger, so the opt-out toggle is brand.primary_color's only SDK consumer now.
      logoUrl: config.brand?.logoUrl ?? null,
      // FOLLOW-651: render the "Powered by Estalara" attribution unless white-label. First
      // real consumer of brand.whiteLabel (RETRO-214 HALF_WIRE_P).
      showAttribution: config.brand?.whiteLabel !== true,
      // FOLLOW-640 / ADR-0019 D2: per-brand placement. This used to position the sticky
      // trigger; FOLLOW-1015 deleted that and anchored the auto-opening CARD instead, so the
      // served slice keeps a real consumer. Absent → DEFAULT_QUIZ_PLACEMENT (bottom-left
      // 24/96, clearing the opt-out toggle).
      ...(config.quizPlacement ? { placement: config.quizPlacement } : {}),
    };

    let quizTriggered = false;

    // 6. Set up behavioral observers, wiring listing view count for quiz.
    //    Pass inquirySubmitSelector from config so the inquiry click observer
    //    actually registers — fixes the RETRO-008/RETRO-009 bug where
    //    inquiry.started never fired in production because the options argument
    //    was omitted at the call site (FOLLOW-097).

    const cleanupObservers = setupObservers(
      config,
      (event: CollectedEvent) => {
        // FOLLOW-383 / §H.9: When opted out, drop behavioral events entirely.
        // Do NOT push to the event queue — opted-out events would be sent to ingest and
        // could contaminate archetype training data. The FOLLOW-372 spec states that
        // profiling opt-out SUPPRESSES variant logging entirely; sending behavioral
        // events to the training pipeline would violate that boundary.
        if (ctx.optedOut) return;

        queue.push(event);

        // Record signal before quiz is answered (for mismatch detection)
        signalHistory.push({ eventType: event.type, payload: event.payload });

        // Update Bayesian intent state from this behavioral signal.
        // Pass intentOverrides so server-supplied damping and likelihoods are used
        // for all ongoing behavioral signals (ADR-0012 Ticket C).
        const prevSignalCount = ctx.state.signal_count;
        ctx.state = applyBehavioralSignal(ctx.state, event.type, event.payload, intentOverrides);
        onIntentUpdate();

        // FOLLOW-208: Apply listing-view rate signal after the second view.
        // Rate = viewCount / (elapsedMs / 60_000). Only fires when viewCount >= 2
        // (first view is baseline). applyListingViewRate is a pure function — it
        // returns state unchanged for any case that does not match a boost bracket.
        if (event.type === 'listing.viewed') {
          // Cross-listing navigation re-adapts (the adapt loop owns the slot revert).
          adapt.onListingViewed(
            typeof event.payload.listing_id === 'string' ? event.payload.listing_id : null,
          );
          listingViewCount += 1;
          if (listingViewCount >= 2) {
            const elapsedMs = Date.now() - ctx.startedAt;
            ctx.state = applyListingViewRate(ctx.state, listingViewCount, elapsedMs);
            onIntentUpdate();
          }
        }

        // Re-fetch directives every REFETCH_SIGNAL_INTERVAL behavioral signals
        if (
          ctx.state.signal_count > prevSignalCount &&
          ctx.state.signal_count % REFETCH_SIGNAL_INTERVAL === 0
        ) {
          void adapt.refresh();
        }

        // K.3.6 FOLLOW-266 Phase 3: emit intent.snapshot every 5 behavioral signals.
        // Fire-and-forget — emitIntentSnapshot is synchronous (queue push only).
        // Condition: signal_count crossed a 5-multiple boundary on THIS signal.
        if (
          ctx.state.signal_count > prevSignalCount &&
          ctx.state.signal_count % 5 === 0 &&
          ctx.state.signal_count > 0
        ) {
          emitIntentSnapshot(ctx.state, snapshotCtx);
        }

        // listing.viewed signal no longer drives the quiz trigger (FOLLOW-199).
      },
      // Thread inquiry_submit_selector from tenant site schema → SdkConfig → observer options.
      // This was the root cause of inquiry.started never firing in production (FOLLOW-097).
      // Build options object conditionally to satisfy exactOptionalPropertyTypes strictness.
      config.inquirySubmitSelector !== undefined
        ? { inquirySubmitSelector: config.inquirySubmitSelector }
        : {},
    );

    // FOLLOW-1015: the quiz OPENS ITSELF as soon as consent + config have resolved — there is
    // no sticky trigger button to click any more (the old 30s "Find your match →" prompt is
    // gone). The visitor closes the card if they do not want to answer; that sets the 24h
    // dismissal cooldown so it does not reappear on the next page view.
    //
    // FOLLOW-102: config.quiz?.enabled === false suppresses the quiz entirely for
    // tenants that rely on behavioral + chat NLP signals only (§B.1 / §D.6).
    // No prompt, no widget, no quiz events are emitted when the quiz is disabled.
    function openQuiz(): void {
      // §H.9 opt-out: suppress AL profiling. NOTE: unlike the favorites handler (where
      // listing.bookmarked is pushed BEFORE its guard), the quiz.event step:'completed'
      // push below is INSIDE the quiz completion callback — DOWNSTREAM of this early return.
      // opted-out sessions never reach it: the ingest event IS suppressed here (FOLLOW-409).
      if (ctx.optedOut) return;
      if (config.quiz?.enabled === false) return;
      const shadowHost = ctx.host;
      if (!shadowHost || quizTriggered) return;
      // Previously enforced inside scheduleQuizTrigger(); with auto-open these two guards are
      // the only thing standing between a returning visitor and the card on every page view.
      if (isQuizCompleted() || isQuizDismissed()) return;
      quizTriggered = true;
      renderQuizWidget(
        shadowHost.root,
        quizConfig,
        (resolvedArchetype, answerPath) => {
          // Apply v2 quiz leaf result to intent state (applyQuizLeaf — FOLLOW-199).
          // Note: full mismatch detection wiring is FOLLOW-201.
          // Permanently suppress the quiz trigger across future sessions.
          markQuizCompleted();
          // K.3.6 FOLLOW-266: update snapshot context so intent.snapshot payloads
          // reflect quiz completion state on the next 5-signal boundary or beforeunload.
          snapshotCtx.quizCompleted = true;
          snapshotCtx.quizLeaf = resolvedArchetype;
          ctx.state = applyQuizLeaf(ctx.state, resolvedArchetype);
          // Seed the session source-of-truth archetype with the quiz answer so
          // refreshDirectives() can restore it if behavioral drift later decays the live
          // archetype to neutral. Chat / sustained behavioral evidence may later overwrite
          // this SoT with a different non-neutral archetype (see refreshDirectives).
          // FOLLOW-380 bug (c): persist the (high) quiz-leaf confidence alongside the
          // archetype so the neutral-decay restore re-pins both above the DOM floor.
          //
          // FOLLOW-554 (A3-F-03): a quiz SKIP (Q1 option D) resolves to `neutral`. Persisting
          // that would WIPE an already-established non-neutral SoT, violating the ADR-0014
          // invariant "never to neutral" (session.ts). Only seed the SoT from a non-neutral
          // quiz leaf — mirror the refreshDirectives() guard. Rule R: idempotent across
          // rehydrate (a skip is a no-op on the SoT key, so an existing SoT survives).
          if (resolvedArchetype !== 'neutral') {
            persistResolvedArchetype(
              currentSession.sessionId,
              resolvedArchetype,
              ctx.state.confidence,
            );
          }
          onIntentUpdate();
          if (config.debug) {
            console.log(
              `[Estalara] Quiz → archetype=${ctx.state.archetype} confidence=${String(ctx.state.confidence)}`,
            );
          }

          // FOLLOW-200: persist quiz completion to Postgres for MOAT training data.
          // Fire-and-forget — must never block the quiz dismiss UI.
          // Fails silently (postQuizCompletionPing catches all errors internally).
          // FOLLOW-389 HW-1: thread the opt-out flag so the server-side §H.9 gate
          // at route.ts:363 is reachable (defense-in-depth alongside Guard 1).
          // FOLLOW-1020: `answerPath` records the walk, so the staff viewer's BRANCH / Q1-Q3
          // columns reflect what the buyer actually answered instead of defaulting to a skip.
          postQuizCompletionPing(
            config,
            currentSession.sessionId,
            ctx.state.archetype,
            quizConfig.language,
            ctx.optedOut,
            answerPath,
          );

          queue.push({
            type: 'quiz.event',
            payload: {
              step: 'completed',
              // FOLLOW-1015: the quiz opens itself now, so the old 'prompt_after_30s'
              // provenance no longer describes anything real. Free-form string field
              // (QuizEventPayloadSchema), no downstream consumer filtered on the old value.
              trigger: 'auto_open',
              archetype: ctx.state.archetype,
              confidence: ctx.state.confidence,
            },
            ts: Date.now(),
          });

          // Mismatch detection — compare quiz archetype against behavioral-only evidence
          const behavioralOnlyState = calculateBehavioralOnlyState(signalHistory);
          const mismatch = detectMismatch(
            ctx.state.archetype,
            behavioralOnlyState,
            currentSession.sessionId,
          );
          if (mismatch) {
            queue.push({
              type: 'quiz.mismatch',
              payload: {
                quiz_archetype: mismatch.quiz_archetype,
                behavioral_archetype: mismatch.behavioral_archetype,
                confidence_gap: mismatch.confidence_gap,
                signal_count: mismatch.signal_count,
              },
              ts: Date.now(),
            });
          }

          // Re-fetch directives with quiz-updated archetype confidence
          void adapt.refresh();
        },
        () => {
          // Closed or skipped without completing. FOLLOW-1015: start the 24h cooldown —
          // the quiz auto-opens now, so without this it would reappear on the very next
          // page view and the close button would feel broken.
          markQuizDismissed();
          quizTriggered = false;
        },
      );
    }

    openQuiz();

    // FOLLOW-210: Favorites/bookmark signal bridge.
    // Listens for estalara:listing:favorited / estalara:listing:unfavorited CustomEvents
    // dispatched by app.estalara.com (window) on successful save/unsave.
    //
    // On favorited: (a) queue listing.bookmarked ingest event, (b) apply listing.bookmarked
    // behavioral signal (with payload-conditional boosts handled inside applyBehavioralSignal).
    // On unfavorited: log only — no intent signal (removal is ambiguous).

    ctx.on(window, 'estalara:listing:favorited', (e: Event) => {
      const ce = e as CustomEvent<Record<string, unknown>>;
      const detail = ce.detail;

      const listingId = typeof detail.listingId === 'string' ? detail.listingId : undefined;
      const listingType = typeof detail.listingType === 'string' ? detail.listingType : undefined;
      const priceRange = typeof detail.priceRange === 'string' ? detail.priceRange : undefined;
      const bedroomCount =
        typeof detail.bedroomCount === 'number' ? detail.bedroomCount : undefined;

      // (a) Queue listing.bookmarked ingest event
      queue.push({
        type: 'listing.bookmarked',
        payload: {
          ...(listingId !== undefined ? { listing_id: listingId } : {}),
          ...(listingType !== undefined ? { listingType } : {}),
          ...(priceRange !== undefined ? { priceRange } : {}),
          ...(bedroomCount !== undefined ? { bedroomCount } : {}),
        },
        ts: Date.now(),
      });

      // (b) Apply behavioral signal with payload-conditional boosts
      // §H.9 opt-out: suppress AL profiling. Ingest stream left flowing (§H.8/CEO 2026-06-23/FOLLOW-384).
      // NOTE: this asymmetry vs showQuizTrigger is intentional — listing.bookmarked (§H.8 protected)
      // is pushed BEFORE this guard, so the ingest event reaches the pipeline for opted-out users.
      if (ctx.optedOut) return;

      const payload: Record<string, unknown> = {};
      if (listingType !== undefined) payload.listingType = listingType;
      if (bedroomCount !== undefined) payload.bedroomCount = bedroomCount;

      const prevSignalCount = ctx.state.signal_count;
      ctx.state = applyBehavioralSignal(ctx.state, 'listing.bookmarked', payload);
      signalHistory.push({ eventType: 'listing.bookmarked', payload });
      onIntentUpdate();

      // Re-fetch directives if this crosses a REFETCH interval
      if (
        ctx.state.signal_count > prevSignalCount &&
        ctx.state.signal_count % REFETCH_SIGNAL_INTERVAL === 0
      ) {
        void adapt.refresh();
      }

      if (config.debug) {
        console.log('[Estalara] listing.bookmarked received', {
          listingId,
          listingType,
          bedroomCount,
          archetype: ctx.state.archetype,
          confidence: ctx.state.confidence,
        });
      }
    });

    ctx.on(window, 'estalara:listing:unfavorited', (e: Event) => {
      const ce = e as CustomEvent<Record<string, unknown>>;
      const listingId = typeof ce.detail.listingId === 'string' ? ce.detail.listingId : undefined;

      // No intent signal — removal is ambiguous (user may have already found their match).
      // Log only for observability.
      if (config.debug) {
        console.log('[Estalara] listing.unfavorited received', { listingId });
      }
    });

    return cleanupObservers;
  }

  return {
    persist: onIntentUpdate,
    startDwell: startDwellTimer,
    stopDwell: stopDwellTimer,
    signals: signalHistory,
    snapshot: snapshotCtx,
    wire,
  };
}
