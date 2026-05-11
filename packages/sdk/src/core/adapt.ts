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
  directives: Directive[];
  ttl_seconds: number;
}

/**
 * Fetch adaptation directives from the Decision API.
 * Returns null if Decision API is unavailable or config.decisionApiUrl is not set.
 */
export async function fetchDirectives(
  config: SdkConfig,
  session: SessionState,
  pageType: 'listing_list' | 'listing_detail' | 'home' | 'search',
  archetypeHint?: string,
): Promise<AdaptResponse | null> {
  if (!config.decisionApiUrl) return null;

  try {
    const body: Record<string, unknown> = {
      session_id: session.sessionId,
      page_type: pageType,
      api_key: config.apiKey,
    };
    if (archetypeHint !== undefined) {
      body.archetype_hint = archetypeHint;
    }

    const res = await fetch(`${config.decisionApiUrl}/adapt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
 * Apply text directives to the page DOM.
 * Finds elements with data-estalara-slot="<slot>" and updates their textContent.
 * Handles text and class directive types. Never throws.
 */
export function applyDirectives(directives: Directive[]): void {
  if (typeof document === 'undefined') return;

  try {
    for (const directive of directives) {
      try {
        const elements = document.querySelectorAll<HTMLElement>(
          `[data-estalara-slot="${directive.slot}"]`,
        );
        if (elements.length === 0) continue;

        if (directive.type === 'text' && typeof directive.value === 'string') {
          elements.forEach((el) => {
            el.textContent = directive.value as string;
          });
        } else if (directive.type === 'class') {
          const classes = Array.isArray(directive.value) ? directive.value : [directive.value];
          elements.forEach((el) => {
            el.classList.add(...classes);
          });
        }
        // 'order' and 'visibility' handled in Tier 2 Augment (Sprint 7)
      } catch {
        // Per-directive errors are silenced — continue processing remaining directives
      }
    }
  } catch {
    // Never propagate
  }
}
