// @vitest-environment jsdom
/**
 * FOLLOW-1138 — `detectPageType()` defaulted to `listing_list` for any detail page whose URL
 * doesn't contain `/listing/` and whose script tag doesn't set `data-page-type`, silently
 * stripping the `headline` directive server-side (`filterDirectivesByPageType()`,
 * `apps/control-plane/src/app/api/adapt/route.ts:1269`). This is exactly the FOLLOW-819 fixture's
 * shape (`fixture-listing.html`, served at `/fixture-listing.html`, neither signal present).
 *
 * Two things are tested here, both through the REAL `init()` path (Rule Q — a test against
 * `resolvePageType()` in isolation proves the heuristic is correct but not that the fix reaches
 * the real `/api/adapt` request body or the real ingest event pipeline):
 *   1. The `POST /api/adapt` request body now carries `page_type: 'listing_detail'` for a page
 *      whose only detail-page signal is a single `[data-estalara-listing-id]` element.
 *   2. An `adapt.page_type_resolved` event reaches ingest with `provenance: 'dom_signal'`.
 *
 * A pure-function suite for `resolvePageType()`/`detectPageType()` covers the branch matrix
 * (grid pages, explicit attribute, URL heuristic, DOM signal) without the network harness.
 *
 * @module packages/sdk/src/__tests__/follow-1138
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest, detectPageType, resolvePageType } from '../index.js';

const SESSION_ID = 'f'.repeat(64);

function okJson(body: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function adaptResponse(): unknown {
  return {
    adapt_decision_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    session_id: SESSION_ID,
    archetype: 'yield_hunter',
    confidence: 0.85,
    similarity: 0.9,
    page_context: 2,
    source: 'playbook',
    generated_at: '2026-08-26T00:00:00.000Z',
    directives: [],
    variant: 'control',
  };
}

function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
}

function insertScriptTag(): void {
  const script = document.createElement('script');
  script.dataset.apiKey = 'test-follow1138-key';
  script.dataset.decisionUrl = 'https://decision.estalara.com/api';
  script.dataset.tenantId = 'follow1138-tenant-id';
  document.head.appendChild(script);
}

/** Exactly ONE listing element -- the FOLLOW-819 fixture's real shape. */
function insertSingleListingDom(): void {
  const listingEl = document.createElement('div');
  listingEl.setAttribute('data-estalara-listing', '');
  listingEl.setAttribute('data-estalara-listing-id', 'L-1138');
  document.body.appendChild(listingEl);
}

function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  document.querySelectorAll('script[data-api-key]').forEach((el) => {
    el.remove();
  });
  document
    .querySelectorAll('[data-estalara-host], [data-estalara-listing], [data-estalara-slot]')
    .forEach((el) => {
      el.remove();
    });
  try {
    performance.clearMarks();
  } catch {
    // jsdom always has performance.clearMarks; guarded for parity with production code
  }
}

class MockIntersectionObserver {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

interface IngestCall {
  url: string;
  body: { events: { type: string; payload: Record<string, unknown> }[] };
}

interface AdaptCall {
  url: string;
  body: Record<string, unknown>;
}

/** Stubs fetch for both /adapt and the ingest endpoint, capturing every request body of each. */
function stubFetchCapturingBoth(ingestUrl: string): {
  ingestCalls: IngestCall[];
  adaptCalls: AdaptCall[];
} {
  const ingestCalls: IngestCall[] = [];
  const adaptCalls: AdaptCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (
        typeof url === 'string' &&
        url.includes('/adapt') &&
        !url.includes('/adapt/description')
      ) {
        adaptCalls.push({ url, body: JSON.parse((init?.body ?? '{}') as string) });
        return Promise.resolve(okJson(adaptResponse()));
      }
      if (typeof url === 'string' && url === ingestUrl) {
        ingestCalls.push({ url, body: JSON.parse((init?.body ?? '{}') as string) });
      }
      return Promise.resolve(okJson({}));
    }),
  );
  return { ingestCalls, adaptCalls };
}

const INGEST_URL = 'https://ingest.estalara.com/v1/events';

