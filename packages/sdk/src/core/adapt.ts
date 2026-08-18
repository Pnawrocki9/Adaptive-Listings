/**
 * Adaptation client — fetches personalization directives from Decision API.
 *
 * Called once per session init, results cached for ttl_seconds.
 * Never throws — returns null on any error.
 *
 * @module @estalara/sdk/core/adapt
 */

import type { SessionState } from './session.js';
import { getConsentState, persistIntentState } from './session.js';
import type { SdkConfig } from './config.js';
import type {
  TextDirective,
  ClassDirective,
  ReorderDirective,
  ArchetypeId,
  QuizLanguage,
} from '@estalara/shared';
import type { CollectedEvent } from './events.js';
import type { IntentState } from './intent.js';
import { applyChatIntentPrior } from './intent.js';
import { adaptResponseSchema } from './adapt-schema.js';
import { buildEndpoint } from './endpoint.js';
import { getHeadlineOwner, setHeadlineOwner, clearHeadlineOwner } from './headline-ownership.js';

// ---------------------------------------------------------------------------
// Session-level variant cache (sessionStorage, cleared on tab close)
// ---------------------------------------------------------------------------

const SESSION_VARIANT_KEY_PREFIX = 'estalara_variant:';

function cacheVariant(sessionId: string, variant: string): void {
  try {
    sessionStorage.setItem(`${SESSION_VARIANT_KEY_PREFIX}${sessionId}`, variant);
  } catch {
    // No-op: sessionStorage unavailable (SSR / privacy mode / storage full)
  }
}

