// @vitest-environment jsdom
/**
 * FOLLOW-796 integration — the slot-name translation on the REAL init path.
 *
 * Drives `_initForTest()` (the real `init()` body, Rule Q seam) with a stubbed `/api/adapt`
 * response, exactly as a genuinely un-instrumented tenant would be served: the response
 * carries `slot_selectors` keyed in the DETECTION vocabulary (`cta_primary`) while the
 * playbook directive it also carries is keyed in the ADAPTATION vocabulary (`cta`).
 *
 * This is the NON-COINCIDING pair RETRO-093 §4b CB-1 asked for. The pre-existing
 * `follow-340-integration.test.ts` only ever used self-agreeing pairs
 * (`headline`/`headline`, `description`/`description`), which is why the defect shipped.
 *
 * Before the fix: the anchor is annotated `data-estalara-slot="cta_primary"`, the `cta`
 * directive finds nothing and emits `adapt.skipped {no_slot_elements}` — the anchor text
 * stays "Book a viewing".
 * After the fix: the anchor is annotated `cta` and the directive lands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _initForTest } from '../index.js';

const SESSION_ID = 'a'.repeat(64);

const BASE_RESPONSE = {
  adapt_decision_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  session_id: SESSION_ID,
  archetype: 'yield_hunter',
  confidence: 0.92,
  similarity: 0.9,
  page_context: 1 as const,
  source: 'playbook' as const,
  generated_at: '2026-08-03T00:00:00.000Z',
  variant: 'control',
  directives: [] as {
    type: 'text';
    slot: string;
    value: string;
    archetype: string;
    confidence: number;
  }[],
};

function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
}

function insertScriptTag(tenantId = 'follow796-tenant'): HTMLScriptElement {
  const script = document.createElement('script');
  script.dataset.apiKey = 'test-follow796-api-key';
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

/** Stub fetch: `/adapt` returns the fixture; everything else a harmless 200. */
function stubFetch(adaptResponse: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/adapt/description')) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      }
      if (typeof url === 'string' && url.includes('/adapt')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(adaptResponse),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ quiz_enabled: false, micro_polls_enabled: false }),
      });
    }),
  );
}

describe('FOLLOW-796 — non-coinciding slot pair on the real init path', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearAll();
    seedSession();
    // Consent gate: key is CONSENT_STORAGE_KEY in packages/sdk/src/core/session.ts.
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

  it('AC-2: slot_selectors {cta_primary} + directive {slot:"cta"} → CTA text adapts', async () => {
    const cta = document.createElement('a');
    cta.className = 'btn-book-viewing';
    cta.href = '#';
    cta.textContent = 'Book a viewing';
    document.body.appendChild(cta);

    const adaptResponse = {
      ...BASE_RESPONSE,
      // Detection vocabulary (what every auto-detect technique + the curated schema emit).
      slot_selectors: { cta_primary: '.btn-book-viewing' },
      directives: [
        {
          // Adaptation vocabulary (what every playbook emits).
          type: 'text' as const,
          slot: 'cta',
          value: 'Request Investment Pack',
          archetype: 'yield_hunter',
          confidence: 0.92,
        },
      ],
    };

    insertScriptTag();
    stubFetch(adaptResponse);

    await _initForTest();

    expect(cta.getAttribute('data-estalara-slot')).toBe('cta');
    expect(cta.textContent).toBe('Request Investment Pack');
  });

  it('AC-1: headline keeps working alongside the translated CTA (no regression)', async () => {
    const headline = document.createElement('h1');
    headline.className = 'listing-headline';
    headline.textContent = 'Original headline';
    document.body.appendChild(headline);

    const cta = document.createElement('a');
    cta.className = 'btn-book-viewing';
    cta.href = '#';
    cta.textContent = 'Book a viewing';
    document.body.appendChild(cta);

    const adaptResponse = {
      ...BASE_RESPONSE,
      slot_selectors: { headline: '.listing-headline', cta_primary: '.btn-book-viewing' },
      directives: [
        {
          type: 'text' as const,
          slot: 'headline',
          value: 'Adapted for yield hunter',
          archetype: 'yield_hunter',
          confidence: 0.92,
        },
        {
          type: 'text' as const,
          slot: 'cta',
          value: 'Request Investment Pack',
          archetype: 'yield_hunter',
          confidence: 0.92,
        },
      ],
    };

    insertScriptTag();
    stubFetch(adaptResponse);

    await _initForTest();

    expect(headline.getAttribute('data-estalara-slot')).toBe('headline');
    expect(headline.textContent).toBe('Adapted for yield hunter');
    expect(cta.getAttribute('data-estalara-slot')).toBe('cta');
    expect(cta.textContent).toBe('Request Investment Pack');
  });

  it('AC-3: a `feature` directive stays unreachable and leaves the list intact', async () => {
    // Documented out-of-scope behaviour (see SLOT_NAME_TRANSLATION in core/annotate-slots.ts):
    // `features_list` has no production producer and a `feature` TextDirective would
    // overwrite the whole container's textContent. This asserts the CURRENT contract.
    const list = document.createElement('ul');
    list.className = 'listing-features';
    list.innerHTML = '<li>Pool</li><li>Gym</li>';
    document.body.appendChild(list);

    const adaptResponse = {
      ...BASE_RESPONSE,
      slot_selectors: { features_list: '.listing-features' },
      directives: [
        {
          type: 'text' as const,
          slot: 'feature',
          value: 'Investment Performance',
          archetype: 'yield_hunter',
          confidence: 0.92,
        },
      ],
    };

    insertScriptTag();
    stubFetch(adaptResponse);

    await _initForTest();

    expect(list.getAttribute('data-estalara-slot')).toBe('features_list');
    expect(list.textContent).toBe('PoolGym');
  });

  it('AC-6: hand-coded data-estalara-slot="cta" (the pilot shape) is left untouched', async () => {
    const cta = document.createElement('a');
    cta.className = 'btn-book-viewing';
    cta.href = '#';
    cta.setAttribute('data-estalara-slot', 'cta');
    cta.textContent = 'Book a viewing';
    document.body.appendChild(cta);

    const adaptResponse = {
      ...BASE_RESPONSE,
      slot_selectors: { cta_primary: '.btn-book-viewing' },
      directives: [
        {
          type: 'text' as const,
          slot: 'cta',
          value: 'Request Investment Pack',
          archetype: 'yield_hunter',
          confidence: 0.92,
        },
      ],
    };

    insertScriptTag();
    stubFetch(adaptResponse);

    await _initForTest();

    // Attribute unchanged (idempotent), directive lands via the hand-coded markup — this is
    // why the live pilot never exhibited the bug and proves nothing about the fix.
    expect(cta.getAttribute('data-estalara-slot')).toBe('cta');
    expect(cta.textContent).toBe('Request Investment Pack');
  });
});
