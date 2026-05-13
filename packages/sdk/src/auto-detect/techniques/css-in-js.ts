/**
 * Technique 7 — CSS-in-JS class prefix patterns (confidence 0.75)
 *
 * CSS-in-JS frameworks (styled-components, Emotion) append a short random hash
 * to a stable component-name prefix. The hash changes on every deploy; the
 * prefix does not. This technique extracts the stable prefix and emits a
 * `[class*='prefix']` selector — NEVER the full hashed class name.
 *
 * Detection patterns:
 *   styled-components: `SearchResultCard-sc-a303eae3-14`  → prefix `SearchResultCard`
 *   Emotion generated:  `jTESSm`, `sc-bdVTJa`             → skip (no stable prefix)
 *   CamelCase compound: `BayutCard`, `PropertyItem`        → prefix `BayutCard`
 *
 * Platforms: Engel & Voelkers, Lucas Fox, Bayut (fallback when data-cy absent),
 *            Redfin (fallback when CSS Modules not matched).
 *
 * CRITICAL: The primary selector in SelectorStrategy.primary MUST always be
 * `[class*='prefix']` form. The full CSS-in-JS hash must never appear in stored
 * selectors — it will break within days.
 *
 * @module @estalara/sdk/auto-detect/techniques/css-in-js
 */

import type {
  TenantSiteSchema,
  CardFieldMappings,
  DataExtractorsPerCard,
  SlotSelectors,
} from '@estalara/shared';
import type { DetectionResult } from '../pipeline.js';

/**
 * styled-components pattern: `ComponentName-sc-<8-hex>-<number>`
 * e.g. `SearchResultCard-sc-a303eae3-14`
 */
const SC_NAMED_RE = /^([A-Z][a-zA-Z]+)-sc-[a-f0-9]{8}-\d+$/;

/**
 * CamelCase compound prefix pattern: two or more PascalCase words concatenated.
 * e.g. `BayutCard`, `PropertyItem`, `SearchResultCard`
 */
const CAMEL_COMPOUND_RE = /^([A-Z][a-z]+[A-Z][a-zA-Z]+)(?:-|$)/;

/** Minimum number of matching elements to accept the technique. */
const MIN_CARD_COUNT = 2;

/** Price / currency pattern to validate a card contains price info. */
const CURRENCY_RE = /[€$£₴₺]|USD|EUR|GBP|AED|PLN/;

/**
 * Detect CSS-in-JS portals by scanning class attributes for styled-components or
 * Emotion-style compound-name prefixes.
 *
 * Confidence: **0.75**
 *
 * CRITICAL: The returned `listing_card_selector` is always `[class*='Prefix']`.
 * The full hash class is never stored.
 */
export function detectCssInJs(html: string, url: string): Promise<DetectionResult | null> {
  return Promise.resolve(detectCssInJsSync(html, url));
}

