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
  session_id: string;
  archetype: string;
  confidence: number;
  /** Raw directives from the Decision API. Cast to (TextDirective | ClassDirective | ReorderDirective)[] for applyDirectives(). */
  directives: (TextDirective | ClassDirective | ReorderDirective)[];
  ttl_seconds: number;
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
): Promise<AdaptResponse | null> {
  if (!config.decisionApiUrl) return null;
  if (!config.tenantId) return null;

  try {
    const body: Record<string, unknown> = {
      tenant_id: config.tenantId,
      session_id: session.sessionId,
      page_type: pageType,
    };
    if (intentState !== undefined) {
      body.archetype_hint = intentState.archetype;
      body.confidence = intentState.confidence;
      body.similarity = intentState.probabilities[intentState.archetype];
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
    return data as AdaptResponse;
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
