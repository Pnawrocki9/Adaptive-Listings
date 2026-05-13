/**
 * Auto-Detection Pipeline — Techniques 1–6 (AUTO-003).
 *
 * Runs a priority-ordered cascade of deterministic detection techniques against
 * raw HTML. The first technique that returns a result with confidence >= 0.7 wins;
 * remaining techniques are skipped.
 *
 * Detection priority order (from corpus analysis of 24 platforms):
 *  1.  data-estalara-*        — Tier 3 Native (our own sites)              confidence 1.0
 *  2.  JSON-LD RealEstateListing — Kyero, Zillow, RE/MAX, Realtor.com       confidence 0.95
 *  3.  data-testid / data-cy  — Rightmove, Zoopla, Otodom, OLX, Bayut      confidence 0.92
 *  4.  MUI MuiPaper-root      — Foxtons, RE/MAX, Coldwell Banker            confidence 0.88
 *  5.  article tag            — Idealista, OnTheMarket, Habitaclia          confidence 0.85
 *  6.  CSS Modules [class*=Prefix] — Rightmove, Zoopla, Redfin             confidence 0.82
 *  7.  CSS-in-JS [class*=keyword]  — Engelvoelkers, Bayut fallback, Redfin confidence 0.75  (AUTO-004)
 *  8.  Angular ng-tns         — Knight Frank                                confidence 0.70  (AUTO-004)
 *  9.  WordPress classes      — Houzez, RealHomes                          confidence 0.90  (AUTO-004)
 * 10.  Drupal/PHP classic     — Zyprus, Bazaraki, Habitaclia               confidence 0.88  (AUTO-004)
 * 11.  AI Vision fallback     — Claude Sonnet 4.6                          confidence varies (AUTO-004)
 *
 * @module @estalara/sdk/auto-detect/pipeline
 */

import type { TenantSiteSchema } from '@estalara/shared';
import { detectDataEstalara } from './techniques/data-estalara.js';
import { detectJsonLd } from './techniques/json-ld.js';
import { detectDataAttributes } from './techniques/data-attributes.js';
import { detectMuiComponents } from './techniques/mui-components.js';
import { detectArticleTag } from './techniques/article-tag.js';
import { detectCssModules } from './techniques/css-modules.js';

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

/** Minimum confidence threshold to accept a technique result. */
const MIN_CONFIDENCE = 0.7;

/**
 * Detect the site schema for a real estate website.
 *
 * Accepts raw HTML and the page URL; returns a fully populated `TenantSiteSchema`
 * along with confidence metadata and any non-fatal warnings.
 *
 * Detection runs through the priority ladder defined in the module doc comment.
 * The first technique that exceeds the minimum confidence threshold wins;
 * remaining techniques are skipped.
 *
 * When no technique exceeds the threshold, `schema` is null and `technique` is
 * set to `'ai_vision'` as a signal that the AI Vision fallback should be invoked
 * by the caller (the Vision pipeline runs server-side and is not bundled here).
 *
 * @param html      - Raw HTML string of the page to analyse.
 * @param url       - Canonical URL of the page (used for `url_patterns` inference).
 * @param tenantId  - Estalara tenant identifier to embed in the returned schema.
 */
export async function detectSiteSchema(
  html: string,
  url: string,
  tenantId: string,
): Promise<DetectionResult> {
  const accumulatedWarnings: string[] = [];

  // Techniques in priority order — first confident match wins.
  const techniques = [
    detectDataEstalara, //    1.0 — own sites, immediate return
    detectJsonLd, //          0.95 — structured data bypass
    detectDataAttributes, //  0.92 — stable test attributes
    detectMuiComponents, //   0.88 — Material UI franchise portals
    detectArticleTag, //      0.85 — semantic article elements
    detectCssModules, //      0.82 — CSS Modules prefix patterns
    // AUTO-004 adds: detectCssInJs, detectAngular, detectWordPress, detectDrupalPhp, detectAiVision
  ] as const;

  for (const technique of techniques) {
    let result: Awaited<ReturnType<typeof detectDataEstalara>>;
    try {
      result = await technique(html, url);
    } catch (err) {
      accumulatedWarnings.push(
        `Technique failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    if (result !== null && result.confidence >= MIN_CONFIDENCE) {
      return {
        ...result,
        schema: result.schema ? { ...result.schema, tenant_id: tenantId } : null,
        warnings: [...accumulatedWarnings, ...result.warnings],
      };
    }
  }

  // No technique matched — signal that AUTO-004 AI Vision fallback is needed.
  return {
    schema: null,
    confidence: 0,
    technique: 'ai_vision',
    warnings: [
      ...accumulatedWarnings,
      'No deterministic technique matched — AI Vision fallback not yet implemented (AUTO-004)',
    ],
  };
}
