/**
 * TenantSiteSchema — complete description of where listings are on a tenant's
 * real estate website and how to extract data from them.
 *
 * Produced by the Auto-Detection Engine (AUTO-003 / AUTO-004) and consumed by
 * the Decision API (Sprint 8) for listing re-ranking and slot adaptation.
 *
 * Sprint 8 hooks:
 *   - `IndexSchema.data_extractors_per_card` — per-card data extraction for re-ranking
 *   - `IndexSchema.container_selector`       — grid container selector for ReorderDirective
 *
 * @module @estalara/shared/tenant-site-schema
 */

// `ArchetypeId` is already declared in `./directives.ts` (the canonical shared-package location).
// Import it from there to avoid duplicating the union and keep both files in sync automatically.
import type { ArchetypeId } from './directives.js';

/** Whether a URL corresponds to a listing index page, a detail page, or unknown. */
export type PageType = 'index' | 'detail' | 'unknown';

/**
 * Strategy for extracting a single field from the DOM.
 *
 * The detection engine tries `primary` first, then falls through `fallbacks` in order.
 * Additional hints (`json_ld_path`, `regex`, `partial_match`) help the extractor
 * handle non-standard markup.
 */
export interface SelectorStrategy {
  /** Primary CSS selector to try first. */
  primary: string;
  /** Ordered fallback selectors if primary doesn't match. */
  fallbacks: string[];
  /** Partial text to match against element content (substring). */
  partial_match?: string;
  /** JSON-LD property path (dot-separated) to read when selector fails. */
  json_ld_path?: string;
  /** Regex to apply to extracted text before returning the value. */
  regex?: string;
  /** How to parse/coerce the extracted text value. */
  type: 'text' | 'number' | 'currency' | 'boolean' | 'url';
  /** Required when `type` is `'currency'`. */
  currency?: 'EUR' | 'USD' | 'GBP' | 'PLN' | 'AED';
  /** Required when `type` is `'number'` and the field represents an area measurement. */
  unit?: 'sqm' | 'sqft' | 'acres';
}

/**
 * Field extraction mappings for listing card elements on an index page.
 *
 * Used for display-level extraction (e.g. headline rewrite, photo swap).
 * For re-ranking inputs see `DataExtractorsPerCard`.
 */
export interface CardFieldMappings {
  headline?: SelectorStrategy;
  price?: SelectorStrategy;
  image?: SelectorStrategy;
  bedrooms?: SelectorStrategy;
  bathrooms?: SelectorStrategy;
  area?: SelectorStrategy;
  location?: SelectorStrategy;
}

/**
 * Per-card data extractors used by the Decision API re-ranking algorithm (Sprint 8).
 *
 * These fields feed directly into archetype-affinity scoring. All fields are optional
 * because not every platform exposes all data points on the listing card.
 *
 * SPRINT 8 HOOK: populated by the detection engine, consumed by the re-ranking
 * engine when computing scores for `ReorderDirective`.
 */
export interface DataExtractorsPerCard {
  price?: SelectorStrategy;
  bedrooms?: SelectorStrategy;
  bathrooms?: SelectorStrategy;
  area_sqm?: SelectorStrategy;
  price_per_sqm?: SelectorStrategy;
  property_type?: SelectorStrategy;
  has_pool?: SelectorStrategy;
  has_live_session?: SelectorStrategy;
  is_offplan?: SelectorStrategy;
}

/**
 * Augment slot selectors for a listing detail page.
 *
 * Each entry maps a logical slot name to a CSS selector strategy.
 * Slot names align with Tier 2 Augment `data-estalara-slot` values.
 */
export interface SlotSelectors {
  headline?: SelectorStrategy;
  subheadline?: SelectorStrategy;
  description?: SelectorStrategy;
  cta_primary?: SelectorStrategy;
  cta_secondary?: SelectorStrategy;
  feature_section?: SelectorStrategy;
  ai_topics?: SelectorStrategy;
  tagline?: SelectorStrategy;
}

/**
 * A contextual hint that nudges archetype classification for this tenant's site.
 *
 * For example: a site that exclusively shows off-plan Dubai properties provides
 * a strong boost toward `golden_visa_buyer` and `yield_hunter`.
 */
export interface ArchetypeHint {
  /**
   * Archetype to boost.
   *
   * Accepts any of the known `ArchetypeId` literals for IDE autocomplete, plus any
   * future string extension. `string & {}` preserves autocomplete while satisfying
   * @typescript-eslint/no-redundant-type-constituents (plain `ArchetypeId | string` is rejected).
   */
  archetype_id: ArchetypeId | (string & {});
  /** Human-readable description of the signal that triggered this hint. */
  signal: string;
  /** Additive confidence boost (0.0 – 1.0) applied before classification. */
  confidence_boost: number;
}

/**
 * Schema describing the listing index page (search results / grid view).
 *
 * Sprint 8 hooks:
 *   - `container_selector`        — consumed by `ReorderDirective` to scope DOM reordering
 *   - `data_extractors_per_card`  — consumed by the re-ranking engine for affinity scoring
 */
