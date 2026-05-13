/**
 * Technique 6 — CSS Modules class prefix patterns (confidence 0.82)
 *
 * Detects portals that use CSS Modules by scanning for the characteristic
 * `ComponentName_localName__hash` class pattern. Selectors are always written
 * as partial-match `[class*='Prefix']` — never as the full hashed class name.
 *
 * CRITICAL: The full hash (e.g. `PropertyCard_propertyCard__x3f9a`) changes on
 * every deploy and must never appear in a stored selector. Always use the stable
 * prefix form: `[class*='PropertyCard_']`.
 *
 * Platforms: Rightmove (PropertyCard_), Redfin/Zillow (HomeCard_), generic.
 *
 * @module @estalara/sdk/auto-detect/techniques/css-modules
 */

import type {
  TenantSiteSchema,
  CardFieldMappings,
  DataExtractorsPerCard,
  SlotSelectors,
} from '@estalara/shared';
import type { DetectionResult } from '../pipeline.js';
import { inferContainerSelector } from '../utils/container.js';

/**
 * CSS Modules class pattern:
 *   ComponentName _ localIdentifier __ hash
 * e.g. `PropertyCard_propertyCard__x3f9a`
 */
const CSS_MODULES_RE = /^[A-Z][a-zA-Z]+_[a-zA-Z]+__[a-zA-Z0-9]{4,8}$/;