beforeEach(() => {
  clearAll();
  vi.restoreAllMocks();
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  const teardown = (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  if (teardown) {
    teardown();
    delete (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  }
  clearAll();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FOLLOW-1138 — page-type resolution reaches the real /adapt request and ingest', () => {
  it(
    'a single-listing page with no /listing/ URL and no data-page-type sends ' +
      "page_type: 'listing_detail' to /api/adapt (the real fixed request, not the pure function)",
    async () => {
      insertSingleListingDom();
      seedSession();
      localStorage.setItem('estalara_consent', 'granted');
      insertScriptTag();
      const { adaptCalls } = stubFetchCapturingBoth(INGEST_URL);

      await _initForTest();

      expect(adaptCalls.length).toBeGreaterThan(0);
      expect(adaptCalls[0]?.body.page_type).toBe('listing_detail');
    },
  );

  it('emits adapt.page_type_resolved (provenance: dom_signal) through the real ingest pipeline', async () => {
    insertSingleListingDom();
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    const { ingestCalls } = stubFetchCapturingBoth(INGEST_URL);

    await _initForTest();

    window.dispatchEvent(new Event('beforeunload'));
    await Promise.resolve();
    await Promise.resolve();

    const allEvents = ingestCalls.flatMap((c) => c.body.events);
    const resolvedEvents = allEvents.filter((e) => e.type === 'adapt.page_type_resolved');
    // One per refreshDirectives() cycle -- init() can trigger more than one cycle for a single
    // page load (e.g. an initial call plus a listing.viewed-triggered refresh); every cycle on
    // this unchanged DOM must resolve identically.
    expect(resolvedEvents.length).toBeGreaterThanOrEqual(1);
    for (const e of resolvedEvents) {
      expect(e.payload).toMatchObject({ page_type: 'listing_detail', provenance: 'dom_signal' });
    }
  });

  it('does NOT emit adapt.page_type_resolved for an ordinary grid page (no listing signal at all)', async () => {
    // No listing element inserted -- an ordinary listing_list / home / search page.
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    const { ingestCalls, adaptCalls } = stubFetchCapturingBoth(INGEST_URL);

    await _initForTest();
    window.dispatchEvent(new Event('beforeunload'));
    await Promise.resolve();
    await Promise.resolve();

    expect(adaptCalls[0]?.body.page_type).toBe('listing_list');
    const allEvents = ingestCalls.flatMap((c) => c.body.events);
    expect(allEvents.some((e) => e.type === 'adapt.page_type_resolved')).toBe(false);
  });
});

describe('FOLLOW-1138 — resolvePageType()/detectPageType() branch matrix (pure function)', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: { pathname: '/' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: originalLocation,
    });
    document.querySelectorAll('[data-estalara-listing-id]').forEach((el) => {
      el.remove();
    });
  });

  it('a page with exactly one [data-estalara-listing-id] resolves listing_detail via dom_signal (the FOLLOW-819 fixture shape)', () => {
    const el = document.createElement('div');
    el.setAttribute('data-estalara-listing-id', 'only-one');
    document.body.appendChild(el);

    const emptyDataset: DOMStringMap = {};
    const resolution = resolvePageType(emptyDataset);
    expect(resolution.pageType).toBe('listing_detail');
    expect(resolution.provenance).toBe('dom_signal');
    expect(detectPageType(emptyDataset)).toBe('listing_detail');
  });

  it('a grid page with MANY [data-estalara-listing-id] elements (one per card) is NOT misclassified as detail', () => {
    for (let i = 0; i < 6; i++) {
      const el = document.createElement('div');
      el.setAttribute('data-estalara-listing-id', `card-${String(i)}`);
      document.body.appendChild(el);
    }

    const resolution = resolvePageType({});
    expect(resolution.pageType).toBe('listing_list');
    expect(resolution.provenance).toBe('default');
  });

  it('a page with zero listing elements defaults to listing_list (default provenance)', () => {
    const resolution = resolvePageType({});
    expect(resolution.pageType).toBe('listing_list');
    expect(resolution.provenance).toBe('default');
  });

  it('the URL /listing/ heuristic still wins over the DOM signal (provenance: url)', () => {
    window.location.pathname = '/listing/123-maple-street';
    const resolution = resolvePageType({});
    expect(resolution.pageType).toBe('listing_detail');
    expect(resolution.provenance).toBe('url');
  });

  it('an explicit data-page-type attribute still wins over both URL and DOM signal', () => {
    window.location.pathname = '/listing/123';
    const el = document.createElement('div');
    el.setAttribute('data-estalara-listing-id', 'x');
    document.body.appendChild(el);

    const dataset = { pageType: 'listing_list' } as unknown as DOMStringMap;
    const resolution = resolvePageType(dataset);
    expect(resolution.pageType).toBe('listing_list');
    expect(resolution.provenance).toBe('attribute');
  });
});
