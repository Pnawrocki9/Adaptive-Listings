/**
 * Technique 4 — Material UI MuiPaper-root patterns (confidence 0.88)
 *
 * Detects portals built on Material UI by looking for `MuiPaper-root` class on
 * listing card elements. MUI class names (unlike CSS Modules) are stable across
 * deploys because they are generated from the component display name.
 *
 * Platforms: Foxtons, RE/MAX, Coldwell Banker.
 *
 * @module @estalara/sdk/auto-detect/techniques/mui-components
 */

import type {
  TenantSiteSchema,
  CardFieldMappings,
  DataExtractorsPerCard,
  SlotSelectors,
} from '@estalara/shared';
import type { DetectionResult } from '../pipeline.js';
import { inferContainerSelector } from '../utils/container.js';

/** MUI card element tags to check in priority order. */
const MUI_CARD_SELECTORS = [
  'article.MuiPaper-root',
  'div.MuiPaper-root',
  'li.MuiPaper-root',
] as const;

/** Currency symbol regex for price validation within a card. */
const CURRENCY_RE = /[€$£₴₺]|USD|EUR|GBP|AED|PLN/;

/** Minimum qualifying card count to accept the technique. */
const MIN_CARD_COUNT = 2;

/**
 * Detect MUI-based real estate portals.
 *
 * Confidence: **0.88**
 */
export function detectMuiComponents(html: string, url: string): Promise<DetectionResult | null> {
  return Promise.resolve(detectMuiComponentsSync(html, url));
}

function detectMuiComponentsSync(html: string, url: string): DetectionResult | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const warnings: string[] = [];

  let matchedSelector: string | null = null;
  let qualifyingCount = 0;

  for (const sel of MUI_CARD_SELECTORS) {
    const cards = doc.querySelectorAll(sel);
    if (cards.length < MIN_CARD_COUNT) continue;

    // Validate co-occurrence: must have a price span AND an image inside each card.
    let validCards = 0;
    for (const card of cards) {
      const hasPrice = [...card.querySelectorAll('span')].some((s) =>
        CURRENCY_RE.test(s.textContent || ''),
      );
      const hasImage = card.querySelector('img') !== null;
      if (hasPrice && hasImage) validCards++;
    }

    if (validCards >= MIN_CARD_COUNT) {
      matchedSelector = sel;
      qualifyingCount = validCards;
      break;
    }
  }

  if (!matchedSelector) {
    return null;
  }

  // Derive price selector: find the nearest span with a currency string.
  const priceSpanSelector = derivePriceSelector(doc, matchedSelector);

  const domain = extractDomain(url);
  const urlObj = tryParseUrl(url);
  const indexPatterns = urlObj ? [`${urlObj.origin}/**`] : ['/**'];
  const detailPatterns = urlObj
    ? [`${urlObj.origin}/property/*`, `${urlObj.origin}/properties/*`]
    : ['/property/*'];

  // Infer currency from domain TLD.
  const currency = inferCurrency(domain);

  const cardFieldMappings: CardFieldMappings = {
    headline: {
      primary: 'h2[data-testid*="address"]',
      fallbacks: ['h2', 'h3', '[class*="title"]', '[class*="address"]'],
      type: 'text',
    },
    price: {
      primary: priceSpanSelector,
      fallbacks: ['span[class*="price"]', 'span[class*="Price"]'],
      type: 'currency',
      currency,
    },
    image: {
      primary: 'img',
      fallbacks: [],
      type: 'url',
    },
    bedrooms: {
      primary: 'span[data-testid*="bed"]',
      fallbacks: ['span[class*="bed"]', 'span[aria-label*="bed"]'],
      type: 'number',
    },
    area: {
      primary: 'span[data-testid*="size"]',
      fallbacks: ['span[class*="size"]', 'span[class*="area"]'],
      type: 'number',
      unit: 'sqft',
    },
  };

  const dataExtractors: DataExtractorsPerCard = {
    price: {
      primary: priceSpanSelector,
      fallbacks: ['span[class*="price"]'],
      type: 'currency',
      currency,
    },
    bedrooms: {
      primary: 'span[data-testid*="bed"]',
      fallbacks: ['span[class*="bed"]'],
      type: 'number',
    },
    area_sqm: {
      primary: 'span[data-testid*="size"]',
      fallbacks: ['span[class*="size"]'],
      type: 'number',
      unit: 'sqft',
    },
  };

  const slotSelectors: SlotSelectors = {
    headline: {
      primary: 'h1[class*="MuiTypography"]',
      fallbacks: ['h1', '.MuiTypography-h1'],
      type: 'text',
    },
    description: {
      primary: 'p[class*="MuiTypography"]',
      fallbacks: ['[class*="description"]'],
      type: 'text',
    },
    cta_primary: {
      primary: 'button[class*="MuiButton"]',
      fallbacks: ['a[class*="MuiButton"]'],
      type: 'text',
    },
  };

  if (qualifyingCount < 5) {
    warnings.push(
      `Only ${String(qualifyingCount)} qualifying MUI cards found — may be a detail page`,
    );
  }

  const schema: TenantSiteSchema = {
    tenant_id: 'pending',
    domain,
    detected_at: new Date().toISOString(),
    detection_source: 'mui',
    detection_confidence: 0.88,
    framework_hint: 'react',
    index_schema: {
      url_patterns: indexPatterns,
      listing_card_selector: matchedSelector,
      listing_count_expected: qualifyingCount,
      card_field_mappings: cardFieldMappings,
      data_extractors_per_card: dataExtractors,
      reorder_capable: true,
      ...(() => {
        const cs = inferContainerSelector(doc.querySelector(matchedSelector));
        return cs !== null ? { container_selector: cs } : {};
      })(),
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
    confidence: 0.88,
    technique: 'mui',
    warnings,
  };
}

/**
 * Derive a price CSS selector by scanning spans in the first matching card
 * and finding one that contains a currency symbol.
 */
function derivePriceSelector(doc: Document, cardSelector: string): string {
  const firstCard = doc.querySelector(cardSelector);
  if (!firstCard) return 'span[class*="price"]';

  for (const span of firstCard.querySelectorAll('span')) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- textContent is string|null per DOM spec
    if (CURRENCY_RE.test(span.textContent ?? '')) {
      // Prefer data-testid over class for stability.
      const testId = span.getAttribute('data-testid');
      if (testId) return `span[data-testid='${testId}']`;

      // Use first non-hash class segment.
      const cls = firstStableClass(span.className);
      if (cls) return `span[class*='${cls}']`;
    }
  }
  return 'span[class*="price"]';
}

/** Extract first "stable" (non-hash) class segment from a class string. */
function firstStableClass(className: string): string | null {
  const classes = className.trim().split(/\s+/);
  for (const cls of classes) {
    // Skip MUI utility classes and hash-like strings.
    if (cls.startsWith('Mui') || /^[a-z0-9]{5,}$/i.test(cls)) continue;
    if (cls.toLowerCase().includes('price') || cls.toLowerCase().includes('Price')) return cls;
  }
  return null;
}

function inferCurrency(domain: string): 'EUR' | 'USD' | 'GBP' | 'PLN' | 'AED' {
  if (domain.endsWith('.co.uk') || domain.endsWith('.uk')) return 'GBP';
  if (domain.endsWith('.com') && domain.includes('foxtons')) return 'GBP';
  if (domain.endsWith('.ae') || domain.includes('bayut')) return 'AED';
  if (domain.endsWith('.pl')) return 'PLN';
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
