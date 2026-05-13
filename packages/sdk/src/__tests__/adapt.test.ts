// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import {
  fetchDirectives,
  applyDirectives,
  resetAdaptState,
  setEventQueueRef,
} from '../core/adapt.js';
import type { AdaptResponse } from '../core/adapt.js';
import type { SdkConfig } from '../core/config.js';
import type { SessionState } from '../core/session.js';
import { initIntentState } from '../core/intent.js';
import type { IntentState } from '../core/intent.js';
import type { TextDirective, ClassDirective } from '@estalara/shared';
import type { CollectedEvent } from '../core/events.js';

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
    {
      type: 'text',
      slot: 'hero_headline',
      value: 'High-yield investment opportunities',
      archetype: 'yield_hunter',
      confidence: 0.87,
    },
    {
      type: 'text',
      slot: 'cta_label',
      value: 'View ROI analysis',
      archetype: 'yield_hunter',
      confidence: 0.87,
    },
  ] as TextDirective[],
  ttl_seconds: 300,
};

/** Shared event queue for tests that need to verify adapt events. */
let testEventQueue: CollectedEvent[];

beforeEach(() => {
  testEventQueue = [];
  setEventQueueRef(testEventQueue);
  resetAdaptState();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAdaptState();
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchDirectives
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchDirectives', () => {
  it('returns null when decisionApiUrl is not set', async () => {
    const result = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list');
    expect(result).toBeNull();
  });

  it('returns null when tenantId is not set', async () => {
    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com',
      // tenantId intentionally omitted
    };
    const result = await fetchDirectives(config, SESSION, 'listing_list');
    expect(result).toBeNull();
  });

  it('returns null on network error (fails silently)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network error'))),
    );

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
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

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
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

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    const result = await fetchDirectives(config, SESSION, 'listing_list');
    expect(result).not.toBeNull();
    expect(result?.archetype).toBe('investor');
    expect(result?.directives).toHaveLength(2);
  });

  it('sends Authorization: Bearer header with apiKey', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_RESPONSE),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    await fetchDirectives(config, SESSION, 'listing_list');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/adapt'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${config.apiKey}`,
        }) as unknown,
      }),
    );
  });

  it('sends tenant_id in request body', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_RESPONSE),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const tenantId = '550e8400-e29b-41d4-a716-446655440000';
    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com',
      tenantId,
    };
    await fetchDirectives(config, SESSION, 'listing_list');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/adapt'),
      expect.objectContaining({
        body: expect.stringContaining(tenantId) as unknown,
      }),
    );
  });

  it('does not send api_key in request body', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_RESPONSE),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    await fetchDirectives(config, SESSION, 'listing_list');

    const [, requestInit] = mockFetch.mock.lastCall as unknown as [string, RequestInit];
    expect(requestInit).toBeDefined();
    expect(requestInit.body as string).not.toContain('api_key');
  });

  it('sends archetype_hint, confidence, and similarity from intentState in request body', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_RESPONSE),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    const intentState: IntentState = {
      ...initIntentState(),
      archetype: 'family_buyer',
      confidence: 0.72,
    };
    await fetchDirectives(config, SESSION, 'listing_detail', intentState);

    const [, requestInit] = mockFetch.mock.lastCall as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body.archetype_hint).toBe('family_buyer');
    expect(body.confidence).toBe(0.72);
    // similarity = probabilities[archetype] — base prior for family_buyer is 0.04
    expect(typeof body.similarity).toBe('number');
    expect(body.similarity).toBeGreaterThan(0);
  });

  it('sends no archetype fields when intentState is omitted', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_RESPONSE),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    await fetchDirectives(config, SESSION, 'listing_list');

    const [, requestInit] = mockFetch.mock.lastCall as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body.archetype_hint).toBeUndefined();
    expect(body.confidence).toBeUndefined();
    expect(body.similarity).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyDirectives — TextDirective
// ─────────────────────────────────────────────────────────────────────────────

