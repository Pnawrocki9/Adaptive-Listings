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
import {
  getOrCreateSession,
  incrementPageCount,
  getConsentState,
  setConsentState,
  eraseCrossSessionId,
  getOrCreateCrossSessionId,
  deriveLeadId,
  LEAD_ID_STORAGE_KEY,
} from './core/session.js';
import { setupObservers } from './core/observer.js';
import { createShadowHost } from './ui/shadow-host.js';
import { renderConsentBanner } from './ui/consent-banner.js';
import { renderQuizTrigger, isQuizDismissed } from './ui/quiz-trigger.js';
import { renderQuizWidget } from './ui/quiz-widget.js';
import { createSidebarWidget } from './ui/sidebar-widget.js';
import type { SidebarWidgetController } from './ui/sidebar-widget.js';
import {
  fetchDirectives,
  applyDirectives,
  setEventQueueRef,
  resetAdaptState,
} from './core/adapt.js';
import {
  applyDescriptionAdaptation,
  setDescriptionEventQueueRef,
  teardownDescriptionObservers,
} from './core/adapt-description.js';
import {
  applyArchetypeHints,
  applyBehavioralSignal,
  applyQuizPrior,
  calculateBehavioralOnlyState,
  detectMismatch,
  initIntentState,
} from './core/intent.js';
import { detectSiteSchema } from './auto-detect/pipeline.js';
import { extractArchetypeHints } from './auto-detect/archetype-hints.js';
import { DqsTracker } from './core/dqs.js';
import type { CollectedEvent } from './core/events.js';
import type { IntentState } from './core/intent.js';
import type { QuizWidgetConfig } from './ui/quiz-widget.js';
import type { ArchetypeId } from '@estalara/shared';

/** How many intent-engine updates between automatic DQS snapshots. */
const DQS_SNAPSHOT_INTERVAL = 5;

/** Re-fetch directives from Decision API every N behavioral signals. */
const REFETCH_SIGNAL_INTERVAL = 5;

/**
 * Detect the page type from the current URL and an optional data-page-type attribute.
 *
 * Detection order (F-08 / FOLLOW-194):
 *   1. `data-page-type` attribute on the <script> tag -- explicit override; takes precedence.
 *   2. URL pathname contains '/listing/' -> 'listing_detail'
 *   3. Default -> 'listing_list'
 *
 * @param scriptDataset - The dataset of the Estalara <script> tag (may include pageType).
 * @returns The resolved page type literal.
 */
export function detectPageType(
  scriptDataset: DOMStringMap,
): 'listing_list' | 'listing_detail' | 'home' | 'search' {
  // 1. Explicit data-page-type attribute overrides URL sniffing.
  const attr = scriptDataset.pageType;
  if (
    attr === 'listing_detail' ||
    attr === 'listing_list' ||
    attr === 'home' ||
    attr === 'search'
  ) {
    return attr;
  }

  // 2. URL pathname heuristic -- '/listing/' indicates a detail page.
  if (typeof window !== 'undefined' && window.location.pathname.includes('/listing/')) {
    return 'listing_detail';
  }

  // 3. Default to listing grid view.
  return 'listing_list';
}

/**
 * Read the current listing ID from the page DOM.
 *
 * Looks for `[data-estalara-listing-id]` in the document. Returns the first
 * non-empty value found, or undefined if no such attribute exists.
 *
 * Used by F-13 (FOLLOW-194) to wire per-listing RAG context into the adapt request.
 *
 * @internal exported for unit testing only
 */
