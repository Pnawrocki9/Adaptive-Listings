/**
 * Technique 5 — Semantic <article> element patterns (confidence 0.85)
 *
 * Detects portals that use the HTML5 `<article>` element for listing cards.
 * Filters to articles that contain both a price pattern and an image — excluding
 * blog/news articles. Class-name matching is used to select the most specific
 * known pattern.
 *
 * Platforms: Idealista, OnTheMarket, Habitaclia.
 *
 * @module @estalara/sdk/auto-detect/techniques/article-tag
 */

import type {
  TenantSiteSchema,
  CardFieldMappings,
  DataExtractorsPerCard,
  SlotSelectors,
} from '@estalara/shared';
import type { DetectionResult } from '../pipeline.js';

/** Known stable article class patterns in priority order. */
const ARTICLE_PATTERNS: {
  classMatch: string;
  selector: string;
  cardFieldMappings: CardFieldMappings;
  dataExtractors: DataExtractorsPerCard;
}[] = [
  // Idealista — article.item
  {
    classMatch: 'item',
    selector: 'article.item',
    cardFieldMappings: {
      headline: {
        primary: 'a.item-link span',
        fallbacks: ['h3', '.item-title'],
        type: 'text',
      },
      price: {
        primary: 'span.item-price',
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency: 'EUR',
      },
      image: {
        primary: 'img.item-multimedia-image',
        fallbacks: ['img[src*="idealista"]', 'img'],
        type: 'url',
      },
      bedrooms: {
        primary: 'span.item-detail[data-rooms]',
        fallbacks: ['[class*="rooms"]', '[class*="bed"]'],
        type: 'number',
      },
      area: {
        primary: 'span.item-detail[data-area]',
        fallbacks: ['[class*="area"]', '[class*="size"]'],
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
        primary: 'span.item-detail[data-rooms]',
        fallbacks: ['[class*="rooms"]'],
        type: 'number',
      },
      area_sqm: {
        primary: 'span.item-detail[data-area]',
        fallbacks: ['[class*="area"]'],
        type: 'number',
        unit: 'sqm',
      },
    },
  },

  // Habitaclia — article.js-list-item (js- prefix = intentionally stable selector)
  {
    classMatch: 'js-list-item',
    selector: 'article.js-list-item',
    cardFieldMappings: {
      headline: {
        primary: 'h3.list-item-title a',
        fallbacks: ['h3 a', '.list-item-title'],
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
        fallbacks: ['[class*="surface"]', '[class*="area"]'],
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

  // OnTheMarket — article.block
  {
    classMatch: 'block',
    selector: 'article.block',
    cardFieldMappings: {
      headline: {
        primary: 'h2.block-title a',
        fallbacks: ['h2 a', '.listing-title'],
        type: 'text',
      },
      price: {
        primary: 'span.price',
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency: 'GBP',
      },
      image: {
        primary: 'img.thumbnail',
        fallbacks: ['img[src*="onthemarket"]', 'img'],
        type: 'url',
      },
      bedrooms: {
        primary: 'li.bedrooms span',
        fallbacks: ['[class*="bedroom"]'],
        type: 'number',
      },
      area: {
        primary: 'li.floor-area span',
        fallbacks: ['[class*="area"]'],
        type: 'number',
        unit: 'sqft',
      },
    },
    dataExtractors: {
      price: {
        primary: 'span.price',
        fallbacks: ['[class*="price"]'],
        type: 'currency',
        currency: 'GBP',
      },
      bedrooms: {
        primary: 'li.bedrooms span',
        fallbacks: [],
        type: 'number',
      },
      area_sqm: {
        primary: 'li.floor-area span',
        fallbacks: [],
        type: 'number',
        unit: 'sqft',
      },
    },
  },
];

/** Generic patterns for unknown portals using article[class*='property'] etc. */
const GENERIC_ARTICLE_CLASS_PATTERNS = ['property', 'listing', 'card', 'result'];

/** Price pattern: currency symbol followed by digits (with possible commas/periods). */
const PRICE_RE = /[€$£₴₺]\s*[\d,.']+|[\d,.']+\s*[€$£₴₺]|(USD|EUR|GBP|AED|PLN)\s*[\d,.']+/;

/** Minimum qualifying article count. */
const MIN_COUNT = 2;

/**
 * Detect real estate sites via semantic `<article>` element patterns.
 *
 * Confidence: **0.85**
 */
export function detectArticleTag(html: string, url: string): Promise<DetectionResult | null> {
  return Promise.resolve(detectArticleTagSync(html, url));
}

function detectArticleTagSync(html: string, url: string): DetectionResult | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const warnings: string[] = [];

  const allArticles = doc.querySelectorAll('article');
  if (allArticles.length < MIN_COUNT) return null;

  // Filter to articles that contain both a price AND an image.
  const qualifying: Element[] = [];
  for (const article of allArticles) {
    const hasPrice = PRICE_RE.test(article.textContent || '');
    const hasImage = article.querySelector('img') !== null;
    if (hasPrice && hasImage) qualifying.push(article);
  }

  if (qualifying.length < MIN_COUNT) return null;

  const domain = extractDomain(url);
  const urlObj = tryParseUrl(url);
  const indexPatterns = urlObj ? [`${urlObj.origin}/**`] : ['/**'];
  const detailPatterns = urlObj
    ? [`${urlObj.origin}/property/*`, `${urlObj.origin}/listing/*`]
    : ['/property/*'];

  // Try known patterns first.
  for (const pattern of ARTICLE_PATTERNS) {
    const matched = qualifying.filter((el) => el.classList.contains(pattern.classMatch));
    if (matched.length >= MIN_COUNT) {
      const schema: TenantSiteSchema = buildSchema(
        domain,
        indexPatterns,
        detailPatterns,
        pattern.selector,
        pattern.cardFieldMappings,
        pattern.dataExtractors,
        matched.length,
      );
      return {
        schema,
        confidence: 0.85,
        technique: 'article_tag',
        warnings,
      };
    }
  }

  // Try generic class patterns.
  for (const classPart of GENERIC_ARTICLE_CLASS_PATTERNS) {
    const matched = qualifying.filter((el) =>
      [...el.classList].some((c) => c.toLowerCase().includes(classPart)),
    );
    const firstMatch = matched[0];
    if (matched.length >= MIN_COUNT && firstMatch !== undefined) {
      const specificClass = [...firstMatch.classList].find((c) =>
        c.toLowerCase().includes(classPart),
      );
      const selector = specificClass ? `article.${specificClass}` : 'article';
      const { cardFieldMappings, dataExtractors } = buildGenericMappings(firstMatch, domain);
      warnings.push(`Generic article class match: ${selector}`);
      const schema: TenantSiteSchema = buildSchema(
        domain,
        indexPatterns,
        detailPatterns,
        selector,
        cardFieldMappings,
        dataExtractors,
        matched.length,
      );
      return {
        schema,
        confidence: 0.85,
        technique: 'article_tag',
        warnings,
      };
    }
  }

  // Fallback: plain article selector.
  const firstQualifying = qualifying[0];
  if (qualifying.length >= MIN_COUNT && firstQualifying !== undefined) {
    const { cardFieldMappings, dataExtractors } = buildGenericMappings(firstQualifying, domain);
    warnings.push('Falling back to plain article selector — no known class pattern matched');
    const schema: TenantSiteSchema = buildSchema(
      domain,
      indexPatterns,
      detailPatterns,
      'article',
      cardFieldMappings,
      dataExtractors,
      qualifying.length,
    );
    return {
      schema,
      confidence: 0.85,
      technique: 'article_tag',
      warnings,
    };
  }

  return null;
}

function buildSchema(
  domain: string,
  indexPatterns: string[],
  detailPatterns: string[],
  cardSelector: string,
  cardFieldMappings: CardFieldMappings,
  dataExtractors: DataExtractorsPerCard,
  count: number,
): TenantSiteSchema {
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
      fallbacks: ['button[class*="contact"]', 'a[class*="cta"]'],
      type: 'text',
    },
  };

  return {
    tenant_id: 'pending',
    domain,
    detected_at: new Date().toISOString(),
    detection_source: 'article_tag',
    detection_confidence: 0.85,
    index_schema: {
      url_patterns: indexPatterns,
      listing_card_selector: cardSelector,
      listing_count_expected: count,
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

/** Build minimal generic mappings by probing the first qualifying article element. */
function buildGenericMappings(
  card: Element,
  domain: string,
): { cardFieldMappings: CardFieldMappings; dataExtractors: DataExtractorsPerCard } {
  // Derive currency from domain.
  const currency = inferCurrency(domain);

  // Find price element.
  let priceSelector = 'span[class*="price"]';
  for (const el of card.querySelectorAll('span, p, div')) {
    if (PRICE_RE.test(el.textContent || '')) {
      const cls = stableClassSelector(el);
      if (cls) {
        priceSelector = cls;
        break;
      }
    }
  }

  const cardFieldMappings: CardFieldMappings = {
    headline: {
      primary: 'h2 a',
      fallbacks: ['h3 a', 'h2', 'h3', '[class*="title"]'],
      type: 'text',
    },
    price: {
      primary: priceSelector,
      fallbacks: ['[class*="price"]', '[class*="Price"]'],
      type: 'currency',
      currency,
    },
    image: {
      primary: 'img',
      fallbacks: [],
      type: 'url',
    },
    bedrooms: {
      primary: '[class*="bed"]',
      fallbacks: ['[class*="room"]'],
      type: 'number',
    },
  };

  const dataExtractors: DataExtractorsPerCard = {
    price: {
      primary: priceSelector,
      fallbacks: ['[class*="price"]'],
      type: 'currency',
      currency,
    },
    bedrooms: {
      primary: '[class*="bed"]',
      fallbacks: ['[class*="room"]'],
      type: 'number',
    },
  };

  return { cardFieldMappings, dataExtractors };
}

/** Return a stable CSS selector from an element's class list (avoid hash classes). */
function stableClassSelector(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  for (const cls of el.classList) {
    if (/^[a-z][a-z-]+$/i.test(cls) && cls.length < 30) {
      return `${tag}.${cls}`;
    }
  }
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
