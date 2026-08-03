// @vitest-environment jsdom
/**
 * FOLLOW-796 — slot-name translation between the DETECTION and ADAPTATION vocabularies.
 *
 * The defect (RETRO-093 §4a LG-1, re-filed): `annotateSlots()` wrote the tenant schema's
 * key VERBATIM onto `data-estalara-slot`, but the schema vocabulary
 * (`headline | tagline | cta_primary | cta_secondary | description | features_list`) is not
 * the directive vocabulary (`headline | cta | feature`, plus `description` from the
 * per-listing pipeline). `cta_primary ≠ cta`, so every playbook `cta` directive emitted
 * `adapt.skipped {no_slot_elements}` on a self-annotated (auto-detected) tenant. Only
 * `headline`/`description` worked — by naming accident.
 *
 * These tests deliberately use NON-COINCIDING pairs (a `cta_primary` schema key against a
 * `cta` directive). RETRO-093 §4b CB-1 flagged the opposite (a `headline` key against a
 * `headline` directive) as the test-design mistake that let the defect ship: a fixture that
 * agrees with itself on the identifier proves transport but is blind to a translation gap.
 *
 * Coverage:
 *   AC-1  `cta_primary` → `data-estalara-slot="cta"` (the rename itself)
 *   AC-1  identity keys (`headline`, `description`) are unchanged — no regression
 *   AC-1  unmapped keys (`tagline`, `cta_secondary`) pass through verbatim
 *   AC-2  directive-level: a `cta` TextDirective now finds the node annotated from a
 *         `cta_primary` schema key and mutates it (fails before the fix)
 *   AC-3  `feature` is documented OUT OF SCOPE — this asserts the CURRENT documented
 *         behaviour (annotate `features_list` verbatim; `feature` directive skips)
 *   AC-6  hand-coded `data-estalara-slot="cta"` (the live pilot's markup) is never
 *         overwritten by the translated annotation — the pilot masks this bug
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { annotateSlots } from '../core/annotate-slots.js';
import { applyDirectives, resetAdaptState, setEventQueueRef } from '../core/adapt.js';
import type { ApplyContext } from '../core/adapt.js';
import type { CollectedEvent } from '../core/events.js';
import type { TextDirective } from '@estalara/shared';

let events: CollectedEvent[];

/** Shared apply context — confidence/staleness are orthogonal to slot naming here. */
const CONTEXT: ApplyContext = {
  archetypeId: 'yield_hunter',
  confidence: 0.9,
  sessionId: 'sess-follow796',
  isStale: () => false,
};

beforeEach(() => {
  document.body.innerHTML = '';
  events = [];
  setEventQueueRef(events);
  resetAdaptState();
});

afterEach(() => {
  resetAdaptState();
  document.body.innerHTML = '';
});

// ─── AC-1: the translation table ──────────────────────────────────────────────

describe('FOLLOW-796 AC-1 — annotateSlots() translates detection keys to directive slots', () => {
  it('cta_primary → data-estalara-slot="cta" (NOT "cta_primary")', () => {
    document.body.innerHTML = `<a class="btn-book" href="#">Book a viewing</a>`;

    const count = annotateSlots({ cta_primary: '.btn-book' });

    expect(count).toBe(1);
    const anchor = document.querySelector('.btn-book')!;
    // The directive vocabulary name — this is the assertion that fails before the fix.
    expect(anchor.getAttribute('data-estalara-slot')).toBe('cta');
    // The raw schema key must NOT reach the DOM.
    expect(document.querySelectorAll('[data-estalara-slot="cta_primary"]').length).toBe(0);
  });

  it('headline / description keys are unchanged (identity mapping, no regression)', () => {
    document.body.innerHTML = `
      <h1 class="listing-title">Great Property</h1>
      <p class="listing-desc">A beautiful home</p>
    `;

    const count = annotateSlots({ headline: '.listing-title', description: '.listing-desc' });

    expect(count).toBe(2);
    expect(document.querySelector('h1')?.getAttribute('data-estalara-slot')).toBe('headline');
    expect(document.querySelector('p')?.getAttribute('data-estalara-slot')).toBe('description');
  });

  it('unmapped schema keys pass through verbatim (tagline, cta_secondary)', () => {
    document.body.innerHTML = `
      <p class="tag">Sea views</p>
      <a class="btn-alt" href="#">Download brochure</a>
    `;

    const count = annotateSlots({ tagline: '.tag', cta_secondary: '.btn-alt' });

    expect(count).toBe(2);
    expect(document.querySelector('.tag')?.getAttribute('data-estalara-slot')).toBe('tagline');
    // cta_secondary must NOT be collapsed into 'cta' — that would let a `cta` directive
    // overwrite the SECONDARY call-to-action.
    expect(document.querySelector('.btn-alt')?.getAttribute('data-estalara-slot')).toBe(
      'cta_secondary',
    );
    expect(document.querySelectorAll('[data-estalara-slot="cta"]').length).toBe(0);
  });
});

