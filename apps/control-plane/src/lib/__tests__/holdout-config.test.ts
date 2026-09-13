/**
 * `holdout-config` — the two `/api/adapt` values a caller must never choose. [FOLLOW-1201]
 *
 * Source-level invariant tests (Rule AU §5: they say so): unset / valid / invalid env handling.
 * The route-level behaviour (500 on a missing secret, body `holdout_pct` ignored for a public
 * caller) is asserted through the real handler in `route.forgery-canary.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HoldoutPctInvalidError,
  HoldoutSecretMissingError,
  getConfiguredHoldoutPct,
  getHoldoutAssignmentSecret,
} from '../holdout-config';

/** Pins the module-private minimum (Rule AU §5: a "this constant is 32" source-level invariant). */
const MIN_HOLDOUT_SECRET_LENGTH = 32;

describe('getHoldoutAssignmentSecret', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns the secret when it is long enough', () => {
    const secret = 'x'.repeat(MIN_HOLDOUT_SECRET_LENGTH);
    vi.stubEnv('HOLDOUT_ASSIGNMENT_SECRET', secret);
    expect(getHoldoutAssignmentSecret()).toBe(secret);
  });

  it('throws when unset — never a silent fallback to public keying', () => {
    vi.stubEnv('HOLDOUT_ASSIGNMENT_SECRET', '');
    expect(() => getHoldoutAssignmentSecret()).toThrow(HoldoutSecretMissingError);
  });

  it('throws when shorter than the minimum', () => {
    vi.stubEnv('HOLDOUT_ASSIGNMENT_SECRET', 'x'.repeat(MIN_HOLDOUT_SECRET_LENGTH - 1));
    expect(() => getHoldoutAssignmentSecret()).toThrow(HoldoutSecretMissingError);
  });
});

describe('getConfiguredHoldoutPct', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to 0.1 when unset or blank', () => {
    vi.stubEnv('HOLDOUT_PCT', '');
    expect(getConfiguredHoldoutPct()).toBe(0.1);
  });

  it('parses a configured rate in [0, 1]', () => {
    vi.stubEnv('HOLDOUT_PCT', '0.25');
    expect(getConfiguredHoldoutPct()).toBe(0.25);
    vi.stubEnv('HOLDOUT_PCT', '0');
    expect(getConfiguredHoldoutPct()).toBe(0);
    vi.stubEnv('HOLDOUT_PCT', '1');
    expect(getConfiguredHoldoutPct()).toBe(1);
  });

  it('throws on a value that is not a number in [0, 1] — a typo must not become 0.1', () => {
    for (const bad of ['abc', '1.5', '-0.1', 'NaN']) {
      vi.stubEnv('HOLDOUT_PCT', bad);
      expect(() => getConfiguredHoldoutPct(), bad).toThrow(HoldoutPctInvalidError);
    }
  });
});