/** Known stable CSS Modules prefix patterns in priority order. */
const KNOWN_PREFIXES: {
  prefix: string;
  cardFieldMappings: CardFieldMappings;
  dataExtractors: DataExtractorsPerCard;
  framework?: TenantSiteSchema['framework_hint'];
}[] = [
  // Rightmove — PropertyCard_
  {
    prefix: 'PropertyCard_',
    cardFieldMappings: {
      headline: {
        primary: "h2[class*='PropertyCard_']",
        fallbacks: ['h2', '[class*="propertyCard-title"]'],
        partial_match: 'PropertyCard_',
        type: 'text',
      },
      price: {
        primary: "[class*='PropertyCard_price']",
        fallbacks: ["[data-testid='price'] span", '[class*="price"]'],
        partial_match: 'PropertyCard_price',
        type: 'currency',
        currency: 'GBP',
      },
      image: {
        primary: "img[class*='PropertyCard_']",
        fallbacks: ['img'],
        partial_match: 'PropertyCard_',
        type: 'url',
      },
      bedrooms: {
        primary: "[class*='PropertyCard_beds']",
        fallbacks: ["span[data-testid='beds']"],
        partial_match: 'PropertyCard_beds',
        type: 'number',
      },
    },
    dataExtractors: {
      price: {
        primary: "[class*='PropertyCard_price']",
        fallbacks: ["[data-testid='price'] span"],
        partial_match: 'PropertyCard_price',
        type: 'currency',
        currency: 'GBP',
      },
      bedrooms: {
        primary: "[class*='PropertyCard_beds']",
        fallbacks: ["span[data-testid='beds']"],
        partial_match: 'PropertyCard_beds',
        type: 'number',
      },
      area_sqm: {
        primary: "[class*='PropertyCard_size']",
        fallbacks: ["span[data-testid='size']"],
        partial_match: 'PropertyCard_size',
        type: 'number',
        unit: 'sqft',
      },
    },
    framework: 'react',
  },

  // Redfin / Zillow — HomeCard_
  {
    prefix: 'HomeCard_',
    cardFieldMappings: {
      headline: {
        primary: "[class*='homeAddress']",
        fallbacks: ['[class*="HomeCard_address"]', 'address'],
        partial_match: 'homeAddress',
        type: 'text',
      },
      price: {
        primary: "[class*='homecardV2Price']",
        fallbacks: ['[class*="HomeCard_price"]', '[class*="price"]'],
        partial_match: 'homecardV2Price',
        type: 'currency',
        currency: 'USD',
      },
      image: {
        primary: "[class*='homeImage']",
        fallbacks: ['img[class*="HomeCard"]', 'img'],
        partial_match: 'homeImage',
        type: 'url',
      },
      bedrooms: {
        primary: "[class*='beds']",
        fallbacks: ['[class*="HomeCard_beds"]'],
        partial_match: 'beds',
        type: 'number',
      },
      area: {
        primary: "[class*='sqft']",
        fallbacks: ['[class*="HomeCard_sqft"]'],
        partial_match: 'sqft',
        type: 'number',
        unit: 'sqft',
      },
    },
    dataExtractors: {
      price: {
        primary: "[class*='homecardV2Price']",
        fallbacks: ['[class*="price"]'],
        partial_match: 'homecardV2Price',
        type: 'currency',
        currency: 'USD',
      },
      bedrooms: {
        primary: "[class*='beds']",
        fallbacks: [],
        partial_match: 'beds',
        type: 'number',
      },
      area_sqm: {
        primary: "[class*='sqft']",
        fallbacks: [],
        partial_match: 'sqft',
        type: 'number',
        unit: 'sqft',
      },
    },
    framework: 'nextjs',
  },

  // Generic CSS Modules portal — Listings_
  {
    prefix: 'Listings_',
    cardFieldMappings: {
      headline: {
        primary: "[class*='Listings_title']",
        fallbacks: ['h2', 'h3'],
        partial_match: 'Listings_title',
        type: 'text',
      },
      price: {
        primary: "[class*='Listings_price']",
        fallbacks: ['[class*="price"]'],
        partial_match: 'Listings_price',
        type: 'currency',
        currency: 'EUR',
      },
      image: {
        primary: "[class*='Listings_image']",
        fallbacks: ['img'],
        partial_match: 'Listings_image',
        type: 'url',
      },
      bedrooms: {
        primary: "[class*='Listings_beds']",
        fallbacks: ['[class*="beds"]'],
        partial_match: 'Listings_beds',
        type: 'number',
      },
    },
    dataExtractors: {
      price: {
        primary: "[class*='Listings_price']",
        fallbacks: [],
        partial_match: 'Listings_price',
        type: 'currency',
        currency: 'EUR',
      },
      bedrooms: {
        primary: "[class*='Listings_beds']",
        fallbacks: [],
        partial_match: 'Listings_beds',
        type: 'number',
      },
    },
  },

  // Generic listing-card_ (lowercase CSS Modules variant)
  {
    prefix: 'listing-card_',
    cardFieldMappings: {
      headline: {
        primary: "[class*='listing-card_title']",
        fallbacks: ['h2', 'h3'],
        partial_match: 'listing-card_title',
        type: 'text',
      },
      price: {
        primary: "[class*='listing-card_price']",
        fallbacks: ['[class*="price"]'],
        partial_match: 'listing-card_price',
        type: 'currency',
        currency: 'EUR',
      },
      image: {
        primary: "[class*='listing-card_image']",
        fallbacks: ['img'],
        partial_match: 'listing-card_image',
        type: 'url',
      },
      bedrooms: {
        primary: "[class*='listing-card_beds']",
        fallbacks: ['[class*="beds"]'],
        partial_match: 'listing-card_beds',
        type: 'number',
      },
    },
    dataExtractors: {
      price: {
        primary: "[class*='listing-card_price']",
        fallbacks: [],
        partial_match: 'listing-card_price',
        type: 'currency',
        currency: 'EUR',
      },
      bedrooms: {
        primary: "[class*='listing-card_beds']",
        fallbacks: [],
        partial_match: 'listing-card_beds',
        type: 'number',
      },
    },
  },
];

/** Minimum card count to accept the technique. */
const MIN_CARD_COUNT = 2;

/**
 * Detect CSS Modules portals by scanning class attributes for the
 * `ComponentName_localName__hash` pattern.
 *
 * Confidence: **0.82**
 *
 * CRITICAL: Selectors stored in `SelectorStrategy.partial_match` and the
 * `primary` selector always use `[class*='Prefix']` form — never the full
 * hashed class name.
 */
