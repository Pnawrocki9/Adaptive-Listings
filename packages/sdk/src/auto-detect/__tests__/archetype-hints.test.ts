// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { TenantSiteSchema } from '@estalara/shared';
import { extractArchetypeHints } from '../archetype-hints.js';

// ─── Schema fixture builder ───────────────────────────────────────────────────

interface BuildSchemaOptions {
  detection_source?: TenantSiteSchema['detection_source'];
  currency?: 'EUR' | 'USD' | 'GBP' | 'PLN' | 'AED';
  domain?: string;
}

function buildSchema(opts: BuildSchemaOptions = {}): TenantSiteSchema {
  return {
    tenant_id: 't-test',
    domain: opts.domain ?? 'example.com',
    detected_at: '2026-01-01T00:00:00Z',
    detection_source: opts.detection_source ?? 'data_testid',
    detection_confidence: 0.92,
    index_schema: {
      url_patterns: ['/listings*'],
      listing_card_selector: '[data-testid="listing-card"]',
      card_field_mappings: opts.currency
        ? {
            price: {
              primary: '[data-testid="price"]',
              fallbacks: [],
              type: 'currency',
              currency: opts.currency,
            },
          }
        : {},
      data_extractors_per_card: {},
      reorder_capable: false,
    },
    detail_schema: {
      url_patterns: ['/property/*'],
      slot_selectors: {},
      data_extractors: {},
    },
    archetype_hints: [],
  };
}

// ─── Test fixtures (minimal HTML snippets) ────────────────────────────────────

const BAYUT_HTML = `
<html><body>
  <h1>Off-Plan Apartments in Dubai</h1>
  <p>Handover Q4 2027 — exceptional rental yield potential for investors.</p>
  <p>Regulatory information: RERA permit number 12345. DLD registered.</p>
  <p>Freehold ownership available for international buyers seeking golden visa eligibility.</p>
  <p>Investment opportunity with strong capital growth.</p>
</body></html>
`;

const KYERO_HTML = `
<html><body>
  <h1>Properties for Sale in Spain</h1>
  <p>Welcome to our international school district — large expat community in Costa del Sol.</p>
  <p>Many of our furnished villas are turnkey rental ready — perfect for Airbnb / vacation rental.</p>
  <p>Information for non-resident foreign buyers available in English speaking offices.</p>
</body></html>
`;

const KNIGHT_FRANK_HTML = `
<html><body>
  <h1>Exclusive Prime Central London Properties</h1>
  <p>Off-market penthouse in a prime location. Private viewing by appointment.</p>
  <p>Private banking introductions available for international clients.</p>
</body></html>
`;

const OTODOM_HTML = `
<html><body>
  <h1>Mieszkania na sprzedaż w Warszawie</h1>
  <p>Family home in safe neighbourhood — close to kindergarten and playground.</p>
  <p>First-time buyer? See our mortgage calculator and affordability tool.</p>
</body></html>
`;

