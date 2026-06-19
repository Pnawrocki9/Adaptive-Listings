// @vitest-environment jsdom
/**
 * Unit tests for annotateSlots() — FOLLOW-340 runtime slot self-annotation.
 *
 * Verifies:
 *   AC-1: SDK reads resolved slot_selectors and annotates matching nodes
 *   AC-2: Annotation is idempotent (no overwrite if attribute already present)
 *   AC-3: Never throws onto the host page
 *   AC-4: Returns 0 when slotSelectors is absent/null/undefined
 *   AC-5: Skips empty slotName or empty cssSelector entries
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { annotateSlots } from '../core/annotate-slots.js';

describe('annotateSlots (FOLLOW-340)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('annotates matched nodes with data-estalara-slot', () => {
    document.body.innerHTML = `
      <h1 class="listing-title">Great Property</h1>
      <p class="listing-desc">A beautiful home</p>
    `;

    const count = annotateSlots({
      headline: '.listing-title',
      description: '.listing-desc',
    });

    expect(count).toBe(2);
    const h1 = document.querySelector('h1');
    const p = document.querySelector('p');
    expect(h1?.getAttribute('data-estalara-slot')).toBe('headline');
    expect(p?.getAttribute('data-estalara-slot')).toBe('description');
  });

  it('is idempotent: skips nodes that already carry data-estalara-slot', () => {
    document.body.innerHTML = `
      <h1 class="listing-title" data-estalara-slot="headline">Already annotated</h1>
      <p class="listing-desc">Not yet annotated</p>
    `;

    const count = annotateSlots({
      headline: '.listing-title',
      description: '.listing-desc',
    });

    // headline was already annotated — only description should be newly annotated
    expect(count).toBe(1);
    const h1 = document.querySelector('h1');
    // Pre-existing attribute must remain unchanged
    expect(h1?.getAttribute('data-estalara-slot')).toBe('headline');
    const p = document.querySelector('p');
    expect(p?.getAttribute('data-estalara-slot')).toBe('description');
  });

  it('calling twice is idempotent — second call annotates 0 nodes', () => {
    document.body.innerHTML = `<h1 class="title">Title</h1>`;
    const selectors = { headline: '.title' };

    const first = annotateSlots(selectors);
    const second = annotateSlots(selectors);

    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it('returns 0 when slotSelectors is undefined', () => {
    document.body.innerHTML = '<h1>Title</h1>';
    expect(annotateSlots(undefined)).toBe(0);
    expect(annotateSlots(null)).toBe(0);
  });

  it('returns 0 when slotSelectors is empty', () => {
    document.body.innerHTML = '<h1>Title</h1>';
    expect(annotateSlots({})).toBe(0);
  });

  it('does not throw when CSS selector matches nothing', () => {
    document.body.innerHTML = '<h1>Title</h1>';
    // no-match is not an error — should silently return 0
    expect(() => annotateSlots({ headline: '.does-not-exist' })).not.toThrow();
    expect(annotateSlots({ headline: '.does-not-exist' })).toBe(0);
  });

  it('does not throw on an invalid CSS selector (logs warn and continues)', () => {
    document.body.innerHTML = '<h1>Title</h1>';
    // jsdom throws on invalid selectors — annotateSlots must catch it
    expect(() => annotateSlots({ headline: '###invalid###' })).not.toThrow();
    expect(annotateSlots({ headline: '###invalid###' })).toBe(0);
  });

  it('skips entries with empty slotName or empty cssSelector', () => {
    document.body.innerHTML = '<h1 class="t">T</h1>';
    // empty slotName entry
    const count = annotateSlots({ '': '.t', headline: '' });
    expect(count).toBe(0);
    expect(document.querySelector('h1')?.hasAttribute('data-estalara-slot')).toBe(false);
  });

  it('annotates multiple elements matched by the same selector', () => {
    document.body.innerHTML = `
      <span class="feature">Pool</span>
      <span class="feature">Gym</span>
    `;

    const count = annotateSlots({ features_list: '.feature' });
    expect(count).toBe(2);
    const spans = document.querySelectorAll('[data-estalara-slot="features_list"]');
    expect(spans.length).toBe(2);
  });

  it('respects a custom root element to limit scope', () => {
    document.body.innerHTML = `
      <div id="scope">
        <h1 class="title">Scoped title</h1>
      </div>
      <h1 class="title">Out-of-scope title</h1>
    `;

    const scopeRoot = document.getElementById('scope')!;
    const count = annotateSlots({ headline: '.title' }, scopeRoot);

    expect(count).toBe(1);
    // Only the in-scope h1 should be annotated
    const inScope = scopeRoot.querySelector('[data-estalara-slot="headline"]');
    expect(inScope).not.toBeNull();
    // Out-of-scope h1 must not be annotated
    const allAnnotated = document.querySelectorAll('[data-estalara-slot="headline"]');
    expect(allAnnotated.length).toBe(1);
  });
});
