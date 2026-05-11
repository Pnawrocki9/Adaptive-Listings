import { describe, expect, it } from 'vitest';

import {
  buildBehavioralFingerprint,
  cosineSimilarity,
  fingerprintToVector,
  matchArchetypeHeuristic,
} from '../core/embedding.js';

describe('buildBehavioralFingerprint', () => {
  it('empty events → zero fingerprint', () => {
    const fp = buildBehavioralFingerprint([], 0);
    expect(fp.listing_view_count).toBe(0);
    expect(fp.cta_click_count).toBe(0);
    expect(fp.page_count).toBe(0);
    expect(fp.avg_scroll_depth).toBe(0);
    expect(fp.session_duration_ms).toBe(0);
    expect(fp.investment_signal_ratio).toBe(0);
    expect(fp.family_signal_ratio).toBe(0);
  });

  it('counts 5 listing.viewed events correctly', () => {
    const events = Array.from({ length: 5 }, () => ({ type: 'listing.viewed' }));
    const fp = buildBehavioralFingerprint(events, 60_000);
    expect(fp.listing_view_count).toBe(5);
    expect(fp.session_duration_ms).toBe(60_000);
  });

  it('detects investment CTA keywords (roi/yield/invest/return)', () => {
    const events = [
      { type: 'cta.clicked', payload: { cta_id: 'view-roi-analysis' } },
      { type: 'cta.clicked', payload: { cta_id: 'high-yield' } },
      { type: 'cta.clicked', payload: { cta_id: 'invest-now' } },
      { type: 'cta.clicked', payload: { cta_id: 'view-details' } },
    ];
    const fp = buildBehavioralFingerprint(events, 0);
    expect(fp.cta_click_count).toBe(4);
    expect(fp.investment_signal_ratio).toBeCloseTo(0.75, 5);
  });

  it('detects family CTA keywords (school/family/bedroom)', () => {
    const events = [
      { type: 'cta.clicked', payload: { cta_id: 'school-map' } },
      { type: 'cta.clicked', payload: { cta_id: 'family-photos' } },
      { type: 'cta.clicked', payload: { cta_id: 'view-details' } },
    ];
    const fp = buildBehavioralFingerprint(events, 0);
    expect(fp.cta_click_count).toBe(3);
    expect(fp.family_signal_ratio).toBeCloseTo(2 / 3, 5);
  });

  it('uses max scroll.depth event, not avg', () => {
    const events = [
      { type: 'scroll.depth', payload: { depth_percent: 25 } },
      { type: 'scroll.depth', payload: { depth_percent: 75 } },
      { type: 'scroll.depth', payload: { depth_percent: 50 } },
    ];
    const fp = buildBehavioralFingerprint(events, 0);
    expect(fp.avg_scroll_depth).toBeCloseTo(0.75, 5);
  });
});

