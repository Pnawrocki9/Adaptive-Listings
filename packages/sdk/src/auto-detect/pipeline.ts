/**
 * Auto-Detection Pipeline — Estalara markup only (FOLLOW-1294, CEO decision D4).
 *
 * Runs a priority-ordered cascade of deterministic detection techniques against
 * raw HTML. The first technique that returns a result with confidence >= 0.7 wins;
 * remaining techniques are skipped.
 *
 * Detection priority order:
 *  1.  data-estalara-*           — Estalara's own markup (re-brands share it)  confidence 1.0
 *  2.  JSON-LD RealEstateListing — structured data                             confidence 0.95
 *  3.  data-testid / data-cy     — stable test attributes                      confidence 0.92
 *  4.  AI Vision fallback        — server-side only (POST /api/detect)         confidence varies
 *
 * The platform-specific techniques (WordPress, Drupal/PHP, Angular, MUI, CSS-in-JS,
 * CSS Modules, article tag) were removed by FOLLOW-1294: private-label re-brands share
 * Estalara markup, so platform heuristics are not developed (MASTER_DESIGN §B.5 PARKED).
 *
 * @module @estalara/sdk/auto-detect/pipeline
 */

import type { TenantSiteSchema } from '@estalara/shared';
import { detectDataEstalara } from './techniques/data-estalara.js';
import { detectJsonLd } from './techniques/json-ld.js';
import { detectDataAttributes } from './techniques/data-attributes.js';
// AI Vision is NOT imported here. Uses @anthropic-ai/sdk (Node.js only)
// and must never be bundled into the browser SDK.
// Called server-side from POST /api/detect when this function returns schema: null.
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
  const techniques = [
    detectDataEstalara, //    1.0 — own markup, immediate return
    detectJsonLd, //          0.95 — structured data bypass
    detectDataAttributes, //  0.92 — stable test attributes
    // AI Vision — called server-side by POST /api/detect, not here
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

  // No technique matched — signal that the AI Vision fallback is needed.
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
