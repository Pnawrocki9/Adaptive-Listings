import { describe, it, expect } from 'vitest';

import {
  AdaptReappliedEventSchema,
  ChatIntentDetectedEventSchema,
  ChatMessageSentEventSchema,
  ChatOpenedEventSchema,
  EVENT_TYPES,
  EventSchema,
  FeatureExpandedEventSchema,
  FilterAppliedEventSchema,
  FilterRemovedEventSchema,
  FloorplanDwellEventSchema,
  FloorplanOpenedEventSchema,
  FloorplanZoomEventSchema,
  InquiryCompletedEventSchema,
  InquiryStartedEventSchema,
  ListingBookmarkedEventSchema,
  ListingComparedEventSchema,
  ListingNextEventSchema,
  LiveSignupEventSchema,
  MortgageCalcUsedEventSchema,
  MouseDwellEventSchema,
  MouseExitIntentEventSchema,
  MouseRageClickEventSchema,
  PageExitEventSchema,
  PageViewEventSchema,
  PhotoDwellEventSchema,
  PhotoGalleryNextEventSchema,
  PhotoOpenedEventSchema,
  PhotoZoomedEventSchema,
  PriceComparedEventSchema,
  SessionQualitySnapshotEventSchema,
  PriceHoveredEventSchema,
  ScrollDepthEventSchema,
  SearchQueryEventSchema,
  SessionStartedEventSchema,
  SortChangedEventSchema,
  TabHiddenEventSchema,
  TabVisibleEventSchema,
  TourRequestedEventSchema,
} from './index.js';

const envelope = {
  event_id: '01928f00-7000-7000-8000-123456789abc',
  tenant_id: '01928f00-7000-7000-8000-aaaaaaaaaaaa',
  session_id: 'a'.repeat(40),
  ts: 1714180000000,
  region: 'eu' as const,
  consent_state: 'legitimate-interest' as const,
  schema_version: 1 as const,
};

const ev = <T extends string, P>(type: T, payload: P) => ({ ...envelope, type, payload });

describe('EVENT_TYPES tuple', () => {
  it('has exactly 54 unique event type literals', () => {
    // 34 original + 1 ab.assignment (TICKET-AB-001) + 2 consent audit (TICKET-041)
    // + 7 SDK observability (TICKET-RUNTIME-FIX-003):
    //   listing.viewed, cta.clicked, quiz.event, quiz.mismatch,
    //   sidebar.closed, adapt.applied, adapt.skipped
    // + 1 primary pilot conversion (FOLLOW-195 / CEO Decision D-4):
    //   live.signup
    // + 1 K.3.6 Archetype Identification Tracer (FOLLOW-266 / 2026-06-12):
    //   intent.snapshot
    // + 6 description-adaptation observability (FOLLOW-461 / audit F-04):
    //   adapt.description.applied, adapt.description.skipped, adapt.description.error,
    //   adapt.description.re, adapt.description.headline.applied, adapt.description.headline.re
    // + 1 generic-directive MutationObserver repair observability (FOLLOW-791):
    //   adapt.reapplied
    // + 1 SDK boot-path latency telemetry (FOLLOW-1037 / MP-011):
    //   boot_timing
    expect(EVENT_TYPES.length).toBe(54);
    expect(new Set<string>(EVENT_TYPES).size).toBe(54);
  });
});

describe('page lifecycle events', () => {
  it('PageView parses a valid event', () => {
    const e = ev('page.view', {
      url: 'https://example.com/listing/1',
      referrer: 'https://google.com/',
      viewport: { width: 1440, height: 900 },
      device_class: 'desktop' as const,
    });
    expect(() => PageViewEventSchema.parse(e)).not.toThrow();
  });

  it('PageView rejects bad URL', () => {
    const e = ev('page.view', {
      url: 'not-a-url',
      viewport: { width: 1, height: 1 },
      device_class: 'desktop' as const,
    });
    expect(() => PageViewEventSchema.parse(e)).toThrow();
  });

  it('PageView rejects bad device_class', () => {
    const e = ev('page.view', {
      url: 'https://x.com',
      viewport: { width: 1, height: 1 },
      device_class: 'spaceship',
    });
    expect(() => PageViewEventSchema.parse(e)).toThrow();
  });

  it('PageExit parses', () => {
    expect(() =>
      PageExitEventSchema.parse(
        ev('page.exit', { url: 'https://x.com', dwell_ms: 1000, scrolled_max_pct: 80 }),
      ),
    ).not.toThrow();
  });

  it('PageExit rejects negative dwell_ms', () => {
    expect(() =>
      PageExitEventSchema.parse(ev('page.exit', { url: 'https://x.com', dwell_ms: -1 })),
    ).toThrow();
  });

  it('TabVisible / TabHidden parse with optional fields', () => {
    expect(() => TabVisibleEventSchema.parse(ev('tab.visible', {}))).not.toThrow();
    expect(() =>
      TabVisibleEventSchema.parse(ev('tab.visible', { hidden_for_ms: 500 })),
    ).not.toThrow();
    expect(() => TabHiddenEventSchema.parse(ev('tab.hidden', {}))).not.toThrow();
  });
});