export interface IndexSchema {
  /** URL path patterns that identify this page as an index page (glob or regex string). */
  url_patterns: string[];
  /** CSS selector that matches individual listing card elements. */
  listing_card_selector: string;
  /**
   * CSS selector for the grid / list container that wraps all cards.
   *
   * SPRINT 8 HOOK: Required by `ReorderDirective.container_selector` for DOM reordering.
   * Populated by the detection engine; consumed by the A/B re-ranking framework in Sprint 8.
   */
  container_selector?: string;
  /** Approximate number of listing cards expected per page (used for confidence validation). */
  listing_count_expected?: number;
  /** Field-level extraction strategies for display-layer adaptation (Tier 2 Augment). */
  card_field_mappings: CardFieldMappings;
  /**
   * Per-card numeric/boolean extractors for Decision API re-ranking (Sprint 8).
   *
   * SPRINT 8 HOOK: populated by the detection engine, not yet consumed by Decision API.
   */
  data_extractors_per_card: DataExtractorsPerCard;
  /** Whether the page exposes sort controls (relevance / price / date). */
  sort_options_available?: boolean;
  /**
   * Whether this page's card order can be mutated by `ReorderDirective`.
   *
   * Set to `true` when `container_selector` is known and card markup is reorderable.
   * The re-ranking engine in Sprint 8 gates on this flag before applying a reorder.
   */
  reorder_capable: boolean;
}

/** Schema describing a single listing detail page. */
export interface DetailSchema {
  /** URL path patterns that identify this page as a detail page. */
  url_patterns: string[];
  /** Augment slot selectors for in-page text/CTA adaptation. */
  slot_selectors: SlotSelectors;
  /**
   * Arbitrary named data extractors keyed by field name.
   *
   * Covers fields that are only available on the detail page (floor plan area, EPC rating, etc.).
   */
  data_extractors: Record<string, SelectorStrategy>;
  /** CSS selector for the similar listings / recommended properties section. */
  similar_listings_selector?: string;
  /** True when the H1 contains the price rather than the property title (e.g. some UK portals). */
  h1_is_price?: boolean;
}

/**
 * Full tenant site schema — the output of the Auto-Detection Engine.
 *
 * Stored per-tenant in the database and versioned via `detected_at` /
 * `last_validated` / `validation_health`. Drift detection (Sprint 8 / B.6)
 * updates `validation_health` on a daily cron.
 */
export interface TenantSiteSchema {
  /** Estalara tenant identifier. */
  tenant_id: string;
  /** Bare domain (e.g. `rightmove.co.uk`). */
  domain: string;
  /** ISO 8601 timestamp of when this schema was first detected. */
  detected_at: string;
  /**
   * Which detection technique produced the highest-confidence result.
   *
   * Ordered from most to least reliable (mirrors AUTO-003 detection priority):
   *   data_estalara  → our own Tier 3 Native pages (confidence 1.0)
   *   json_ld        → JSON-LD RealEstateListing (0.95)
   *   data_testid    → data-testid/data-cy attributes (0.92)
   *   data_cy        → Cypress test selectors (0.92)
   *   article_tag    → semantic article element (0.85)
   *   css_modules    → CSS Module class prefix heuristic (0.82)
   *   mui            → MUI MuiPaper-root (0.88)
   *   css_in_js      → CSS-in-JS keyword class (0.75)
   *   angular        → Angular ng-tns selector (0.70)
   *   wordpress      → WordPress theme classes (0.90)
   *   drupal         → Drupal field_* classes (0.88)
   *   php_classic    → PHP classic HTML patterns (0.88)
   *   ai_vision      → Claude Sonnet 4.6 Vision fallback (varies)
   *   manual         → Human-authored schema
   */
  detection_source:
    | 'data_estalara'
    | 'json_ld'
    | 'data_testid'
    | 'data_cy'
    | 'article_tag'
    | 'css_modules'
    | 'mui'
    | 'css_in_js'
    | 'angular'
    | 'wordpress'
    | 'drupal'
    | 'php_classic'
    | 'ai_vision'
    | 'manual';
  /** Detection confidence 0.0 – 1.0. Below 0.6 should trigger a manual review flag. */
  detection_confidence: number;
  /** Detected JavaScript framework, when identifiable from markup patterns. */
  framework_hint?: 'react' | 'nextjs' | 'svelte' | 'angular' | 'wordpress' | 'drupal' | 'php';
  /** Schema for the listing index / search results page. */
  index_schema: IndexSchema;
  /** Schema for the individual listing detail page. */
  detail_schema: DetailSchema;
  /**
   * Archetype hints derived from site-level signals (market, property type, price tier).
   *
   * Applied during Session-level archetype classification to boost priors for this tenant.
   */
  archetype_hints: ArchetypeHint[];
  /** ISO 8601 timestamp of the most recent schema validation run. */
  last_validated?: string;
  /**
   * Fraction (0.0 – 1.0) of selectors that matched during the last validation run.
   *
   * Used by the continuous drift detection cron (Sprint 8 / B.6) to flag schema rot.
   */
  validation_health?: number;
}
