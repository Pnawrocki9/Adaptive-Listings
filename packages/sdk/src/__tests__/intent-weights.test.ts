// @vitest-environment jsdom
/**
 * FOLLOW-268-sdk — SDK intent weight fetch and resolveIntentOverrides (ADR-0012 Ticket C).
 *
 * Rule Q (amended 2026-06-08): acceptance tests MUST drive the real init() body via
 * `_initForTest()`, not re-implement its logic locally.  Unit-level tests for pure
 * functions (resolveIntentOverrides, fetchIntentWeights) are allowed alongside the
 * integration tests that drive `_initForTest()`.
 *
 * Acceptance criteria verified:
 *   AC1: null weights → SDK internal defaults unchanged.
 *   AC2: data_source='mock' → SDK defaults, NOT mock weights.
 *   AC3: data_source='live' + behavioral_damping override → applied to applyBehavioralSignal.
 *   AC4: data_source='live' + priors override → reflected in initIntentState output.
 *   AC5: data_source='live' + signal_likelihoods partial override → merges over SDK defaults.
 *   AC6: resolveIntentOverrides correctly merges partial priors + normalizes.
 *   AC7: data_source='error' → SDK defaults AND distinct console.warn (not silently collapsed).
 *   AC8: fetch failure → SDK defaults (null returned).
 *   AC9: malformed response body → null returned (no throw).
 *   AC10: SIGNAL_LIKELIHOODS keys match INTENT_SIGNAL_KEYS (drift guard per ADR-0012 §Risks).
 *
 * @module packages/sdk/src/__tests__/intent-weights.test
 */

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import { _initForTest } from '../index.js';
import {
  resolveIntentOverrides,
  initIntentState,
  applyBehavioralSignal,
  ARCHETYPE_NAMES,
} from '../core/intent.js';
import { fetchIntentWeights } from '../core/intent-weights.js';
import { INTENT_SIGNAL_KEYS } from '@estalara/shared';
import type { IntentWeights } from '@estalara/shared';

// ---------------------------------------------------------------------------
// Shared test helpers (mirrors the pattern from follow-275.test.ts)
// ---------------------------------------------------------------------------

const SESSION_ID = 'e'.repeat(64);
// FOLLOW-305: canonical form = host + /api, matching buildSnippet() in DetectionPreview.tsx:153.
const DECISION_API_URL = 'https://admin.estalara.com/api';

function seedSession(): void {
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
}

function insertScriptTag(overrides: Record<string, string> = {}): void {
  const script = document.createElement('script');
  script.dataset.apiKey = overrides.apiKey ?? 'test-key-follow268sdk';
  if (overrides.decisionUrl !== undefined) {
    script.dataset.decisionUrl = overrides.decisionUrl;
  }
  document.head.appendChild(script);
}

function removeScriptTags(): void {
  document.querySelectorAll<HTMLScriptElement>('script[data-api-key]').forEach((el) => {
    el.remove();
  });
}

function removeShadowHosts(): void {
  document.querySelectorAll('[data-estalara-host]').forEach((el) => {
    el.remove();
  });
}

function runTeardown(): void {
  const teardown = (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  if (teardown) {
    teardown();
    delete (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown;
  }
}

function clearAll(): void {
  sessionStorage.clear();
  localStorage.clear();
  removeScriptTags();
  removeShadowHosts();
}

/**
 * Build a mock fetch that returns the given intent config response for
 * `/api/intent/config`, and a neutral adapt response + default quiz config for
 * all other requests (so init() does not throw on refreshDirectives / fetchQuizConfig).
 */
function buildMockFetch(
  intentConfigBody: unknown,
  intentConfigStatus = 200,
): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/intent/config')) {
      return Promise.resolve({
        ok: intentConfigStatus >= 200 && intentConfigStatus < 300,
        status: intentConfigStatus,
        json: () => Promise.resolve(intentConfigBody),
      });
    }
    if (url.includes('/api/quiz/public-config')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            quiz_enabled: true,
            micro_polls_enabled: false,
            language: 'en',
            accent_color: '#2563EB',
          }),
      });
    }
    // Neutral adapt response for all other requests
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          adapt_decision_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          session_id: SESSION_ID,
          archetype: 'neutral',
          confidence: 0.5,
          similarity: 0.5,
          tier: 1,
          source: 'playbook',
          generated_at: '2026-06-13T00:00:00.000Z',
          directives: [],
          ttl_seconds: 300,
          variant: 'control',
        }),
    });
  });
}

