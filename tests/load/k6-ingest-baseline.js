/**
 * k6 baseline load test for the Estalara ingest endpoint.
 *
 * Target: sustain 10,000 req/s with p95 < 50ms, p99 < 200ms, error rate < 0.1%.
 *
 * Ramp profile:
 *   0 → 10,000 req/s over 1 minute (warm-up)
 *   10,000 req/s for 5 minutes   (steady-state measurement window)
 *   10,000 → 0 req/s over 1 minute (cool-down)
 *
 * Usage:
 *   INGEST_URL=https://ingest.staging.estalara.com \
 *   K6_TEST_API_KEY=pk_test_load \
 *   k6 run tests/load/k6-ingest-baseline.js
 *
 * @see tests/load/README.md for full run instructions.
 */

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ── Custom metrics ────────────────────────────────────────────────────────────

/** Total number of events accepted across all batches. */
const eventsAccepted = new Counter('estalara_events_accepted');

/** Total number of events rejected (validation failures) in successful responses. */
const eventsRejected = new Counter('estalara_events_rejected');

/** Rate of requests that returned a non-200 status. */
const requestErrors = new Rate('estalara_request_errors');

/** Duration of only the successful (200) requests for a clean latency distribution. */
const successDuration = new Trend('estalara_success_duration', true);

// ── Configuration ─────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    baseline: {
      executor: 'ramping-arrival-rate',
      /**
       * Pre-allocate enough VUs to service 10k req/s. Each VU can handle
       * ~20 req/s on a fast network (50ms p95 latency), so 500 VUs is a
       * reasonable baseline. maxVUs acts as a safety cap.
       */
      preAllocatedVUs: 500,
      maxVUs: 2000,
      timeUnit: '1s',
      startRate: 0,
      stages: [
        { duration: '1m', target: 10000 }, // ramp-up
        { duration: '5m', target: 10000 }, // steady state
        { duration: '1m', target: 0 }, // ramp-down
      ],
    },
  },

  thresholds: {
    // Primary SLA: p95 < 50ms, p99 < 200ms (matches CONVENTIONS.md performance budget)
    http_req_duration: ['p(95)<50', 'p(99)<200'],
    // Error rate must stay below 0.1% (1 in 1000 requests)
    http_req_failed: ['rate<0.001'],
    // Custom: accepted events counter must be non-zero (smoke sanity)
    estalara_request_errors: ['rate<0.001'],
  },
};

// ── Environment ───────────────────────────────────────────────────────────────

const INGEST_URL = __ENV.INGEST_URL || 'http://localhost:8787';
const API_KEY = __ENV.K6_TEST_API_KEY || 'pk_test_load';

/**
 * Tenant UUID used across all load-test events. Must be pre-provisioned in staging
 * with the API key above. The ingest worker overwrites `tenant_id` from the auth
 * result, so this value just needs to be a valid UUID format for Zod to pass.
 */
const TENANT_ID = __ENV.K6_TENANT_ID || '01928f00-7000-7000-8000-aaaaaaaaaaaa';

// ── Listing IDs (used as realistic foreign keys) ──────────────────────────────

const LISTING_IDS = [
  'l_001',
  'l_002',
  'l_003',
  'l_004',
  'l_005',
  'l_006',
  'l_007',
  'l_008',
  'l_009',
  'l_010',
];

const PHOTO_IDS = ['p_01', 'p_02', 'p_03', 'p_04', 'p_05', 'p_06', 'p_07', 'p_08'];

// ── Common headers ────────────────────────────────────────────────────────────

const HEADERS = {
  'Content-Type': 'application/json',
  'X-Estalara-API-Key': API_KEY,
};

// ── UUID helpers (k6 doesn't expose crypto.randomUUID in all versions) ─────

/**
 * Generates a v4-compatible UUID using k6's Math.random().
 * Not cryptographically random, but valid for Zod's z.string().uuid() check.
 */
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns a random element from an array.
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
function pick(arr) {
  return arr[randomIntBetween(0, arr.length - 1)];
}

