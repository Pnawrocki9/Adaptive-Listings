/**
 * FOLLOW-1446 (FOLLOW-1316 signed review P-4, ESC-092 B-d), through the REAL `init()`
 * (`_initForTest`, Rule Q):
 *
 * 1. Withdrawal and the §H.9 opt-out put EVERY adapted directive back to the seller's original:
 *    `cta` and `feature` text, classes and card order, not only the headline and description.
 * 2. Another tab's withdrawal stops this tab (a `storage` event), and restores its DOM.
 * 3. The way back from `denied`: a persistent "turn on" chip, only under a stored denial, that
 *    shows the first-visit banner again and sends nothing before a new grant; after the grant the
 *    SDK adapts again. The host event `estalara:consent:reopen` takes the same path.
 *
 * Every request is captured at `fetch` and `sendBeacon`, so "nothing was sent" is asserted on the
 * wire.
 *
 * @module packages/sdk/src/__tests__/follow-1446.test
 */

// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_QUIZ_DEFINITION_V2 } from '@estalara/shared';

import { _initForTest } from '../index.js';
import { eraseCrossSessionId } from '../core/xid.js';

const SESSION_ID = 'c'.repeat(64);
const API_KEY = 'test-follow1446-api-key';
const DECISION_API_URL = 'https://api.example.com/api';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const CONSENT_KEY = 'estalara_consent';
const TEXT_VERSION_KEY = 'estalara_consent_text_version';
const SERVED_TEXT_VERSION = (
  JSON.parse(
    readFileSync(
      join(__dirname, '../../../../apps/control-plane/public/consent-text.json'),
      'utf8',
    ),
  ) as { text_version: string }
).text_version;

const LOCALE_TEXT = {
  text: 'We personalize.',
  disclosure13_1: 'one',
  disclosure13_2: 'two',
  disclosurePlatform: 'three',
  learnMore: 'more',
  accept: 'Accept',
  decline: 'Decline',
};

const SELLER = {
  headline: 'Seller headline',
  cta: 'Contact the agent',
  feature: 'Two bathrooms',
  badgeClass: 'badge seller-badge',
  order: ['L-1', 'L-2', 'L-3'],
};

const ADAPTED_DIRECTIVES = [
  {
    type: 'text',
    slot: 'headline',
    value: 'Adapted headline',
    archetype: 'yield_hunter',
    confidence: 0.85,
  },
  {
    type: 'text',
    slot: 'cta',
    value: 'See the rental yield',
    archetype: 'yield_hunter',
    confidence: 0.85,
  },
  {
    type: 'text',
    slot: 'feature',
    value: 'Rented until 2028',
    archetype: 'yield_hunter',
    confidence: 0.85,
  },
  {
    type: 'class',
    selector: '[data-estalara-badge]',
    add: ['investor-badge'],
    remove: ['seller-badge'],
    archetype: 'yield_hunter',
    confidence: 0.85,
  },
  {
    type: 'reorder',
    container_selector: '[data-estalara-grid]',
    item_selector: '[data-estalara-card]',
    score_function: 'archetype_affinity',
    scores: [
      { listing_id: 'L-1', score: 0.1 },
      { listing_id: 'L-2', score: 0.5 },
      { listing_id: 'L-3', score: 0.9 },
    ],
    archetype: 'yield_hunter',
    confidence: 0.85,
  },
];

const ADAPT_RESPONSE = {
  adapt_decision_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  session_id: SESSION_ID,
  archetype: 'yield_hunter',
  confidence: 0.85,
  similarity: 0.9,
  source: 'playbook',
  generated_at: '2026-11-06T00:00:00.000Z',
  directives: ADAPTED_DIRECTIVES,
  variant: 'control',
};

interface Capture {
  url: string;
  body: string;
}

/** The SDK's whole outbound surface: every `fetch` and `sendBeacon`. */
let wire: Capture[] = [];

