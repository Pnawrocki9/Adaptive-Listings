// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';

import { fetchDirectives, applyDirectives } from '../core/adapt.js';
import type { AdaptResponse, Directive } from '../core/adapt.js';
import type { SdkConfig } from '../core/config.js';
import type { SessionState } from '../core/session.js';

const BASE_CONFIG: SdkConfig = {
  apiKey: 'EXAMPLE_api_key',
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  tier: 'observer',
  debug: false,
  consentState: 'legitimate_interest',
};

const SESSION: SessionState = {
  sessionId: 'abc123def456',
  startedAt: Date.now(),
  pageCount: 1,
};

const MOCK_RESPONSE: AdaptResponse = {
  session_id: 'abc123def456',
  archetype: 'investor',
  confidence: 0.87,
  directives: [
    { slot: 'hero_headline', type: 'text', value: 'High-yield investment opportunities' },
    { slot: 'cta_label', type: 'text', value: 'View ROI analysis' },
  ],
  ttl_seconds: 300,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchDirectives', () => {
  it('returns null when decisionApiUrl is not set', async () => {
    const result = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list');
    expect(result).toBeNull();
  });

  it('returns null on network error (fails silently)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network error'))),
    );

    const config: SdkConfig = { ...BASE_CONFIG, decisionApiUrl: 'https://decision.estalara.com' };
    const result = await fetchDirectives(config, SESSION, 'listing_list');
    expect(result).toBeNull();
  });

  it('returns null on non-OK HTTP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 503,
        }),
      ),
    );

    const config: SdkConfig = { ...BASE_CONFIG, decisionApiUrl: 'https://decision.estalara.com' };
    const result = await fetchDirectives(config, SESSION, 'listing_list');
    expect(result).toBeNull();
  });

  it('returns AdaptResponse on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(MOCK_RESPONSE),
        }),
      ),
    );

    const config: SdkConfig = { ...BASE_CONFIG, decisionApiUrl: 'https://decision.estalara.com' };
    const result = await fetchDirectives(config, SESSION, 'listing_list');
    expect(result).not.toBeNull();
    expect(result?.archetype).toBe('investor');
    expect(result?.directives).toHaveLength(2);
  });

  it('sends archetypeHint in request body when provided', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_RESPONSE),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const config: SdkConfig = { ...BASE_CONFIG, decisionApiUrl: 'https://decision.estalara.com' };
    await fetchDirectives(config, SESSION, 'listing_detail', 'family_buyer');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/adapt'),
      expect.objectContaining({
        body: expect.stringContaining('family_buyer') as unknown,
      }),
    );
  });
});

describe('applyDirectives', () => {
  it('sets textContent on matching slot elements', () => {
    const el = document.createElement('h1');
    el.setAttribute('data-estalara-slot', 'hero_headline');
    document.body.appendChild(el);

    const directives: Directive[] = [
      { slot: 'hero_headline', type: 'text', value: 'Find your dream home' },
    ];
    applyDirectives(directives);

    expect(el.textContent).toBe('Find your dream home');
    document.body.removeChild(el);
  });

  it('adds CSS classes for class directives', () => {
    const el = document.createElement('div');
    el.setAttribute('data-estalara-slot', 'highlight');
    document.body.appendChild(el);

    const directives: Directive[] = [
      { slot: 'highlight', type: 'class', value: ['investment-badge', 'featured'] },
    ];
    applyDirectives(directives);

    expect(el.classList.contains('investment-badge')).toBe(true);
    expect(el.classList.contains('featured')).toBe(true);
    document.body.removeChild(el);
  });

  it('handles empty directives array without throwing', () => {
    expect(() => {
      applyDirectives([]);
    }).not.toThrow();
  });

  it('ignores directives for unknown slots gracefully', () => {
    const directives: Directive[] = [
      { slot: 'nonexistent_slot_xyz', type: 'text', value: 'ignored' },
    ];
    expect(() => {
      applyDirectives(directives);
    }).not.toThrow();
  });

  it('handles order and visibility directive types without throwing', () => {
    const directives: Directive[] = [
      { slot: 'listing_grid', type: 'order', value: ['id3', 'id1', 'id2'] },
      { slot: 'promo_banner', type: 'visibility', value: 'hidden' },
    ];
    expect(() => {
      applyDirectives(directives);
    }).not.toThrow();
  });

  it('returns early in non-browser environments', () => {
    vi.stubGlobal('document', undefined);
    expect(() => {
      applyDirectives([{ slot: 'test', type: 'text', value: 'hello' }]);
    }).not.toThrow();
  });
});
