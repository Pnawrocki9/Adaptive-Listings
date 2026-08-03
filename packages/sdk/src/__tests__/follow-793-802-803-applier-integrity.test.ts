// @vitest-environment jsdom
/**
 * FOLLOW-793 + FOLLOW-802 + FOLLOW-803 — three defects that all reduce to the same shape:
 * the applier reporting success for work it did not do, and bookkeeping that outlives the
 * thing it books.
 *
 *   FOLLOW-793  the stale-at-arm path emitted `adapt.applied` for a write that never
 *               happened AND recorded the idempotency fingerprint, permanently blocking the
 *               later correct write for that (slot, archetype).
 *   FOLLOW-802  FOLLOW-795's `headline_owned_by_description` early return is a SECOND door
 *               into the same defect; a third is the mirror-image map asymmetry in
 *               `adapt-description.ts`. Plus: after a hand-off the element is deleted from
 *               `_textResilienceMap`, so `teardownAdaptObservers()` is structurally unable
 *               to release a `'description'` ownership entry.
 *   FOLLOW-803  the reorder repair's `matches()` compared the live cards against a FROZEN
 *               id sequence, so any change to the card COUNT made it permanently false —
 *               unbounded `adapt.reapplied` and a full detach/re-insert on every host
 *               mutation, forever.
 *
 * Every test here fails against `cdac63eb` (the merge that shipped FOLLOW-801).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  applyDirectives,
  resetAdaptState,
  setEventQueueRef,
  teardownAdaptObservers,
} from '../core/adapt.js';
import type { ApplyContext } from '../core/adapt.js';
import { teardownDescriptionObservers } from '../core/adapt-description.js';
import { setHeadlineOwner, clearHeadlineOwner } from '../core/headline-ownership.js';
import type { CollectedEvent } from '../core/events.js';
import type { TextDirective, ReorderDirective, ArchetypeId } from '@estalara/shared';

let events: CollectedEvent[];

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  events = [];
  setEventQueueRef(events);
  resetAdaptState();
  teardownDescriptionObservers();
});

afterEach(() => {
  resetAdaptState();
  teardownAdaptObservers();
  teardownDescriptionObservers();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

async function flushAll(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  vi.runAllTimers();
  await Promise.resolve();
  await Promise.resolve();
}

const ctx = (over: Partial<ApplyContext> = {}): ApplyContext => ({
  archetypeId: 'yield_hunter',
  confidence: 0.9,
  sessionId: 'sess-integrity',
  isStale: () => false,
  ...over,
});

const textDirective = (value: string, archetype: ArchetypeId = 'yield_hunter'): TextDirective => ({
  type: 'text',
  slot: 'headline',
  value,
  archetype,
  confidence: 0.9,
});

const applied = (slot: string): CollectedEvent[] =>
  events.filter((e) => e.type === 'adapt.applied' && e.payload.slot_or_selector === slot);

const skippedFor = (reason: string): CollectedEvent[] =>
  events.filter((e) => e.type === 'adapt.skipped' && e.payload.reason === reason);

// ─── FOLLOW-793: stale at arm time ────────────────────────────────────────────

describe('FOLLOW-793 — a write declined as stale is not reported as applied', () => {
  it('emits skipped{stale}, ZERO adapt.applied, and writes nothing', () => {
    document.body.innerHTML = `<h1 data-estalara-slot="headline">Original</h1>`;

    applyDirectives([textDirective('Yield copy')], ctx({ isStale: () => true }));

    expect(skippedFor('stale')).toHaveLength(1);
    expect(applied('headline')).toHaveLength(0);
    expect(document.querySelector('h1')?.textContent).toBe('Original');
  });

  it('does NOT poison the fingerprint — the same (slot, archetype) still applies later', () => {
    document.body.innerHTML = `<h1 data-estalara-slot="headline">Original</h1>`;

    // First call is superseded mid-flight and writes nothing.
    applyDirectives([textDirective('Yield copy')], ctx({ isStale: () => true }));
    expect(document.querySelector('h1')?.textContent).toBe('Original');

    // Same slot, same archetype, no reset in between — this is the retry the poisoned
    // fingerprint used to swallow silently.
    applyDirectives([textDirective('Yield copy')], ctx());

    expect(document.querySelector('h1')?.textContent).toBe('Yield copy');
    expect(applied('headline')).toHaveLength(1);
  });
});

// ─── FOLLOW-802: the headline-ownership door + release symmetry ───────────────

describe('FOLLOW-802 — the headline-owned skip is not reported as applied', () => {
  it('emits skipped{headline_owned_by_description} and ZERO adapt.applied', () => {
    document.body.innerHTML = `<h1 data-estalara-slot="headline">LLM headline</h1>`;
    const el = document.querySelector('h1') as HTMLElement;
    setHeadlineOwner(el, 'description');

    applyDirectives([textDirective('Playbook copy')], ctx());

    expect(skippedFor('headline_owned_by_description')).toHaveLength(1);
    expect(applied('headline')).toHaveLength(0);
    expect(el.textContent).toBe('LLM headline');
  });

  it('the un-written slot leaves the fingerprint free for the next archetype', () => {
    document.body.innerHTML = `<h1 data-estalara-slot="headline">LLM headline</h1>`;
    const el = document.querySelector('h1') as HTMLElement;
    setHeadlineOwner(el, 'description');

    applyDirectives([textDirective('Playbook copy')], ctx());
    expect(el.textContent).toBe('LLM headline');

    // Release ownership the way the description module itself does, then apply a different
    // archetype. The realistic hand-off → archetype-change path (TG-4) is exercised in
    // `adapt-mutation-resilience.test.ts`, which owns the fetch harness.
    clearHeadlineOwner(el);
    resetAdaptState();
    applyDirectives(
      [textDirective('Family copy', 'family_buyer')],
      ctx({ archetypeId: 'family_buyer' }),
    );

    expect(el.textContent).toBe('Family copy');
    expect(applied('headline')).toHaveLength(1);
  });
});

// ─── FOLLOW-803: the reorder predicate must be set-independent ────────────────

function renderGrid(ids: string[]): HTMLElement {
  document.body.innerHTML = `<div id="grid">${ids
    .map((id) => `<div class="card" data-estalara-listing-id="${id}">${id}</div>`)
    .join('')}</div>`;
  return document.getElementById('grid')!;
}

const reorderDirective = (ids: string[]): ReorderDirective => ({
  type: 'reorder',
  container_selector: '#grid',
  item_selector: '.card',
  score_function: 'archetype_affinity',
  archetype: 'yield_hunter',
  confidence: 0.9,
  // Descending score = descending id order (c > b > a).
  scores: ids.map((id, i) => ({ listing_id: id, score: ids.length - i })),
});

const liveIds = (): string[] =>
  Array.from(document.querySelectorAll('#grid .card')).map(
    (c) => c.getAttribute('data-estalara-listing-id') ?? '',
  );

const reappliedCount = (): number => events.filter((e) => e.type === 'adapt.reapplied').length;

describe('FOLLOW-803 — the reorder repair converges after a card-count change (TG-3)', () => {
  it('a REMOVED card does not cause unbounded reapplied events', async () => {
    const grid = renderGrid(['a', 'b', 'c']);
    applyDirectives([reorderDirective(['c', 'b', 'a'])], ctx());
    await flushAll();
    expect(liveIds()).toEqual(['c', 'b', 'a']);

    // The host removes one card (a filter, a sold listing) — an ordinary grid event.
    grid.querySelector('[data-estalara-listing-id="b"]')?.remove();
    await flushAll();
    const afterRemoval = reappliedCount();

    // Several more frames of ordinary host activity inside the container.
    for (let i = 0; i < 3; i++) {
      grid.setAttribute('data-tick', String(i));
      grid.appendChild(document.createComment('host churn'));
      await flushAll();
    }

    // Against the frozen-sequence predicate the count kept climbing forever.
    expect(reappliedCount()).toBe(afterRemoval);
    expect(liveIds()).toEqual(['c', 'a']);
  });

  it('an APPENDED unscored card settles instead of churning forever', async () => {
    const grid = renderGrid(['a', 'b', 'c']);
    applyDirectives([reorderDirective(['c', 'b', 'a'])], ctx());
    await flushAll();

    // "Load more" delivers a card we never scored — it sorts to the end (-Infinity).
    const fresh = document.createElement('div');
    fresh.className = 'card';
    fresh.setAttribute('data-estalara-listing-id', 'zz');
    grid.appendChild(fresh);
    await flushAll();
    const afterAppend = reappliedCount();

    for (let i = 0; i < 3; i++) {
      grid.appendChild(document.createComment('host churn'));
      await flushAll();
    }

    expect(reappliedCount()).toBe(afterAppend);
    expect(liveIds()).toEqual(['c', 'b', 'a', 'zz']);
  });

  it('a genuine out-of-order mutation is still repaired', async () => {
    const grid = renderGrid(['a', 'b', 'c']);
    applyDirectives([reorderDirective(['c', 'b', 'a'])], ctx());
    await flushAll();
    expect(liveIds()).toEqual(['c', 'b', 'a']);

    // The framework re-sorts the grid back to its own order. The watchdog must still fire —
    // set-independence must not become blindness.
    const cardA = grid.querySelector('[data-estalara-listing-id="a"]')!;
    grid.prepend(cardA);
    expect(liveIds()).toEqual(['a', 'c', 'b']);
    await flushAll();

    expect(liveIds()).toEqual(['c', 'b', 'a']);
  });
});
