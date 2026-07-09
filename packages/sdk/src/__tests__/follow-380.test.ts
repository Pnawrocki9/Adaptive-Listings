// @vitest-environment jsdom
/**
 * FOLLOW-380 — Harden cross-listing re-adaptation (ADR-0014 / RETRO-105).
 *
 * ONE consolidated suite (per the FOLLOW-380 brief cross_ref note): it covers BOTH
 * FOLLOW-375's five deferred test items AND FOLLOW-380's three new hardening tests. There is
 * intentionally NO separate FOLLOW-375 test file — this retires FOLLOW-375's lingering
 * FOLLOW_UPS.md test-debt (FOLLOW-375 itself stays DONE).
 *
 * cross_ref items (FOLLOW-375 deferred + FOLLOW-380 AC bullet 5):
 *   (a) observer.ts navMutObs emits `listing.viewed` on in-place `data-estalara-listing-id`
 *       attribute mutation (SPA same-node navigation).
 *   (b) refreshDirectives restores the SoT archetype on neutral-decay and updates it on a
 *       non-neutral resolution.
 *   (c) eraseIntentState clears `estalara_resolved_archetype_*` alongside the intent-state key.
 *   (d) intent.ts quiz-stickiness (the `quizAnswered` hysteresis interaction) — the
 *       quiz vs quiz-disabled asymmetry documented in ADR-0014 / index.ts.
 *   (e) adapt.ts empty-value skip (`reason: 'empty_value'`, the defensive never-blank guard).
 *
 * New hardening tests (FOLLOW-380's own bugs):
 *   (H-a) in-flight guard: two overlapping refreshDirectives on rapid SPA nav — LAST nav wins,
 *         a stale in-flight call whose fetch arrives last cannot clobber the newer navigation.
 *   (H-b) per-listing headline restore: navigating to a different, non-fitting listing shows
 *         THAT listing's own original title, never the previous listing's.
 *   (H-c) SoT restore re-pins confidence (not only archetype), so the FOLLOW-343 DOM floor does
 *         not silently suppress the restored adaptation.
 *
 * Test strategy: the index.ts integration tests use the `_initForTest()` seam (Rule Q) to drive
 * the REAL init() body — the in-flight guard, per-listing headline capture, and SoT confidence
 * re-pin all live inside init()/refreshDirectives(), so a regression there turns these RED.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initForTest, DOM_ADAPT_CONFIDENCE_FLOOR } from '../index.js';

import {
  classifyFromProbabilities,
  initIntentState,
  type Archetype,
  type ArchetypeProbabilities,
} from '../core/intent.js';
import { applyDirectives, resetAdaptState, setEventQueueRef } from '../core/adapt.js';
import { setupObservers } from '../core/observer.js';
import {
  persistIntentState,
  persistResolvedArchetype,
  readResolvedArchetype,
  eraseIntentState,
} from '../core/session.js';
import type { CollectedEvent } from '../core/events.js';
import type { SdkConfig } from '../core/config.js';
import type { TextDirective } from '@estalara/shared';

// ---------------------------------------------------------------------------
// Shared fixtures / helpers
// ---------------------------------------------------------------------------

/** Pre-seeded session ID — bypasses fingerprint generation in getOrCreateSession(). */
const SESSION_ID = 'f'.repeat(64);

/** data-estalara-slot name used by the headline fixtures. MUST be the literal `headline` — the
 *  SDK's per-listing capture/restore (index.ts) is hardcoded to `[data-estalara-slot="headline"]`,
 *  so a different name would leave the restore path un-exercised (a vacuous test). */
const HL_SLOT = 'headline';

/** Minimal valid AdaptResponse superset matching the SDK's Zod schema. The directive archetype
 *  is left as a plain string here because the response is serialised to JSON and re-parsed by
 *  the SDK's own Zod schema — this stub type only needs to be structurally serialisable. */
