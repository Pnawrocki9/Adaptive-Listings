/**
 * Technique 3 — data-testid / data-cy attribute patterns (confidence 0.92)
 *
 * Detects portals that use `data-cy` or `data-testid` attributes as stable DOM
 * anchors for their listing cards. These test-automation attributes are intentionally
 * kept stable across deploys — making them excellent selectors.
 *
 * Priority order within this technique:
 *  1. data-cy="l-card"                   → Otodom / OLX
 *  2. data-testid="propertyCard"         → Rightmove
 *  3. data-testid="property-card"        → generic Rightmove variant
 *  4. data-testid="listing-container"    → Zoopla
 *  5. data-testid="listing-card-content" → Zoopla variant
 *  6. data-cy="listing-item"             → Bayut
 *  7. data-testid="property-card"        → Zillow / generic
 *  8. data-testid="l-card"               → OLX variant
 *
 * @module @estalara/sdk/auto-detect/techniques/data-attributes
 */

import type {
  TenantSiteSchema,
  CardFieldMappings,
  DataExtractorsPerCard,
  SlotSelectors,
} from '@estalara/shared';
import type { DetectionResult } from '../pipeline.js';

interface PatternSpec {
  selector: string;
  source: 'data_cy' | 'data_testid';
  cardFieldMappings: CardFieldMappings;
  dataExtractors: DataExtractorsPerCard;
}

