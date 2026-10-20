/**
 * Intent loop: persistence, dwell, observers, quiz, favorites [FOLLOW-1296].
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
import { postQuizCompletionPing, postQuizRunPing } from './adapt.js';
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
    // Persist for later pages in this tab [FOLLOW-176].
    persistIntentState(currentSession.sessionId, ctx.state);
  }

  let dwellTimer: ReturnType<typeof setInterval> | null = null;
  let adaptedAt = 0;
  const firedThresholds = new Set<number>();

  // Populated by the observer callback below.
  // FOLLOW-201: also used for drift detection inside the adapt loop's refreshDirectives().
  const signalHistory: SignalHistory = [];

  // Per-instance snapshot context (RETRO-006 LG-2) [FOLLOW-266].
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
  /** Dwell timer; ticks stop at the persisted session cap (Rule R) [FOLLOW-227]. */
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
      // default when none is configured.
      definition: config.quizDefinition ?? DEFAULT_QUIZ_DEFINITION,
      // FOLLOW-1357: the served definition's identity, forwarded (the built-in reports its own).
      ...(config.quizDefinition
        ? {
            definitionHash: config.quizDefinitionHash,
            definitionVersion: config.quizDefinitionVersion ?? null,
          }
        : {}),
      // FOLLOW-1357: every run transition → POST /api/quiz/run, chained per instance so the
      // server sees them in order (its state machine is forward-only); consent / opt-out
      // gating and the identity fields (tenant, session, SDK version, consent) live in
      // postQuizRunPing.
      onRunEvent: (ping) => {
        runPings = runPings.then(() =>
          postQuizRunPing(config, currentSession.sessionId, ping, ctx.optedOut),
        );
      },
      // Brand logo; null renders none (ADR-0019) [FOLLOW-623].
      logoUrl: config.brand?.logoUrl ?? null,
      // FOLLOW-651: render the "Powered by Estalara" attribution unless white-label. First
      // real consumer of brand.whiteLabel (RETRO-214 HALF_WIRE_P).
      showAttribution: config.brand?.whiteLabel !== true,
      // Per-brand card placement (ADR-0019 D2) [FOLLOW-640].
      ...(config.quizPlacement ? { placement: config.quizPlacement } : {}),
    };

    let quizTriggered = false;
    let runPings: Promise<void> = Promise.resolve();

    // 6. Observers; pass the inquiry selector or inquiry.started never fires [FOLLOW-097].

    const cleanupObservers = setupObservers(
      config,
      (event: CollectedEvent) => {
        // §H.9 opt-out: drop behavioural events entirely [FOLLOW-383].
        if (ctx.optedOut) return;

        queue.push(event);

        // Record signal before quiz is answered (for mismatch detection)
        signalHistory.push({ eventType: event.type, payload: event.payload });

        // Server damping/likelihoods apply (ADR-0012).
        const prevSignalCount = ctx.state.signal_count;
        ctx.state = applyBehavioralSignal(ctx.state, event.type, event.payload, intentOverrides);
        onIntentUpdate();

        // View rate from the second view [FOLLOW-208].
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

        // intent.snapshot every 5 signals [FOLLOW-266].
        if (
          ctx.state.signal_count > prevSignalCount &&
          ctx.state.signal_count % 5 === 0 &&
          ctx.state.signal_count > 0
        ) {
          emitIntentSnapshot(ctx.state, snapshotCtx);
        }

        // listing.viewed signal no longer drives the quiz trigger (FOLLOW-199).
      },
      // Selector required for inquiry.started [FOLLOW-097].
      config.inquirySubmitSelector !== undefined
        ? { inquirySubmitSelector: config.inquirySubmitSelector }
        : {},
    );

    // Quiz auto-opens; `quiz.enabled === false` disables it [FOLLOW-1015, FOLLOW-102].
    function openQuiz(): void {
      // §H.9: suppresses the completion event too [FOLLOW-409].
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
        (resolvedArchetype, answerPath, outcome) => {
          // FOLLOW-1357: called once, after the confirmation step; the FINAL archetype is
          // applied — the leaf, the buyer's correction, or `neutral` for "None of these".
          const final = outcome.final_archetype;
          // Apply the quiz result; never show the quiz again [FOLLOW-199].
          markQuizCompleted();
          // K.3.6 FOLLOW-266: update snapshot context so intent.snapshot payloads
          // reflect quiz completion state on the next 5-signal boundary or beforeunload.
          snapshotCtx.quizCompleted = true;
          snapshotCtx.quizLeaf = final;
          // The fold is unchanged here (0.85); package Q4 (FOLLOW-1359) changes it. Traits ride
          // the state: persisted, sent on /api/adapt and intent.snapshot (ESC-086 item 4).
          ctx.state = { ...applyQuizLeaf(ctx.state, final), quiz_traits: outcome.traits };
          // Seed the SoT from a NON-neutral result only — "None of these" pins nothing
          // (ADR-0014) [FOLLOW-554].
          if (final !== 'neutral') {
            persistResolvedArchetype(currentSession.sessionId, final, ctx.state.confidence);
          }
          onIntentUpdate();
          if (config.debug) {
            console.log(
              `[Estalara] Quiz → archetype=${ctx.state.archetype} confidence=${String(ctx.state.confidence)}`,
            );
          }

          // Persist completion with opt-out flag and path [FOLLOW-200, FOLLOW-1020].
          postQuizCompletionPing(
            config,
            currentSession.sessionId,
            ctx.state.archetype,
            outcome.language,
            ctx.optedOut,
            answerPath,
          );

          // ESC-086 item 1: one quiz.event per run — `completed` without a confirmation step,
          // else how the result screen closed; `archetype` is the final one [FOLLOW-1357].
          const confirmation = outcome.confirmation;
          queue.push({
            type: 'quiz.event',
            payload: {
              step:
                confirmation === null
                  ? 'completed'
                  : confirmation === 'none_of_these'
                    ? 'corrected'
                    : confirmation,
              // The quiz opens itself [FOLLOW-1015].
              trigger: 'auto_open',
              archetype: ctx.state.archetype,
              confidence: ctx.state.confidence,
              quiz_run_id: outcome.quiz_run_id,
              resolved_archetype: resolvedArchetype,
              definition_hash: outcome.definition_hash,
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
          // 24h cooldown after closing [FOLLOW-1015].
          markQuizDismissed();
          quizTriggered = false;
        },
      );
    }

    openQuiz();

    // Favorites bridge: favorited → signal; unfavorited logged only [FOLLOW-210].

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

      // §H.9: listing.bookmarked was pushed above on purpose (§H.8) [FOLLOW-384].
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