function getCachedVariant(sessionId: string): string | null {
  try {
    return sessionStorage.getItem(`${SESSION_VARIANT_KEY_PREFIX}${sessionId}`);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Feedback ping (fire-and-forget POST to /api/adapt/feedback)
// ---------------------------------------------------------------------------

/**
 * Derive the feedback URL from the adapt endpoint base URL.
 * Falls back to config.feedbackUrl if present.
 *
 * Convention (FOLLOW-305): decisionApiUrl = host + `/api` (e.g. "https://admin.estalara.com/api").
 * buildEndpoint appends `/adapt/feedback` → "https://admin.estalara.com/api/adapt/feedback".
 * DO NOT prepend `/api` here — it is already in decisionApiUrl.
 */
function deriveFeedbackUrl(config: SdkConfig): string | null {
  if (config.feedbackUrl) return config.feedbackUrl;
  if (!config.decisionApiUrl) return null;
  return buildEndpoint(config.decisionApiUrl, '/adapt/feedback');
}

/**
 * Compute HMAC-SHA256(key=secret, data=message) and return the lower-case hex digest.
 *
 * Uses the Web Crypto API available in modern browsers. Returns null in
 * environments where SubtleCrypto is unavailable (e.g. very old browsers or SSR
 * without polyfill) so callers can fall back gracefully.
 *
 * @internal
 */
async function computeHmacSha256Hex(secret: string, message: string): Promise<string | null> {
  try {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(message));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

/**
 * Report a non-2xx feedback response to Sentry as a breadcrumb (FOLLOW-450 AC3).
 *
 * Before this, a disabled/misconfigured feedback endpoint (e.g. a 503 from
 * `FEEDBACK_ENDPOINT_ENABLED` being unset, or a 401 from a rotated key) resolved
 * the fetch promise successfully and was never surfaced anywhere — not even
 * console.warn — so a re-disabled endpoint in production was invisible until
 * someone manually checked the bandit weights. A breadcrumb (not an exception —
 * this is an expected server response, not a JS error) attaches to the next
 * captured Sentry event for this session, giving operators a trail.
 *
 * @internal
 */
function reportFeedbackPingRejected(status: number, tenantId: string | undefined): void {
  console.warn(`[estalara] feedback ping rejected: HTTP ${String(status)}`);
  const gSentry = (globalThis as { Sentry?: { addBreadcrumb?: (b: unknown) => void } }).Sentry;
  gSentry?.addBreadcrumb?.({
    category: 'estalara.feedback',
    message: `feedback ping rejected: HTTP ${String(status)}`,
    level: status >= 500 ? 'error' : 'warning',
    data: { status, tenant_id: tenantId },
  });
}

/**
 * Post a conversion signal to the feedback endpoint. Fire-and-forget — never awaited,
 * never throws. Network errors are logged to console.warn only.
 *
 * Auth scheme (FOLLOW-051): the request body is HMAC-SHA256-signed with the
 * tenant's public API key as the secret. The hex digest is sent in the
 * `X-Estalara-Signature` header. When SubtleCrypto is unavailable (rare legacy
 * environments), the ping is skipped to avoid sending an unsigned request that
 * the server would reject.
 *
 * FOLLOW-450 AC3: a non-2xx HTTP response (e.g. the 503 the endpoint returns
 * while `FEEDBACK_ENDPOINT_ENABLED` is unset, or a 401 on an unknown/revoked
 * key) is reported to Sentry as a breadcrumb via `reportFeedbackPingRejected`
 * so a re-disabled endpoint is observable instead of silently dropped.
 */
function postFeedbackPing(
  config: SdkConfig,
  sessionId: string,
  archetype: string,
  variant: string,
  converted: boolean,
  predictionId: string | undefined,
  leadId: string | undefined,
): void {
  const feedbackUrl = deriveFeedbackUrl(config);
  if (!feedbackUrl || !config.tenantId) return;

  // FOLLOW-259: prediction_id activates the §T Conversion Label Loop on the server.
  // lead_id ties the label to a pseudonymous buyer for future fine-tuning.
  const body = JSON.stringify({
    session_id: sessionId,
    tenant_id: config.tenantId,
    archetype,
    variant,
    converted,
    ...(predictionId ? { prediction_id: predictionId } : {}),
    ...(leadId ? { lead_id: leadId } : {}),
  });

  // Sign and send — async, fire-and-forget.
  computeHmacSha256Hex(config.apiKey, body)
    .then((signatureHex) => {
      if (signatureHex === null) {
        // SubtleCrypto unavailable — skip ping rather than send unsigned request.
        console.warn('[estalara] feedback ping skipped: SubtleCrypto unavailable');
        return;
      }
      return fetch(feedbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          'X-Estalara-Signature': signatureHex,
        },
        body,
      }).then((res) => {
        if (!res.ok) {
          reportFeedbackPingRejected(res.status, config.tenantId);
        }
      });
    })
    .catch((err: unknown) => {
      console.warn(
        '[estalara] feedback ping failed:',
        err instanceof Error ? err.message : String(err),
      );
    });
}

// ---------------------------------------------------------------------------
// Quiz completion ping (fire-and-forget POST to /api/quiz/completion)
// ---------------------------------------------------------------------------

/**
 * Derive the quiz completion URL from the decision API base URL.
 *
 * Convention (FOLLOW-305): decisionApiUrl = host + `/api` (e.g. "https://admin.estalara.com/api").
 * buildEndpoint appends `/quiz/completion` → "https://admin.estalara.com/api/quiz/completion".
 * DO NOT prepend `/api` here — it is already in decisionApiUrl.
 *
 * @internal
 */
function deriveQuizCompletionUrl(config: SdkConfig): string | null {
  if (!config.decisionApiUrl) return null;
  return buildEndpoint(config.decisionApiUrl, '/quiz/completion');
}

/**
 * The walk the buyer actually took, root→leaf (FOLLOW-1020).
 *
 * `question_ids[i]` is the question that was ON SCREEN when the buyer picked
 * `answer_indexes[i]`, so the two arrays are the same length and pair positionally. The ids
 * matter as much as the indexes: the tree is tenant-editable data (ADR-0019), so an index
 * alone cannot be reconstructed into an answer once an operator reorders a question.
 *
 * A quiz can only be completed by walking from `definition.root`, so a reported path is never
 * empty — which is what lets a stored row distinguish "the buyer skipped at Q1" (a path of
 * length 1 whose answer is a leaf) from "this row predates reporting" (no path at all).
 */
export interface QuizAnswerPath {
  question_ids: string[];
  answer_indexes: number[];
}

/**
 * Flatten a walked quiz path into the completion-row fields (FOLLOW-1020).
 *
 * `branch` is the question the ROOT answer led to — `question_ids[1]`. That is the generic
 * form of the fixed `INWESTOR` / `OWN_USE` / `CROSS_BORDER` split the column was created for,
 * and it keeps working when a tenant edits the tree, which a hardcoded name would not. A root
 * answer that is itself a leaf (the "just browsing" skip) has no second question and therefore
 * no branch — `null`, exactly the case the column documents.
 *
 * `q1_answer` is always present in a reported path (a quiz cannot be completed without
 * answering the root), which is what makes it the discriminator between a genuine skip and a
 * row written before this reporting existed.
 *
 * @param path - The root→leaf walk from the quiz widget.
 * @returns The subset of completion-row fields the path determines.
 * @internal
 */
function quizPathFields(path: QuizAnswerPath): Record<string, unknown> {
  const [q1, q2, q3] = path.answer_indexes;
  return {
    branch: path.question_ids[1] ?? null,
    ...(q1 !== undefined ? { q1_answer: q1 } : {}),
    q2_answer: q2 ?? null,
    q3_answer: q3 ?? null,
    answer_path: path.question_ids.map((questionId, i) => ({
      question_id: questionId,
      answer_index: path.answer_indexes[i],
    })),
  };
}

/**
 * Post a quiz completion record to POST /api/quiz/completion. Fire-and-forget —
 * never awaited, never throws. The quiz dismiss UI must not be blocked.
 *
 * Auth: HMAC-SHA256 tenant-scoped (same as /api/adapt/feedback, FOLLOW-051):
 *   Authorization: Bearer {apiKey}
 *   X-Estalara-Signature: HMAC-SHA256(apiKey, bodyText)
 *
 * When SubtleCrypto is unavailable the ping is skipped rather than sending an
 * unsigned request that the server will reject (consistent with postFeedbackPing).
 *
 * Failures are caught and logged to console.warn — they must never propagate to the
 * caller or affect the quiz dismiss flow.
 *
 * §H.9 defense-in-depth (FOLLOW-389 HW-1): when `profilingOptedOut=true` the query
 * param `profiling_opt_out=1` is appended so the server gate at
 * `apps/control-plane/src/app/api/quiz/completion/route.ts:363` can skip
 * persistence even if the primary Guard 1 (`showQuizTrigger` early return at
 * `index.ts:1103`) is somehow bypassed. This branch is reachable ONLY as
 * defense-in-depth if Guard 1 regresses — NOT under normal production traffic
 * (Guard 1 returns before `renderQuizTrigger`, so `postQuizCompletionPing` is
 * never called for opted-out sessions under normal conditions).
 *
 * @param config           - SDK configuration (needs apiKey + decisionApiUrl).
 * @param sessionId        - Current session identifier.
 * @param resolvedArchetype - Quiz leaf archetype (or 'neutral').
 * @param language         - Quiz locale (canonical `QuizLanguage` from `@estalara/shared`, FOLLOW-273).
 * @param profilingOptedOut - When true, appends `?profiling_opt_out=1` to signal
 *                            server-side persistence skip (§H.9 defense-in-depth).
 * @param answerPath       - The root→leaf walk the buyer took (FOLLOW-1020). Omitted only by
 *                           callers that have no path to report; the row is then stored
 *                           without one and the staff viewer renders it as "not reported"
 *                           rather than inventing a Q1 skip.
 */
export function postQuizCompletionPing(
  config: SdkConfig,
  sessionId: string,
  resolvedArchetype: string,
  language: QuizLanguage,
  profilingOptedOut?: boolean,
  answerPath?: QuizAnswerPath,
): void {
  const baseUrl = deriveQuizCompletionUrl(config);
  if (!baseUrl) return;

  // §H.9 defense-in-depth: mirror the /adapt pattern (adapt.ts:744) — append the
  // opt-out flag so the route gate at route.ts:363 is reachable ONLY if Guard 1
  // regresses — NOT under normal production traffic (Guard 1 returns before
  // postQuizCompletionPing is called for opted-out sessions).
  const completionUrl = profilingOptedOut ? `${baseUrl}?profiling_opt_out=1` : baseUrl;

  const body = JSON.stringify({
    session_id: sessionId,
    resolved_archetype: resolvedArchetype,
    language,
    // FOLLOW-1020: report HOW the archetype was reached. Before this the row carried only the
    // leaf, and the staff viewer rendered every completion as a Q1 skip against columns the
    // SDK never populated — the Branch Split card counted a full Investment→Rental→Steady walk
    // as a skip. Omitted entirely when there is no path, so a missing walk stays distinguishable
    // from a reported one rather than being flattened into a default.
    ...(answerPath !== undefined ? quizPathFields(answerPath) : {}),
  });

  computeHmacSha256Hex(config.apiKey, body)
    .then((signatureHex) => {
      if (signatureHex === null) {
        console.warn('[estalara] quiz completion ping skipped: SubtleCrypto unavailable');
        return;
      }
      return fetch(completionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          'X-Estalara-Signature': signatureHex,
        },
        body,
      });
    })
    .catch((err: unknown) => {
      console.warn(
        '[estalara] quiz completion ping failed:',
        err instanceof Error ? err.message : String(err),
      );
    });
}

/**
 * @deprecated Use TextDirective or ClassDirective from @estalara/shared instead.
 * Kept for backward compatibility with existing consumers.
 */
export interface Directive {
  /** Slot identifier — matches data-estalara-slot on DOM elements. */
  slot: string;
  type: 'text' | 'order' | 'visibility' | 'class';
  value: string | string[];
}