function detectCssInJsSync(html: string, url: string): DetectionResult | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const warnings: string[] = [];

  // Scan all elements for CSS-in-JS prefixes, collecting candidate prefixes
  // along with the count of elements that carry them.
  const prefixCounts = new Map<string, number>();

  for (const el of doc.querySelectorAll('[class]')) {
    for (const cls of el.classList) {
      const prefix = extractCssInJsPrefix(cls);
      if (prefix) {
        prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
      }
    }
  }

  if (prefixCounts.size === 0) return null;

  // Sort by frequency descending — the most common prefix is most likely the card.
  const sorted = [...prefixCounts.entries()].sort((a, b) => b[1] - a[1]);

  const domain = extractDomain(url);
  const urlObj = tryParseUrl(url);
  const indexPatterns = urlObj ? [`${urlObj.origin}/**`] : ['/**'];
  const detailPatterns = urlObj
    ? [`${urlObj.origin}/property/*`, `${urlObj.origin}/listing/*`]
    : ['/property/*'];

  for (const [prefix] of sorted) {
    const cardSelector = `[class*='${prefix}']`;
    const candidates = doc.querySelectorAll(cardSelector);
    if (candidates.length < MIN_CARD_COUNT) continue;

    // Validate that qualifying candidates contain BOTH price AND image.
    let qualifyingCount = 0;
    for (const el of candidates) {
      const hasPrice = CURRENCY_RE.test(el.textContent || '');
      const hasImage = el.querySelector('img') !== null;
      if (hasPrice && hasImage) qualifyingCount++;
    }
    if (qualifyingCount < MIN_CARD_COUNT) continue;

    warnings.push(
      `CSS-in-JS stable selector: ${cardSelector} — volatile hash classes excluded from selector`,
    );

    const currency = inferCurrency(domain);

    const cardFieldMappings: CardFieldMappings = {
      headline: {
        primary: `h2[class*='${prefix}'], h3[class*='${prefix}']`,
        fallbacks: ['h2', 'h3', '[class*="title"]'],
        partial_match: prefix,
        type: 'text',
      },
      price: {
        primary: `[class*='${prefix}'][class*='price'], [class*='price']`,
        fallbacks: ['span[class*="price"]', 'div[class*="price"]'],
        partial_match: prefix,
        type: 'currency',
        currency,
      },
      image: {
        primary: `img[class*='${prefix}'], img`,
        fallbacks: ['img'],
        partial_match: prefix,
        type: 'url',
      },
      bedrooms: {
        primary: `[class*='${prefix}'][class*='room'], [class*='${prefix}'][class*='bed']`,
        fallbacks: ['[class*="rooms"]', '[class*="beds"]'],
        partial_match: prefix,
        type: 'number',
      },
      area: {
        primary: `[class*='${prefix}'][class*='area'], [class*='${prefix}'][class*='size']`,
        fallbacks: ['[class*="area"]'],
        partial_match: prefix,
        type: 'number',
        unit: 'sqm',
      },
    };

    const dataExtractors: DataExtractorsPerCard = {
      price: {
        primary: `[class*='${prefix}'][class*='price'], [class*='price']`,
        fallbacks: ['span[class*="price"]'],
        partial_match: prefix,
        type: 'currency',
        currency,
      },
      bedrooms: {
        primary: `[class*='${prefix}'][class*='room'], [class*='${prefix}'][class*='bed']`,
        fallbacks: ['[class*="rooms"]'],
        partial_match: prefix,
        type: 'number',
      },
      area_sqm: {
        primary: `[class*='${prefix}'][class*='area']`,
        fallbacks: ['[class*="area"]'],
        partial_match: prefix,
        type: 'number',
        unit: 'sqm',
      },
    };

    const slotSelectors: SlotSelectors = {
      headline: {
        primary: 'h1',
        fallbacks: ['[class*="title"]', '[class*="address"]'],
        type: 'text',
      },
      description: {
        primary: '[class*="description"]',
        fallbacks: ['[class*="desc"]', 'p'],
        type: 'text',
      },
      cta_primary: {
        primary: 'a[href*="contact"]',
        fallbacks: ['button[class*="contact"]'],
        type: 'text',
      },
    };

    const schema: TenantSiteSchema = {
      tenant_id: 'pending',
      domain,
      detected_at: new Date().toISOString(),
      detection_source: 'css_in_js',
      detection_confidence: 0.75,
      framework_hint: 'react',
      index_schema: {
        url_patterns: indexPatterns,
        listing_card_selector: cardSelector,
        listing_count_expected: qualifyingCount,
        card_field_mappings: cardFieldMappings,
        data_extractors_per_card: dataExtractors,
        // CSS-in-JS selectors may drift on redeploy — disable reorder.
        reorder_capable: false,
      },
      detail_schema: {
        url_patterns: detailPatterns,
        slot_selectors: slotSelectors,
        data_extractors: {},
      },
      archetype_hints: [],
    };

    return {
      schema,
      confidence: 0.75,
      technique: 'css_in_js',
      warnings,
    };
  }

  return null;
}

/**
 * Extract the stable prefix component from a CSS-in-JS class token.
 *
 * Returns:
 *   `SearchResultCard` from `SearchResultCard-sc-a303eae3-14`
 *   `BayutCard`        from `BayutCard` (CamelCase compound)
 *   `null`             for pure hash tokens like `jTESSm`, `sc-bdVTJa`
 *
 * CRITICAL: Pure-hash emotion classes (all-lowercase short tokens) return null.
 * This ensures we never accidentally emit a hash as a selector.
 */
function extractCssInJsPrefix(cls: string): string | null {
  // styled-components named pattern: `ComponentName-sc-<8hex>-<num>`
  const scMatch = SC_NAMED_RE.exec(cls);
  const scPrefix = scMatch?.[1];
  if (scPrefix) return scPrefix;

  // CamelCase compound: two or more PascalCase segments concatenated.
  const camelMatch = CAMEL_COMPOUND_RE.exec(cls);
  const camelPrefix = camelMatch?.[1];
  if (camelPrefix) return camelPrefix;

  // Skip Emotion-generated pure-hash tokens (e.g. `jTESSm`, `sc-bdVTJa`, `css-1a2b3c`).
  return null;
}

function inferCurrency(domain: string): 'EUR' | 'USD' | 'GBP' | 'PLN' | 'AED' {
  if (domain.endsWith('.co.uk') || domain.endsWith('.uk')) return 'GBP';
  if (domain.endsWith('.pl')) return 'PLN';
  if (domain.endsWith('.ae')) return 'AED';
  if (domain.endsWith('.com')) return 'USD';
  return 'EUR';
}

function extractDomain(url: string): string {
  const parsed = tryParseUrl(url);
  return parsed ? parsed.hostname : url;
}

function tryParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
