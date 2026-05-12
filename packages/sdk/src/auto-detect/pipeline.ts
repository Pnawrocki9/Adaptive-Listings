/**
 * Auto-Detection Pipeline — skeleton for AUTO-003 / AUTO-004.
 *
 * This module will contain the full detection engine once the technique
 * implementations ship. The public surface (`detectSiteSchema`) is defined here
 * so that downstream consumers (apps/auto-detect, Decision API) can import against
 * a stable interface before the implementation lands.
 *
 * Detection priority order (from corpus analysis of 24 platforms):
 *  1.  data-estalara-*        — Tier 3 Native (our own sites)              confidence 1.0
 *  2.  JSON-LD RealEstateListing — Kyero, Zillow, RE/MAX, Realtor.com       confidence 0.95
 *  3.  data-testid / data-cy  — Rightmove, Zoopla, Otodom, OLX, Bayut      confidence 0.92
 *  4.  MUI MuiPaper-root      — Foxtons, RE/MAX, Coldwell Banker            confidence 0.88
 *  5.  article tag            — Idealista, OnTheMarket, Habitaclia          confidence 0.85
 *  6.  CSS Modules [class*=Prefix] — Rightmove, Zoopla, Redfin             confidence 0.82
 *  7.  CSS-in-JS [class*=keyword]  — Engelvoelkers, Bayut fallback, Redfin confidence 0.75
 *  8.  Angular ng-tns         — Knight Frank                                confidence 0.70
 *  9.  WordPress classes      — Houzez, RealHomes                          confidence 0.90
 * 10.  Drupal/PHP classic     — Zyprus, Bazaraki, Habitaclia               confidence 0.88
 * 11.  AI Vision fallback     — Claude Sonnet 4.6                          confidence varies
 *
 * @module @estalara/sdk/auto-detect/pipeline
 */

import type { TenantSiteSchema } from '@estalara/shared';

/** Result returned by `detectSiteSchema`. */
export interface DetectionResult {
  /** Fully populated schema, or null when detection failed below minimum confidence. */
  schema: TenantSiteSchema | null;
  /** Detection confidence 0.0 – 1.0. */
  confidence: number;
  /** Which detection technique produced the result. */
  technique: TenantSiteSchema['detection_source'];
  /** Non-fatal warnings accumulated during detection (e.g. ambiguous selectors). */
  warnings: string[];
}

/**
 * Detect the site schema for a real estate website.
 *
 * Accepts raw HTML and the page URL; returns a fully populated `TenantSiteSchema`
 * along with confidence metadata and any non-fatal warnings.
 *
 * Detection runs synchronously through the priority ladder defined in the module
 * doc comment. The first technique that exceeds the minimum confidence threshold
 * wins; remaining techniques are skipped.
 *
 * When no technique exceeds the threshold, `schema` is null and `technique` is
 * set to `'ai_vision'` as a signal that the AI Vision fallback should be invoked
 * by the caller (the Vision pipeline runs server-side and is not bundled here).
 *
 * @param html      - Raw HTML string of the page to analyse.
 * @param url       - Canonical URL of the page (used for `url_patterns` inference).
 * @param tenantId  - Estalara tenant identifier to embed in the returned schema.
 *
 * @throws {Error} "Not implemented" — detection techniques ship in AUTO-003 and AUTO-004.
 */
export function detectSiteSchema(
  html: string,
  url: string,
  tenantId: string,
): Promise<DetectionResult> {
  // Suppress unused-parameter warnings until the implementation lands.
  void html;
  void url;
  void tenantId;
  return Promise.reject(
    new Error('Not implemented — detection techniques ship in AUTO-003 and AUTO-004'),
  );
}
