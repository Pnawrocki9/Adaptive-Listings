/**
 * FOLLOW-176 — Persist resolved archetype/intent across listing navigations.
 *
 * Covers:
 *   AC1: On intent-state change, resolved archetype/intent written to sessionStorage
 *        (keyed by sessionId), only when consent permits.
 *   AC2: rehydrateIntentState() returns a valid IntentState that init() can use
 *        immediately — subsequent listing navigation in same tab applies prior
 *        archetype with no re-accumulation required.
 *   AC3: No archetype is persisted or rehydrated when consent is absent/withdrawn;
 *        eraseIntentState() removes the stored key.
 *   AC4: Staleness/version guard — expired or wrong-version entries are rejected
 *        and removed from sessionStorage.
 *
 * Environment: node (no DOM). Storage APIs are stubbed at globalThis level.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  persistIntentState,
  rehydrateIntentState,
  eraseIntentState,
  intentStateStorageKey,
  INTENT_STATE_SCHEMA_VERSION,
  INTENT_STATE_STALE_MS,
  peekStoredSessionId,
} from '../core/session.js';
import { initIntentState, applyBehavioralSignal, applyQuizLeaf } from '../core/intent.js';
import type { IntentState } from '../core/intent.js';

// ─── Storage stubs ────────────────────────────────────────────────────────────

const mockSessionStorage = new Map<string, string>();

/** Re-stub sessionStorage with the in-memory map. Must be called after vi.restoreAllMocks(). */
function stubSessionStorage(): void {
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => mockSessionStorage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mockSessionStorage.set(key, value);
    },
    removeItem: (key: string) => {
      mockSessionStorage.delete(key);
    },
    clear: () => {
      mockSessionStorage.clear();
    },
  });
}

// Initial stub (for module-level imports)
stubSessionStorage();

const SESSION_ID = 'a'.repeat(64); // deterministic fake session ID (64 hex chars)

beforeEach(() => {
  mockSessionStorage.clear();
  // vi.restoreAllMocks() also removes vi.stubGlobal stubs — re-apply the sessionStorage stub.
  vi.restoreAllMocks();
  stubSessionStorage();
});

// ─── AC1: persistIntentState writes to sessionStorage ────────────────────────

describe('persistIntentState (AC1)', () => {
  it('writes a JSON envelope to sessionStorage under the correct key', () => {
    const state: IntentState = initIntentState();
    persistIntentState(SESSION_ID, state);

    const key = intentStateStorageKey(SESSION_ID);
    const raw = mockSessionStorage.get(key);
    expect(raw).toBeDefined();

    const envelope = JSON.parse(raw!) as {
      version: number;
      savedAt: number;
      state: unknown;
    };
    expect(envelope.version).toBe(INTENT_STATE_SCHEMA_VERSION);
    expect(typeof envelope.savedAt).toBe('number');
    expect(envelope.savedAt).toBeGreaterThan(0);
    expect(envelope.state).toBeTruthy();
  });

  it('key format is estalara_intent_{sessionId}', () => {
    const key = intentStateStorageKey(SESSION_ID);
    expect(key).toBe(`estalara_intent_${SESSION_ID}`);
  });

  it('overwrites a previously stored entry for the same sessionId', () => {
    const state1: IntentState = initIntentState();
    persistIntentState(SESSION_ID, state1);

    const state2: IntentState = applyBehavioralSignal(state1, 'listing.viewed');
    persistIntentState(SESSION_ID, state2);

    const raw = mockSessionStorage.get(intentStateStorageKey(SESSION_ID));
    const envelope = JSON.parse(raw!) as { state: IntentState };
    expect(envelope.state.signal_count).toBe(state2.signal_count);
  });

  it('stores the full state including probabilities', () => {
    const state: IntentState = applyQuizLeaf(initIntentState(), 'family_buyer');
    persistIntentState(SESSION_ID, state);

    const raw = mockSessionStorage.get(intentStateStorageKey(SESSION_ID));
    const envelope = JSON.parse(raw!) as { state: IntentState };
    expect(envelope.state.archetype).toBe('family_buyer');
    expect(envelope.state.quiz_answered).toBe(true);
    expect(typeof envelope.state.probabilities).toBe('object');
  });

  it('does not throw when sessionStorage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      setItem: vi.fn(() => {
        throw new Error('storage quota exceeded');
      }),
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
    });
    const state: IntentState = initIntentState();
    expect(() => {
      persistIntentState(SESSION_ID, state);
    }).not.toThrow();
  });
});