// ── Per-type payload builders ─────────────────────────────────────────────────
// Each returns a valid payload object that satisfies the corresponding Zod schema
// defined in packages/shared/src/schemas/events/.

function pageViewPayload() {
  const listingId = pick(LISTING_IDS);
  return {
    url: `https://example.com/listings/${listingId}`,
    referrer: 'https://google.com/search',
    viewport: { width: pick([1440, 1920, 375, 768, 1280]), height: pick([900, 1080, 812, 1024]) },
    device_class: pick(['desktop', 'mobile', 'tablet']),
  };
}

function pageExitPayload() {
  return {
    url: `https://example.com/listings/${pick(LISTING_IDS)}`,
    dwell_ms: randomIntBetween(5000, 120000),
    scrolled_max_pct: randomIntBetween(10, 100),
  };
}

function tabVisiblePayload() {
  return { hidden_for_ms: randomIntBetween(1000, 30000) };
}

function tabHiddenPayload() {
  return { visible_for_ms: randomIntBetween(5000, 60000) };
}

function scrollDepthPayload() {
  return {
    pct: pick([10, 25, 50, 75, 90]),
    viewport_height: 900,
    page_height: randomIntBetween(3000, 8000),
  };
}

function mouseDwellPayload() {
  return {
    element: pick(['feature.pool', 'feature.garden', 'price.label', 'cta.contact', 'photo.hero']),
    dwell_ms: randomIntBetween(500, 5000),
  };
}

function mouseRageClickPayload() {
  return {
    element: pick(['cta.contact', 'cta.tour', 'btn.next_photo']),
    click_count: randomIntBetween(3, 7),
  };
}

function mouseExitIntentPayload() {
  return { dwell_ms: randomIntBetween(10000, 60000) };
}

function photoOpenedPayload() {
  return {
    photo_id: pick(PHOTO_IDS),
    position: randomIntBetween(0, 7),
    total: 8,
    category: pick(['exterior', 'interior', 'kitchen', 'bathroom', 'garden']),
  };
}

function photoGalleryNextPayload() {
  const from = randomIntBetween(0, 6);
  return {
    from_photo_id: `p_0${from + 1}`,
    to_photo_id: `p_0${from + 2}`,
    direction: pick(['forward', 'backward']),
  };
}

function photoZoomedPayload() {
  return {
    photo_id: pick(PHOTO_IDS),
    zoom_level: pick([1.5, 2.0, 2.5, 3.0]),
  };
}

function photoDwellPayload() {
  return {
    photo_id: pick(PHOTO_IDS),
    dwell_ms: randomIntBetween(1500, 15000),
    category: pick(['exterior', 'interior', 'kitchen', 'bathroom']),
  };
}

function floorplanOpenedPayload() {
  return { source: pick(['gallery_button', 'inline_link', 'sidebar', 'auto']) };
}

function floorplanZoomPayload() {
  return { zoom_level: pick([1.2, 1.5, 1.8, 2.0, 2.5]) };
}

function floorplanDwellPayload() {
  return { dwell_ms: randomIntBetween(3000, 30000) };
}

function priceHoveredPayload() {
  return {
    price: pick([250000, 350000, 450000, 550000, 750000, 1200000]),
    currency: pick(['EUR', 'GBP', 'USD', 'AED']),
    dwell_ms: randomIntBetween(500, 5000),
  };
}

function priceComparedPayload() {
  return {
    against_listing_id: pick(LISTING_IDS),
    delta_pct: randomIntBetween(-20, 20),
  };
}

function featureExpandedPayload() {
  return {
    feature: pick([
      'energy_certificate',
      'parking',
      'storage',
      'pool',
      'garden',
      'air_conditioning',
    ]),
    label: pick(['A', 'B', 'C', 'D', 'yes', 'no']),
  };
}

