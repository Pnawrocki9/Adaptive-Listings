import { describe, it, expect } from 'vitest';

import {
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
  it('has exactly 44 unique event type literals', () => {
    // 34 original + 1 ab.assignment (TICKET-AB-001) + 2 consent audit (TICKET-041)
    // + 7 SDK observability (TICKET-RUNTIME-FIX-003):
    //   listing.viewed, cta.clicked, quiz.event, quiz.mismatch,
    //   sidebar.closed, adapt.applied, adapt.skipped
    expect(EVENT_TYPES.length).toBe(44);
    expect(new Set<string>(EVENT_TYPES).size).toBe(44);
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

  it('FilterApplied accepts string / number / boolean values', () => {
    for (const value of ['Marbella', 500000, true]) {
      expect(() =>
        FilterAppliedEventSchema.parse(ev('filter.applied', { facet: 'price_max', value })),
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