export function detectCssModules(html: string, url: string): Promise<DetectionResult | null> {
  return Promise.resolve(detectCssModulesSync(html, url));
}

function detectCssModulesSync(html: string, url: string): DetectionResult | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const warnings: string[] = [];

  // Collect all CSS-Modules class tokens from the document.
  const cssModulesPrefixes = new Set<string>();
  for (const el of doc.querySelectorAll('[class]')) {
    for (const cls of el.classList) {
      if (CSS_MODULES_RE.test(cls)) {
        // Extract prefix: everything before the first __ (the hash separator).
        const doubleUnderscoreIdx = cls.lastIndexOf('__');
        if (doubleUnderscoreIdx > 0) {
          const prefix = cls.slice(0, cls.indexOf('_') + 1);
          if (prefix) cssModulesPrefixes.add(prefix);
        }
      }
    }
  }

  if (cssModulesPrefixes.size === 0) {
    return null;
  }

  const domain = extractDomain(url);
  const urlObj = tryParseUrl(url);
  const indexPatterns = urlObj ? [`${urlObj.origin}/**`] : ['/**'];
  const detailPatterns = urlObj
    ? [`${urlObj.origin}/property/*`, `${urlObj.origin}/listing/*`]
    : ['/property/*'];

  // Try known prefix patterns first.
  for (const known of KNOWN_PREFIXES) {
    if (!cssModulesPrefixes.has(known.prefix)) continue;

    // Derive the card selector.
    const cardSelector = deriveCardSelector(doc, known.prefix);
    if (!cardSelector) {
      warnings.push(`Prefix ${known.prefix} found but could not derive card selector`);
      continue;
    }

    const cards = doc.querySelectorAll(cardSelector);
    if (cards.length < MIN_CARD_COUNT) {
      warnings.push(
        `Prefix ${known.prefix}: only ${String(cards.length)} cards matched '${cardSelector}'`,
      );
      continue;
    }

    const schema: TenantSiteSchema = {
      tenant_id: 'pending',
      domain,
      detected_at: new Date().toISOString(),
      detection_source: 'css_modules',
      detection_confidence: 0.82,
      index_schema: {
        url_patterns: indexPatterns,
        listing_card_selector: cardSelector,
        listing_count_expected: cards.length,
        card_field_mappings: known.cardFieldMappings,
        data_extractors_per_card: known.dataExtractors,
        // CSS modules selectors may drift on redeploy — disable reorder.
        reorder_capable: false,
        ...(() => {
          const cs = inferContainerSelector(cards[0] ?? null);
          return cs !== null ? { container_selector: cs } : {};
        })(),
      },
      detail_schema: {
        url_patterns: detailPatterns,
        slot_selectors: buildDetailSlots(known.prefix),
        data_extractors: {},
      },
      archetype_hints: [],
    };
    if (known.framework) schema.framework_hint = known.framework;

    return {
      schema,
      confidence: 0.82,
      technique: 'css_modules',
      warnings,
    };
  }

  // Unknown CSS Modules portal — try to find any card-like element with the prefix.
  for (const prefix of cssModulesPrefixes) {
    const cardSelector = deriveCardSelector(doc, prefix);
    if (!cardSelector) continue;

    const cards = doc.querySelectorAll(cardSelector);
    if (cards.length < MIN_CARD_COUNT) continue;

    warnings.push(`Unknown CSS Modules prefix '${prefix}' — generic schema generated`);

    const currency = inferCurrency(domain);
    const cardFieldMappings: CardFieldMappings = {
      headline: {
        primary: `[class*='${prefix}title'], [class*='${prefix}Title']`,
        fallbacks: ['h2', 'h3'],
        partial_match: `${prefix}title`,
        type: 'text',
      },
      price: {
        primary: `[class*='${prefix}price'], [class*='${prefix}Price']`,
        fallbacks: ['[class*="price"]'],
        partial_match: `${prefix}price`,
        type: 'currency',
        currency,
      },
      image: {
        primary: 'img',
        fallbacks: [],
        type: 'url',
      },
      bedrooms: {
        primary: `[class*='${prefix}beds'], [class*='${prefix}Beds']`,
        fallbacks: ['[class*="bed"]'],
        partial_match: `${prefix}beds`,
        type: 'number',
      },
    };

    const dataExtractors: DataExtractorsPerCard = {
      price: {
        primary: `[class*='${prefix}price'], [class*='${prefix}Price']`,
        fallbacks: [],
        partial_match: `${prefix}price`,
        type: 'currency',
        currency,
      },
      bedrooms: {
        primary: `[class*='${prefix}beds'], [class*='${prefix}Beds']`,
        fallbacks: [],
        partial_match: `${prefix}beds`,
        type: 'number',
      },
    };

    const schema: TenantSiteSchema = {
      tenant_id: 'pending',
      domain,
      detected_at: new Date().toISOString(),
      detection_source: 'css_modules',
      detection_confidence: 0.82,
      index_schema: {
        url_patterns: indexPatterns,
        listing_card_selector: cardSelector,
        listing_count_expected: cards.length,
        card_field_mappings: cardFieldMappings,
        data_extractors_per_card: dataExtractors,
        reorder_capable: false,
        ...(() => {
          const cs = inferContainerSelector(cards[0] ?? null);
          return cs !== null ? { container_selector: cs } : {};
        })(),
      },
      detail_schema: {
        url_patterns: detailPatterns,
        slot_selectors: buildDetailSlots(prefix),
        data_extractors: {},
      },
      archetype_hints: [],
    };

    return {
      schema,
      confidence: 0.82,
      technique: 'css_modules',
      warnings,
    };
  }

  return null;
}