interface StubAdaptResponse {
  adapt_decision_id: string;
  session_id: string;
  archetype: string;
  confidence: number;
  similarity: number;
  tier: 1;
  source: 'playbook';
  generated_at: string;
  directives: {
    type: 'text';
    slot: string;
    value: string;
    archetype: string;
    confidence: number;
  }[];
  ttl_seconds: number;
  variant: string;
}

function makeAdaptResponse(
  archetype: string,
  headlineValue: string,
  confidence: number,
): StubAdaptResponse {
  return {
    adapt_decision_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    session_id: SESSION_ID,
    archetype,
    confidence,
    similarity: 0.9,
    tier: 1,
    source: 'playbook',
    generated_at: '2026-07-10T00:00:00.000Z',
    directives: [
      {
        type: 'text',
        slot: HL_SLOT,
        value: headlineValue,
        archetype,
        confidence,
      },
    ],
    ttl_seconds: 300,
    variant: 'control',
  };
}

function okJson(body: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** Drain microtasks (MutationObserver callbacks, awaited fetches) then one macrotask. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
}

function insertScriptTag(): void {
  const script = document.createElement('script');
  script.dataset.apiKey = 'test-follow380-key';
  script.dataset.decisionUrl = 'https://decision.estalara.com/api';
  script.dataset.tenantId = 'follow380-tenant-id';
  document.head.appendChild(script);
}

/** Insert a listing root + headline slot. Returns both elements. */
function insertListingDom(
  listingId: string,
  headlineText: string,
): { listingEl: HTMLElement; headlineEl: HTMLElement } {
  const listingEl = document.createElement('div');
  listingEl.setAttribute('data-estalara-listing', '');
  listingEl.setAttribute('data-estalara-listing-id', listingId);
  document.body.appendChild(listingEl);

  const headlineEl = document.createElement('h2');
  headlineEl.setAttribute('data-estalara-slot', HL_SLOT);
  headlineEl.textContent = headlineText;
  document.body.appendChild(headlineEl);

  return { listingEl, headlineEl };
}

function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  document.querySelectorAll('script[data-api-key]').forEach((el) => {
    el.remove();
  });
  document
    .querySelectorAll('[data-estalara-host], [data-estalara-listing], [data-estalara-slot]')
    .forEach((el) => {
      el.remove();
    });
}

/**
 * jsdom has no IntersectionObserver, and the SDK's listing observer block — which creates the
 * `navMutObs` MutationObserver this suite drives — is gated on
 * `typeof IntersectionObserver !== 'undefined'` (observer.ts:449). Stub a no-op IO so the block
 * (and thus navMutObs) is installed. We drive `listing.viewed` via real attribute mutations, so
 * the IO callback itself is never invoked here.
 */
