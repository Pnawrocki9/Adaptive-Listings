// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { detectCssInJs } from '../techniques/css-in-js.js';
import { detectAngular } from '../techniques/angular.js';
import { detectWordPress } from '../techniques/wordpress.js';
import { detectDrupalPhp } from '../techniques/drupal-php.js';
import { parsePrice } from '../utils/price-parser.js';
import { formatPrice } from '../utils/currency-formatter.js';

// ---------------------------------------------------------------------------
// Technique 7 — CSS-in-JS
// ---------------------------------------------------------------------------
describe('detectCssInJs', () => {
  it('detects SearchResultCard styled-components prefix and uses [class*=] selector', async () => {
    const html = `<html><body>
      <div class="SearchResultCard-sc-a303eae3-14 jTESSm">
        <img src="/1.jpg"/>
        <div class="price-sc-b404fbe4-2">€500,000</div>
      </div>
      <div class="SearchResultCard-sc-a303eae3-14 xKkLpq">
        <img src="/2.jpg"/>
        <div class="price-sc-b404fbe4-2">€600,000</div>
      </div>
    </body></html>`;
    const result = await detectCssInJs(html, 'https://www.engelvoelkers.com/en/search/');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.75);
    expect(result!.technique).toBe('css_in_js');
    const cardSel = result!.schema!.index_schema.listing_card_selector;
    expect(cardSel).toBe("[class*='SearchResultCard']");
  });

  it('CRITICAL: full CSS-in-JS hash must NOT appear in returned selector', async () => {
    const html = `<html><body>
      <div class="SearchResultCard-sc-a303eae3-14">
        <img src="/1.jpg"/>
        <span>€200,000</span>
      </div>
      <div class="SearchResultCard-sc-a303eae3-14">
        <img src="/2.jpg"/>
        <span>€300,000</span>
      </div>
    </body></html>`;
    const result = await detectCssInJs(html, 'https://www.example.com/search/');
    if (result !== null) {
      const cardSel = result.schema!.index_schema.listing_card_selector;
      // Must not contain the full styled-components hash pattern.
      expect(cardSel).not.toMatch(/sc-[a-f0-9]{8}/);
      expect(cardSel).not.toMatch(/-\d+$/);
    }
  });

  it('detects CamelCase compound class prefix (BayutCard)', async () => {
    const html = `<html><body>
      <div class="BayutCard">
        <img src="/1.jpg"/>
        <span>AED 1,200,000</span>
      </div>
      <div class="BayutCard">
        <img src="/2.jpg"/>
        <span>AED 1,500,000</span>
      </div>
      <div class="BayutCard">
        <img src="/3.jpg"/>
        <span>AED 2,000,000</span>
      </div>
    </body></html>`;
    const result = await detectCssInJs(html, 'https://www.bayut.com/to-rent/');
    expect(result).not.toBeNull();
    const cardSel = result!.schema!.index_schema.listing_card_selector;
    expect(cardSel).toContain('BayutCard');
    // Must be partial-match form.
    expect(cardSel).toMatch(/\[class\*=/);
  });

  it('returns null when no CSS-in-JS prefixes found', async () => {
    const html = `<html><body>
      <div class="regular-class">No CSS-in-JS here</div>
    </body></html>`;
    const result = await detectCssInJs(html, 'https://example.com/');
    expect(result).toBeNull();
  });

  it('returns null when qualifying cards (price+image) are below threshold', async () => {
    const html = `<html><body>
      <div class="PropertyItem-sc-a303eae3-1">No price here</div>
    </body></html>`;
    const result = await detectCssInJs(html, 'https://example.com/');
    expect(result).toBeNull();
  });

  it('sets detection_source to css_in_js', async () => {
    const html = `<html><body>
      <div class="PropertyItem-sc-a303eae3-1">
        <img/><span>€200,000</span>
      </div>
      <div class="PropertyItem-sc-a303eae3-1">
        <img/><span>€300,000</span>
      </div>
    </body></html>`;
    const result = await detectCssInJs(html, 'https://example.com/');
    expect(result!.schema!.detection_source).toBe('css_in_js');
  });

  it('sets reorder_capable to false (CSS-in-JS selectors may drift)', async () => {
    const html = `<html><body>
      <div class="SearchResultCard-sc-a303eae3-14">
        <img/><span>€200,000</span>
      </div>
      <div class="SearchResultCard-sc-a303eae3-14">
        <img/><span>€300,000</span>
      </div>
    </body></html>`;
    const result = await detectCssInJs(html, 'https://example.com/');
    expect(result!.schema!.index_schema.reorder_capable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Technique 8 — Angular
// ---------------------------------------------------------------------------
describe('detectAngular', () => {
  it('detects Angular app via _ngcontent-* and avoids ng-* class names in selector', async () => {
    const html = `<html><body>
      <app-root _nghost-xyz-c0="">
        <div _ngcontent-xyz-c23="" class="PropertyCard">
          <img src="/1.jpg"/>
          <span class="price">£500,000</span>
        </div>
        <div _ngcontent-xyz-c23="" class="PropertyCard">
          <img src="/2.jpg"/>
          <span class="price">£600,000</span>
        </div>
        <div _ngcontent-xyz-c23="" class="PropertyCard">
          <img src="/3.jpg"/>
          <span class="price">£700,000</span>
        </div>
      </app-root>
    </body></html>`;
    const result = await detectAngular(html, 'https://www.knightfrank.com/for-sale/');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.7);
    expect(result!.technique).toBe('angular');
    expect(result!.schema!.framework_hint).toBe('angular');
    const cardSel = result!.schema!.index_schema.listing_card_selector;
    // Selector must not contain Angular-generated attribute names.
    expect(cardSel).not.toMatch(/_ngcontent/);
    expect(cardSel).not.toMatch(/ng-tns/);
  });

  it('detects Angular via app-root element', async () => {
    const html = `<html><body>
      <app-root>
        <div class="PropertyCard"><img/><span>£200,000</span></div>
        <div class="PropertyCard"><img/><span>£300,000</span></div>
      </app-root>
    </body></html>`;
    const result = await detectAngular(html, 'https://example.co.uk/');
    expect(result).not.toBeNull();
    expect(result!.schema!.framework_hint).toBe('angular');
  });

  it('detects Angular via meta generator tag', async () => {
    const html = `<html>
      <head><meta name="generator" content="Angular 17.0.0"/></head>
      <body>
        <div class="listing-card"><img/><span>€200,000</span></div>
        <div class="listing-card"><img/><span>€300,000</span></div>
      </body>
    </html>`;
    const result = await detectAngular(html, 'https://example.com/');
    expect(result).not.toBeNull();
    expect(result!.schema!.framework_hint).toBe('angular');
  });

  it('returns null when Angular is not detected', async () => {
    const html = `<html><body>
      <div class="PropertyCard"><img/><span>£200,000</span></div>
      <div class="PropertyCard"><img/><span>£300,000</span></div>
    </body></html>`;
    const result = await detectAngular(html, 'https://example.co.uk/');
    expect(result).toBeNull();
  });

  it('sets detection_source to angular', async () => {
    const html = `<html><body>
      <app-root>
        <div class="PropertyCard"><img/><span>£200,000</span></div>
        <div class="PropertyCard"><img/><span>£300,000</span></div>
        <div class="PropertyCard"><img/><span>£300,000</span></div>
      </app-root>
    </body></html>`;
    const result = await detectAngular(html, 'https://example.co.uk/');
    expect(result!.schema!.detection_source).toBe('angular');
  });
});

// ---------------------------------------------------------------------------
// Technique 9 — WordPress
// ---------------------------------------------------------------------------
describe('detectWordPress', () => {
  it('detects Houzez theme with body.houzez and 3+ listing cards', async () => {
    const html = `<html><body class="houzez">
      <div class="item-listing-wrap"><img/><span class="item-price">€300,000</span></div>
      <div class="item-listing-wrap"><img/><span class="item-price">€400,000</span></div>
      <div class="item-listing-wrap"><img/><span class="item-price">€500,000</span></div>
    </body></html>`;
    const result = await detectWordPress(html, 'https://example-houzez.com/properties/');
    expect(result).not.toBeNull();
    expect(result!.technique).toBe('wordpress');
    expect(result!.schema!.detection_source).toBe('wordpress');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result!.schema!.index_schema.listing_card_selector).toBe('div.item-listing-wrap');
  });

  it('detects WordPress via meta generator tag (generic fallback)', async () => {
    const html = `<html>
      <head>
        <meta name="generator" content="WordPress 6.4"/>
      </head>
      <body>
        <article class="property"><img/><span>€200,000</span></article>
        <article class="property"><img/><span>€300,000</span></article>
        <article class="property"><img/><span>€400,000</span></article>
      </body>
    </html>`;
    const result = await detectWordPress(html, 'https://example.com/properties/');
    expect(result).not.toBeNull();
    expect(result!.schema!.detection_source).toBe('wordpress');
    expect(result!.schema!.framework_hint).toBe('wordpress');
  });

  it('detects WordPress via wp-content/themes/ in link href', async () => {
    const html = `<html>
      <head>
        <link rel="stylesheet" href="https://example.com/wp-content/themes/houzez/style.css"/>
      </head>
      <body class="houzez">
        <div class="item-listing-wrap"><img/><span class="item-price">€300,000</span></div>
        <div class="item-listing-wrap"><img/><span class="item-price">€400,000</span></div>
      </body>
    </html>`;
    const result = await detectWordPress(html, 'https://example.com/properties/');
    expect(result).not.toBeNull();
    expect(result!.schema!.detection_source).toBe('wordpress');
  });

  it('detects RealHomes theme with article.property', async () => {
    const html = `<html>
      <head>
        <link rel="stylesheet" href="https://example.com/wp-content/themes/realhomes/style.css"/>
      </head>
      <body class="real-homes">
        <article class="property"><img/><span class="rh_prop_card__price">€200,000</span></article>
        <article class="property"><img/><span class="rh_prop_card__price">€300,000</span></article>
        <article class="property"><img/><span class="rh_prop_card__price">€400,000</span></article>
      </body>
    </html>`;
    const result = await detectWordPress(html, 'https://example-realhomes.com/properties/');
    expect(result).not.toBeNull();
    expect(result!.schema!.index_schema.listing_card_selector).toBe('article.property');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.88);
  });

  it('sets framework_hint to wordpress', async () => {
    const html = `<html>
      <head><meta name="generator" content="WordPress 6.4"/></head>
      <body>
        <article class="property"><img/><span>€200,000</span></article>
        <article class="property"><img/><span>€300,000</span></article>
      </body>
    </html>`;
    const result = await detectWordPress(html, 'https://example.com/');
    expect(result!.schema!.framework_hint).toBe('wordpress');
  });

  it('returns null when WordPress is not detected', async () => {
    const html = `<html><body>
      <div class="property-card"><img/><span>€200,000</span></div>
      <div class="property-card"><img/><span>€300,000</span></div>
    </body></html>`;
    const result = await detectWordPress(html, 'https://example.com/');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Technique 10 — Drupal / PHP Classic
// ---------------------------------------------------------------------------
describe('detectDrupalPhp', () => {
  it('detects Drupal via meta generator tag with field--name- pattern', async () => {
    const html = `<html>
      <head><meta name="generator" content="Drupal 10"/></head>
      <body>
        <div class="field--name-field-listing-image"><img/><span class="field__item">€200,000</span></div>
        <div class="field--name-field-listing-image"><img/><span class="field__item">€300,000</span></div>
        <div class="field--name-field-listing-image"><img/><span class="field__item">€400,000</span></div>
        <div class="field--name-field-price"><span>€200,000</span></div>
        <div class="field--name-field-price"><span>€300,000</span></div>
        <div class="field--name-field-bedrooms"><span>3</span></div>
      </body>
    </html>`;
    const result = await detectDrupalPhp(html, 'https://www.zyprus.com/properties-for-sale/');
    expect(result).not.toBeNull();
    expect(result!.technique).toBe('drupal');
    expect(result!.schema!.detection_source).toBe('drupal');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.88);
  });

  it('detects Drupal via field--name-* class count (>= 3 elements)', async () => {
    const html = `<html><body>
      <article class="node--type-listing"><img/><span>€200,000</span></article>
      <article class="node--type-listing"><img/><span>€300,000</span></article>
      <article class="node--type-listing"><img/><span>€400,000</span></article>
      <div class="field--name-field-price"><span>€200,000</span></div>
      <div class="field--name-field-bedrooms"><span>3</span></div>
      <div class="field--name-field-area"><span>120 sqm</span></div>
    </body></html>`;
    const result = await detectDrupalPhp(html, 'https://www.zyprus.com/properties/');
    expect(result).not.toBeNull();
    expect(result!.schema!.detection_source).toBe('drupal');
  });

  it('detects PHP classic Bazaraki pattern (div.advert) with dot-thousands warning', async () => {
    const html = `<html><body>
      <div class="advert"><a class="advert-title">House</a><div class="advert-price">€335.000</div><img class="advert-image" src="/1.jpg"/></div>
      <div class="advert"><a class="advert-title">Villa</a><div class="advert-price">€450.000</div><img class="advert-image" src="/2.jpg"/></div>
      <div class="advert"><a class="advert-title">Flat</a><div class="advert-price">€180.000</div><img class="advert-image" src="/3.jpg"/></div>
      <div class="advert"><a class="advert-title">Studio</a><div class="advert-price">€90.000</div><img class="advert-image" src="/4.jpg"/></div>
    </body></html>`;
    const result = await detectDrupalPhp(html, 'https://www.bazaraki.com/real-estate/');
    expect(result).not.toBeNull();
    expect(result!.technique).toBe('php_classic');
    expect(result!.schema!.detection_source).toBe('php_classic');
    expect(result!.schema!.index_schema.listing_card_selector).toBe('div.advert');
    // Warning about dot-thousands format must be present.
    expect(result!.warnings.some((w) => w.includes('dot_thousands'))).toBe(true);
  });

  it('sets detection_source to php_classic for PHP portals', async () => {
    const html = `<html><body>
      <div class="listing-item"><img/><span class="price">€200,000</span></div>
      <div class="listing-item"><img/><span class="price">€300,000</span></div>
      <div class="listing-item"><img/><span class="price">€400,000</span></div>
    </body></html>`;
    const result = await detectDrupalPhp(html, 'https://example.com/');
    expect(result).not.toBeNull();
    expect(result!.schema!.detection_source).toBe('php_classic');
  });

  it('sets framework_hint to drupal for Drupal sites', async () => {
    const html = `<html>
      <head><meta name="generator" content="Drupal 9"/></head>
      <body>
        <article class="node--type-listing"><img/><span>€200,000</span></article>
        <article class="node--type-listing"><img/><span>€300,000</span></article>
        <article class="node--type-listing"><img/><span>€400,000</span></article>
        <div class="field--name-field-price"><span>€200,000</span></div>
        <div class="field--name-field-bedrooms"><span>3</span></div>
        <div class="field--name-field-area"><span>120</span></div>
      </body>
    </html>`;
    const result = await detectDrupalPhp(html, 'https://example.com/');
    expect(result!.schema!.framework_hint).toBe('drupal');
  });

  it('returns null when no Drupal or PHP classic pattern found', async () => {
    const html = `<html><body>
      <div class="random-class">No listing</div>
    </body></html>`;
    const result = await detectDrupalPhp(html, 'https://example.com/');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Price parser
// ---------------------------------------------------------------------------
describe('parsePrice', () => {
  // European dot-thousands (Bazaraki)
  it('parses €335.000 as 335000 EUR (dot = thousands separator)', () => {
    const result = parsePrice('€335.000');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(335000);
    expect(result!.currency).toBe('EUR');
    expect(result!.raw).toBe('€335.000');
  });

  // Comma-thousands
  it('parses €239,000 as 239000 EUR', () => {
    const result = parsePrice('€239,000');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(239000);
    expect(result!.currency).toBe('EUR');
  });

  // Multi-comma large number
  it('parses £3,000,000 as 3000000 GBP', () => {
    const result = parsePrice('£3,000,000');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(3000000);
    expect(result!.currency).toBe('GBP');
  });

  // USD large number
  it('parses $128,000,000 as 128000000 USD', () => {
    const result = parsePrice('$128,000,000');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(128000000);
    expect(result!.currency).toBe('USD');
  });

  // AED currency code prefix (Bayut)
  it('parses AED 6,800,000 as 6800000 AED', () => {
    const result = parsePrice('AED 6,800,000');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(6800000);
    expect(result!.currency).toBe('AED');
  });

  // PLN currency code prefix (Engelvoelkers Warsaw)
  it('parses PLN 12,836,054 as 12836054 PLN', () => {
    const result = parsePrice('PLN 12,836,054');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(12836054);
    expect(result!.currency).toBe('PLN');
  });

  // POA variants
  it('parses "Price on request" as POA', () => {
    const result = parsePrice('Price on request');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('POA');
    expect(result!.currency).toBe('');
  });

  it('parses "POA" as POA', () => {
    const result = parsePrice('POA');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('POA');
  });

  it('parses "Anfrage" as POA (German)', () => {
    const result = parsePrice('Anfrage');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('POA');
  });

  it('parses "Prix sur demande" as POA (French)', () => {
    const result = parsePrice('Prix sur demande');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('POA');
  });

  it('parses "precio a consultar" as POA (Spanish)', () => {
    const result = parsePrice('precio a consultar');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('POA');
  });

  it('returns null for strings that are not prices', () => {
    expect(parsePrice('not a price')).toBeNull();
    expect(parsePrice('Click here to buy')).toBeNull();
    expect(parsePrice('')).toBeNull();
  });

  it('preserves raw string in result', () => {
    const raw = '€239,000';
    const result = parsePrice(raw);
    expect(result!.raw).toBe(raw);
  });

  // Edge cases
  it('parses plain number with currency symbol', () => {
    const result = parsePrice('€500000');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(500000);
    expect(result!.currency).toBe('EUR');
  });
});

// ---------------------------------------------------------------------------
// Currency formatter
// ---------------------------------------------------------------------------
describe('formatPrice', () => {
  it('formats POA as "Price on request"', () => {
    expect(formatPrice('POA', '')).toBe('Price on request');
    expect(formatPrice('POA', 'EUR')).toBe('Price on request');
  });

  it('formats EUR value with currency symbol', () => {
    const formatted = formatPrice(335000, 'EUR', 'en-GB');
    expect(formatted).toContain('335');
    expect(formatted).toContain('000');
    // Should include currency indicator
    expect(formatted.includes('€') || formatted.includes('EUR')).toBe(true);
  });

  it('formats GBP value', () => {
    const formatted = formatPrice(1500000, 'GBP', 'en-GB');
    expect(formatted).toContain('1');
    expect(formatted).toContain('500');
    expect(formatted.includes('£') || formatted.includes('GBP')).toBe(true);
  });

  it('formats USD value', () => {
    const formatted = formatPrice(128000000, 'USD', 'en-US');
    expect(formatted).toContain('128');
    expect(formatted.includes('$') || formatted.includes('USD')).toBe(true);
  });

  it('formats without currency when currency is empty string', () => {
    const formatted = formatPrice(500000, '');
    // Should be a plain number, no currency prefix
    expect(formatted).toContain('500');
    expect(formatted).not.toContain('€');
    expect(formatted).not.toContain('£');
    expect(formatted).not.toContain('$');
  });

  it('uses default locale when none provided', () => {
    // Should not throw
    expect(() => formatPrice(300000, 'EUR')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AI Vision — null when ANTHROPIC_API_KEY missing
// ---------------------------------------------------------------------------
describe('detectAiVision', () => {
  beforeEach(() => {
    // Ensure API key is not set in test environment.
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns null when ANTHROPIC_API_KEY is not set (no throw)', async () => {
    // Dynamic import to match real usage pattern.
    const { detectAiVision } = await import('../techniques/ai-vision.js');
    const result = await detectAiVision('<html><body></body></html>', 'https://example.com/');
    expect(result).toBeNull();
  });

  it('returns null gracefully — does not throw', async () => {
    const { detectAiVision } = await import('../techniques/ai-vision.js');
    await expect(
      detectAiVision('<html><body></body></html>', 'https://example.com/'),
    ).resolves.toBeNull();
  });

  it('returns null when ANTHROPIC_API_KEY is empty string', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    const { detectAiVision } = await import('../techniques/ai-vision.js');
    const result = await detectAiVision('<html><body></body></html>', 'https://example.com/');
    // Empty string is falsy — should return null without calling API.
    expect(result).toBeNull();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns null when called with no API key after a previous null result (idempotent)', async () => {
    // Verify the module is safe to call multiple times with no key.
    delete process.env.ANTHROPIC_API_KEY;
    const { detectAiVision } = await import('../techniques/ai-vision.js');
    const result1 = await detectAiVision('<html><body></body></html>', 'https://example.com/');
    const result2 = await detectAiVision('<html><body></body></html>', 'https://example.com/');
    expect(result1).toBeNull();
    expect(result2).toBeNull();
  });
});