/** Ordered list of known data-attribute patterns, most specific first. */
const PATTERNS: PatternSpec[] = [
  // Otodom / OLX — data-cy="l-card"
  {
    selector: "[data-cy='l-card']",
    source: 'data_cy',
    cardFieldMappings: {
      headline: {
        primary: "h3[data-cy='listing-item-title']",
        fallbacks: ['h3', '[data-cy*="title"]'],
        type: 'text',
      },
      price: {
        primary: "[data-cy='ad-price']",
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency: 'PLN',
      },
      image: {
        primary: "img[data-cy='listing-item-thumb']",
        fallbacks: ['img[src*="media"]', 'img'],
        type: 'url',
      },
      bedrooms: {
        primary: "[data-testid='rooms-value']",
        fallbacks: ['[class*="rooms"]'],
        type: 'number',
      },
      area: {
        primary: "[data-testid='area-value']",
        fallbacks: ['[class*="area"]'],
        type: 'number',
        unit: 'sqm',
      },
    },
    dataExtractors: {
      price: {
        primary: "[data-cy='ad-price']",
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency: 'PLN',
      },
      bedrooms: {
        primary: "[data-testid='rooms-value']",
        fallbacks: ['[class*="rooms"]'],
        type: 'number',
      },
      area_sqm: {
        primary: "[data-testid='area-value']",
        fallbacks: ['[class*="area"]'],
        type: 'number',
        unit: 'sqm',
      },
    },
  },

  // Zoopla — data-testid="listing-container"
  {
    selector: "[data-testid='listing-container']",
    source: 'data_testid',
    cardFieldMappings: {
      headline: {
        primary: "h2[data-testid='listing-title']",
        fallbacks: ['h2', '[data-testid*="title"]'],
        type: 'text',
      },
      price: {
        primary: "p[data-testid='listing-price']",
        fallbacks: ['[data-testid*="price"]', '[class*="price"]'],
        type: 'currency',
        currency: 'GBP',
      },
      image: {
        primary: "img[data-testid='listing-photo']",
        fallbacks: ['img[src*="listing"]', 'img'],
        type: 'url',
      },
      bedrooms: {
        primary: "span[data-testid='beds-label']",
        fallbacks: ['[data-testid*="bed"]'],
        type: 'number',
      },
      area: {
        primary: "span[data-testid='floor-area']",
        fallbacks: ['[data-testid*="area"]'],
        type: 'number',
        unit: 'sqft',
      },
    },
    dataExtractors: {
      price: {
        primary: "p[data-testid='listing-price']",
        fallbacks: ['[data-testid*="price"]'],
        type: 'currency',
        currency: 'GBP',
      },
      bedrooms: {
        primary: "span[data-testid='beds-label']",
        fallbacks: ['[data-testid*="bed"]'],
        type: 'number',
      },
      area_sqm: {
        primary: "span[data-testid='floor-area']",
        fallbacks: ['[data-testid*="area"]'],
        type: 'number',
        unit: 'sqft',
      },
    },
  },

  // Zoopla variant — data-testid="listing-card-content"
  {
    selector: "[data-testid='listing-card-content']",
    source: 'data_testid',
    cardFieldMappings: {
      headline: {
        primary: "h2[data-testid='listing-title']",
        fallbacks: ['h2'],
        type: 'text',
      },
      price: {
        primary: "[data-testid='listing-price']",
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency: 'GBP',
      },
      image: {
        primary: "img[data-testid='listing-photo']",
        fallbacks: ['img'],
        type: 'url',
      },
      bedrooms: {
        primary: "span[data-testid='beds-label']",
        fallbacks: ['[data-testid*="bed"]'],
        type: 'number',
      },
    },
    dataExtractors: {
      price: {
        primary: "[data-testid='listing-price']",
        fallbacks: [],
        type: 'currency',
        currency: 'GBP',
      },
      bedrooms: {
        primary: "span[data-testid='beds-label']",
        fallbacks: [],
        type: 'number',
      },
    },
  },

  // Rightmove — data-testid="propertyCard"
  {
    selector: "[data-testid='propertyCard']",
    source: 'data_testid',
    cardFieldMappings: {
      headline: {
        primary: 'h2.propertyCard-title a',
        fallbacks: ['h2 a', '[data-testid*="title"]'],
        type: 'text',
      },
      price: {
        primary: "div[data-testid='price'] span",
        fallbacks: ["span[data-testid='price']", '[class*="price"]'],
        type: 'currency',
        currency: 'GBP',
      },
      image: {
        primary: 'img.propertyCard-img',
        fallbacks: ['img[src*="rightmove"]', 'img'],
        type: 'url',
      },
      bedrooms: {
        primary: "span[data-testid='beds']",
        fallbacks: ['[data-testid*="bed"]'],
        type: 'number',
      },
      area: {
        primary: "span[data-testid='size']",
        fallbacks: ['[data-testid*="area"]', '[data-testid*="size"]'],
        type: 'number',
        unit: 'sqft',
      },
    },
    dataExtractors: {
      price: {
        primary: "div[data-testid='price'] span",
        fallbacks: ["span[data-testid='price']"],
        type: 'currency',
        currency: 'GBP',
      },
      bedrooms: {
        primary: "span[data-testid='beds']",
        fallbacks: [],
        type: 'number',
      },
      area_sqm: {
        primary: "span[data-testid='size']",
        fallbacks: [],
        type: 'number',
        unit: 'sqft',
      },
    },
  },

  // Generic property-card — Rightmove variant / generic portals
  {
    selector: "[data-testid='property-card']",
    source: 'data_testid',
    cardFieldMappings: {
      headline: {
        primary: '[data-testid*="address"]',
        fallbacks: ['h2', 'h3'],
        type: 'text',
      },
      price: {
        primary: "[data-testid='property-price']",
        fallbacks: ["span[data-testid='price']", '[class*="price"]'],
        type: 'currency',
        currency: 'GBP',
      },
      image: {
        primary: "[data-testid='property-image']",
        fallbacks: ['img'],
        type: 'url',
      },
      bedrooms: {
        primary: "[data-testid='beds-value']",
        fallbacks: ["[data-testid='beds']", '[data-testid*="bed"]'],
        type: 'number',
      },
      area: {
        primary: "[data-testid='size-value']",
        fallbacks: ["[data-testid='size']"],
        type: 'number',
        unit: 'sqft',
      },
    },
    dataExtractors: {
      price: {
        primary: "[data-testid='property-price']",
        fallbacks: ["span[data-testid='price']"],
        type: 'currency',
        currency: 'GBP',
      },
      bedrooms: {
        primary: "[data-testid='beds-value']",
        fallbacks: ["[data-testid='beds']"],
        type: 'number',
      },
      area_sqm: {
        primary: "[data-testid='size-value']",
        fallbacks: ["[data-testid='size']"],
        type: 'number',
        unit: 'sqft',
      },
    },
  },

  // Bayut — data-cy="listing-item"
  {
    selector: "[data-cy='listing-item']",
    source: 'data_cy',
    cardFieldMappings: {
      headline: {
        primary: 'h2[class*="title"]',
        fallbacks: ['h2', '[class*="title"]'],
        type: 'text',
      },
      price: {
        primary: 'span[class*="price"]',
        fallbacks: ['[class*="Price"]'],
        type: 'currency',
        currency: 'AED',
      },
      image: {
        primary: 'img[class*="ListingImage"]',
        fallbacks: ['img[class*="Image"]', 'img'],
        type: 'url',
      },
      bedrooms: {
        primary: 'span[aria-label*="Beds"]',
        fallbacks: ['[class*="beds"]'],
        type: 'number',
      },
      area: {
        primary: 'span[aria-label*="Area"]',
        fallbacks: ['[class*="area"]'],
        type: 'number',
        unit: 'sqft',
      },
    },
    dataExtractors: {
      price: {
        primary: 'span[class*="price"]',
        fallbacks: ['[class*="Price"]'],
        type: 'currency',
        currency: 'AED',
      },
      bedrooms: {
        primary: 'span[aria-label*="Beds"]',
        fallbacks: [],
        type: 'number',
      },
      area_sqm: {
        primary: 'span[aria-label*="Area"]',
        fallbacks: [],
        type: 'number',
        unit: 'sqft',
      },
    },
  },

  // Zillow / generic — data-testid="property-card" (duplicate handled by entry above,
  // this entry covers the Zillow-specific price selector variant).
  {
    selector: "[data-testid='l-card']",
    source: 'data_testid',
    cardFieldMappings: {
      headline: {
        primary: '[data-testid*="title"]',
        fallbacks: ['h3', 'h2'],
        type: 'text',
      },
      price: {
        primary: "[data-testid='price']",
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency: 'PLN',
      },
      image: {
        primary: 'img',
        fallbacks: [],
        type: 'url',
      },
      bedrooms: {
        primary: "[data-testid='rooms-value']",
        fallbacks: ['[class*="rooms"]'],
        type: 'number',
      },
    },
    dataExtractors: {
      price: {
        primary: "[data-testid='price']",
        fallbacks: [],
        type: 'currency',
        currency: 'PLN',
      },
      bedrooms: {
        primary: "[data-testid='rooms-value']",
        fallbacks: [],
        type: 'number',
      },
    },
  },
];