export interface AdaptResponse {
  /**
   * Stable per-decision UUID returned by the canonical `/api/adapt` route
   * (FOLLOW-105 / ADR-0006 §Decision 4C). Mirrors `AdaptationDirectives.adapt_decision_id`.
   */
  adapt_decision_id: string;
  session_id: string;
  archetype: string;
  confidence: number;
  /** Cosine similarity to the matched archetype 0–1. */
  similarity: number;
  /**
   * Page context derived from `page_type` in the POST /api/adapt response (FOLLOW-357).
   * NOT an integration Tier (CEO ruling 2026-06-05, §E.7).
   * 2 = listing_detail (full directive set), 1 = list/search/home pages (lighter set).
   * Optional — absent on legacy GET responses.
   */
  page_context?: 1 | 2;
  /** Raw directives from the Decision API. Cast to (TextDirective | ClassDirective | ReorderDirective)[] for applyDirectives(). */
  directives: (TextDirective | ClassDirective | ReorderDirective)[];
  /** Origin of the response (playbook / llm_* / default / fallback). */
  source: string;
  /** ISO 8601 timestamp of when the server generated this response. */
  generated_at: string;
  /**
   * Thompson sampling variant selected by the server for this session.
   * Echo back in the feedback ping.
   * Optional — absent when the session is in the holdout arm or the server is legacy.
   */
  variant?: string;
  /**
   * @deprecated The live canonical `/api/adapt` route does not return `ttl_seconds`
   * (FOLLOW-105 §D.4). Kept optional for backward compatibility with any legacy
   * caller that still reads it; do not rely on it being present.
   */
  ttl_seconds?: number;
  /**
   * Flattened chat-intent dimension map from the Modal NLP pipeline (FOLLOW-101).
   *
   * Present when the `/api/adapt` route found a shadow Redis key for this
   * `(tenant_id, session_id)` pair. The SDK calls `applyChatIntentPrior` with
   * this map to update the local IntentState for disagreement-rate analysis.
   *
   * Absent (undefined / null) when no shadow data exists for the session.
   */
  chat_intent_dimensions?: Record<string, string> | null;
  /**
   * Resolved slot selector map from detail_schema.slot_selectors (FOLLOW-340).
   *
   * When present, the SDK calls `annotateSlots(slot_selectors)` BEFORE the first
   * `applyDirectives()` so that pages without hand-coded `data-estalara-slot`
   * attributes receive self-annotation. Additive optional — absent when the tenant
   * has no curated slot selectors or when the schema lookup fails on the server.
   */
  slot_selectors?: Record<string, string>;
}

/** Context passed to applyDirectives for event logging and idempotency. */
export interface ApplyContext {
  archetypeId: ArchetypeId;
  confidence: number;
  sessionId: string;
  /**
   * FOLLOW-791 / Rule AB: latest-wins staleness predicate for the MutationObserver-backed
   * directive-resilience mechanism (see `attachResilience` below). Mirrors
   * `applyDescriptionAdaptation`'s `isStale` parameter (FOLLOW-548): consulted at the LAST
   * synchronous instant before every DOM write the mechanism performs, including the
   * rAF-deferred `reapply` write that fires LATER — so a rapid cross-listing navigation
   * that supersedes this adaptation cannot repaint the stale archetype's directive onto the
   * newer listing (and the watchdog disconnects instead of fighting forever).
   *
   * REQUIRED, no never-stale default: FOLLOW-548 LG-2 found that a never-stale default for
   * this exact class of guard is a latent footgun — a future prod call site that omitted it
   * would silently lose cross-listing-navigation protection with no compile-time signal.
   * The sole prod call site (index.ts) passes `() => myRefreshId !== latestRefreshId`;
   * test call sites pass an explicit `() => false` to opt out (matches the
   * adapt-description.test.ts convention).
   */
  isStale: () => boolean;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Fingerprints of directives already applied in this session (idempotency). */
const appliedFingerprints = new Set<string>();

// ---------------------------------------------------------------------------
// FOLLOW-791 — MutationObserver-backed resilience for the generic directive pipeline
// (text / class / reorder). Modeled on adapt-description.ts's
// applyAndObserveSlot / applyAndObserveHeadlineSlot (see that file's module docstring
// for the disconnect → write → reconnect loop-guard rationale).
//
// Interaction with `appliedFingerprints` (kept exactly as-is, per ticket AC2): the
// fingerprint guard still gates whether a REPEAT applyXDirective() call (same
// slot/selector + archetype) re-enters this setup at all — it suppresses redundant
// re-application while the write is still holding. This mechanism is layered ON TOP:
// once armed, the MutationObserver's own `reapply()` closure detects and repairs a
// framework revert completely independently of any future applyXDirective() call — it
// does not go through, and cannot be blocked by, the fingerprint check. The two
// bookkeeping mechanisms answer different questions ("should THIS call redo the work?"
// vs. "does the DOM still hold what we wrote?") and are deliberately not merged.
//
// Separate maps per directive type (not one shared map keyed by element) so that a
// text, class, and reorder directive can independently track the SAME DOM element
// without one type's disconnect() clobbering another's state — mirrors adapt-
// description.ts's own separation of `_slotMap` (description) from `_headlineSlotMap`
// (headline), which exists for the identical reason.
// ---------------------------------------------------------------------------

interface ResilienceState {
  obs: MutationObserver;
  /** flags: bit 1 = reapply write in progress (re-entrancy guard against our own
   *  mutation), bit 2 = rAF pending (dedupes a revert burst to one repair). */
  f: number;
}

const _textResilienceMap = new Map<HTMLElement, ResilienceState>();
const _classResilienceMap = new Map<HTMLElement, ResilienceState>();
const _reorderResilienceMap = new Map<HTMLElement, ResilienceState>();

/**
 * Attach MutationObserver-backed resilience to `el`: write the desired state once, then
 * watch for a framework revert and repair it, converging (never fighting forever).
 *
 * @param map            Per-directive-type state map — see module docstring above for
 *                       why text/class/reorder each get their own.
 * @param el             Element (text/class directives) or container (reorder) to observe.
 * @param observerInit   MutationObserverInit appropriate to what this directive mutates.
 * @param matches        Returns true when the DOM currently reflects the desired state
 *                       (no repair needed) — re-evaluated live, not memoized.
 * @param write          Performs the mutation.
 * @param isStale        FOLLOW-791 / Rule AB latest-wins predicate (ApplyContext.isStale).
 *                       Consulted before the initial write AND inside the rAF-deferred
 *                       `reapply` — a supersession disconnects the watchdog rather than
 *                       repainting stale content, and emits `adapt.skipped` (reason:
 *                       'stale') so the discard is observable, never silent (guardrail K.2).
 * @param slotOrSelector The slot name / CSS selector / container selector being tracked —
 *                       used for both the `adapt.skipped` (stale) and `adapt.reapplied`
 *                       event payloads.
 * @param archetypeId    Archetype ID for the `adapt.reapplied` event payload.
 * @param confidence     Confidence for the `adapt.reapplied` event payload.
 * @returns `true` if the initial write happened, `false` if it was declined as stale
 *   (FOLLOW-793). Callers use this to decide whether the directive actually took effect —
 *   `adapt.applied` and the idempotency fingerprint must both hang off a real write.
 */
function attachResilience(
  map: Map<HTMLElement, ResilienceState>,
  el: HTMLElement,
  observerInit: MutationObserverInit,
  matches: () => boolean,
  write: () => void,
  isStale: () => boolean,
  slotOrSelector: string,
  archetypeId: string,
  confidence: number,
): boolean {
  map.get(el)?.obs.disconnect();

  const emitStaleSkip = (): void => {
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: 'stale', slot_or_selector: slotOrSelector },
      ts: Date.now(),
    });
  };

  if (isStale()) {
    emitStaleSkip();
    // FOLLOW-793 AC2: the entry disconnected above must also LEAVE the map. Without this
    // the map keeps a `ResilienceState` whose observer is dead and whose element is
    // strongly referenced — it falsely asserts the element is watched, and (post-FOLLOW-795)
    // `teardownAdaptObservers` would clear ownership for an element nothing is defending.
    // The deferred `reapply` path below already does this correctly.
    map.delete(el);
    return false;
  }

  const s: ResilienceState = { obs: null as unknown as MutationObserver, f: 0 };

  const reapply = (): void => {
    // FOLLOW-791 / Rule AB: re-consult staleness at the LAST synchronous instant before
    // this deferred write — a rapid cross-listing nav that supersedes us while this
    // repair was pending must not repaint the stale archetype's directive.
    if (isStale()) {
      s.obs.disconnect();
      map.delete(el);
      emitStaleSkip();
      return;
    }
    if (s.f & 1 || matches()) return;
    s.f |= 1;
    s.obs.disconnect();
    write();
    s.obs.observe(el, observerInit);
    void Promise.resolve().then(() => {
      s.f &= ~1;
    });
    pushEvent({
      type: 'adapt.reapplied',
      payload: { slot_or_selector: slotOrSelector, archetype: archetypeId, confidence },
      ts: Date.now(),
    });
  };

  const obs = new MutationObserver(() => {
    if (s.f || matches()) return;
    s.f |= 2;
    requestAnimationFrame(() => {
      s.f &= ~2;
      reapply();
    });
  });
  s.obs = obs;

  write();
  obs.observe(el, observerInit);
  map.set(el, s);
  return true;
}

