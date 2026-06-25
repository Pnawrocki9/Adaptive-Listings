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
import * as sessionModule from '../core/session.js';
import { initIntentState } from '../core/intent.js';
import type { IntentState } from '../core/intent.js';
import type { TextDirective, ClassDirective, ReorderDirective } from '@estalara/shared';
import type { CollectedEvent } from '../core/events.js';

const BASE_CONFIG: SdkConfig = {
  apiKey: 'EXAMPLE_api_key',
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  tier: 'observer',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#6c5ce7',
};

const SESSION: SessionState = {
  sessionId: 'abc123def456',
  startedAt: Date.now(),
  pageCount: 1,
};

// FOLLOW-105 §F.5: the SDK now validates adapt responses against the canonical
// AdaptationDirectives Zod schema (core/adapt-schema.ts). This fixture must therefore
// carry every REQUIRED field of that contract (adapt_decision_id, similarity,
// source, generated_at) and a valid archetype enum value (`yield_hunter`, not the
// pre-FOLLOW-105 placeholder `investor` which was never a real ArchetypeId).
const MOCK_RESPONSE: AdaptResponse = {
  adapt_decision_id: '11111111-1111-4111-8111-111111111111',
  session_id: 'abc123def456',
  archetype: 'yield_hunter',
  confidence: 0.87,
  similarity: 0.9,
  page_context: 1,
  source: 'playbook',
  generated_at: '2026-05-25T00:00:00.000Z',
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
  variant: 'control',
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
  it('returns null adaptResponse when decisionApiUrl is not set', async () => {
    const result = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list');
    expect(result.adaptResponse).toBeNull();
  });

  it('returns null adaptResponse when tenantId is not set', async () => {
    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      // tenantId intentionally omitted
    };
    const result = await fetchDirectives(config, SESSION, 'listing_list');
    expect(result.adaptResponse).toBeNull();
  });

  it('returns null adaptResponse on network error (fails silently)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network error'))),
    );

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    const result = await fetchDirectives(config, SESSION, 'listing_list');
    expect(result.adaptResponse).toBeNull();
  });

  it('returns null adaptResponse on non-OK HTTP response', async () => {
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
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    const result = await fetchDirectives(config, SESSION, 'listing_list');
    expect(result.adaptResponse).toBeNull();
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
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    const { adaptResponse: result } = await fetchDirectives(config, SESSION, 'listing_list');
    expect(result).not.toBeNull();
    expect(result?.archetype).toBe('yield_hunter');
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
      decisionApiUrl: 'https://decision.estalara.com/api',
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
      decisionApiUrl: 'https://decision.estalara.com/api',
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
      decisionApiUrl: 'https://decision.estalara.com/api',
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
      decisionApiUrl: 'https://decision.estalara.com/api',
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
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    await fetchDirectives(config, SESSION, 'listing_list');

    const [, requestInit] = mockFetch.mock.lastCall as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body.archetype_hint).toBeUndefined();
    expect(body.confidence).toBeUndefined();
    expect(body.similarity).toBeUndefined();
  });

  it('sends consent_state: "granted" when getConsentState returns "granted"', async () => {
    vi.spyOn(sessionModule, 'getConsentState').mockReturnValue('granted');
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_RESPONSE),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    await fetchDirectives(config, SESSION, 'listing_list');

    const [, requestInit] = mockFetch.mock.lastCall as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body.consent_state).toBe('granted');
  });

  it('sends consent_state: "denied" when getConsentState returns "denied"', async () => {
    vi.spyOn(sessionModule, 'getConsentState').mockReturnValue('denied');
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_RESPONSE),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    await fetchDirectives(config, SESSION, 'listing_list');

    const [, requestInit] = mockFetch.mock.lastCall as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body.consent_state).toBe('denied');
  });

  it('sends consent_state: "unknown" when getConsentState returns "pending"', async () => {
    vi.spyOn(sessionModule, 'getConsentState').mockReturnValue('pending');
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_RESPONSE),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    await fetchDirectives(config, SESSION, 'listing_list');

    const [, requestInit] = mockFetch.mock.lastCall as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    // 'pending' maps to 'unknown' — the conservative safe default for the Decision API gate
    expect(body.consent_state).toBe('unknown');
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

// ─────────────────────────────────────────────────────────────────────────────
// applyDirectives — ReorderDirective
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minimal grid fixture: container + N card divs each with data-estalara-listing-id. */
function buildGrid(ids: string[]): { container: HTMLElement; cards: HTMLElement[] } {
  const container = document.createElement('div');
  container.setAttribute('data-estalara-listings-grid', '');
  const cards = ids.map((id) => {
    const card = document.createElement('div');
    card.setAttribute('data-estalara-listing-id', id);
    card.textContent = id;
    container.appendChild(card);
    return card;
  });
  document.body.appendChild(container);
  return { container, cards };
}

function getCardOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-estalara-listing-id]')).map(
    (el) => el.getAttribute('data-estalara-listing-id') ?? '',
  );
}

