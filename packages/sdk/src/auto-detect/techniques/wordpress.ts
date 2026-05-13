/**
 * Technique 9 — WordPress theme detection (confidence 0.90)
 *
 * WordPress real estate themes share very stable class names across thousands of
 * sites. This technique first confirms the page is a WordPress site, then maps
 * the detected theme to known, stable listing card selectors.
 *
 * Theme detection priority:
 *  a) Houzez     — `body.houzez` / `div.houzez-card` / link[href*="houzez"]
 *                  card selector: `div.item-listing-wrap`    confidence 0.92
 *  b) RealHomes  — `body.real-homes` / `div.property-item` / link[href*="realhomes"]
 *                  card selector: `article.property`         confidence 0.88
 *  c) WP Residence / EstateEngine
 *                — `body.residence-page` / `div.property_listing`
 *                  card selector: `article.property-item`    confidence 0.88
 *  d) Generic WP — fallback tries `article.property`, `div.property-item`, `li.listing`
 *                                                            confidence 0.80
 *
 * Platforms: Houzez (~55 k sites), RealHomes, WP Residence.
 *
 * @module @estalara/sdk/auto-detect/techniques/wordpress
 */

import type {
  TenantSiteSchema,
  CardFieldMappings,
  DataExtractorsPerCard,
  SlotSelectors,
} from '@estalara/shared';
import type { DetectionResult } from '../pipeline.js';
import { inferContainerSelector } from '../utils/container.js';

/** Minimum qualifying card count. */
const MIN_CARD_COUNT = 2;

interface ThemeSpec {
  name: string;
  cardSelector: string;
  confidence: number;
  cardFieldMappings: CardFieldMappings;
  dataExtractors: DataExtractorsPerCard;
}

/** Known WordPress real-estate theme specs. */
const THEME_SPECS: ThemeSpec[] = [
  // Houzez — used on ~55k sites; class names are extremely stable.
  {
    name: 'houzez',
    cardSelector: 'div.item-listing-wrap',
    confidence: 0.92,
    cardFieldMappings: {
      headline: {
        primary: 'h4.item-title a',
        fallbacks: ['h4 a', '.item-title', 'h3 a'],
        type: 'text',
      },
      price: {
        primary: 'span.item-price',
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency: 'EUR',
      },
      image: {
        primary: 'img.wp-post-image',
        fallbacks: ['img[class*="attachment"]', 'img'],
        type: 'url',
      },
      bedrooms: {
        primary: 'li.houzez-beds strong',
        fallbacks: ['[class*="houzez-bed"]', '[class*="beds"]'],
        type: 'number',
      },
      area: {
        primary: 'li.houzez-property-size strong',
        fallbacks: ['[class*="houzez-size"]', '[class*="area"]'],
        type: 'number',
        unit: 'sqm',
      },
    },
    dataExtractors: {
      price: {
        primary: 'span.item-price',
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency: 'EUR',
      },
      bedrooms: {
        primary: 'li.houzez-beds strong',
        fallbacks: ['[class*="beds"]'],
        type: 'number',
      },
      area_sqm: {
        primary: 'li.houzez-property-size strong',
        fallbacks: ['[class*="area"]'],
        type: 'number',
        unit: 'sqm',
      },
    },
  },

  // RealHomes Ultra — semantic article elements.
  {
    name: 'realhomes',
    cardSelector: 'article.property',
    confidence: 0.88,
    cardFieldMappings: {
      headline: {
        primary: 'h3.rh_prop_card__title a',
        fallbacks: ['h3 a', '.property-title', 'h2 a'],
        type: 'text',
      },
      price: {
        primary: 'span.rh_prop_card__price',
        fallbacks: ['[class*="rh_prop_card__price"]', '[class*="price"]'],
        type: 'currency',
        currency: 'EUR',
      },
      image: {
        primary: 'img.rh_prop_card__image',
        fallbacks: ['img[class*="prop-img"]', 'img'],
        type: 'url',
      },
      bedrooms: {
        primary: 'li.rh_prop_card__meta_beds span',
        fallbacks: ['[class*="beds"]'],
        type: 'number',
      },
      area: {
        primary: 'li.rh_prop_card__meta_area span',
        fallbacks: ['[class*="area"]'],
        type: 'number',
        unit: 'sqm',
      },
    },
    dataExtractors: {
      price: {
        primary: 'span.rh_prop_card__price',
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency: 'EUR',
      },
      bedrooms: {
        primary: 'li.rh_prop_card__meta_beds span',
        fallbacks: ['[class*="beds"]'],
        type: 'number',
      },
      area_sqm: {
        primary: 'li.rh_prop_card__meta_area span',
        fallbacks: ['[class*="area"]'],
        type: 'number',
        unit: 'sqm',
      },
    },
  },

  // WP Residence / EstateEngine.
  {
    name: 'wp_residence',
    cardSelector: 'article.property-item',
    confidence: 0.88,
    cardFieldMappings: {
      headline: {
        primary: 'h5.title_listing a',
        fallbacks: ['h5 a', '.property-title', 'h4 a'],
        type: 'text',
      },
      price: {
        primary: 'div.listing_unit_price_wrapper span',
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency: 'EUR',
      },
      image: {
        primary: 'img.wp-post-image',
        fallbacks: ['img'],
        type: 'url',
      },
      bedrooms: {
        primary: 'div.listing_unit_value[data-type="bedrooms"]',
        fallbacks: ['[class*="beds"]'],
        type: 'number',
      },
      area: {
        primary: 'div.listing_unit_value[data-type="sqft"]',
        fallbacks: ['[class*="area"]', '[class*="size"]'],
        type: 'number',
        unit: 'sqm',
      },
    },
    dataExtractors: {
      price: {
        primary: 'div.listing_unit_price_wrapper span',
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency: 'EUR',
      },
      bedrooms: {
        primary: 'div.listing_unit_value[data-type="bedrooms"]',
        fallbacks: ['[class*="beds"]'],
        type: 'number',
      },
      area_sqm: {
        primary: 'div.listing_unit_value[data-type="sqft"]',
        fallbacks: ['[class*="area"]'],
        type: 'number',
        unit: 'sqm',
      },
    },
  },
];