/**
 * Disconnect and remove the generic pipeline's resilience watchdog for `el`, if one is
 * currently armed (FOLLOW-795 / RETRO-244 §4a LG-5(a)).
 *
 * Called by `adapt-description.ts`'s `applyAndObserveHeadlineSlot` the instant a
 * per-listing headline becomes available, so ownership hands off cleanly BEFORE the
 * description module arms its own observer on the same element — two independent
 * MutationObservers on one headline element must never coexist.
 */
export function evictGenericHeadlineObserver(el: HTMLElement): void {
  const s = _textResilienceMap.get(el);
  if (s) {
    s.obs.disconnect();
    _textResilienceMap.delete(el);
  }
  clearHeadlineOwner(el);
}

/**
 * Disconnect and clear all FOLLOW-791 resilience observers (text / class / reorder).
 * Mirrors `teardownDescriptionObservers()` (adapt-description.ts) — called from
 * `resetAdaptState()` so cross-listing navigation (ADR-0014) and same-page archetype
 * changes never leave a stale observer watching a superseded/removed DOM node.
 *
 * FOLLOW-795: also releases headline-ownership bookkeeping for every element torn down
 * here — a no-op for non-headline elements (they never claim a registry entry), and the
 * matching half of the hand-off for any headline element the generic pipeline currently
 * owns.
 */
export function teardownAdaptObservers(): void {
  for (const [el, s] of _textResilienceMap) {
    s.obs.disconnect();
    clearHeadlineOwner(el);
  }
  _textResilienceMap.clear();
  for (const s of _classResilienceMap.values()) s.obs.disconnect();
  _classResilienceMap.clear();
  for (const s of _reorderResilienceMap.values()) s.obs.disconnect();
  _reorderResilienceMap.clear();
}

/** Reference to the SDK event queue, set via setEventQueueRef(). */
let _eventQueue: CollectedEvent[] | null = null;

/** Tracks whether the outcome event listener has already been registered for the current session. */
let _feedbackListenerRegistered = false;

/**
 * Rule R idempotency guard for chat-intent prior (FOLLOW-101).
 *
 * FOLLOW-252: this in-memory guard is REPLACED by `IntentState.chatPriorApplied`
 * (a persisted flag in the sessionStorage envelope). The in-memory variable is kept
 * only as a secondary fast-path guard for cross-listing navigation within the same
 * tab lifecycle (no reload); the primary, reload-safe guard is `state.chatPriorApplied`.
 *
 * On hard page reload `_chatPriorAppliedSessionId` resets to null, but
 * `IntentState.chatPriorApplied` survives via sessionStorage rehydration — so the
 * double-count-on-reload hole (RETRO-047 LG-1) is closed by the persisted flag.
 *
 * Reset by `resetAdaptState()` which is called only when the session is fully torn
 * down or the archetype changes.
 */
let _chatPriorAppliedSessionId: string | null = null;

/**
 * Wire the SDK event queue into this module so adapt events flow through
 * the standard 5s batch flush. Call this once from src/index.ts.
 */
export function setEventQueueRef(queue: CollectedEvent[]): void {
  _eventQueue = queue;
}

/**
 * Clear idempotency state. Call on new session initialization so directives
 * from a previous session are not considered already-applied.
 */
export function resetAdaptState(): void {
  appliedFingerprints.clear();
  _feedbackListenerRegistered = false;
  _chatPriorAppliedSessionId = null;
  // FOLLOW-791 AC5: disconnect any armed resilience observers too — otherwise a
  // cross-listing navigation (ADR-0014) or a same-page archetype change would leave a
  // stale watchdog referencing a superseded/removed DOM node.
  teardownAdaptObservers();
}

/**
 * Register the outcome event listener for feedback pings.
 *
 * Listens for `config.feedbackEvents` (default: `['inquiry.completed']`) on
 * `document`. When fired for a session that has a cached variant in sessionStorage,
 * POSTs `{ session_id, tenant_id, archetype, variant, converted: true }` to the
 * feedback endpoint. Fire-and-forget — never blocks the outcome event.
 *
 * Guards against double-registration per session with `_feedbackListenerRegistered`.
 *
 * @internal — called from fetchDirectives() after a successful adapt response with a variant.
 */
