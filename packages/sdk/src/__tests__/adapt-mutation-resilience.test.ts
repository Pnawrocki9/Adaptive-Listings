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
import type { CollectedEvent } from '../core/events.js';
import type { TextDirective, ClassDirective, ReorderDirective } from '@estalara/shared';

let testEventQueue: CollectedEvent[];

beforeEach(() => {
  testEventQueue = [];
  setEventQueueRef(testEventQueue);
  resetAdaptState();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetAdaptState();
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

  it('does NOT attach resilience to the "headline" slot (owned by adapt-description.ts, ADR-0009)', async () => {
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

    el.textContent = 'Reverted';
    await flushAll();

    // Documented, pre-existing (unchanged by this ticket) gap: the playbook headline
    // stays one-shot because adapt-description.ts's applyAndObserveHeadlineSlot
    // independently owns and observes this exact slot once a per-listing headline
    // exists — a second, independent observer here would fight it.
    expect(el.textContent).toBe('Reverted');
    expect(testEventQueue.some((e) => e.type === 'adapt.reapplied')).toBe(false);
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