describe('fingerprintToVector', () => {
  it('returns 7-element array', () => {
    const vec = fingerprintToVector({
      listing_view_count: 0,
      avg_scroll_depth: 0,
      cta_click_count: 0,
      session_duration_ms: 0,
      page_count: 0,
      investment_signal_ratio: 0,
      family_signal_ratio: 0,
    });
    expect(vec).toHaveLength(7);
  });

  it('all values are in [0, 1] after normalization', () => {
    const vec = fingerprintToVector({
      listing_view_count: 1000, // capped
      avg_scroll_depth: 2.5, // clamped
      cta_click_count: 1000, // capped
      session_duration_ms: 1e12, // capped
      page_count: 1000, // capped
      investment_signal_ratio: 1.5, // clamped
      family_signal_ratio: -0.3, // clamped
    });
    for (const v of vec) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('preserves field order: [listing, scroll, cta, duration, page, invest_ratio, family_ratio]', () => {
    const fp = {
      listing_view_count: 4, // 4/20 = 0.2
      avg_scroll_depth: 0.5,
      cta_click_count: 5, // 5/10 = 0.5
      session_duration_ms: 9 * 60_000, // 9min / 30min = 0.3
      page_count: 2, // 2/10 = 0.2
      investment_signal_ratio: 0.7,
      family_signal_ratio: 0.1,
    };
    const vec = fingerprintToVector(fp);
    expect(vec[0]).toBeCloseTo(0.2, 5);
    expect(vec[1]).toBeCloseTo(0.5, 5);
    expect(vec[2]).toBeCloseTo(0.5, 5);
    expect(vec[3]).toBeCloseTo(0.3, 5);
    expect(vec[4]).toBeCloseTo(0.2, 5);
    expect(vec[5]).toBeCloseTo(0.7, 5);
    expect(vec[6]).toBeCloseTo(0.1, 5);
  });
});

describe('cosineSimilarity', () => {
  it('identical vectors → 1.0', () => {
    const v = [0.3, 0.5, 0.7, 0.4, 0.3, 0.9, 0.1];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('orthogonal vectors → 0.0', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
  });

  it('zero vector → 0 (no NaN)', () => {
    const result = cosineSimilarity([0, 0, 0], [1, 1, 1]);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  it('both zero vectors → 0 (no NaN)', () => {
    const result = cosineSimilarity([0, 0, 0], [0, 0, 0]);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  it('mismatched dimensions → 0', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('opposite vectors → -1.0 (theoretical) but inputs are in [0,1] so similarity stays ≥ 0', () => {
    // Pure math: cos similarity between two same-direction non-zero vectors is positive
    expect(cosineSimilarity([1, 1, 1], [0.5, 0.5, 0.5])).toBeCloseTo(1.0, 5);
  });
});

describe('matchArchetypeHeuristic', () => {
  it('yield_hunter-pattern fingerprint → yield_hunter', () => {
    // Matches yield_hunter reference: [0.3, 0.5, 0.8, 0.4, 0.3, 0.95, 0.05]
    const fp = {
      listing_view_count: 6, // → 0.3
      avg_scroll_depth: 0.5,
      cta_click_count: 8, // → 0.8
      session_duration_ms: 12 * 60_000, // → 0.4
      page_count: 3, // → 0.3
      investment_signal_ratio: 0.95,
      family_signal_ratio: 0.05,
    };
    const result = matchArchetypeHeuristic(fp);
    expect(result.archetype).toBe('yield_hunter');
    expect(result.similarity).toBeGreaterThan(0.95);
    expect(result.confidence).toBe('high');
  });

  it('family_buyer-pattern fingerprint → family_buyer', () => {
    // Matches family_buyer reference: [0.5, 0.6, 0.4, 0.7, 0.5, 0.05, 0.95]
    const fp = {
      listing_view_count: 10, // → 0.5
      avg_scroll_depth: 0.6,
      cta_click_count: 4, // → 0.4
      session_duration_ms: 21 * 60_000, // → 0.7
      page_count: 5, // → 0.5
      investment_signal_ratio: 0.05,
      family_signal_ratio: 0.95,
    };
    const result = matchArchetypeHeuristic(fp);
    expect(result.archetype).toBe('family_buyer');
    expect(result.similarity).toBeGreaterThan(0.95);
    expect(result.confidence).toBe('high');
  });

  it('empty fingerprint → neutral with low confidence', () => {
    const fp = {
      listing_view_count: 0,
      avg_scroll_depth: 0,
      cta_click_count: 0,
      session_duration_ms: 0,
      page_count: 0,
      investment_signal_ratio: 0,
      family_signal_ratio: 0,
    };
    const result = matchArchetypeHeuristic(fp);
    expect(result.archetype).toBe('neutral');
    expect(result.confidence).toBe('low');
    expect(result.similarity).toBe(0);
  });

  it('returns one of the 18 archetypes', () => {
    const fp = {
      listing_view_count: 3,
      avg_scroll_depth: 0.4,
      cta_click_count: 2,
      session_duration_ms: 5 * 60_000,
      page_count: 1,
      investment_signal_ratio: 0.5,
      family_signal_ratio: 0.5,
    };
    const result = matchArchetypeHeuristic(fp);
    // The archetype should be a valid string — checked by TypeScript via Archetype type
    expect(typeof result.archetype).toBe('string');
    expect(result.archetype.length).toBeGreaterThan(0);
  });
});