function registerFeedbackListener(
  config: SdkConfig,
  sessionId: string,
  archetype: string,
  predictionId: string | undefined,
): void {
  if (_feedbackListenerRegistered) return;
  if (typeof document === 'undefined') return;

  _feedbackListenerRegistered = true;

  // CEO Decision D-4 (2026-05-30): live.signup is the PRIMARY pilot conversion event.
  // inquiry.completed retained as secondary fallback for future agency tenants.
  // FOLLOW-195: live.signup schema added to packages/shared/src/schemas/events/live.ts.
  const outcomeEvents = config.feedbackEvents ?? ['live.signup', 'inquiry.completed'];

  const handleOutcome = (event: Event): void => {
    // Only fire if this document event matches one of our outcome event names
    if (!outcomeEvents.includes(event.type)) return;

    const variant = getCachedVariant(sessionId);
    if (!variant) return;

    // FOLLOW-259: read lead_id at outcome time (may be set after listener registration).
    let leadId: string | undefined;
    try {
      leadId = sessionStorage.getItem('__estalara_lead_id__') ?? undefined;
    } catch {
      // sessionStorage unavailable
    }

    postFeedbackPing(
      config,
      sessionId,
      archetype,
      variant,
      /* converted= */ true,
      predictionId,
      leadId,
    );
  };

  for (const eventName of outcomeEvents) {
    document.addEventListener(eventName, handleOutcome);
  }

  // Optional: converted=false on session expiry (dwell ≥30s + page hidden), opt-in only.
  if (config.feedbackConvertedFalse === true) {
    let dwellStart = Date.now();

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        const dwell = Date.now() - dwellStart;
        if (dwell >= 30_000) {
          const variant = getCachedVariant(sessionId);
          if (variant) {
            let leadId: string | undefined;
            try {
              leadId = sessionStorage.getItem('__estalara_lead_id__') ?? undefined;
            } catch {
              // sessionStorage unavailable
            }
            postFeedbackPing(
              config,
              sessionId,
              archetype,
              variant,
              /* converted= */ false,
              predictionId,
              leadId,
            );
          }
        }
      } else {
        // Tab became visible again — reset dwell clock
        dwellStart = Date.now();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Push onto the SDK's collected-event queue (set by `setEventQueueRef` at init).
 *
 * Exported for `annotate-slots.ts` (FOLLOW-801), which must make an ambiguous-selector
 * skip observable but has no queue of its own. Sharing this one keeps annotation skips in
 * the same stream as the `adapt.skipped` events they precede, rather than adding a third
 * queue-ref setter. No-ops before init — a skip emitted with no queue is dropped, not thrown.
 */
export function pushEvent(event: CollectedEvent): void {
  _eventQueue?.push(event);
}

/**
 * Resolve `{token}` placeholders in a directive value string.
 * Maps `{school_rating}` → `data-estalara-school-rating` attribute on the element.
 *
 * FOLLOW-1018: returns `null` when ANY token is unresolved, and the caller then leaves the
 * element ALONE. The previous behaviour — paint the value with unresolved tokens left
 * literal, emitting only an `adapt.skipped` — put raw braces in front of buyers: the live
 * prod playbook fallback serves `"Exceptional Residence — {key_luxury_feature}"`, and a
 * tenant page that carries no `data-estalara-key-luxury-feature` attribute rendered exactly
 * that. Partial resolution is still a failure (one missing token poisons the whole value),
 * so the resolved siblings are discarded with it. The skip event per unresolved token is
 * unchanged, so the diagnostic stream still names which token was missing.
 */
function interpolatePlaceholders(value: string, el: HTMLElement, slotName: string): string | null {
  // Collected rather than flagged: a `let` boolean set only inside the replacer reads as
  // always-false to control-flow analysis, which the lint rule then flags as a dead branch.
  const unresolvedTokens: string[] = [];
  const resolved = value.replace(/\{([a-z][a-z0-9_]*)\}/gi, (match, token: string) => {
    const attr = `data-estalara-${token.toLowerCase().replace(/_/g, '-')}`;
    if (el.hasAttribute(attr)) {
      return el.getAttribute(attr) ?? match;
    }
    unresolvedTokens.push(token);
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: `unresolved_token_${token}`, slot_or_selector: slotName },
      ts: Date.now(),
    });
    return match;
  });
  return unresolvedTokens.length > 0 ? null : resolved;
}

/** Apply a single TextDirective to matching DOM elements. */
function applyTextDirective(directive: TextDirective, context?: ApplyContext): void {
  const slotName = directive.slot;
  const elements = document.querySelectorAll<HTMLElement>(`[data-estalara-slot="${slotName}"]`);

  if (elements.length === 0) {
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: 'no_slot_elements', slot_or_selector: slotName },
      ts: Date.now(),
    });
    return;
  }

  // Defensive: never blank a slot. An empty/whitespace directive value means "no
  // adaptation for this archetype on this listing" (e.g. the decision API's archetype-fit
  // gate, ADR-0010, declines to adapt a listing the archetype does not fit). Applying it
  // would erase the original copy instead of leaving it. Skip — the slot keeps whatever it
  // currently holds; cross-listing navigation separately restores the original (index.ts).
  if (directive.value.trim() === '') {
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: 'empty_value', slot_or_selector: slotName },
      ts: Date.now(),
    });
    return;
  }

  // FOLLOW-793 AC1/AC4 + FOLLOW-802 AC1: the fingerprint is CHECKED here but recorded only
  // after the loop, and only if at least one element was actually written. Recording it up
  // front meant any early return inside the loop (stale-at-arm, or FOLLOW-795's
  // headline-owned hand-off) permanently blocked the later correct write for this
  // (slot, archetype) pair while ALSO emitting a false `adapt.applied`.
  //
  // The guard's purpose — suppressing redundant repeat writes — is unchanged: a call that
  // writes still records the fingerprint, so an identical follow-up call still short-circuits
  // here. What changes is only the failed case, which previously poisoned the guard with a
  // write that never happened. Counting rather than flagging keeps this correct when a
  // directive matches several elements and only some of them are written.
  const fingerprint = `text:${slotName}:${context?.archetypeId ?? 'unknown'}`;
  if (appliedFingerprints.has(fingerprint)) return;
  let written = 0;

  elements.forEach((el) => {
    const resolved = interpolatePlaceholders(directive.value, el, slotName);

    // FOLLOW-1018: an unresolved token means we cannot render this value truthfully on
    // THIS element — leave it holding the tenant's own copy rather than painting braces.
    // Per-element, because token sources are per-element attributes: a directive can be
    // applicable to one matching slot and not another.
    if (resolved === null) return;

    if (!context) {
      // No ApplyContext (legacy / one-shot call site) — no archetypeId/confidence/isStale
      // available to arm resilience with. One-shot write, unchanged behavior.
      el.textContent = resolved;
      written += 1;
      return;
    }

    // FOLLOW-795 (RETRO-244 §4a LG-5(a)): ownership HAND-OFF, not an unconditional
    // exclusion. ADR-0009's per-listing headline pipeline (adapt-description.ts's
    // applyAndObserveHeadlineSlot) is the correct owner of [data-estalara-slot="headline"]
    // once a per-listing LLM headline exists — arming a second, independent observer here
    // would fight it. But that ownership is CONDITIONAL (only once fetchDescription
    // resolves a non-empty per-listing headline), while the OLD exclusion here was
    // unconditional — leaving the MAJORITY case (cold start, generation failure, uncached
    // listing, neutral archetype, opt-out) with NO observer at all, and the playbook
    // headline permanently unrecoverable on any framework revert.
    //
    // Fix: arm the generic watchdog here UNLESS `adapt-description.ts` has already
    // claimed ownership (checked live via the shared `headline-ownership.ts` registry,
    // never memoized — so a hand-off that already happened on an earlier call is
    // respected) — and record 'generic' as the owner so `adapt-description.ts` can evict
    // us cleanly (`evictGenericHeadlineObserver`) the instant a per-listing headline
    // arrives. Skip setting ownership when stale — a superseded call must not claim an
    // element it is about to be denied writing to anyway (attachResilience below
    // re-checks `isStale` itself and will no-op).
    if (slotName === 'headline') {
      if (getHeadlineOwner(el) === 'description') {
        pushEvent({
          type: 'adapt.skipped',
          payload: { reason: 'headline_owned_by_description', slot_or_selector: slotName },
          ts: Date.now(),
        });
        return;
      }
      if (!context.isStale()) {
        setHeadlineOwner(el, 'generic');
      }
    }

    if (
      attachResilience(
        _textResilienceMap,
        el,
        { childList: true, characterData: true, subtree: true },
        () => el.textContent === resolved,
        () => {
          el.textContent = resolved;
        },
        context.isStale,
        slotName,
        context.archetypeId,
        context.confidence,
      )
    ) {
      written += 1;
    }
  });

  if (written === 0) return;
  appliedFingerprints.add(fingerprint);

  if (context) {
    pushEvent({
      type: 'adapt.applied',
      payload: {
        slot_or_selector: slotName,
        archetype: context.archetypeId,
        confidence: context.confidence,
      },
      ts: Date.now(),
    });
  }
}

