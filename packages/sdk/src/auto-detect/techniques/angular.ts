/**
 * Technique 8 — Angular application patterns (confidence 0.70)
 *
 * Angular generates `_ngcontent-*-c{number}` and `ng-tns-c{number}-{number}`
 * scoped attributes that are completely unstable across builds. This technique
 * detects Angular apps and then IGNORES all Angular-generated attributes,
 * instead finding stable structural or semantic class patterns.
 *
 * Detection strategy:
 *  1. Detect Angular: `[_nghost-*]` / `[_ngcontent-*]`, `<app-root>`, or
 *     `<meta name="generator" content*="Angular">` / `ng-version` meta.
 *  2. If Angular detected, IGNORE all `_ngcontent-*` and `ng-tns-*` classes.
 *  3. Look for stable repeating patterns: `[class*='property']`, `[class*='listing']`,
 *     `[class*='card']` that appear >= 2 times with price + image co-occurrence.
 *  4. Structural fallback: `div:has(img):has([class*="price"])` repeated >= 2 times.
 *
 * Platform: Knight Frank.
 *
 * @module @estalara/sdk/auto-detect/techniques/angular
 */

import type {
  TenantSiteSchema,
  CardFieldMappings,
  DataExtractorsPerCard,
  SlotSelectors,
} from '@estalara/shared';
import type { DetectionResult } from '../pipeline.js';

/** Stable class keyword fragments to search for (Angular attributes excluded). */
const STABLE_CLASS_KEYWORDS = [
  'PropertyCard',
  'property-card',
  'ListingCard',
  'listing-card',
  'PropertyItem',
  'property-item',
  'ListingItem',
  'listing-item',
  'property',
  'listing',
  'card',
  'result',
] as const;

/** Price / currency pattern to validate a card contains price info. */
const CURRENCY_RE = /[€$£₴₺]|USD|EUR|GBP|AED|PLN|\d[\d,.']{3,}/;

/** Minimum qualifying card count. */
const MIN_CARD_COUNT = 2;

/**
 * Detect Angular real estate portals.
 *
 * Confidence: **0.70**
 *
 * When Angular is detected, this technique ignores all `_ngcontent-*` and
 * `ng-tns-*` class names and finds the nearest stable structural pattern.
 */
export function detectAngular(html: string, url: string): Promise<DetectionResult | null> {
  return Promise.resolve(detectAngularSync(html, url));
}

function detectAngularSync(html: string, url: string): DetectionResult | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const warnings: string[] = [];

  if (!isAngularApp(doc)) return null;

  warnings.push('Angular app detected — _ngcontent-* and ng-tns-* attributes ignored');

  const domain = extractDomain(url);
  const urlObj = tryParseUrl(url);
  const indexPatterns = urlObj ? [`${urlObj.origin}/**`] : ['/**'];
  const detailPatterns = urlObj
    ? [`${urlObj.origin}/property/*`, `${urlObj.origin}/properties/*`]
    : ['/property/*'];

  const currency = inferCurrency(domain);

  // Try each stable class keyword in priority order.
  for (const keyword of STABLE_CLASS_KEYWORDS) {
    // Build a partial-match selector that avoids Angular-generated classes.
    const cardSelector = `[class*='${keyword}']`;
    const candidates = doc.querySelectorAll(cardSelector);
    if (candidates.length < MIN_CARD_COUNT) continue;

    // Count elements that contain both a price-pattern text node AND an img descendant.
    // We do NOT exclude Angular-internal elements here — in Angular apps, most elements
    // carry _ngcontent-* scope attributes. Excluding them would yield zero matches.
    // The key insight is: we use stable semantic class names (not Angular attributes)
    // as the selector, which is stable across builds.
    let qualifyingCount = 0;
    for (const el of candidates) {
      const hasPrice = CURRENCY_RE.test(el.textContent || '');
      const hasImage = el.querySelector('img') !== null;
      if (hasPrice && hasImage) qualifyingCount++;
    }
    if (qualifyingCount < MIN_CARD_COUNT) continue;

    const schema = buildSchema(
      domain,
      indexPatterns,
      detailPatterns,
      cardSelector,
      keyword,
      currency,
      qualifyingCount,
    );

    return {
      schema,
      confidence: 0.7,
      technique: 'angular',
      warnings,
    };
  }

  // Structural fallback: div containing both img and a price-pattern span,
  // repeated >= MIN_CARD_COUNT times.
  const structuralSelector = 'div:has(img):has([class*="price"])';
  const structuralCandidates = (() => {
    try {
      return doc.querySelectorAll(structuralSelector);
    } catch {
      // :has() may not be supported in all jsdom versions — fall back gracefully.
      return [] as unknown as NodeListOf<Element>;
    }
  })();

  const structuralQualifyingCount = [...structuralCandidates].filter((el) =>
    CURRENCY_RE.test(el.textContent || ''),
  ).length;

  if (structuralQualifyingCount >= MIN_CARD_COUNT) {
    warnings.push('Angular structural fallback used: div:has(img):has([class*="price"])');
    const schema = buildSchema(
      domain,
      indexPatterns,
      detailPatterns,
      structuralSelector,
      'price',
      currency,
      structuralQualifyingCount,
    );
    return {
      schema,
      confidence: 0.7,
      technique: 'angular',
      warnings,
    };
  }

  // Angular was detected but no stable pattern found.
  warnings.push('Angular detected but no stable listing card pattern found');
  return null;
}

