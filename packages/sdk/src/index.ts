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

import { readConfig, BOT_UA_RE } from './core/config.js';
import type { SdkConfig } from './core/config.js';
import { fetchQuizConfig, eraseCachedQuizConfig } from './core/quiz-config.js';
import { fetchIntentWeights } from './core/intent-weights.js';
import type { QuizPublicConfigResponse } from '@estalara/shared';
import { dispatchEvents, collectPageView } from './core/events.js';
import { emitIntentSnapshot } from './core/intent-snapshot.js';
import type { IntentSnapshotContext } from './core/intent-snapshot.js';
import { scrubMessagePii } from './core/pii-scrub.js';
import {
  getOrCreateSession,
  incrementPageCount,
  getConsentState,
  setConsentState,
  eraseCrossSessionId,
  getOrCreateCrossSessionId,
  deriveLeadId,
  LEAD_ID_STORAGE_KEY,
  persistIntentState,
  rehydrateIntentState,
  eraseIntentState,
  peekStoredSessionId,
} from './core/session.js';
import { setupObservers } from './core/observer.js';
import { createShadowHost } from './ui/shadow-host.js';
import { renderConsentBanner } from './ui/consent-banner.js';
import { renderQuizTrigger, scheduleQuizTrigger } from './ui/quiz-trigger.js';
import { renderQuizWidget } from './ui/quiz-widget.js';
import {
  renderMicroPoll,
  isMicroPollDismissed,
  DEFAULT_MICRO_POLL_QUESTIONS,
} from './ui/micro-poll.js';
import { createSidebarWidget } from './ui/sidebar-widget.js';
import type { SidebarWidgetController } from './ui/sidebar-widget.js';
import {
  fetchDirectives,
  applyDirectives,
  setEventQueueRef,
  resetAdaptState,
  postQuizCompletionPing,
} from './core/adapt.js';
import {
  applyDescriptionAdaptation,
  setDescriptionEventQueueRef,
  teardownDescriptionObservers,
} from './core/adapt-description.js';
import {
  applyArchetypeHints,
  applyBehavioralSignal,
  applyDwellSignal,
  applyListingViewRate,
  applyQuizLeaf,
  applyReferrerHints,
  calculateBehavioralOnlyState,
  detectMismatch,
  initIntentState,
  resolveIntentOverrides,
  DWELL_MAX_SESSION_CONTRIBUTION,
} from './core/intent.js';
import type { IntentEngineOverrides } from './core/intent.js';
import { detectSiteSchema } from './auto-detect/pipeline.js';
import { extractArchetypeHints } from './auto-detect/archetype-hints.js';
import { DqsTracker } from './core/dqs.js';
import type { CollectedEvent } from './core/events.js';
import type { Archetype, IntentState } from './core/intent.js';
import type { QuizWidgetConfig } from './ui/quiz-widget.js';
import type { ArchetypeId } from '@estalara/shared';

/**
 * Merge server-fetched quiz config into SdkConfig (ADR-0011, FOLLOW-275).
 *
 * Overlays `{ quiz_enabled, micro_polls_enabled, language, accent_color }` from the
 * `GET /api/quiz/public-config` response onto the already-parsed SdkConfig.
 *
 * When `fetched` is `null` (network error / timeout / parse failure) the original
 * config is returned unchanged — callers already hold snippet-attribute fallback values
 * from `readConfig()`, which are themselves a fallback to hardcoded defaults.
 *
 * Called in `init()` AFTER `resolveConsent()` and BEFORE `scheduleQuizTrigger()` /
 * `schedulesMicroPoll()` (ADR-0011 init sequence step 4).
 *
 * @internal exported for tests only
 */
export function mergeQuizConfig(
  config: SdkConfig,
  fetched: QuizPublicConfigResponse | null,
): SdkConfig {
  if (!fetched) return config;
  return {
    ...config,
    quiz: { ...config.quiz, enabled: fetched.quiz_enabled },
    microPollsEnabled: fetched.micro_polls_enabled,
    language: fetched.language,
    accentColor: fetched.accent_color,
  };
}

/** How many intent-engine updates between automatic DQS snapshots. */
const DQS_SNAPSHOT_INTERVAL = 5;

/** Re-fetch directives from Decision API every N behavioral signals. */
const REFETCH_SIGNAL_INTERVAL = 5;

/**
 * Number of consecutive refreshDirectives() cycles a drift archetype must be confirmed
 * before overriding the quiz-assigned session state (FOLLOW-201 / Master_Design §E.4.5).
 * Anti-thrash guard: 3 cycles prevents transient behavioral noise from flipping the archetype.
 */
export const DRIFT_HOLD_COUNT = 3;

const DWELL_THRESHOLDS_MS = [30_000, 90_000, 180_000] as const;
const DWELL_TICK_MS = 5_000;
const DWELL_TICK_TOLERANCE_MS = DWELL_TICK_MS - 500;

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

// FOLLOW-199: quiz trigger is now time-based (30s) rather than listing-view-count based.