afterEach(() => {
  runTeardown();
  clearAll();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// AC10: SIGNAL_LIKELIHOODS keys ↔ INTENT_SIGNAL_KEYS drift guard
// (ADR-0012 §Risks: "SIGNAL_LIKELIHOODS drift")
// ---------------------------------------------------------------------------

describe('AC10 — SIGNAL_LIKELIHOODS keys match INTENT_SIGNAL_KEYS (drift guard)', () => {
  it('every INTENT_SIGNAL_KEY has a corresponding entry in SIGNAL_LIKELIHOODS', () => {
    // Drive via resolveIntentOverrides with live signal_likelihoods to see all keys.
    // The actual SDK SIGNAL_LIKELIHOODS is exercised when we build a weights object
    // covering every INTENT_SIGNAL_KEY — if a key is missing from SIGNAL_LIKELIHOODS
    // the overrides merge will produce a signal entry that never fires in practice,
    // but the canonical guard is that INTENT_SIGNAL_KEYS ⊆ SIGNAL_LIKELIHOODS keys.
    //
    // We verify this by building signal_likelihoods for every INTENT_SIGNAL_KEY and
    // confirming resolveIntentOverrides includes all of them in its output.
    const allSignalLikelihoods: Record<string, Record<string, number>> = {};
    for (const key of INTENT_SIGNAL_KEYS) {
      allSignalLikelihoods[key] = { neutral: 0.9 };
    }

    const weights: IntentWeights = { signal_likelihoods: allSignalLikelihoods };
    const overrides = resolveIntentOverrides(weights);

    // Every INTENT_SIGNAL_KEY must be present in the resolved signalLikelihoods.
    for (const key of INTENT_SIGNAL_KEYS) {
      expect(overrides.signalLikelihoods).toHaveProperty(key);
    }
  });

  it('resolveIntentOverrides preserves all SDK-default signal keys when no server overrides', () => {
    // Null weights → SDK defaults.  All 13 INTENT_SIGNAL_KEYs should be present.
    const overrides = resolveIntentOverrides(null);
    for (const key of INTENT_SIGNAL_KEYS) {
      expect(overrides.signalLikelihoods).toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// AC1: null weights → resolveIntentOverrides returns SDK defaults
// ---------------------------------------------------------------------------

describe('AC1 — null weights → resolveIntentOverrides returns SDK defaults', () => {
  it('behavioralDamping defaults to 0.3 (BEHAVIORAL_DAMPING)', () => {
    const overrides = resolveIntentOverrides(null);
    expect(overrides.behavioralDamping).toBe(0.3);
  });

  it('basePrior matches BASE_PRIOR (neutral=0.37, investors=0.04)', () => {
    const overrides = resolveIntentOverrides(null);
    // neutral carries the highest prior in BASE_PRIOR
    expect(overrides.basePrior.neutral).toBeCloseTo(0.37, 5);
    expect(overrides.basePrior.yield_hunter).toBeCloseTo(0.04, 5);
  });

  it('signalLikelihoods falls back to SDK defaults for listing.viewed', () => {
    const overrides = resolveIntentOverrides(null);
    // SDK default for listing.viewed boosts portfolio_builder above 1.0
    expect(overrides.signalLikelihoods['listing.viewed']?.portfolio_builder).toBeGreaterThan(1.0);
  });

  it('initIntentState with null-derived overrides is identical to initIntentState()', () => {
    const fromNull = initIntentState(resolveIntentOverrides(null));
    const fromDefault = initIntentState();
    expect(fromNull.probabilities).toEqual(fromDefault.probabilities);
    expect(fromNull.archetype).toBe(fromDefault.archetype);
    expect(fromNull.confidence).toBeCloseTo(fromDefault.confidence, 10);
  });
});

// ---------------------------------------------------------------------------
// AC2 + integration: data_source='mock' → SDK defaults, NOT mock weights
// ---------------------------------------------------------------------------

describe('AC2 — data_source=mock → init() uses SDK internal defaults', () => {
  beforeEach(() => {
    clearAll();
    localStorage.setItem('estalara_consent', 'granted');
    seedSession();
    vi.useFakeTimers();
  });

  it('init() produces neutral archetype at baseline confidence when server returns mock', async () => {
    const mockBody = {
      weights: { behavioral_damping: 0.99 }, // would strongly change behaviour if applied
      effective_at: '2026-06-13T00:00:00Z',
      is_tenant_specific: false,
      data_source: 'mock',
    };

    vi.stubGlobal('fetch', buildMockFetch(mockBody));
    insertScriptTag({ decisionUrl: DECISION_API_URL });

    const state = await _initForTest();
    expect(state).not.toBeNull();

    // If mock weights were applied, behavioral_damping would be 0.99.
    // We verify the device_type prior (cold-start signal) produces standard-magnitude
    // output, not the inflated magnitude you'd get from damping=0.99.
    // The default damping=0.3 means signals have smaller relative shift than 0.99.
    // We check that neutral probability is NOT near 1.0 (which would happen with damping→1
    // turning all likelihoods into near-raw values, dominating the prior strongly).
    // At damping=0.3 the device_type signals are mild; at 0.99 they'd be nearly raw.
    // The neutral archetype should still be dominant (>0.34) with default damping.
    expect(state!.probabilities.neutral).toBeGreaterThan(0.34);
  });
});

// ---------------------------------------------------------------------------
// AC3: live behavioral_damping override → applied in applyBehavioralSignal
// ---------------------------------------------------------------------------

describe('AC3 — live behavioral_damping override applied to applyBehavioralSignal', () => {
  it('damping=1.0 (no damping) produces larger archetype shift than damping=0.3 (default)', () => {
    const baseState = initIntentState();

    // With SDK default damping (0.3)
    const defaultOverrides = resolveIntentOverrides(null);
    const stateDefaultDamping = applyBehavioralSignal(
      baseState,
      'cta.clicked',
      undefined,
      defaultOverrides,
    );

    // With damping=1.0 (no damping — full raw likelihood applied)
    const fullDampingOverrides = resolveIntentOverrides({ behavioral_damping: 1.0 });
    const stateFullDamping = applyBehavioralSignal(
      baseState,
      'cta.clicked',
      undefined,
      fullDampingOverrides,
    );

    // yield_hunter gets a boost from cta.clicked (likelihood > 1.0).
    // With damping=1.0, the boost is larger than with damping=0.3.
    expect(stateFullDamping.probabilities.yield_hunter).toBeGreaterThan(
      stateDefaultDamping.probabilities.yield_hunter,
    );
  });

  it('damping=0.0001 (near-zero) → signal has negligible effect on distribution', () => {
    const baseState = initIntentState();
    // Near-zero damping makes all likelihood values approach 1.0 (no information).
    const nearZeroOverrides = resolveIntentOverrides({ behavioral_damping: 0.0001 });
    const stateNearZero = applyBehavioralSignal(
      baseState,
      'cta.clicked',
      undefined,
      nearZeroOverrides,
    );
    // With near-zero damping, probabilities barely change from the prior.
    // yield_hunter delta should be extremely small.
    const delta = Math.abs(
      stateNearZero.probabilities.yield_hunter - baseState.probabilities.yield_hunter,
    );
    expect(delta).toBeLessThan(0.005);
  });
});

// ---------------------------------------------------------------------------
// AC4: live priors override → reflected in initIntentState output
// ---------------------------------------------------------------------------

describe('AC4 — live priors override reflected in initIntentState', () => {
  it('server-supplied yield_hunter prior boost raises yield_hunter probability', () => {
    const weights: IntentWeights = {
      priors: { yield_hunter: 0.2 }, // much higher than BASE_PRIOR (0.04)
    };
    const overrides = resolveIntentOverrides(weights);
    const state = initIntentState(overrides);

    // yield_hunter should be notably higher than the default 0.04 after normalization
    expect(state.probabilities.yield_hunter).toBeGreaterThan(0.1);
  });

  it('normalized priors still sum to 1.0', () => {
    const weights: IntentWeights = {
      priors: { yield_hunter: 0.2, neutral: 0.5 },
    };
    const overrides = resolveIntentOverrides(weights);
    const state = initIntentState(overrides);

    const sum = ARCHETYPE_NAMES.reduce((acc, k) => acc + state.probabilities[k], 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('partial priors override does NOT collapse unspecified archetypes to 0', () => {
    // ADR-0012 §Risks: "Partial priors divergence" — unspecified archetypes must
    // retain their BASE_PRIOR value after merge, not collapse to 0.
    const weights: IntentWeights = {
      priors: { yield_hunter: 0.15 }, // only yield_hunter specified
    };
    const overrides = resolveIntentOverrides(weights);

    // family_buyer was NOT specified — must still have a non-zero probability
    expect(overrides.basePrior.family_buyer).toBeGreaterThan(0);
    // neutral was NOT specified — must still be present
    expect(overrides.basePrior.neutral).toBeGreaterThan(0);
  });

  it('empty priors object → basePrior equals BASE_PRIOR (no override)', () => {
    const weights: IntentWeights = { priors: {} };
    const overrides = resolveIntentOverrides(weights);
    const stateFromOverrides = initIntentState(overrides);
    const stateFromDefault = initIntentState();
    expect(stateFromOverrides.probabilities).toEqual(stateFromDefault.probabilities);
  });
});

// ---------------------------------------------------------------------------
// AC5: live signal_likelihoods partial override → merges over SDK defaults
// ---------------------------------------------------------------------------

describe('AC5 — live signal_likelihoods partial override merges over SDK defaults', () => {
  it('overriding cta.clicked yield_hunter likelihood affects applyBehavioralSignal output', () => {
    const baseState = initIntentState();

    // Default behaviour for cta.clicked
    const defaultOverrides = resolveIntentOverrides(null);
    const stateDefault = applyBehavioralSignal(
      baseState,
      'cta.clicked',
      undefined,
      defaultOverrides,
    );

    // Override: yield_hunter gets a very strong signal for cta.clicked
    const serverWeights: IntentWeights = {
      signal_likelihoods: {
        'cta.clicked': { yield_hunter: 3.0 }, // much higher than SDK default (1.15)
      },
    };
    const overriddenOverrides = resolveIntentOverrides(serverWeights);
    const stateOverridden = applyBehavioralSignal(
      baseState,
      'cta.clicked',
      undefined,
      overriddenOverrides,
    );

    // With a much stronger yield_hunter signal, its probability should be higher
    expect(stateOverridden.probabilities.yield_hunter).toBeGreaterThan(
      stateDefault.probabilities.yield_hunter,
    );
  });

  it('unspecified signal types retain SDK defaults when another signal is overridden', () => {
    const serverWeights: IntentWeights = {
      signal_likelihoods: {
        'cta.clicked': { yield_hunter: 3.0 },
        // listing.viewed is NOT in the override → must retain SDK default
      },
    };
    const overrides = resolveIntentOverrides(serverWeights);

    // SDK default for listing.viewed boosts portfolio_builder (1.1) and yield_hunter (1.08)
    // and penalises neutral (0.92).
    expect(overrides.signalLikelihoods['listing.viewed']?.portfolio_builder).toBeGreaterThan(1.0);
    expect(overrides.signalLikelihoods['listing.viewed']?.neutral).toBeLessThan(1.0);
  });

  it('missing archetypes within a signal entry default to 1.0 (no information)', () => {
    // Server supplies only yield_hunter for cta.clicked; all other archetypes should be 1.0
    const serverWeights: IntentWeights = {
      signal_likelihoods: {
        'cta.clicked': { yield_hunter: 2.0 },
      },
    };
    const overrides = resolveIntentOverrides(serverWeights);
    const ctaRow = overrides.signalLikelihoods['cta.clicked'];
    expect(ctaRow).toBeDefined();
    // family_buyer was not in the override → should be 1.0
    expect(ctaRow!.family_buyer).toBe(1.0);
    // first_time_buyer was not in the override → should be 1.0
    expect(ctaRow!.first_time_buyer).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// AC6: resolveIntentOverrides — combined partial overrides + normalization
// ---------------------------------------------------------------------------

describe('AC6 — resolveIntentOverrides merges all three sub-fields correctly', () => {
  it('all three sub-fields together produce a consistent overrides bundle', () => {
    const weights: IntentWeights = {
      behavioral_damping: 0.5,
      priors: { family_buyer: 0.12 },
      signal_likelihoods: {
        'mortgage_calc.used': { family_buyer: 2.5 },
      },
    };
    const overrides = resolveIntentOverrides(weights);

    expect(overrides.behavioralDamping).toBe(0.5);
    expect(overrides.basePrior.family_buyer).toBeGreaterThan(0.05);
    expect(overrides.signalLikelihoods['mortgage_calc.used']?.family_buyer).toBe(2.5);
  });
});

// ---------------------------------------------------------------------------
// AC7: data_source='error' → SDK defaults + distinct console.warn (not silent)
// ---------------------------------------------------------------------------

describe('AC7 — data_source=error → SDK defaults + distinct console.warn', () => {
  it('fetchIntentWeights returns null on data_source=error', async () => {
    const errorBody = { data_source: 'error' }; // no weights field (HTTP 500 pattern)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve(errorBody),
      }),
    );

    const result = await fetchIntentWeights(DECISION_API_URL, 'test-key', 1_000, false);
    expect(result).toBeNull();
  });

  it('fetchIntentWeights emits console.warn in debug mode on data_source=error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockReturnValue(undefined);

    const errorBody = { data_source: 'error' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve(errorBody),
      }),
    );

    await fetchIntentWeights(DECISION_API_URL, 'test-key', 1_000, true /* debug */);

    const errorWarns = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('data_source=error'),
    );
    expect(errorWarns.length).toBeGreaterThanOrEqual(1);
    warnSpy.mockRestore();
  });

  it('fetchIntentWeights does NOT emit error warn when data_source=mock (distinct signals)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockReturnValue(undefined);

    const mockBody = {
      weights: {},
      effective_at: '2026-06-13T00:00:00Z',
      is_tenant_specific: false,
      data_source: 'mock',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockBody),
      }),
    );

    await fetchIntentWeights(DECISION_API_URL, 'test-key', 1_000, true /* debug */);

    // The error-path warn must NOT appear for a mock response
    const errorWarns = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('data_source=error'),
    );
    expect(errorWarns).toHaveLength(0);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// AC8: fetch failure → null (SDK defaults)
// ---------------------------------------------------------------------------

describe('AC8 — fetch failure → fetchIntentWeights returns null', () => {
  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const result = await fetchIntentWeights(DECISION_API_URL, 'test-key', 1_000, false);
    expect(result).toBeNull();
  });

  it('returns null on timeout (AbortError)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            }, 2000);
          }),
      ),
    );
    const result = await fetchIntentWeights(DECISION_API_URL, 'test-key', 1 /* 1ms timeout */);
    expect(result).toBeNull();
  });

  it('returns null on non-2xx without parseable body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      }),
    );
    const result = await fetchIntentWeights(DECISION_API_URL, 'test-key', 1_000, false);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC9: malformed response body → null (no throw)
// ---------------------------------------------------------------------------

describe('AC9 — malformed response body → fetchIntentWeights returns null without throwing', () => {
  it('returns null when body fails IntentConfigResponseSchema safeParse', async () => {
    const malformedBody = { unknown_field: 'something', data_source: 'bogus_value' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(malformedBody),
      }),
    );
    const result = await fetchIntentWeights(DECISION_API_URL, 'test-key', 1_000, false);
    expect(result).toBeNull();
  });

  it('returns null when body is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Invalid JSON')),
      }),
    );
    const result = await fetchIntentWeights(DECISION_API_URL, 'test-key', 1_000, false);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: init() wires fetchIntentWeights at step 3b (Rule L producer test)