/**
 * Determine whether the document is an Angular app.
 *
 * Checks in priority order:
 *  1. Any element carrying `_nghost-*` or `_ngcontent-*` attributes
 *  2. `<app-root>` custom element
 *  3. `<meta name="generator" content="Angular ...">` or `ng-version` meta
 */
function isAngularApp(doc: Document): boolean {
  // Attribute selectors with wildcard prefix aren't valid CSS — use TreeWalker instead.
  // Walk all elements and check for _nghost-* or _ngcontent-* attributes.
  const walker = doc.createTreeWalker(doc.documentElement, 1 /* SHOW_ELEMENT */);
  let node = walker.nextNode();
  while (node) {
    const el = node as Element;
    const attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const attrName = attrs.item(i)?.name;
      if (attrName?.startsWith('_nghost-') || attrName?.startsWith('_ngcontent-')) return true;
    }
    node = walker.nextNode();
  }

  // Check for app-root custom element.
  if (doc.querySelector('app-root')) return true;

  // Check generator meta tag.
  const generator = doc.querySelector('meta[name="generator"]');
  if (generator?.getAttribute('content')?.toLowerCase().includes('angular')) return true;

  // Check ng-version meta.
  if (doc.querySelector('meta[name="ng-version"]')) return true;

  return false;
}

function buildSchema(
  domain: string,
  indexPatterns: string[],
  detailPatterns: string[],
  cardSelector: string,
  keywordHint: string,
  currency: 'EUR' | 'USD' | 'GBP' | 'PLN' | 'AED',
  qualifyingCount: number,
): TenantSiteSchema {
  const cardFieldMappings: CardFieldMappings = {
    headline: {
      primary: `h2[class*='${keywordHint}'], h3[class*='${keywordHint}']`,
      fallbacks: ['h2', 'h3', '[class*="address"]', '[class*="title"]'],
      partial_match: keywordHint,
      type: 'text',
    },
    price: {
      primary: `span[class*='price'], div[class*='price']`,
      fallbacks: ['[class*="Price"]'],
      type: 'currency',
      currency,
    },
    image: {
      primary: 'img',
      fallbacks: [],
      type: 'url',
    },
    bedrooms: {
      primary: `span[class*='bedrooms'], span[class*='beds']`,
      fallbacks: ['[class*="room"]'],
      type: 'number',
    },
    area: {
      primary: `span[class*='area'], span[class*='size']`,
      fallbacks: ['[class*="floor"]'],
      type: 'number',
      unit: 'sqft',
    },
  };

  const dataExtractors: DataExtractorsPerCard = {
    price: {
      primary: `span[class*='price'], div[class*='price']`,
      fallbacks: ['[class*="Price"]'],
      type: 'currency',
      currency,
    },
    bedrooms: {
      primary: `span[class*='bedrooms'], span[class*='beds']`,
      fallbacks: ['[class*="room"]'],
      type: 'number',
    },
    area_sqm: {
      primary: `span[class*='area']`,
      fallbacks: ['[class*="size"]'],
      type: 'number',
      unit: 'sqft',
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
      fallbacks: ['p'],
      type: 'text',
    },
    cta_primary: {
      primary: 'a[href*="contact"]',
      fallbacks: ['button[class*="contact"]'],
      type: 'text',
    },
  };

  return {
    tenant_id: 'pending',
    domain,
    detected_at: new Date().toISOString(),
    detection_source: 'angular',
    detection_confidence: 0.7,
    framework_hint: 'angular',
    index_schema: {
      url_patterns: indexPatterns,
      listing_card_selector: cardSelector,
      listing_count_expected: qualifyingCount,
      card_field_mappings: cardFieldMappings,
      data_extractors_per_card: dataExtractors,
      reorder_capable: true,
    },
    detail_schema: {
      url_patterns: detailPatterns,
      slot_selectors: slotSelectors,
      data_extractors: {},
    },
    archetype_hints: [],
  };
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
