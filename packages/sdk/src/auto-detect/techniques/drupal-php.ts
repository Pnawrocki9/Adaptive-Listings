/**
 * Technique 10 — Drupal / PHP classic portal detection (confidence 0.88)
 *
 * Two separate detection strategies in one file:
 *
 * Step 1 — Drupal BEM detection (confidence 0.90)
 *   Drupal uses extremely stable `field--name-*` BEM class conventions.
 *   Signals:
 *     - `<meta name="generator" content*="Drupal">`
 *     - `body[data-path]` attribute
 *     - At least 3 elements carrying `field--name-*` class pattern
 *   Selector: `div[class*="field--name-field-listing"]`
 *             or `article.node--type-listing`
 *
 * Step 2 — PHP classic portal detection (confidence 0.85)
 *   Common PHP portal patterns when Drupal is not detected:
 *     - `div.advert`        — Bazaraki (IMPORTANT: uses dot as thousands separator €335.000)
 *     - `article.js-list-item` — Habitaclia (deliberately stable js- prefix)
 *     - `div.listing-item`  — generic PHP portals
 *     - `div.property-item` — generic PHP portals
 *
 * IMPORTANT — Bazaraki price format:
 *   Bazaraki uses dot (.) as the thousands separator: `€335.000` means 335,000 EUR.
 *   When detected, a warning is added to `DetectionResult.warnings` and
 *   `price_format: 'dot_thousands'` is noted in the warning text.
 *   The price-parser utility (`utils/price-parser.ts`) handles this format.
 *
 * Platforms: Zyprus (Drupal), Bazaraki (PHP), Habitaclia (PHP).
 *
 * @module @estalara/sdk/auto-detect/techniques/drupal-php
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

/** Minimum number of Drupal field--name-* elements to confirm Drupal. */
const MIN_DRUPAL_FIELD_COUNT = 3;

// ---------------------------------------------------------------------------
// PHP classic portal specs
// ---------------------------------------------------------------------------

interface PhpSpec {
  /** Unique identifier for this PHP pattern. */
  id: string;
  /** CSS selector for the listing card. */
  cardSelector: string;
  /** Set to true when this portal uses dot as thousands separator in prices. */
  dotThousands: boolean;
  /** Currency used on this platform. */
  currency: 'EUR' | 'USD' | 'GBP' | 'PLN' | 'AED';
  cardFieldMappings: CardFieldMappings;
  dataExtractors: DataExtractorsPerCard;
}

