/**
 * Auto-detect IIFE bundle entry point.
 *
 * Built as `dist/estalara-detect.iife.js` — a separate script loaded alongside
 * (or after) the main `estalara-sdk.iife.js` bundle.
 *
 * Exposes `window.__EStalaraDetect` with `detectSiteSchema` and
 * `extractArchetypeHints` so the main SDK IIFE can call them without bundling
 * the full auto-detect pipeline (~17 KB gzip) into the core bundle.
 *
 * FOLLOW-324: this split keeps the Tier 1+2 IIFE under the 40 KB gzip limit.
 *
 * Install snippet usage:
 *   <script src="estalara-detect.iife.js"></script>
 *   <script src="estalara-sdk.iife.js" data-api-key="…"></script>
 *
 * The main SDK reads `window.__EStalaraDetect` opportunistically — if this
 * script is absent (e.g. tenant omits it), cold-start archetype hints are
 * skipped. The Decision API's server-side schema is used instead on the
 * first adapt request.
 *
 * @module @estalara/sdk/auto-detect/detect-bundle
 */

import { detectSiteSchema } from './pipeline.js';
import { extractArchetypeHints } from './archetype-hints.js';

(
  globalThis as {
    __EStalaraDetect?: {
      detectSiteSchema: typeof detectSiteSchema;
      extractArchetypeHints: typeof extractArchetypeHints;
    };
  }
).__EStalaraDetect = {
  detectSiteSchema,
  extractArchetypeHints,
};