/** Generic WordPress fallback selectors to try when no theme is identified. */
const GENERIC_WP_SELECTORS = [
  'article.property',
  'div.property-item',
  'li.listing',
  'div.listing-item',
  'article.listing',
];

/**
 * Detect WordPress real estate portals and map to known theme selectors.
 *
 * Confidence: **0.90** (0.92 for Houzez, 0.88 for RealHomes/WP Residence, 0.80 generic).
 */
export function detectWordPress(html: string, url: string): Promise<DetectionResult | null> {
  return Promise.resolve(detectWordPressSync(html, url));
}

function detectWordPressSync(html: string, url: string): DetectionResult | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const warnings: string[] = [];

  if (!isWordPress(doc)) return null;

  warnings.push('WordPress detected');

  const domain = extractDomain(url);
  const urlObj = tryParseUrl(url);
  const indexPatterns = urlObj ? [`${urlObj.origin}/**`] : ['/**'];
  const detailPatterns = urlObj
    ? [`${urlObj.origin}/property/*`, `${urlObj.origin}/listing/*`]
    : ['/property/*'];

  // Identify which theme is active.
  const theme = detectTheme(doc);
  if (theme) warnings.push(`WordPress theme detected: ${theme}`);

  // Look up theme spec.
  const themeSpec = theme ? THEME_SPECS.find((t) => t.name === theme) : null;

  if (themeSpec) {
    const cards = doc.querySelectorAll(themeSpec.cardSelector);
    if (cards.length >= MIN_CARD_COUNT) {
      const schema = buildSchema(
        domain,
        indexPatterns,
        detailPatterns,
        themeSpec.cardSelector,
        themeSpec.cardFieldMappings,
        themeSpec.dataExtractors,
        cards.length,
        themeSpec.confidence,
        cards[0] ?? null,
      );
      return {
        schema,
        confidence: themeSpec.confidence,
        technique: 'wordpress',
        warnings,
      };
    }
    warnings.push(
      `Theme ${String(theme)} detected but only ${String(doc.querySelectorAll(themeSpec.cardSelector).length)} cards matched '${themeSpec.cardSelector}'`,
    );
  }

  // Generic WordPress fallback — try known selectors in order.
  for (const selector of GENERIC_WP_SELECTORS) {
    const cards = doc.querySelectorAll(selector);
    if (cards.length >= MIN_CARD_COUNT) {
      warnings.push(`Generic WordPress selector used: ${selector}`);
      const currency = inferCurrency(domain);
      const { cardFieldMappings, dataExtractors } = buildGenericMappings(currency);
      const schema = buildSchema(
        domain,
        indexPatterns,
        detailPatterns,
        selector,
        cardFieldMappings,
        dataExtractors,
        cards.length,
        0.8,
        cards[0] ?? null,
      );
      return {
        schema,
        confidence: 0.8,
        technique: 'wordpress',
        warnings,
      };
    }
  }

  warnings.push('WordPress detected but no listing card pattern found');
  return null;
}

/**
 * Return true if the document appears to be a WordPress site.
 *
 * Signals checked (in priority order):
 *  1. `<meta name="generator" content="WordPress ...">` — most reliable
 *  2. `wp-content/themes/` or `wp-content/plugins/` in any src/href attribute
 *  3. `body.wp-custom-logo` or `body.wordpress` utility class
 *  4. Known WordPress real-estate theme body classes (houzez, real-homes, residence-page)
 *     — these are sufficient evidence of a WordPress install
 */