describe('applyDirectives — ReorderDirective', () => {
  it('reorders DOM cards by score descending', () => {
    const { container } = buildGrid(['listing-a', 'listing-b', 'listing-c']);

    const directive: ReorderDirective = {
      type: 'reorder',
      container_selector: '[data-estalara-listings-grid]',
      item_selector: '[data-estalara-listing-id]',
      score_function: 'archetype_affinity',
      scores: [
        { listing_id: 'listing-a', score: 0.3 },
        { listing_id: 'listing-b', score: 0.9 },
        { listing_id: 'listing-c', score: 0.6 },
      ],
      archetype: 'yield_hunter',
      confidence: 0.8,
    };
    applyDirectives([directive], {
      archetypeId: 'yield_hunter',
      confidence: 0.8,
      sessionId: 'r-001',
    });

    expect(getCardOrder(container)).toEqual(['listing-b', 'listing-c', 'listing-a']);
    document.body.removeChild(container);
  });

  it('cards without listing_id go to the end', () => {
    const container = document.createElement('div');
    container.setAttribute('data-estalara-listings-grid', '');
    // Card with id
    const withId = document.createElement('div');
    withId.setAttribute('data-estalara-listing-id', 'listing-x');
    container.appendChild(withId);
    // Card without id
    const withoutId = document.createElement('div');
    withoutId.setAttribute('data-estalara-other', 'true');
    container.appendChild(withoutId);
    document.body.appendChild(container);

    const directive: ReorderDirective = {
      type: 'reorder',
      container_selector: '[data-estalara-listings-grid]',
      item_selector: '[data-estalara-listing-id], [data-estalara-other]',
      score_function: 'archetype_affinity',
      scores: [{ listing_id: 'listing-x', score: 0.7 }],
      archetype: 'yield_hunter',
      confidence: 0.8,
    };
    applyDirectives([directive], {
      archetypeId: 'yield_hunter',
      confidence: 0.8,
      sessionId: 'r-002',
    });

    const children = Array.from(container.children) as HTMLElement[];
    // listing-x should come before the one without id
    expect(children[0]?.getAttribute('data-estalara-listing-id')).toBe('listing-x');
    document.body.removeChild(container);
  });

  it('pin_top_n pins top N cards regardless of original order', () => {
    const { container } = buildGrid(['listing-1', 'listing-2', 'listing-3', 'listing-4']);

    const directive: ReorderDirective = {
      type: 'reorder',
      container_selector: '[data-estalara-listings-grid]',
      item_selector: '[data-estalara-listing-id]',
      score_function: 'archetype_affinity',
      scores: [
        { listing_id: 'listing-1', score: 0.2 },
        { listing_id: 'listing-2', score: 0.5 },
        { listing_id: 'listing-3', score: 0.9 },
        { listing_id: 'listing-4', score: 0.7 },
      ],
      pin_top_n: 2,
      archetype: 'yield_hunter',
      confidence: 0.8,
    };
    applyDirectives([directive], {
      archetypeId: 'yield_hunter',
      confidence: 0.8,
      sessionId: 'r-003',
    });

    const order = getCardOrder(container);
    // Top 2 by score: listing-3 (0.9), listing-4 (0.7) should be first
    expect(order[0]).toBe('listing-3');
    expect(order[1]).toBe('listing-4');
    document.body.removeChild(container);
  });

  it('idempotency: second call with same archetype/container is a no-op', () => {
    const { container } = buildGrid(['listing-p', 'listing-q', 'listing-r']);

    const directive: ReorderDirective = {
      type: 'reorder',
      container_selector: '[data-estalara-listings-grid]',
      item_selector: '[data-estalara-listing-id]',
      score_function: 'archetype_affinity',
      scores: [
        { listing_id: 'listing-p', score: 0.1 },
        { listing_id: 'listing-q', score: 0.8 },
        { listing_id: 'listing-r', score: 0.5 },
      ],
      archetype: 'yield_hunter',
      confidence: 0.8,
    };
    const ctx = { archetypeId: 'yield_hunter' as const, confidence: 0.8, sessionId: 'r-004' };

    applyDirectives([directive], ctx);
    const orderAfterFirst = getCardOrder(container);

    // Manually change the DOM order
    container.prepend(container.lastElementChild!);
    const orderAfterManual = getCardOrder(container);
    expect(orderAfterManual).not.toEqual(orderAfterFirst);

    // Second applyDirectives call must be a no-op due to idempotency
    applyDirectives([directive], ctx);
    expect(getCardOrder(container)).toEqual(orderAfterManual);

    document.body.removeChild(container);
  });

  it('missing container → emits adapt.skipped with reason no_container', () => {
    const directive: ReorderDirective = {
      type: 'reorder',
      container_selector: '[data-estalara-nonexistent-container]',
      item_selector: '[data-estalara-listing-id]',
      score_function: 'archetype_affinity',
      scores: [{ listing_id: 'listing-z', score: 0.9 }],
      archetype: 'yield_hunter',
      confidence: 0.8,
    };
    expect(() => {
      applyDirectives([directive], {
        archetypeId: 'yield_hunter',
        confidence: 0.8,
        sessionId: 'r-005',
      });
    }).not.toThrow();

    const skipEvents = testEventQueue.filter((e) => e.type === 'adapt.skipped');
    expect(skipEvents.length).toBeGreaterThan(0);
    expect(skipEvents.map((e) => e.payload.reason)).toContain('no_container');
  });

  it('empty item list → emits adapt.skipped with reason no_cards', () => {
    const container = document.createElement('div');
    container.setAttribute('data-estalara-listings-grid', '');
    // Container exists but has no matching item elements
    document.body.appendChild(container);

    const directive: ReorderDirective = {
      type: 'reorder',
      container_selector: '[data-estalara-listings-grid]',
      item_selector: '[data-estalara-listing-id]',
      score_function: 'archetype_affinity',
      scores: [],
      archetype: 'yield_hunter',
      confidence: 0.8,
    };
    expect(() => {
      applyDirectives([directive], {
        archetypeId: 'yield_hunter',
        confidence: 0.8,
        sessionId: 'r-006',
      });
    }).not.toThrow();

    const skipEvents = testEventQueue.filter((e) => e.type === 'adapt.skipped');
    expect(skipEvents.length).toBeGreaterThan(0);
    expect(skipEvents.map((e) => e.payload.reason)).toContain('no_cards');

    document.body.removeChild(container);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-042 — variant field on AdaptResponse
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchDirectives — FOLLOW-042 variant field', () => {
  it('returns AdaptResponse with variant present when server sends variant: "v1"', async () => {
    const responseWithVariant: AdaptResponse = {
      ...MOCK_RESPONSE,
      variant: 'v1',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(responseWithVariant),
        }),
      ),
    );

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    const { adaptResponse: result } = await fetchDirectives(config, SESSION, 'listing_list');
    expect(result).not.toBeNull();
    expect(result?.variant).toBe('v1');
  });

  it('returns AdaptResponse with variant: "v2" when server sends variant: "v2"', async () => {
    const responseWithV2: AdaptResponse = {
      ...MOCK_RESPONSE,
      variant: 'v2',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(responseWithV2),
        }),
      ),
    );

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    const { adaptResponse: result } = await fetchDirectives(config, SESSION, 'listing_list');
    expect(result?.variant).toBe('v2');
  });

  it('returns AdaptResponse with variant undefined when server omits the field', async () => {
    // Spread the (now schema-valid) MOCK_RESPONSE and strip `variant` so the
    // response still satisfies the required AdaptationDirectives contract.
    const { variant: _omit, ...responseNoVariant } = MOCK_RESPONSE;
    void _omit;

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(responseNoVariant),
        }),
      ),
    );

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    const { adaptResponse: result } = await fetchDirectives(config, SESSION, 'listing_list');
    expect(result).not.toBeNull();
    expect(result?.variant).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-041 — session-level variant cache + feedback ping
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchDirectives — FOLLOW-041 variant sessionStorage cache', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('caches variant in sessionStorage after fetchDirectives returns variant', async () => {
    const responseWithVariant: AdaptResponse = {
      ...MOCK_RESPONSE,
      session_id: 'TEST_SESSION',
      variant: 'v1',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(responseWithVariant),
        }),
      ),
    );

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    const session: SessionState = { ...SESSION, sessionId: 'TEST_SESSION' };

    await fetchDirectives(config, session, 'listing_list');

    expect(sessionStorage.getItem('estalara_variant:TEST_SESSION')).toBe('v1');
  });

  it('does not cache variant when server omits the variant field', async () => {
    const { variant: _omitVar, ...rest } = MOCK_RESPONSE;
    void _omitVar;
    const responseNoVariant: AdaptResponse = {
      ...rest,
      session_id: 'TEST_SESSION_NO_VAR',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(responseNoVariant),
        }),
      ),
    );

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    const session: SessionState = { ...SESSION, sessionId: 'TEST_SESSION_NO_VAR' };

    await fetchDirectives(config, session, 'listing_list');

    expect(sessionStorage.getItem('estalara_variant:TEST_SESSION_NO_VAR')).toBeNull();
  });
});

