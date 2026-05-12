/**
 * Compile-time + minimal runtime checks for the TenantSiteSchema types.
 *
 * The main purpose of this file is to ensure that all exported types from
 * `tenant-site-schema.ts` and `ReorderDirective` from `directives.ts` satisfy
 * the TypeScript compiler when imported via the shared package index.
 *
 * No behavioural logic is tested here — these types are pure data structures.
 */

import { describe, it, expect } from 'vitest';
import type {
  TenantSiteSchema,
  ReorderDirective,
  DataExtractorsPerCard,
  IndexSchema,
  DetailSchema,
  SelectorStrategy,
  CardFieldMappings,
  SlotSelectors,
  ArchetypeHint,
  PageType,
} from '../index.js';

describe('TenantSiteSchema types compile', () => {
  it('constructs a minimal TenantSiteSchema value', () => {
    const selector: SelectorStrategy = {
      primary: '.price',
      fallbacks: ['[data-price]'],
      type: 'currency',
      currency: 'EUR',
    };

    const cardMappings: CardFieldMappings = {
      price: selector,
    };

    const extractors: DataExtractorsPerCard = {
      price: selector,
      bedrooms: { primary: '.beds', fallbacks: [], type: 'number' },
    };

    const indexSchema: IndexSchema = {
      url_patterns: ['/search*', '/listings*'],
      listing_card_selector: '.listing-card',
      container_selector: '.listings-grid',
      listing_count_expected: 24,
      card_field_mappings: cardMappings,
      data_extractors_per_card: extractors,
      sort_options_available: true,
      reorder_capable: true,
    };

    const slotSelectors: SlotSelectors = {
      headline: { primary: 'h1', fallbacks: ['.title'], type: 'text' },
    };

    const detailSchema: DetailSchema = {
      url_patterns: ['/property/*'],
      slot_selectors: slotSelectors,
      data_extractors: {
        epc_rating: { primary: '.epc', fallbacks: [], type: 'text' },
      },
    };

    const hint: ArchetypeHint = {
      archetype_id: 'golden_visa_buyer',
      signal: 'Site exclusively lists UAE off-plan properties',
      confidence_boost: 0.2,
    };

    const schema: TenantSiteSchema = {
      tenant_id: 'tenant-test-001',
      domain: 'example-realty.com',
      detected_at: '2026-05-11T00:00:00.000Z',
      detection_source: 'json_ld',
      detection_confidence: 0.95,
      framework_hint: 'react',
      index_schema: indexSchema,
      detail_schema: detailSchema,
      archetype_hints: [hint],
      last_validated: '2026-05-11T00:00:00.000Z',
      validation_health: 1.0,
    };

    expect(schema.tenant_id).toBe('tenant-test-001');
    expect(schema.index_schema.reorder_capable).toBe(true);
    expect(schema.index_schema.container_selector).toBe('.listings-grid');
    expect(schema.index_schema.data_extractors_per_card.price?.type).toBe('currency');
  });

  it('constructs a ReorderDirective value', () => {
    const directive: ReorderDirective = {
      type: 'reorder',
      container_selector: '.listings-grid',
      item_selector: '.listing-card',
      score_function: 'archetype_affinity',
      scores: [
        { listing_id: 'listing-abc', score: 0.92 },
        { listing_id: 'listing-def', score: 0.71 },
      ],
      pin_top_n: 1,
      archetype: 'golden_visa_buyer',
      confidence: 0.88,
    };

    expect(directive.type).toBe('reorder');
    expect(directive.scores).toHaveLength(2);
  });

  it('PageType is a string literal union', () => {
    const index: PageType = 'index';
    const detail: PageType = 'detail';
    const unknown: PageType = 'unknown';
    expect([index, detail, unknown]).toHaveLength(3);
  });

  it('DataExtractorsPerCard accepts all optional fields', () => {
    const extractors: DataExtractorsPerCard = {
      has_pool: { primary: '[data-pool]', fallbacks: [], type: 'boolean' },
      is_offplan: { primary: '[data-offplan]', fallbacks: [], type: 'boolean' },
      has_live_session: { primary: '[data-live]', fallbacks: [], type: 'boolean' },
      price_per_sqm: { primary: '.price-sqm', fallbacks: [], type: 'currency', currency: 'AED' },
    };
    expect(extractors.has_pool?.type).toBe('boolean');
  });
});
