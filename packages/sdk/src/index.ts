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

import { readConfig } from './core/config.js';
import { dispatchEvents, collectPageView } from './core/events.js';
import { getOrCreateSession, incrementPageCount } from './core/session.js';
import { setupObservers } from './core/observer.js';
import { createShadowHost } from './ui/shadow-host.js';
import { renderQuizTrigger, isQuizDismissed } from './ui/quiz-trigger.js';
import { renderQuizWidget } from './ui/quiz-widget.js';
import {
  fetchDirectives,
  applyDirectives,
  setEventQueueRef,
  resetAdaptState,
} from './core/adapt.js';
import {
  applyBehavioralSignal,
  applyQuizPrior,
  calculateBehavioralOnlyState,
  detectMismatch,
  initIntentState,
} from './core/intent.js';
import { DqsTracker } from './core/dqs.js';
import type { CollectedEvent } from './core/events.js';
import type { IntentState } from './core/intent.js';
import type { QuizWidgetConfig } from './ui/quiz-widget.js';
import type { ArchetypeId } from '@estalara/shared';

/** How many intent-engine updates between automatic DQS snapshots. */
const DQS_SNAPSHOT_INTERVAL = 5;

/** Current SDK version string. */
export const SDK_VERSION = '0.0.0' as const;

/** Event queue flushed every BATCH_INTERVAL_MS or on page unload. */
const eventQueue: CollectedEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

// Wire event queue into adapt module for adapt.applied / adapt.skipped event logging
setEventQueueRef(eventQueue);

const BATCH_INTERVAL_MS = 5_000;

/** Number of listing views required before showing the quiz trigger. */
const QUIZ_TRIGGER_THRESHOLD = 3;

/**
 * Main SDK initialization — called automatically when DOM is ready.
 * Wraps everything in try/catch to ensure the host page is never broken.
 */