/**
 * Structural type guard for a persisted IntentState envelope.
 *
 * Validates that a rehydrated `unknown` value from sessionStorage has the
 * required fields of IntentState before it is used as one. Intentionally
 * permissive on the `probabilities` sub-object — a full per-archetype check
 * would be expensive and adds no safety beyond the top-level fields.
 *
 * FOLLOW-176: called once per `init()` during rehydration; never called on
 * the hot path.
 */
function isValidIntentState(raw: unknown): raw is IntentState {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.archetype === 'string' &&
    typeof r.confidence === 'number' &&
    typeof r.signal_count === 'number' &&
    typeof r.last_updated_at === 'number' &&
    typeof r.quiz_answered === 'boolean' &&
    r.probabilities !== null &&
    typeof r.probabilities === 'object'
  );
}

/**
 * Main SDK initialization — called automatically when DOM is ready.
 * Wraps everything in try/catch to ensure the host page is never broken.
 *
 * Returns the final resolved IntentState after all priors and rehydration have
 * been applied, or `null` when init exits early (no script tag, consent denied,
 * or an unrecoverable error). This return value is used ONLY by `_initForTest`.
 */
async function init(): Promise<IntentState | null> {
  try {
    // FOLLOW-099 AC7 (CEO-ratified): Bot detection gate.
    // Any known crawler UA short-circuits init before session creation, DOM mutation,
    // or any data collection.  Uses globalThis.navigator to avoid esbuild constant-folding
    // of `typeof navigator` checks (same pattern as language detection in config.ts).
    const navGlobal = (globalThis as { navigator?: { userAgent?: string } }).navigator;
    if (navGlobal !== undefined && BOT_UA_RE.test(navGlobal.userAgent ?? '')) {
      return null;
    }

    // FOLLOW-208: Record session start time for listing-view-rate computation.
    // Must be set before any async await so all listing.viewed callbacks reference
    // the same origin timestamp for rate = viewCount / (elapsedMs / 60_000).
    const sessionStartedAt = Date.now();

    // 1. Find the Estalara script tag (the one with data-api-key)
    const script = document.querySelector<HTMLScriptElement>('script[data-api-key]');
    if (!script) return null;

    // 2. Read configuration from data-* attributes
    // `config` is declared with `let` because mergeQuizConfig() may replace it later
    // (ADR-0011 step 4: fetchQuizConfig → mergeQuizConfig overlays server values).
    let config = readConfig({ dataset: script.dataset });
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
      // FOLLOW-176: erase any persisted intent state for this session (if one exists
      // in sessionStorage from a prior page load where consent was still granted).
      eraseIntentState(peekStoredSessionId());
      // ADR-0011 / FOLLOW-275: erase cached quiz config on consent denial (Mode A compliance).
      eraseCachedQuizConfig();
      // The shadow host is destroyed to avoid leaving a DOM node.
      earlyHost?.destroy();
      return null;
    }

    if (consentState === 'pending') {
      if (earlyHost) {
        // Show banner and wait for the user's decision.
        // Returns true if consent was granted, false if denied.
        //
        // FOLLOW-278 / ADR-0011 (§Consent-banner locale) — Accepted constraint:
        // The consent banner renders here, BEFORE fetchQuizConfig() resolves (step 3
        // in the ADR-0011 init sequence).  By design, the fetch runs AFTER consent is
        // resolved — the consent gate must precede any network call that reads tenant
        // data, so the banner can never receive the server-fetched language/accentColor.
        //
        // `config.language` at this point is sourced from the `data-language` snippet
        // attribute (level 2) or the browser's navigator.language (level 3) or the
        // hardcoded 'en' default (level 4).  `buildSnippet()` has NEVER emitted
        // `data-language` or `data-accent-color` — these attributes were not part of
        // the snippet transport and were not retired by ADR-0011 (ADR-0011 only retired
        // `data-quiz-enabled`/`data-micro-polls-enabled`).  As a result, for tenants
        // who do not hand-code those attributes, the banner always uses the
        // navigator.language or 'en' fallback.
        //
        // Decision: this constraint is accepted (option iii of FOLLOW-278 AC1):
        //   - Compliance confirmed no locale-specific legal text in the banner that
        //     would make an 'en' banner a legal defect in a pl/es jurisdiction.
        //   - The quiz widget (rendered AFTER mergeQuizConfig()) correctly uses the
        //     server-fetched language; only the pre-consent banner is affected.
        //   - If a locale-specific consent banner becomes a compliance requirement,
        //     the fix is to ADD `data-language` to buildSnippet() for the first time
        //     (a new feature, not a re-introduction) and update ADR-0011 accordingly.
        //     See the "Consent-banner locale" addendum section added to
        //     docs/adr/ADR-0011-quiz-config-transport.md by FOLLOW-278.
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
              // ADR-0011 / FOLLOW-275: erase cached quiz config on consent denial.
              eraseCachedQuizConfig();
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
            // FOLLOW-176: erase any persisted intent state for this session.
            eraseIntentState(auditSession.sessionId);
            await dispatchEvents(batch, config, auditSession);
          }
          earlyHost.destroy();
          return null;
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

    // 4a. Initialize Bayesian intent state.
    // FOLLOW-176: attempt to rehydrate a previously persisted intent state before
    // cold-start. A successful rehydrate means the visitor already accumulated
    // signals on a prior listing page in this tab — skip cold-start hints so the
    // prior archetype is not diluted by site-level priors applied a second time.
    //
    // Consent gate: we only reach this line when consent is 'granted' (all denial
    // paths return early above). No re-check needed here.
    //
    // ADR-0012 Ticket C: `currentIntentState` is initialized with `initIntentState()`
    // (no overrides yet) as a temporary placeholder for the rehydration check.
    // The server-supplied priors (intentOverrides) are applied in step 6 inside the
    // cold-start gate AFTER the parallel fetch completes (lines below).
    let intentStateRehydrated = false;
    let currentIntentState: IntentState = initIntentState();

    {
      const raw = rehydrateIntentState(currentSession.sessionId);
      if (isValidIntentState(raw)) {
        currentIntentState = raw;
        intentStateRehydrated = true;
      }
    }

    // Read referrer, UTM, and device width unconditionally — required by session.started
    // below regardless of whether state was rehydrated.
    // globalThis property access prevents esbuild dead-code elimination (FOLLOW-202 pattern).
    const referrer = (globalThis as { document?: { referrer?: string } }).document?.referrer ?? '';
    const utmTerm =
      new URLSearchParams(
        (globalThis as { location?: { search?: string } }).location?.search ?? '',
      ).get('utm_term') ?? '';
    const windowWidth = (globalThis as { window?: { innerWidth?: number } }).window?.innerWidth;
    const deviceType = windowWidth !== undefined && windowWidth >= 1024 ? 'desktop' : 'mobile';

    // Capture referrer_domain for session.started ingest event
    let referrerDomain = '';
    try {
      if (referrer) {
        referrerDomain = new URL(referrer).hostname;
      }
    } catch {
      // Malformed referrer URL — leave empty
    }

    // Emit session.started with device_type and referrer_domain (FOLLOW-207 AC3).
    // viewport is required by SessionStartedPayloadSchema; fall back to 0x0 in non-browser envs.
    const sessionViewport =
      windowWidth !== undefined
        ? {
            width: windowWidth,
            height: (globalThis as { window?: { innerHeight?: number } }).window?.innerHeight ?? 0,
          }
        : { width: 0, height: 0 };
    eventQueue.push({
      type: 'session.started',
      payload: {
        device_class: deviceType,
        viewport: sessionViewport,
        language: config.language,
        ...(referrerDomain ? { referrer_domain: referrerDomain } : {}),
        device_type: deviceType,
      },
      ts: Date.now(),
    });

    // 4b-dqs. Initialize per-session DQS tracker (TICKET-DQS-001)
    const dqsTracker = new DqsTracker(currentSession.sessionId);
    let dqsUpdateCount = 0;

    // FOLLOW-208: Per-session listing view counter — declared here (before flushDqsSnapshot)
    // so the snapshot closure can read the accumulated count. The counter is incremented
    // inside the listing.viewed branch of the setupObservers callback below.
    let listingViewCount = 0;

    /** Push a session.quality.snapshot event into the queue. */
    function flushDqsSnapshot(): void {
      const snap = dqsTracker.snapshot();
      // FOLLOW-208: include listing_view_rate (views per minute) in every snapshot.
      // Rate is 0 until the second view has been seen (listingViewCount < 2 → 0).
      const elapsedMsSnap = Date.now() - sessionStartedAt;
      const listing_view_rate =
        listingViewCount >= 2 && elapsedMsSnap > 0
          ? listingViewCount / (elapsedMsSnap / 60_000)
          : 0;
      eventQueue.push({
        type: 'session.quality.snapshot',
        payload: {
          ...(snap as unknown as Record<string, unknown>),
          listing_view_rate,
        },
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
      // FOLLOW-176: persist the latest intent state to sessionStorage so subsequent
      // listing page loads in this tab can rehydrate immediately.
      // Consent is guaranteed at this point — all denial paths return early above.
      persistIntentState(currentSession.sessionId, currentIntentState);
    }

    /** Confidence threshold above which the sidebar widget becomes visible. */
    const SIDEBAR_SHOW_THRESHOLD = 0.6;

    // Declared here (null) so refreshDirectives() can reference it without TDZ error.
    // Assigned to the actual widget after createShadowHost() runs below (step 5a).
    let sidebar: SidebarWidgetController | null = null;

    let dwellTimer: ReturnType<typeof setInterval> | null = null;
    let adaptedAt = 0;
    const firedThresholds = new Set<number>();

    // F-15 (FOLLOW-194): track the last archetype returned by the Decision API.
    // resetAdaptState() is called ONLY when the archetype changes, preventing the
    // text-flicker that occurred every ~30s when resetAdaptState() was called
    // unconditionally on every refreshDirectives() cycle.
    let previousArchetype: string | null = null;
    // FOLLOW-258 F-04: store the most recent adapt_decision_id for live.signup attribution.
    let lastAdaptDecisionId: string | undefined;

    // FOLLOW-201: per-session drift detection state (per-instance — RETRO-006 LG-2).
    // Tracks consecutive refreshDirectives() cycles where detectMismatch() fires for
    // the same suggested archetype. Only overrides quiz state when driftCandidateCount
    // reaches DRIFT_HOLD_COUNT (anti-thrash guard per Master_Design §E.4.5).
    let driftCandidateArchetype: Archetype | null = null;
    let driftCandidateCount = 0;

    // Declared here so refreshDirectives() can reference it without TDZ error.
    // Populated by the observer callback after step 6 below.
    // FOLLOW-201: also used for drift detection inside refreshDirectives().
    const signalHistory: { eventType: string; payload?: Record<string, unknown> }[] = [];

    // K.3.6 FOLLOW-266 Phase 3 — intent.snapshot emission context.
    // A mutable object so quizCompleted / quizLeaf / chatTurns can be updated in-place
    // by the quiz, micro-poll, and chat-message callbacks below without redeclaring.
    // Per-instance (not module-level) to satisfy RETRO-006 LG-2.
    const snapshotCtx: IntentSnapshotContext = {
      eventQueue,
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
     *   below checks whether `(currentIntentState.dwell_ticks_applied ?? 0)` has
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
        if (currentIntentState.archetype === 'neutral') return;
        // LG-2 (FOLLOW-227): enforce per-session cap before applying any boost.
        // `dwell_ticks_applied` is persisted so it survives the rehydrate boundary.
        if ((currentIntentState.dwell_ticks_applied ?? 0) >= DWELL_MAX_SESSION_CONTRIBUTION) {
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
            if ((currentIntentState.dwell_ticks_applied ?? 0) >= DWELL_MAX_SESSION_CONTRIBUTION) {
              break;
            }
            currentIntentState = applyDwellSignal(currentIntentState, elapsed);
            onIntentUpdate(currentIntentState.archetype, currentIntentState.confidence);
          }
        }
      }, DWELL_TICK_MS);
    }
    /** Re-fetch directives and apply them with the latest intent state. */
    async function refreshDirectives(): Promise<void> {
      if (!config.decisionApiUrl) return;

      // F-08 (FOLLOW-194): detect pageType from URL / data-page-type attribute.
      // F-13 (FOLLOW-194): read the current listing ID for per-listing RAG context.
      // script is guaranteed non-null here -- init() returns early if !script (line 88).
      const pageType = detectPageType(scriptDataset);
      const listingId = detectListingId();

      const { adaptResponse: resp, updatedIntentState } = await fetchDirectives(
        config,
        currentSession,
        pageType,
        currentIntentState,
        listingId,
      );

      // FOLLOW-101: if the chat-intent prior was applied, update currentIntentState
      // and notify the DQS tracker. The persist already happened inside fetchDirectives.
      if (updatedIntentState !== undefined) {
        currentIntentState = updatedIntentState;
        onIntentUpdate(currentIntentState.archetype, currentIntentState.confidence);
      }

      if (resp) {
        // FOLLOW-258 F-04: persist for live.signup conversion attribution.
        lastAdaptDecisionId = resp.adapt_decision_id;
        // F-15 (FOLLOW-194): only reset adapt state when the archetype has changed.
        // On an unchanged archetype, preserve existing DOM mutations -- no flicker.
        if (resp.archetype !== previousArchetype) {
          resetAdaptState();
          previousArchetype = resp.archetype;
          if (resp.archetype !== 'neutral') {
            startDwellTimer();
          } else {
            stopDwellTimer();
          }
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

      // FOLLOW-201: Post-directive drift detection.
      // Only runs when the quiz has been answered — no quiz means no quiz-vs-behavioral
      // discrepancy to detect. AC5: description_cache_persistent is NOT modified here;
      // applyQuizLeaf() is session-only (no DB write).
      if (currentIntentState.quiz_answered) {
        const behavioralOnlyState = calculateBehavioralOnlyState(signalHistory);
        const mismatch = detectMismatch(
          currentIntentState.archetype,
          behavioralOnlyState,
          currentSession.sessionId,
        );

        if (mismatch) {
          // Behavioral signals consistently suggest a different archetype.
          // Track the candidate for DRIFT_HOLD_COUNT consecutive cycles before acting.
          const candidate = mismatch.behavioral_archetype;
          if (candidate === driftCandidateArchetype) {
            driftCandidateCount += 1;
          } else {
            driftCandidateArchetype = candidate;
            driftCandidateCount = 1;
          }

          if (driftCandidateCount >= DRIFT_HOLD_COUNT) {
            // Anti-thrash guard satisfied: override quiz archetype with behavioral evidence.
            // applyQuizLeaf() sets high confidence (0.85) for the drift archetype — same
            // mechanism as quiz leaf but triggered by sustained behavioral mismatch.
            // `candidate` is the confirmed drift archetype (Archetype, never null).
            currentIntentState = applyQuizLeaf(currentIntentState, candidate);
            onIntentUpdate(currentIntentState.archetype, currentIntentState.confidence);
            // Reset candidate state so the cycle can begin again if drift continues.
            driftCandidateArchetype = null;
            driftCandidateCount = 0;
            // Re-fetch directives with the updated intent state.
            await refreshDirectives();
          }
        } else {
          // Signals aligned with quiz archetype — reset candidate count but preserve
          // driftCandidateArchetype so a resuming trend can still accumulate.
          driftCandidateCount = 0;
        }
      }
    }

    // ADR-0012 Ticket C (FOLLOW-268-sdk) + ADR-0011 (FOLLOW-275):
    // Steps 3a + 3b run IN PARALLEL — both fetches are bounded to 1000ms each
    // and must both complete (or timeout) before steps 5–8 run.
    //
    //   3a. fetchQuizConfig  — GET /api/quiz/public-config (ADR-0011)
    //   3b. fetchIntentWeights — GET /api/intent/config (ADR-0012)
    //
    // Rule R gate: `intentStateRehydrated` is passed to `fetchQuizConfig()` so that
    // cross-listing navigations within the same tab reuse the sessionStorage-cached
    // quiz config instead of re-fetching. Intent weights are NOT cached because they
    // are applied once to initIntentState and the resulting IntentState is rehydrated
    // from sessionStorage on subsequent navigations (see session.ts / Rule R comment).
    //
    // `config` is reassigned here (declared `let` above for exactly this purpose).
    // On any failure either fetch returns null; mergeQuizConfig / resolveIntentOverrides
    // fall back to snippet-attribute values / SDK internal defaults respectively.
    let intentOverrides: IntentEngineOverrides = resolveIntentOverrides(null);
    if (config.decisionApiUrl) {
      const [fetchedQuizConfig, fetchedWeights] = await Promise.all([
        fetchQuizConfig(
          config.decisionApiUrl,
          config.apiKey,
          intentStateRehydrated,
          1_000,
          config.debug,
        ),
        // Step 3b: fetch intent weight overrides (ADR-0012 Ticket C).
        // On a rehydrated session, the intent state is already persisted with the
        // cold-start priors applied — refetching weights would not affect the
        // rehydrated distribution. We still fetch so any weight config change is
        // observable in debug mode; the result is passed to resolveIntentOverrides
        // which is a no-op when intentStateRehydrated=true (overrides are not applied
        // to the already-rehydrated state — see the cold-start gate below).
        fetchIntentWeights(config.decisionApiUrl, config.apiKey, 1_000, config.debug),
      ]);

      config = mergeQuizConfig(config, fetchedQuizConfig);
      intentOverrides = resolveIntentOverrides(fetchedWeights);

      if (config.debug && fetchedQuizConfig === null) {
        console.warn('[Estalara] fetchQuizConfig returned null — using snippet/default fallback');
      }
    }

    // FOLLOW-219 / ADR-0012 Ticket C: Single cold-start gate.
    // ALL init-time priors and the LG-2 persist live inside this one block so the
    // guard cannot be partially applied.
    //
    // Moved to AFTER the parallel fetch (step 3a/3b) so that `initIntentState` can
    // be called with server-supplied `intentOverrides` (ADR-0012 §3 init sequence step 6).
    //
    // Why each step is skipped on rehydration:
    //   - initIntentState(overrides): rehydrated state already has all cold-start priors
    //     baked in; applying overrides again would double-count and perturb the distribution.
    //   - Archetype hints (4a-f02): already folded in on the first listing page (FOLLOW-176).
    //   - Referrer + device (FOLLOW-207, FOLLOW-216 LG-1): already applied on the first page;
    //     re-applying would perturb the archetype and inflate signal_count by +1 per nav.
    //   - LG-2 persist (FOLLOW-216): the persisted entry is already current; a second write is
    //     a no-op in terms of state but would be caught as a double-write by follow-217 tests.
    //
    // Adding a new cold-start prior: add it INSIDE this block. A prior added outside this block
    // without its own guard would be caught by the follow-217 integration tests (signal_count
    // is asserted unchanged on every rehydrated-session test).
    if (!intentStateRehydrated) {
      // Step 6 (ADR-0012): re-initialize with server-supplied priors now that the fetch
      // has completed. `intentOverrides` contains server values (or SDK defaults on null).
      // This replaces the temporary `initIntentState()` placeholder from step 4a above.
      currentIntentState = initIntentState(intentOverrides);

      // 4a-f02. Archetype hints as cold-start Bayesian prior [AUDIT-F02].
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

      // Referrer hints (cold-session prior, FOLLOW-207).
      // Applied after archetype hints so site-level hints are already folded in.
      currentIntentState = applyReferrerHints(currentIntentState, referrer, utmTerm);

      // Device type prior (FOLLOW-207).
      // Pass intentOverrides so the damping and signal likelihoods respect server config.
      currentIntentState = applyBehavioralSignal(
        currentIntentState,
        `device_type.${deviceType}`,
        undefined,
        intentOverrides,
      );

      // FOLLOW-216 (LG-2): Persist the cold-start intent state (after all init-time priors have
      // been applied) once, before the first refreshDirectives(). This ensures the very first
      // cross-listing navigation in the same tab can rehydrate the cold-start archetype even if
      // no behavioral signal has fired yet (onIntentUpdate is the only other persist site, but
      // it fires only after a behavioral event).
      persistIntentState(currentSession.sessionId, currentIntentState);
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

    let quizTriggered = false;
    /** True once the full quiz decision tree is completed this session. */
    let quizCompletedThisSession = false;
    /** Index of the next micro-poll question to show (0-based). */
    let microPollQuestionIndex = 0;
    /** True once a micro-poll has been shown this session (one per session). */
    let microPollShownThisSession = false;

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

        // Update Bayesian intent state from this behavioral signal.
        // Pass intentOverrides so server-supplied damping and likelihoods are used
        // for all ongoing behavioral signals (ADR-0012 Ticket C).
        const prevSignalCount = currentIntentState.signal_count;
        currentIntentState = applyBehavioralSignal(
          currentIntentState,
          event.type,
          event.payload,
          intentOverrides,
        );
        onIntentUpdate(currentIntentState.archetype, currentIntentState.confidence);

        // FOLLOW-208: Apply listing-view rate signal after the second view.
        // Rate = viewCount / (elapsedMs / 60_000). Only fires when viewCount >= 2
        // (first view is baseline). applyListingViewRate is a pure function — it
        // returns state unchanged for any case that does not match a boost bracket.
        if (event.type === 'listing.viewed') {
          listingViewCount += 1;
          if (listingViewCount >= 2) {
            const elapsedMs = Date.now() - sessionStartedAt;
            currentIntentState = applyListingViewRate(
              currentIntentState,
              listingViewCount,
              elapsedMs,
            );
            onIntentUpdate(currentIntentState.archetype, currentIntentState.confidence);
          }
        }

        // Re-fetch directives every REFETCH_SIGNAL_INTERVAL behavioral signals
        if (
          currentIntentState.signal_count > prevSignalCount &&
          currentIntentState.signal_count % REFETCH_SIGNAL_INTERVAL === 0
        ) {
          void refreshDirectives();
        }

        // K.3.6 FOLLOW-266 Phase 3: emit intent.snapshot every 5 behavioral signals.
        // Fire-and-forget — emitIntentSnapshot is synchronous (queue push only).
        // Condition: signal_count crossed a 5-multiple boundary on THIS signal.
        if (
          currentIntentState.signal_count > prevSignalCount &&
          currentIntentState.signal_count % 5 === 0 &&
          currentIntentState.signal_count > 0
        ) {
          emitIntentSnapshot(currentIntentState, snapshotCtx);
        }

        // listing.viewed signal no longer drives the quiz trigger (FOLLOW-199).
        // The quiz is now scheduled via a 30s setTimeout after SDK init (see below).
      },
      // Thread inquiry_submit_selector from tenant site schema → SdkConfig → observer options.
      // This was the root cause of inquiry.started never firing in production (FOLLOW-097).
      // Build options object conditionally to satisfy exactOptionalPropertyTypes strictness.
      config.inquirySubmitSelector !== undefined
        ? { inquirySubmitSelector: config.inquirySubmitSelector }
        : {},
    );

    // FOLLOW-199: Schedule quiz trigger 30s after SDK init, on any page type.
    // The trigger is shown only if the quiz has not been dismissed in the past 24h.
    // Clicking the trigger opens the v2 branching decision-tree quiz widget.
    //
    // FOLLOW-102: config.quiz?.enabled === false suppresses the quiz entirely for
    // tenants that rely on behavioral + chat NLP signals only (§B.1 / §D.6).
    // No prompt, no widget, no quiz events are emitted when the quiz is disabled.
    function showQuizTrigger(): void {
      if (config.quiz?.enabled === false) return;
      if (!shadowHost || quizTriggered) return;
      quizTriggered = true;
      renderQuizTrigger(
        shadowHost.root,
        { accentColor: quizConfig.accentColor, icon: '🎯', language: quizConfig.language },
        () => {
          renderQuizWidget(
            shadowHost.root,
            quizConfig,
            (resolvedArchetype) => {
              // Apply v2 quiz leaf result to intent state (applyQuizLeaf — FOLLOW-199).
              // Note: full mismatch detection wiring is FOLLOW-201.
              quizCompletedThisSession = true;
              // K.3.6 FOLLOW-266: update snapshot context so intent.snapshot payloads
              // reflect quiz completion state on the next 5-signal boundary or beforeunload.
              snapshotCtx.quizCompleted = true;
              snapshotCtx.quizLeaf = resolvedArchetype;
              currentIntentState = applyQuizLeaf(currentIntentState, resolvedArchetype);
              onIntentUpdate(currentIntentState.archetype, currentIntentState.confidence);
              if (config.debug) {
                console.log(
                  `[Estalara] Quiz → archetype=${currentIntentState.archetype} confidence=${String(currentIntentState.confidence)}`,
                );
              }

              // FOLLOW-200: persist quiz completion to Postgres for MOAT training data.
              // Fire-and-forget — must never block the quiz dismiss UI.
              // Fails silently (postQuizCompletionPing catches all errors internally).
              postQuizCompletionPing(
                config,
                currentSession.sessionId,
                currentIntentState.archetype,
                quizConfig.language,
              );

              eventQueue.push({
                type: 'quiz.event',
                payload: {
                  step: 'completed',
                  trigger: 'prompt_after_30s',
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
              // FOLLOW-209: quiz dismissed → attempt micro-poll as fallback
              tryShowMicroPoll();
            },
          );
        },
      );
    }

    const cancelQuizTimer = scheduleQuizTrigger(showQuizTrigger);

    // FOLLOW-209: Micro-poll bottom-toast trigger.
    // Conditions (all must be true):
    //   (a) micro_polls_enabled === true in config
    //   (b) full quiz NOT completed this session
    //   (c) micro-poll not already shown this session
    //   (d) 24h localStorage cooldown not active
    //   (e) triggered after quiz dismiss OR 90s since session start
    //
    // The micro-poll shows one question per trigger (sequence advances across listing views).
    // On answer: apply micro_poll.answered behavioral signal + emit quiz.event with
    //   trigger='micro_poll'. On dismiss: set 24h cooldown.

    /**
     * Attempt to show the next micro-poll question.
     * Guards: quiz completed / already shown / cooldown / feature flag / all questions shown.
     */
    function tryShowMicroPoll(): void {
      // All guards from spec (FOLLOW-209 §Trigger conditions)
      if (!config.microPollsEnabled) return;
      if (quizCompletedThisSession) return;
      if (microPollShownThisSession) return;
      if (isMicroPollDismissed()) return;
      if (!shadowHost) return;

      const questions = DEFAULT_MICRO_POLL_QUESTIONS;
      if (microPollQuestionIndex >= questions.length) return;

      const question = questions[microPollQuestionIndex];
      if (!question) return;

      microPollShownThisSession = true;

      renderMicroPoll(
        shadowHost.root,
        { accentColor: config.accentColor },
        question,
        (questionKey: string, answer: 'yes' | 'no') => {
          // Advance to next question (shown after next listing view)
          microPollQuestionIndex += 1;
          microPollShownThisSession = false;

          // Apply micro_poll.answered behavioral signal to intent state
          const prevSignalCount = currentIntentState.signal_count;
          currentIntentState = applyBehavioralSignal(currentIntentState, 'micro_poll.answered', {
            question: questionKey,
            answer,
          });
          signalHistory.push({
            eventType: 'micro_poll.answered',
            payload: { question: questionKey, answer },
          });
          onIntentUpdate(currentIntentState.archetype, currentIntentState.confidence);

          // Emit quiz.event with trigger='micro_poll' for ingest pipeline
          eventQueue.push({
            type: 'quiz.event',
            payload: {
              step: 'micro_poll_answered',
              trigger: 'micro_poll',
              archetype: currentIntentState.archetype,
              confidence: currentIntentState.confidence,
              micro_poll_question: questionKey,
              micro_poll_answer: answer,
            },
            ts: Date.now(),
          });

          // Re-fetch directives if this crosses a REFETCH interval
          if (
            currentIntentState.signal_count > prevSignalCount &&
            currentIntentState.signal_count % REFETCH_SIGNAL_INTERVAL === 0
          ) {
            void refreshDirectives();
          }

          if (config.debug) {
            console.log('[Estalara] micro_poll.answered', {
              question: questionKey,
              answer,
              archetype: currentIntentState.archetype,
              confidence: currentIntentState.confidence,
            });
          }
        },
        () => {
          // Dismissed — 24h cooldown is set inside renderMicroPoll before onDismiss fires
          if (config.debug) {
            console.log('[Estalara] micro-poll dismissed');
          }
        },
      );
    }

    // Trigger micro-poll after 90s (spec §Trigger condition: 90s elapsed since session start)
    // if micro_polls_enabled is set. Runs independently of the quiz 30s timer.
    if (config.microPollsEnabled) {
      setTimeout(() => {
        tryShowMicroPoll();
      }, 90_000);
    }

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

        // F-01 (FOLLOW-258): message field is required by ChatMessageSentPayloadSchema.
        // F-29 (FOLLOW-258): scrub PII (email/phone) before storing in ClickHouse.
        const rawMessage = typeof ce.detail.message === 'string' ? ce.detail.message : '';
        if (rawMessage.length === 0) return;
        // K.3.6 FOLLOW-266: count buyer chat turns for intent.snapshot payload.
        snapshotCtx.chatTurns += 1;
        eventQueue.push({
          type: 'chat.message.sent',
          payload: {
            message: scrubMessagePii(rawMessage),
            char_count: typeof ce.detail.char_count === 'number' ? ce.detail.char_count : undefined,
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
        // FOLLOW-258 F-04: thread adapt_decision_id for conversion attribution when slot_uuid absent.
        eventQueue.push({
          type: 'live.signup',
          payload: {
            slot_uuid: typeof ce.detail.slot_uuid === 'string' ? ce.detail.slot_uuid : undefined,
            lead_id: leadId,
            source_surface:
              typeof ce.detail.source_surface === 'string' ? ce.detail.source_surface : undefined,
            adapt_decision_id: lastAdaptDecisionId,
          },
          ts: Date.now(),
        });
      })();
    });

    // FOLLOW-210: Favorites/bookmark signal bridge.
    // Listens for estalara:listing:favorited / estalara:listing:unfavorited CustomEvents
    // dispatched by app.estalara.com (window) on successful save/unsave.
    //
    // On favorited: (a) queue listing.bookmarked ingest event, (b) apply listing.bookmarked
    // behavioral signal (with payload-conditional boosts handled inside applyBehavioralSignal).
    // On unfavorited: log only — no intent signal (removal is ambiguous).

    window.addEventListener('estalara:listing:favorited', (e: Event) => {
      const ce = e as CustomEvent<Record<string, unknown>>;
      const detail = ce.detail;

      const listingId = typeof detail.listingId === 'string' ? detail.listingId : undefined;
      const listingType = typeof detail.listingType === 'string' ? detail.listingType : undefined;
      const priceRange = typeof detail.priceRange === 'string' ? detail.priceRange : undefined;
      const bedroomCount =
        typeof detail.bedroomCount === 'number' ? detail.bedroomCount : undefined;

      // (a) Queue listing.bookmarked ingest event
      eventQueue.push({
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
      const payload: Record<string, unknown> = {};
      if (listingType !== undefined) payload.listingType = listingType;
      if (bedroomCount !== undefined) payload.bedroomCount = bedroomCount;

      const prevSignalCount = currentIntentState.signal_count;
      currentIntentState = applyBehavioralSignal(currentIntentState, 'listing.bookmarked', payload);
      signalHistory.push({ eventType: 'listing.bookmarked', payload });
      onIntentUpdate(currentIntentState.archetype, currentIntentState.confidence);

      // Re-fetch directives if this crosses a REFETCH interval
      if (
        currentIntentState.signal_count > prevSignalCount &&
        currentIntentState.signal_count % REFETCH_SIGNAL_INTERVAL === 0
      ) {
        void refreshDirectives();
      }

      if (config.debug) {
        console.log('[Estalara] listing.bookmarked received', {
          listingId,
          listingType,
          bedroomCount,
          archetype: currentIntentState.archetype,
          confidence: currentIntentState.confidence,
        });
      }
    });

    window.addEventListener('estalara:listing:unfavorited', (e: Event) => {
      const ce = e as CustomEvent<Record<string, unknown>>;
      const listingId = typeof ce.detail.listingId === 'string' ? ce.detail.listingId : undefined;

      // No intent signal — removal is ambiguous (user may have already found their match).
      // Log only for observability.
      if (config.debug) {
        console.log('[Estalara] listing.unfavorited received', { listingId });
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
      if (document.visibilityState === 'hidden') {
        stopDwellTimer();
        handleSessionEnd();
      }
    });

    // K.3.6 FOLLOW-266 Phase 3: emit a final intent.snapshot on beforeunload so the
    // ingest pipeline always receives the session-end archetype state.
    // The handler is stored so it can be removed in destroy() / teardown — avoids a
    // memory leak on SPA navigations where destroy() is called without a page reload.
    function handleBeforeUnload(): void {
      emitIntentSnapshot(currentIntentState, snapshotCtx);
      handleSessionEnd();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);

    if (config.debug) {
      console.log(`[Estalara] SDK ${SDK_VERSION} initialized`, {
        tier: config.tier,
        sessionId: currentSession.sessionId.slice(0, 8) + '...',
      });
    }

    // Store cleanup on window for testing / SPA teardown
    (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown = () => {
      if (flushTimer) clearInterval(flushTimer);
      cancelQuizTimer();
      stopDwellTimer();
      cleanupObservers();
      teardownDescriptionObservers();
      sidebar?.destroy();
      shadowHost?.destroy();
      dqsTracker.reset();
      // K.3.6 FOLLOW-266: remove the beforeunload listener to avoid a memory leak on
      // SPA navigations where destroy() is called without an actual page unload.
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };

    // Return the final resolved intent state (used only by _initForTest seam).
    return currentIntentState;
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

/**
 * Estalara.identify() — stub for Profile Mode (Sprint 12+).
 * Call this when a visitor opts in to profile creation.
 * No-op in MVP — the profile_id is stored for when Profile Mode is enabled.
 */
export function identify(_profileId: string): void {
  // No-op stub — forward-compat for Profile Mode (U.11, Sprint 12+)
}

// ─── Intent engine public API (re-exported for FOLLOW-101 chat-intent bridge) ──
export { applyChatIntentPrior, CHAT_INTENT_LIKELIHOODS } from './core/intent.js';
export type { Archetype, ArchetypeProbabilities, IntentState } from './core/intent.js';

// ─── Auto-detect sub-module ────────────────────────────────────────────────────
export type { DetectionResult } from './auto-detect/index.js';
export { detectSiteSchema } from './auto-detect/index.js';

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