function stubWire(language: 'en' | 'pl' | 'es' = 'en'): void {
  const ok = (body: unknown, status = 200): Promise<unknown> =>
    Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      wire.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
      if (url.includes('consent-text.json')) {
        return ok({
          schema_version: 1,
          text_version: SERVED_TEXT_VERSION,
          locales: { en: LOCALE_TEXT, pl: LOCALE_TEXT, es: LOCALE_TEXT },
        });
      }
      if (url.includes('/quiz/public-config')) {
        return ok({
          quiz_enabled: false,
          language,
          accent_color: '#6c5ce7',
          data_source: 'db',
          quiz_definition: DEFAULT_QUIZ_DEFINITION_V2,
          definition_hash: 'f'.repeat(64),
          definition_version: null,
          // The withdrawal control is offered with the flag on (FOLLOW-1316 R24).
          buyer_profile_enabled: true,
        });
      }
      if (url.includes('/intent/config')) return ok(null);
      if (url.includes('/adapt/description')) return ok({}, 404);
      if (url.includes('/adapt')) return ok(ADAPT_RESPONSE);
      return ok({});
    }),
  );
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: vi.fn((url: string, data?: BodyInit) => {
      wire.push({ url, body: typeof data === 'string' ? data : '' });
      return true;
    }),
  });
}

/** The seller's page: a listing with headline, cta, feature, a badge, and a grid of three cards. */
function insertListing(): void {
  const listing = document.createElement('div');
  listing.setAttribute('data-estalara-listing-id', 'L-1');
  listing.setAttribute('data-estalara-listing', '');
  for (const slot of ['headline', 'cta', 'feature'] as const) {
    const el = document.createElement('span');
    el.setAttribute('data-estalara-slot', slot);
    el.textContent = SELLER[slot];
    listing.appendChild(el);
  }
  const badge = document.createElement('span');
  badge.setAttribute('data-estalara-badge', '');
  badge.className = SELLER.badgeClass;
  listing.appendChild(badge);
  const grid = document.createElement('div');
  grid.setAttribute('data-estalara-grid', '');
  for (const id of SELLER.order) {
    const card = document.createElement('div');
    card.setAttribute('data-estalara-card', '');
    card.setAttribute('data-estalara-listing-id', id);
    grid.appendChild(card);
  }
  listing.appendChild(grid);
  document.body.appendChild(listing);
}

const slotText = (slot: string): string | null | undefined =>
  document.querySelector(`[data-estalara-slot="${slot}"]`)?.textContent;
const badgeClass = (): string | undefined =>
  document.querySelector<HTMLElement>('[data-estalara-badge]')?.className;
const cardOrder = (): (string | null)[] =>
  [...document.querySelectorAll('[data-estalara-card]')].map((c) =>
    c.getAttribute('data-estalara-listing-id'),
  );

function expectSellerDom(): void {
  expect(slotText('headline')).toBe(SELLER.headline);
  expect(slotText('cta')).toBe(SELLER.cta);
  expect(slotText('feature')).toBe(SELLER.feature);
  expect(badgeClass()).toBe(SELLER.badgeClass);
  expect(cardOrder()).toEqual(SELLER.order);
}

function expectAdaptedDom(): void {
  expect(slotText('headline')).toBe('Adapted headline');
  expect(slotText('cta')).toBe('See the rental yield');
  expect(slotText('feature')).toBe('Rented until 2028');
  expect(badgeClass()).toBe('badge investor-badge');
  expect(cardOrder()).toEqual(['L-3', 'L-2', 'L-1']);
}

function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
}

function seedGranted(): void {
  localStorage.setItem(CONSENT_KEY, 'granted');
  localStorage.setItem(TEXT_VERSION_KEY, SERVED_TEXT_VERSION);
}

function insertScript(): void {
  const script = document.createElement('script');
  script.dataset.apiKey = API_KEY;
  script.dataset.decisionUrl = DECISION_API_URL;
  script.dataset.tenantId = TENANT_ID;
  document.head.appendChild(script);
}