describe('applyDirectives — TextDirective', () => {
  it('sets textContent on matching slot elements (no placeholders)', () => {
    const el = document.createElement('h1');
    el.setAttribute('data-estalara-slot', 'hero_headline');
    document.body.appendChild(el);

    const directives: TextDirective[] = [
      {
        type: 'text',
        slot: 'hero_headline',
        value: 'Find your dream home',
        archetype: 'yield_hunter',
        confidence: 0.9,
      },
    ];
    applyDirectives(directives, {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-001',
    });

    expect(el.textContent).toBe('Find your dream home');
    document.body.removeChild(el);
  });

  it('interpolates {bedrooms} placeholder from data-estalara-bedrooms attribute', () => {
    const el = document.createElement('h2');
    el.setAttribute('data-estalara-slot', 'headline');
    el.setAttribute('data-estalara-bedrooms', '4');
    document.body.appendChild(el);

    const directives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: '{bedrooms}BR Family Home',
        archetype: 'family_buyer',
        confidence: 0.85,
      },
    ];
    applyDirectives(directives, {
      archetypeId: 'family_buyer',
      confidence: 0.85,
      sessionId: 'sess-002',
    });

    expect(el.textContent).toBe('4BR Family Home');
    document.body.removeChild(el);
  });

  it('leaves {unknown_token} literal when attribute is missing, emits adapt.skipped warning', () => {
    const el = document.createElement('h2');
    el.setAttribute('data-estalara-slot', 'headline');
    // intentionally NO data-estalara-unknown-token attribute
    document.body.appendChild(el);

    const directives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Hello {unknown_token} World',
        archetype: 'family_buyer',
        confidence: 0.8,
      },
    ];
    applyDirectives(directives, {
      archetypeId: 'family_buyer',
      confidence: 0.8,
      sessionId: 'sess-003',
    });

    expect(el.textContent).toBe('Hello {unknown_token} World');

    const skipEvents = testEventQueue.filter((e) => e.type === 'adapt.skipped');
    expect(skipEvents.length).toBeGreaterThan(0);
    const reasons = skipEvents.map((e) => e.payload.reason);
    expect(reasons).toContain('unresolved_token_unknown_token');

    document.body.removeChild(el);
  });

  it('handles {school_rating} → data-estalara-school-rating (kebab conversion)', () => {
    const el = document.createElement('h2');
    el.setAttribute('data-estalara-slot', 'headline');
    el.setAttribute('data-estalara-school-rating', '9.2');
    document.body.appendChild(el);

    const directives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Near {school_rating}/10 rated schools',
        archetype: 'family_buyer',
        confidence: 0.8,
      },
    ];
    applyDirectives(directives, {
      archetypeId: 'family_buyer',
      confidence: 0.8,
      sessionId: 'sess-004',
    });

    expect(el.textContent).toBe('Near 9.2/10 rated schools');
    document.body.removeChild(el);
  });

  it('emits adapt.skipped when slot has no matching elements', () => {
    const directives: TextDirective[] = [
      {
        type: 'text',
        slot: 'nonexistent_slot_xyz',
        value: 'ignored',
        archetype: 'yield_hunter',
        confidence: 0.9,
      },
    ];
    expect(() => {
      applyDirectives(directives, {
        archetypeId: 'yield_hunter',
        confidence: 0.9,
        sessionId: 'sess-005',
      });
    }).not.toThrow();

    const skipEvents = testEventQueue.filter((e) => e.type === 'adapt.skipped');
    expect(skipEvents.length).toBeGreaterThan(0);
    const reasons = skipEvents.map((e) => e.payload.reason);
    expect(reasons).toContain('no_slot_elements');
  });

  it('emits adapt.applied event for successful application', () => {
    const el = document.createElement('h1');
    el.setAttribute('data-estalara-slot', 'headline');
    document.body.appendChild(el);

    const directives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Great Rental Property',
        archetype: 'yield_hunter',
        confidence: 0.9,
      },
    ];
    applyDirectives(directives, {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-006',
    });

    const appliedEvents = testEventQueue.filter((e) => e.type === 'adapt.applied');
    expect(appliedEvents.length).toBe(1);
    const firstEvent = appliedEvents[0];
    expect(firstEvent).toBeDefined();
    const payload = firstEvent!.payload;
    expect(payload.slot_or_selector).toBe('headline');
    expect(payload.archetype).toBe('yield_hunter');

    document.body.removeChild(el);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyDirectives — ClassDirective
// ─────────────────────────────────────────────────────────────────────────────