describe('fetchDirectives — FOLLOW-041 feedback ping on outcome event', () => {
  // Stub crypto.subtle so HMAC resolves synchronously (as a microtask Promise),
  // making test timing deterministic. FOLLOW-051: without this stub, the platform's
  // SubtleCrypto implementation may schedule the result as an I/O macrotask,
  // causing the fetch() call to land in the NEXT test's execution window.

  beforeEach(() => {
    sessionStorage.clear();
    // Stub importKey and sign to return Promises that resolve within the current
    // microtask queue. The actual HMAC value is irrelevant for these tests.
    const fakeKey = {} as CryptoKey;
    const fakeSigBytes = new Uint8Array(32).fill(0xaa); // 64 hex chars of 'aa'

    vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue(fakeKey);

    vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(fakeSigBytes.buffer);
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('POSTs feedback ping with correct body and HMAC signature when inquiry.completed fires', async () => {
    const sessionId = 'FEEDBACK_SESSION_001';
    const tenantId = '550e8400-e29b-41d4-a716-446655440000';
    const archetype = 'yield_hunter';

    const responseWithVariant: AdaptResponse = {
      ...MOCK_RESPONSE,
      session_id: sessionId,
      archetype,
      variant: 'v1',
    };

    // First fetch call = fetchDirectives; subsequent calls = feedback ping
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseWithVariant),
    });
    // Feedback ping response (fire-and-forget, body not checked by SDK)
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });
    vi.stubGlobal('fetch', mockFetch);

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId,
    };
    const session: SessionState = { ...SESSION, sessionId };

    await fetchDirectives(config, session, 'listing_list');

    // Dispatch the outcome event — listener should POST the feedback ping
    document.dispatchEvent(new Event('inquiry.completed'));

    // FOLLOW-051: postFeedbackPing now awaits HMAC-SHA256 before calling fetch.
    // A single Promise.resolve() tick is insufficient; flush via setTimeout macrotask.
    // FOLLOW-051: flush mocked crypto.subtle chain (importKey → sign → .then(fetch)).
    // Each awaited Promise.resolve() drains one layer of the microtask queue.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Verify feedback ping was fired
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const [feedbackUrl, feedbackInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(feedbackUrl).toContain('/api/adapt/feedback');
    expect(feedbackInit.method).toBe('POST');

    // FOLLOW-051: verify X-Estalara-Signature header is present (HMAC signed).
    // Crypto is mocked to return 0xaa*32 → 'aa'.repeat(32) hex string.
    const headers = feedbackInit.headers as Record<string, string>;
    expect(headers['X-Estalara-Signature']).toMatch(/^[0-9a-f]{64}$/);

    const body = JSON.parse(feedbackInit.body as string) as Record<string, unknown>;
    expect(body.session_id).toBe(sessionId);
    expect(body.tenant_id).toBe(tenantId);
    expect(body.archetype).toBe(archetype);
    expect(body.variant).toBe('v1');
    expect(body.converted).toBe(true);
    // FOLLOW-259: prediction_id must be present to activate §T Conversion Label Loop.
    expect(body.prediction_id).toBe(MOCK_RESPONSE.adapt_decision_id);
  });

  it('does not fire feedback ping when no variant is cached', async () => {
    const { variant: _omitV, ...restNoVar } = MOCK_RESPONSE;
    void _omitV;
    const responseNoVariant: AdaptResponse = {
      ...restNoVar,
      session_id: 'NO_VAR_SESSION',
      // variant absent
    };

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseNoVariant),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    };
    const session: SessionState = { ...SESSION, sessionId: 'NO_VAR_SESSION' };

    await fetchDirectives(config, session, 'listing_list');
    document.dispatchEvent(new Event('inquiry.completed'));

    // FOLLOW-051: flush mocked crypto.subtle chain (importKey → sign → .then(fetch)).
    // Each awaited Promise.resolve() drains one layer of the microtask queue.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Only the fetchDirectives call — no feedback ping
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('uses config.feedbackEvents when specified', async () => {
    const sessionId = 'CUSTOM_EVENT_SESSION';
    const tenantId = '550e8400-e29b-41d4-a716-446655440000';

    const responseWithVariant: AdaptResponse = {
      ...MOCK_RESPONSE,
      session_id: sessionId,
      variant: 'v1',
    };

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseWithVariant),
    });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });
    vi.stubGlobal('fetch', mockFetch);

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId,
      feedbackEvents: ['tour.requested'],
    };
    const session: SessionState = { ...SESSION, sessionId };

    await fetchDirectives(config, session, 'listing_list');

    // Default event should NOT trigger ping when feedbackEvents overrides it
    document.dispatchEvent(new Event('inquiry.completed'));
    // FOLLOW-051: flush mocked crypto.subtle chain (importKey → sign → .then(fetch)).
    // Each awaited Promise.resolve() drains one layer of the microtask queue.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(1); // only fetchDirectives

    // Custom event SHOULD trigger ping
    document.dispatchEvent(new Event('tour.requested'));
    // FOLLOW-051: flush mocked crypto.subtle chain (importKey → sign → .then(fetch)).
    // Each awaited Promise.resolve() drains one layer of the microtask queue.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const [, feedbackInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(feedbackInit.body as string) as Record<string, unknown>;
    expect(body.variant).toBe('v1');
    expect(body.converted).toBe(true);
  });

  it('uses config.feedbackUrl when specified instead of deriving from decisionApiUrl', async () => {
    const sessionId = 'FEEDBACK_URL_SESSION';
    const tenantId = '550e8400-e29b-41d4-a716-446655440000';
    const customFeedbackUrl = 'https://custom-feedback.example.com/feedback';

    const responseWithVariant: AdaptResponse = {
      ...MOCK_RESPONSE,
      session_id: sessionId,
      variant: 'v1',
    };

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseWithVariant),
    });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });
    vi.stubGlobal('fetch', mockFetch);

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId,
      feedbackUrl: customFeedbackUrl,
    };
    const session: SessionState = { ...SESSION, sessionId };

    await fetchDirectives(config, session, 'listing_list');
    document.dispatchEvent(new Event('inquiry.completed'));
    // FOLLOW-051: flush mocked crypto.subtle chain (importKey → sign → .then(fetch)).
    // Each awaited Promise.resolve() drains one layer of the microtask queue.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const [feedbackUrl] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(feedbackUrl).toBe(customFeedbackUrl);
  });

  it('does not throw when feedback ping fails (fire-and-forget, network error swallowed)', async () => {
    const sessionId = 'FAIL_PING_SESSION';
    const tenantId = '550e8400-e29b-41d4-a716-446655440000';

    const responseWithVariant: AdaptResponse = {
      ...MOCK_RESPONSE,
      session_id: sessionId,
      variant: 'v1',
    };

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseWithVariant),
    });
    // Feedback ping fails with network error
    mockFetch.mockRejectedValueOnce(new Error('network failure'));
    vi.stubGlobal('fetch', mockFetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId,
    };
    const session: SessionState = { ...SESSION, sessionId };

    await fetchDirectives(config, session, 'listing_list');

    // Dispatch outcome and flush all async work (HMAC + fetch rejection + catch).
    document.dispatchEvent(new Event('inquiry.completed'));
    // FOLLOW-051: flush mocked crypto.subtle chain: importKey (tick 1) → sign (tick 2)
    // → .then(fetch) (tick 3) → fetch rejects (tick 4) → .catch(warn) (tick 5).
    // Six ticks provides buffer for platform microtask scheduling variance.
    for (let i = 0; i < 6; i++) await Promise.resolve();

    // Must not throw; console.warn is called with the error message
    expect(warnSpy).toHaveBeenCalledWith('[estalara] feedback ping failed:', 'network failure');

    warnSpy.mockRestore();
  });

  it('FOLLOW-259: includes prediction_id and lead_id in feedback ping body', async () => {
    const sessionId = 'FOLLOW259_SESSION';
    const tenantId = '550e8400-e29b-41d4-a716-446655440000';
    const leadId = 'deadbeef01234567';

    // Seed lead_id in sessionStorage before the outcome event fires
    sessionStorage.setItem('__estalara_lead_id__', leadId);

    const responseWithVariant: AdaptResponse = {
      ...MOCK_RESPONSE,
      session_id: sessionId,
      archetype: 'family_buyer',
      variant: 'v2',
    };

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(responseWithVariant) });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });
    vi.stubGlobal('fetch', mockFetch);

    const config: SdkConfig = {
      ...BASE_CONFIG,
      decisionApiUrl: 'https://decision.estalara.com/api',
      tenantId,
    };
    const session: SessionState = { ...SESSION, sessionId };

    await fetchDirectives(config, session, 'listing_list');
    document.dispatchEvent(new Event('live.signup'));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [, feedbackInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(feedbackInit.body as string) as Record<string, unknown>;

    // AC1: prediction_id must equal adapt_decision_id from the adapt response
    expect(body.prediction_id).toBe(MOCK_RESPONSE.adapt_decision_id);
    // AC1: lead_id must be threaded from sessionStorage
    expect(body.lead_id).toBe(leadId);
  });
});
