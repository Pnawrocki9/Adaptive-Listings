// @vitest-environment jsdom
/**
 * FOLLOW-801 — translated adaptation slots must be annotated on an UNAMBIGUOUS match only.
 *
 * The defect (RETRO-245 §4a LG-1, shipped on `main` at `675cd75f`). FOLLOW-796 restored the
 * `cta_primary → cta` translation — correct, and the commercial point of that merge — but
 * `annotateSlots` writes the slot onto **every** match of the selector, document-wide
 * (`querySelectorAll`, `searchRoot` defaulting to `document.documentElement`). The selectors
 * the auto-detect techniques emit for `cta_primary` are broad by construction:
 * `a[href*="contact"]` (`wordpress.ts:470`, `json-ld.ts:197`) and
 * `[class*='cta'], [class*='button']` (`css-modules.ts:500`).
 *
 * Before the translation those matches were annotated `data-estalara-slot="cta_primary"` and
 * no directive targeted that name: inert. After it they are `"cta"`, `applyTextDirective`
 * overwrites the `textContent` of **all** of them with one archetype string, and — since
 * FOLLOW-791 — arms a MutationObserver on **each** that re-asserts the overwrite against the
 * host framework indefinitely. A tenant's nav "Contact us" link becomes "View ROI Analysis"
 * and stays that way.
 *
 * The fix restores what ADR-0008 §Decision.1 always specified for this bridge and the
 * FOLLOW-340 rewrite silently dropped: **unique-match only**. An ambiguous selector is
 * skipped wholesale and the skip is observable (guardrail K.2 — a silent no-op would
 * reintroduce exactly the invisibility this chain exists to remove).
 *
 * Coverage:
 *   AC-3  ≥3 matches (nav + card + footer) → nothing annotated, nothing overwritten, and
 *         crucially NO observer armed on the bystanders. MUST fail against `675cd75f`.
 *   AC-2  the ambiguous skip emits an observable event carrying the match count.
 *   AC-1  exactly 1 match still annotates and adapts — FOLLOW-796 is not regressed.
 *   AC-4  the policy holds on a `listing_list`-shaped page (many cards, many contact links).
 *   —     untranslated keys keep their pre-existing every-match behaviour (out of scope here;
 *         pinned so a later widening of the rule is a deliberate, visible change).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { annotateSlots } from '../core/annotate-slots.js';
import { applyDirectives, resetAdaptState, setEventQueueRef } from '../core/adapt.js';
import type { ApplyContext } from '../core/adapt.js';
import type { CollectedEvent } from '../core/events.js';
import type { TextDirective } from '@estalara/shared';

let events: CollectedEvent[];

const CONTEXT: ApplyContext = {
  archetypeId: 'yield_hunter',
  confidence: 0.9,
  sessionId: 'sess-follow801',
  isStale: () => false,
};

const CTA_DIRECTIVE: TextDirective = {
  type: 'text',
  slot: 'cta',
  value: 'View ROI Analysis',
  archetype: 'yield_hunter',
  confidence: 0.9,
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  events = [];
  setEventQueueRef(events);
  resetAdaptState();
});

afterEach(() => {
  resetAdaptState();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/** Flush microtasks AND a rAF tick (mirrors adapt-mutation-resilience.test.ts). */
async function flushAll(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  vi.runAllTimers();
  await Promise.resolve();
  await Promise.resolve();
}

/** The shape a WordPress/JSON-LD detection produces on a real tenant detail page. */
function renderBroadContactPage(): void {
  document.body.innerHTML = `
    <nav><a id="nav" href="/contact">Contact us</a></nav>
    <main><a id="card" href="/contact?listing=42">Request a viewing</a></main>
    <footer><a id="foot" href="/contact-support">Contact support</a></footer>
  `;
}

const el = (id: string): HTMLElement => document.getElementById(id)!;

// ─── AC-3: the regression itself ──────────────────────────────────────────────

describe('FOLLOW-801 AC-3 — a broad cta_primary selector must not overwrite every match', () => {
  it('3 matches → none annotated, none overwritten', async () => {
    renderBroadContactPage();

    annotateSlots({ cta_primary: 'a[href*="contact"]' });
    applyDirectives([CTA_DIRECTIVE], CONTEXT);
    await flushAll();

    // Nothing carries the translated slot — the selector was ambiguous.
    expect(document.querySelectorAll('[data-estalara-slot="cta"]')).toHaveLength(0);

    // Against 675cd75f all three of these read "View ROI Analysis".
    expect(el('nav').textContent).toBe('Contact us');
    expect(el('card').textContent).toBe('Request a viewing');
    expect(el('foot').textContent).toBe('Contact support');
  });

  it('no resilience observer is armed on the bystanders', async () => {
    renderBroadContactPage();

    annotateSlots({ cta_primary: 'a[href*="contact"]' });
    applyDirectives([CTA_DIRECTIVE], CONTEXT);
    await flushAll();

    // Simulate the host framework re-rendering its own nav label. If an observer had been
    // armed (the FOLLOW-791 mechanism), it would treat this as a revert and re-assert the
    // archetype string — permanently. That is the part a plain textContent assertion misses.
    el('nav').textContent = 'Kontakt';
    el('foot').textContent = 'Wsparcie';
    await flushAll();

    expect(el('nav').textContent).toBe('Kontakt');
    expect(el('foot').textContent).toBe('Wsparcie');
  });
});