function query(selector: string): HTMLElement | null {
  for (const host of document.querySelectorAll('[data-estalara-host]')) {
    const el = host.shadowRoot?.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

const chip = (): HTMLElement | null => query('[data-estalara-reopen]');
const adaptCalls = (): Capture[] => wire.filter((c) => /\/adapt(\?|$)/.test(c.url));

async function bootSdk(language?: 'en' | 'pl' | 'es'): Promise<void> {
  seedSession();
  insertScript();
  stubWire(language);
  await _initForTest();
}

/** Another tab's withdrawal: storage changes, and this window gets a `storage` event. */
function otherTabWithdraws(): void {
  localStorage.setItem(CONSENT_KEY, 'denied');
  window.dispatchEvent(new StorageEvent('storage', { key: CONSENT_KEY, newValue: 'denied' }));
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

function newPage(): void {
  const w = window as Window & { __estalaraTeardown?: () => void };
  w.__estalaraTeardown?.();
  delete w.__estalaraTeardown;
  document
    .querySelectorAll('script[data-api-key], [data-estalara-host], [data-estalara-listing]')
    .forEach((el) => {
      el.remove();
    });
  wire = [];
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  eraseCrossSessionId();
  wire = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  newPage();
  sessionStorage.clear();
  localStorage.clear();
  eraseCrossSessionId();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FOLLOW-1446 every adapted directive goes back to the seller', () => {
  it('withdrawal restores cta and feature text, the class and the card order', async () => {
    seedGranted();
    insertListing();
    await bootSdk();
    await vi.waitFor(expectAdaptedDom);

    query('[data-estalara-withdraw]')?.click();
    expect(localStorage.getItem(CONSENT_KEY)).toBe('denied');
    expectSellerDom();
  });

  it('the §H.9 opt-out restores them too, and opting back in adapts again', async () => {
    seedGranted();
    insertListing();
    await bootSdk();
    await vi.waitFor(expectAdaptedDom);

    const checkbox = query('[data-estalara-toggle-checkbox]') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expectSellerDom();
    // Nothing repairs the adapted state once restored: the observers are gone.
    await new Promise((r) => setTimeout(r, 20));
    expectSellerDom();

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await vi.waitFor(expectAdaptedDom);
  });

  it('a slot the seller re-rendered after our write keeps the seller text', async () => {
    seedGranted();
    insertListing();
    await bootSdk();
    await vi.waitFor(expectAdaptedDom);
    const cta = document.querySelector<HTMLElement>('[data-estalara-slot="cta"]');
    if (!cta) throw new Error('cta slot missing');
    // Framework re-render with the next listing's copy: no longer ours to undo.
    cta.textContent = 'Book a viewing';

    const checkbox = query('[data-estalara-toggle-checkbox]') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(cta.textContent).toBe('Book a viewing');
    expect(slotText('feature')).toBe(SELLER.feature);
  });
});

describe('FOLLOW-1446 another tab withdraws', () => {
  it('this tab restores its DOM, removes its UI and sends nothing more', async () => {
    seedGranted();
    insertListing();
    await bootSdk();
    await vi.waitFor(expectAdaptedDom);
    wire = [];

    otherTabWithdraws();
    expectSellerDom();
    expect(query('[data-estalara-profiling-toggle]')).toBeNull();
    expect(sessionStorage.getItem(`estalara_intent_${SESSION_ID}`)).toBeNull();

    // A buyer action after the stop reaches no endpoint.
    window.dispatchEvent(new Event('beforeunload'));
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 20));
    expect(wire).toEqual([]);
  });

  it('a storage event that leaves consent granted changes nothing', async () => {
    seedGranted();
    insertListing();
    await bootSdk();
    await vi.waitFor(expectAdaptedDom);

    localStorage.setItem('some_host_key', '1');
    window.dispatchEvent(new StorageEvent('storage', { key: 'some_host_key' }));
    expectAdaptedDom();
    expect(query('[data-estalara-profiling-toggle]')).not.toBeNull();
  });
});