// ─── AC2: rehydrateIntentState round-trip ────────────────────────────────────

describe('rehydrateIntentState (AC2)', () => {
  it('returns the persisted IntentState on a valid round-trip', () => {
    const state: IntentState = applyQuizLeaf(initIntentState(), 'yield_hunter');
    persistIntentState(SESSION_ID, state);

    const hydrated = rehydrateIntentState(SESSION_ID);
    expect(hydrated).not.toBeNull();
    const s = hydrated as IntentState;
    expect(s.archetype).toBe('yield_hunter');
    expect(s.quiz_answered).toBe(true);
    expect(s.signal_count).toBe(state.signal_count);
    expect(s.confidence).toBeCloseTo(state.confidence, 5);
  });

  it('returns null when no entry exists', () => {
    expect(rehydrateIntentState(SESSION_ID)).toBeNull();
  });

  it('returns null when entry is missing from sessionStorage', () => {
    // sessionStorage is empty — no prior persist
    const result = rehydrateIntentState('b'.repeat(64));
    expect(result).toBeNull();
  });

  it('preserved all IntentState fields survive the round-trip', () => {
    let state: IntentState = initIntentState();
    for (let i = 0; i < 5; i++) {
      state = applyBehavioralSignal(state, 'listing.viewed');
    }
    state = applyQuizLeaf(state, 'portfolio_builder');

    persistIntentState(SESSION_ID, state);
    const hydrated = rehydrateIntentState(SESSION_ID) as IntentState;

    expect(hydrated.archetype).toBe(state.archetype);
    expect(hydrated.confidence).toBeCloseTo(state.confidence, 5);
    expect(hydrated.signal_count).toBe(state.signal_count);
    expect(hydrated.quiz_answered).toBe(state.quiz_answered);
    // Spot-check one probability
    expect(hydrated.probabilities.portfolio_builder).toBeCloseTo(
      state.probabilities.portfolio_builder,
      5,
    );
  });

  it('does not throw when sessionStorage.getItem throws', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(() => {
        throw new Error('unavailable');
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    expect(() => {
      rehydrateIntentState(SESSION_ID);
    }).not.toThrow();
    expect(rehydrateIntentState(SESSION_ID)).toBeNull();
  });
});

// ─── AC3: eraseIntentState removes the stored key ────────────────────────────

describe('eraseIntentState (AC3)', () => {
  it('removes the sessionStorage entry for the given sessionId', () => {
    const state: IntentState = initIntentState();
    persistIntentState(SESSION_ID, state);

    expect(mockSessionStorage.has(intentStateStorageKey(SESSION_ID))).toBe(true);

    eraseIntentState(SESSION_ID);

    expect(mockSessionStorage.has(intentStateStorageKey(SESSION_ID))).toBe(false);
  });

  it('rehydrateIntentState returns null after eraseIntentState', () => {
    const state: IntentState = applyQuizLeaf(initIntentState(), 'family_buyer');
    persistIntentState(SESSION_ID, state);
    eraseIntentState(SESSION_ID);

    expect(rehydrateIntentState(SESSION_ID)).toBeNull();
  });

  it('is a no-op when called with undefined (pre-session consent denial)', () => {
    expect(() => {
      eraseIntentState(undefined);
    }).not.toThrow();
  });

  it('is a no-op when no entry exists (idempotent)', () => {
    expect(() => {
      eraseIntentState(SESSION_ID);
    }).not.toThrow();
  });

  it('does not throw when sessionStorage.removeItem throws', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(() => {
        throw new Error('unavailable');
      }),
    });
    expect(() => {
      eraseIntentState(SESSION_ID);
    }).not.toThrow();
  });
});

// ─── AC4: staleness guard ─────────────────────────────────────────────────────