// ─── AC-2: the skip must be observable ────────────────────────────────────────

describe('FOLLOW-801 AC-2 — an ambiguous annotation is never a silent no-op', () => {
  it('emits a skip event naming the slot and the match count', () => {
    renderBroadContactPage();

    annotateSlots({ cta_primary: 'a[href*="contact"]' });

    const skips = events.filter((e) => e.type === 'adapt.skipped');
    expect(skips).toHaveLength(1);
    expect(skips[0]?.payload).toMatchObject({
      reason: 'ambiguous_slot_selector',
      slot_or_selector: 'cta',
      match_count: 3,
    });
  });
});

// ─── AC-1: no FOLLOW-796 regression ───────────────────────────────────────────

describe('FOLLOW-801 AC-1 — an unambiguous cta_primary still translates and adapts', () => {
  it('exactly 1 match → annotated "cta" and mutated by the directive', async () => {
    document.body.innerHTML = `<main><a id="card" href="/contact?listing=42">Request a viewing</a></main>`;

    annotateSlots({ cta_primary: 'a[href*="contact"]' });
    applyDirectives([CTA_DIRECTIVE], CONTEXT);
    await flushAll();

    expect(el('card').getAttribute('data-estalara-slot')).toBe('cta');
    expect(el('card').textContent).toBe('View ROI Analysis');
    expect(events.filter((e) => e.payload.reason === 'ambiguous_slot_selector')).toHaveLength(0);
  });

  it('a hand-coded slot still wins and is left untouched (pilot shape, FOLLOW-796 AC-6)', () => {
    document.body.innerHTML = `
      <a id="hand" data-estalara-slot="cta" href="/contact">Book</a>
      <a id="other" href="/contact-us">Contact</a>
    `;

    annotateSlots({ cta_primary: 'a[href*="contact"]' });

    expect(el('hand').getAttribute('data-estalara-slot')).toBe('cta');
    // The second node is ambiguous company: the selector matched 2, so nothing new is written.
    expect(el('other').hasAttribute('data-estalara-slot')).toBe(false);
  });
});

// ─── AC-4: the same policy on a list page ─────────────────────────────────────

describe('FOLLOW-801 AC-4 — the policy holds on a listing_list-shaped page', () => {
  it('a grid of cards each carrying a contact link annotates nothing', async () => {
    document.body.innerHTML = `
      <nav><a href="/contact">Contact us</a></nav>
      <ul>
        <li><a href="/contact?listing=1">Enquire</a></li>
        <li><a href="/contact?listing=2">Enquire</a></li>
        <li><a href="/contact?listing=3">Enquire</a></li>
      </ul>
    `;

    annotateSlots({ cta_primary: 'a[href*="contact"]' });
    applyDirectives([CTA_DIRECTIVE], CONTEXT);
    await flushAll();

    expect(document.querySelectorAll('[data-estalara-slot="cta"]')).toHaveLength(0);
    expect(document.querySelectorAll('a')).toHaveLength(4);
    for (const a of Array.from(document.querySelectorAll('a'))) {
      expect(a.textContent).not.toBe('View ROI Analysis');
    }
  });
});

// ─── Scope boundary: untranslated keys are deliberately unchanged ─────────────

describe('FOLLOW-801 scope — untranslated keys keep their pre-existing behaviour', () => {
  it('a multi-match `headline` key still annotates every match (pre-existing, not this ticket)', () => {
    document.body.innerHTML = `<h1 id="a">One</h1><h1 id="b">Two</h1>`;

    annotateSlots({ headline: 'h1' });

    // Pinned deliberately: `headline` was never routed through SLOT_NAME_TRANSLATION, so its
    // every-match behaviour predates FOLLOW-796 and is NOT the regression FOLLOW-801 fixes.
    // If a later ticket widens unique-match to identity keys, this expectation must be
    // changed consciously rather than silently satisfied.
    expect(el('a').getAttribute('data-estalara-slot')).toBe('headline');
    expect(el('b').getAttribute('data-estalara-slot')).toBe('headline');
  });
});
