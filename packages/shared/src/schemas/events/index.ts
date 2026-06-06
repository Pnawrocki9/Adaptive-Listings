/**
 * Aggregate event index. Re-exports every per-category schema and assembles the canonical
 * discriminated union `EventSchema` used at every validation boundary (SDK ingest → Cloudflare
 * Worker → Redpanda → Modal stream consumer → ClickHouse).
 *
 * @module @estalara/shared/schemas/events
 */

import { z } from 'zod';

import {
  PageViewEventSchema,
  PageExitEventSchema,
  TabVisibleEventSchema,
  TabHiddenEventSchema,
} from './page-lifecycle.js';
import {
  ScrollDepthEventSchema,
  MouseDwellEventSchema,
  MouseRageClickEventSchema,
  MouseExitIntentEventSchema,
} from './mouse-scroll.js';
import {
  PhotoOpenedEventSchema,
  PhotoGalleryNextEventSchema,
  PhotoZoomedEventSchema,
  PhotoDwellEventSchema,
} from './photo.js';
import {
  FloorplanOpenedEventSchema,
  FloorplanZoomEventSchema,
  FloorplanDwellEventSchema,
} from './floorplan.js';
import {
  PriceHoveredEventSchema,
  PriceComparedEventSchema,
  FeatureExpandedEventSchema,
  MortgageCalcUsedEventSchema,
} from './price-feature.js';
import {
  SearchQueryEventSchema,
  FilterAppliedEventSchema,
  FilterRemovedEventSchema,
  SortChangedEventSchema,
} from './search-filter.js';
import {
  ChatOpenedEventSchema,
  ChatMessageSentEventSchema,
  ChatIntentDetectedEventSchema,
} from './chat.js';
import {
  ListingNextEventSchema,
  ListingComparedEventSchema,
  ListingBookmarkedEventSchema,
} from './cross-listing.js';
import {
  InquiryStartedEventSchema,
  InquiryCompletedEventSchema,
  TourRequestedEventSchema,
} from './inquiry.js';
import { SessionStartedEventSchema } from './device-context.js';
import { SessionQualitySnapshotEventSchema } from './session-quality.js';
import { AbAssignmentEventSchema } from './ab-assignment.js';
import { ConsentGrantedEventSchema, ConsentDeniedEventSchema } from './consent.js';
import { ListingViewedEventSchema, CtaClickedEventSchema } from './listing-observe.js';
import { QuizEventEventSchema, QuizMismatchEventSchema } from './quiz.js';
import { SidebarClosedEventSchema } from './sidebar.js';
import { AdaptAppliedEventSchema, AdaptSkippedEventSchema } from './adapt-events.js';
import { LiveSignupEventSchema } from './live.js';

export * from './page-lifecycle.js';
export * from './mouse-scroll.js';
export * from './photo.js';
export * from './floorplan.js';
export * from './price-feature.js';
export * from './search-filter.js';
export * from './chat.js';
export * from './cross-listing.js';
export * from './inquiry.js';
export * from './device-context.js';
export * from './session-quality.js';
export * from './ab-assignment.js';
export * from './consent.js';
export * from './listing-observe.js';
export * from './quiz.js';
export * from './sidebar.js';
export * from './adapt-events.js';
export * from './live.js';

/**
 * `EventSchema` — the canonical discriminated union over all 45 Estalara event types
 * (10 categories from Master Design C.1, plus session quality / DQS — TICKET-DQS-001,
 * plus A/B holdout assignment — TICKET-AB-001,
 * plus consent audit — TICKET-041,
 * plus SDK observability events — TICKET-RUNTIME-FIX-003:
 *   listing.viewed, cta.clicked, quiz.event, quiz.mismatch,
 *   sidebar.closed, adapt.applied, adapt.skipped,
 * plus primary pilot conversion event — FOLLOW-195 / CEO Decision D-4:
 *   live.signup).
 *
 * Adding a new event type:
 *   1. Define payload + extended event schemas in the appropriate category file
 *   2. Add the schema to the union below (additive only — see ADR-0003)
 *   3. Add tests
 */
