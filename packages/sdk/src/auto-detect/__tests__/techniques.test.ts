// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { detectDataEstalara } from '../techniques/data-estalara.js';
import { detectJsonLd } from '../techniques/json-ld.js';
import { detectDataAttributes } from '../techniques/data-attributes.js';

// ---------------------------------------------------------------------------
// Technique 1 — data-estalara
// ---------------------------------------------------------------------------
describe('detectDataEstalara', () => {
  it('returns confidence 1.0 when data-estalara-listing-id is present', async () => {
    const html = `<html><body>
      <div data-estalara-listing-id="123">
        <span data-estalara-slot="price">€200,000</span>
        <img src="/img.jpg" />
      </div>
      <div data-estalara-listing-id="456">
        <span data-estalara-slot="price">€250,000</span>
        <img src="/img2.jpg" />
      </div>
    </body></html>`;
    const result = await detectDataEstalara(html, 'https://app.estalara.com/listings');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1.0);
    expect(result!.technique).toBe('data_estalara');
    expect(result!.schema).not.toBeNull();
    expect(result!.schema!.index_schema.listing_card_selector).toBe('[data-estalara-listing-id]');
  });

  it('returns confidence 1.0 when data-estalara-slot is present (no listing-id)', async () => {
    const html = `<html><body>
      <div data-estalara-slot="listing-grid">
        <span data-estalara-slot="headline">My listing</span>
      </div>
    </body></html>`;
    const result = await detectDataEstalara(html, 'https://app.estalara.com/');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1.0);
  });

  it('returns null when no data-estalara-* attributes are present', async () => {
    const html = `<html><body><div class="some-class">Nothing here</div></body></html>`;
    const result = await detectDataEstalara(html, 'https://example.com');
    expect(result).toBeNull();
  });

  it('sets container_selector when listing-grid slot is found', async () => {
    const html = `<html><body>
      <div data-estalara-slot="listing-grid">
        <div data-estalara-listing-id="1"><span data-estalara-slot="price">€100,000</span><img src="/a.jpg"/></div>
      </div>
    </body></html>`;
    const result = await detectDataEstalara(html, 'https://app.estalara.com/listings');
    expect(result!.schema!.index_schema.container_selector).toBe(
      '[data-estalara-slot="listing-grid"]',
    );
  });

  it('detects svelte framework from data-sveltekit-preload-data on body', async () => {
    const html = `<html><body data-sveltekit-preload-data="hover">
      <div data-estalara-listing-id="1"><span data-estalara-slot="price">€100,000</span><img src="/a.jpg"/></div>
    </body></html>`;
    const result = await detectDataEstalara(html, 'https://app.estalara.com/');
    expect(result!.schema!.framework_hint).toBe('svelte');
  });

  it('sets h1_is_price when h1 contains a price value', async () => {
    const html = `<html><body>
      <h1>€488,168</h1>
      <div data-estalara-listing-id="1"><span data-estalara-slot="price">€200,000</span><img src="/a.jpg"/></div>
    </body></html>`;
    const result = await detectDataEstalara(html, 'https://app.estalara.com/listing/1');
    expect(result!.schema!.detail_schema.h1_is_price).toBe(true);
    expect(result!.schema!.detail_schema.slot_selectors.tagline).toBeDefined();
  });

  it('populates data_extractors_per_card with at least price and bedrooms', async () => {
    const html = `<html><body>
      <div data-estalara-listing-id="1">
        <span data-estalara-slot="price">€200,000</span>
        <span data-estalara-slot="bedrooms">3</span>
        <img src="/img.jpg"/>
      </div>
    </body></html>`;
    const result = await detectDataEstalara(html, 'https://app.estalara.com/listings');
    const extractors = result!.schema!.index_schema.data_extractors_per_card;
    expect(extractors.price).toBeDefined();
    expect(extractors.bedrooms).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Technique 2 — json-ld
// ---------------------------------------------------------------------------
describe('detectJsonLd', () => {
  it('returns confidence 0.95 for RealEstateListing JSON-LD', async () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "RealEstateListing",
          "name": "3BR Apartment in Madrid",
          "offers": { "price": 250000, "priceCurrency": "EUR" },
          "address": { "streetAddress": "Calle Mayor 1, Madrid" },
          "description": "Beautiful apartment",
          "image": "https://example.com/img.jpg"
        }
      </script>
    </head><body></body></html>`;
    const result = await detectJsonLd(html, 'https://www.kyero.com/en/buy/andalucia/');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.95);
    expect(result!.technique).toBe('json_ld');
    expect(result!.schema!.detection_source).toBe('json_ld');
  });

  it('returns confidence 0.95 for SingleFamilyResidence JSON-LD', async () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {"@type":"SingleFamilyResidence","name":"Casa","offers":{"price":500000,"priceCurrency":"USD"}}
      </script>
    </head><body></body></html>`;
    const result = await detectJsonLd(html, 'https://www.realtor.com/property/123');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.95);
  });

  it('returns null when no JSON-LD is present', async () => {
    const html = `<html><body><div>No structured data here</div></body></html>`;
    const result = await detectJsonLd(html, 'https://example.com');
    expect(result).toBeNull();
  });

  it('returns null when JSON-LD is not a real estate type', async () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {"@type":"Article","headline":"Some news"}
      </script>
    </head><body></body></html>`;
    const result = await detectJsonLd(html, 'https://news.example.com');
    expect(result).toBeNull();
  });

  it('handles ItemList with item count', async () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {
          "@type": "ItemList",
          "itemListElement": [
            {"@type":"RealEstateListing","name":"A"},
            {"@type":"RealEstateListing","name":"B"},
            {"@type":"RealEstateListing","name":"C"}
          ]
        }
      </script>
    </head><body></body></html>`;
    const result = await detectJsonLd(html, 'https://example.com/listings');
    expect(result).not.toBeNull();
    expect(result!.schema!.index_schema.listing_count_expected).toBe(3);
    expect(result!.warnings.some((w) => w.includes('ItemList'))).toBe(true);
  });

  it('normalises currency from JSON-LD priceCurrency', async () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {"@type":"Apartment","offers":{"price":1200000,"priceCurrency":"AED"}}
      </script>
    </head><body></body></html>`;
    const result = await detectJsonLd(html, 'https://www.bayut.com/listing/1');
    expect(result!.schema!.index_schema.card_field_mappings.price!.currency).toBe('AED');
  });

  it('populates data_extractors_per_card with price and bedrooms', async () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {"@type":"RealEstateListing","offers":{"price":300000,"priceCurrency":"GBP"}}
      </script>
    </head><body></body></html>`;
    const result = await detectJsonLd(html, 'https://example.co.uk/property/1');
    expect(result!.schema!.index_schema.data_extractors_per_card.price).toBeDefined();
    expect(result!.schema!.index_schema.data_extractors_per_card.bedrooms).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Technique 3 — data-attributes
// ---------------------------------------------------------------------------
describe('detectDataAttributes', () => {
  it('detects data-cy="l-card" pattern (Otodom) with 3+ cards', async () => {
    const html = `<html><body>
      <div data-cy="l-card"><img src="/1.jpg"/><span data-cy="ad-price">500 000 PLN</span></div>
      <div data-cy="l-card"><img src="/2.jpg"/><span data-cy="ad-price">600 000 PLN</span></div>
      <div data-cy="l-card"><img src="/3.jpg"/><span data-cy="ad-price">700 000 PLN</span></div>
    </body></html>`;
    const result = await detectDataAttributes(html, 'https://www.otodom.pl/pl/wyniki/');
    expect(result).not.toBeNull();
    expect(result!.technique).toBe('data_cy');
    expect(result!.confidence).toBe(0.92);
    expect(result!.schema!.index_schema.listing_card_selector).toBe("[data-cy='l-card']");
  });

  it('sets detection_source to data_cy for data-cy patterns', async () => {
    const html = `<html><body>
      <div data-cy="l-card"><img/><span>€200k</span></div>
      <div data-cy="l-card"><img/><span>€300k</span></div>
      <div data-cy="l-card"><img/><span>€400k</span></div>
    </body></html>`;
    const result = await detectDataAttributes(html, 'https://www.otodom.pl/');
    expect(result!.schema!.detection_source).toBe('data_cy');
  });

  it('detects data-testid="propertyCard" pattern (Rightmove) with 5+ cards', async () => {
    const html = `<html><body>
      ${Array.from(
        { length: 5 },
        (_, i) => `
        <div data-testid="propertyCard">
          <img src="/${String(i)}.jpg"/>
          <div data-testid="price"><span>£${String((i + 1) * 100000)}</span></div>
        </div>`,
      ).join('')}
    </body></html>`;
    const result = await detectDataAttributes(html, 'https://www.rightmove.co.uk/find.html');
    expect(result).not.toBeNull();
    expect(result!.technique).toBe('data_testid');
    expect(result!.schema!.index_schema.listing_card_selector).toBe("[data-testid='propertyCard']");
  });

  it('sets detection_source to data_testid for data-testid patterns', async () => {
    const html = `<html><body>
      <div data-testid="propertyCard"><img/><span>£200k</span></div>
      <div data-testid="propertyCard"><img/><span>£300k</span></div>
      <div data-testid="propertyCard"><img/><span>£400k</span></div>
    </body></html>`;
    const result = await detectDataAttributes(html, 'https://www.rightmove.co.uk/');
    expect(result!.schema!.detection_source).toBe('data_testid');
  });

  it('returns null when fewer than 2 cards are found', async () => {
    const html = `<html><body>
      <div data-cy="l-card"><img/><span>€200k</span></div>
    </body></html>`;
    const result = await detectDataAttributes(html, 'https://www.otodom.pl/listing/1');
    expect(result).toBeNull();
  });

  it('detects data-testid="listing-container" pattern (Zoopla)', async () => {
    const html = `<html><body>
      <div data-testid="listing-container"><img/><p data-testid="listing-price">£300,000</p></div>
      <div data-testid="listing-container"><img/><p data-testid="listing-price">£400,000</p></div>
      <div data-testid="listing-container"><img/><p data-testid="listing-price">£500,000</p></div>
    </body></html>`;
    const result = await detectDataAttributes(html, 'https://www.zoopla.co.uk/for-sale/');
    expect(result).not.toBeNull();
    expect(result!.schema!.index_schema.listing_card_selector).toBe(
      "[data-testid='listing-container']",
    );
  });

  it('sets reorder_capable to true', async () => {
    const html = `<html><body>
      <div data-cy="listing-item"><img/><span>AED 1,200,000</span></div>
      <div data-cy="listing-item"><img/><span>AED 1,300,000</span></div>
    </body></html>`;
    const result = await detectDataAttributes(html, 'https://www.bayut.com/to-rent/');
    expect(result!.schema!.index_schema.reorder_capable).toBe(true);
  });

  it('populates data_extractors_per_card with at least price and bedrooms', async () => {
    const html = `<html><body>
      ${Array.from(
        { length: 3 },
        () => `
        <div data-testid="propertyCard">
          <img/>
          <div data-testid="price"><span>£200,000</span></div>
          <span data-testid="beds">2</span>
        </div>`,
      ).join('')}
    </body></html>`;
    const result = await detectDataAttributes(html, 'https://www.rightmove.co.uk/');
    expect(result!.schema!.index_schema.data_extractors_per_card.price).toBeDefined();
    expect(result!.schema!.index_schema.data_extractors_per_card.bedrooms).toBeDefined();
  });
});
