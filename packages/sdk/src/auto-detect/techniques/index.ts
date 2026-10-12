/**
 * Auto-detection technique exports.
 *
 * The deterministic techniques are Estalara markup (`data-estalara-*`), JSON-LD and
 * stable data attributes; the platform-specific techniques were removed by FOLLOW-1294.
 * AI Vision is server-side only and is NOT exported from this index — import it
 * directly from './ai-vision.js' in server-side code only.
 *
 * @module @estalara/sdk/auto-detect/techniques
 */

export { detectDataEstalara } from './data-estalara.js';
export { detectJsonLd } from './json-ld.js';
export { detectDataAttributes } from './data-attributes.js';
// AI Vision is intentionally NOT exported here.
// It uses @anthropic-ai/sdk (Node.js only) and must never be bundled into the
// browser SDK. Import it server-side via:
//   import { detectAiVision } from '@estalara/sdk/auto-detect/ai-vision'