const PHP_SPECS: PhpSpec[] = [
  // Bazaraki — Cyprus real estate / classifieds portal.
  // IMPORTANT: Uses dot as thousands separator: €335.000 = 335,000 EUR.
  {
    id: 'bazaraki',
    cardSelector: 'div.advert',
    dotThousands: true,
    currency: 'EUR',
    cardFieldMappings: {
      headline: {
        primary: 'a.advert-title',
        fallbacks: ['h3 a', '[class*="advert-title"]'],
        type: 'text',
      },
      price: {
        primary: 'div.advert-price',
        fallbacks: ['span.advert-price', '[class*="price"]'],
        type: 'currency',
        currency: 'EUR',
      },
      image: {
        primary: 'img.advert-image',
        fallbacks: ['img[class*="advert"]', 'img'],
        type: 'url',
      },
      bedrooms: {
        primary: 'span.advert-beds',
        fallbacks: ['[class*="beds"]'],
        type: 'number',
      },
      area: {
        primary: 'span.advert-area',
        fallbacks: ['[class*="area"]'],
        type: 'number',
        unit: 'sqm',
      },
    },
    dataExtractors: {
      price: {
        primary: 'div.advert-price',
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency: 'EUR',
      },
      bedrooms: {
        primary: 'span.advert-beds',
        fallbacks: [],
        type: 'number',
      },
      area_sqm: {
        primary: 'span.advert-area',
        fallbacks: [],
        type: 'number',
        unit: 'sqm',
      },
    },
  },

  // Habitaclia — deliberately stable js- prefix class names.
  {
    id: 'habitaclia',
    cardSelector: 'article.js-list-item',
    dotThousands: false,
    currency: 'EUR',
    cardFieldMappings: {
      headline: {
        primary: 'h3.list-item-title a',
        fallbacks: ['h3 a'],
        type: 'text',
      },
      price: {
        primary: 'span.item-price',
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency: 'EUR',
      },
      image: {
        primary: 'img.item-image',
        fallbacks: ['img'],
        type: 'url',
      },
      bedrooms: {
        primary: 'span.item-detail-char.room',
        fallbacks: ['[class*="room"]'],
        type: 'number',
      },
      area: {
        primary: 'span.item-detail-char.surface',
        fallbacks: ['[class*="area"]'],
        type: 'number',
        unit: 'sqm',
      },
    },
    dataExtractors: {
      price: {
        primary: 'span.item-price',
        fallbacks: [],
        type: 'currency',
        currency: 'EUR',
      },
      bedrooms: {
        primary: 'span.item-detail-char.room',
        fallbacks: [],
        type: 'number',
      },
      area_sqm: {
        primary: 'span.item-detail-char.surface',
        fallbacks: [],
        type: 'number',
        unit: 'sqm',
      },
    },
  },

  // Generic PHP listing-item.
  {
    id: 'generic_listing_item',
    cardSelector: 'div.listing-item',
    dotThousands: false,
    currency: 'EUR',
    cardFieldMappings: {
      headline: {
        primary: 'h3 a, h2 a',
        fallbacks: ['[class*="title"]'],
        type: 'text',
      },
      price: {
        primary: '[class*="price"]',
        fallbacks: ['[class*="Price"]'],
        type: 'currency',
        currency: 'EUR',
      },
      image: {
        primary: 'img',
        fallbacks: [],
        type: 'url',
      },
      bedrooms: {
        primary: '[class*="beds"], [class*="bedrooms"]',
        fallbacks: [],
        type: 'number',
      },
    },
    dataExtractors: {
      price: {
        primary: '[class*="price"]',
        fallbacks: [],
        type: 'currency',
        currency: 'EUR',
      },
      bedrooms: {
        primary: '[class*="beds"]',
        fallbacks: [],
        type: 'number',
      },
    },
  },

  // Generic PHP property-item.
  {
    id: 'generic_property_item',
    cardSelector: 'div.property-item',
    dotThousands: false,
    currency: 'EUR',
    cardFieldMappings: {
      headline: {
        primary: 'h3 a, h2 a',
        fallbacks: ['[class*="title"]'],
        type: 'text',
      },
      price: {
        primary: '[class*="price"]',
        fallbacks: [],
        type: 'currency',
        currency: 'EUR',
      },
      image: {
        primary: 'img',
        fallbacks: [],
        type: 'url',
      },
      bedrooms: {
        primary: '[class*="beds"]',
        fallbacks: [],
        type: 'number',
      },
    },
    dataExtractors: {
      price: {
        primary: '[class*="price"]',
        fallbacks: [],
        type: 'currency',
        currency: 'EUR',
      },
      bedrooms: {
        primary: '[class*="beds"]',
        fallbacks: [],
        type: 'number',
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect Drupal and PHP classic real estate portals.
 *
 * Confidence: **0.88** (0.90 for confirmed Drupal, 0.85 for PHP classic).
 */
export function detectDrupalPhp(html: string, url: string): Promise<DetectionResult | null> {
  return Promise.resolve(detectDrupalPhpSync(html, url));
}

function detectDrupalPhpSync(html: string, url: string): DetectionResult | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const warnings: string[] = [];

  const domain = extractDomain(url);
  const urlObj = tryParseUrl(url);
  const indexPatterns = urlObj ? [`${urlObj.origin}/**`] : ['/**'];
  const detailPatterns = urlObj
    ? [`${urlObj.origin}/node/*`, `${urlObj.origin}/property/*`, `${urlObj.origin}/listing/*`]
    : ['/property/*'];

  // ── Step 1: Drupal detection ─────────────────────────────────────────────

  if (isDrupal(doc)) {
    warnings.push('Drupal CMS detected');
    const drupalResult = tryDrupalSchema(doc, domain, indexPatterns, detailPatterns, warnings);
    if (drupalResult) return drupalResult;
  }

  // ── Step 2: PHP classic portal detection ────────────────────────────────

  for (const spec of PHP_SPECS) {
    const cards = doc.querySelectorAll(spec.cardSelector);
    if (cards.length < MIN_CARD_COUNT) continue;

    if (spec.dotThousands) {
      warnings.push(
        `PHP portal using dot as thousands separator detected (price_format: dot_thousands). ` +
          `Example: €335.000 = 335,000 EUR. Use price-parser.ts to handle this format.`,
      );
    }

    const schema = buildSchema(
      domain,
      indexPatterns,
      detailPatterns,
      spec.cardSelector,
      spec.cardFieldMappings,
      spec.dataExtractors,
      cards.length,
      0.85,
      'php_classic',
      'php',
      cards[0] ?? null,
    );

    return {
      schema,
      confidence: 0.85,
      technique: 'php_classic',
      warnings,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Drupal helpers
// ---------------------------------------------------------------------------

/**
 * Return true if the document appears to be a Drupal site.
 *
 * Signals:
 *  1. `<meta name="generator" content*="Drupal">`
 *  2. `body[data-path]` attribute (Drupal 9+ adds this)
 *  3. At least MIN_DRUPAL_FIELD_COUNT elements carrying `field--name-*` class
 */
function isDrupal(doc: Document): boolean {
  const generator = doc.querySelector('meta[name="generator"]');
  if (generator?.getAttribute('content')?.toLowerCase().includes('drupal')) return true;

  if (doc.body.hasAttribute('data-path')) return true;

  // Count field--name-* elements.
  let fieldCount = 0;
  for (const el of doc.querySelectorAll('[class]')) {
    for (const cls of el.classList) {
      if (cls.startsWith('field--name-')) {
        fieldCount++;
        if (fieldCount >= MIN_DRUPAL_FIELD_COUNT) return true;
      }
    }
  }

  return false;
}

/**
 * Attempt to build a Drupal-specific schema.
 *
 * Preference order:
 *  1. `div[class*="field--name-field-listing"]`  (Zyprus-style)
 *  2. `article.node--type-listing`
 *  3. `article.node--type-property`
 *  4. Generic `div[class*="field--name-"]` repeated >= MIN_CARD_COUNT
 */
function tryDrupalSchema(
  doc: Document,
  domain: string,
  indexPatterns: string[],
  detailPatterns: string[],
  warnings: string[],
): DetectionResult | null {
  const currency = inferCurrency(domain);

  const drupalSelectors = [
    `div[class*="field--name-field-listing"]`,
    `article.node--type-listing`,
    `article.node--type-property`,
    `article[class*="node--type-"]`,
  ];

  for (const selector of drupalSelectors) {
    const cards = doc.querySelectorAll(selector);
    if (cards.length < MIN_CARD_COUNT) continue;

    const cardFieldMappings: CardFieldMappings = {
      headline: {
        primary: 'div.field--name-title a, h2.node-title a',
        fallbacks: ['h2 a', 'h3 a', '[class*="field--name-title"]'],
        type: 'text',
      },
      price: {
        primary: 'div.field--name-field-price span',
        fallbacks: ['[class*="field--name-field-price"]', '[class*="price"]'],
        type: 'currency',
        currency,
      },
      image: {
        primary: 'img.field__item',
        fallbacks: ['img[class*="field"]', 'img'],
        type: 'url',
      },
      bedrooms: {
        primary: 'div.field--name-field-bedrooms span',
        fallbacks: ['[class*="field--name-field-bedroom"]'],
        type: 'number',
      },
      area: {
        primary: 'div.field--name-field-area span',
        fallbacks: ['[class*="field--name-field-area"]'],
        type: 'number',
        unit: 'sqm',
      },
    };

    const dataExtractors: DataExtractorsPerCard = {
      price: {
        primary: 'div.field--name-field-price span',
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency,
      },
      bedrooms: {
        primary: 'div.field--name-field-bedrooms span',
        fallbacks: [],
        type: 'number',
      },
      area_sqm: {
        primary: 'div.field--name-field-area span',
        fallbacks: [],
        type: 'number',
        unit: 'sqm',
      },
    };

    warnings.push(`Drupal listing selector: ${selector}`);

    const schema = buildSchema(
      domain,
      indexPatterns,
      detailPatterns,
      selector,
      cardFieldMappings,
      dataExtractors,
      cards.length,
      0.9,
      'drupal',
      'drupal',
      cards[0] ?? null,
    );

    return {
      schema,
      confidence: 0.9,
      technique: 'drupal',
      warnings,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function buildSchema(
  domain: string,
  indexPatterns: string[],
  detailPatterns: string[],
  cardSelector: string,
  cardFieldMappings: CardFieldMappings,
  dataExtractors: DataExtractorsPerCard,
  count: number,
  confidence: number,
  detectionSource: 'drupal' | 'php_classic',
  frameworkHint: 'drupal' | 'php',
  firstCard?: Element | null,
): TenantSiteSchema {
  const containerSelector = inferContainerSelector(firstCard ?? null);
  const slotSelectors: SlotSelectors = {
    headline: {
      primary: 'h1',
      fallbacks: ['[class*="title"]', '[class*="field--name-title"]'],
      type: 'text',
    },
    description: {
      primary: 'div.field--name-body, div[class*="description"]',
      fallbacks: ['[class*="desc"]', 'p'],
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
    detection_source: detectionSource,
    detection_confidence: confidence,
    framework_hint: frameworkHint,
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
