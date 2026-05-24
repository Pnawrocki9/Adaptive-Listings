// @vitest-environment jsdom
/**
 * Tests for the inquiry.started observer in setupObservers().
 *
 * Covers:
 *   - Emits inquiry.started on click of the inquiry-submit selector
 *   - Payload shape: { form_variant: 'contact_v2' }
 *   - Consent gate: no emission when consentState is 'opted_out'
 *
 * @module packages/sdk/src/__tests__/observer-inquiry
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupObservers } from '../core/observer.js';
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

const INQUIRY_SUBMIT_SELECTOR = "[data-estalara-slot='inquiry-submit']";

function createInquiryButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.setAttribute('data-estalara-slot', 'inquiry-submit');
  document.body.appendChild(btn);
  return btn;
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('setupObservers — inquiry.started', () => {
  let cleanup: (() => void) | undefined;
  let emitted: CollectedEvent[];

  beforeEach(() => {
    emitted = [];
    document.body.innerHTML = '';
  });

  afterEach(() => {
    if (cleanup) cleanup();
    document.body.innerHTML = '';
  });

  it('emits inquiry.started when the inquiry-submit selector is clicked', () => {
    const btn = createInquiryButton();
    cleanup = setupObservers(BASE_CONFIG, (evt) => emitted.push(evt), {
      inquirySubmitSelector: INQUIRY_SUBMIT_SELECTOR,
    });

    click(btn);

    const inquiryEvents = emitted.filter((e) => e.type === 'inquiry.started');
    expect(inquiryEvents).toHaveLength(1);
  });

  it('payload has form_variant = contact_v2', () => {
    const btn = createInquiryButton();
    cleanup = setupObservers(BASE_CONFIG, (evt) => emitted.push(evt), {
      inquirySubmitSelector: INQUIRY_SUBMIT_SELECTOR,
    });

    click(btn);

    const evt = emitted.find((e) => e.type === 'inquiry.started');
    expect(evt).toBeDefined();
    expect(evt?.payload).toEqual({ form_variant: 'contact_v2' });
  });

  it('does NOT emit inquiry.started when consentState is opted_out', () => {
    const btn = createInquiryButton();
    const optedOutConfig: SdkConfig = { ...BASE_CONFIG, consentState: 'opted_out' };
    cleanup = setupObservers(optedOutConfig, (evt) => emitted.push(evt), {
      inquirySubmitSelector: INQUIRY_SUBMIT_SELECTOR,
    });

    click(btn);

    const inquiryEvents = emitted.filter((e) => e.type === 'inquiry.started');
    expect(inquiryEvents).toHaveLength(0);
  });

  it('does NOT emit inquiry.started when no inquirySubmitSelector is provided', () => {
    const btn = createInquiryButton();
    cleanup = setupObservers(BASE_CONFIG, (evt) => emitted.push(evt), {});

    click(btn);

    const inquiryEvents = emitted.filter((e) => e.type === 'inquiry.started');
    expect(inquiryEvents).toHaveLength(0);
  });

  it('emits with a positive timestamp', () => {
    const before = Date.now();
    const btn = createInquiryButton();
    cleanup = setupObservers(BASE_CONFIG, (evt) => emitted.push(evt), {
      inquirySubmitSelector: INQUIRY_SUBMIT_SELECTOR,
    });

    click(btn);

    const evt = emitted.find((e) => e.type === 'inquiry.started');
    expect(evt?.ts).toBeGreaterThanOrEqual(before);
  });

  it('does not emit inquiry.started for clicks elsewhere on the page', () => {
    const btn = createInquiryButton();
    const other = document.createElement('button');
    document.body.appendChild(other);

    cleanup = setupObservers(BASE_CONFIG, (evt) => emitted.push(evt), {
      inquirySubmitSelector: INQUIRY_SUBMIT_SELECTOR,
    });

    click(other);
    void btn; // btn present but not clicked

    const inquiryEvents = emitted.filter((e) => e.type === 'inquiry.started');
    expect(inquiryEvents).toHaveLength(0);
  });
});

// ─── Spy-free mock to confirm no side effects on cleanup ──────────────────────

describe('setupObservers — cleanup removes inquiry listener', () => {
  it('no inquiry.started events after cleanup is called', () => {
    const emitted: CollectedEvent[] = [];
    document.body.innerHTML = '';
    const btn = document.createElement('button');
    btn.setAttribute('data-estalara-slot', 'inquiry-submit');
    document.body.appendChild(btn);

    const cleanupFn = setupObservers(BASE_CONFIG, (evt) => emitted.push(evt), {
      inquirySubmitSelector: INQUIRY_SUBMIT_SELECTOR,
    });

    cleanupFn();

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const inquiryEvents = emitted.filter((e) => e.type === 'inquiry.started');
    expect(inquiryEvents).toHaveLength(0);

    document.body.innerHTML = '';
  });
});

// Additional mock for getAuthClaims to satisfy vitest module setup
vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
}));