const RIGHTMOVE_HTML = `
<html><body>
  <h1>Properties for Sale in London</h1>
  <p>Help to Buy and stamp duty calculator available.</p>
  <p>Family home near excellent school district — Ofsted Outstanding.</p>
</body></html>
`;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('extractArchetypeHints — Bayut (Dubai)', () => {
  const schema = buildSchema({
    detection_source: 'data_testid',
    currency: 'AED',
    domain: 'bayut.com',
  });
  const hints = extractArchetypeHints(
    schema,
    BAYUT_HTML,
    'https://www.bayut.com/to-rent/apartments/dubai/',
  );

  it('produces golden_visa_buyer hint with strong boost (>0.15)', () => {
    const goldenVisa = hints.find((h) => h.archetype_id === 'golden_visa_buyer');
    expect(goldenVisa).toBeDefined();
    expect(goldenVisa!.confidence_boost).toBeGreaterThan(0.15);
  });

  it('produces yield_hunter hint', () => {
    const yieldHunter = hints.find((h) => h.archetype_id === 'yield_hunter');
    expect(yieldHunter).toBeDefined();
    expect(yieldHunter!.confidence_boost).toBeGreaterThan(0.1);
  });

  it('produces vacation_rental_investor hint', () => {
    const vri = hints.find((h) => h.archetype_id === 'vacation_rental_investor');
    expect(vri).toBeDefined();
  });

  it('all hints respect the 0.30 cap', () => {
    for (const h of hints) {
      expect(h.confidence_boost).toBeLessThanOrEqual(0.3);
    }
  });

  it('hints are sorted by confidence_boost descending', () => {
    for (let i = 1; i < hints.length; i++) {
      const prev = hints[i - 1]!.confidence_boost;
      const curr = hints[i]!.confidence_boost;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

describe('extractArchetypeHints — Kyero (Spain expat)', () => {
  const schema = buildSchema({
    detection_source: 'json_ld',
    currency: 'EUR',
    domain: 'kyero.com',
  });
  const hints = extractArchetypeHints(
    schema,
    KYERO_HTML,
    'https://www.kyero.com/en/properties-for-sale/spain',
  );

  it('produces lifestyle_expat hint (>0.10)', () => {
    const expat = hints.find((h) => h.archetype_id === 'lifestyle_expat');
    expect(expat).toBeDefined();
    expect(expat!.confidence_boost).toBeGreaterThan(0.1);
  });

  it('produces vacation_rental_investor hint', () => {
    const vri = hints.find((h) => h.archetype_id === 'vacation_rental_investor');
    expect(vri).toBeDefined();
  });
});

describe('extractArchetypeHints — Knight Frank (luxury)', () => {
  const schema = buildSchema({
    detection_source: 'angular',
    currency: 'GBP',
    domain: 'knightfrank.com',
  });
  const hints = extractArchetypeHints(
    schema,
    KNIGHT_FRANK_HTML,
    'https://www.knightfrank.com/properties/',
  );

  it('produces luxury_buyer hint with strong boost (>0.20)', () => {
    const luxury = hints.find((h) => h.archetype_id === 'luxury_buyer');
    expect(luxury).toBeDefined();
    expect(luxury!.confidence_boost).toBeGreaterThan(0.2);
  });
});

describe('extractArchetypeHints — Otodom (Poland)', () => {
  const schema = buildSchema({
    detection_source: 'data_testid',
    currency: 'PLN',
    domain: 'otodom.pl',
  });
  const hints = extractArchetypeHints(
    schema,
    OTODOM_HTML,
    'https://www.otodom.pl/pl/oferty/sprzedaz/mieszkanie/',
  );

  it('produces family_buyer hint', () => {
    const family = hints.find((h) => h.archetype_id === 'family_buyer');
    expect(family).toBeDefined();
  });

  it('produces first_time_buyer hint', () => {
    const ftb = hints.find((h) => h.archetype_id === 'first_time_buyer');
    expect(ftb).toBeDefined();
  });
});

describe('extractArchetypeHints — Rightmove (UK mainstream)', () => {
  const schema = buildSchema({
    detection_source: 'css_modules',
    currency: 'GBP',
    domain: 'rightmove.co.uk',
  });
  const hints = extractArchetypeHints(
    schema,
    RIGHTMOVE_HTML,
    'https://www.rightmove.co.uk/property-for-sale.html',
  );

  it('produces family_buyer hint', () => {
    const family = hints.find((h) => h.archetype_id === 'family_buyer');
    expect(family).toBeDefined();
  });

  it('produces first_time_buyer hint with boost from HTML + URL signals', () => {
    const ftb = hints.find((h) => h.archetype_id === 'first_time_buyer');
    expect(ftb).toBeDefined();
    // 0.20 (HTML: stamp duty) + 0.10 (URL: rightmove) → capped at 0.30
    expect(ftb!.confidence_boost).toBeGreaterThan(0.2);
  });
});

describe('extractArchetypeHints — Estalara own platform', () => {
  it('returns empty array for data_estalara detection_source', () => {
    const schema = buildSchema({ detection_source: 'data_estalara', domain: 'app.estalara.com' });
    const hints = extractArchetypeHints(
      schema,
      '<html><body>anything</body></html>',
      'https://app.estalara.com/',
    );
    expect(hints).toHaveLength(0);
  });

  it('returns empty array even when HTML contains pattern keywords', () => {
    const schema = buildSchema({ detection_source: 'data_estalara' });
    const hints = extractArchetypeHints(
      schema,
      '<p>investment golden visa rental yield</p>',
      'https://app.estalara.com/listings',
    );
    expect(hints).toHaveLength(0);
  });
});

describe('extractArchetypeHints — capping, filtering, sorting', () => {
  it('caps summed boosts at 0.30 per archetype', () => {
    // Bayut HTML triggers MANY signals for golden_visa_buyer:
    //   - "golden visa" (0.25) + "RERA / DLD" (0.20) + "freehold" (0.10) + URL (0.20) + AED (0.20) → would be 0.95
    // Should be capped to 0.30.
    const schema = buildSchema({
      detection_source: 'data_testid',
      currency: 'AED',
      domain: 'bayut.com',
    });
    const hints = extractArchetypeHints(schema, BAYUT_HTML, 'https://www.bayut.com/');
    const goldenVisa = hints.find((h) => h.archetype_id === 'golden_visa_buyer');
    expect(goldenVisa!.confidence_boost).toBeCloseTo(0.3, 5);
  });

  it('filters out archetypes with boost <= 0.05', () => {
    // EUR currency alone only gives luxury_buyer +0.05 → should be filtered.
    const schema = buildSchema({ detection_source: 'json_ld', currency: 'EUR' });
    const hints = extractArchetypeHints(
      schema,
      '<p>nothing relevant here</p>',
      'https://generic.example.com/',
    );
    // JSON-LD adds yield_hunter +0.05 — also filtered.
    // EUR adds luxury_buyer +0.05 — also filtered.
    for (const h of hints) {
      expect(h.confidence_boost).toBeGreaterThan(0.05);
    }
  });

  it('sorts hints by confidence_boost descending', () => {
    const schema = buildSchema({
      detection_source: 'data_testid',
      currency: 'AED',
      domain: 'bayut.com',
    });
    const hints = extractArchetypeHints(schema, BAYUT_HTML, 'https://www.bayut.com/');
    expect(hints.length).toBeGreaterThan(1);
    for (let i = 1; i < hints.length; i++) {
      const prev = hints[i - 1]!.confidence_boost;
      const curr = hints[i]!.confidence_boost;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it('returns empty array when no signals fire', () => {
    const schema = buildSchema({ detection_source: 'article_tag' });
    const hints = extractArchetypeHints(
      schema,
      '<p>completely neutral content</p>',
      'https://unknown.example.com/',
    );
    expect(hints).toHaveLength(0);
  });
});

describe('extractArchetypeHints — individual signal coverage', () => {
  it('detects retiree_relocator from retirement language', () => {
    const schema = buildSchema({ detection_source: 'article_tag' });
    const html =
      '<p>retire to a peaceful countryside retreat — accessible ground floor lift access</p>';
    const hints = extractArchetypeHints(schema, html, 'https://example.com/');
    expect(hints.find((h) => h.archetype_id === 'retiree_relocator')).toBeDefined();
  });

  it('detects diaspora_buyer from "buy from abroad" language', () => {
    const schema = buildSchema({ detection_source: 'article_tag' });
    const html = '<p>buy from abroad — overseas buyer service for diaspora clients</p>';
    const hints = extractArchetypeHints(schema, html, 'https://example.com/');
    expect(hints.find((h) => h.archetype_id === 'diaspora_buyer')).toBeDefined();
  });

  it('detects second_home_buyer from holiday home language', () => {
    const schema = buildSchema({ detection_source: 'article_tag' });
    const html =
      '<p>beachfront holiday home — second residence in coastal village, weekend retreat</p>';
    const hints = extractArchetypeHints(schema, html, 'https://example.com/');
    expect(hints.find((h) => h.archetype_id === 'second_home_buyer')).toBeDefined();
  });

  it('detects student_parent from near-university language', () => {
    const schema = buildSchema({ detection_source: 'article_tag' });
    const html = '<p>near university — purpose built student accommodation (PBSA) options</p>';
    const hints = extractArchetypeHints(schema, html, 'https://example.com/');
    expect(hints.find((h) => h.archetype_id === 'student_parent')).toBeDefined();
  });

  it('detects remote_worker from home office language', () => {
    const schema = buildSchema({ detection_source: 'article_tag' });
    const html = '<p>dedicated home office with fibre broadband and fast internet</p>';
    const hints = extractArchetypeHints(schema, html, 'https://example.com/');
    expect(hints.find((h) => h.archetype_id === 'remote_worker')).toBeDefined();
  });

  it('detects flip_investor from renovation language', () => {
    const schema = buildSchema({ detection_source: 'article_tag' });
    const html = '<p>renovation property — motivated seller, below market value</p>';
    const hints = extractArchetypeHints(schema, html, 'https://example.com/');
    expect(hints.find((h) => h.archetype_id === 'flip_investor')).toBeDefined();
  });

  it('WordPress detection_source biases toward family + first-time buyer', () => {
    const schema = buildSchema({ detection_source: 'wordpress' });
    const hints = extractArchetypeHints(schema, '<p>generic</p>', 'https://wp-site.example.com/');
    // family_buyer = 0.10 (WordPress) → passes threshold, FTB = 0.05 (WordPress) → filtered.
    expect(hints.find((h) => h.archetype_id === 'family_buyer')).toBeDefined();
  });

  it('Drupal detection_source biases toward family_buyer', () => {
    const schema = buildSchema({ detection_source: 'drupal' });
    const hints = extractArchetypeHints(
      schema,
      '<p>generic</p>',
      'https://drupal-site.example.com/',
    );
    expect(hints.find((h) => h.archetype_id === 'family_buyer')).toBeDefined();
  });

  it('detects luxury_buyer from luxury brokerage URL alone', () => {
    const schema = buildSchema({ detection_source: 'angular', domain: 'knightfrank.com' });
    const hints = extractArchetypeHints(
      schema,
      '<p>generic property listing</p>',
      'https://www.knightfrank.com/properties/london/',
    );
    const luxury = hints.find((h) => h.archetype_id === 'luxury_buyer');
    expect(luxury).toBeDefined();
    expect(luxury!.confidence_boost).toBeGreaterThanOrEqual(0.25);
  });
});

describe('extractArchetypeHints — robustness', () => {
  it('handles empty HTML gracefully', () => {
    const schema = buildSchema({
      detection_source: 'data_testid',
      currency: 'AED',
      domain: 'bayut.com',
    });
    const hints = extractArchetypeHints(schema, '', 'https://www.bayut.com/');
    // Only schema + URL signals should fire.
    expect(hints.find((h) => h.archetype_id === 'golden_visa_buyer')).toBeDefined();
  });

  it('handles empty URL gracefully', () => {
    const schema = buildSchema({ detection_source: 'data_testid', currency: 'AED' });
    const hints = extractArchetypeHints(schema, BAYUT_HTML, '');
    // HTML + schema (AED) signals should still produce hints.
    expect(hints.length).toBeGreaterThan(0);
  });

  it('produces signal strings that reference triggering signals', () => {
    const schema = buildSchema({
      detection_source: 'data_testid',
      currency: 'AED',
      domain: 'bayut.com',
    });
    const hints = extractArchetypeHints(schema, BAYUT_HTML, 'https://www.bayut.com/');
    for (const h of hints) {
      expect(h.signal).toBeTruthy();
      expect(typeof h.signal).toBe('string');
    }
  });
});
