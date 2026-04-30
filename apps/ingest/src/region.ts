/**
 * CF-IPCountry → Estalara region mapper.
 *
 * Cloudflare provides `CF-IPCountry` (ISO 3166-1 alpha-2) on every request reaching the Worker.
 * We collapse 200+ countries into the four regions Estalara deploys to (Master Design A.3).
 *
 * @module apps/ingest/src/region
 */

import type { Region } from '@estalara/shared';

/** UAE-region countries (Master Design A.3). */
const UAE_REGION = new Set(['AE']);

/** UK-region (own region for ICO compliance, even though geographically EU-adjacent). */
const UK_REGION = new Set(['GB']);

/** US-region — North America served from US edge nodes. */
const US_REGION = new Set([
  'US',
  'CA',
  'MX',
  'PR', // Puerto Rico
  'VI', // US Virgin Islands
]);

/**
 * Map a CF-IPCountry header value to an Estalara region. Unknown / missing → `'eu'` (default
 * region — covers all EU member states plus most of the rest of the world for MVP).
 *
 * @param country - ISO 3166-1 alpha-2 country code (case-insensitive). Falsy / unknown → `'eu'`.
 */
export function mapCountryToRegion(country: string | null | undefined): Region {
  if (!country) return 'eu';
  const upper = country.toUpperCase();
  if (UAE_REGION.has(upper)) return 'uae';
  if (UK_REGION.has(upper)) return 'uk';
  if (US_REGION.has(upper)) return 'us';
  return 'eu';
}
