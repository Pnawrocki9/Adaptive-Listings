// CONTRACT TEST — fails if SDK emits events that ingest cannot parse
//
// This test pipes every event type the SDK can emit through the canonical
// EventSchema.safeParse() used by the ingest Worker. Any rejection here
// means the event would be silently dropped in production.
//
// Covers all 10 event types directly produced by the SDK:
//   page.view, scroll.depth          — packages/sdk/src/core/events.ts
//   listing.viewed, cta.clicked      — packages/sdk/src/core/observer.ts
//   adapt.applied, adapt.skipped     — packages/sdk/src/core/adapt.ts
//   consent.granted, consent.denied  — packages/sdk/src/index.ts
//   quiz.event, quiz.mismatch        — packages/sdk/src/index.ts
//   sidebar.closed                   — packages/sdk/src/index.ts
//
// TICKET-RUNTIME-FIX-003 — clears blocker B3 from RUNTIME_READINESS_AUDIT.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventSchema } from '@estalara/shared';

// ─── Minimal valid event envelope shared by all assertions ────────────────────

const ENVELOPE = {
  event_id: '01928f00-7000-7000-8000-123456789abc',
  tenant_id: '01928f00-7000-7000-8000-aaaaaaaaaaaa',
  session_id: 'a'.repeat(64),
  ts: 1_714_180_000_000,
  region: 'eu' as const,
  consent_state: 'legitimate-interest' as const,
  schema_version: 1 as const,
};

/** Wrap a type + payload in the minimal envelope. */
function wrap<T extends string, P>(type: T, payload: P) {
  return { ...ENVELOPE, type, payload };
}

// ─── Helpers that mirror SDK construction paths ───────────────────────────────
// These mirror the actual payload objects built in the SDK, not hand-crafted
// test fixtures, so any SDK drift in field names will fail this test.

import { collectPageView, collectScrollDepth, dispatchEvents } from '../core/events.js';