/** Apply a single ClassDirective to matching DOM elements. */
function applyClassDirective(directive: ClassDirective, context?: ApplyContext): void {
  const selector = directive.selector;

  // Only allow [data-estalara-*] selectors — reject anything else
  if (!/^\[data-estalara-[^\]]+\]/.test(selector)) {
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: 'disallowed_selector', slot_or_selector: selector },
      ts: Date.now(),
    });
    return;
  }

  // FOLLOW-793 AC1: record the fingerprint only after a real write — see the note in
  // `applyTextDirective`. The stale-at-arm early return reaches all three appliers.
  const fingerprint = `class:${selector}:${context?.archetypeId ?? 'unknown'}`;
  if (appliedFingerprints.has(fingerprint)) return;
  let written = 0;

  const elements = document.querySelectorAll<HTMLElement>(selector);
  const applyClasses = (el: HTMLElement): void => {
    // remove first, then add — add wins if same class is in both
    if (directive.remove.length > 0) el.classList.remove(...directive.remove);
    if (directive.add.length > 0) el.classList.add(...directive.add);
  };

  elements.forEach((el) => {
    if (!context) {
      applyClasses(el);
      written += 1;
      return;
    }
    // FOLLOW-791: desired end state is "every `add` class present AND every `remove`
    // class absent" — a framework revert could either strip a class we added or
    // re-add a class we removed, and either counts as a mismatch to repair.
    const ok = attachResilience(
      _classResilienceMap,
      el,
      { attributes: true, attributeFilter: ['class'] },
      () =>
        directive.add.every((c) => el.classList.contains(c)) &&
        directive.remove.every((c) => !el.classList.contains(c)),
      () => {
        applyClasses(el);
      },
      context.isStale,
      selector,
      context.archetypeId,
      context.confidence,
    );
    if (ok) written += 1;
  });

  if (written === 0) return;
  appliedFingerprints.add(fingerprint);

  if (context) {
    pushEvent({
      type: 'adapt.applied',
      payload: {
        slot_or_selector: selector,
        archetype: context.archetypeId,
        confidence: context.confidence,
      },
      ts: Date.now(),
    });
  }
}

/**
 * Apply a single ReorderDirective — reorders child card elements within a container
 * by archetype affinity score (highest first). Optionally pins the top N cards.
 *
 * Fail-safe: missing container or empty card list emits adapt.skipped and returns.
 * Idempotent: same container+archetype fingerprint is skipped on repeat calls.
 */
function applyReorderDirective(directive: ReorderDirective, context?: ApplyContext): void {
  const container = document.querySelector<HTMLElement>(directive.container_selector);
  if (!container) {
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: 'no_container', slot_or_selector: directive.container_selector },
      ts: Date.now(),
    });
    return;
  }

  const cards = Array.from(container.querySelectorAll<HTMLElement>(directive.item_selector));
  if (cards.length === 0) {
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: 'no_cards', slot_or_selector: directive.item_selector },
      ts: Date.now(),
    });
    return;
  }

  // Idempotency: same container+archetype is skipped on repeat calls.
  // FOLLOW-793 AC1: recorded only after a real write — see `applyTextDirective`.
  const fingerprint = `reorder:${directive.container_selector}:${directive.archetype}`;
  if (appliedFingerprints.has(fingerprint)) return;
  let written = 0;

  const scoreMap = new Map(directive.scores.map((s) => [s.listing_id, s.score]));

  // Sort by score, descending; cards with no listing-id match go to end (-Infinity).
  // Extracted as a helper (rather than a one-off closure) because FOLLOW-792 requires
  // this sort to run again, against freshly-queried live nodes, on every repair — see
  // `applyOrder` below.
  const sortByScore = (list: HTMLElement[]): HTMLElement[] =>
    [...list].sort((a, b) => {
      const idA = a.getAttribute('data-estalara-listing-id');
      const idB = b.getAttribute('data-estalara-listing-id');
      const scoreA = idA !== null ? (scoreMap.get(idA) ?? -Infinity) : -Infinity;
      const scoreB = idB !== null ? (scoreMap.get(idB) ?? -Infinity) : -Infinity;
      return scoreB - scoreA;
    });

  // FOLLOW-803: the first-apply snapshot (`const sorted = sortByScore(cards)`) is gone —
  // its only consumer was the frozen `desiredOrder` the new set-independent predicate
  // replaces. `cards` is still used above for the empty-container check.

  // FOLLOW-792: `applyOrder` must NOT close over `sorted`/`cards` — those are the specific
  // DOM node objects captured at first-apply time, and that's fine for a framework
  // re-render that merely re-ORDERS the same nodes in place, but wrong for one that
  // RE-MOUNTS them (React key change, Svelte `{#each}` re-key, any destroy+recreate
  // re-render): the captured references become detached orphans, and re-attaching them via
  // `container.prepend/append` puts them back in the DOM ALONGSIDE the framework's fresh
  // replacement cards — duplicate listing cards, and because the duplicate count then
  // permanently fails the length check below, every later mutation repeats the bug and
  // appends yet another orphan (RETRO-244 §4a LG-1).
  //
  // Fix: re-query `container` for whatever `item_selector` nodes are LIVE right now, and
  // sort THOSE by score (keyed by `data-estalara-listing-id`, i.e. data identity, never
  // node identity). This is correct for a re-order (same nodes, re-sorted) and a re-mount
  // (fresh nodes, same ids, re-sorted) alike, and it can never re-attach a node that is not
  // currently a descendant of `container` — `container.append`/`prepend` only ever move
  // nodes this exact query just found live.
  //
  // FOLLOW-792 / explicit choice for AC2: when the live id set differs from the set
  // captured in `directive.scores` (a card was removed, or a new one appeared that we
  // never scored), we converge on the intersection rather than disconnecting the watchdog
  // and emitting `adapt.skipped`: an id that vanished from the live DOM has nothing to
  // reinsert (it's simply absent from the re-sorted output), and a live id with no score
  // falls to the end via the same -Infinity fallback the initial sort already uses for
  // score-less cards. Both are ordinary host re-render outcomes, not a decision or
  // telemetry failure — the existing `adapt.reapplied` event (emitted by `attachResilience`
  // on every completed repair) is the observable signal, so no additional event is needed.
  const applyOrder = (): void => {
    const liveSorted = sortByScore(
      Array.from(container.querySelectorAll<HTMLElement>(directive.item_selector)),
    );
    if (directive.pin_top_n !== undefined && directive.pin_top_n > 0) {
      const topCards = liveSorted.slice(0, directive.pin_top_n);
      const restCards = liveSorted.slice(directive.pin_top_n);
      container.prepend(...topCards);
      container.append(...restCards);
    } else {
      container.append(...liveSorted);
    }
  };

  if (!context) {
    applyOrder();
    written += 1;
  } else {
    // FOLLOW-803: the predicate is SET-INDEPENDENT — "is the live set currently in score
    // order?", not "does the live set equal the sequence captured at first apply?".
    //
    // The previous version closed over `desiredOrder`, the id sequence frozen from the nodes
    // present at first apply, and short-circuited on `current.length !== desiredOrder.length`.
    // FOLLOW-792 made the WRITE converge on the intersection, but left this check comparing
    // against the frozen sequence — so any host change to the card COUNT (a filter, a
    // "load more", a sold listing removed, infinite scroll: all ordinary on a listing grid)
    // made `matches()` PERMANENTLY false. The write being idempotent meant nothing
    // duplicated, but every later mutation inside the container re-entered `reapply`,
    // re-appended the same nodes in the same order and emitted another `adapt.reapplied`,
    // without bound — an event producer that never terminates (no sampling policy fixes
    // that), plus a detach/re-insert of every card on each host mutation, which resets
    // scroll anchoring, drops focus and cancels in-flight CSS transitions.
    //
    // Comparing the live list against `sortByScore(live)` is true exactly when the order is
    // already correct, for ANY live set. `pin_top_n` needs no special case: both branches of
    // `applyOrder` leave the ITEMS in `sortByScore` order (the pinned branch differs only in
    // where non-item children end up), and this predicate only ever inspects `item_selector`
    // nodes.
    const ok = attachResilience(
      _reorderResilienceMap,
      container,
      { childList: true },
      () => {
        const current = Array.from(
          container.querySelectorAll<HTMLElement>(directive.item_selector),
        );
        const desired = sortByScore(current);
        return current.every((c, i) => c === desired[i]);
      },
      applyOrder,
      context.isStale,
      directive.container_selector,
      context.archetypeId,
      context.confidence,
    );
    if (ok) written += 1;
  }

  if (written === 0) return;
  appliedFingerprints.add(fingerprint);

  if (context) {
    pushEvent({
      type: 'adapt.applied',
      payload: {
        slot_or_selector: directive.container_selector,
        archetype: context.archetypeId,
        confidence: context.confidence,
      },
      ts: Date.now(),
    });
  }
}