// ─── AC-2: non-coinciding pair, directive level ───────────────────────────────

describe('FOLLOW-796 AC-2 — a `cta` directive reaches a node annotated from `cta_primary`', () => {
  const ctaDirective: TextDirective = {
    type: 'text',
    slot: 'cta',
    value: 'Request Investment Pack',
    archetype: 'yield_hunter',
    confidence: 0.9,
  };

  it('annotate(cta_primary) → applyDirectives(slot:"cta") mutates the node', () => {
    document.body.innerHTML = `<a class="btn-book" href="#">Book a viewing</a>`;

    annotateSlots({ cta_primary: '.btn-book' });
    applyDirectives([ctaDirective], CONTEXT);

    const anchor = document.querySelector('.btn-book')!;
    expect(anchor.textContent).toBe('Request Investment Pack');

    const skips = events.filter(
      (e) => e.type === 'adapt.skipped' && e.payload.slot_or_selector === 'cta',
    );
    expect(skips).toHaveLength(0);
    const applied = events.filter(
      (e) => e.type === 'adapt.applied' && e.payload.slot_or_selector === 'cta',
    );
    expect(applied).toHaveLength(1);
  });

  it('regression guard: without any annotation the same directive still skips', () => {
    // Proves the previous assertion is carried by the annotation, not by ambient DOM.
    document.body.innerHTML = `<a class="btn-book" href="#">Book a viewing</a>`;

    applyDirectives([ctaDirective], CONTEXT);

    expect(document.querySelector('.btn-book')?.textContent).toBe('Book a viewing');
    const skips = events.filter(
      (e) => e.type === 'adapt.skipped' && e.payload.reason === 'no_slot_elements',
    );
    expect(skips.map((e) => e.payload.slot_or_selector)).toContain('cta');
  });
});

// ─── AC-3: `feature` is documented out of scope ───────────────────────────────

describe('FOLLOW-796 AC-3 — `feature` directives remain out of scope for self-annotation', () => {
  /**
   * This asserts the CURRENT, DOCUMENTED behaviour, not a desired end state.
   *
   * `features_list` has no production producer (no auto-detect technique emits it, no
   * curated schema carries one), `docs/MASTER_DESIGN.md` records `features_list`/`tagline`
   * as out of scope for v1, and a `feature` TextDirective overwrites `textContent` — so
   * annotating a feature-LIST container as `feature` would erase the tenant's whole list.
   * See the `SLOT_NAME_TRANSLATION` doc block in `core/annotate-slots.ts`.
   *
   * If a detection-side producer for individual feature slots is ever added, THIS test is
   * the one that must change — deliberately, with the mapping.
   */
  it('features_list is annotated verbatim and a `feature` directive skips (documented)', () => {
    document.body.innerHTML = `
      <ul class="features"><li>Pool</li><li>Gym</li></ul>
    `;

    annotateSlots({ features_list: '.features' });

    const list = document.querySelector('.features')!;
    expect(list.getAttribute('data-estalara-slot')).toBe('features_list');
    expect(document.querySelectorAll('[data-estalara-slot="feature"]').length).toBe(0);

    const featureDirective: TextDirective = {
      type: 'text',
      slot: 'feature',
      value: 'Investment Performance',
      archetype: 'yield_hunter',
      confidence: 0.9,
    };
    applyDirectives([featureDirective], CONTEXT);

    // The tenant's feature list is left intact — the skip is fail-safe, not destructive.
    expect(list.textContent).toBe('PoolGym');
    const skips = events.filter(
      (e) => e.type === 'adapt.skipped' && e.payload.slot_or_selector === 'feature',
    );
    expect(skips).toHaveLength(1);
    expect(skips[0]!.payload.reason).toBe('no_slot_elements');
  });
});

// ─── AC-6: hand-coded markup wins (the live pilot's masking condition) ────────

describe('FOLLOW-796 AC-6 — hand-coded slot markup is never overwritten', () => {
  it('an existing data-estalara-slot="cta" survives a cta_primary annotation', () => {
    // This is app.estalara.com's shape: the CTA already carries the attribute by hand, so
    // the pilot never exhibited the namespace bug and cannot be cited as evidence of a fix.
    document.body.innerHTML = `<a class="btn-book" data-estalara-slot="cta" href="#">Book</a>`;

    const count = annotateSlots({ cta_primary: '.btn-book' });

    expect(count).toBe(0);
    expect(document.querySelector('.btn-book')?.getAttribute('data-estalara-slot')).toBe('cta');
  });

  it('an existing UNRELATED slot attribute is not rewritten to the translated name', () => {
    document.body.innerHTML = `<a class="btn-book" data-estalara-slot="custom_slot" href="#">B</a>`;

    const count = annotateSlots({ cta_primary: '.btn-book' });

    expect(count).toBe(0);
    expect(document.querySelector('.btn-book')?.getAttribute('data-estalara-slot')).toBe(
      'custom_slot',
    );
  });
});
