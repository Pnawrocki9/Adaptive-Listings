/**
 * Adaptation directive types shared across Decision API and SDK.
 *
 * `ArchetypeId` is intentionally declared inline here (not imported from `@estalara/sdk`)
 * to prevent a circular workspace dependency. Keep in sync with the `Archetype` union in
 * `packages/sdk/src/core/intent.ts` whenever new archetypes are added.
 *
 * @module @estalara/shared/directives
 */

/**
 * Canonical archetype identifiers — mirrors `Archetype` in `@estalara/sdk/core/intent`.
 *
 * Declared inline to avoid a circular workspace dependency (shared → sdk).
 * Keep in sync with `packages/sdk/src/core/intent.ts` whenever archetypes change.
 */
export type ArchetypeId =
  // Investors
  | 'yield_hunter'
  | 'vacation_rental_investor'
  | 'flip_investor'
  | 'portfolio_builder'
  | 'golden_visa_buyer'
  | 'commercial_investor'
  // Own use
  | 'family_buyer'
  | 'first_time_buyer'
  | 'upsizer'
  | 'downsizer'
  | 'luxury_buyer'
  | 'remote_worker'
  // Special / cross-border
  | 'lifestyle_expat'
  | 'retiree_relocator'
  | 'diaspora_buyer'
  | 'second_home_buyer'
  | 'student_parent'
  // Fallback
  | 'neutral';

/**
 * Tier 1 text slot directive — rewrites the text content of a slot element.
 *
 * Matches elements via `[data-estalara-slot="<slot>"]`.
 */
export interface TextDirective {
  type: 'text';
  /** Matches `[data-estalara-slot="<slot>"]` on the host page. */
  slot: string;
  /** Replacement text value. */
  value: string;
  archetype: ArchetypeId;
  /** Confidence score 0–1 from the intent engine. */
  confidence: number;
}

/**
 * Tier 1 class directive — adds/removes CSS classes on a matched element.
 *
 * Matches elements via `selector` (e.g. `[data-estalara-listing-id="123"]`).
 */
export interface ClassDirective {
  type: 'class';
  /** CSS selector identifying the target element. */
  selector: string;
  /** CSS classes to add. */
  add: string[];
  /** CSS classes to remove. */
  remove: string[];
  archetype: ArchetypeId;
  /** Confidence score 0–1 from the intent engine. */
  confidence: number;
}

/**
 * Full adaptation directive response returned by `GET /api/adapt`.
 *
 * The SDK reads this and applies each directive to the host page DOM.
 */
export interface AdaptationDirectives {
  session_id: string;
  archetype: ArchetypeId | 'neutral';
  /** Intent confidence 0–1. */
  confidence: number;
  /** Cosine similarity to matched archetype 0–1. */
  similarity: number;
  /** Integration tier the caller declared. */
  tier: 1 | 2 | 3;
  /** Empty when source is 'default' or 'llm_full'. */
  directives: (TextDirective | ClassDirective)[];
  /**
   * - `playbook`    — static pre-computed playbook, high-confidence match
   * - `llm_tweaked` — playbook base + pending LLM refinement (ADP-002)
   * - `llm_full`    — full LLM decision pending (ADP-002)
   * - `default`     — confidence too low, no adaptation
   */
  source: 'playbook' | 'llm_tweaked' | 'llm_full' | 'default';
  /** ISO 8601 timestamp of when this response was generated. */
  generated_at: string;
}