export const EventSchema = z.discriminatedUnion('type', [
  // page lifecycle (4)
  PageViewEventSchema,
  PageExitEventSchema,
  TabVisibleEventSchema,
  TabHiddenEventSchema,
  // mouse / scroll (4)
  ScrollDepthEventSchema,
  MouseDwellEventSchema,
  MouseRageClickEventSchema,
  MouseExitIntentEventSchema,
  // photo (4)
  PhotoOpenedEventSchema,
  PhotoGalleryNextEventSchema,
  PhotoZoomedEventSchema,
  PhotoDwellEventSchema,
  // floorplan (3)
  FloorplanOpenedEventSchema,
  FloorplanZoomEventSchema,
  FloorplanDwellEventSchema,
  // price / feature (4)
  PriceHoveredEventSchema,
  PriceComparedEventSchema,
  FeatureExpandedEventSchema,
  MortgageCalcUsedEventSchema,
  // search / filter (4)
  SearchQueryEventSchema,
  FilterAppliedEventSchema,
  FilterRemovedEventSchema,
  SortChangedEventSchema,
  // chat (3)
  ChatOpenedEventSchema,
  ChatMessageSentEventSchema,
  ChatIntentDetectedEventSchema,
  // cross-listing (3)
  ListingNextEventSchema,
  ListingComparedEventSchema,
  ListingBookmarkedEventSchema,
  // inquiry / conversion (3)
  InquiryStartedEventSchema,
  InquiryCompletedEventSchema,
  TourRequestedEventSchema,
  // device / context (1)
  SessionStartedEventSchema,
  // session quality / DQS (1) — TICKET-DQS-001
  SessionQualitySnapshotEventSchema,
  // A/B holdout assignment (1) — TICKET-AB-001
  AbAssignmentEventSchema,
  // consent audit (2) — TICKET-041
  ConsentGrantedEventSchema,
  ConsentDeniedEventSchema,
  // listing observation (2) — TICKET-RUNTIME-FIX-003
  ListingViewedEventSchema,
  CtaClickedEventSchema,
  // quiz interaction (2) — TICKET-RUNTIME-FIX-003
  QuizEventEventSchema,
  QuizMismatchEventSchema,
  // sidebar UI (1) — TICKET-RUNTIME-FIX-003
  SidebarClosedEventSchema,
  // adaptation observability (2) — TICKET-RUNTIME-FIX-003
  AdaptAppliedEventSchema,
  AdaptSkippedEventSchema,
  // primary pilot conversion (1) — FOLLOW-195 / CEO Decision D-4 (2026-05-30)
  LiveSignupEventSchema,
]);
export type Event = z.infer<typeof EventSchema>;

/** All event type literals as a const tuple — useful for runtime introspection. */
export const EVENT_TYPES = [
  'page.view',
  'page.exit',
  'tab.visible',
  'tab.hidden',
  'scroll.depth',
  'mouse.dwell',
  'mouse.rage_click',
  'mouse.exit_intent',
  'photo.opened',
  'photo.gallery.next',
  'photo.zoomed',
  'photo.dwell',
  'floorplan.opened',
  'floorplan.zoom',
  'floorplan.dwell',
  'price.hovered',
  'price.compared',
  'feature.expanded',
  'mortgage_calc.used',
  'search.query',
  'filter.applied',
  'filter.removed',
  'sort.changed',
  'chat.opened',
  'chat.message.sent',
  'chat.intent.detected',
  'listing.next',
  'listing.compared',
  'listing.bookmarked',
  'inquiry.started',
  'inquiry.completed',
  'tour.requested',
  'session.started',
  // DQS — TICKET-DQS-001
  'session.quality.snapshot',
  // A/B holdout — TICKET-AB-001
  'ab.assignment',
  // consent audit — TICKET-041
  'consent.granted',
  'consent.denied',
  // SDK observability — TICKET-RUNTIME-FIX-003
  'listing.viewed',
  'cta.clicked',
  'quiz.event',
  'quiz.mismatch',
  'sidebar.closed',
  'adapt.applied',
  'adapt.skipped',
  // primary pilot conversion — FOLLOW-195 / CEO Decision D-4 (2026-05-30)
  'live.signup',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
