// @vitest-environment jsdom
/**
 * FOLLOW-791 — MutationObserver-backed resilience for the generic directive pipeline.
 *
 * Before this ticket, `applyTextDirective` / `applyClassDirective` / `applyReorderDirective`
 * wrote to the DOM once and never looked again: the fingerprint idempotency guard
 * permanently blocked any future call for the same (slot/selector, archetype) pair —
 * including a call that would CORRECT a framework-reverted DOM — while `adapt.applied`
 * had already told the pipeline the write succeeded. `adapt.ts` had zero
 * `MutationObserver` usage.
 *
 * These tests are RED-FIRST: run against `main` (before this ticket's fix) the
 * "after a framework revert" assertions fail (the element keeps the REVERTED text
 * forever) — see the PR description for the actual red-run output. Once
 * `attachResilience` is wired into all three directive appliers, they pass.
 *
 * Reuses the MutationObserver-simulation harness pattern from
 * `adapt-description.test.ts` (fake timers + `flushAll` + simulate a framework revert by
 * mutating the DOM directly) rather than inventing a new one, per the ticket's AC4.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  applyDirectives,
  resetAdaptState,
  setEventQueueRef,
  teardownAdaptObservers,
} from '../core/adapt.js';
import {
  applyDescriptionAdaptation,
  setDescriptionEventQueueRef,
  teardownDescriptionObservers,
} from '../core/adapt-description.js';
import type { SdkConfig } from '../core/config.js';
import type { CollectedEvent } from '../core/events.js';
import type { TextDirective, ClassDirective, ReorderDirective } from '@estalara/shared';

let testEventQueue: CollectedEvent[];

beforeEach(() => {
  testEventQueue = [];
  setEventQueueRef(testEventQueue);
  // FOLLOW-795: same queue for both modules so hand-off tests can assert combined
  // event ordering/counts (adapt.reapplied vs adapt.description.headline.re) in one place.
  setDescriptionEventQueueRef(testEventQueue);
  resetAdaptState();
  teardownDescriptionObservers();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetAdaptState();
  teardownDescriptionObservers();
  document.body.innerHTML = '';
});

/** Flush microtasks AND a rAF tick (mirrors adapt-description.test.ts's flushAll). */
async function flushAll(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  vi.runAllTimers();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// TextDirective
// ---------------------------------------------------------------------------

describe('applyTextDirective — MutationObserver resilience (FOLLOW-791)', () => {
  it('RED-FIRST: re-applies a text directive after a framework revert, converging without an infinite loop', async () => {
    const el = document.createElement('div');
    el.setAttribute('data-estalara-slot', 'cta');
    el.textContent = 'Original CTA';
    document.body.appendChild(el);

    const directive: TextDirective = {
      type: 'text',
      slot: 'cta',
      value: 'View ROI analysis',
      archetype: 'yield_hunter',
      confidence: 0.9,
    };

    applyDirectives([directive], {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-fr-1',
      isStale: () => false,
    });

    expect(el.textContent).toBe('View ROI analysis');

    // Simulate a framework re-render (React/Svelte/Vue reconciliation) reverting the
    // SDK's write.
    el.textContent = 'Original CTA';

    await flushAll();

    // RED bar: before FOLLOW-791, applyTextDirective wrote once and never looked again —
    // this assertion fails against pre-fix adapt.ts (el.textContent stays 'Original CTA'
    // forever) and passes once the MutationObserver-backed resilience is wired in.
    expect(el.textContent).toBe('View ROI analysis');

    const reapplied = testEventQueue.filter((e) => e.type === 'adapt.reapplied');
    expect(reapplied.length).toBeGreaterThanOrEqual(1);
    expect(reapplied[0]!.payload).toMatchObject({
      slot_or_selector: 'cta',
      archetype: 'yield_hunter',
      confidence: 0.9,
    });
  });

  it('converges on a rapid revert burst — at most one repair per animation frame', async () => {
    const el = document.createElement('div');
    el.setAttribute('data-estalara-slot', 'feature');
    document.body.appendChild(el);

    const directive: TextDirective = {
      type: 'text',
      slot: 'feature',
      value: 'Investment Performance',
      archetype: 'yield_hunter',
      confidence: 0.9,
    };
    applyDirectives([directive], {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-fr-2',
      isStale: () => false,
    });
    await flushAll();

    const countBefore = testEventQueue.filter((e) => e.type === 'adapt.reapplied').length;

    el.textContent = 'revert 1';
    el.textContent = 'revert 2';
    el.textContent = 'revert 3';

    await flushAll();

    const countAfter = testEventQueue.filter((e) => e.type === 'adapt.reapplied').length;
    expect(countAfter - countBefore).toBeLessThanOrEqual(1);
    expect(el.textContent).toBe('Investment Performance');
  });

  it('FOLLOW-795 cold-start leg: attaches resilience to the "headline" slot when adapt-description.ts has NOT taken ownership, and repairs a framework revert', async () => {
    const el = document.createElement('h1');
    el.setAttribute('data-estalara-slot', 'headline');
    document.body.appendChild(el);

    const directive: TextDirective = {
      type: 'text',
      slot: 'headline',
      value: 'Playbook headline',
      archetype: 'yield_hunter',
      confidence: 0.9,
    };
    applyDirectives([directive], {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-fr-3',
      isStale: () => false,
    });
    expect(el.textContent).toBe('Playbook headline');

    // Simulate a framework re-render reverting the SDK's write — no per-listing headline
    // has ever arrived for this listing (cold start / generation failure / uncached
    // listing / neutral archetype / opt-out — the MAJORITY case, RETRO-244 §4a LG-5(a)).
    el.textContent = 'Reverted';
    await flushAll();

    // Before FOLLOW-795 this stayed 'Reverted' forever (the playbook headline was
    // permanently unrecoverable). The generic pipeline now owns the slot in the absence
    // of adapt-description.ts's per-listing headline, and repairs the revert.
    expect(el.textContent).toBe('Playbook headline');
    expect(testEventQueue.some((e) => e.type === 'adapt.reapplied')).toBe(true);
  });

  it('Rule AB: a supersession in the intra-frame gap does NOT let the deferred repair repaint stale content, and disconnects the watchdog', async () => {
    const el = document.createElement('div');
    el.setAttribute('data-estalara-slot', 'cta');
    document.body.appendChild(el);

    const directive: TextDirective = {
      type: 'text',
      slot: 'cta',
      value: 'View ROI analysis',
      archetype: 'yield_hunter',
      confidence: 0.9,
    };

    let stale = false;
    applyDirectives([directive], {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-fr-4',
      isStale: () => stale,
    });
    expect(el.textContent).toBe('View ROI analysis');

    // A framework re-render reverts the slot to the NEWER listing's own content — this
    // arms the deferred repair.
    el.textContent = 'Newer listing content';
    // Let the MutationObserver callback run (microtask) and SCHEDULE the reapply rAF...
    await Promise.resolve();
    await Promise.resolve();

    // ...then a rapid cross-listing nav supersedes THIS adaptation, in the intra-frame
    // gap after the repair is armed but before it fires.
    stale = true;

    vi.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();

    // Must NOT repaint the stale (yield_hunter) copy over the newer listing's content.
    expect(el.textContent).toBe('Newer listing content');

    // The discard is observable (guardrail K.2), not silent.
    const skippedStale = testEventQueue.filter(
      (e) => e.type === 'adapt.skipped' && e.payload.reason === 'stale',
    );
    expect(skippedStale.length).toBeGreaterThanOrEqual(1);

    // The watchdog was disconnected — a subsequent revert is NOT re-asserted either.
    el.textContent = 'Yet another revert';
    await Promise.resolve();
    await Promise.resolve();
    vi.runAllTimers();
    await Promise.resolve();
    expect(el.textContent).toBe('Yet another revert');
  });
});

// ---------------------------------------------------------------------------
// ClassDirective
// ---------------------------------------------------------------------------

describe('applyClassDirective — MutationObserver resilience (FOLLOW-791)', () => {
  it('RED-FIRST: re-applies class add/remove after a framework revert', async () => {
    const el = document.createElement('div');
    el.setAttribute('data-estalara-listing-id', 'villa-001');
    el.classList.add('estalara-suppress');
    document.body.appendChild(el);

    const directive: ClassDirective = {
      type: 'class',
      selector: '[data-estalara-listing-id]',
      add: ['estalara-boost'],
      remove: ['estalara-suppress'],
      archetype: 'yield_hunter',
      confidence: 0.9,
    };
    applyDirectives([directive], {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-cls-1',
      isStale: () => false,
    });
    expect(el.classList.contains('estalara-boost')).toBe(true);

    // Framework strips the class we added and re-adds the one we removed.
    el.classList.remove('estalara-boost');
    el.classList.add('estalara-suppress');

    await flushAll();

    // RED bar: pre-fix, this stays reverted forever.
    expect(el.classList.contains('estalara-boost')).toBe(true);
    expect(el.classList.contains('estalara-suppress')).toBe(false);
    expect(testEventQueue.some((e) => e.type === 'adapt.reapplied')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ReorderDirective
// ---------------------------------------------------------------------------

function buildGrid(ids: string[]): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-estalara-listings-grid', '');
  ids.forEach((id) => {
    const card = document.createElement('div');
    card.setAttribute('data-estalara-listing-id', id);
    container.appendChild(card);
  });
  document.body.appendChild(container);
  return container;
}

function getOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-estalara-listing-id]')).map(
    (el) => el.getAttribute('data-estalara-listing-id') ?? '',
  );
}

describe('applyReorderDirective — MutationObserver resilience (FOLLOW-791)', () => {
  it('RED-FIRST: re-applies the sorted order after a framework revert', async () => {
    const container = buildGrid(['listing-a', 'listing-b', 'listing-c']);
    const directive: ReorderDirective = {
      type: 'reorder',
      container_selector: '[data-estalara-listings-grid]',
      item_selector: '[data-estalara-listing-id]',
      score_function: 'archetype_affinity',
      scores: [
        { listing_id: 'listing-a', score: 0.3 },
        { listing_id: 'listing-b', score: 0.9 },
        { listing_id: 'listing-c', score: 0.6 },
      ],
      archetype: 'yield_hunter',
      confidence: 0.8,
    };
    applyDirectives([directive], {
      archetypeId: 'yield_hunter',
      confidence: 0.8,
      sessionId: 'sess-reorder-1',
      isStale: () => false,
    });
    expect(getOrder(container)).toEqual(['listing-b', 'listing-c', 'listing-a']);

    // Framework re-renders the grid in a different order.
    container.prepend(container.lastElementChild!);
    expect(getOrder(container)).not.toEqual(['listing-b', 'listing-c', 'listing-a']);

    await flushAll();

    // RED bar: pre-fix, this stays reverted forever.
    expect(getOrder(container)).toEqual(['listing-b', 'listing-c', 'listing-a']);
    expect(testEventQueue.some((e) => e.type === 'adapt.reapplied')).toBe(true);
  });

  it('RED-FIRST (FOLLOW-792): a framework RE-MOUNT (fresh DOM nodes, same listing ids) is repaired without duplicating cards', async () => {
    const container = buildGrid(['listing-a', 'listing-b', 'listing-c']);
    const directive: ReorderDirective = {
      type: 'reorder',
      container_selector: '[data-estalara-listings-grid]',
      item_selector: '[data-estalara-listing-id]',
      score_function: 'archetype_affinity',
      scores: [
        { listing_id: 'listing-a', score: 0.3 },
        { listing_id: 'listing-b', score: 0.9 },
        { listing_id: 'listing-c', score: 0.6 },
      ],
      archetype: 'yield_hunter',
      confidence: 0.8,
    };
    applyDirectives([directive], {
      archetypeId: 'yield_hunter',
      confidence: 0.8,
      sessionId: 'sess-remount-1',
      isStale: () => false,
    });
    expect(getOrder(container)).toEqual(['listing-b', 'listing-c', 'listing-a']);

    // Simulate a framework RE-MOUNT (React key change / Svelte {#each} re-key / any
    // destroy+recreate re-render): the ORIGINAL card elements are destroyed and REPLACED
    // by freshly-created nodes carrying the SAME data-estalara-listing-id attributes, in a
    // different order — not a re-order of the same node objects (that's the test above).
    container.innerHTML = '';
    ['listing-a', 'listing-c', 'listing-b'].forEach((id) => {
      const card = document.createElement('div');
      card.setAttribute('data-estalara-listing-id', id);
      container.appendChild(card);
    });

    await flushAll();

    // RED bar (pre-FOLLOW-792): `applyOrder` re-attaches the ORIGINAL (now-detached-orphan)
    // node objects alongside these freshly-mounted ones, so the container ends up with 6
    // children (2x the listing count) instead of 3 — this assertion fails against pre-fix
    // adapt.ts. Post-fix, `applyOrder` re-queries the live DOM at write time and the
    // container holds exactly the 3 live cards, correctly re-sorted.
    expect(container.children.length).toBe(3);
    expect(getOrder(container)).toEqual(['listing-b', 'listing-c', 'listing-a']);
  });

  it('FOLLOW-792 AC4: after a re-mount repair converges, a further host mutation does not grow the card count', async () => {
    const container = buildGrid(['listing-a', 'listing-b', 'listing-c']);
    const directive: ReorderDirective = {
      type: 'reorder',
      container_selector: '[data-estalara-listings-grid]',
      item_selector: '[data-estalara-listing-id]',
      score_function: 'archetype_affinity',
      scores: [
        { listing_id: 'listing-a', score: 0.3 },
        { listing_id: 'listing-b', score: 0.9 },
        { listing_id: 'listing-c', score: 0.6 },
      ],
      archetype: 'yield_hunter',
      confidence: 0.8,
    };
    applyDirectives([directive], {
      archetypeId: 'yield_hunter',
      confidence: 0.8,
      sessionId: 'sess-remount-2',
      isStale: () => false,
    });
    expect(getOrder(container)).toEqual(['listing-b', 'listing-c', 'listing-a']);

    // Re-mount, as above.
    container.innerHTML = '';
    ['listing-a', 'listing-c', 'listing-b'].forEach((id) => {
      const card = document.createElement('div');
      card.setAttribute('data-estalara-listing-id', id);
      container.appendChild(card);
    });
    await flushAll();
    expect(container.children.length).toBe(3);

    // A further host mutation on the now-repaired (still-live) nodes — e.g. the framework
    // re-orders again in place. Without the fix, the permanently-duplicated card count from
    // the re-mount above would keep growing on every subsequent mutation (the length check
    // in `matches()` can never converge once orphans have been appended). With the fix,
    // `applyOrder` only ever moves the nodes it re-queries live, so the count cannot grow.
    container.prepend(container.lastElementChild!);
    await flushAll();

    expect(container.children.length).toBe(3);
    expect(getOrder(container)).toEqual(['listing-b', 'listing-c', 'listing-a']);
  });
});

// ---------------------------------------------------------------------------
// teardownAdaptObservers (AC5)
// ---------------------------------------------------------------------------

describe('teardownAdaptObservers (FOLLOW-791 AC5)', () => {
  it('disconnects text-directive observers so a later revert is not repaired', async () => {
    const el = document.createElement('div');
    el.setAttribute('data-estalara-slot', 'cta');
    document.body.appendChild(el);

    const directive: TextDirective = {
      type: 'text',
      slot: 'cta',
      value: 'Adapted CTA',
      archetype: 'yield_hunter',
      confidence: 0.9,
    };
    applyDirectives([directive], {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-teardown-1',
      isStale: () => false,
    });
    expect(el.textContent).toBe('Adapted CTA');

    teardownAdaptObservers();

    el.textContent = 'Reverted after teardown';
    await flushAll();

    expect(el.textContent).toBe('Reverted after teardown');
  });

  it('resetAdaptState() also disconnects observers (cross-listing nav / archetype change, ADR-0014)', async () => {
    const el = document.createElement('div');
    el.setAttribute('data-estalara-slot', 'cta');
    document.body.appendChild(el);

    const directive: TextDirective = {
      type: 'text',
      slot: 'cta',
      value: 'Adapted CTA',
      archetype: 'yield_hunter',
      confidence: 0.9,
    };
    applyDirectives([directive], {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-teardown-2',
      isStale: () => false,
    });
    expect(el.textContent).toBe('Adapted CTA');

    // Mirrors index.ts's cross-listing nav handler, which calls resetAdaptState()
    // immediately before re-adapting the newly-viewed listing.
    resetAdaptState();

    el.textContent = 'Reverted after resetAdaptState';
    await flushAll();

    expect(el.textContent).toBe('Reverted after resetAdaptState');
  });
});

// ---------------------------------------------------------------------------
// FOLLOW-795 — headline ownership hand-off (RETRO-244 §4a LG-5(a))
//
// Drives the REAL init paths of both modules together: `applyDirectives` (adapt.ts,
// generic pipeline) and `applyDescriptionAdaptation` (adapt-description.ts, per-listing
// LLM headline, ADR-0009) — not a unit test that injects a value into one module only.
// ---------------------------------------------------------------------------

const HEADLINE_CONFIG: SdkConfig = {
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

function buildHeadlineListing(listingId = 'listing-795'): {
  container: HTMLElement;
  headlineEl: HTMLElement;
} {
  const container = document.createElement('div');
  container.setAttribute('data-estalara-listing', '');
  container.setAttribute('data-estalara-listing-id', listingId);

  const descSlot = document.createElement('div');
  descSlot.setAttribute('data-estalara-slot', 'description');
  descSlot.innerHTML = '<p>Original description</p>';

  const headlineEl = document.createElement('h1');
  headlineEl.setAttribute('data-estalara-slot', 'headline');

  container.appendChild(descSlot);
  container.appendChild(headlineEl);
  document.body.appendChild(container);
  return { container, headlineEl };
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

const PLAYBOOK_HEADLINE_DIRECTIVE: TextDirective = {
  type: 'text',
  slot: 'headline',
  value: 'Playbook headline',
  archetype: 'yield_hunter',
  confidence: 0.9,
};

describe('FOLLOW-795 — headline ownership hand-off', () => {
  it('AC2 no-fight: generic → description hand-off restores the LLM headline on revert, exactly one repair fires, and there is no observer ping-pong', async () => {
    const { headlineEl } = buildHeadlineListing();

    // 1. Arm the generic headline observer — no per-listing headline yet (cold start).
    applyDirectives([PLAYBOOK_HEADLINE_DIRECTIVE], {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-handoff-1',
      isStale: () => false,
    });
    expect(headlineEl.textContent).toBe('Playbook headline');

    // 2. A per-listing headline arrives — ownership hands off to adapt-description.ts.
    mockFetchOk({
      description: 'Adapted long-form description.',
      headline: 'LLM per-listing headline',
      source: 'ai_cached' as const,
      locale: 'en',
      generated_at: '2026-08-03T00:00:00.000Z',
    });
    await applyDescriptionAdaptation(HEADLINE_CONFIG, 'yield_hunter', () => false);
    await flushAll();

    expect(headlineEl.textContent).toBe('LLM per-listing headline');

    const reappliedAfterHandoff = testEventQueue.filter((e) => e.type === 'adapt.reapplied');
    const headlineAppliedAfterHandoff = testEventQueue.filter(
      (e) => e.type === 'adapt.description.headline.applied',
    );
    expect(headlineAppliedAfterHandoff).toHaveLength(1);
    // The generic watchdog must be evicted, not merely inert — no adapt.reapplied fires
    // for this element from this point on (asserted below after the revert too).
    const reappliedBeforeRevert = reappliedAfterHandoff.length;

    // 3. Externally revert the DOM (framework re-render) — assert the LLM headline is
    // what gets restored, NOT the playbook text, and exactly one repair fires.
    headlineEl.textContent = 'Reverted by framework';
    await flushAll();

    expect(headlineEl.textContent).toBe('LLM per-listing headline');

    const reEvents = testEventQueue.filter((e) => e.type === 'adapt.description.headline.re');
    expect(reEvents).toHaveLength(1);
    // Still zero generic adapt.reapplied events for this element — the generic
    // watchdog was evicted at hand-off, so it never fires a repair post-handoff.
    expect(testEventQueue.filter((e) => e.type === 'adapt.reapplied').length).toBe(
      reappliedBeforeRevert,
    );

    // 4. No observer ping-pong: flush several more animation frames with no further
    // external mutation — the event count must stay bounded (converged), not growing.
    const countAfterFirstRepair = testEventQueue.filter(
      (e) => e.type === 'adapt.description.headline.re',
    ).length;
    for (let frame = 0; frame < 5; frame++) {
      await flushAll();
    }
    expect(testEventQueue.filter((e) => e.type === 'adapt.description.headline.re').length).toBe(
      countAfterFirstRepair,
    );
    expect(headlineEl.textContent).toBe('LLM per-listing headline');
  });

  it('AC3 cold-start leg: no per-listing headline ever arrives — the playbook headline is restored via the generic watchdog and adapt.reapplied fires', async () => {
    const { headlineEl } = buildHeadlineListing();

    applyDirectives([PLAYBOOK_HEADLINE_DIRECTIVE], {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-coldstart-1',
      isStale: () => false,
    });
    expect(headlineEl.textContent).toBe('Playbook headline');

    // No per-listing headline is ever fetched (generation failure / uncached listing /
    // neutral archetype / opt-out) — applyDescriptionAdaptation is simply never called,
    // mirroring the majority real-world case this ticket closes.
    headlineEl.textContent = 'Reverted by framework';
    await flushAll();

    // Before FOLLOW-795 this stayed reverted forever (RETRO-244 §4a LG-5(a) primary gap).
    expect(headlineEl.textContent).toBe('Playbook headline');
    const reapplied = testEventQueue.filter((e) => e.type === 'adapt.reapplied');
    expect(reapplied.length).toBeGreaterThanOrEqual(1);
    expect(reapplied[0]!.payload).toMatchObject({
      slot_or_selector: 'headline',
      archetype: 'yield_hunter',
      confidence: 0.9,
    });
  });

  it('AC4 teardown leg: resetAdaptState()/teardownAdaptObservers() disconnects the generic watchdog when it owns the headline slot', async () => {
    const { headlineEl } = buildHeadlineListing();

    applyDirectives([PLAYBOOK_HEADLINE_DIRECTIVE], {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-teardown-headline-1',
      isStale: () => false,
    });
    expect(headlineEl.textContent).toBe('Playbook headline');

    resetAdaptState();

    headlineEl.textContent = 'Reverted after teardown';
    await flushAll();

    expect(headlineEl.textContent).toBe('Reverted after teardown');
  });

  it('AC4 teardown leg: teardownDescriptionObservers() disconnects the description watchdog when it owns the headline slot (post hand-off)', async () => {
    const { headlineEl } = buildHeadlineListing();

    applyDirectives([PLAYBOOK_HEADLINE_DIRECTIVE], {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-teardown-headline-2',
      isStale: () => false,
    });

    mockFetchOk({
      description: 'Adapted long-form description.',
      headline: 'LLM per-listing headline',
      source: 'ai_cached' as const,
      locale: 'en',
      generated_at: '2026-08-03T00:00:00.000Z',
    });
    await applyDescriptionAdaptation(HEADLINE_CONFIG, 'yield_hunter', () => false);
    await flushAll();
    expect(headlineEl.textContent).toBe('LLM per-listing headline');

    // Mirrors index.ts's cross-listing nav handler: resetAdaptState() (generic side) +
    // teardownDescriptionObservers() (description side) run together.
    resetAdaptState();
    teardownDescriptionObservers();

    headlineEl.textContent = 'Reverted after teardown';
    await flushAll();

    expect(headlineEl.textContent).toBe('Reverted after teardown');
  });

  it('does not attach a generic watchdog when adapt-description.ts already owns the slot (skips with an observable event)', async () => {
    const { headlineEl } = buildHeadlineListing();

    mockFetchOk({
      description: 'Adapted long-form description.',
      headline: 'LLM per-listing headline',
      source: 'ai_cached' as const,
      locale: 'en',
      generated_at: '2026-08-03T00:00:00.000Z',
    });
    await applyDescriptionAdaptation(HEADLINE_CONFIG, 'yield_hunter', () => false);
    await flushAll();
    expect(headlineEl.textContent).toBe('LLM per-listing headline');

    // A LATER /api/adapt response (e.g. a repeat call for a different signal update)
    // tries to write the playbook headline again — must be skipped, not overwrite the
    // LLM headline, and must not attach a second observer.
    resetAdaptState(); // clears the fingerprint guard so applyTextDirective re-enters
    applyDirectives([PLAYBOOK_HEADLINE_DIRECTIVE], {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: 'sess-skip-1',
      isStale: () => false,
    });

    expect(headlineEl.textContent).toBe('LLM per-listing headline');
    const skipped = testEventQueue.filter(
      (e) => e.type === 'adapt.skipped' && e.payload.reason === 'headline_owned_by_description',
    );
    expect(skipped.length).toBeGreaterThanOrEqual(1);

    // FOLLOW-802 AC4: extended, not replaced. `>= 1` passed even while the same call ALSO
    // emitted a false `adapt.applied` for a headline it never wrote — the skip and the
    // success event were both true at once, and only the skip was being checked.
    expect(skipped).toHaveLength(1);
    expect(
      testEventQueue.filter(
        (e) => e.type === 'adapt.applied' && e.payload.slot_or_selector === 'headline',
      ),
    ).toHaveLength(0);
  });

  // FOLLOW-802 AC2 / TG-4 — the reachable sequence RETRO-245 traced. Neither shipped
  // teardown test covers this combination: a real hand-off, then a SAME-PAGE archetype
  // change. `index.ts` used to call `resetAdaptState()` alone there, and because the
  // hand-off deletes the element from `_textResilienceMap`, ownership survived and the
  // generic pipeline skipped the headline for every later archetype — permanently stuck on
  // the first archetype's LLM copy if its own fetch then failed.
  it('releases description ownership on a same-page archetype change (FOLLOW-802 TG-4)', async () => {
    const { headlineEl } = buildHeadlineListing();

    mockFetchOk({
      description: 'Adapted long-form description.',
      headline: 'LLM per-listing headline',
      source: 'ai_cached' as const,
      locale: 'en',
      generated_at: '2026-08-03T00:00:00.000Z',
    });
    await applyDescriptionAdaptation(HEADLINE_CONFIG, 'yield_hunter', () => false);
    await flushAll();
    expect(headlineEl.textContent).toBe('LLM per-listing headline');

    // Exactly what index.ts now does when the archetype changes on the SAME page.
    resetAdaptState();
    teardownDescriptionObservers();

    testEventQueue.length = 0;
    applyDirectives(
      [
        {
          type: 'text' as const,
          slot: 'headline',
          value: 'Family playbook headline',
          archetype: 'family_buyer',
          confidence: 0.9,
        },
      ],
      {
        archetypeId: 'family_buyer',
        confidence: 0.9,
        sessionId: 'sess-tg4',
        isStale: () => false,
      },
    );
    await flushAll();

    expect(headlineEl.textContent).toBe('Family playbook headline');
    expect(
      testEventQueue.filter(
        (e) => e.type === 'adapt.skipped' && e.payload.reason === 'headline_owned_by_description',
      ),
    ).toHaveLength(0);
    expect(
      testEventQueue.filter(
        (e) => e.type === 'adapt.applied' && e.payload.slot_or_selector === 'headline',
      ),
    ).toHaveLength(1);
  });
});
