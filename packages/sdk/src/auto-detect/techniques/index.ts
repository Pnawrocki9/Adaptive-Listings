/**
 * Auto-detection technique exports.
 *
 * Techniques 1–10 (deterministic) are implemented here.
 * Technique 11 (AI Vision) is server-side only and is NOT exported from this
 * index — import it directly from './ai-vision.js' in server-side code only.
 *
 * @module @estalara/sdk/auto-detect/techniques
 */

export { detectDataEstalara } from './data-estalara.js';
export { detectJsonLd } from './json-ld.js';
export { detectDataAttributes } from './data-attributes.js';
export { detectMuiComponents } from './mui-components.js';
export { detectArticleTag } from './article-tag.js';
export { detectCssModules } from './css-modules.js';
export { detectCssInJs } from './css-in-js.js';
export { detectAngular } from './angular.js';
export { detectWordPress } from './wordpress.js';
export { detectDrupalPhp } from './drupal-php.js';
// Technique 11 (AI Vision) is intentionally NOT exported here.
// It uses @anthropic-ai/sdk (Node.js only) and must never be bundled into the
// browser SDK. Import it server-side via:
//   import { detectAiVision } from '@estalara/sdk/auto-detect/ai-vision'