class MockIntersectionObserver {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

beforeEach(() => {
  clearAll();
  vi.restoreAllMocks();
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  const teardown = (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  if (teardown) {
    teardown();
    delete (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  }
  clearAll();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ===========================================================================
// cross_ref (a) — observer emits listing.viewed on in-place attribute mutation
// ===========================================================================

describe('cross_ref (a) — navMutObs emits listing.viewed on in-place data-estalara-listing-id change', () => {
  const OBS_CONFIG: SdkConfig = {
    apiKey: 'k',
    ingestUrl: 'https://ingest.estalara.com/v1/events',
    tier: 'observer',
    debug: false,
    consentState: 'legitimate_interest',
    language: 'en',
    accentColor: '#000000',
  };

  it('fires listing.viewed carrying the NEW listing_id when the attribute mutates in place', async () => {
    const { listingEl } = insertListingDom('listing-A', 'A title');
    const events: CollectedEvent[] = [];
    const cleanup = setupObservers(OBS_CONFIG, (e) => events.push(e));

    // SvelteKit same-node navigation: reuse the node, update the id attribute in place.
    listingEl.setAttribute('data-estalara-listing-id', 'listing-B');
    await flush();

    const viewed = events.filter((e) => e.type === 'listing.viewed');
    expect(viewed.length).toBeGreaterThanOrEqual(1);
    const last = viewed.at(-1);
    expect(last?.payload.listing_id).toBe('listing-B');

    cleanup();
  });
});

// ===========================================================================
// cross_ref (c) — eraseIntentState clears the resolved-archetype key too
// ===========================================================================

describe('cross_ref (c) — eraseIntentState clears estalara_resolved_archetype_* alongside intent state', () => {
  it('removes BOTH the intent-state key and the SoT resolved-archetype key', () => {
    persistIntentState(SESSION_ID, initIntentState());
    persistResolvedArchetype(SESSION_ID, 'family_buyer', 0.85);
    expect(readResolvedArchetype(SESSION_ID)).not.toBeNull();

    eraseIntentState(SESSION_ID);

    expect(readResolvedArchetype(SESSION_ID)).toBeNull();
    expect(sessionStorage.getItem(`estalara_resolved_archetype_${SESSION_ID}`)).toBeNull();
  });

  it('is a no-op when sessionId is undefined (pre-session denial path)', () => {
    expect(() => {
      eraseIntentState(undefined);
    }).not.toThrow();
  });
});

// ===========================================================================
// cross_ref (d) — intent.ts quiz-stickiness (quiz vs quiz-disabled asymmetry)
// ===========================================================================

describe('cross_ref (d) — quiz-stickiness: quizAnswered holds a non-neutral archetype against neutral drift', () => {
  /** Probabilities where `neutral` is the clear argmax (gap ≫ SWITCH_MARGIN). */
  function neutralLeadingProbs(): ArchetypeProbabilities {
    const probs = { ...initIntentState().probabilities };
    (Object.keys(probs) as Archetype[]).forEach((k) => {
      probs[k] = 0.05;
    });
    probs.neutral = 0.6;
    probs.family_buyer = 0.2;
    return probs;
  }

  it('QUIZ tenant (quizAnswered=true): neutral does NOT unseat the resolved non-neutral archetype', () => {
    const { archetype } = classifyFromProbabilities(neutralLeadingProbs(), 'family_buyer', true);
    expect(archetype).toBe('family_buyer');
  });

  it('QUIZ-DISABLED tenant (quizAnswered=false): archetype freely decays to neutral (weaker guarantee — restore is the only guard)', () => {
    const { archetype } = classifyFromProbabilities(neutralLeadingProbs(), 'family_buyer', false);
    expect(archetype).toBe('neutral');
  });
});

// ===========================================================================
// cross_ref (e) — adapt.ts empty-value skip (never blank a slot)
// ===========================================================================

describe('cross_ref (e) — applyTextDirective skips an empty value and leaves the original copy', () => {
  it('emits adapt.skipped(empty_value) and does NOT blank the slot', () => {
    const queue: CollectedEvent[] = [];
    setEventQueueRef(queue);
    resetAdaptState();

    const el = document.createElement('h2');
    el.setAttribute('data-estalara-slot', HL_SLOT);
    el.textContent = 'Original copy';
    document.body.appendChild(el);

    const directive: TextDirective = {
      type: 'text',
      slot: HL_SLOT,
      value: '   ', // whitespace-only ⇒ archetype-fit "no adaptation" signal
      archetype: 'yield_hunter',
      confidence: 0.9,
    };

    applyDirectives([directive], {
      archetypeId: 'yield_hunter',
      confidence: 0.9,
      sessionId: SESSION_ID,
    });

    expect(el.textContent).toBe('Original copy');
    const skipped = queue.filter(
      (e) => e.type === 'adapt.skipped' && e.payload.reason === 'empty_value',
    );
    expect(skipped.length).toBe(1);
  });
});

// ===========================================================================
// cross_ref (b) + hardening (c) — SoT restore re-pins archetype AND confidence
// ===========================================================================

describe('cross_ref (b) + hardening (c) — SoT restore re-pins archetype + confidence past the DOM floor', () => {
  /** Stub fetch: /adapt echoes the request confidence into resp.confidence (like the real
   *  route) and returns a headline directive; everything else 200 {}. */
  function stubEchoFetch(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (
          typeof url === 'string' &&
          url.includes('/adapt') &&
          !url.includes('/adapt/description')
        ) {
          const rawBody = typeof init?.body === 'string' ? init.body : '{}';
          const body = JSON.parse(rawBody) as Record<string, unknown>;
          const archetype =
            typeof body.archetype_hint === 'string' ? body.archetype_hint : 'neutral';
          const confidence = typeof body.confidence === 'number' ? body.confidence : 0;
          // Echo request confidence (real route behaviour) — this is what makes bug (c) visible:
          // if the restore leaves neutral-era low confidence, resp.confidence stays below the floor.
          return Promise.resolve(
            okJson(makeAdaptResponse(archetype, 'RESTORED ADAPT', confidence)),
          );
        }
        return Promise.resolve(okJson({}));
      }),
    );
  }

  it('re-pins confidence so a decayed-to-neutral session still adapts via the restored SoT archetype', async () => {
    // Live state decayed to neutral with LOW confidence + LOW signal_count (below both floor gates).
    const decayed = {
      ...initIntentState(),
      archetype: 'neutral' as Archetype,
      confidence: 0.1,
      signal_count: 0,
    };
    persistIntentState(SESSION_ID, decayed);
    // SoT was resolved at high confidence earlier this session.
    persistResolvedArchetype(SESSION_ID, 'yield_hunter', 0.85);

    const { headlineEl } = insertListingDom('L-restore', 'Original restore title');
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    stubEchoFetch();

    await _initForTest();
    await flush();

    // With the confidence re-pin, body.confidence = 0.85 → resp.confidence 0.85 ≥ floor → adapts.
    // Without it, body.confidence stays 0.1 (< 0.5 floor, signal_count 0 < 2) → suppressed.
    expect(0.85).toBeGreaterThanOrEqual(DOM_ADAPT_CONFIDENCE_FLOOR);
    expect(headlineEl.textContent).toBe('RESTORED ADAPT');
  });

  it('updates the SoT to the current non-neutral archetype after a resolution (persist half)', async () => {
    // Non-neutral live state, no SoT yet — the post-fetch persist should seed it.
    const live = {
      ...initIntentState(),
      archetype: 'family_buyer' as Archetype,
      confidence: 0.8,
      signal_count: 3,
    };
    persistIntentState(SESSION_ID, live);

    insertListingDom('L-update', 'Original update title');
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    stubEchoFetch();

    await _initForTest();
    await flush();

    const sot = readResolvedArchetype(SESSION_ID);
    expect(sot).not.toBeNull();
    expect(sot?.archetype).toBe('family_buyer');
    // Confidence persisted alongside the archetype (bug (c) storage shape).
    expect(typeof sot?.confidence).toBe('number');
  });
});

// ===========================================================================
// hardening (b) — per-listing headline restore
// ===========================================================================

describe('hardening (b) — cross-listing navigation restores THIS listing’s own original headline', () => {
  function stubAdaptFor(fitListingId: string): void {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (
          typeof url === 'string' &&
          url.includes('/adapt') &&
          !url.includes('/adapt/description')
        ) {
          const rawBody = typeof init?.body === 'string' ? init.body : '{}';
          const body = JSON.parse(rawBody) as Record<string, unknown>;
          const listingId = typeof body.listing_id === 'string' ? body.listing_id : '';
          if (listingId === fitListingId) {
            return Promise.resolve(okJson(makeAdaptResponse('yield_hunter', 'ADAPTED L1', 0.8)));
          }
          // Non-fitting listing: the archetype-fit gate (ADR-0010) returns an empty directive
          // value ⇒ applyTextDirective skips it (empty_value) and leaves the original copy.
          return Promise.resolve(okJson(makeAdaptResponse('neutral', '', 0.3)));
        }
        return Promise.resolve(okJson({}));
      }),
    );
  }

