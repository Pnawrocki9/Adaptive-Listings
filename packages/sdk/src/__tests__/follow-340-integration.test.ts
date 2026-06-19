// @vitest-environment jsdom
/**
 * Integration test: FOLLOW-340 — SDK runtime slot self-annotation wired end-to-end.
 *
 * Problem:
 *   Pages without hand-coded `data-estalara-slot` attributes cause every directive
 *   to emit `adapt.skipped` because `applyDirectives()` queries
 *   `[data-estalara-slot="<name>"]` on the host DOM.
 *
 * Fix:
 *   When `/api/adapt` returns `slot_selectors`, the SDK calls `annotateSlots()` BEFORE
 *   `applyDirectives()`, so the CSS-selector-matched nodes receive
 *   `data-estalara-slot="<name>"` and directives can find them.
 *
 * Tests:
 *   AC-1 (wired path): adapt response with slot_selectors → CSS nodes annotated →
 *         applyDirectives mutations visible (textContent changed).
 *   AC-2 (idempotent wired path): pre-annotated nodes are not overwritten.
 *   AC-3 (absent slot_selectors): adapt response without slot_selectors is harmless.
 *
 * Test strategy:
 *   Uses `_initForTest()` seam (Rule Q) to drive the REAL `init()` body.
 *   Stubs `fetch` to return a controlled adapt response.
 *   Inspects the live DOM after init() to assert annotation and text mutation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _initForTest } from '../index.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSION_ID = 'f'.repeat(64);

const BASE_RESPONSE = {
  adapt_decision_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  session_id: SESSION_ID,
  archetype: 'yield_hunter',
  confidence: 0.92,
  similarity: 0.9,
  tier: 1 as const,
  source: 'playbook' as const,
  generated_at: '2026-06-19T00:00:00.000Z',
  variant: 'control',
  directives: [] as {
    type: 'text';
    slot: string;
    value: string;
    archetype: string;
    confidence: number;
  }[],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
}

function insertScriptTag(tenantId = 'follow340-tenant'): HTMLScriptElement {
  const script = document.createElement('script');
  script.dataset.apiKey = 'test-follow340-api-key';
  script.dataset.decisionUrl = 'https://api.example.com/api';
  script.dataset.tenantId = tenantId;
  document.head.appendChild(script);
  return script;
}

function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  document.querySelectorAll<HTMLScriptElement>('script[data-api-key]').forEach((el) => {
    el.remove();
  });
  document.querySelectorAll('[data-estalara-host]').forEach((el) => {
    el.remove();
  });
  document.body.innerHTML = '';
}

/**
 * Stub fetch to return a controlled adapt response.
 * Quiz/weights/ingest URLs return minimal OK responses.
 */
function stubFetch(adaptResponse: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/adapt/description')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({}),
        });
      }
      if (typeof url === 'string' && url.includes('/adapt')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(adaptResponse),
        });
      }
      // quiz/config, intent/config, ingest — harmless 200
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ quiz_enabled: false, micro_polls_enabled: false }),
      });
    }),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FOLLOW-340 — SDK runtime slot self-annotation (integration)', () => {
  beforeEach(() => {
    // Restore any mocks from prior tests before clearing state to prevent
    // stale fetch stubs leaking from prior test suites (full-suite isolation).
    vi.restoreAllMocks();
    clearAll();
    seedSession();
    // Grant consent so init() proceeds past the consent gate.
    // Key is 'estalara_consent' per packages/sdk/src/core/session.ts:CONSENT_STORAGE_KEY.
    localStorage.setItem('estalara_consent', 'granted');
  });

  afterEach(() => {
    if (typeof window !== 'undefined') {
      (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown?.();
      delete (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
    }
    vi.restoreAllMocks();
    clearAll();
  });

  it('AC-1: annotates via CSS selector then applyDirectives mutates text', async () => {
    // Insert a DOM node that has NO data-estalara-slot — only a CSS class
    const node = document.createElement('h1');
    node.className = 'listing-headline';
    node.textContent = 'Original headline';
    document.body.appendChild(node);

    // Adapt response with slot_selectors AND a matching text directive
    const adaptResponse = {
      ...BASE_RESPONSE,
      slot_selectors: { headline: '.listing-headline' },
      directives: [
        {
          type: 'text' as const,
          slot: 'headline',
          value: 'Adapted for yield hunter',
          archetype: 'yield_hunter',
          confidence: 0.92,
        },
      ],
    };

    insertScriptTag();
    stubFetch(adaptResponse);

    await _initForTest();

    // The node should now carry data-estalara-slot AND have adapted text
    expect(node.getAttribute('data-estalara-slot')).toBe('headline');
    expect(node.textContent).toBe('Adapted for yield hunter');
  });

  it('AC-2: idempotent — pre-annotated slot attribute is not overwritten', async () => {
    // Node already has data-estalara-slot set to "custom_slot"
    const node = document.createElement('h2');
    node.className = 'listing-headline';
    node.setAttribute('data-estalara-slot', 'custom_slot');
    node.textContent = 'Pre-annotated original';
    document.body.appendChild(node);

    // Also insert a separate node without annotation that SHOULD be annotated
    const desc = document.createElement('p');
    desc.className = 'listing-desc';
    desc.textContent = 'Description original';
    document.body.appendChild(desc);

    const adaptResponse = {
      ...BASE_RESPONSE,
      slot_selectors: {
        headline: '.listing-headline', // matches pre-annotated node → must skip
        description: '.listing-desc', // matches unannotated node → must annotate
      },
      directives: [
        {
          type: 'text' as const,
          slot: 'description',
          value: 'Adapted description',
          archetype: 'yield_hunter',
          confidence: 0.92,
        },
      ],
    };

    insertScriptTag();
    stubFetch(adaptResponse);

    await _initForTest();

    // Pre-annotated node: attribute must remain "custom_slot" (not overwritten to "headline")
    expect(node.getAttribute('data-estalara-slot')).toBe('custom_slot');
    // Description node: must be annotated + text adapted
    expect(desc.getAttribute('data-estalara-slot')).toBe('description');
    expect(desc.textContent).toBe('Adapted description');
  });

  it('AC-3: adapt response without slot_selectors is harmless', async () => {
    const node = document.createElement('h1');
    node.className = 'listing-headline';
    node.textContent = 'Unchanged headline';
    document.body.appendChild(node);

    // No slot_selectors — no annotation should happen
    const adaptResponse = {
      ...BASE_RESPONSE,
      directives: [],
    };

    insertScriptTag();
    stubFetch(adaptResponse);

    await _initForTest();

    expect(node.hasAttribute('data-estalara-slot')).toBe(false);
    expect(node.textContent).toBe('Unchanged headline');
  });
});
