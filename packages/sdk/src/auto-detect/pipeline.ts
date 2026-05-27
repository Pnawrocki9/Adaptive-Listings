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
import { detectCssInJs } from './techniques/css-in-js.js';
import { detectAngular } from './techniques/angular.js';
import { detectWordPress } from './techniques/wordpress.js';
import { detectDrupalPhp } from './techniques/drupal-php.js';
// Technique 11 — AI Vision — NOT imported here. Uses @anthropic-ai/sdk (Node.js only)
// and must never be bundled into the browser SDK.
// Called server-side from POST /api/detect when this function returns schema: null.
import { extractArchetypeHints } from './archetype-hints.js';
import { detectInquirySubmitSelector } from './detect-inquiry-selector.js';

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
  //
  // WordPress / Drupal precede article-tag and css-modules: their generator-meta
  // and body-class markers are unambiguous, and WordPress themes (RealHomes uses
  // `article.property`) would otherwise be misdetected by the article-tag
  // technique's class-based fallback.
  const techniques = [
    detectDataEstalara, //    1.0 — own sites, immediate return
    detectJsonLd, //          0.95 — structured data bypass
    detectDataAttributes, //  0.92 — stable test attributes
    detectMuiComponents, //   0.88 — Material UI franchise portals
    detectWordPress, //       0.90 — WordPress theme classes (Houzez/RealHomes)
    detectDrupalPhp, //       0.88 — Drupal BEM + PHP classic
    detectArticleTag, //      0.85 — semantic article elements
    detectCssModules, //      0.82 — CSS Modules prefix patterns
    detectCssInJs, //         0.75 — styled-components/Emotion prefix patterns
    detectAngular, //         0.70 — Angular structural detection
    // Technique 11 — AI Vision — called server-side by POST /api/detect, not here
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
      let finalSchema: TenantSiteSchema | null = null;
      if (result.schema) {
        finalSchema = { ...result.schema, tenant_id: tenantId };
        // Populate archetype hints from site-level signals (TICKET-AUTO-007).
        // Hints seed the Intent Engine's archetype priors at session start.
        finalSchema.archetype_hints = extractArchetypeHints(finalSchema, html, url);
        // Populate inquiry_submit_selector via deterministic DOM probe (FOLLOW-127).
        // Only set when a non-empty selector is found — never write "".
        const inquirySelector = detectInquirySubmitSelector(html);
        if (inquirySelector !== null) {
          finalSchema.inquiry_submit_selector = inquirySelector;
        }
      }
      return {
        ...result,
        schema: finalSchema,
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
      'No deterministic technique matched confidence threshold — AI Vision fallback should be invoked server-side.',
    ],
  };
}
