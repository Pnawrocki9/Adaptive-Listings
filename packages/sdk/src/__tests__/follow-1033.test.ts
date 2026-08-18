// @vitest-environment jsdom
/**
 * FOLLOW-1033 — the boot decomposition must survive the session that measured it.
 *
 * FOLLOW-1027 established that the buyer-visible flicker window is ~95% SDK boot and only tens of
 * milliseconds of network. It established that by hand-instrumenting the SDK and then deleting the
 * instrumentation, so the obvious next question — WHICH part of boot — could not be answered
 * without redoing the work. These tests exist so that answer is a listener away, permanently.
 *
 * Rule Q: both cases drive the real `init()` body through `_initForTest()`. A test against
 * `bootTimings()` in isolation is exactly the shape that let FOLLOW-1027's copy cache pass its
 * unit tests for a week while never once reading a value back in production — the marks are laid
 * down INSIDE `init()`, so only `init()` can prove they are laid down at all.
 *
 * @module packages/sdk/src/__tests__/follow-1033
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest } from '../index.js';

const SESSION_ID = 'd'.repeat(64);

function okJson(body: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function adaptResponse(): unknown {
  return {
    adapt_decision_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    session_id: SESSION_ID,
    archetype: 'yield_hunter',
    confidence: 0.85,
    similarity: 0.9,
    tier: 1,
    source: 'playbook',
    generated_at: '2026-08-18T00:00:00.000Z',
    directives: [],
    ttl_seconds: 300,
    variant: 'control',
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
}

function insertScriptTag(): void {
  const script = document.createElement('script');
  script.dataset.apiKey = 'test-follow1033-key';
  script.dataset.decisionUrl = 'https://decision.estalara.com/api';
  script.dataset.tenantId = 'follow1033-tenant-id';
  document.head.appendChild(script);
}

function insertListingDom(): void {
  const listingEl = document.createElement('div');
  listingEl.setAttribute('data-estalara-listing', '');
  listingEl.setAttribute('data-estalara-listing-id', 'L-1033');
  document.body.appendChild(listingEl);

  const headlineEl = document.createElement('h2');
  headlineEl.setAttribute('data-estalara-slot', 'headline');
  headlineEl.textContent = 'Charming 4-Bedroom Colonial on Blackberry Lane';
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

/** Capture the `detail` payload of the settled event for one init run. */
function listenForSettled(): { detail: () => unknown; stop: () => void } {
  let captured: unknown;
  const handler = (e: Event): void => {
    captured = (e as CustomEvent).detail;
  };
  document.addEventListener('estalara:adapt:settled', handler);
  return {
    detail: () => captured,
    stop: () => {
      document.removeEventListener('estalara:adapt:settled', handler);
    },
  };
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (
        typeof url === 'string' &&
        url.includes('/adapt') &&
        !url.includes('/adapt/description')
      ) {
        return Promise.resolve(okJson(adaptResponse()));
      }
      return Promise.resolve(okJson({}));
    }),
  );
}

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

describe('FOLLOW-1033 — boot timings ride the settled event', () => {
  it('reports the decomposition, including the term the SDK cannot shrink', async () => {
    insertListingDom();
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    stubFetch();

    const settled = listenForSettled();
    await _initForTest();
    await flush();

    const timings = settled.detail() as Record<string, number>;
    expect(timings).toBeTypeOf('object');

    // `preInit` is navigation -> the SDK's first line: host hydration, loader injection, bundle
    // fetch and parse. It is reported precisely BECAUSE nothing in this package can move it — if
    // it dominates, the fix belongs on the host and no amount of SDK work will help.
    expect(timings.preInit).toBeTypeOf('number');
    expect(timings.preInit).toBeGreaterThanOrEqual(0);

    // The spans that answer "where did the rest go". `adapt` is the one FOLLOW-1027 measured at
    // tens of milliseconds against a boot of ~600ms.
    expect(timings.adapt).toBeTypeOf('number');
    expect(timings.total).toBeTypeOf('number');
    expect(timings.total).toBeGreaterThanOrEqual(timings.preInit);

    settled.stop();
  });

  it('still reveals the page when the Performance API is missing', async () => {
    // An embedded webview without `performance` must not stay cloaked for the full fail-safe
    // just because it cannot be measured. Timings degrade to {}; the reveal signal does not
    // degrade at all.
    vi.stubGlobal('performance', undefined);

    insertListingDom();
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    stubFetch();

    let fired = 0;
    const handler = (): void => {
      fired += 1;
    };
    document.addEventListener('estalara:adapt:settled', handler);

    await _initForTest();
    await flush();

    expect(fired).toBe(1);
    document.removeEventListener('estalara:adapt:settled', handler);
  });
});
