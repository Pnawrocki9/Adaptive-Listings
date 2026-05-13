/**
 * Adaptation client — fetches personalization directives from Decision API.
 *
 * Called once per session init, results cached for ttl_seconds.
 * Never throws — returns null on any error.
 *
 * @module @estalara/sdk/core/adapt
 */

import type { SessionState } from './session.js';
import type { SdkConfig } from './config.js';
import type { TextDirective, ClassDirective, ArchetypeId } from '@estalara/shared';
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
  /** Raw directives from the Decision API. Cast to (TextDirective | ClassDirective)[] for applyDirectives(). */
  directives: (TextDirective | ClassDirective)[];
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

/** Inner directive processing — called when DOM is guaranteed ready. */
function runApply(directives: (TextDirective | ClassDirective)[], context?: ApplyContext): void {
  try {
    for (const directive of directives) {
      try {
        if (directive.type === 'text') {
          applyTextDirective(directive, context);
        } else {
          // directive.type === 'class'
          // 'order' and 'visibility' are Tier 2 (Sprint 8) — ClassDirective handled here
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
 * Accepts the shared TextDirective | ClassDirective union from @estalara/shared.
 * Never throws — designed to be resilient on third-party host pages.
 *
 * Features:
 * - TextDirective: replaces textContent with optional {token} placeholder interpolation
 * - ClassDirective: adds/removes CSS classes; selector must match [data-estalara-*]
 * - Idempotency: same directive fingerprint is skipped on repeat calls
 * - DOM-ready guard: if DOM is still loading, defers application to DOMContentLoaded
 * - Event logging: emits adapt.applied / adapt.skipped into the SDK event queue
 *
 * @param directives - Array of TextDirective or ClassDirective from @estalara/shared
 * @param context    - Optional session context for event attribution
 */
export function applyDirectives(
  directives: (TextDirective | ClassDirective)[],
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
