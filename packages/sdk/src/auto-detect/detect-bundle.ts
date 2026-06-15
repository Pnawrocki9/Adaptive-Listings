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
 * script (estalara-detect.iife.js) is absent, cold-start site-level archetype
 * hints are skipped. Referrer and device-type cold-start priors still apply.
 * The `archetype_hint` sent to /api/adapt on the first refreshDirectives() call
 * defaults to 'neutral' until behavioral signals converge.
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