function mortgageCalcUsedPayload() {
  return {
    down_payment_pct: pick([10, 15, 20, 25, 30]),
    term_years: pick([15, 20, 25, 30]),
    monthly_payment: randomIntBetween(800, 5000),
    interest_rate_pct: pick([3.5, 4.0, 4.5, 5.0, 5.5]),
  };
}

function searchQueryPayload() {
  return {
    query: pick([
      'penthouse marbella sea view',
      '3 bed near school',
      'villa with pool',
      'apartment city centre',
      'house garden quiet',
    ]),
    results_count: randomIntBetween(0, 200),
  };
}

function filterAppliedPayload() {
  return {
    facet: pick(['price_max', 'price_min', 'bedrooms_min', 'bathrooms_min', 'has_pool']),
    value: pick([500000, 300000, 3, 2, true]),
  };
}

function filterRemovedPayload() {
  return { facet: pick(['price_max', 'bedrooms_min', 'has_pool']) };
}

function sortChangedPayload() {
  return { sort_by: pick(['price_asc', 'price_desc', 'newest', 'relevance']) };
}

function chatOpenedPayload() {
  return { trigger: pick(['cta_click', 'auto_prompt', 'inline_link']) };
}

function chatMessageSentPayload() {
  const messages = [
    'Looking for 3-bed near international school',
    'What is the price negotiable?',
    'Does it have a pool and garden?',
    'How far is the nearest beach?',
    'Is parking included?',
  ];
  const message = pick(messages);
  return {
    message,
    char_count: message.length,
    locale: pick(['en-GB', 'en-US', 'es-ES', 'de-DE']),
  };
}

function listingNextPayload() {
  const from = pick(LISTING_IDS);
  const to = pick(LISTING_IDS.filter((id) => id !== from));
  return {
    from_listing_id: from,
    to_listing_id: to,
    via: pick(['next_button', 'related', 'search_results']),
  };
}

function listingComparedPayload() {
  return { listing_ids: [pick(LISTING_IDS), pick(LISTING_IDS), pick(LISTING_IDS)].slice(0, 2) };
}

function listingBookmarkedPayload() {
  return { collection: pick(['shortlist', 'favorites', 'to_visit']) };
}

function inquiryStartedPayload() {
  return { form_variant: pick(['contact_v1', 'contact_v2', 'minimal']) };
}

function sessionStartedPayload() {
  return {
    device_class: pick(['desktop', 'mobile', 'tablet']),
    viewport: { width: pick([1440, 375, 768, 1280]), height: pick([900, 812, 1024, 720]) },
    language: pick(['en-GB', 'en-US', 'es-ES', 'de-DE', 'fr-FR', 'nl-NL', 'ar-AE']),
    time_of_day: pick(['morning', 'afternoon', 'evening', 'night']),
    timezone_offset_minutes: pick([-300, 0, 60, 120, 240]),
  };
}

// ── Event type registry ───────────────────────────────────────────────────────
//
// Each entry is [type_string, payload_builder, relative_weight].
// Weights model realistic session traffic distributions from Master Design C.1.
// Higher-frequency event types (scroll, photo, mouse) get more weight.