async function init(): Promise<void> {
  try {
    // 1. Find the Estalara script tag (the one with data-api-key)
    const script = document.querySelector<HTMLScriptElement>('script[data-api-key]');
    if (!script) return;

    // 2. Read configuration from data-* attributes
    const config = readConfig({ dataset: script.dataset });

    // 3. Initialize anonymous session (reset idempotency state for new session)
    resetAdaptState();
    const session = await getOrCreateSession();
    const currentSession = incrementPageCount(session);

    // 4. Collect initial page.view event
    eventQueue.push(collectPageView());

    // 4a. Initialize Bayesian intent state (BASE_PRIOR → neutral)
    let currentIntentState: IntentState = initIntentState();

    // 4b-dqs. Initialize per-session DQS tracker (TICKET-DQS-001)
    const dqsTracker = new DqsTracker(currentSession.sessionId);
    let dqsUpdateCount = 0;

    /** Push a session.quality.snapshot event into the queue. */
    function flushDqsSnapshot(): void {
      const snap = dqsTracker.snapshot();
      eventQueue.push({
        type: 'session.quality.snapshot',
        payload: snap as unknown as Record<string, unknown>,
        ts: Date.now(),
      });
    }

    /** Call after every intent-engine update — emits snapshot every DQS_SNAPSHOT_INTERVAL calls. */
    function onIntentUpdate(archetype: ArchetypeId | 'neutral', confidence: number): void {
      dqsTracker.update(archetype, confidence);
      dqsUpdateCount += 1;
      if (dqsUpdateCount % DQS_SNAPSHOT_INTERVAL === 0) {
        flushDqsSnapshot();
      }
    }

    // 4b. Fetch personalization directives from Decision API (Tier 1+ feature)
    if (config.decisionApiUrl) {
      const response = await fetchDirectives(config, currentSession, 'listing_list');
      if (response) {
        applyDirectives(response.directives, {
          archetypeId: response.archetype as ArchetypeId,
          confidence: response.confidence,
          sessionId: currentSession.sessionId,
        });
        if (config.debug) {
          console.log(
            `[Estalara] Archetype: ${response.archetype} (${String(response.confidence)})`,
          );
        }
      }
    }

    // 5. Initialize Shadow DOM host for UI elements (fails silently in SSR)
    const shadowHost = createShadowHost();

    const quizConfig: QuizWidgetConfig = {
      accentColor: script.dataset.accentColor ?? '#2563EB',
      language: script.dataset.language === 'pl' ? 'pl' : 'en',
    };

    let listingViewCount = 0;
    let quizTriggered = false;

    // Signal history — accumulated pre-quiz behavioral events for mismatch detection
    const signalHistory: { eventType: string; payload?: Record<string, unknown> }[] = [];

    // 6. Set up behavioral observers, wiring listing view count for quiz
    const cleanupObservers = setupObservers(config, (event: CollectedEvent) => {
      eventQueue.push(event);

      // Record signal before quiz is answered (for mismatch detection)
      signalHistory.push({ eventType: event.type, payload: event.payload });

      // Update Bayesian intent state from this behavioral signal
      currentIntentState = applyBehavioralSignal(currentIntentState, event.type, event.payload);
      onIntentUpdate(currentIntentState.archetype, currentIntentState.confidence);

      if (event.type === 'listing.viewed' && shadowHost && !quizTriggered && !isQuizDismissed()) {
        listingViewCount++;
        if (listingViewCount >= QUIZ_TRIGGER_THRESHOLD) {
          quizTriggered = true;
          renderQuizTrigger(
            shadowHost.root,
            { accentColor: quizConfig.accentColor, icon: '🎯', language: quizConfig.language },
            () => {
              renderQuizWidget(
                shadowHost.root,
                quizConfig,
                (answers) => {
                  // Apply strong quiz prior to intent state
                  currentIntentState = applyQuizPrior(
                    currentIntentState,
                    answers.purpose,
                    answers.horizon,
                  );
                  onIntentUpdate(currentIntentState.archetype, currentIntentState.confidence);
                  if (config.debug) {
                    console.log(
                      `[Estalara] Quiz → archetype=${currentIntentState.archetype} confidence=${String(currentIntentState.confidence)}`,
                    );
                  }
                  eventQueue.push({
                    type: 'quiz.event',
                    payload: {
                      step: 'completed',
                      answers,
                      trigger: 'prompt_after_3_listings',
                      archetype: currentIntentState.archetype,
                      confidence: currentIntentState.confidence,
                    },
                    ts: Date.now(),
                  });

                  // Mismatch detection — compare quiz archetype against behavioral-only evidence
                  const behavioralOnlyState = calculateBehavioralOnlyState(signalHistory);
                  const mismatch = detectMismatch(
                    currentIntentState.archetype,
                    behavioralOnlyState,
                    currentSession.sessionId,
                  );
                  if (mismatch) {
                    eventQueue.push({
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
                },
                () => {
                  // dismissed — reset so it can show again next session
                  quizTriggered = false;
                },
              );
            },
          );
        }
      }
    });

    // 7. Flush events on interval and page unload
    async function flush(): Promise<void> {
      if (eventQueue.length === 0) return;
      const batch = eventQueue.splice(0);
      await dispatchEvents(batch, config, currentSession);
    }

    flushTimer = setInterval(() => void flush(), BATCH_INTERVAL_MS);

    // Flush remaining events before page unload (keepalive fetch).
    // Also emit a final DQS snapshot on session end if at least one update has occurred.
    function handleSessionEnd(): void {
      if (dqsUpdateCount > 0) flushDqsSnapshot();
      void flush();
    }

    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') handleSessionEnd();
    });

    window.addEventListener('beforeunload', () => {
      handleSessionEnd();
    });

    if (config.debug) {
      console.log(`[Estalara] SDK ${SDK_VERSION} initialized`, {
        tier: config.tier,
        sessionId: currentSession.sessionId.slice(0, 8) + '...',
      });
    }

    // Store cleanup on window for testing / SPA teardown
    (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown = () => {
      if (flushTimer) clearInterval(flushTimer);
      cleanupObservers();
      shadowHost?.destroy();
      dqsTracker.reset();
    };
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
  }
}

/**
 * Estalara.identify() — stub for Profile Mode (Sprint 12+).
 * Call this when a visitor opts in to profile creation.
 * No-op in MVP — the profile_id is stored for when Profile Mode is enabled.
 */
export function identify(_profileId: string): void {
  // No-op stub — forward-compat for Profile Mode (U.11, Sprint 12+)
}

// ─── Auto-detect sub-module ────────────────────────────────────────────────────
export type { DetectionResult } from './auto-detect/index.js';
export { detectSiteSchema } from './auto-detect/index.js';

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init());
  } else {
    void init();
  }
}