describe('mouse / scroll events', () => {
  it('ScrollDepth parses', () => {
    expect(() => ScrollDepthEventSchema.parse(ev('scroll.depth', { pct: 50 }))).not.toThrow();
  });

  it('ScrollDepth rejects pct out of range', () => {
    expect(() => ScrollDepthEventSchema.parse(ev('scroll.depth', { pct: 120 }))).toThrow();
    expect(() => ScrollDepthEventSchema.parse(ev('scroll.depth', { pct: -1 }))).toThrow();
  });

  it('MouseDwell parses', () => {
    expect(() =>
      MouseDwellEventSchema.parse(ev('mouse.dwell', { element: 'feature.pool', dwell_ms: 1820 })),
    ).not.toThrow();
  });

  it('MouseDwell requires non-empty element', () => {
    expect(() =>
      MouseDwellEventSchema.parse(ev('mouse.dwell', { element: '', dwell_ms: 100 })),
    ).toThrow();
  });

  it('MouseRageClick requires click_count >= 3', () => {
    expect(() =>
      MouseRageClickEventSchema.parse(ev('mouse.rage_click', { element: 'cta', click_count: 2 })),
    ).toThrow();
    expect(() =>
      MouseRageClickEventSchema.parse(ev('mouse.rage_click', { element: 'cta', click_count: 5 })),
    ).not.toThrow();
  });

  it('MouseExitIntent parses', () => {
    expect(() =>
      MouseExitIntentEventSchema.parse(ev('mouse.exit_intent', { dwell_ms: 1000 })),
    ).not.toThrow();
  });
});

describe('photo events', () => {
  it('PhotoOpened parses', () => {
    expect(() =>
      PhotoOpenedEventSchema.parse(ev('photo.opened', { photo_id: 'p_1', position: 0, total: 10 })),
    ).not.toThrow();
  });

  it('PhotoGalleryNext requires both ids', () => {
    expect(() =>
      PhotoGalleryNextEventSchema.parse(
        ev('photo.gallery.next', { from_photo_id: 'a', to_photo_id: 'b' }),
      ),
    ).not.toThrow();
    expect(() =>
      PhotoGalleryNextEventSchema.parse(ev('photo.gallery.next', { from_photo_id: 'a' })),
    ).toThrow();
  });

  it('PhotoZoomed requires positive zoom_level', () => {
    expect(() =>
      PhotoZoomedEventSchema.parse(ev('photo.zoomed', { photo_id: 'p', zoom_level: 0 })),
    ).toThrow();
    expect(() =>
      PhotoZoomedEventSchema.parse(ev('photo.zoomed', { photo_id: 'p', zoom_level: 2.5 })),
    ).not.toThrow();
  });

  it('PhotoDwell parses', () => {
    expect(() =>
      PhotoDwellEventSchema.parse(ev('photo.dwell', { photo_id: 'p_1', dwell_ms: 4200 })),
    ).not.toThrow();
  });
});

describe('floorplan events', () => {
  it('FloorplanOpened parses with and without source', () => {
    expect(() => FloorplanOpenedEventSchema.parse(ev('floorplan.opened', {}))).not.toThrow();
    expect(() =>
      FloorplanOpenedEventSchema.parse(ev('floorplan.opened', { source: 'gallery_button' })),
    ).not.toThrow();
  });

  it('FloorplanZoom requires positive zoom_level', () => {
    expect(() => FloorplanZoomEventSchema.parse(ev('floorplan.zoom', { zoom_level: 0 }))).toThrow();
    expect(() =>
      FloorplanZoomEventSchema.parse(ev('floorplan.zoom', { zoom_level: 1.5 })),
    ).not.toThrow();
  });

  it('FloorplanDwell parses', () => {
    expect(() =>
      FloorplanDwellEventSchema.parse(ev('floorplan.dwell', { dwell_ms: 8200 })),
    ).not.toThrow();
  });
});