describe('rehydrateIntentState — staleness guard (AC4)', () => {
  it('rejects entries older than the default threshold (30 min)', () => {
    const state: IntentState = initIntentState();
    // Manually write an entry with savedAt in the past (> 30 min)
    const staleEnvelope = {
      version: INTENT_STATE_SCHEMA_VERSION,
      savedAt: Date.now() - INTENT_STATE_STALE_MS - 1000, // 1s past threshold
      state,
    };
    mockSessionStorage.set(intentStateStorageKey(SESSION_ID), JSON.stringify(staleEnvelope));

    expect(rehydrateIntentState(SESSION_ID)).toBeNull();
    // Stale entry should be removed proactively
    expect(mockSessionStorage.has(intentStateStorageKey(SESSION_ID))).toBe(false);
  });

  it('accepts entries within the default threshold (< 30 min)', () => {
    const state: IntentState = applyQuizLeaf(initIntentState(), 'downsizer');
    const freshEnvelope = {
      version: INTENT_STATE_SCHEMA_VERSION,
      savedAt: Date.now() - 60_000, // 1 minute ago — well within threshold
      state,
    };
    mockSessionStorage.set(intentStateStorageKey(SESSION_ID), JSON.stringify(freshEnvelope));

    const hydrated = rehydrateIntentState(SESSION_ID);
    expect(hydrated).not.toBeNull();
    expect((hydrated as IntentState).archetype).toBe('downsizer');
  });

  it('respects a custom staleMsThreshold parameter', () => {
    const state: IntentState = initIntentState();
    const envelope = {
      version: INTENT_STATE_SCHEMA_VERSION,
      savedAt: Date.now() - 5 * 60_000, // 5 minutes ago
      state,
    };
    mockSessionStorage.set(intentStateStorageKey(SESSION_ID), JSON.stringify(envelope));

    // 3-minute custom threshold → entry is stale
    expect(rehydrateIntentState(SESSION_ID, 3 * 60_000)).toBeNull();
    // Re-write to test fresh path
    mockSessionStorage.set(intentStateStorageKey(SESSION_ID), JSON.stringify(envelope));
    // 10-minute custom threshold → entry is fresh
    expect(rehydrateIntentState(SESSION_ID, 10 * 60_000)).not.toBeNull();
  });

  it('uses Date.now() for the staleness calculation', () => {
    const state: IntentState = initIntentState();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000);

    // Write entry 29 minutes ago (relative to mocked now)
    const envelope = {
      version: INTENT_STATE_SCHEMA_VERSION,
      savedAt: 1_000_000_000_000 - 29 * 60_000,
      state,
    };
    mockSessionStorage.set(intentStateStorageKey(SESSION_ID), JSON.stringify(envelope));

    const result = rehydrateIntentState(SESSION_ID);
    expect(result).not.toBeNull(); // 29 min < 30 min threshold

    nowSpy.mockRestore();
  });
});

// ─── AC4: version guard ───────────────────────────────────────────────────────

