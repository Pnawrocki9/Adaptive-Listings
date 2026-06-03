// @vitest-environment jsdom
/**
 * Unit tests for long-form description adaptation (FOLLOW-159).
 *
 * Covers:
 *   1. ai_cached source → applies + preserves paragraph structure (multiple <p>s)
 *   2. source: original → leaves DOM untouched
 *   3. source: template_fallback → leaves DOM untouched
 *   4. null description → leaves DOM untouched
 *   5. MutationObserver re-applies when slot is reverted, no infinite loop
 *   6. splitParagraphs() utility
 *   7. teardownDescriptionObservers disconnects all observers
 *   8. neutral archetype → emits skipped, no DOM mutation
 *   9. no slot elements → returns early (no event)
 *  10. HTTP error → emits adapt.description.error, no DOM mutation
 *  11. Network error → emits adapt.description.error, no DOM mutation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyDescriptionAdaptation,
  splitParagraphs,
  setDescriptionEventQueueRef,
  teardownDescriptionObservers,
} from '../core/adapt-description.js';
import type { SdkConfig } from '../core/config.js';
import type { CollectedEvent } from '../core/events.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_CONFIG: SdkConfig = {
  apiKey: 'test-api-key',
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  tier: 'augment',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#6c5ce7',
  decisionApiUrl: 'https://decision.estalara.com',
  tenantId: '550e8400-e29b-41d4-a716-446655440000',
};

const ADAPTED_DESCRIPTION = [
  'First paragraph for the yield hunter.',
  'Second paragraph with rental income details.',
  'Third paragraph about location.',
].join('\n');

const AI_CACHED_RESPONSE = {
  description: ADAPTED_DESCRIPTION,
  source: 'ai_cached' as const,
  locale: 'en',
  generated_at: '2026-06-03T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testEventQueue: CollectedEvent[];

function buildSlot(listingId = 'listing-001'): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-estalara-listing', '');
  container.setAttribute('data-estalara-listing-id', listingId);

  const slot = document.createElement('div');
  slot.setAttribute('data-estalara-slot', 'description');
  slot.innerHTML = '<p>Original paragraph 1</p><p>Original paragraph 2</p>';

  container.appendChild(slot);
  document.body.appendChild(container);
  return container;
}

function getSlotParagraphs(container: HTMLElement): string[] {
  const slot = container.querySelector('[data-estalara-slot="description"]')!;
  return Array.from(slot.querySelectorAll('p')).map((p) => p.textContent || '');
}

function mockFetchOk(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(body),
      }),
    ),
  );
}

/** Flush microtasks AND a rAF tick (two rAF-lengths worth). */
async function flushAll(): Promise<void> {
  // Flush pending microtasks
  await Promise.resolve();
  await Promise.resolve();
  // Simulate rAF callback — jsdom doesn't run rAF automatically
  vi.runAllTimers();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  testEventQueue = [];
  setDescriptionEventQueueRef(testEventQueue);
  teardownDescriptionObservers();
  // Use fake timers so rAF can be controlled
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  teardownDescriptionObservers();
  // Clean up DOM
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// splitParagraphs
// ---------------------------------------------------------------------------

describe('splitParagraphs', () => {
  it('splits on \\n and trims whitespace', () => {
    const result = splitParagraphs('  First\nSecond  \nThird');
    expect(result).toEqual(['First', 'Second', 'Third']);
  });

  it('drops blank lines', () => {
    const result = splitParagraphs('First\n\nSecond\n\n\nThird');
    expect(result).toEqual(['First', 'Second', 'Third']);
  });

  it('returns single-item array for text with no newlines', () => {
    expect(splitParagraphs('Single paragraph')).toEqual(['Single paragraph']);
  });

  it('returns empty array for blank string', () => {
    expect(splitParagraphs('')).toEqual([]);
    expect(splitParagraphs('   \n\n   ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ai_cached applies + preserves paragraphs
// ---------------------------------------------------------------------------

describe('applyDescriptionAdaptation — ai_cached', () => {
  it('applies adapted text and creates one <p> per paragraph', async () => {
    const container = buildSlot();
    mockFetchOk(AI_CACHED_RESPONSE);

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    const paragraphs = getSlotParagraphs(container);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toBe('First paragraph for the yield hunter.');
    expect(paragraphs[1]).toBe('Second paragraph with rental income details.');
    expect(paragraphs[2]).toBe('Third paragraph about location.');
  });

  it('emits adapt.description.applied with correct payload', async () => {
    buildSlot('listing-042');
    mockFetchOk(AI_CACHED_RESPONSE);

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    const applied = testEventQueue.filter((e) => e.type === 'adapt.description.applied');
    expect(applied).toHaveLength(1);
    const payload = applied[0]!.payload;
    expect(payload.listing_id).toBe('listing-042');
    expect(payload.archetype).toBe('yield_hunter');
  });

  it('sends GET request to /adapt/description with correct query params and auth header', async () => {
    buildSlot('listing-abc');
    const mockFetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(AI_CACHED_RESPONSE) }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await applyDescriptionAdaptation(BASE_CONFIG, 'family_buyer');
    await flushAll();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = mockFetch.mock.lastCall as unknown as [string, RequestInit];
    expect(calledUrl).toContain('/adapt/description');
    expect(calledUrl).toContain('listing_id=listing-abc');
    expect(calledUrl).toContain('archetype=family_buyer');
    expect(calledUrl).toContain('locale=en');
    // method defaults to GET when omitted
    expect(calledInit.method).toBeUndefined();
    const headers = calledInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-api-key');
  });
});

// ---------------------------------------------------------------------------
// source: original → leave DOM untouched
// ---------------------------------------------------------------------------

describe('applyDescriptionAdaptation — source: original', () => {
  it('does not modify the slot when source is "original"', async () => {
    const container = buildSlot();
    const originalHtml = container.querySelector('[data-estalara-slot="description"]')!.innerHTML;

    mockFetchOk({ description: 'Some text', source: 'original', locale: 'en', generated_at: null });

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    const slot = container.querySelector('[data-estalara-slot="description"]')!;
    expect(slot.innerHTML).toBe(originalHtml);
  });

  it('emits adapt.description.skipped for source: original', async () => {
    buildSlot();
    mockFetchOk({ description: 'Some text', source: 'original', locale: 'en', generated_at: null });

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    const skipped = testEventQueue.filter((e) => e.type === 'adapt.description.skipped');
    expect(skipped.length).toBeGreaterThan(0);
  });

  it('does not modify the slot when source is "template_fallback"', async () => {
    const container = buildSlot();
    const originalHtml = container.querySelector('[data-estalara-slot="description"]')!.innerHTML;

    mockFetchOk({
      description: 'Fallback text',
      source: 'template_fallback',
      locale: 'en',
      generated_at: null,
    });

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    const slot = container.querySelector('[data-estalara-slot="description"]')!;
    expect(slot.innerHTML).toBe(originalHtml);
  });

  it('does not modify the slot when description is null', async () => {
    const container = buildSlot();
    const originalHtml = container.querySelector('[data-estalara-slot="description"]')!.innerHTML;

    mockFetchOk({ description: null, source: 'ai_cached', locale: 'en', generated_at: null });

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    const slot = container.querySelector('[data-estalara-slot="description"]')!;
    expect(slot.innerHTML).toBe(originalHtml);
  });
});

// ---------------------------------------------------------------------------
// MutationObserver re-applies on framework revert, no infinite loop
// ---------------------------------------------------------------------------

describe('applyDescriptionAdaptation — MutationObserver resilience', () => {
  it('re-applies when framework reverts the slot, with no infinite loop', async () => {
    const container = buildSlot();
    const slot = container.querySelector<HTMLElement>('[data-estalara-slot="description"]')!;
    mockFetchOk(AI_CACHED_RESPONSE);

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    // Flush initial apply
    await Promise.resolve();
    await Promise.resolve();
    vi.runAllTimers(); // initial rAF
    await Promise.resolve();
    await Promise.resolve();

    // Verify initial apply worked
    let paragraphs = getSlotParagraphs(container);
    expect(paragraphs).toHaveLength(3);

    // Simulate framework revert: replace content with original text
    slot.innerHTML = '<p>Original paragraph 1</p><p>Original paragraph 2</p>';

    // The MutationObserver fires synchronously; it schedules a rAF.
    // Flush the rAF to trigger re-apply.
    await Promise.resolve();
    await Promise.resolve();
    vi.runAllTimers(); // rAF re-apply
    await Promise.resolve();
    await Promise.resolve();

    // Must be re-applied
    paragraphs = getSlotParagraphs(container);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toBe('First paragraph for the yield hunter.');

    // Verify the re-apply event was emitted
    const reapplied = testEventQueue.filter((e) => e.type === 'adapt.description.re');
    expect(reapplied.length).toBeGreaterThan(0);

    // Verify no infinite loop: simulate three more rapid reverts
    // Each revert fires the observer once; only one rAF should be pending at a time.
    const countBefore = testEventQueue.filter((e) => e.type === 'adapt.description.re').length;
    slot.innerHTML = '<p>revert 2</p>';
    slot.innerHTML = '<p>revert 3</p>';
    slot.innerHTML = '<p>revert 4</p>';

    await Promise.resolve();
    await Promise.resolve();
    vi.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();

    const countAfter = testEventQueue.filter((e) => e.type === 'adapt.description.re').length;
    // Should be at most one more re-apply event (deduplicated by rafPending)
    expect(countAfter - countBefore).toBeLessThanOrEqual(1);

    // Verify paragraphs are correct after the final re-apply
    paragraphs = getSlotParagraphs(container);
    expect(paragraphs).toHaveLength(3);
  });

  it('does NOT re-apply when SDK itself wrote the content (loop-guard)', async () => {
    buildSlot();
    mockFetchOk(AI_CACHED_RESPONSE);

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await Promise.resolve();
    await Promise.resolve();
    vi.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();

    // Count events after initial apply + rAF
    const initialApplyCount = testEventQueue.filter(
      (e) => e.type === 'adapt.description.re',
    ).length;

    // The applying flag should be false now. If our own writes triggered re-apply,
    // they would have accumulated events. They must not have.
    // Run timers again to flush any spurious pending rAF.
    vi.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();

    const afterCount = testEventQueue.filter((e) => e.type === 'adapt.description.re').length;

    // No additional re-apply triggered by our own mutation
    expect(afterCount).toBe(initialApplyCount);
  });
});

// ---------------------------------------------------------------------------
// Neutral archetype → skip
// ---------------------------------------------------------------------------

describe('applyDescriptionAdaptation — neutral archetype', () => {
  it('emits adapt.description.skipped and does not fetch', async () => {
    buildSlot();
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await applyDescriptionAdaptation(BASE_CONFIG, 'neutral');
    await flushAll();

    expect(mockFetch).not.toHaveBeenCalled();
    const skipped = testEventQueue.filter((e) => e.type === 'adapt.description.skipped');
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0]!.payload.reason).toBe('neutral');
  });
});

// ---------------------------------------------------------------------------
// No slot elements → skip
// ---------------------------------------------------------------------------

describe('applyDescriptionAdaptation — no slot elements', () => {
  it('does not fetch and returns early when no description slots exist', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    // No DOM elements added
    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    // Early return — no fetch, no skipped event for no-slot (not a failure condition)
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HTTP error → observable error event, no DOM mutation
// ---------------------------------------------------------------------------

describe('applyDescriptionAdaptation — HTTP error', () => {
  it('emits adapt.description.error on HTTP 500 and does not modify DOM', async () => {
    const container = buildSlot();
    const originalHtml = container.querySelector('[data-estalara-slot="description"]')!.innerHTML;

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 500 })),
    );

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    const errorEvents = testEventQueue.filter((e) => e.type === 'adapt.description.error');
    expect(errorEvents.length).toBeGreaterThan(0);
    expect(errorEvents[0]!.payload.reason).toBe('http_err');
    expect(errorEvents[0]!.payload.status).toBe(500);

    const slot = container.querySelector('[data-estalara-slot="description"]')!;
    expect(slot.innerHTML).toBe(originalHtml);
  });

  it('emits adapt.description.error on network failure and does not modify DOM', async () => {
    const container = buildSlot();
    const originalHtml = container.querySelector('[data-estalara-slot="description"]')!.innerHTML;

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    );

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    const errorEvents = testEventQueue.filter((e) => e.type === 'adapt.description.error');
    expect(errorEvents.length).toBeGreaterThan(0);
    expect(errorEvents[0]!.payload.reason).toBe('ne');

    const slot = container.querySelector('[data-estalara-slot="description"]')!;
    expect(slot.innerHTML).toBe(originalHtml);
  });
});

// ---------------------------------------------------------------------------
// teardownDescriptionObservers
// ---------------------------------------------------------------------------

describe('teardownDescriptionObservers', () => {
  it('disconnects all observers so subsequent reverts are not re-applied', async () => {
    const container = buildSlot();
    const slot = container.querySelector<HTMLElement>('[data-estalara-slot="description"]')!;
    mockFetchOk(AI_CACHED_RESPONSE);

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await Promise.resolve();
    await Promise.resolve();
    vi.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();

    // Verify applied
    expect(getSlotParagraphs(container)).toHaveLength(3);

    // Tear down
    teardownDescriptionObservers();

    const countBefore = testEventQueue.filter((e) => e.type === 'adapt.description.re').length;

    // Simulate framework revert AFTER teardown
    slot.innerHTML = '<p>reverted after teardown</p>';
    vi.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();

    const countAfter = testEventQueue.filter((e) => e.type === 'adapt.description.re').length;
    // No re-apply should have fired
    expect(countAfter).toBe(countBefore);
    expect(slot.querySelector('p')?.textContent).toBe('reverted after teardown');
  });
});

// ---------------------------------------------------------------------------
// No decisionApiUrl → no-op
// ---------------------------------------------------------------------------

describe('applyDescriptionAdaptation — no decisionApiUrl', () => {
  it('returns early without fetching when decisionApiUrl is absent', async () => {
    buildSlot();
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure to omit decisionApiUrl
    const { decisionApiUrl: _omit, ...configNoUrl } = BASE_CONFIG;

    await applyDescriptionAdaptation(configNoUrl, 'yield_hunter');
    await flushAll();

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ADR-0009: per-listing headline slot application
// ---------------------------------------------------------------------------

function buildSlotWithHeadline(listingId = 'listing-001'): {
  container: HTMLElement;
  headlineSlot: HTMLElement;
} {
  const container = document.createElement('div');
  container.setAttribute('data-estalara-listing', '');
  container.setAttribute('data-estalara-listing-id', listingId);

  const descSlot = document.createElement('div');
  descSlot.setAttribute('data-estalara-slot', 'description');
  descSlot.innerHTML = '<p>Original description</p>';

  const headlineSlot = document.createElement('h1');
  headlineSlot.setAttribute('data-estalara-slot', 'headline');
  headlineSlot.textContent = 'Playbook headline from /api/adapt';

  container.appendChild(descSlot);
  container.appendChild(headlineSlot);
  document.body.appendChild(container);
  return { container, headlineSlot };
}

describe('applyDescriptionAdaptation — ADR-0009 per-listing headline', () => {
  it('applies the LLM headline to [data-estalara-slot="headline"] when response has a non-empty headline', async () => {
    const { headlineSlot } = buildSlotWithHeadline();

    mockFetchOk({
      ...AI_CACHED_RESPONSE,
      headline: 'Strong buy-to-let in a prime location',
    });

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    expect(headlineSlot.textContent).toBe('Strong buy-to-let in a prime location');
  });

  it('sets headline as textContent (not innerHTML) — XSS-safe', async () => {
    const { headlineSlot } = buildSlotWithHeadline();

    mockFetchOk({
      ...AI_CACHED_RESPONSE,
      headline: '<script>alert(1)</script> Great property',
    });

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    // textContent must not parse the string as HTML
    expect(headlineSlot.innerHTML).not.toContain('<script>');
    // The raw text must appear in textContent
    expect(headlineSlot.textContent).toContain('Great property');
  });

  it('leaves headline slot untouched when headline is null', async () => {
    const { headlineSlot } = buildSlotWithHeadline();
    const originalText = headlineSlot.textContent;

    mockFetchOk({
      ...AI_CACHED_RESPONSE,
      headline: null,
    });

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    // Playbook headline must remain unchanged
    expect(headlineSlot.textContent).toBe(originalText);
  });

  it('leaves headline slot untouched when headline is absent from response', async () => {
    const { headlineSlot } = buildSlotWithHeadline();
    const originalText = headlineSlot.textContent;

    // Response without 'headline' key (pre-ADR-0009 cache entry)
    mockFetchOk(AI_CACHED_RESPONSE);

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    expect(headlineSlot.textContent).toBe(originalText);
  });

  it('leaves headline slot untouched when headline is empty string', async () => {
    const { headlineSlot } = buildSlotWithHeadline();
    const originalText = headlineSlot.textContent;

    mockFetchOk({
      ...AI_CACHED_RESPONSE,
      headline: '',
    });

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    expect(headlineSlot.textContent).toBe(originalText);
  });

  it('emits adapt.description.headline.applied event when headline is applied', async () => {
    buildSlotWithHeadline('listing-042');

    mockFetchOk({
      ...AI_CACHED_RESPONSE,
      headline: 'Prime investment in Lisbon',
    });

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await flushAll();

    const events = testEventQueue.filter((e) => e.type === 'adapt.description.headline.applied');
    expect(events).toHaveLength(1);
    expect(events[0]!.payload.listing_id).toBe('listing-042');
  });

  it('re-applies headline via MutationObserver when framework reverts it', async () => {
    const { headlineSlot } = buildSlotWithHeadline();

    mockFetchOk({
      ...AI_CACHED_RESPONSE,
      headline: 'Per-listing headline text',
    });

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    // Flush initial apply
    await Promise.resolve();
    await Promise.resolve();
    vi.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();

    // Verify initial apply
    expect(headlineSlot.textContent).toBe('Per-listing headline text');

    // Simulate framework revert
    headlineSlot.textContent = 'Playbook headline from /api/adapt';

    // The MutationObserver schedules a rAF — flush it
    await Promise.resolve();
    await Promise.resolve();
    vi.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();

    // Headline must be re-applied
    expect(headlineSlot.textContent).toBe('Per-listing headline text');

    // The re-apply event must have fired
    const reEvents = testEventQueue.filter((e) => e.type === 'adapt.description.headline.re');
    expect(reEvents.length).toBeGreaterThan(0);
  });

  it('teardownDescriptionObservers disconnects headline observers too', async () => {
    const { headlineSlot } = buildSlotWithHeadline();

    mockFetchOk({
      ...AI_CACHED_RESPONSE,
      headline: 'Per-listing headline',
    });

    await applyDescriptionAdaptation(BASE_CONFIG, 'yield_hunter');
    await Promise.resolve();
    await Promise.resolve();
    vi.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(headlineSlot.textContent).toBe('Per-listing headline');

    // Tear down
    teardownDescriptionObservers();

    // Simulate revert AFTER teardown
    headlineSlot.textContent = 'Reverted';
    vi.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();

    // Must NOT be re-applied after teardown
    expect(headlineSlot.textContent).toBe('Reverted');
  });
});
