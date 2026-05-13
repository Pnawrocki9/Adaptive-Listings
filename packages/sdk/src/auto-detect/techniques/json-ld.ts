/**
 * Technique 2 — JSON-LD RealEstateListing detection (confidence 0.95)
 *
 * Parses `<script type="application/ld+json">` blocks looking for Schema.org types
 * that indicate real estate content. When found, extracts JSON-LD paths for price,
 * address, description, and image.
 *
 * @module @estalara/sdk/auto-detect/techniques/json-ld
 */

import type {
  TenantSiteSchema,
  CardFieldMappings,
  DataExtractorsPerCard,
  SelectorStrategy,
  SlotSelectors,
} from '@estalara/shared';
import type { DetectionResult } from '../pipeline.js';
import { inferContainerSelector } from '../utils/container.js';

/** Schema.org @type values that indicate real estate content. */
const REAL_ESTATE_TYPES = new Set([
  'RealEstateListing',
  'SingleFamilyResidence',
  'Apartment',
  'Residence',
  'House',
  'LandmarkedResidence',
  'ItemList',
]);

/** Parsed JSON-LD block (unknown shape). */
type JsonLdBlock = Record<string, unknown>;

/**
 * Detect real estate sites via JSON-LD structured data.
 *
 * Confidence: **0.95** — structured data is authoritative but may be incomplete.
 */
export function detectJsonLd(html: string, url: string): Promise<DetectionResult | null> {
  return Promise.resolve(detectJsonLdSync(html, url));
}