describe('price / feature events', () => {
  it('PriceHovered requires 3-letter currency', () => {
    expect(() =>
      PriceHoveredEventSchema.parse(ev('price.hovered', { price: 100, currency: 'EU' })),
    ).toThrow();
    expect(() =>
      PriceHoveredEventSchema.parse(ev('price.hovered', { price: 100, currency: 'EUR' })),
    ).not.toThrow();
  });

  it('PriceCompared parses', () => {
    expect(() =>
      PriceComparedEventSchema.parse(
        ev('price.compared', { against_listing_id: 'l_99', delta_pct: 12.5 }),
      ),
    ).not.toThrow();
  });

  it('FeatureExpanded requires non-empty feature', () => {
    expect(() =>
      FeatureExpandedEventSchema.parse(ev('feature.expanded', { feature: '' })),
    ).toThrow();
    expect(() =>
      FeatureExpandedEventSchema.parse(
        ev('feature.expanded', { feature: 'energy_certificate', label: 'B' }),
      ),
    ).not.toThrow();
  });

  it('MortgageCalcUsed parses with all optional fields absent', () => {
    expect(() => MortgageCalcUsedEventSchema.parse(ev('mortgage_calc.used', {}))).not.toThrow();
  });
});

describe('search / filter events', () => {
  it('SearchQuery enforces 1-500 length', () => {
    expect(() => SearchQueryEventSchema.parse(ev('search.query', { query: '' }))).toThrow();
    expect(() =>
      SearchQueryEventSchema.parse(ev('search.query', { query: 'a'.repeat(501) })),
    ).toThrow();
    expect(() =>
      SearchQueryEventSchema.parse(ev('search.query', { query: 'penthouse', results_count: 12 })),
    ).not.toThrow();
  });

  it('FilterApplied accepts string / number / array values for enum facets', () => {
    for (const [facet, value] of [
      ['price_range', 500000],
      ['bedrooms', 3],
      ['amenities', ['pool', 'garage']],
      ['commercial', undefined],
    ] as [string, unknown][]) {
      expect(() =>
        FilterAppliedEventSchema.parse(ev('filter.applied', { facet, value })),
      ).not.toThrow();
    }
  });

  it('FilterRemoved parses', () => {
    expect(() =>
      FilterRemovedEventSchema.parse(ev('filter.removed', { facet: 'bedrooms_min' })),
    ).not.toThrow();
  });

  it('SortChanged requires sort_by', () => {
    expect(() => SortChangedEventSchema.parse(ev('sort.changed', {}))).toThrow();
    expect(() =>
      SortChangedEventSchema.parse(ev('sort.changed', { sort_by: 'price_asc' })),
    ).not.toThrow();
  });
});

describe('chat events', () => {
  it('ChatOpened parses', () => {
    expect(() =>
      ChatOpenedEventSchema.parse(ev('chat.opened', { trigger: 'cta_click' })),
    ).not.toThrow();
  });

  it('ChatMessageSent enforces 1-4000 length', () => {
    expect(() =>
      ChatMessageSentEventSchema.parse(ev('chat.message.sent', { message: '' })),
    ).toThrow();
    expect(() =>
      ChatMessageSentEventSchema.parse(ev('chat.message.sent', { message: 'a'.repeat(4001) })),
    ).toThrow();
    expect(() =>
      ChatMessageSentEventSchema.parse(
        ev('chat.message.sent', { message: 'looking for 3 bed', locale: 'en-GB' }),
      ),
    ).not.toThrow();
  });

  it('ChatIntentDetected enforces dimension range and confidence range', () => {
    expect(() =>
      ChatIntentDetectedEventSchema.parse(
        ev('chat.intent.detected', { dimensions: { budget: 0.8 }, confidence: 1.5 }),
      ),
    ).toThrow();
    expect(() =>
      ChatIntentDetectedEventSchema.parse(
        ev('chat.intent.detected', { dimensions: { budget: 1.2 }, confidence: 0.7 }),
      ),
    ).toThrow();
    expect(() =>
      ChatIntentDetectedEventSchema.parse(
        ev('chat.intent.detected', {
          dimensions: { budget: 0.8, urgency: -0.2 },
          confidence: 0.74,
          model: 'claude-haiku-4-5',
        }),
      ),
    ).not.toThrow();
  });
});

