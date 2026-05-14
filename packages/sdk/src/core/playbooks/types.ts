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
   * Static ~100-150 word property description template used as:
   * (a) fallback for Tier 1 in GET /api/adapt/description
   * (b) seed text for Sonnet generation (Tier 2 / Tier 3)
   * May contain `{variable}` placeholders resolved from listing context.
   */
  copy_template: {
    en: string;
    pl?: string;
    es?: string;
  };
}
