// @vitest-environment jsdom
/**
 * FOLLOW-1019 — opting out of personalization must return the listing to its original copy
 * WITHOUT a page reload.
 *
 * Found in the 2026-08-17 audit, driving the SDK as a buyer on localhost: complete the quiz,
 * watch the headline and description adapt, then un-check the §H.9 profiling toggle — and both
 * stayed adapted until a full reload. The `onChange` handler only stopped FUTURE directives,
 * and its comment claimed "the tenant-default DOM is already visible", which is false
 * mid-session: the ADAPTED DOM is what is visible. A visitor who has just declined profiling
 * keeps reading profiled copy, which is precisely what the opt-out exists to prevent.
 *
 * Rule Q: driven through the real `init()` body via `_initForTest()`, because the capture and
 * the revert both live inside `init()` — a test against a helper in isolation would pass while
 * the toggle stayed broken.
 *
 * @module packages/sdk/src/__tests__/follow-1019
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest } from '../index.js';

const SESSION_ID = 'f'.repeat(64);
const ORIGINAL_HEADLINE = 'Charming 4-Bedroom Colonial on Blackberry Lane';
const ORIGINAL_DESCRIPTION = 'A well-kept family home with a large garden and a two-car garage.';
const ADAPTED_HEADLINE = 'Strong Rental Demand — Turnkey Investment';
const ADAPTED_DESCRIPTION = 'Cash-flow focused write-up for an investor audience.';

interface StubDirective {
  type: 'text';
  slot: string;
  value: string;
  archetype: string;
  confidence: number;
}

function adaptResponse(directives: StubDirective[]): unknown {
  return {
    adapt_decision_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    session_id: SESSION_ID,
    archetype: 'yield_hunter',
    confidence: 0.85,
    similarity: 0.9,
    tier: 1,
    source: 'playbook',
    generated_at: '2026-08-17T00:00:00.000Z',
    directives,
    ttl_seconds: 300,
    variant: 'control',
  };
}

function okJson(body: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** Drain microtasks (MutationObserver callbacks, awaited fetches) then one macrotask. */
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
  script.dataset.apiKey = 'test-follow1019-key';
  script.dataset.decisionUrl = 'https://decision.estalara.com/api';
  script.dataset.tenantId = 'follow1019-tenant-id';
  document.head.appendChild(script);
}

function insertListingDom(): { headlineEl: HTMLElement; descriptionEl: HTMLElement } {
  const listingEl = document.createElement('div');
  listingEl.setAttribute('data-estalara-listing', '');
  listingEl.setAttribute('data-estalara-listing-id', 'L-1019');
  document.body.appendChild(listingEl);

  const headlineEl = document.createElement('h2');
  headlineEl.setAttribute('data-estalara-slot', 'headline');
  headlineEl.textContent = ORIGINAL_HEADLINE;
  document.body.appendChild(headlineEl);

  const descriptionEl = document.createElement('p');
  descriptionEl.setAttribute('data-estalara-slot', 'description');
  descriptionEl.textContent = ORIGINAL_DESCRIPTION;
  document.body.appendChild(descriptionEl);

  return { headlineEl, descriptionEl };
}

/** Flip the §H.9 opt-out toggle inside the SDK's open shadow root. */
function setPersonalization(enabled: boolean): void {
  const host = document.querySelector('[data-estalara-host]');
  const checkbox = host?.shadowRoot?.querySelector<HTMLInputElement>(
    '[data-estalara-toggle-checkbox]',
  );
  if (!checkbox) throw new Error('opt-out toggle not mounted — fixture is wrong, not the SDK');
  checkbox.checked = enabled;
  checkbox.dispatchEvent(new Event('change'));
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

/** jsdom has no IntersectionObserver; the SDK's listing-observer block is gated on it. */
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

beforeEach(() => {
  clearAll();
  vi.restoreAllMocks();
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (
        typeof url === 'string' &&
        url.includes('/adapt') &&
        !url.includes('/adapt/description')
      ) {
        return Promise.resolve(
          okJson(
            adaptResponse([
              {
                type: 'text',
                slot: 'headline',
                value: ADAPTED_HEADLINE,
                archetype: 'yield_hunter',
                confidence: 0.85,
              },
              {
                type: 'text',
                slot: 'description',
                value: ADAPTED_DESCRIPTION,
                archetype: 'yield_hunter',
                confidence: 0.85,
              },
            ]),
          ),
        );
      }
      return Promise.resolve(okJson({}));
    }),
  );
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

describe('FOLLOW-1019 — opting out reverts the adapted DOM in-session', () => {
  it('restores the original headline AND description without a reload', async () => {
    const { headlineEl, descriptionEl } = insertListingDom();
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    await _initForTest();
    await flush();

    // Precondition: the buyer IS being personalised. Without this the revert assertion below
    // would pass vacuously on a page that was never adapted.
    expect(headlineEl.textContent).toBe(ADAPTED_HEADLINE);
    expect(descriptionEl.textContent).toBe(ADAPTED_DESCRIPTION);

    setPersonalization(false);
    await flush();

    expect(headlineEl.textContent).toBe(ORIGINAL_HEADLINE);
    expect(descriptionEl.textContent).toBe(ORIGINAL_DESCRIPTION);
  });

  it('re-adapts when the visitor opts back in', async () => {
    const { headlineEl } = insertListingDom();
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    await _initForTest();
    await flush();
    expect(headlineEl.textContent).toBe(ADAPTED_HEADLINE);

    setPersonalization(false);
    await flush();
    expect(headlineEl.textContent).toBe(ORIGINAL_HEADLINE);

    setPersonalization(true);
    await flush();
    expect(headlineEl.textContent).toBe(ADAPTED_HEADLINE);
  });
});
