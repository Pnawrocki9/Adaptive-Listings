/**
 * Playbook types — data shapes for the 18-archetype adaptation registry.
 *
 * Used by the PlaybookRegistry (`index.ts`) and consumed by the Decision API
 * (`apps/control-plane/src/app/api/adapt/route.ts`).
 *
 * @module @estalara/sdk/core/playbooks/types
 */

import type { Archetype } from '../intent.js';

/**
 * A single DOM slot directive.
 * `en` is the canonical English value; `pl` and `es` are optional locale overrides.
 * The `{variable}` placeholder syntax is resolved at render time by the SDK.
 */
export interface SlotDirective {
  /** Slot identifier matching `[data-estalara-slot="<slot>"]` on the host page. */
  slot: string;
  /** English text to inject. May contain `{variable}` placeholders. */
  en: string;
  /** Polish locale override. */
  pl?: string;
  /** Spanish locale override. */
  es?: string;
  /**
   * A/B copy variants for this slot. Index 0 mirrors `en` (default).
   * The multi-armed bandit (E.3) selects among indices per (tenant, archetype).
   * Minimum 3 variants required on headline slots for non-neutral archetypes.
   */
  variants?: {
    en: string[];
    pl?: string[];
    es?: string[];
  };
}

/**
 * CSS class boost/suppress rule applied to listing cards.
 *
 * `boost_if` / `suppress_if` are listing feature flags checked against the listing object.
 * When any flag in `boost_if` is truthy the `boost_class` is added to the listing card element.
 * When any flag in `suppress_if` is truthy the `suppress_class` is added.
 */
export interface ListingClassRule {
  /** Listing feature flags that trigger the boost class. */
  boost_if: string[];
  /** Listing feature flags that trigger the suppress class. */
  suppress_if: string[];
  /** CSS class to add when a boost flag is present. */
  boost_class: string;
  /** CSS class to add when a suppress flag is present. */
  suppress_class: string;
}

/**
 * Full playbook entry for a single archetype.
 *
 * `slots` and `feature_priority` drive the Decision API response.
 * `listing_rules` drive client-side Tier 2 DOM mutations.
 * `signals` document which behavioral signals most strongly indicate this archetype
 * (informational — not used at runtime).
 */
export interface PlaybookEntry {
  /** Archetype this playbook targets. */
  archetype: Archetype;
  /** Ordered list of DOM slot directives to inject. */
  slots: SlotDirective[];
  /** CSS class rules for listing card boost/suppress. */
  listing_rules: ListingClassRule;
  /** Ordered list of listing features to surface prominently for this archetype. */
  feature_priority: string[];
  /** Human-readable description of the archetype's motivation and behaviour. */
  description: string;
  /** Behavioral and quiz signals strongly associated with this archetype. */
  signals: string[];
  /**
   * Structured voice pattern for the AI description pipeline (Cold Start Protection,
   * Master Design E.7.7). Three locales required for all archetypes.
   *
   * Each locale value is a structured string with two sections:
   *   VOICE PATTERN: instructions on HOW to write for this archetype — tone, lead-with
   *     priority, frame, closer, lexicon preferred/avoided (~80-120 words)
   *   HARD RULES: anti-hallucination constraints — what NEVER to write for this archetype
   *     (~30-50 words)
   *
   * Used by `apps/llm-gateway/src/jobs/generate_description.py`:
   *   - Modal job parses both sections and passes them to Sonnet as separate parameters.
   *   - Voice pattern = voice/framing seed (SEED 2) in the three-seed prompt.
   *
   * For Tier 1 sidebar widget: `copy_template[locale]` is returned as-is
   * (source: 'template_fallback') — the voice pattern is displayed directly.
   * For Tier 2/3: on cache miss, the endpoint returns source: 'original' and enqueues
   * a Modal job that uses copy_template as Sonnet's style guide, NOT as literal output.
   *
   * IMPORTANT: Zero numeric placeholders — no {yield}, {occupancy_rate}, {adr},
   * {bedrooms}, {price}, etc. The copy_template describes voice, not content.
   * CI gate: template-purity.test.ts enforces this invariant.
   *
   * @see docs/specs/TICKET-DESC-PIVOT-001-v1.7.1.md Appendix A
   * @see docs/specs/cold-start-protection-v1.md §2
   */
  copy_template: {
    en: string;
    pl: string;
    es: string;
  };
}