/** Minimum card count to consider a pattern a match (avoid detail pages). */
const MIN_CARD_COUNT = 2;

/**
 * Detect real estate sites via `data-cy` or `data-testid` attribute patterns.
 *
 * Confidence: **0.92**
 */
export function detectDataAttributes(html: string, url: string): Promise<DetectionResult | null> {
  return Promise.resolve(detectDataAttributesSync(html, url));
}

function detectDataAttributesSync(html: string, url: string): DetectionResult | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const warnings: string[] = [];

  for (const pattern of PATTERNS) {
    const cards = doc.querySelectorAll(pattern.selector);
    if (cards.length < MIN_CARD_COUNT) {
      continue;
    }

    const domain = extractDomain(url);
    const urlObj = tryParseUrl(url);
    const indexPatterns = urlObj ? [`${urlObj.origin}/**`] : ['/**'];
    const detailPatterns = urlObj
      ? [`${urlObj.origin}/property/*`, `${urlObj.origin}/listing/*`]
      : ['/property/*'];

    const slotSelectors: SlotSelectors = {
      headline: {
        primary: 'h1',
        fallbacks: ['[class*="title"]', '[class*="address"]'],
        type: 'text',
      },
      description: {
        primary: '[class*="description"]',
        fallbacks: ['p[class*="desc"]'],
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
      detection_source: pattern.source,
      detection_confidence: 0.92,
      index_schema: {
        url_patterns: indexPatterns,
        listing_card_selector: pattern.selector,
        listing_count_expected: cards.length,
        card_field_mappings: pattern.cardFieldMappings,
        data_extractors_per_card: pattern.dataExtractors,
        reorder_capable: true,
      },
      detail_schema: {
        url_patterns: detailPatterns,
        slot_selectors: slotSelectors,
        data_extractors: {},
      },
      archetype_hints: [],
    };

    if (cards.length < 5) {
      warnings.push(
        `Only ${String(cards.length)} cards matched — page may be a detail page or paginated list`,
      );
    }

    return {
      schema,
      confidence: 0.92,
      technique: pattern.source,
      warnings,
    };
  }

  return null;
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