describe('FOLLOW-1446 the way back from denied (ESC-092 B-d)', () => {
  it.each([
    ['en', 'Turn on personalization'],
    ['pl', 'Włącz personalizację'],
    ['es', 'Activar la personalización'],
  ] as const)(
    'stored denied: a %s chip, a real button, and nothing on the wire',
    async (language, label) => {
      localStorage.setItem(CONSENT_KEY, 'denied');
      seedSession();
      insertScript();
      const script = document.querySelector<HTMLScriptElement>('script[data-api-key]');
      if (script) script.dataset.language = language;
      stubWire();
      await _initForTest();

      const button = chip();
      expect(button?.tagName).toBe('BUTTON');
      expect(button?.textContent).toBe(label);
      expect((button as HTMLButtonElement | null)?.disabled).toBe(false);
      expect(button?.tabIndex).toBe(0);
      // No profile read, no config, no adapt, no event before a new grant.
      expect(wire).toEqual([]);
      // Not a dialog, not the banner: the page stays usable.
      expect(query('[data-estalara-consent="accept"]')).toBeNull();
    },
  );

  it('granted and pending pages show no chip', async () => {
    seedGranted();
    await bootSdk();
    expect(chip()).toBeNull();

    newPage();
    localStorage.clear();
    seedSession();
    insertScript();
    stubWire();
    const init = _initForTest();
    await vi.waitFor(() => {
      expect(query('[data-estalara-consent="accept"]')).not.toBeNull();
    });
    expect(chip()).toBeNull();
    query('[data-estalara-consent="accept"]')?.click();
    await init;
  });

  it('a click shows the first-visit banner; only the consent text is fetched before a grant', async () => {
    localStorage.setItem(CONSENT_KEY, 'denied');
    insertListing();
    await bootSdk();
    chip()?.click();

    await vi.waitFor(() => {
      expect(query('[data-estalara-consent="accept"]')).not.toBeNull();
    });
    expect(chip()).toBeNull();
    expect(localStorage.getItem(CONSENT_KEY)).toBeNull();
    expect(wire.map((c) => c.url)).toEqual([expect.stringContaining('consent-text.json')]);
    expectSellerDom();
  });

  it('after a new grant, adaptation resumes', async () => {
    localStorage.setItem(CONSENT_KEY, 'denied');
    insertListing();
    await bootSdk();
    chip()?.click();
    await vi.waitFor(() => {
      expect(query('[data-estalara-consent="accept"]')).not.toBeNull();
    });

    query('[data-estalara-consent="accept"]')?.click();
    expect(localStorage.getItem(CONSENT_KEY)).toBe('granted');
    await vi.waitFor(() => {
      expect(adaptCalls().length).toBeGreaterThan(0);
    });
    await vi.waitFor(expectAdaptedDom);
    expect(query('[data-estalara-profiling-toggle]')).not.toBeNull();
  });

  it('declining again leaves a chip, and the stored state is denied', async () => {
    localStorage.setItem(CONSENT_KEY, 'denied');
    await bootSdk();
    chip()?.click();
    await vi.waitFor(() => {
      expect(query('[data-estalara-consent="decline"]')).not.toBeNull();
    });
    query('[data-estalara-consent="decline"]')?.click();
    await vi.waitFor(() => {
      expect(chip()).not.toBeNull();
    });
    expect(localStorage.getItem(CONSENT_KEY)).toBe('denied');
    expect(adaptCalls()).toEqual([]);
  });

  it('the host event estalara:consent:reopen takes the same path', async () => {
    localStorage.setItem(CONSENT_KEY, 'denied');
    await bootSdk();
    document.dispatchEvent(new Event('estalara:consent:reopen'));
    await vi.waitFor(() => {
      expect(query('[data-estalara-consent="accept"]')).not.toBeNull();
    });
    expect(chip()).toBeNull();
    // A second event after the click path ran starts nothing twice.
    document.dispatchEvent(new Event('estalara:consent:reopen'));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelectorAll('[data-estalara-host]')).toHaveLength(1);
  });

  it('the host event on a granted page does nothing', async () => {
    seedGranted();
    await bootSdk();
    wire = [];
    document.dispatchEvent(new Event('estalara:consent:reopen'));
    await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem(CONSENT_KEY)).toBe('granted');
    expect(query('[data-estalara-consent="accept"]')).toBeNull();
    expect(wire).toEqual([]);
  });
});