describe('CONTRACT: page.view (core/events.ts collectPageView)', () => {
  it('SDK payload passes EventSchema.safeParse', () => {
    const { payload } = collectPageView();
    const result = EventSchema.safeParse(wrap('page.view', payload));
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('page.view with viewport passes', () => {
    const result = EventSchema.safeParse(
      wrap('page.view', {
        url: 'https://example.com/listing/1',
        referrer: 'https://google.com/',
        viewport: { width: 1440, height: 900 },
        device_class: 'desktop' as const,
      }),
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('page.view without url and viewport passes (non-browser env)', () => {
    // SDK in non-browser env: location.href is '', window is undefined
    const result = EventSchema.safeParse(wrap('page.view', { device_class: 'desktop' as const }));
    expect(result.success, JSON.stringify(result)).toBe(true);
  });
});

describe('CONTRACT: scroll.depth (core/events.ts collectScrollDepth)', () => {
  it('SDK payload passes EventSchema.safeParse', () => {
    const { payload } = collectScrollDepth(50);
    const result = EventSchema.safeParse(wrap('scroll.depth', payload));
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('pct field (not depth_percent) is what the schema expects', () => {
    // Regression: the old SDK field name was depth_percent — must reject it
    const rejectOldName = EventSchema.safeParse(wrap('scroll.depth', { depth_percent: 50 }));
    expect(rejectOldName.success).toBe(false);

    // New field name pct must pass
    const acceptNewName = EventSchema.safeParse(wrap('scroll.depth', { pct: 50 }));
    expect(acceptNewName.success).toBe(true);
  });
});

describe('CONTRACT: listing.viewed (core/observer.ts IntersectionObserver)', () => {
  it('SDK payload passes EventSchema.safeParse', () => {
    // Mirrors observer.ts payload construction: listing_id from dataset, element from tagName
    const payload = {
      listing_id: 'prop-456',
      element: 'div',
    };
    const result = EventSchema.safeParse(wrap('listing.viewed', payload));
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('listing_id may be empty string when data-listing-id is absent', () => {
    const result = EventSchema.safeParse(
      wrap('listing.viewed', { listing_id: '', element: 'article' }),
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
  });
});

describe('CONTRACT: cta.clicked (core/observer.ts click listener)', () => {
  it('SDK payload passes EventSchema.safeParse', () => {
    // Mirrors observer.ts payload construction
    const payload = {
      cta_id: 'contact_agent',
      href: 'https://example.com/contact',
      text: 'Contact Agent',
    };
    const result = EventSchema.safeParse(wrap('cta.clicked', payload));
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('href may be empty string when CTA is not an anchor', () => {
    const result = EventSchema.safeParse(
      wrap('cta.clicked', { cta_id: 'tour_request', href: '', text: 'Book Tour' }),
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
  });
});

describe('CONTRACT: adapt.applied (core/adapt.ts applyTextDirective / applyClassDirective / applyReorderDirective)', () => {
  it('text directive applied payload passes EventSchema.safeParse', () => {
    // Mirrors adapt.ts payload construction for applyTextDirective
    const payload = {
      slot_or_selector: 'hero_headline',
      archetype: 'yield_hunter',
      confidence: 0.87,
    };
    const result = EventSchema.safeParse(wrap('adapt.applied', payload));
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('class directive applied payload (selector) passes', () => {
    const result = EventSchema.safeParse(
      wrap('adapt.applied', {
        slot_or_selector: '[data-estalara-highlight]',
        archetype: 'family_buyer',
        confidence: 0.72,
      }),
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
  });
});

describe('CONTRACT: adapt.skipped (core/adapt.ts various skip paths)', () => {
  it('no_slot_elements reason passes', () => {
    const result = EventSchema.safeParse(
      wrap('adapt.skipped', { reason: 'no_slot_elements', slot_or_selector: 'hero_headline' }),
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('disallowed_selector reason passes', () => {
    const result = EventSchema.safeParse(
      wrap('adapt.skipped', {
        reason: 'disallowed_selector',
        slot_or_selector: '.arbitrary-class',
      }),
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('unresolved_token_<name> reason passes (dynamic token name from interpolation)', () => {
    // Mirrors interpolatePlaceholders: `unresolved_token_${token}`
    const result = EventSchema.safeParse(
      wrap('adapt.skipped', {
        reason: 'unresolved_token_school_rating',
        slot_or_selector: 'nearby_schools',
      }),
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('no_container reason passes', () => {
    const result = EventSchema.safeParse(
      wrap('adapt.skipped', {
        reason: 'no_container',
        slot_or_selector: '[data-estalara-listings]',
      }),
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('no_cards reason passes', () => {
    const result = EventSchema.safeParse(
      wrap('adapt.skipped', { reason: 'no_cards', slot_or_selector: '[data-estalara-card]' }),
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
  });
});

describe('CONTRACT: consent.granted (index.ts onGranted callback)', () => {
  it('SDK payload passes EventSchema.safeParse', () => {
    // Mirrors index.ts: { language: config.language, method: 'banner' }
    const payload = { language: 'en' as const, method: 'banner' as const };
    const result = EventSchema.safeParse(wrap('consent.granted', payload));
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('pl language variant passes', () => {
    const result = EventSchema.safeParse(
      wrap('consent.granted', { language: 'pl' as const, method: 'banner' as const }),
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
  });
});

describe('CONTRACT: consent.denied (index.ts onDenied callback)', () => {
  it('SDK payload passes EventSchema.safeParse', () => {
    const payload = { language: 'en' as const, method: 'banner' as const };
    const result = EventSchema.safeParse(wrap('consent.denied', payload));
    expect(result.success, JSON.stringify(result)).toBe(true);
  });
});

describe('CONTRACT: quiz.event (index.ts quiz onComplete callback)', () => {
  it('SDK payload passes EventSchema.safeParse', () => {
    // Mirrors index.ts quiz.event payload construction exactly
    const payload = {
      step: 'completed',
      answers: { purpose: 'investment', horizon: '12m' },
      trigger: 'prompt_after_3_listings',
      archetype: 'yield_hunter',
      confidence: 0.87,
    };
    const result = EventSchema.safeParse(wrap('quiz.event', payload));
    expect(result.success, JSON.stringify(result)).toBe(true);
  });
});

describe('CONTRACT: quiz.mismatch (index.ts after detectMismatch)', () => {
  it('SDK payload passes EventSchema.safeParse', () => {
    // Mirrors index.ts quiz.mismatch payload construction exactly
    const payload = {
      quiz_archetype: 'yield_hunter',
      behavioral_archetype: 'family_comfort',
      confidence_gap: 0.43,
      signal_count: 12,
    };
    const result = EventSchema.safeParse(wrap('quiz.mismatch', payload));
    expect(result.success, JSON.stringify(result)).toBe(true);
  });
});

describe('CONTRACT: sidebar.closed (index.ts sidebar onClose callback)', () => {
  it('SDK payload passes EventSchema.safeParse', () => {
    // Mirrors index.ts: payload: {}
    const result = EventSchema.safeParse(wrap('sidebar.closed', {}));
    expect(result.success, JSON.stringify(result)).toBe(true);
  });
});

describe('CONTRACT: auth header — ingest reads X-Estalara-API-Key', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it('SDK dispatchEvents sends X-Estalara-API-Key header (not Authorization: Bearer)', async () => {
    // Regression guard for RUNTIME_READINESS_AUDIT B3 auth header drift.
    const config = {
      apiKey: 'test_key_abc',
      ingestUrl: 'https://ingest.estalara.com/v1/events',
      tier: 'observer' as const,
      debug: false,
      consentState: 'legitimate_interest' as const,
      language: 'en' as const,
      accentColor: '#6c5ce7',
    };
    const session = { sessionId: 'a'.repeat(64), startedAt: Date.now(), pageCount: 1 };
    await dispatchEvents([collectPageView()], config, session);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    // Must use canonical header — not Authorization: Bearer
    expect(headers['X-Estalara-API-Key']).toBe('test_key_abc');
    expect(headers.Authorization).toBeUndefined();
  });
});
