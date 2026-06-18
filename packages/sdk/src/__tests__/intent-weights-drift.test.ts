/**
 * Cross-package drift guard: DEFAULT_INTENT_WEIGHTS (packages/shared) ↔
 * BASE_PRIOR / BEHAVIORAL_DAMPING (packages/sdk/src/core/intent.ts).
 *
 * Why this test exists (FOLLOW-331, RETRO-084 LG-1 + DG-1):
 *   PR #312 added `DEFAULT_INTENT_WEIGHTS` to `@estalara/shared` as a hand-copied
 *   restatement of the SDK's `BASE_PRIOR` (18-key probability distribution) and
 *   `BEHAVIORAL_DAMPING` (scalar 0.3). The values agreed at the time, but there was
 *   NO automated reconciliation. The `intent-weights.ts:155-160` docstring falsely
 *   claimed "drift is caught in CI" via `intent-weights.test.ts` — that test only
 *   asserts the shared constant against itself (sum, key count, neutral value) and
 *   never imports the SDK. This test is the real guard.
 *
 * What this test proves (AC1 of FOLLOW-331):
 *   - Key-set equality: `Object.keys(DEFAULT_INTENT_WEIGHTS.priors!)` ===
 *     `Object.keys(BASE_PRIOR)` (same 18 archetype keys, no extras, no omissions).
 *   - Per-key value equality: for every archetype key, the value in
 *     `DEFAULT_INTENT_WEIGHTS.priors` equals the value in `BASE_PRIOR`.
 *   - Damping equality: `DEFAULT_INTENT_WEIGHTS.behavioral_damping` ===
 *     `BEHAVIORAL_DAMPING`.
 *
 * Mutation test (AC1 second clause):
 *   Mutating EITHER copy in isolation would turn this test RED because:
 *   - Changing a value in `DEFAULT_INTENT_WEIGHTS.priors` fails the per-key assertion.
 *   - Changing a value in `BASE_PRIOR` fails the per-key assertion.
 *   - Changing `DEFAULT_INTENT_WEIGHTS.behavioral_damping` fails the damping assertion.
 *   - Changing `BEHAVIORAL_DAMPING` fails the damping assertion.
 *   - Adding/removing a key from either record fails the key-count + key-set assertions.
 *
 * This file lives in `packages/sdk/src/__tests__/` so it can import from BOTH
 * `@estalara/shared` and `packages/sdk/src/core/intent.ts` without creating a
 * circular dependency (sdk may import from shared, not the other way around).
 * See ADR-0012 §Implementation guidance.
 *
 * @module packages/sdk/src/__tests__/intent-weights-drift.test
 */

import { describe, it, expect } from 'vitest';

import { DEFAULT_INTENT_WEIGHTS } from '@estalara/shared';
import { BASE_PRIOR, BEHAVIORAL_DAMPING } from '../core/intent.js';

// ─── DRIFT-1: Key-set equality ────────────────────────────────────────────────

describe('intent-weights drift guard — key-set equality', () => {
  it('DRIFT-1a: DEFAULT_INTENT_WEIGHTS.priors has the same key count as BASE_PRIOR', () => {
    const sharedKeys = Object.keys(DEFAULT_INTENT_WEIGHTS.priors!);
    const sdkKeys = Object.keys(BASE_PRIOR);
    expect(sharedKeys.length).toBe(sdkKeys.length);
  });

  it('DRIFT-1b: every key in BASE_PRIOR is present in DEFAULT_INTENT_WEIGHTS.priors', () => {
    const sharedPriors = DEFAULT_INTENT_WEIGHTS.priors!;
    for (const key of Object.keys(BASE_PRIOR)) {
      expect(sharedPriors).toHaveProperty(key);
    }
  });

  it('DRIFT-1c: every key in DEFAULT_INTENT_WEIGHTS.priors is present in BASE_PRIOR', () => {
    const basePriorKeys = new Set(Object.keys(BASE_PRIOR));
    for (const key of Object.keys(DEFAULT_INTENT_WEIGHTS.priors!)) {
      expect(basePriorKeys.has(key)).toBe(true);
    }
  });
});

// ─── DRIFT-2: Per-key value equality ─────────────────────────────────────────

describe('intent-weights drift guard — per-key value equality', () => {
  it('DRIFT-2: each archetype prior in DEFAULT_INTENT_WEIGHTS equals BASE_PRIOR', () => {
    const sharedPriors = DEFAULT_INTENT_WEIGHTS.priors!;
    for (const [key, sdkValue] of Object.entries(BASE_PRIOR)) {
      // Use strict equality — these are hand-typed decimal literals; floating-point
      // rounding should not differ between two identical literal values.
      expect(sharedPriors[key as keyof typeof sharedPriors]).toBe(sdkValue);
    }
  });
});

// ─── DRIFT-3: Damping equality ────────────────────────────────────────────────

describe('intent-weights drift guard — behavioral_damping equality', () => {
  it('DRIFT-3: DEFAULT_INTENT_WEIGHTS.behavioral_damping equals SDK BEHAVIORAL_DAMPING', () => {
    expect(DEFAULT_INTENT_WEIGHTS.behavioral_damping).toBe(BEHAVIORAL_DAMPING);
  });
});

// ─── DRIFT-4: Structural completeness ────────────────────────────────────────

describe('intent-weights drift guard — structural completeness', () => {
  it('DRIFT-4a: DEFAULT_INTENT_WEIGHTS.priors is defined (not undefined)', () => {
    expect(DEFAULT_INTENT_WEIGHTS.priors).toBeDefined();
  });

  it('DRIFT-4b: DEFAULT_INTENT_WEIGHTS.behavioral_damping is defined (not undefined)', () => {
    expect(DEFAULT_INTENT_WEIGHTS.behavioral_damping).toBeDefined();
  });

  it('DRIFT-4c: DEFAULT_INTENT_WEIGHTS.priors sums to 1.00 (tolerance 1e-10)', () => {
    const sum = Object.values(DEFAULT_INTENT_WEIGHTS.priors!).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-10);
  });

  it('DRIFT-4d: BASE_PRIOR sums to 1.00 (tolerance 1e-10)', () => {
    const sum = Object.values(BASE_PRIOR).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-10);
  });
});
