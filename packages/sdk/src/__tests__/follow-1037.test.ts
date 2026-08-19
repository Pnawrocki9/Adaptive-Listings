// @vitest-environment jsdom
/**
 * FOLLOW-1037 — the boot decomposition FOLLOW-1033 made permanent must reach ClickHouse
 * from real sessions, through the SAME ingest event pipeline every other SDK event uses.
 *
 * Rule Q: drives the real `init()` body through `_initForTest()`, then forces a REAL flush
 * (`window.dispatchEvent(new Event('beforeunload'))`, the production teardown path that calls
 * `handleSessionEnd()` -> `flush()` -> `dispatchEvents()`) and inspects the REAL `fetch` call
 * made to the ingest endpoint. This is the FOLLOW-1033 test's own warning made concrete: a test
 * against `eventQueue` or `dispatchEvents()` in isolation would prove nothing about whether the
 * boot_timing push actually happens inside `init()`.
 *
 * @module packages/sdk/src/__tests__/follow-1037
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest } from '../index.js';

const SESSION_ID = 'e'.repeat(64);

function okJson(body: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function adaptResponse(): unknown {
  return {
    adapt_decision_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    session_id: SESSION_ID,
    archetype: 'yield_hunter',
    confidence: 0.85,
    similarity: 0.9,
    tier: 1,
    source: 'playbook',
    generated_at: '2026-08-19T00:00:00.000Z',
    directives: [],
    ttl_seconds: 300,
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
  script.dataset.apiKey = 'test-follow1037-key';
  script.dataset.decisionUrl = 'https://decision.estalara.com/api';
  script.dataset.tenantId = 'follow1037-tenant-id';
  document.head.appendChild(script);
}

function insertListingDom(): void {
  const listingEl = document.createElement('div');
  listingEl.setAttribute('data-estalara-listing', '');
  listingEl.setAttribute('data-estalara-listing-id', 'L-1037');
  document.body.appendChild(listingEl);

  const headlineEl = document.createElement('h2');
  headlineEl.setAttribute('data-estalara-slot', 'headline');
  headlineEl.textContent = 'Sunlit 3-Bedroom Bungalow on Larch Terrace';
  document.body.appendChild(headlineEl);
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

/** Stubs fetch for both /adapt and the ingest endpoint, capturing every ingest POST body. */
function stubFetchCapturingIngest(ingestUrl: string): { calls: IngestCall[] } {
  const calls: IngestCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (
        typeof url === 'string' &&
        url.includes('/adapt') &&
        !url.includes('/adapt/description')
      ) {
        return Promise.resolve(okJson(adaptResponse()));
      }
      if (typeof url === 'string' && url === ingestUrl) {
        calls.push({ url, body: JSON.parse((init?.body ?? '{}') as string) });
      }
      return Promise.resolve(okJson({}));
    }),
  );
  return { calls };
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

describe('FOLLOW-1037 — boot_timing reaches ingest through the real event pipeline', () => {
  it('queues exactly one boot_timing event and flushes it to the SAME ingest endpoint as every other event', async () => {
    insertListingDom();
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    const { calls } = stubFetchCapturingIngest(INGEST_URL);

    await _initForTest();

    // Force the REAL flush path — the same `beforeunload` handler production wires via
    // `window.addEventListener('beforeunload', handleBeforeUnload)` in init().
    window.dispatchEvent(new Event('beforeunload'));
    await Promise.resolve();
    await Promise.resolve();

    const allEvents = calls.flatMap((c) => c.body.events);
    const bootTimingEvents = allEvents.filter((e) => e.type === 'boot_timing');

    // Reused the SAME ingest endpoint every other SDK event uses — no new transport.
    expect(calls.every((c) => c.url === INGEST_URL)).toBe(true);

    // At most (and here, exactly) one boot_timing event for this one page load.
    expect(bootTimingEvents).toHaveLength(1);

    const payload = bootTimingEvents[0]?.payload;
    expect(payload).toBeDefined();
    expect(payload?.preInit).toBeTypeOf('number');
    expect(payload?.total).toBeTypeOf('number');
    expect((payload?.total as number) >= (payload?.preInit as number)).toBe(true);
  });

  it('never sends boot_timing when consent is denied (same gate as every other event)', async () => {
    insertListingDom();
    seedSession();
    localStorage.setItem('estalara_consent', 'denied');
    insertScriptTag();
    const { calls } = stubFetchCapturingIngest(INGEST_URL);

    await _initForTest();
    window.dispatchEvent(new Event('beforeunload'));
    await Promise.resolve();
    await Promise.resolve();

    const allEvents = calls.flatMap((c) => c.body.events);
    expect(allEvents.some((e) => e.type === 'boot_timing')).toBe(false);
  });
});
