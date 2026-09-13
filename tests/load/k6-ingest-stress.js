/* global __ENV, __VU, __ITER */
/**
 * k6 stress test for the Estalara ingest endpoint.
 *
 * Goal: find the breaking point by ramping from 0 to 50,000 req/s over 5 minutes,
 * then sustain peak for 2 minutes before ramping down. No hard pass/fail thresholds —
 * the purpose is to observe WHERE latency degrades and errors appear, not to fail CI.
 *
 * Ramp profile:
 *   0 → 50,000 req/s over 5 minutes
 *   50,000 req/s for 2 minutes  (observe breaking point)
 *   50,000 → 0 req/s over 1 minute (drain)
 *
 * ⚠ WARNING: This test will likely cause errors in your target environment.
 *   That is intentional. Run ONLY against a dedicated staging environment and
 *   coordinate with ops / devops-engineer before triggering.
 *
 * Usage:
 *   INGEST_URL=https://ingest.staging.estalara.com \
 *   K6_TEST_API_KEY=pk_test_load \
 *   k6 run tests/load/k6-ingest-stress.js --out json=stress-results.json
 *
 * @see tests/load/README.md for full run instructions and result interpretation.
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

/** 429 rate-limit hit rate — useful for finding Cloudflare DO rate-limiter ceiling. */
const rateLimitedRate = new Rate('estalara_rate_limited');

/** 503 Redpanda backpressure hit rate — measures Redpanda saturation. */
const redpandaErrorRate = new Rate('estalara_redpanda_errors');

/** Latency trend for successful requests only. */
const successDuration = new Trend('estalara_success_duration', true);

// ── Configuration ─────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-arrival-rate',
      /**
       * Stress VU allocation: at 50k req/s with ~10ms p95 (optimistic), each VU can handle
       * ~100 req/s, so 500 VUs pre-allocated. maxVUs of 5000 covers worst-case 50ms latency.
       * In practice, Cloudflare Workers respond faster than local infrastructure, so 2000
       * maxVUs is the realistic ceiling for a single k6 runner.
       */
      preAllocatedVUs: 500,
      maxVUs: 5000,
      timeUnit: '1s',
      startRate: 0,
      stages: [
        { duration: '5m', target: 50000 }, // ramp to peak — observe degradation onset
        { duration: '2m', target: 50000 }, // hold at peak — measure steady-state behavior at limit
        { duration: '1m', target: 0 }, // ramp down
      ],
    },
  },

  /**
   * Stress thresholds are intentionally lenient — we want the test to COMPLETE
   * even when the system is breaking. Findings go into the README.
   * Only catastrophic conditions (complete outage > 50%) cause a test failure.
   */
  thresholds: {
    // Fail only if more than 50% of requests error (complete meltdown signal)
    http_req_failed: ['rate<0.5'],
    // Warn (non-blocking) if p99 exceeds 5 seconds
    http_req_duration: ['p(99)<5000'],
  },
};

// ── Environment ───────────────────────────────────────────────────────────────

const INGEST_URL = __ENV.INGEST_URL || 'http://localhost:8787';
const API_KEY = __ENV.K6_TEST_API_KEY || 'pk_test_load';

const TENANT_ID = __ENV.K6_TENANT_ID || '01928f00-7000-7000-8000-aaaaaaaaaaaa';

// ── Listing IDs and Photo IDs ─────────────────────────────────────────────────

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
  // FOLLOW-1201: k6 emulates the browser SDK, and the Worker now refuses an unsigned request
  // with no browser Origin (audit SEC-1). Must be on the target tenant's allow-list.
  Origin: __ENV.K6_ORIGIN || 'https://app.estalara.com',
};

// ── UUID helper ───────────────────────────────────────────────────────────────

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function pick(arr) {
  return arr[randomIntBetween(0, arr.length - 1)];
}

// ── Payload builders ──────────────────────────────────────────────────────────

