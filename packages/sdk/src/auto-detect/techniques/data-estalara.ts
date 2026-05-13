/**
 * Technique 1 — data-estalara-* attributes (confidence 1.0)
 *
 * Detects Tier 3 Native sites that use Estalara's own `data-estalara-*` attribute
 * convention. When our markup is present the schema can be derived with certainty
 * from the attribute vocabulary — no heuristics required.
 *
 * @module @estalara/sdk/auto-detect/techniques/data-estalara
 */

import type {
  TenantSiteSchema,
  SelectorStrategy,
  CardFieldMappings,
  DataExtractorsPerCard,
  SlotSelectors,
} from '@estalara/shared';
import type { DetectionResult } from '../pipeline.js';

/**
 * Detect Estalara Tier 3 Native sites via `data-estalara-*` attribute presence.
 *
 * Confidence: **1.0** — our own markup, no ambiguity possible.
 */
export function detectDataEstalara(html: string, url: string): Promise<DetectionResult | null> {
  return Promise.resolve(detectDataEstaalaraSync(html, url));
}

function detectDataEstaalaraSync(html: string, url: string): DetectionResult | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const hasListingId = doc.querySelector('[data-estalara-listing-id]') !== null;
  const hasSlot = doc.querySelector('[data-estalara-slot]') !== null;

  if (!hasListingId && !hasSlot) {
    return null;
  }

  const warnings: string[] = [];

  // Derive container selector from listing-grid slot.
  const gridEl = doc.querySelector('[data-estalara-slot="listing-grid"]');
  const containerSelector = gridEl ? '[data-estalara-slot="listing-grid"]' : undefined;

  // Collect all slot names that appear on listing cards.
  const cardEls = doc.querySelectorAll('[data-estalara-listing-id]');
  const slotNamesInCards = new Set<string>();
  for (const card of cardEls) {
    for (const slotEl of card.querySelectorAll('[data-estalara-slot]')) {
      const slotName = slotEl.getAttribute('data-estalara-slot');
      if (slotName) slotNamesInCards.add(slotName);
    }
  }

  // Build card field mappings from the slots we found.
  const cardFieldMappings: CardFieldMappings = {};
  if (slotNamesInCards.has('headline')) {
    cardFieldMappings.headline = {
      primary: "[data-estalara-slot='headline']",
      fallbacks: [],
      type: 'text',
    };
  }
  if (slotNamesInCards.has('price')) {
    cardFieldMappings.price = {
      primary: "[data-estalara-slot='price']",
      fallbacks: [],
      type: 'currency',
      currency: 'EUR',
    };
  }
  if (slotNamesInCards.has('photo')) {
    cardFieldMappings.image = {
      primary: "[data-estalara-slot='photo']",
      fallbacks: [],
      type: 'url',
    };
  }
  if (slotNamesInCards.has('bedrooms')) {
    cardFieldMappings.bedrooms = {
      primary: "[data-estalara-slot='bedrooms']",
      fallbacks: [],
      type: 'number',
    };
  }
  if (slotNamesInCards.has('area')) {
    cardFieldMappings.area = {
      primary: "[data-estalara-slot='area']",
      fallbacks: [],
      type: 'number',
      unit: 'sqm',
    };
  }

  // Always provide at minimum price + bedrooms for data_extractors_per_card.
  const dataExtractors: DataExtractorsPerCard = {
    price: {
      primary: "[data-estalara-slot='price']",
      fallbacks: [],
      type: 'currency',
      currency: 'EUR',
    },
    bedrooms: {
      primary: "[data-estalara-slot='bedrooms']",
      fallbacks: [],
      type: 'number',
    },
  };
  if (slotNamesInCards.has('area')) {
    dataExtractors.area_sqm = {
      primary: "[data-estalara-slot='area']",
      fallbacks: [],
      type: 'number',
      unit: 'sqm',
    };
  }

  // Detail page slot selectors.
  const slotSelectors: SlotSelectors = {};

  // CTA detection — prefer cta-live over cta.
  const ctaSelector = slotNamesInCards.has('cta-live')
    ? "[data-estalara-slot='cta-live']"
    : slotNamesInCards.has('cta')
      ? "[data-estalara-slot='cta']"
      : undefined;
  if (ctaSelector) {
    slotSelectors.cta_primary = { primary: ctaSelector, fallbacks: [], type: 'text' };
  }

  // Check if h1 contains a price (number + currency symbol).
  const h1El = doc.querySelector('h1');
  const h1Text = h1El?.textContent ?? '';
  const h1IsPrice = /[€$£₴₺]\s*[\d,]+|[\d,]+\s*[€$£₴₺]/.test(h1Text);
  if (h1IsPrice) {
    warnings.push('h1 appears to contain a price value — h1_is_price set to true');
    // Add tagline slot above h1.
    slotSelectors.tagline = {
      primary: '[data-estalara-slot="tagline"]',
      fallbacks: ['h1 + *', 'h1 ~ p:first-of-type'],
      type: 'text',
    };
  }

  // Framework detection.
  let frameworkHint: TenantSiteSchema['framework_hint'] | undefined;
  const bodyEl = doc.querySelector('body');
  if (bodyEl?.hasAttribute('data-sveltekit-preload-data')) {
    frameworkHint = 'svelte';
  } else if (doc.querySelector('[data-next-page]') !== null || html.includes('__NEXT_DATA__')) {
    frameworkHint = 'nextjs';
  }

  const domain = extractDomain(url);

  // Build url_patterns from the URL.
  const urlObj = tryParseUrl(url);
  const indexPatterns = urlObj ? [`${urlObj.origin}/**`, `${urlObj.origin}/listings*`] : ['/**'];
  const detailPatterns = urlObj
    ? [`${urlObj.origin}/listing/*`, `${urlObj.origin}/property/*`]
    : ['/listing/*'];

  const headlineSelector: SelectorStrategy = {
    primary: "[data-estalara-slot='headline']",
    fallbacks: ['h1'],
    type: 'text',
  };

  const indexSchema: TenantSiteSchema['index_schema'] = {
    url_patterns: indexPatterns,
    listing_card_selector: '[data-estalara-listing-id]',
    card_field_mappings: cardFieldMappings,
    data_extractors_per_card: dataExtractors,
    reorder_capable: false,
  };
  if (containerSelector) indexSchema.container_selector = containerSelector;

  const detailSchema: TenantSiteSchema['detail_schema'] = {
    url_patterns: detailPatterns,
    slot_selectors: {
      headline: headlineSelector,
      ...slotSelectors,
    },
    data_extractors: {},
  };
  if (h1IsPrice) detailSchema.h1_is_price = true;

  const schema: TenantSiteSchema = {
    tenant_id: 'pending',
    domain,
    detected_at: new Date().toISOString(),
    detection_source: 'data_estalara',
    detection_confidence: 1.0,
    index_schema: indexSchema,
    detail_schema: detailSchema,
    archetype_hints: [],
  };
  if (frameworkHint) schema.framework_hint = frameworkHint;

  return {
    schema,
    confidence: 1.0,
    technique: 'data_estalara',
    warnings,
  };
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