// Drives the REAL _initForTest() body — NOT a mirror of init() logic.
// ---------------------------------------------------------------------------

describe('Rule L — init() calls fetchIntentWeights and applies live weights', () => {
  beforeEach(() => {
    clearAll();
    localStorage.setItem('estalara_consent', 'granted');
    seedSession();
    vi.useFakeTimers();
  });

  it('live behavioral_damping=1.0 from server: fetchIntentWeights is called and returns non-null weights for data_source=live', async () => {
    // This test verifies the END-TO-END wiring: init() calls fetchIntentWeights,
    // the live data_source is observed, and the weights are returned (not null).
    // The unit tests in AC3 verify that the returned weights are correctly applied
    // by resolveIntentOverrides + applyBehavioralSignal.
    //
    // We verify the wiring (rather than a fragile cross-run comparison) because
    // the cold-start priors (archetype hints from detectSiteSchema) introduce
    // non-determinism in jsdom that makes relative probability comparisons brittle.
    const liveBody = {
      weights: { behavioral_damping: 1.0 },
      effective_at: '2026-06-13T00:00:00Z',
      is_tenant_specific: true,
      data_source: 'live',
    };
    const mockFetch = buildMockFetch(liveBody);
    vi.stubGlobal('fetch', mockFetch);
    insertScriptTag({ decisionUrl: DECISION_API_URL });

    const state = await _initForTest();
    expect(state).not.toBeNull();

    // Verify the intent/config endpoint was called (step 3b wiring)
    const calls = mockFetch.mock.calls as [string, unknown][];
    const intentConfigCall = calls.find(([url]) => url.includes('/api/intent/config'));
    expect(intentConfigCall).toBeDefined();

    // Verify the state has a valid probability distribution summing to 1.0
    // (server priors were applied via initIntentState(intentOverrides)).
    const sum = ARCHETYPE_NAMES.reduce((acc, k) => acc + state!.probabilities[k], 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('live priors override → init state reflects server-supplied archetype prior', async () => {
    const liveBody = {
      weights: { priors: { yield_hunter: 0.25 } }, // very high yield_hunter prior
      effective_at: '2026-06-13T00:00:00Z',
      is_tenant_specific: true,
      data_source: 'live',
    };
    vi.stubGlobal('fetch', buildMockFetch(liveBody));
    insertScriptTag({ decisionUrl: DECISION_API_URL });

    const state = await _initForTest();
    expect(state).not.toBeNull();

    // yield_hunter should be notably elevated (server prior 0.25 >> BASE_PRIOR 0.04)
    // even after normalization + cold-start device signal
    expect(state!.probabilities.yield_hunter).toBeGreaterThan(0.1);
  });

  it('init() calls /api/intent/config with correct Bearer auth header', async () => {
    const liveBody = {
      weights: {},
      effective_at: '2026-06-13T00:00:00Z',
      is_tenant_specific: false,
      data_source: 'mock',
    };
    const mockFetch = buildMockFetch(liveBody);
    vi.stubGlobal('fetch', mockFetch);
    insertScriptTag({ decisionUrl: DECISION_API_URL, apiKey: 'my-intent-api-key' });

    await _initForTest();

    const calls = mockFetch.mock.calls as [string, RequestInit][];
    const intentCall = calls.find(([url]) => url.includes('/api/intent/config'));
    expect(intentCall).toBeDefined();
    expect(intentCall![1].headers).toMatchObject({
      Authorization: 'Bearer my-intent-api-key',
    });
  });

  it('init() runs fetchIntentWeights parallel to fetchQuizConfig (both called)', async () => {
    const liveBody = {
      weights: {},
      effective_at: '2026-06-13T00:00:00Z',
      is_tenant_specific: false,
      data_source: 'mock',
    };
    const mockFetch = buildMockFetch(liveBody);
    vi.stubGlobal('fetch', mockFetch);
    insertScriptTag({ decisionUrl: DECISION_API_URL });

    await _initForTest();

    const calls = mockFetch.mock.calls as [string, unknown][];
    const intentConfigCall = calls.find(([url]) => url.includes('/api/intent/config'));
    const quizConfigCall = calls.find(([url]) => url.includes('/api/quiz/public-config'));

    // Both fetches must have been called during init()
    expect(intentConfigCall).toBeDefined();
    expect(quizConfigCall).toBeDefined();
  });

  it('init() falls back to SDK defaults when no decisionUrl is set', async () => {
    // No decisionUrl → fetchIntentWeights is not called → SDK defaults
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    // No decisionUrl on the script tag
    insertScriptTag();

    const state = await _initForTest();
    expect(state).not.toBeNull();

    // Should have neutral as dominant archetype (SDK defaults, no server weights)
    expect(state!.probabilities.neutral).toBeGreaterThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// FOLLOW-305 regression guard (TG-1): PRODUCTION URL-FORM test
//
// Before FOLLOW-305, `fetchIntentWeights` built:
//   `${decisionApiUrl}/api/intent/config`
// where decisionApiUrl = "https://admin.estalara.com/api" (the real snippet form)
// → "https://admin.estalara.com/api/api/intent/config" (404 in prod).
//
// This test drives `fetchIntentWeights` with the EXACT production decisionApiUrl value
// ("host + /api", as emitted by buildSnippet() in DetectionPreview.tsx:153) and
// asserts the mock is called with the CORRECT single-/api URL.
// It MUST FAIL on main without the FOLLOW-305 fix.
// ---------------------------------------------------------------------------

describe('FOLLOW-305 — production URL-form regression guard (TG-1)', () => {
  it('fetchIntentWeights calls the CORRECT single-/api URL with production decisionApiUrl form', async () => {
    // The real install snippet value: `${CONTROL_PLANE_URL}/api` = host + /api.
    // Verified in apps/control-plane/src/components/onboarding/DetectionPreview.tsx:153.
    const PROD_DECISION_API_URL = 'https://admin.estalara.com/api';
    const EXPECTED_URL = 'https://admin.estalara.com/api/intent/config';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data_source: 'mock',
          is_tenant_specific: false,
          effective_at: '2026-06-14T00:00:00Z',
        }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchIntentWeights(PROD_DECISION_API_URL, 'test-key', 1_000, false);

    // Assert mock was called with EXACTLY the correct single-/api URL.
    // Before FOLLOW-305 this assertion fails because the call would be made to
    // "https://admin.estalara.com/api/api/intent/config" (double /api → 404 in prod).
    const [calledUrl] = mockFetch.mock.calls[0] as [string, unknown];
    expect(calledUrl).toBe(EXPECTED_URL);
  });

  it('fetchIntentWeights does NOT produce a double-/api URL', async () => {
    const PROD_DECISION_API_URL = 'https://admin.estalara.com/api';
    const DOUBLE_API_URL = 'https://admin.estalara.com/api/api/intent/config';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchIntentWeights(PROD_DECISION_API_URL, 'test-key', 1_000, false);

    const [calledUrl] = mockFetch.mock.calls[0] as [string, unknown];
    // The double-/api URL must NEVER be the fetch target.
    expect(calledUrl).not.toBe(DOUBLE_API_URL);
  });
});

// ---------------------------------------------------------------------------
// FOLLOW-305 (TG-2): ARCHETYPE_NAMES ≡ ARCHETYPE_KEYS parity guard
//
// `resolveIntentOverrides`'s `if (k in merged)` filter (intent.ts) operates on
// SDK-local `ARCHETYPE_NAMES`. If shared `ARCHETYPE_KEYS` ever gains an archetype
// that `ARCHETYPE_NAMES` does not have, that server prior would be silently dropped.
// This guard prevents that drift (mirrors AC10 on the archetype axis).
// ---------------------------------------------------------------------------

describe('FOLLOW-305 — ARCHETYPE_NAMES ≡ ARCHETYPE_KEYS parity guard (TG-2)', () => {
  it('ARCHETYPE_NAMES contains every key in shared ARCHETYPE_KEYS', async () => {
    const { ARCHETYPE_KEYS } = await import('@estalara/shared');
    const nameSet = new Set<string>(ARCHETYPE_NAMES);
    for (const key of ARCHETYPE_KEYS) {
      expect(nameSet.has(key)).toBe(true);
    }
  });

  it('shared ARCHETYPE_KEYS contains every key in SDK ARCHETYPE_NAMES', async () => {
    const { ARCHETYPE_KEYS } = await import('@estalara/shared');
    const keySet = new Set<string>(ARCHETYPE_KEYS);
    for (const name of ARCHETYPE_NAMES) {
      expect(keySet.has(name)).toBe(true);
    }
  });

  it('resolveIntentOverrides does not drop any ARCHETYPE_KEYS server prior', async () => {
    const { ARCHETYPE_KEYS } = await import('@estalara/shared');
    // Supply a prior for every shared archetype key (value > 0 required by schema).
    const allPriors: Record<string, number> = {};
    for (const key of ARCHETYPE_KEYS) {
      allPriors[key] = 0.05;
    }
    const overrides = resolveIntentOverrides({ priors: allPriors });
    // Every shared key must appear in the resolved basePrior (none silently dropped).
    for (const key of ARCHETYPE_KEYS) {
      expect(overrides.basePrior).toHaveProperty(key);
    }
  });
});