/** Inner directive processing — called when DOM is guaranteed ready. */
function runApply(
  directives: (TextDirective | ClassDirective | ReorderDirective)[],
  context?: ApplyContext,
): void {
  try {
    for (const directive of directives) {
      try {
        if (directive.type === 'text') {
          applyTextDirective(directive, context);
        } else if (directive.type === 'reorder') {
          applyReorderDirective(directive, context);
        } else {
          // directive.type === 'class'
          applyClassDirective(directive, context);
        }
      } catch {
        // Per-directive errors are silenced — continue processing remaining directives
      }
    }
  } catch {
    // Never propagate
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Result envelope returned by `fetchDirectives` (FOLLOW-101).
 *
 * `adaptResponse` is the standard adapt API response (null on network failure).
 * `updatedIntentState` is set when `chat_intent_dimensions` in the response
 * triggered an `applyChatIntentPrior` call — callers should replace their local
 * `currentIntentState` with this value and persist it to sessionStorage.
 */
export interface FetchDirectivesResult {
  adaptResponse: AdaptResponse | null;
  updatedIntentState?: IntentState;
}

/**
 * Fetch adaptation directives from the Decision API.
 * Returns null if Decision API is unavailable, config.decisionApiUrl is not set,
 * or config.tenantId is not set (tenant_id is required by the Decision API).
 *
 * @param intentState - Current Bayesian intent state; threads archetype_hint, confidence,
 *   and similarity (raw archetype probability) into the request body so the Decision API
 *   can skip its own classification and serve directives immediately.
 */
export async function fetchDirectives(
  config: SdkConfig,
  session: SessionState,
  pageType: 'listing_list' | 'listing_detail' | 'home' | 'search',
  intentState?: IntentState,
  listingId?: string,
  profilingOptedOut?: boolean,
): Promise<FetchDirectivesResult> {
  if (!config.decisionApiUrl) return { adaptResponse: null };
  if (!config.tenantId) return { adaptResponse: null };

  try {
    // FOLLOW-197: include derived pseudonymous lead_id when available (registered user path).
    // The raw user_uuid is never stored — only the SHA-256-derived 16-char hex token.
    let leadId = '';
    try {
      leadId = sessionStorage.getItem('__estalara_lead_id__') ?? '';
    } catch {
      // sessionStorage unavailable — leave leadId as empty string
    }

    const body: Record<string, unknown> = {
      tenant_id: config.tenantId,
      session_id: session.sessionId,
      page_type: pageType,
      locale: config.language,
      lead_id: leadId,
    };
    if (intentState !== undefined) {
      body.archetype_hint = intentState.archetype;
      body.confidence = intentState.confidence;
      body.similarity = intentState.probabilities[intentState.archetype];
    }

    // F-13 (FOLLOW-194): include single-listing context on detail pages.
    // When listingId is provided (caller detected data-estalara-listing-id on the page),
    // set body.listing_id so the Decision API can activate per-listing RAG context.
    if (listingId !== undefined) {
      body.listing_id = listingId;
    }

    // Collect visible listing IDs for ReorderDirective scoring (max 50)
    const listingIds: string[] = [];
    if (typeof document !== 'undefined') {
      document.querySelectorAll<HTMLElement>('[data-estalara-listing-id]').forEach((el) => {
        const id = el.getAttribute('data-estalara-listing-id');
        if (id && listingIds.length < 50) listingIds.push(id);
      });
    }
    if (listingIds.length > 0) body.listing_ids = listingIds;

    // Map SDK consent state to the Decision API enum ('granted' | 'denied' | 'unknown').
    // 'pending' has no equivalent — the SDK gate in index.ts halts before calling
    // fetchDirectives when consent is pending, so this branch is unreachable in practice.
    // Sending 'unknown' for 'pending' is the safe conservative default.
    const sdkConsent = getConsentState();
    body.consent_state = sdkConsent === 'pending' ? 'unknown' : sdkConsent;

    // FOLLOW-383 / §H.9: append profiling_opt_out=1 as a URL query param so the
    // server-side GET handler gate (req.nextUrl.searchParams) fires and returns
    // neutral directives without logging any variant row.
    // This is the correct approach because Next.js reads searchParams from the URL,
    // not the POST body — appending to the URL works regardless of HTTP method.
    const adaptPath = profilingOptedOut ? '/adapt?profiling_opt_out=1' : '/adapt';
    const res = await fetch(buildEndpoint(config.decisionApiUrl, adaptPath), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return { adaptResponse: null };

    const data: unknown = await res.json();

    // FOLLOW-105 §F.5 / ADR-0006 §Decision 5A: validate the response against the
    // canonical AdaptationDirectives shape instead of an unchecked cast. On parse
    // failure (missing required field, type mismatch, out-of-enum archetype, …),
    // report to Sentry when available and return null gracefully — never throw.
    let response: AdaptResponse;
    try {
      // `.passthrough()` keeps unknown server fields; `.parse()` throws on a
      // structural mismatch. The validated shape is a superset of AdaptResponse.
      response = adaptResponseSchema.parse(data) as unknown as AdaptResponse;
    } catch (err) {
      const gSentry = (globalThis as { Sentry?: { captureException?: (e: unknown) => void } })
        .Sentry;
      gSentry?.captureException?.(err);
      return { adaptResponse: null };
    }

    // FOLLOW-042: cache variant in sessionStorage for the feedback ping
    if (response.variant) {
      cacheVariant(session.sessionId, response.variant);
      // FOLLOW-041: register outcome event listener to fire the feedback ping.
      // FOLLOW-259: pass adapt_decision_id so conversion_labels table gets populated.
      registerFeedbackListener(
        config,
        session.sessionId,
        response.archetype,
        response.adapt_decision_id,
      );
    }

    // ── FOLLOW-101 / FOLLOW-252: chat-intent Bayesian prior bridge ────────────
    //
    // When the control-plane found a shadow chat-intent key for this session,
    // `chat_intent_dimensions` is a non-empty Record<string,string>. Apply
    // `applyChatIntentPrior` ONCE per session (Rule R idempotency gate): skip
    // if we already applied for this session ID so cross-listing navigation cannot
    // double-count the prior on a rehydrated state.
    //
    // Rule R: chat-prior idempotency persisted across reload (FOLLOW-252).
    //
    // DOUBLE GUARD to satisfy both in-tab navigation and hard-reload scenarios:
    //
    //   1. `intentState.chatPriorApplied === true` — PRIMARY guard, persisted in
    //      the sessionStorage IntentState envelope. Survives a hard page reload
    //      within the 24h Redis shadow-key window (RETRO-047 LG-1 fix). This is
    //      the guard that closes the reload-reapply hole.
    //
    //   2. `_chatPriorAppliedSessionId !== session.sessionId` — SECONDARY guard,
    //      in-memory fast-path for cross-listing navigation within the same tab
    //      lifecycle (no reload). Redundant but cheap; kept for defence-in-depth.
    //
    // FOLLOW-635 (CEO ruling, option A, 2026-07-24): this update DOES change
    // which directives are served, just not on this call. `applyChatIntentPrior`
    // updates `intentState.archetype`, which is persisted and sent as
    // `body.archetype_hint` on the NEXT adapt() call (see `archetype_hint`
    // usage below) — the control-plane uses that hint to pick `archetypeId`,
    // which drives the decision tree and reorder directive. So chat intent is
    // live-influencing across calls via this client loop, not "purely
    // behavioural." The IntentState update also still feeds disagreement-rate
    // analysis and quiz.mismatch detection (unchanged).
    const dims = response.chat_intent_dimensions;
    if (
      dims !== null &&
      dims !== undefined &&
      Object.keys(dims).length > 0 &&
      intentState !== undefined &&
      // Rule R: chat-prior idempotency persisted across reload (FOLLOW-252).
      // Primary guard: skip if the persisted IntentState already has chatPriorApplied=true.
      // This prevents re-folding on every reload within the 24h shadow-key window.
      intentState.chatPriorApplied !== true &&
      // Secondary in-memory guard: skip within the same tab lifecycle (no reload needed).
      _chatPriorAppliedSessionId !== session.sessionId
    ) {
      _chatPriorAppliedSessionId = session.sessionId;

      const updatedIntentState = applyChatIntentPrior(intentState, dims);

      // Mark the prior as applied in the IntentState envelope (Rule R / FOLLOW-252).
      // This flag is persisted to sessionStorage so it survives a hard page reload —
      // the primary idempotency mechanism across the rehydrate boundary.
      const markedIntentState = { ...updatedIntentState, chatPriorApplied: true as const };

      // Persist the updated state to sessionStorage so subsequent listing pages
      // in this tab can rehydrate immediately (FOLLOW-176 pattern).
      try {
        persistIntentState(session.sessionId, markedIntentState);
      } catch {
        // sessionStorage unavailable — state is still updated in-memory for this page
      }

      // If applyChatIntentPrior detected a quiz-vs-chat mismatch, dispatch the
      // quiz.mismatch ingest event so the disagreement-rate pipeline can record it.
      if (markedIntentState.chat_mismatch) {
        pushEvent({
          type: 'quiz.mismatch',
          payload: {
            quiz_archetype: markedIntentState.chat_mismatch.quiz_archetype,
            // schema field is behavioral_archetype; semantically equivalent here —
            // the "other" archetype determined from a non-behavioral source (chat NLP).
            behavioral_archetype: markedIntentState.chat_mismatch.chat_archetype,
            // confidence_gap and signal_count are unavailable in this context;
            // use safe defaults so the ingest schema validates correctly.
            confidence_gap: 0,
            signal_count: intentState.signal_count,
          },
          ts: Date.now(),
        });
      }

      return { adaptResponse: response, updatedIntentState: markedIntentState };
    }

    return { adaptResponse: response };
  } catch {
    return { adaptResponse: null };
  }
}

/**
 * Apply adaptation directives to the page DOM.
 *
 * Accepts the shared TextDirective | ClassDirective | ReorderDirective union from @estalara/shared.
 * Never throws — designed to be resilient on third-party host pages.
 *
 * Features:
 * - TextDirective: replaces textContent with optional {token} placeholder interpolation
 * - ClassDirective: adds/removes CSS classes; selector must match [data-estalara-*]
 * - ReorderDirective: reorders listing card elements by archetype affinity score
 * - Idempotency: same directive fingerprint is skipped on repeat calls
 * - DOM-ready guard: if DOM is still loading, defers application to DOMContentLoaded
 * - Event logging: emits adapt.applied / adapt.skipped into the SDK event queue
 *
 * @param directives - Array of TextDirective, ClassDirective, or ReorderDirective from @estalara/shared
 * @param context    - Optional session context for event attribution
 */
export function applyDirectives(
  directives: (TextDirective | ClassDirective | ReorderDirective)[],
  context?: ApplyContext,
): void {
  if (typeof document === 'undefined') return;

  if (document.readyState === 'loading') {
    // Queue and apply once DOM is ready; { once: true } prevents listener accumulation
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        runApply(directives, context);
      },
      { once: true },
    );
    return;
  }

  runApply(directives, context);
}
