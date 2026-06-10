// @vitest-environment jsdom
/**
 * Tests for FOLLOW-099 behavioral observers:
 *   - setupPhotoDwellObserver  → photo.dwell
 *   - setupFeatureExpandedObserver → feature.expanded
 *   - setupMortgageCalcObserver → mortgage_calc.used
 *   - setupFilterAppliedObserver → filter.applied
 *
 * Also covers bot-detection gate (BOT_UA_RE) from config.ts.
 *
 * @module packages/sdk/src/__tests__/observer-behavioral
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupPhotoDwellObserver,
  setupFeatureExpandedObserver,
  setupMortgageCalcObserver,
  setupFilterAppliedObserver,
} from '../core/observer.js';
import { BOT_UA_RE } from '../core/config.js';
import type { CollectedEvent } from '../core/events.js';
import type { SdkConfig } from '../core/config.js';

const BASE_CONFIG: SdkConfig = {
  apiKey: 'pk_live_test',
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  tier: 'observer',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#6c5ce7',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function triggerInput(el: HTMLElement, value: string): void {
  (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function triggerChange(el: HTMLElement, value: string): void {
  (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ─── photo.dwell ──────────────────────────────────────────────────────────────

describe('setupPhotoDwellObserver — photo.dwell', () => {
  let cleanup: (() => void) | undefined;
  let emitted: CollectedEvent[];

  beforeEach(() => {
    emitted = [];
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup?.();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('emits photo.dwell after 2000ms of continuous visibility', () => {
    // jsdom IntersectionObserver is not real; we mock it to trigger immediately.
    const observedEls: Element[] = [];
    let ioCallback: ((entries: IntersectionObserverEntry[]) => void) | undefined;

    vi.stubGlobal(
      'IntersectionObserver',
      class MockIO {
        constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
          ioCallback = cb;
        }
        observe(el: Element) {
          observedEls.push(el);
        }
        disconnect() {
          observedEls.length = 0;
        }
      },
    );

    const container = document.createElement('div');
    container.setAttribute('data-estalara-slot', 'photos');
    const img = document.createElement('img');
    img.dataset.photoId = 'photo-abc';
    container.appendChild(img);
    document.body.appendChild(container);

    cleanup = setupPhotoDwellObserver(BASE_CONFIG, (e) => emitted.push(e));

    // Simulate intersection
    ioCallback!([
      {
        target: img,
        isIntersecting: true,
        intersectionRatio: 0.8,
      } as unknown as IntersectionObserverEntry,
    ]);

    // Before threshold — no event yet
    vi.advanceTimersByTime(1999);
    expect(emitted.filter((e) => e.type === 'photo.dwell')).toHaveLength(0);

    // At threshold — event fires
    vi.advanceTimersByTime(1);
    const dwellEvents = emitted.filter((e) => e.type === 'photo.dwell');
    expect(dwellEvents).toHaveLength(1);
    expect(dwellEvents[0]?.payload).toMatchObject({
      photo_id: 'photo-abc',
      dwell_ms: 2000,
    });

    vi.unstubAllGlobals();
  });

  it('cancels the dwell timer when the element leaves the viewport before threshold', () => {
    let ioCallback: ((entries: IntersectionObserverEntry[]) => void) | undefined;

    vi.stubGlobal(
      'IntersectionObserver',
      class MockIO {
        constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
          ioCallback = cb;
        }
        observe(_el: Element) {
          /* no-op mock */
        }
        disconnect() {
          /* no-op mock */
        }
      },
    );

    const img = document.createElement('img');
    img.dataset.photoId = 'photo-xyz';
    document.body.appendChild(img);

    cleanup = setupPhotoDwellObserver(BASE_CONFIG, (e) => emitted.push(e));

    // Enter viewport
    ioCallback!([{ target: img, isIntersecting: true } as unknown as IntersectionObserverEntry]);

    // Advance halfway
    vi.advanceTimersByTime(1000);

    // Leave viewport
    ioCallback!([{ target: img, isIntersecting: false } as unknown as IntersectionObserverEntry]);

    // Advance past threshold — no event because timer was cancelled
    vi.advanceTimersByTime(2000);
    expect(emitted.filter((e) => e.type === 'photo.dwell')).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it('emitted event has a positive timestamp', () => {
    let ioCallback: ((entries: IntersectionObserverEntry[]) => void) | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class MockIO {
        constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
          ioCallback = cb;
        }
        observe(_el: Element) {
          /* no-op mock */
        }
        disconnect() {
          /* no-op mock */
        }
      },
    );

    const img = document.createElement('img');
    img.dataset.photoId = 'ts-photo';
    document.body.appendChild(img);

    const before = Date.now();
    cleanup = setupPhotoDwellObserver(BASE_CONFIG, (e) => emitted.push(e));
    ioCallback!([{ target: img, isIntersecting: true } as unknown as IntersectionObserverEntry]);
    vi.advanceTimersByTime(2000);

    const evt = emitted.find((e) => e.type === 'photo.dwell');
    expect(evt?.ts).toBeGreaterThanOrEqual(before);

    vi.unstubAllGlobals();
  });
});