function isWordPress(doc: Document): boolean {
  const generator = doc.querySelector('meta[name="generator"]');
  if (generator?.getAttribute('content')?.toLowerCase().startsWith('wordpress')) return true;

  // Check for wp-content/themes/ in link or script hrefs.
  const links = doc.querySelectorAll('link[href], script[src]');
  for (const el of links) {
    const attr = el.getAttribute('href') ?? el.getAttribute('src') ?? '';
    if (attr.includes('wp-content/themes/') || attr.includes('wp-content/plugins/')) return true;
  }

  // Check body class for WordPress-specific utility classes.
  const body = doc.body;
  if (body.classList.contains('wp-custom-logo')) return true;
  if (body.classList.contains('wordpress')) return true;

  // Known WordPress real-estate theme body classes — these imply a WP install.
  if (body.classList.contains('houzez')) return true;
  if (body.classList.contains('real-homes')) return true;
  if (body.classList.contains('residence-page')) return true;

  return false;
}

/**
 * Identify the active WordPress real estate theme.
 *
 * Returns one of: `'houzez'`, `'realhomes'`, `'wp_residence'`, or `null`.
 */
function detectTheme(doc: Document): 'houzez' | 'realhomes' | 'wp_residence' | null {
  // Houzez detection.
  if (
    doc.body.classList.contains('houzez') ||
    doc.querySelector('div.houzez-card') !== null ||
    hasThemeLink(doc, 'houzez')
  ) {
    return 'houzez';
  }

  // RealHomes detection.
  if (
    doc.body.classList.contains('real-homes') ||
    doc.querySelector('div.property-item.rh_list_card') !== null ||
    hasThemeLink(doc, 'realhomes') ||
    hasThemeLink(doc, 'real-homes')
  ) {
    return 'realhomes';
  }

  // WP Residence / EstateEngine detection.
  if (
    doc.body.classList.contains('residence-page') ||
    doc.querySelector('div.property_listing') !== null ||
    hasThemeLink(doc, 'WpResidence') ||
    hasThemeLink(doc, 'wp-residence')
  ) {
    return 'wp_residence';
  }

  return null;
}

/** True when any link[href] contains the given theme name fragment. */
function hasThemeLink(doc: Document, themeFragment: string): boolean {
  for (const link of doc.querySelectorAll('link[href]')) {
    if (link.getAttribute('href')?.includes(themeFragment)) return true;
  }
  return false;
}

function buildGenericMappings(currency: 'EUR' | 'USD' | 'GBP' | 'PLN' | 'AED'): {
  cardFieldMappings: CardFieldMappings;
  dataExtractors: DataExtractorsPerCard;
} {
  const cardFieldMappings: CardFieldMappings = {
    headline: {
      primary: 'h2 a, h3 a, h4 a',
      fallbacks: ['h2', 'h3', '[class*="title"]'],
      type: 'text',
    },
    price: {
      primary: 'span[class*="price"], div[class*="price"]',
      fallbacks: ['[class*="Price"]'],
      type: 'currency',
      currency,
    },
    image: {
      primary: 'img.wp-post-image',
      fallbacks: ['img[class*="attachment"]', 'img'],
      type: 'url',
    },
    bedrooms: {
      primary: '[class*="beds"], [class*="bedrooms"]',
      fallbacks: ['[class*="room"]'],
      type: 'number',
    },
    area: {
      primary: '[class*="area"], [class*="size"]',
      fallbacks: [],
      type: 'number',
      unit: 'sqm',
    },
  };

  const dataExtractors: DataExtractorsPerCard = {
    price: {
      primary: 'span[class*="price"], div[class*="price"]',
      fallbacks: [],
      type: 'currency',
      currency,
    },
    bedrooms: {
      primary: '[class*="beds"]',
      fallbacks: ['[class*="room"]'],
      type: 'number',
    },
    area_sqm: {
      primary: '[class*="area"]',
      fallbacks: ['[class*="size"]'],
      type: 'number',
      unit: 'sqm',
    },
  };

  return { cardFieldMappings, dataExtractors };
}

function buildSchema(
  domain: string,
  indexPatterns: string[],
  detailPatterns: string[],
  cardSelector: string,
  cardFieldMappings: CardFieldMappings,
  dataExtractors: DataExtractorsPerCard,
  count: number,
  confidence: number,
  firstCard?: Element | null,
): TenantSiteSchema {
  const containerSelector = inferContainerSelector(firstCard ?? null);
  const slotSelectors: SlotSelectors = {
    headline: {
      primary: 'h1.entry-title, h1',
      fallbacks: ['[class*="title"]'],
      type: 'text',
    },
    description: {
      primary: 'div.entry-content, div[class*="description"]',
      fallbacks: ['[class*="desc"]', 'p'],
      type: 'text',
    },
    cta_primary: {
      primary: 'a[href*="contact"]',
      fallbacks: ['button[class*="contact"]', '.contact-btn'],
      type: 'text',
    },
  };

  return {
    tenant_id: 'pending',
    domain,
    detected_at: new Date().toISOString(),
    detection_source: 'wordpress',
    detection_confidence: confidence,
    framework_hint: 'wordpress',
    index_schema: {
      url_patterns: indexPatterns,
      listing_card_selector: cardSelector,
      listing_count_expected: count,
      card_field_mappings: cardFieldMappings,
      data_extractors_per_card: dataExtractors,
      reorder_capable: true,
      ...(containerSelector !== null ? { container_selector: containerSelector } : {}),
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