/**
 * Derive a `[class*='Prefix']` card selector from the document.
 *
 * Looks for elements with a class matching the given prefix. Prefers elements
 * that contain both a price and an image (qualifying card), falling back to
 * any element with the prefix.
 *
 * CRITICAL: The returned selector always uses the `[class*='Prefix']` form.
 * The full hashed class name is never included.
 */
function deriveCardSelector(doc: Document, prefix: string): string | null {
  const prefixLower = prefix.toLowerCase();

  // Find a qualifying card element.
  for (const el of doc.querySelectorAll(`[class*='${prefix}']`)) {
    const classStr = [...el.classList].join(' ');
    if (!classStr.toLowerCase().includes(prefixLower)) continue;

    // Use the component-name portion of the prefix for a stable partial selector.
    // prefix is like "PropertyCard_" — strip trailing underscore.
    const componentName = prefix.endsWith('_') ? prefix.slice(0, -1) : prefix;
    const tag = el.tagName.toLowerCase();

    // Prefer semantically named card classes.
    const cardLike = [...el.classList].find(
      (c) =>
        c.startsWith(prefix) && /card|item|listing|property|result/i.test(c.slice(prefix.length)),
    );
    if (cardLike) {
      // Use the component prefix only — not the full hash.
      return `${tag}[class*='${prefix}']`;
    }

    // Fallback: use the component name prefix.
    return `[class*='${componentName}']`;
  }

  return null;
}

function buildDetailSlots(prefix: string): SlotSelectors {
  return {
    headline: {
      primary: `[class*='${prefix}title'], h1`,
      fallbacks: ['h1', '[class*="title"]'],
      partial_match: `${prefix}title`,
      type: 'text',
    },
    description: {
      primary: `[class*='${prefix}description'], [class*='${prefix}desc']`,
      fallbacks: ['[class*="description"]', 'p'],
      partial_match: `${prefix}description`,
      type: 'text',
    },
    cta_primary: {
      primary: `[class*='${prefix}cta'], [class*='${prefix}button']`,
      fallbacks: ['a[href*="contact"]', 'button'],
      partial_match: `${prefix}cta`,
      type: 'text',
    },
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