const EVENT_BUILDERS = [
  // page lifecycle — 4 types, moderate frequency
  ['page.view', pageViewPayload, 8],
  ['page.exit', pageExitPayload, 6],
  ['tab.visible', tabVisiblePayload, 4],
  ['tab.hidden', tabHiddenPayload, 4],
  // mouse / scroll — 4 types, highest frequency
  ['scroll.depth', scrollDepthPayload, 15],
  ['mouse.dwell', mouseDwellPayload, 12],
  ['mouse.rage_click', mouseRageClickPayload, 2],
  ['mouse.exit_intent', mouseExitIntentPayload, 3],
  // photo — 4 types, high frequency
  ['photo.opened', photoOpenedPayload, 10],
  ['photo.gallery.next', photoGalleryNextPayload, 12],
  ['photo.zoomed', photoZoomedPayload, 5],
  ['photo.dwell', photoDwellPayload, 8],
  // floorplan — 3 types, low-moderate frequency
  ['floorplan.opened', floorplanOpenedPayload, 4],
  ['floorplan.zoom', floorplanZoomPayload, 3],
  ['floorplan.dwell', floorplanDwellPayload, 3],
  // price / feature — 4 types, moderate frequency
  ['price.hovered', priceHoveredPayload, 8],
  ['price.compared', priceComparedPayload, 2],
  ['feature.expanded', featureExpandedPayload, 6],
  ['mortgage_calc.used', mortgageCalcUsedPayload, 3],
  // search / filter — 4 types, moderate frequency
  ['search.query', searchQueryPayload, 5],
  ['filter.applied', filterAppliedPayload, 7],
  ['filter.removed', filterRemovedPayload, 4],
  ['sort.changed', sortChangedPayload, 3],
  // chat — 2 client-emitted types (chat.intent.detected is server-side only)
  ['chat.opened', chatOpenedPayload, 3],
  ['chat.message.sent', chatMessageSentPayload, 4],
  // cross-listing — 3 types, low-moderate frequency
  ['listing.next', listingNextPayload, 5],
  ['listing.compared', listingComparedPayload, 2],
  ['listing.bookmarked', listingBookmarkedPayload, 3],
  // inquiry / conversion — 1 of the 3 types (server-side types excluded)
  ['inquiry.started', inquiryStartedPayload, 2],
  // device / context — 1 per session, very low frequency relative to others
  ['session.started', sessionStartedPayload, 3],
];

// Pre-compute a flat weighted lookup array for O(1) weighted random selection.
const WEIGHTED_POOL = [];
for (const [type, builder, weight] of EVENT_BUILDERS) {
  for (let i = 0; i < weight; i++) {
    WEIGHTED_POOL.push([type, builder]);
  }
}

/**
 * Samples a single event object with a valid envelope and type-specific payload.
 * The session_id uses a 40-char hex string (matches z.string().min(32).max(64)).
 *
 * @param {string} sessionId - 40-char session fingerprint
 * @param {string} listingId - optional listing context
 * @returns {object} Valid EventEnvelope-compatible object
 */
function sampleEvent(sessionId, listingId) {
  const [type, buildPayload] = pick(WEIGHTED_POOL);
  return {
    event_id: uuid(),
    tenant_id: TENANT_ID,
    session_id: sessionId,
    ts: Date.now(),
    region: pick(['eu', 'us', 'uk', 'uae']),
    consent_state: pick(['legitimate-interest', 'consented', 'session-only']),
    schema_version: 1,
    type,
    payload: buildPayload(),
    listing_id: listingId,
  };
}

// ── Default function (executed by each VU on each iteration) ─────────────────

export default function () {
  // Session ID: 40-char hex to satisfy z.string().min(32).max(64)
  const sessionId = `${__VU.toString(16).padStart(8, '0')}${__ITER.toString(16).padStart(16, '0')}abcdef1234567890`;
  const listingId = pick(LISTING_IDS);
  const batchSize = randomIntBetween(3, 20);

  const events = [];
  for (let i = 0; i < batchSize; i++) {
    events.push(sampleEvent(sessionId, listingId));
  }

  const payload = JSON.stringify({ events });

  const res = http.post(`${INGEST_URL}/v1/events`, payload, {
    headers: HEADERS,
    tags: { scenario: 'baseline' },
  });

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'body has accepted field': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.accepted === 'number';
      } catch {
        return false;
      }
    },
    'no server error (5xx)': (r) => r.status < 500,
  });

  // Record custom metrics
  requestErrors.add(!ok);

  if (res.status === 200) {
    successDuration.add(res.timings.duration);
    try {
      const body = JSON.parse(res.body);
      if (typeof body.accepted === 'number') {
        eventsAccepted.add(body.accepted);
      }
      if (typeof body.rejected === 'number') {
        eventsRejected.add(body.rejected);
      }
    } catch {
      // malformed JSON — already captured by check above
    }
  }
}