function detectJsonLdSync(html: string, url: string): DetectionResult | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const warnings: string[] = [];

  // Bail early: if og:type=product present but no JSON-LD, let other techniques handle it.
  const ogType = doc.querySelector('meta[property="og:type"]')?.getAttribute('content');
  if (ogType === 'product') {
    const ldScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    if (ldScripts.length === 0) {
      return null;
    }
  }

  const ldScripts = doc.querySelectorAll('script[type="application/ld+json"]');
  if (ldScripts.length === 0) {
    return null;
  }

  let matchedBlock: JsonLdBlock | null = null;
  let isItemList = false;
  let itemCount: number | undefined;

  for (const script of ldScripts) {
    let parsed: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- textContent is string|null per DOM spec
      parsed = JSON.parse(script.textContent ?? '');
    } catch {
      warnings.push('Failed to parse JSON-LD block — skipping');
      continue;
    }

    const block = parsed as JsonLdBlock;
    const rawType = block['@type'];
    const atType = typeof rawType === 'string' ? rawType : '';

    if (REAL_ESTATE_TYPES.has(atType)) {
      matchedBlock = block;
      if (atType === 'ItemList') {
        isItemList = true;
        const items = block.itemListElement;
        if (Array.isArray(items)) {
          itemCount = items.length;
        }
      }
      break;
    }
  }

  if (!matchedBlock) {
    return null;
  }

  const domain = extractDomain(url);
  const urlObj = tryParseUrl(url);
  const indexPatterns = urlObj ? [`${urlObj.origin}/**`] : ['/**'];
  const detailPatterns = urlObj
    ? [`${urlObj.origin}/property/*`, `${urlObj.origin}/listing/*`]
    : ['/property/*'];

  // Determine currency from JSON-LD offers if present.
  const offers = matchedBlock.offers as Record<string, unknown> | undefined;
  const priceCurrency = (offers?.priceCurrency as string | undefined) ?? 'EUR';
  const normalizedCurrency = normalizeCurrency(priceCurrency);

  // Build price selector — prefer offers.lowPrice for range listings.
  const priceJsonLdPath = offers?.lowPrice !== undefined ? 'offers.lowPrice' : 'offers.price';

  const priceStrategy: SelectorStrategy = {
    primary: 'span[itemprop="price"]',
    fallbacks: ['[class*="price"]', '[class*="Price"]'],
    json_ld_path: priceJsonLdPath,
    type: 'currency',
    currency: normalizedCurrency,
  };

  const addressStrategy: SelectorStrategy = {
    primary: '[itemprop="streetAddress"]',
    fallbacks: ['[itemprop="address"]', '[class*="address"]', '[class*="Address"]'],
    json_ld_path: 'address.streetAddress',
    type: 'text',
  };

  const descriptionStrategy: SelectorStrategy = {
    primary: '[itemprop="description"]',
    fallbacks: ['[class*="description"]', '[class*="Description"]'],
    json_ld_path: 'description',
    type: 'text',
  };

  const imageStrategy: SelectorStrategy = {
    primary: '[itemprop="image"]',
    fallbacks: ['img[src*="listing"]', 'img[src*="property"]'],
    json_ld_path: 'image',
    type: 'url',
  };

  const bedroomsStrategy: SelectorStrategy = {
    primary: '[itemprop="numberOfRooms"]',
    fallbacks: ['[class*="beds"]', '[class*="Beds"]', '[class*="bedroom"]', '[class*="rooms"]'],
    json_ld_path: 'numberOfRooms',
    type: 'number',
  };

  const areaStrategy: SelectorStrategy = {
    primary: '[itemprop="floorSize"]',
    fallbacks: ['[class*="area"]', '[class*="size"]', '[class*="sqm"]', '[class*="floor"]'],
    json_ld_path: 'floorSize.value',
    type: 'number',
    unit: 'sqm',
  };

  const cardFieldMappings: CardFieldMappings = {
    headline: addressStrategy,
    price: priceStrategy,
    image: imageStrategy,
    bedrooms: bedroomsStrategy,
    area: areaStrategy,
  };

  const dataExtractors: DataExtractorsPerCard = {
    price: priceStrategy,
    bedrooms: bedroomsStrategy,
    area_sqm: areaStrategy,
  };

  // For ItemList index pages, try to derive a listing card selector.
  let listingCardSelector = '[itemtype*="RealEstateListing"]';
  if (isItemList) {
    // ItemList items — try common list patterns.
    const listItemEl = doc.querySelector('li[itemtype], article[itemtype], div[itemtype]');
    if (listItemEl) {
      listingCardSelector = `${listItemEl.tagName.toLowerCase()}[itemtype]`;
    }
    warnings.push(
      `ItemList detected with ${itemCount !== undefined ? String(itemCount) : 'unknown'} items`,
    );
  }

  const slotSelectors: SlotSelectors = {
    headline: {
      primary: 'h1[itemprop="name"]',
      fallbacks: ['h1', '[class*="title"]'],
      json_ld_path: 'name',
      type: 'text',
    },
    description: {
      primary: descriptionStrategy.primary,
      fallbacks: descriptionStrategy.fallbacks,
      json_ld_path: 'description',
      type: 'text',
    },
    cta_primary: {
      primary: 'a[href*="contact"]',
      fallbacks: ['button[class*="contact"]', 'a[class*="cta"]'],
      type: 'text',
    },
  };

  const firstCardEl = doc.querySelector(listingCardSelector);
  const containerSelector = inferContainerSelector(firstCardEl);

  const indexSchema: TenantSiteSchema['index_schema'] = {
    url_patterns: indexPatterns,
    listing_card_selector: listingCardSelector,
    card_field_mappings: cardFieldMappings,
    data_extractors_per_card: dataExtractors,
    reorder_capable: false,
  };
  if (itemCount !== undefined) indexSchema.listing_count_expected = itemCount;
  if (containerSelector !== null) indexSchema.container_selector = containerSelector;

  const schema: TenantSiteSchema = {
    tenant_id: 'pending',
    domain,
    detected_at: new Date().toISOString(),
    detection_source: 'json_ld',
    detection_confidence: 0.95,
    index_schema: indexSchema,
    detail_schema: {
      url_patterns: detailPatterns,
      slot_selectors: slotSelectors,
      data_extractors: {
        address: addressStrategy,
        description: descriptionStrategy,
      },
    },
    archetype_hints: [],
  };

  return {
    schema,
    confidence: 0.95,
    technique: 'json_ld',
    warnings,
  };
}

function normalizeCurrency(raw: string): 'EUR' | 'USD' | 'GBP' | 'PLN' | 'AED' {
  const map: Record<string, 'EUR' | 'USD' | 'GBP' | 'PLN' | 'AED'> = {
    EUR: 'EUR',
    USD: 'USD',
    GBP: 'GBP',
    PLN: 'PLN',
    AED: 'AED',
  };
  return map[raw.toUpperCase()] ?? 'EUR';
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