// ─── feature.expanded ────────────────────────────────────────────────────────

describe('setupFeatureExpandedObserver — feature.expanded', () => {
  let cleanup: (() => void) | undefined;
  let emitted: CollectedEvent[];

  beforeEach(() => {
    emitted = [];
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup?.();
    document.body.innerHTML = '';
  });

  it('emits feature.expanded on click of [data-feature] element', () => {
    const el = document.createElement('div');
    el.setAttribute('data-feature', 'energy_certificate');
    el.textContent = 'B';
    document.body.appendChild(el);

    cleanup = setupFeatureExpandedObserver(BASE_CONFIG, (e) => emitted.push(e));
    click(el);

    const events = emitted.filter((e) => e.type === 'feature.expanded');
    expect(events).toHaveLength(1);
  });

  it('payload has feature = data-feature attribute value', () => {
    const el = document.createElement('button');
    el.setAttribute('data-feature', 'pool');
    el.textContent = 'Pool included';
    document.body.appendChild(el);

    cleanup = setupFeatureExpandedObserver(BASE_CONFIG, (e) => emitted.push(e));
    click(el);

    const evt = emitted.find((e) => e.type === 'feature.expanded');
    expect(evt?.payload.feature).toBe('pool');
  });

  it('payload includes label trimmed from textContent', () => {
    const el = document.createElement('div');
    el.setAttribute('data-feature', 'garage');
    el.textContent = '  Double garage  ';
    document.body.appendChild(el);

    cleanup = setupFeatureExpandedObserver(BASE_CONFIG, (e) => emitted.push(e));
    click(el);

    const evt = emitted.find((e) => e.type === 'feature.expanded');
    expect(evt?.payload.label).toBe('Double garage');
  });

  it('does not emit when clicked element has no data-feature ancestor', () => {
    const el = document.createElement('button');
    el.textContent = 'No feature';
    document.body.appendChild(el);

    cleanup = setupFeatureExpandedObserver(BASE_CONFIG, (e) => emitted.push(e));
    click(el);

    expect(emitted.filter((e) => e.type === 'feature.expanded')).toHaveLength(0);
  });

  it('emits when clicking a child of [data-feature] element', () => {
    const parent = document.createElement('div');
    parent.setAttribute('data-feature', 'terrace');
    const child = document.createElement('span');
    child.textContent = 'Terrace';
    parent.appendChild(child);
    document.body.appendChild(parent);

    cleanup = setupFeatureExpandedObserver(BASE_CONFIG, (e) => emitted.push(e));
    click(child);

    const events = emitted.filter((e) => e.type === 'feature.expanded');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.feature).toBe('terrace');
  });

  it('cleanup removes the click listener', () => {
    const el = document.createElement('div');
    el.setAttribute('data-feature', 'lift');
    document.body.appendChild(el);

    const cleanupFn = setupFeatureExpandedObserver(BASE_CONFIG, (e) => emitted.push(e));
    cleanupFn();
    click(el);

    expect(emitted.filter((e) => e.type === 'feature.expanded')).toHaveLength(0);
  });

  it('has a positive timestamp on emitted event', () => {
    const el = document.createElement('div');
    el.setAttribute('data-feature', 'garden');
    document.body.appendChild(el);

    const before = Date.now();
    cleanup = setupFeatureExpandedObserver(BASE_CONFIG, (e) => emitted.push(e));
    click(el);

    const evt = emitted.find((e) => e.type === 'feature.expanded');
    expect(evt?.ts).toBeGreaterThanOrEqual(before);
  });
});

// ─── mortgage_calc.used ──────────────────────────────────────────────────────

