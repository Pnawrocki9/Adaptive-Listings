/**
 * Adaptation client — fetches personalization directives from Decision API.
 *
 * Called once per session init, results cached for ttl_seconds.
 * Never throws — returns null on any error.
 *
 * @module @estalara/sdk/core/adapt
 */

import type { SessionState } from './session.js';
import { getConsentState } from './session.js';
import type { SdkConfig } from './config.js';
import type {
  TextDirective,
  ClassDirective,
  ReorderDirective,
  ArchetypeId,
} from '@estalara/shared';
import type { CollectedEvent } from './events.js';
import type { IntentState } from './intent.js';
import { adaptResponseSchema } from './adapt-schema.js';

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
 * Replaces the `/adapt` path suffix with `/adapt/feedback`.
 * Falls back to config.feedbackUrl if present.
 */
function deriveFeedbackUrl(config: SdkConfig): string | null {
  if (config.feedbackUrl) return config.feedbackUrl;
  if (!config.decisionApiUrl) return null;
  // decisionApiUrl = "https://example.com" and fetch goes to decisionApiUrl + "/adapt"
  // feedback endpoint lives at decisionApiUrl + "/api/adapt/feedback"
  return `${config.decisionApiUrl}/api/adapt/feedback`;
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
 * Post a conversion signal to the feedback endpoint. Fire-and-forget — never awaited,
 * never throws. Network errors are logged to console.warn only.
 *
 * Auth scheme (FOLLOW-051): the request body is HMAC-SHA256-signed with the
 * tenant's public API key as the secret. The hex digest is sent in the
 * `X-Estalara-Signature` header. When SubtleCrypto is unavailable (rare legacy
 * environments), the ping is skipped to avoid sending an unsigned request that
 * the server would reject.
 */
function postFeedbackPing(
  config: SdkConfig,
  sessionId: string,
  archetype: string,
  variant: string,
  converted: boolean,
): void {
  const feedbackUrl = deriveFeedbackUrl(config);
  if (!feedbackUrl || !config.tenantId) return;

  const body = JSON.stringify({
    session_id: sessionId,
    tenant_id: config.tenantId,
    archetype,
    variant,
    converted,
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
      });
    })
    .catch((err: unknown) => {
      console.warn(
        '[estalara] feedback ping failed:',
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
  /** Integration tier echoed by the server. */
  tier: 1 | 2 | 3;
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
}

/** Context passed to applyDirectives for event logging and idempotency. */
export interface ApplyContext {
  archetypeId: ArchetypeId;
  confidence: number;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Fingerprints of directives already applied in this session (idempotency). */
const appliedFingerprints = new Set<string>();

/** Reference to the SDK event queue, set via setEventQueueRef(). */
let _eventQueue: CollectedEvent[] | null = null;

/** Tracks whether the outcome event listener has already been registered for the current session. */
let _feedbackListenerRegistered = false;

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
function registerFeedbackListener(config: SdkConfig, sessionId: string, archetype: string): void {
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

    postFeedbackPing(config, sessionId, archetype, variant, /* converted= */ true);
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
            postFeedbackPing(config, sessionId, archetype, variant, /* converted= */ false);
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

function pushEvent(event: CollectedEvent): void {
  _eventQueue?.push(event);
}

/**
 * Resolve `{token}` placeholders in a directive value string.
 * Maps `{school_rating}` → `data-estalara-school-rating` attribute on the element.
 * Unresolved tokens are left literal and a skip event is emitted.
 */
function interpolatePlaceholders(value: string, el: HTMLElement, slotName: string): string {
  return value.replace(/\{([a-z][a-z0-9_]*)\}/gi, (match, token: string) => {
    const attr = `data-estalara-${token.toLowerCase().replace(/_/g, '-')}`;
    if (el.hasAttribute(attr)) {
      return el.getAttribute(attr) ?? match;
    }
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: `unresolved_token_${token}`, slot_or_selector: slotName },
      ts: Date.now(),
    });
    return match; // leave literal
  });
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

  const fingerprint = `text:${slotName}:${context?.archetypeId ?? 'unknown'}`;
  if (appliedFingerprints.has(fingerprint)) return;
  appliedFingerprints.add(fingerprint);

  elements.forEach((el) => {
    const resolved = interpolatePlaceholders(directive.value, el, slotName);
    el.textContent = resolved;
  });

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

  const fingerprint = `class:${selector}:${context?.archetypeId ?? 'unknown'}`;
  if (appliedFingerprints.has(fingerprint)) return;
  appliedFingerprints.add(fingerprint);

  const elements = document.querySelectorAll<HTMLElement>(selector);
  elements.forEach((el) => {
    // remove first, then add — add wins if same class is in both
    if (directive.remove.length > 0) el.classList.remove(...directive.remove);
    if (directive.add.length > 0) el.classList.add(...directive.add);
  });

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

  // Idempotency: same container+archetype is skipped on repeat calls
  const fingerprint = `reorder:${directive.container_selector}:${directive.archetype}`;
  if (appliedFingerprints.has(fingerprint)) return;
  appliedFingerprints.add(fingerprint);

  const scoreMap = new Map(directive.scores.map((s) => [s.listing_id, s.score]));

  // Sort cards descending by score; cards with no listing-id match go to end (-Infinity)
  const sorted = [...cards].sort((a, b) => {
    const idA = a.getAttribute('data-estalara-listing-id');
    const idB = b.getAttribute('data-estalara-listing-id');
    const scoreA = idA !== null ? (scoreMap.get(idA) ?? -Infinity) : -Infinity;
    const scoreB = idB !== null ? (scoreMap.get(idB) ?? -Infinity) : -Infinity;
    return scoreB - scoreA;
  });

  if (directive.pin_top_n !== undefined && directive.pin_top_n > 0) {
    const topCards = sorted.slice(0, directive.pin_top_n);
    const restCards = sorted.slice(directive.pin_top_n);
    container.prepend(...topCards);
    container.append(...restCards);
  } else {
    container.append(...sorted);
  }

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
): Promise<AdaptResponse | null> {
  if (!config.decisionApiUrl) return null;
  if (!config.tenantId) return null;

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

    const res = await fetch(`${config.decisionApiUrl}/adapt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return null;

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
      return null;
    }

    // FOLLOW-042: cache variant in sessionStorage for the feedback ping
    if (response.variant) {
      cacheVariant(session.sessionId, response.variant);
      // FOLLOW-041: register outcome event listener to fire the feedback ping
      registerFeedbackListener(config, session.sessionId, response.archetype);
    }

    return response;
  } catch {
    return null;
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