  it('shows listing-2’s own title on a non-fitting listing, never listing-1’s title or adapted copy', async () => {
    const { listingEl, headlineEl } = insertListingDom('L1', 'Listing 1 Title');
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();
    stubAdaptFor('L1'); // only L1 fits

    await _initForTest();
    await flush();
    expect(headlineEl.textContent).toBe('ADAPTED L1'); // L1 adapted

    // SPA navigation to a DIFFERENT listing with its OWN title (framework re-render), non-fitting.
    headlineEl.textContent = 'Listing 2 Title';
    listingEl.setAttribute('data-estalara-listing-id', 'L2');
    await flush();

    // Per-listing capture+restore: L2 shows its own original title — not the global L1 title,
    // and not L1's adapted copy left on the reused DOM node.
    expect(headlineEl.textContent).toBe('Listing 2 Title');
  });
});

// ===========================================================================
// hardening (a) — in-flight guard: last navigation wins
// ===========================================================================

describe('hardening (a) — overlapping refreshDirectives: the LAST navigation always wins', () => {
  interface Deferred {
    listingId: string;
    resolve: (r: unknown) => void;
  }

  it('a stale in-flight refresh whose fetch resolves LAST cannot clobber the newer navigation', async () => {
    let pending: Deferred[] = [];
    const release = (listingId: string, response: unknown): void => {
      const matches = pending.filter((d) => d.listingId === listingId);
      pending = pending.filter((d) => d.listingId !== listingId);
      matches.forEach((d) => {
        d.resolve(response);
      });
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (
          typeof url === 'string' &&
          url.includes('/adapt') &&
          !url.includes('/adapt/description')
        ) {
          const rawBody = typeof init?.body === 'string' ? init.body : '{}';
          const body = JSON.parse(rawBody) as Record<string, unknown>;
          const listingId = typeof body.listing_id === 'string' ? body.listing_id : '';
          if (listingId === 'L1') {
            // init fetch — resolve immediately so _initForTest() completes.
            return Promise.resolve(okJson(makeAdaptResponse('yield_hunter', 'ADAPTED_L1', 0.8)));
          }
          // L2 / L3 navigations — defer so we control resolution order.
          return new Promise((resolve) => {
            pending.push({
              listingId,
              resolve: (r) => {
                resolve(okJson(r));
              },
            });
          });
        }
        return Promise.resolve(okJson({}));
      }),
    );

    const { listingEl, headlineEl } = insertListingDom('L1', 'Listing 1 Title');
    seedSession();
    localStorage.setItem('estalara_consent', 'granted');
    insertScriptTag();

    await _initForTest();
    await flush();
    expect(headlineEl.textContent).toBe('ADAPTED_L1');

    // Rapid SPA nav: L1 → L2, then L2 → L3, one microtask apart so each parks a refresh.
    listingEl.setAttribute('data-estalara-listing-id', 'L2');
    await flush();
    listingEl.setAttribute('data-estalara-listing-id', 'L3');
    await flush();

    expect(pending.map((d) => d.listingId).sort()).toEqual(['L2', 'L3']);

    // Resolve the LATEST navigation (L3) FIRST, then the STALE one (L2) LAST.
    release('L3', makeAdaptResponse('family_buyer', 'ADAPTED_L3', 0.8));
    await flush();
    release('L2', makeAdaptResponse('yield_hunter', 'ADAPTED_L2', 0.8));
    await flush();

    // The stale L2 result arrived last but must NOT win — the guard discards it.
    expect(headlineEl.textContent).toBe('ADAPTED_L3');
  });
});
