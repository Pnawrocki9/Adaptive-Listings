// @vitest-environment jsdom
/**
 * FOLLOW-1027 — the buyer must not read copy written for someone else.
 *
 * MEASURED, on the local pilot substrate, reloading a listing the session had already seen
 * adapted: the tenant's original headline was visible at 99ms and the adapted one landed at
 * 687ms — 588ms of the wrong copy on screen, with no model work in that window. The SDK loader
 * is injected `async` from the host's root-layout `onMount`, so it structurally cannot start
 * until after hydration and first paint. Nothing that runs after paint can fix that, which is
 * why the visible half of this fix is an inline `<head>` cloak on the HOST, not SDK code.
 *
 * The SDK's whole contribution is this event. The cloak hides `[data-estalara-slot]` only for a
 * session that has already resolved a non-neutral archetype, and un-cloaks on whichever comes
 * first: this event, or its own fail-safe timeout. So the event is what turns a fixed-length
 * mask into one that lasts exactly as long as the decision takes.
 *
 * THE CASE THAT MATTERS IS THE EMPTY ONE. A page where nothing was adapted must still fire,
 * or it stays masked for the full timeout for no reason at all. That is the second test below.
 *
 * Rule Q: driven through the real `init()` body via `_initForTest()`. The dispatch sits in
 * `init()` after the first decision cycle, so a test against a helper would prove nothing about
 * whether it actually fires.
 *
 * @module packages/sdk/src/__tests__/follow-1027
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest } from '../index.js';

const SESSION_ID = 'a'.repeat(64);
const ORIGINAL_HEADLINE = 'Charming 4-Bedroom Colonial on Blackberry Lane';
const ADAPTED_HEADLINE = 'Strong Rental Demand — Turnkey Investment';

function okJson(body: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function adaptResponse(directives: unknown[]): unknown {
  return {
    adapt_decision_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    session_id: SESSION_ID,
    archetype: 'yield_hunter',
    confidence: 0.85,
    similarity: 0.9,
    tier: 1,
    source: 'playbook',
    generated_at: '2026-08-18T00:00:00.000Z',
    directives,
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
  script.dataset.apiKey = 'test-follow1027-key';
  script.dataset.decisionUrl = 'https://decision.estalara.com/api';
  script.dataset.tenantId = 'follow1027-tenant-id';
  document.head.appendChild(script);
}

function insertListingDom(): HTMLElement {
  const listingEl = document.createElement('div');
  listingEl.setAttribute('data-estalara-listing', '');
  listingEl.setAttribute('data-estalara-listing-id', 'L-1027');
  document.body.appendChild(listingEl);

  const headlineEl = document.createElement('h2');
  headlineEl.setAttribute('data-estalara-slot', 'headline');
  headlineEl.textContent = ORIGINAL_HEADLINE;
  document.body.appendChild(headlineEl);
  return headlineEl;
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

/** Count `estalara:adapt:settled` dispatches for one init run. */
function listenForSettled(): { count: () => number; stop: () => void } {
  let n = 0;
  const handler = (): void => {
    n += 1;
  };
  document.addEventListener('estalara:adapt:settled', handler);
  return {
    count: () => n,
    stop: () => {
      document.removeEventListener('estalara:adapt:settled', handler);
    },
  };
}

function stubFetch(directives: unknown[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (
        typeof url === 'string' &&
        url.includes('/adapt') &&
        !url.includes('/adapt/description')
      ) {
        return Promise.resolve(okJson(adaptResponse(directives)));
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

describe('FOLLOW-1027 — the SDK tells the host cloak when it may reveal', () => {
  it('fires once the first decision cycle has settled, after the copy is on the page', async () => {
    const headlineEl = insertListingDom();
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    stubFetch([
      {
        type: 'text',
        slot: 'headline',
        value: ADAPTED_HEADLINE,
        archetype: 'yield_hunter',
        confidence: 0.85,
      },
    ]);

    const settled = listenForSettled();
    await _initForTest();
    await flush();

    expect(settled.count()).toBe(1);
    // Ordering is the whole point: revealing BEFORE the copy lands would show the buyer exactly
    // the original the cloak exists to hide.
    expect(headlineEl.textContent).toBe(ADAPTED_HEADLINE);
    settled.stop();
  });

  it('fires even when NOTHING was adapted — otherwise the page stays masked for no reason', async () => {
    const headlineEl = insertListingDom();
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    stubFetch([]); // a decision that changes nothing on this listing

    const settled = listenForSettled();
    await _initForTest();
    await flush();

    expect(settled.count()).toBe(1);
    expect(headlineEl.textContent).toBe(ORIGINAL_HEADLINE);
    settled.stop();
  });
});