function pageViewPayload() {
  const listingId = pick(LISTING_IDS);
  return {
    url: `https://example.com/listings/${listingId}`,
    referrer: 'https://google.com/search',
    viewport: { width: pick([1440, 1920, 375, 768]), height: pick([900, 1080, 812, 1024]) },
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
  return { photo_id: pick(PHOTO_IDS), zoom_level: pick([1.5, 2.0, 2.5, 3.0]) };
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
  return { against_listing_id: pick(LISTING_IDS), delta_pct: randomIntBetween(-20, 20) };
}

function featureExpandedPayload() {
  return {
    feature: pick(['energy_certificate', 'parking', 'storage', 'pool', 'garden']),
    label: pick(['A', 'B', 'C', 'yes', 'no']),
  };
}

function mortgageCalcUsedPayload() {
  return {
    down_payment_pct: pick([10, 15, 20, 25, 30]),
    term_years: pick([15, 20, 25, 30]),
    monthly_payment: randomIntBetween(800, 5000),
    interest_rate_pct: pick([3.5, 4.0, 4.5, 5.0]),
  };
}

function searchQueryPayload() {
  return {
    query: pick(['penthouse sea view', '3 bed near school', 'villa with pool']),
    results_count: randomIntBetween(0, 200),
  };
}

function filterAppliedPayload() {
  return {
    facet: pick(['price_max', 'price_min', 'bedrooms_min', 'has_pool']),
    value: pick([500000, 300000, 3, true]),
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
  const message = pick([
    'Looking for 3-bed near school',
    'Does it have a pool?',
    'Is the price negotiable?',
    'How far is the beach?',
  ]);
  return { message, char_count: message.length, locale: pick(['en-GB', 'en-US', 'es-ES']) };
}

function listingNextPayload() {
  const from = pick(LISTING_IDS);
  return {
    from_listing_id: from,
    to_listing_id: pick(LISTING_IDS.filter((id) => id !== from)),
    via: pick(['next_button', 'related', 'search_results']),
  };
}

function listingComparedPayload() {
  return { listing_ids: [pick(LISTING_IDS), pick(LISTING_IDS)].slice(0, 2) };
}

function listingBookmarkedPayload() {
  return { collection: pick(['shortlist', 'favorites']) };
}

function inquiryStartedPayload() {
  return { form_variant: pick(['contact_v1', 'contact_v2']) };
}

function sessionStartedPayload() {
  return {
    device_class: pick(['desktop', 'mobile', 'tablet']),
    viewport: { width: pick([1440, 375, 768]), height: pick([900, 812, 1024]) },
    language: pick(['en-GB', 'en-US', 'es-ES', 'de-DE']),
    time_of_day: pick(['morning', 'afternoon', 'evening', 'night']),
  };
}

// ── Weighted event pool ───────────────────────────────────────────────────────

const EVENT_BUILDERS = [
  ['page.view', pageViewPayload, 8],
  ['page.exit', pageExitPayload, 6],
  ['tab.visible', tabVisiblePayload, 4],
  ['tab.hidden', tabHiddenPayload, 4],
  ['scroll.depth', scrollDepthPayload, 15],
  ['mouse.dwell', mouseDwellPayload, 12],
  ['mouse.rage_click', mouseRageClickPayload, 2],
  ['mouse.exit_intent', mouseExitIntentPayload, 3],
  ['photo.opened', photoOpenedPayload, 10],
  ['photo.gallery.next', photoGalleryNextPayload, 12],
  ['photo.zoomed', photoZoomedPayload, 5],
  ['photo.dwell', photoDwellPayload, 8],
  ['floorplan.opened', floorplanOpenedPayload, 4],
  ['floorplan.zoom', floorplanZoomPayload, 3],
  ['floorplan.dwell', floorplanDwellPayload, 3],
  ['price.hovered', priceHoveredPayload, 8],
  ['price.compared', priceComparedPayload, 2],
  ['feature.expanded', featureExpandedPayload, 6],
  ['mortgage_calc.used', mortgageCalcUsedPayload, 3],
  ['search.query', searchQueryPayload, 5],
  ['filter.applied', filterAppliedPayload, 7],
  ['filter.removed', filterRemovedPayload, 4],
  ['sort.changed', sortChangedPayload, 3],
  ['chat.opened', chatOpenedPayload, 3],
  ['chat.message.sent', chatMessageSentPayload, 4],
  ['listing.next', listingNextPayload, 5],
  ['listing.compared', listingComparedPayload, 2],
  ['listing.bookmarked', listingBookmarkedPayload, 3],
  ['inquiry.started', inquiryStartedPayload, 2],
  ['session.started', sessionStartedPayload, 3],
];

const WEIGHTED_POOL = [];
for (const [type, builder, weight] of EVENT_BUILDERS) {
  for (let i = 0; i < weight; i++) {
    WEIGHTED_POOL.push([type, builder]);
  }
}

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

// ── Default function ──────────────────────────────────────────────────────────

export default function () {
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
    tags: { scenario: 'stress' },
    // Lower timeout to fail fast during saturation — we care more about throughput
    // than waiting forever for a slow response.
    timeout: '10s',
  });

  check(res, {
    'status 200': (r) => r.status === 200,
    'no server error (5xx)': (r) => r.status < 500,
  });

  // Track error categories for post-run analysis
  const isError = res.status !== 200;
  requestErrors.add(isError);
  rateLimitedRate.add(res.status === 429);
  redpandaErrorRate.add(res.status === 503);

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
      // ignore
    }
  }
}

// ── Summary handler — print breaking-point analysis ──────────────────────────

export function handleSummary(data) {
  const duration = data.metrics['http_req_duration'];
  const failed = data.metrics['http_req_failed'];
  const rateLimited = data.metrics['estalara_rate_limited'];
  const redpandaErrors = data.metrics['estalara_redpanda_errors'];

  const lines = [
    '=== Stress Test Summary ===',
    '',
    `Total requests   : ${String(data.metrics['http_reqs']?.values?.count ?? 'N/A')}`,
    `Error rate       : ${String(((failed?.values?.rate ?? 0) * 100).toFixed(2))}%`,
    `Rate-limited (429): ${String(((rateLimited?.values?.rate ?? 0) * 100).toFixed(2))}%`,
    `Redpanda 503s    : ${String(((redpandaErrors?.values?.rate ?? 0) * 100).toFixed(2))}%`,
    '',
    `Latency p50      : ${String(duration?.values?.['p(50)'] ?? 'N/A')} ms`,
    `Latency p95      : ${String(duration?.values?.['p(95)'] ?? 'N/A')} ms`,
    `Latency p99      : ${String(duration?.values?.['p(99)'] ?? 'N/A')} ms`,
    `Latency max      : ${String(duration?.values?.max ?? 'N/A')} ms`,
    '',
    'Investigate the timeline where p95 first crossed 50ms and error rate first',
    'exceeded 0.1% — that is the effective throughput ceiling for this deployment.',
    '',
    'File follow-up tickets for any sustained 429s (rate-limiter tuning) or',
    '503s (Redpanda capacity / producer retry configuration).',
  ];

  const summary = lines.join('\n') + '\n';

  // Return to stdout AND write to file for artifact upload
  return {
    stdout: summary,
    'stress-summary.txt': summary,
  };
}