describe('setupMortgageCalcObserver — mortgage_calc.used', () => {
  let cleanup: (() => void) | undefined;
  let emitted: CollectedEvent[];

  beforeEach(() => {
    emitted = [];
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup?.();
    document.body.innerHTML = '';
  });

  function makeCalcContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.setAttribute('data-estalara-slot', 'mortgage');
    document.body.appendChild(container);
    return container;
  }

  it('emits mortgage_calc.used on input inside [data-estalara-slot="mortgage"]', () => {
    const container = makeCalcContainer();
    const input = document.createElement('input');
    input.name = 'down_payment';
    container.appendChild(input);

    cleanup = setupMortgageCalcObserver(BASE_CONFIG, (e) => emitted.push(e));
    triggerInput(input, '20');

    expect(emitted.filter((e) => e.type === 'mortgage_calc.used')).toHaveLength(1);
  });

  it('payload has down_payment_pct for down_payment input', () => {
    const container = makeCalcContainer();
    const input = document.createElement('input');
    input.name = 'down_payment';
    container.appendChild(input);

    cleanup = setupMortgageCalcObserver(BASE_CONFIG, (e) => emitted.push(e));
    triggerInput(input, '20');

    const evt = emitted.find((e) => e.type === 'mortgage_calc.used');
    expect(evt?.payload).toMatchObject({ down_payment_pct: 20 });
  });

  it('payload has term_years for term input', () => {
    const container = makeCalcContainer();
    const input = document.createElement('input');
    input.name = 'term_years';
    container.appendChild(input);

    cleanup = setupMortgageCalcObserver(BASE_CONFIG, (e) => emitted.push(e));
    triggerInput(input, '25');

    const evt = emitted.find((e) => e.type === 'mortgage_calc.used');
    expect(evt?.payload).toMatchObject({ term_years: 25 });
  });

  it('payload has interest_rate_pct for interest_rate input', () => {
    const container = makeCalcContainer();
    const input = document.createElement('input');
    input.name = 'interest_rate';
    container.appendChild(input);

    cleanup = setupMortgageCalcObserver(BASE_CONFIG, (e) => emitted.push(e));
    triggerInput(input, '3.5');

    const evt = emitted.find((e) => e.type === 'mortgage_calc.used');
    expect(evt?.payload).toMatchObject({ interest_rate_pct: 3.5 });
  });

  it('emits with empty payload for unknown input type (interaction signal)', () => {
    const container = makeCalcContainer();
    const btn = document.createElement('button');
    btn.textContent = 'Calculate';
    container.appendChild(btn);

    cleanup = setupMortgageCalcObserver(BASE_CONFIG, (e) => emitted.push(e));
    click(btn);

    expect(emitted.filter((e) => e.type === 'mortgage_calc.used')).toHaveLength(1);
  });

  it('does NOT emit for interactions outside the mortgage slot', () => {
    const input = document.createElement('input');
    input.name = 'down_payment';
    document.body.appendChild(input);

    cleanup = setupMortgageCalcObserver(BASE_CONFIG, (e) => emitted.push(e));
    triggerInput(input, '20');

    expect(emitted.filter((e) => e.type === 'mortgage_calc.used')).toHaveLength(0);
  });

  it('cleanup removes input and click listeners', () => {
    const container = makeCalcContainer();
    const input = document.createElement('input');
    input.name = 'loan_amount';
    container.appendChild(input);

    const cleanupFn = setupMortgageCalcObserver(BASE_CONFIG, (e) => emitted.push(e));
    cleanupFn();
    triggerInput(input, '200000');

    expect(emitted.filter((e) => e.type === 'mortgage_calc.used')).toHaveLength(0);
  });
});

// ─── filter.applied ──────────────────────────────────────────────────────────