describe('cross-listing events', () => {
  it('ListingNext parses', () => {
    expect(() =>
      ListingNextEventSchema.parse(
        ev('listing.next', { from_listing_id: 'a', to_listing_id: 'b', via: 'next_button' }),
      ),
    ).not.toThrow();
  });

  it('ListingCompared requires 2-6 listing_ids', () => {
    expect(() =>
      ListingComparedEventSchema.parse(ev('listing.compared', { listing_ids: ['a'] })),
    ).toThrow();
    expect(() =>
      ListingComparedEventSchema.parse(
        ev('listing.compared', { listing_ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
      ),
    ).toThrow();
    expect(() =>
      ListingComparedEventSchema.parse(ev('listing.compared', { listing_ids: ['a', 'b'] })),
    ).not.toThrow();
  });

  it('ListingBookmarked parses', () => {
    expect(() =>
      ListingBookmarkedEventSchema.parse(ev('listing.bookmarked', { collection: 'shortlist' })),
    ).not.toThrow();
  });
});

describe('inquiry events', () => {
  it('InquiryStarted parses without form_variant', () => {
    expect(() => InquiryStartedEventSchema.parse(ev('inquiry.started', {}))).not.toThrow();
  });

  it('InquiryCompleted accepts allowed channel + timeline enums', () => {
    expect(() =>
      InquiryCompletedEventSchema.parse(
        ev('inquiry.completed', { channel: 'email', has_phone: true, timeline: '0-3m' }),
      ),
    ).not.toThrow();
    expect(() =>
      InquiryCompletedEventSchema.parse(
        ev('inquiry.completed', { channel: 'pigeon' as unknown as 'email' }),
      ),
    ).toThrow();
  });

  it('TourRequested requires mode', () => {
    expect(() => TourRequestedEventSchema.parse(ev('tour.requested', {}))).toThrow();
    expect(() =>
      TourRequestedEventSchema.parse(
        ev('tour.requested', { mode: 'in_person', requested_date: '2026-05-15' }),
      ),
    ).not.toThrow();
  });
});

describe('device / context events', () => {
  it('SessionStarted parses with required fields', () => {
    expect(() =>
      SessionStartedEventSchema.parse(
        ev('session.started', {
          device_class: 'desktop' as const,
          viewport: { width: 1440, height: 900 },
          language: 'en-GB',
          country: 'ES',
          city: 'Marbella',
          time_of_day: 'evening' as const,
        }),
      ),
    ).not.toThrow();
  });

  it('SessionStarted rejects 3-letter country code', () => {
    expect(() =>
      SessionStartedEventSchema.parse(
        ev('session.started', {
          device_class: 'mobile' as const,
          viewport: { width: 360, height: 640 },
          language: 'pl',
          country: 'POL',
        }),
      ),
    ).toThrow();
  });

  it('SessionStarted rejects unknown time_of_day', () => {
    expect(() =>
      SessionStartedEventSchema.parse(
        ev('session.started', {
          device_class: 'tablet' as const,
          viewport: { width: 768, height: 1024 },
          language: 'es',
          time_of_day: 'lunch',
        }),
      ),
    ).toThrow();
  });
});

describe('EventSchema discriminated union', () => {
  it('parses one valid event from each category via the union', () => {
    const cases = [
      ev('page.view', {
        url: 'https://x.com',
        viewport: { width: 800, height: 600 },
        device_class: 'desktop' as const,
      }),
      ev('scroll.depth', { pct: 25 }),
      ev('photo.opened', { photo_id: 'p_1', position: 0 }),
      ev('floorplan.opened', {}),
      ev('price.hovered', { price: 100, currency: 'EUR' }),
      ev('search.query', { query: 'penthouse' }),
      ev('chat.opened', {}),
      ev('listing.bookmarked', {}),
      ev('inquiry.started', {}),
      ev('session.started', {
        device_class: 'mobile' as const,
        viewport: { width: 360, height: 640 },
        language: 'en',
      }),
      ev('session.quality.snapshot', {
        session_id: 'a'.repeat(40),
        prediction_stability_score: 0.8,
        convergence_time_events: 5,
        signal_density_per_min: 3.0,
        final_archetype: 'family_buyer',
        final_confidence: 0.72,
        total_events: 10,
      }),
    ];
    for (const c of cases) expect(() => EventSchema.parse(c)).not.toThrow();
  });

  it('rejects an event with unknown type', () => {
    expect(() => EventSchema.parse(ev('not.a.real.type', {}))).toThrow();
  });

  it('rejects an event whose payload does not match its declared type', () => {
    // page.view requires viewport + device_class — sending a chat payload should fail
    expect(() => EventSchema.parse(ev('page.view', { message: 'hi' }))).toThrow();
  });
});

describe('session quality / DQS events (TICKET-DQS-001)', () => {
  const validQualityPayload = {
    session_id: 'a'.repeat(40),
    prediction_stability_score: 0.8,
    convergence_time_events: 5,
    signal_density_per_min: 3.0,
    final_archetype: 'family_buyer',
    final_confidence: 0.72,
    total_events: 10,
  };

  it('SessionQualitySnapshot parses a valid event', () => {
    expect(() =>
      SessionQualitySnapshotEventSchema.parse(ev('session.quality.snapshot', validQualityPayload)),
    ).not.toThrow();
  });

  it('SessionQualitySnapshot accepts null convergence_time_events', () => {
    expect(() =>
      SessionQualitySnapshotEventSchema.parse(
        ev('session.quality.snapshot', { ...validQualityPayload, convergence_time_events: null }),
      ),
    ).not.toThrow();
  });

  it('SessionQualitySnapshot rejects prediction_stability_score > 1', () => {
    expect(() =>
      SessionQualitySnapshotEventSchema.parse(
        ev('session.quality.snapshot', {
          ...validQualityPayload,
          prediction_stability_score: 1.1,
        }),
      ),
    ).toThrow();
  });

  it('SessionQualitySnapshot rejects signal_density_per_min > 10', () => {
    expect(() =>
      SessionQualitySnapshotEventSchema.parse(
        ev('session.quality.snapshot', { ...validQualityPayload, signal_density_per_min: 11 }),
      ),
    ).toThrow();
  });

  it('SessionQualitySnapshot rejects missing required payload field', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { total_events: _omit, ...payloadWithoutTotal } = validQualityPayload;
    expect(() =>
      SessionQualitySnapshotEventSchema.parse(ev('session.quality.snapshot', payloadWithoutTotal)),
    ).toThrow();
  });
});

// ─── FOLLOW-195 / CEO Decision D-4 (2026-05-30): live.signup conversion event ───

describe('live.signup events (FOLLOW-195)', () => {
  const validSlotUuid = '01928f00-7000-7000-8000-aaaaaaaaaa01';

  it('LiveSignup parses a valid event with only required fields', () => {
    expect(() =>
      LiveSignupEventSchema.parse(ev('live.signup', { slot_uuid: validSlotUuid })),
    ).not.toThrow();
  });

  it('LiveSignup parses a valid event with all optional fields', () => {
    expect(() =>
      LiveSignupEventSchema.parse(
        ev('live.signup', {
          slot_uuid: validSlotUuid,
          slot_label: '2026-06-15T14:00:00Z',
          source_surface: 'listing_detail',
        }),
      ),
    ).not.toThrow();
  });

  it('LiveSignup parses all valid source_surface enum values', () => {
    const surfaces = [
      'listing_detail',
      'sidebar_widget',
      'search_card',
      'email_link',
      'other',
    ] as const;
    for (const surface of surfaces) {
      expect(() =>
        LiveSignupEventSchema.parse(
          ev('live.signup', { slot_uuid: validSlotUuid, source_surface: surface }),
        ),
      ).not.toThrow();
    }
  });

  it('LiveSignup accepts a missing slot_uuid (FOLLOW-258 F-04: optional to prevent event loss)', () => {
    // slot_uuid is now optional — events without it must not be dropped.
    expect(() => LiveSignupEventSchema.parse(ev('live.signup', {}))).not.toThrow();
  });

  it('LiveSignup rejects a non-UUID slot_uuid', () => {
    expect(() =>
      LiveSignupEventSchema.parse(ev('live.signup', { slot_uuid: 'not-a-uuid' })),
    ).toThrow();
  });

  it('LiveSignup rejects an invalid source_surface enum value', () => {
    expect(() =>
      LiveSignupEventSchema.parse(
        ev('live.signup', {
          slot_uuid: validSlotUuid,
          source_surface: 'homepage' as 'listing_detail',
        }),
      ),
    ).toThrow();
  });

  it('LiveSignup rejects slot_label longer than 64 chars', () => {
    expect(() =>
      LiveSignupEventSchema.parse(
        ev('live.signup', { slot_uuid: validSlotUuid, slot_label: 'a'.repeat(65) }),
      ),
    ).toThrow();
  });

  it('LiveSignup is accepted by the canonical EventSchema discriminated union', () => {
    expect(() => EventSchema.parse(ev('live.signup', { slot_uuid: validSlotUuid }))).not.toThrow();
  });
});

describe('adapt.description.* events (FOLLOW-461 / audit F-04) — ingest round-trip', () => {
  // AC3: every adapt.description.* payload the SDK actually emits from
  // packages/sdk/src/core/adapt-description.ts MUST validate against the canonical
  // `EventSchema` used at the ingest boundary. Before FOLLOW-461 these types were absent
  // from the union, so ingest silently rejected them (description-adaptation observability
  // was blind in prod). Each case below mirrors a real emit site, verified field-by-field.
  const SDK_EMITTED_EVENTS: Record<string, unknown>[] = [
    // applyDescriptionAdaptation final emit — { listing_id, archetype }
    ev('adapt.description.applied', { listing_id: 'listing-001', archetype: 'yield_hunter' }),
    // skipped: neutral archetype path — { reason: 'neutral' }
    ev('adapt.description.skipped', { reason: 'neutral' }),
    // skipped: non-adaptable fetch result — {}
    ev('adapt.description.skipped', {}),
    // fetchDescription network error — { reason: 'ne' }
    ev('adapt.description.error', { reason: 'ne' }),
    // fetchDescription HTTP error — { reason: 'http_err', status }
    ev('adapt.description.error', { reason: 'http_err', status: 500 }),
    // fetchDescription bad-response — { reason: 'br' }
    ev('adapt.description.error', { reason: 'br' }),
    // description slot reapply after framework revert — {}
    ev('adapt.description.re', {}),
    // headline slot final emit — { listing_id, archetype }
    ev('adapt.description.headline.applied', {
      listing_id: 'listing-001',
      archetype: 'yield_hunter',
    }),
    // headline slot reapply after framework revert — {}
    ev('adapt.description.headline.re', {}),
  ];

  it.each(SDK_EMITTED_EVENTS)(
    'canonical EventSchema accepts SDK-emitted %#: type=$type',
    (event) => {
      const result = EventSchema.safeParse(event);
      expect(result.success).toBe(true);
    },
  );

  it('adapt.description.error requires a reason (schema actually validates the field)', () => {
    // Proves the schema is not a rubber stamp: a missing required field is rejected.
    const result = EventSchema.safeParse(ev('adapt.description.error', {}));
    expect(result.success).toBe(false);
  });

  it('adapt.description.applied requires listing_id + archetype', () => {
    expect(EventSchema.safeParse(ev('adapt.description.applied', {})).success).toBe(false);
    expect(
      EventSchema.safeParse(ev('adapt.description.applied', { listing_id: 'x' })).success,
    ).toBe(false);
  });
});

// ─── FOLLOW-791: adapt.reapplied — generic-directive MutationObserver repair ───

describe('adapt.reapplied event (FOLLOW-791)', () => {
  it('parses a valid event with the same shape as adapt.applied', () => {
    expect(() =>
      AdaptReappliedEventSchema.parse(
        ev('adapt.reapplied', {
          slot_or_selector: 'hero_headline',
          archetype: 'yield_hunter',
          confidence: 0.87,
        }),
      ),
    ).not.toThrow();
  });

  it('is accepted by the canonical EventSchema discriminated union', () => {
    expect(
      EventSchema.safeParse(
        ev('adapt.reapplied', {
          slot_or_selector: '[data-estalara-listing-id]',
          archetype: 'family_buyer',
          confidence: 0.6,
        }),
      ).success,
    ).toBe(true);
  });

  it('requires slot_or_selector, archetype, and confidence in [0,1]', () => {
    expect(
      EventSchema.safeParse(ev('adapt.reapplied', { archetype: 'yield_hunter', confidence: 0.5 }))
        .success,
    ).toBe(false);
    expect(
      EventSchema.safeParse(ev('adapt.reapplied', { slot_or_selector: 'x', confidence: 0.5 }))
        .success,
    ).toBe(false);
    expect(
      EventSchema.safeParse(
        ev('adapt.reapplied', {
          slot_or_selector: 'x',
          archetype: 'yield_hunter',
          confidence: 1.5,
        }),
      ).success,
    ).toBe(false);
  });
});