describe('applyDirectives — ClassDirective', () => {
  it('adds and removes CSS classes in correct order (add wins)', () => {
    const el = document.createElement('div');
    el.setAttribute('data-estalara-listing-id', 'villa-001');
    el.classList.add('estalara-suppress'); // pre-existing class to be removed
    document.body.appendChild(el);

    const directives: ClassDirective[] = [
      {
        type: 'class',
        selector: '[data-estalara-listing-id]',
        add: ['estalara-boost', 'featured'],
        remove: ['estalara-suppress'],
        archetype: 'yield_hunter',
        confidence: 0.9,
      },
    ];
    applyDirectives(directives, {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-007',
    });

    expect(el.classList.contains('estalara-boost')).toBe(true);
    expect(el.classList.contains('featured')).toBe(true);
    expect(el.classList.contains('estalara-suppress')).toBe(false);

    document.body.removeChild(el);
  });

  it('rejects disallowed selector (.tenant-class) and emits adapt.skipped, no DOM mutation', () => {
    const el = document.createElement('div');
    el.classList.add('tenant-class');
    document.body.appendChild(el);

    const directives: ClassDirective[] = [
      {
        type: 'class',
        selector: '.tenant-class', // disallowed — not [data-estalara-*]
        add: ['injected'],
        remove: [],
        archetype: 'yield_hunter',
        confidence: 0.9,
      },
    ];
    applyDirectives(directives, {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-008',
    });

    // No class mutation should have happened
    expect(el.classList.contains('injected')).toBe(false);

    const skipEvents = testEventQueue.filter((e) => e.type === 'adapt.skipped');
    expect(skipEvents.length).toBeGreaterThan(0);
    const reasons = skipEvents.map((e) => e.payload.reason);
    expect(reasons).toContain('disallowed_selector');

    document.body.removeChild(el);
  });

  it('rejects #id selector as disallowed', () => {
    const directives: ClassDirective[] = [
      {
        type: 'class',
        selector: '#some-id',
        add: ['foo'],
        remove: [],
        archetype: 'yield_hunter',
        confidence: 0.9,
      },
    ];
    applyDirectives(directives, {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-009',
    });

    const skipEvents = testEventQueue.filter((e) => e.type === 'adapt.skipped');
    expect(skipEvents.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe('applyDirectives — idempotency', () => {
  it('applies TextDirective only once even when called twice with same directive', () => {
    const el = document.createElement('h1');
    el.setAttribute('data-estalara-slot', 'headline');
    el.textContent = 'Original';
    document.body.appendChild(el);

    const directives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Adapted Headline',
        archetype: 'yield_hunter',
        confidence: 0.9,
      },
    ];
    const ctx = { archetypeId: 'yield_hunter' as const, confidence: 0.9, sessionId: 'sess-010' };

    applyDirectives(directives, ctx);
    // Change the DOM text directly to verify second call doesn't re-apply
    el.textContent = 'Manually changed';
    applyDirectives(directives, ctx);

    // Second call must be skipped — text stays as manually changed
    expect(el.textContent).toBe('Manually changed');

    // Event should only be emitted once
    const appliedEvents = testEventQueue.filter((e) => e.type === 'adapt.applied');
    expect(appliedEvents).toHaveLength(1);

    document.body.removeChild(el);
  });

  it('resetAdaptState() allows re-application after reset', () => {
    const el = document.createElement('h1');
    el.setAttribute('data-estalara-slot', 'headline');
    el.textContent = 'Original';
    document.body.appendChild(el);

    const directives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Adapted Headline',
        archetype: 'yield_hunter',
        confidence: 0.9,
      },
    ];
    const ctx = { archetypeId: 'yield_hunter' as const, confidence: 0.9, sessionId: 'sess-011' };

    applyDirectives(directives, ctx);
    expect(el.textContent).toBe('Adapted Headline');

    el.textContent = 'Reset text';
    resetAdaptState();
    testEventQueue.length = 0; // clear events for clean count

    applyDirectives(directives, ctx);
    // After reset, the directive must be re-applied
    expect(el.textContent).toBe('Adapted Headline');

    const appliedEvents = testEventQueue.filter((e) => e.type === 'adapt.applied');
    expect(appliedEvents).toHaveLength(1);

    document.body.removeChild(el);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('applyDirectives — edge cases', () => {
  it('handles empty directives array without throwing', () => {
    expect(() => {
      applyDirectives([]);
    }).not.toThrow();
  });

  it('returns early in non-browser environments', () => {
    const originalDocument = globalThis.document;
    vi.stubGlobal('document', undefined);
    try {
      expect(() => {
        applyDirectives([
          {
            type: 'text' as const,
            slot: 'test',
            value: 'hello',
            archetype: 'yield_hunter' as const,
            confidence: 0.9,
          },
        ]);
      }).not.toThrow();
    } finally {
      // Restore document so subsequent tests have DOM access
      vi.stubGlobal('document', originalDocument);
    }
  });

  it('does not throw for order and visibility directive types (unsupported — silently ignored)', () => {
    // Cast as unknown to test future-compat; these types are not yet implemented
    const directives = [
      { slot: 'listing_grid', type: 'order', value: ['id3', 'id1', 'id2'] },
      { slot: 'promo_banner', type: 'visibility', value: 'hidden' },
    ] as unknown as (TextDirective | ClassDirective)[];
    expect(() => {
      applyDirectives(directives);
    }).not.toThrow();
  });

  it('applies directives to multiple matching elements', () => {
    const els = [0, 1, 2].map(() => {
      const el = document.createElement('h2');
      el.setAttribute('data-estalara-slot', 'card-headline');
      document.body.appendChild(el);
      return el;
    });

    applyDirectives(
      [
        {
          type: 'text' as const,
          slot: 'card-headline',
          value: 'Batch Updated',
          archetype: 'yield_hunter' as const,
          confidence: 0.85,
        },
      ],
      { archetypeId: 'yield_hunter', confidence: 0.85, sessionId: 'sess-012' },
    );

    els.forEach((el) => {
      expect(el.textContent).toBe('Batch Updated');
    });
    els.forEach((el) => document.body.removeChild(el));
  });
});