describe('setupFilterAppliedObserver — filter.applied', () => {
  let cleanup: (() => void) | undefined;
  let emitted: CollectedEvent[];

  beforeEach(() => {
    emitted = [];
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup?.();
    document.body.innerHTML = '';
  });

  function makeFilterContainer(slot = 'search-filters'): HTMLDivElement {
    const container = document.createElement('div');
    container.setAttribute('data-estalara-slot', slot);
    document.body.appendChild(container);
    return container;
  }

  it('emits filter.applied on change of a select inside [data-estalara-slot="search-filters"]', () => {
    const container = makeFilterContainer();
    const select = document.createElement('select');
    select.name = 'bedrooms';
    // jsdom requires an <option> with matching value for select.value to be settable
    const opt = document.createElement('option');
    opt.value = '3';
    select.appendChild(opt);
    container.appendChild(select);

    cleanup = setupFilterAppliedObserver(BASE_CONFIG, (e) => emitted.push(e));
    triggerChange(select, '3');

    const events = emitted.filter((e) => e.type === 'filter.applied');
    expect(events).toHaveLength(1);
  });

  it('payload has facet and value fields', () => {
    const container = makeFilterContainer();
    // Use an input element — select requires a matching <option> for .value assignment in jsdom
    const input = document.createElement('input');
    input.name = 'bedrooms';
    container.appendChild(input);

    cleanup = setupFilterAppliedObserver(BASE_CONFIG, (e) => emitted.push(e));
    triggerChange(input, '2');

    const evt = emitted.find((e) => e.type === 'filter.applied');
    expect(evt?.payload).toMatchObject({ facet: 'bedrooms', value: '2' });
  });

  it('resolves price field name to price_range facet', () => {
    const container = makeFilterContainer();
    const input = document.createElement('input');
    input.name = 'max_price';
    container.appendChild(input);

    cleanup = setupFilterAppliedObserver(BASE_CONFIG, (e) => emitted.push(e));
    triggerChange(input, '500000');

    const evt = emitted.find((e) => e.type === 'filter.applied');
    expect(evt?.payload.facet).toBe('price_range');
    expect(evt?.payload.value).toBe('500000');
  });

  it('resolves bathroom field name to bathrooms facet', () => {
    const container = makeFilterContainer();
    const input = document.createElement('input');
    input.name = 'bathrooms';
    container.appendChild(input);

    cleanup = setupFilterAppliedObserver(BASE_CONFIG, (e) => emitted.push(e));
    triggerChange(input, '2');

    const evt = emitted.find((e) => e.type === 'filter.applied');
    expect(evt?.payload.facet).toBe('bathrooms');
  });

  it('also works with [data-estalara-slot="filters"] slot name', () => {
    const container = makeFilterContainer('filters');
    const select = document.createElement('select');
    select.name = 'location';
    container.appendChild(select);

    cleanup = setupFilterAppliedObserver(BASE_CONFIG, (e) => emitted.push(e));
    triggerChange(select, 'Barcelona');

    const events = emitted.filter((e) => e.type === 'filter.applied');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.facet).toBe('location');
  });

  it('does NOT emit for unrecognised field names', () => {
    const container = makeFilterContainer();
    const input = document.createElement('input');
    input.name = 'unknown_field_xyz';
    container.appendChild(input);

    cleanup = setupFilterAppliedObserver(BASE_CONFIG, (e) => emitted.push(e));
    triggerChange(input, 'something');

    expect(emitted.filter((e) => e.type === 'filter.applied')).toHaveLength(0);
  });

  it('does NOT emit for changes outside filter slot', () => {
    const select = document.createElement('select');
    select.name = 'bedrooms';
    document.body.appendChild(select);

    cleanup = setupFilterAppliedObserver(BASE_CONFIG, (e) => emitted.push(e));
    triggerChange(select, '3');

    expect(emitted.filter((e) => e.type === 'filter.applied')).toHaveLength(0);
  });

  it('emits one event per recognisable non-empty field on form submit', () => {
    const container = makeFilterContainer();
    const form = document.createElement('form');

    const bedroomInput = document.createElement('input');
    bedroomInput.name = 'bedrooms';
    bedroomInput.value = '3';
    form.appendChild(bedroomInput);

    const priceInput = document.createElement('input');
    priceInput.name = 'price_range';
    priceInput.value = '200000';
    form.appendChild(priceInput);

    // Unknown field — should be ignored
    const unknownInput = document.createElement('input');
    unknownInput.name = 'unknown_xyz';
    unknownInput.value = 'test';
    form.appendChild(unknownInput);

    container.appendChild(form);

    cleanup = setupFilterAppliedObserver(BASE_CONFIG, (e) => emitted.push(e));
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    const filterEvents = emitted.filter((e) => e.type === 'filter.applied');
    expect(filterEvents).toHaveLength(2);
    expect(filterEvents.map((e) => e.payload.facet)).toContain('bedrooms');
    expect(filterEvents.map((e) => e.payload.facet)).toContain('price_range');
  });

  it('cleanup removes change and submit listeners', () => {
    const container = makeFilterContainer();
    const input = document.createElement('input');
    input.name = 'bedrooms';
    container.appendChild(input);

    const cleanupFn = setupFilterAppliedObserver(BASE_CONFIG, (e) => emitted.push(e));
    cleanupFn();
    triggerChange(input, '2');

    expect(emitted.filter((e) => e.type === 'filter.applied')).toHaveLength(0);
  });
});

// ─── BOT_UA_RE bot detection ──────────────────────────────────────────────────

describe('BOT_UA_RE — bot user-agent detection', () => {
  const BOT_UAS = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
    'DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
    'Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)',
  ];

  it.each(BOT_UAS)('matches bot UA: %s', (ua) => {
    expect(BOT_UA_RE.test(ua)).toBe(true);
  });

  it('is case-insensitive (lowercase)', () => {
    expect(BOT_UA_RE.test('googlebot/2.1')).toBe(true);
    expect(BOT_UA_RE.test('ahrefsbot/7.0')).toBe(true);
    expect(BOT_UA_RE.test('semrushbot/7')).toBe(true);
    expect(BOT_UA_RE.test('mj12bot')).toBe(true);
  });

  it('does NOT match real browser user agents', () => {
    const REAL_UAS = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Firefox/121.0',
    ];
    for (const ua of REAL_UAS) {
      expect(BOT_UA_RE.test(ua)).toBe(false);
    }
  });

  it('does NOT match an empty user-agent string', () => {
    expect(BOT_UA_RE.test('')).toBe(false);
  });
});
