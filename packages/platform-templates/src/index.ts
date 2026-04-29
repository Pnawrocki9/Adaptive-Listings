/**
 * @estalara/platform-templates — Pre-built platform fingerprints for Auto-Onboarding Layer 3.
 *
 * This package provides pre-validated CSS selectors for 50+ known real estate platforms,
 * enabling zero-cost platform detection before falling back to expensive AI Vision calls.
 *
 * Part of the layered detection strategy (Master Design B.5.1):
 *
 * | Layer | Method                | Coverage | Cost  |
 * |-------|-----------------------|----------|-------|
 * | L1    | Schema.org JSON-LD    | ~40%     | $0    |
 * | L2    | Microdata             | ~10%     | $0    |
 * | L3    | Platform fingerprint  | ~25%     | $0    |
 * | L4    | Heuristic detection   | ~15%     | $0    |
 * | L5    | AI Vision (Claude)    | 100%     | $0.33 |
 *
 * Layer 3 (this package) handles ~25% of sites for free, reducing dependency on AI Vision.
 *
 * @module @estalara/platform-templates
 * @see {@link https://github.com/estalara/adaptive-listings/docs/MASTER_DESIGN.md} Master Design B.4.2, B.5.1
 */

import { templates } from './templates/index.js';
import type { MatchResult } from './types.js';

export * from './types.js';
export { templates };

/**
 * Match a URL + HTML against the platform template registry.
 *
 * This is Layer 3 of the detection pipeline (Master Design B.5.1).
 * Real implementation lands in TICKET-032; this placeholder always returns null.
 *
 * @param url - The URL of the page to match
 * @param html - The HTML content of the page
 * @returns MatchResult if a template matches, null otherwise
 *
 * @example
 * ```typescript
 * const result = matchPlatform('https://idealista.com/inmueble/12345', htmlContent);
 * if (result) {
 *   console.log(`Matched: ${result.templateName} (${result.confidence})`);
 * }
 * ```
 */
export function matchPlatform(_url: string, _html: string): MatchResult | null {
  // Placeholder: real matching logic in TICKET-032
  // Will implement:
  // 1. Extract hostname from url
  // 2. Match against templates[].hostnameMatchers
  // 3. Verify domSignatures in html
  // 4. Return MatchResult with matched template
  return null;
}