export function detectListingId(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const el = document.querySelector<HTMLElement>('[data-estalara-listing-id]');
  const id = el?.getAttribute('data-estalara-listing-id') ?? undefined;
  return id !== '' ? id : undefined;
}

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
    // Capture script.dataset early so the refreshDirectives() closure can access it
    // without a non-null assertion (script is guaranteed non-null past line above).
    const scriptDataset: DOMStringMap = script.dataset;

    // 3a. Consent gate — MUST run before any data collection (TICKET-041, GDPR/CCPA).
    //     Create the shadow host early so we have a ShadowRoot to render the banner in.
    const earlyHost = createShadowHost();

    const consentState = getConsentState();

    if (consentState === 'denied') {
      // User previously declined — halt SDK entirely, no events dispatched.
      // DPIA §13.2 / FOLLOW-139: ensure cross-session xid is absent on a denied session.
      eraseCrossSessionId();
      // The shadow host is destroyed to avoid leaving a DOM node.
      earlyHost?.destroy();
      return;
    }

    if (consentState === 'pending') {
      if (earlyHost) {
        // Show banner and wait for the user's decision.
        // Returns true if consent was granted, false if denied.
        const granted = await new Promise<boolean>((resolve) => {
          renderConsentBanner(earlyHost.root, {
            language: config.language,
            accentColor: config.accentColor,
            ...(config.privacyPolicyUrl !== undefined
              ? { privacyPolicyUrl: config.privacyPolicyUrl }
              : {}),
            onGranted: () => {
              setConsentState('granted');
              // DPIA §13.2 / FOLLOW-139: create the cross-session xid now that consent is granted.
              // Fire-and-forget — future tickets (FOLLOW-146) will attach xid to event payloads.
              void getOrCreateCrossSessionId();
              // Consent audit event — compliance audit trail, dispatched unconditionally.
              eventQueue.push({
                type: 'consent.granted',
                payload: { language: config.language, method: 'banner' },
                ts: Date.now(),
              });
              resolve(true);
            },
            onDenied: () => {
              setConsentState('denied');
              // DPIA §13.2 / FOLLOW-139: erase cross-session xid on consent denial.
              eraseCrossSessionId();
              // Consent audit event — dispatched even when consent is denied.
              eventQueue.push({
                type: 'consent.denied',
                payload: { language: config.language, method: 'banner' },
                ts: Date.now(),
              });
              resolve(false);
            },
          });
        });

        if (!granted) {
          // User declined — flush the consent.denied audit event, then halt.
          if (eventQueue.length > 0) {
            const batch = eventQueue.splice(0);
            const auditSession = await getOrCreateSession();
            await dispatchEvents(batch, config, auditSession);
          }
          earlyHost.destroy();
          return;
        }
      }
      // If earlyHost is null (SSR/non-browser), treat as granted and continue.
    }
    // consentState === 'granted' (or earlyHost is null in non-browser env) — proceed.

    // DPIA §13.2 / FOLLOW-139: ensure cross-session xid exists when consent is already granted
    // on this init call (returning visitor). Fire-and-forget — FOLLOW-146 will attach xid to
    // event payloads. Must run before session init so the key is populated before any events fire.
    if (consentState === 'granted') {
      void getOrCreateCrossSessionId();
    }

    // 3. Initialize anonymous session (reset idempotency state for new session)
    resetAdaptState();
    const session = await getOrCreateSession();
    const currentSession = incrementPageCount(session);

    // FOLLOW-197 / CHAT-003: Registered user lead_id derivation.
    // If a Keycloak JWT is present in localStorage ('kc_token'), derive a pseudonymous
    // lead_id from the 'sub' claim and store it in sessionStorage (tab-lifetime only).
    // Rule L: the raw user_uuid is NEVER stored — only the SHA-256 16-char hex prefix.
    // Mode A compliance: sessionStorage only, never localStorage for this identifier.
    // Failures are silently swallowed — anonymous users continue with xid-based tracking.
    try {
      const kcToken = localStorage.getItem('kc_token');
      if (kcToken) {
        // JWT is three base64url segments separated by dots; middle segment is the payload.
        const parts = kcToken.split('.');
        if (parts.length === 3) {
          // base64url → base64 → JSON
          const [, payloadSegment] = parts;
          const b64 = (payloadSegment ?? '').replace(/-/g, '+').replace(/_/g, '/');
          const json = atob(b64);
          const claims = JSON.parse(json) as Record<string, unknown>;
          if (typeof claims.sub === 'string' && claims.sub.length > 0) {
            const leadId = await deriveLeadId(claims.sub);
            try {
              sessionStorage.setItem(LEAD_ID_STORAGE_KEY, leadId);
            } catch {
              // sessionStorage unavailable — lead_id lives in memory only for this call
            }
          }
        }
      }
    } catch {
      // Any parse failure (malformed JWT, missing atob, JSON error) → continue anonymously
    }

    // 4. Collect initial page.view event
    eventQueue.push(collectPageView());

    // 4a. Initialize Bayesian intent state (BASE_PRIOR → neutral)
    let currentIntentState: IntentState = initIntentState();

    // 4a-f02. Apply site-level archetype hints as cold-start Bayesian prior [AUDIT-F02].
    // detectSiteSchema runs DOM pattern analysis client-side; AI Vision is excluded from
    // the browser bundle and is never called here.
    try {
      if (typeof document !== 'undefined') {
        const html = document.documentElement.outerHTML;
        const url = window.location.href;
        const { schema } = await detectSiteSchema(html, url, config.tenantId ?? '');
        if (schema) {
          const hints = extractArchetypeHints(schema, html, url);
          if (hints.length > 0) {
            currentIntentState = applyArchetypeHints(currentIntentState, hints);
          }
        }
      }
    } catch {
      // Non-critical — detection failure must never block session init.
    }

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

    /** Confidence threshold above which the sidebar widget becomes visible. */
    const SIDEBAR_SHOW_THRESHOLD = 0.6;

    // Declared here (null) so refreshDirectives() can reference it without TDZ error.
    // Assigned to the actual widget after createShadowHost() runs below (step 5a).
    let sidebar: SidebarWidgetController | null = null;

    // F-15 (FOLLOW-194): track the last archetype returned by the Decision API.
    // resetAdaptState() is called ONLY when the archetype changes, preventing the
    // text-flicker that occurred every ~30s when resetAdaptState() was called
    // unconditionally on every refreshDirectives() cycle.
    let previousArchetype: string | null = null;

    /** Re-fetch directives and apply them with the latest intent state. */
    async function refreshDirectives(): Promise<void> {
      if (!config.decisionApiUrl) return;

      // F-08 (FOLLOW-194): detect pageType from URL / data-page-type attribute.
      // F-13 (FOLLOW-194): read the current listing ID for per-listing RAG context.
      // script is guaranteed non-null here -- init() returns early if !script (line 88).
      const pageType = detectPageType(scriptDataset);
      const listingId = detectListingId();

      const resp = await fetchDirectives(
        config,
        currentSession,
        pageType,
        currentIntentState,
        listingId,
      );
      if (resp) {
        // F-15 (FOLLOW-194): only reset adapt state when the archetype has changed.
        // On an unchanged archetype, preserve existing DOM mutations -- no flicker.
        if (resp.archetype !== previousArchetype) {
          resetAdaptState();
          previousArchetype = resp.archetype;
        }
        applyDirectives(resp.directives, {
          archetypeId: resp.archetype as ArchetypeId,
          confidence: resp.confidence,
          sessionId: currentSession.sessionId,
        });

        // Fetch + apply long-form description adaptation (FOLLOW-159).
        // Fire-and-forget — description errors are observable via adapt.description.error events;
        // a failure here must never block the directive/headline path or sidebar update.
        void applyDescriptionAdaptation(config, resp.archetype as ArchetypeId);

        if (config.debug) {
          console.log(`[Estalara] Archetype: ${resp.archetype} (${String(resp.confidence)})`);
        }

        // Update the sidebar when confidence meets the threshold.
        // Extract text directives for the preview panel.
        if (sidebar && resp.confidence >= SIDEBAR_SHOW_THRESHOLD) {
          const textDirectives = resp.directives
            .filter((d) => d.type === 'text')
            .map((d) => ({
              slot: 'slot' in d ? d.slot : '',
              text: 'value' in d && typeof d.value === 'string' ? d.value : '',
            }));

          const state = {
            archetype: resp.archetype,
            confidence: resp.confidence,
            signalCount: currentIntentState.signal_count,
            directives: textDirectives.length > 0 ? textDirectives : undefined,
          };

          // show() on first reveal, update() on subsequent calls
          sidebar.show(state);
        }
      }
    }

    // 4b. Fetch personalization directives from Decision API (Tier 1+ feature)
    if (config.decisionApiUrl) {
      await refreshDirectives();
    }

    // 5. Reuse the Shadow DOM host created in step 3a (consent gate).
    //    earlyHost was created before consent check and is already attached to <body>.
    const shadowHost = earlyHost;

    const quizConfig: QuizWidgetConfig = {
      accentColor: config.accentColor,
      language: config.language,
    };

    // 5a. Mount Tier 1 Observer sidebar widget inside the Shadow DOM.
    // The widget is initially hidden; it becomes visible after the first
    // refreshDirectives() call that returns a non-neutral archetype (confidence ≥ 0.6).
    if (shadowHost) {
      sidebar = createSidebarWidget(shadowHost.root, {
        accentColor: quizConfig.accentColor,
        language: quizConfig.language,
        onClose: () => {
          eventQueue.push({
            type: 'sidebar.closed',
            payload: {},
            ts: Date.now(),
          });
        },
      });
    }

    let listingViewCount = 0;
    let quizTriggered = false;

    // Signal history — accumulated pre-quiz behavioral events for mismatch detection
    const signalHistory: { eventType: string; payload?: Record<string, unknown> }[] = [];

    // 6. Set up behavioral observers, wiring listing view count for quiz.
    //    Pass inquirySubmitSelector from config so the inquiry click observer
    //    actually registers — fixes the RETRO-008/RETRO-009 bug where
    //    inquiry.started never fired in production because the options argument
    //    was omitted at the call site (FOLLOW-097).
    const cleanupObservers = setupObservers(
      config,
      (event: CollectedEvent) => {
        eventQueue.push(event);

        // Record signal before quiz is answered (for mismatch detection)
        signalHistory.push({ eventType: event.type, payload: event.payload });

        // Update Bayesian intent state from this behavioral signal
        const prevSignalCount = currentIntentState.signal_count;
        currentIntentState = applyBehavioralSignal(currentIntentState, event.type, event.payload);
        onIntentUpdate(currentIntentState.archetype, currentIntentState.confidence);

        // Re-fetch directives every REFETCH_SIGNAL_INTERVAL behavioral signals
        if (
          currentIntentState.signal_count > prevSignalCount &&
          currentIntentState.signal_count % REFETCH_SIGNAL_INTERVAL === 0
        ) {
          void refreshDirectives();
        }

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

                    // Re-fetch directives with quiz-updated archetype confidence
                    void refreshDirectives();
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
      },
      // Thread inquiry_submit_selector from tenant site schema → SdkConfig → observer options.
      // This was the root cause of inquiry.started never firing in production (FOLLOW-097).
      // Build options object conditionally to satisfy exactOptionalPropertyTypes strictness.
      config.inquirySubmitSelector !== undefined
        ? { inquirySubmitSelector: config.inquirySubmitSelector }
        : {},
    );

    // FOLLOW-197 / CHAT-003: Chat signal bridge.
    // Listens for chat and live-signup CustomEvents dispatched by Estalara-app on `document`.
    // Using document (not window) per RETRO-033 — Estalara-app dispatches on document.
    //
    // Rule L: raw user_uuid is NEVER stored — only the SHA-256-derived lead_id is stored.
    // Agent activity (is_agent === true) is silently filtered — investor signals only.

    // Chat: estalara:chat:message-sent
    document.addEventListener('estalara:chat:message-sent', (e: Event) => {
      void (async (): Promise<void> => {
        const ce = e as CustomEvent<Record<string, unknown>>;
        if (ce.detail.is_agent === true) return;

        // Derive lead_id from user_uuid if present; fall back to stored lead_id.
        // Rule L: user_uuid is NEVER stored — only the derived hash prefix.
        let leadId: string | undefined;
        if (typeof ce.detail.user_uuid === 'string' && ce.detail.user_uuid.length > 0) {
          leadId = await deriveLeadId(ce.detail.user_uuid);
          try {
            sessionStorage.setItem(LEAD_ID_STORAGE_KEY, leadId);
          } catch {
            // sessionStorage unavailable — lead_id is used in-memory only for this event
          }
        } else {
          try {
            leadId = sessionStorage.getItem(LEAD_ID_STORAGE_KEY) ?? undefined;
          } catch {
            // sessionStorage unavailable
          }
        }

        eventQueue.push({
          type: 'chat.message.sent',
          payload: {
            char_count: typeof ce.detail.char_count === 'number' ? ce.detail.char_count : undefined,
            listing_id: typeof ce.detail.listing_id === 'string' ? ce.detail.listing_id : undefined,
            lead_id: leadId,
          },
          ts: Date.now(),
        });
      })();
    });

    // Live signup: live.signup (dot-separated — registerFeedbackListener already handles
    // the feedback ping; this listener queues the ingest event and stores lead_id).
    document.addEventListener('live.signup', (e: Event) => {
      void (async (): Promise<void> => {
        const ce = e as CustomEvent<Record<string, unknown>>;
        if (ce.detail.is_agent === true) return;

        // Derive lead_id from user_uuid if present; fall back to stored lead_id.
        // Rule L: user_uuid is NEVER stored — only the derived hash prefix.
        let leadId: string | undefined;
        if (typeof ce.detail.user_uuid === 'string' && ce.detail.user_uuid.length > 0) {
          leadId = await deriveLeadId(ce.detail.user_uuid);
          try {
            sessionStorage.setItem(LEAD_ID_STORAGE_KEY, leadId);
          } catch {
            // sessionStorage unavailable
          }
        } else {
          try {
            leadId = sessionStorage.getItem(LEAD_ID_STORAGE_KEY) ?? undefined;
          } catch {
            // sessionStorage unavailable
          }
        }

        // feedback ping is already handled by registerFeedbackListener in adapt.ts.
        // This listener queues the ingest telemetry event only.
        eventQueue.push({
          type: 'live.signup',
          payload: {
            slot_uuid: typeof ce.detail.slot_uuid === 'string' ? ce.detail.slot_uuid : undefined,
            lead_id: leadId,
            source_surface:
              typeof ce.detail.source_surface === 'string' ? ce.detail.source_surface : undefined,
          },
          ts: Date.now(),
        });
      })();
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
      teardownDescriptionObservers();
      sidebar?.destroy();
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