describe('rehydrateIntentState — version guard (AC4)', () => {
  it('rejects entries with a different schema version', () => {
    const state: IntentState = initIntentState();
    const wrongVersionEnvelope = {
      version: INTENT_STATE_SCHEMA_VERSION + 1, // future/mismatched version
      savedAt: Date.now(),
      state,
    };
    mockSessionStorage.set(intentStateStorageKey(SESSION_ID), JSON.stringify(wrongVersionEnvelope));

    expect(rehydrateIntentState(SESSION_ID)).toBeNull();
    // Mismatched entry should be removed proactively
    expect(mockSessionStorage.has(intentStateStorageKey(SESSION_ID))).toBe(false);
  });

  it('rejects entries with version 0 (legacy/pre-FOLLOW-176 format)', () => {
    const state: IntentState = initIntentState();
    const legacyEnvelope = {
      version: 0,
      savedAt: Date.now(),
      state,
    };
    mockSessionStorage.set(intentStateStorageKey(SESSION_ID), JSON.stringify(legacyEnvelope));

    expect(rehydrateIntentState(SESSION_ID)).toBeNull();
  });

  it('rejects entries with missing version field', () => {
    const state: IntentState = initIntentState();
    const noVersionEnvelope = {
      savedAt: Date.now(),
      state,
    };
    mockSessionStorage.set(intentStateStorageKey(SESSION_ID), JSON.stringify(noVersionEnvelope));

    expect(rehydrateIntentState(SESSION_ID)).toBeNull();
  });

  it('rejects entries with malformed JSON', () => {
    mockSessionStorage.set(intentStateStorageKey(SESSION_ID), 'not-valid-json{');
    expect(rehydrateIntentState(SESSION_ID)).toBeNull();
  });

  it('rejects entries where state is null', () => {
    const nullStateEnvelope = {
      version: INTENT_STATE_SCHEMA_VERSION,
      savedAt: Date.now(),
      state: null,
    };
    mockSessionStorage.set(intentStateStorageKey(SESSION_ID), JSON.stringify(nullStateEnvelope));

    expect(rehydrateIntentState(SESSION_ID)).toBeNull();
  });

  it('rejects entries where state is a primitive (not an object)', () => {
    const primitiveStateEnvelope = {
      version: INTENT_STATE_SCHEMA_VERSION,
      savedAt: Date.now(),
      state: 'family_buyer',
    };
    mockSessionStorage.set(
      intentStateStorageKey(SESSION_ID),
      JSON.stringify(primitiveStateEnvelope),
    );

    expect(rehydrateIntentState(SESSION_ID)).toBeNull();
  });
});

// ─── AC2 integration: simulate listing-A → listing-B navigation ──────────────

describe('persist → rehydrate integration (AC2)', () => {
  it('simulates listing A (archetype inferred) → listing B reads prior archetype immediately', () => {
    // --- Listing A page load simulation ---
    // Visitor answers quiz → high-confidence archetype is resolved
    let listingAState: IntentState = initIntentState();
    for (let i = 0; i < 5; i++) {
      listingAState = applyBehavioralSignal(listingAState, 'listing.viewed');
    }
    listingAState = applyQuizLeaf(listingAState, 'luxury_buyer');

    // onIntentUpdate writes the state on every update (simulated here by direct persist)
    persistIntentState(SESSION_ID, listingAState);

    // --- Listing B page load simulation ---
    // init() rehydrates before cold-start
    const hydratedRaw = rehydrateIntentState(SESSION_ID);
    expect(hydratedRaw).not.toBeNull();

    // isValidIntentState check (structural guard used in init())
    const h = hydratedRaw as IntentState;
    expect(typeof h.archetype).toBe('string');
    expect(typeof h.confidence).toBe('number');
    expect(typeof h.signal_count).toBe('number');
    expect(typeof h.last_updated_at).toBe('number');
    expect(typeof h.quiz_answered).toBe('boolean');
    expect(typeof h.probabilities).toBe('object');

    // Listing B immediately has the luxury_buyer archetype — no re-accumulation needed
    expect(h.archetype).toBe('luxury_buyer');
    expect(h.quiz_answered).toBe(true);
    expect(h.confidence).toBeGreaterThan(0.6);
  });

  it('different sessionIds produce different storage keys (no collision between tabs)', () => {
    const sessionA = 'a'.repeat(64);
    const sessionB = 'b'.repeat(64);

    const stateA = applyQuizLeaf(initIntentState(), 'yield_hunter');
    const stateB = applyQuizLeaf(initIntentState(), 'family_buyer');

    persistIntentState(sessionA, stateA);
    persistIntentState(sessionB, stateB);

    const hydratedA = rehydrateIntentState(sessionA) as IntentState;
    const hydratedB = rehydrateIntentState(sessionB) as IntentState;

    expect(hydratedA.archetype).toBe('yield_hunter');
    expect(hydratedB.archetype).toBe('family_buyer');
  });
});

// ─── peekStoredSessionId — used by the denied consent erasure path ─────────────

describe('peekStoredSessionId', () => {
  it('returns undefined when no session is stored in sessionStorage', () => {
    // mockSessionStorage is cleared in beforeEach — no session present
    expect(peekStoredSessionId()).toBeUndefined();
  });
});
