/**
 * Unit tests for the pure helper functions in scripts/feedback-canary.mts
 * (FOLLOW-450 AC2).
 *
 * The script itself POSTs to a live deployment and reads/writes a real
 * Postgres instance — it is an operator tool, not something CI can run
 * end-to-end without live credentials. These tests cover the two pure
 * functions that decide whether the canary PASSES or FAILS, so a regression
 * in the pass/fail logic itself is caught in CI (Rule H — an exported helper
 * needs a non-test consumer OR a test proving its behavior; the script is the
 * production consumer, this file is the correctness proof for its logic).
 *
 * The top-level `if (isMain)` guard in feedback-canary.mts checks
 * `process.argv[1]` against the script's own filename, so importing its pure
 * exports here does NOT trigger `main()` (which would attempt a live network
 * call and DB connection) — `process.argv[1]` under Vitest is the test
 * runner's own entrypoint, never `feedback-canary.mts`.
 *
 * @module apps/control-plane/scripts/__tests__/feedback-canary.test
 */

import { describe, expect, it } from 'vitest';
import {
  expectedAfter,
  deltaObserved,
  CANARY_ARCHETYPE,
  CANARY_VARIANT,
  type BanditRow,
} from '../feedback-canary.mts';

describe('feedback-canary — CANARY_ARCHETYPE / CANARY_VARIANT identifiers', () => {
  it('are dedicated, non-empty strings distinct from real archetype/variant names', () => {
    expect(CANARY_ARCHETYPE).toBe('estalara_ops_canary');
    expect(CANARY_VARIANT).toBe('estalara_ops_canary_v1');
    // Never collide with a real ArchetypeId enum member or SEED_VARIANTS entry.
    expect(CANARY_ARCHETYPE).not.toBe('neutral');
    expect(CANARY_VARIANT).not.toBe('control');
  });
});

describe('feedback-canary — expectedAfter()', () => {
  it('treats a missing row as Beta(1, 1) before applying the increment (converted=true)', () => {
    expect(expectedAfter(null, true)).toEqual({ alpha: 2, beta: 1 });
  });

  it('treats a missing row as Beta(1, 1) before applying the increment (converted=false)', () => {
    expect(expectedAfter(null, false)).toEqual({ alpha: 1, beta: 2 });
  });

  it('increments alpha on an existing row when converted=true', () => {
    const before: BanditRow = { alpha: 3, beta: 2 };
    expect(expectedAfter(before, true)).toEqual({ alpha: 4, beta: 2 });
  });

  it('increments beta on an existing row when converted=false', () => {
    const before: BanditRow = { alpha: 3, beta: 2 };
    expect(expectedAfter(before, false)).toEqual({ alpha: 3, beta: 3 });
  });
});

describe('feedback-canary — deltaObserved()', () => {
  it('returns false when the observed row is null (write has not landed yet)', () => {
    expect(deltaObserved(null, { alpha: 2, beta: 1 })).toBe(false);
  });

  it('returns true when the observed row exactly matches the expected post-ping state', () => {
    expect(deltaObserved({ alpha: 2, beta: 1 }, { alpha: 2, beta: 1 })).toBe(true);
  });

  it('returns false when alpha matches but beta does not', () => {
    expect(deltaObserved({ alpha: 2, beta: 2 }, { alpha: 2, beta: 1 })).toBe(false);
  });

  it('returns false when the row still reflects the pre-ping state (write not yet visible)', () => {
    // Simulates a poll that ran before the fire-and-forget after() write landed.
    expect(deltaObserved({ alpha: 1, beta: 1 }, { alpha: 2, beta: 1 })).toBe(false);
  });
});
