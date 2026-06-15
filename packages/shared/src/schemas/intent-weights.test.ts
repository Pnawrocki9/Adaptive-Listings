/**
 * Tests for IntentWeightsSchema (FOLLOW-294, ADR-0012 Ticket A).
 *
 * Coverage:
 *   SHAPE-1: empty object `{}` is valid (all sub-fields optional)
 *   SHAPE-2: behavioral_damping only — valid
 *   SHAPE-3: priors only (partial) — valid
 *   SHAPE-4: signal_likelihoods only (partial) — valid
 *   SHAPE-5: all three sub-fields together — valid
 *   SHAPE-6: all 18 archetype keys are valid in priors
 *   SHAPE-7: all 13 signal keys are valid in signal_likelihoods
 *   REJECT-1: rejects signal_weights top-level key (old invented shape)
 *   REJECT-2: rejects the 6 previously-invented keys as signal_likelihoods keys
 *   REJECT-3: rejects unknown top-level field (strict mode)
 *   REJECT-4: rejects non-numeric priors values
 *   REJECT-5: rejects non-positive priors values (zero, negative)
 *   REJECT-6: rejects behavioral_damping > 1
 *   REJECT-7: rejects behavioral_damping <= 0
 *   REJECT-8: rejects unknown archetype key in priors
 *   REJECT-9: rejects unknown archetype key in signal_likelihoods inner record
 *   REJECT-10: rejects non-positive signal_likelihoods value
 *   KEY-1: ARCHETYPE_KEYS has exactly 18 entries
 *   KEY-2: INTENT_SIGNAL_KEYS has exactly 13 entries
 *   KEY-3: ARCHETYPE_KEYS includes 'neutral'
 *   KEY-4: INTENT_SIGNAL_KEYS does not include filter.applied (payload-conditional)
 *   KEY-5: INTENT_SIGNAL_KEYS does not include any of the 6 previously-invented keys
 *
 * DRIFT guard (SDK ↔ ARCHETYPE_KEYS): the assertion that ARCHETYPE_KEYS matches
 * ARCHETYPE_NAMES from packages/sdk/src/core/intent.ts runs in the SDK package's
 * own test suite (packages/sdk/src/__tests__/intent-weights-drift.test.ts) where
 * both imports are valid without circular dependency risk. See ADR-0012 §Implementation
 * guidance / "Assertion test requirement".
 *
 * @module @estalara/shared/schemas/intent-weights.test
 */

import { describe, it, expect } from 'vitest';

import {
  IntentWeightsSchema,
  INTENT_SIGNAL_KEYS,
  ARCHETYPE_KEYS,
  DEFAULT_INTENT_WEIGHTS,
} from './intent-weights.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parse(input: unknown) {
  return IntentWeightsSchema.parse(input);
}

function safeParse(input: unknown) {
  return IntentWeightsSchema.safeParse(input);
}

// ─── Shape acceptance tests ───────────────────────────────────────────────────

describe('IntentWeightsSchema — valid shapes', () => {
  it('SHAPE-1: empty object {} is valid (all sub-fields optional)', () => {
    expect(() => parse({})).not.toThrow();
    expect(parse({})).toEqual({});
  });

  it('SHAPE-2: behavioral_damping only — valid at boundaries and mid-range', () => {
    expect(() => parse({ behavioral_damping: 0.3 })).not.toThrow();
    expect(() => parse({ behavioral_damping: 1.0 })).not.toThrow();
    expect(() => parse({ behavioral_damping: 0.01 })).not.toThrow();
  });

  it('SHAPE-3: priors only (partial)', () => {
    const result = parse({ priors: { yield_hunter: 0.06, neutral: 0.3 } });
    expect(result.priors?.yield_hunter).toBe(0.06);
    expect(result.priors?.neutral).toBe(0.3);
  });

  it('SHAPE-4: signal_likelihoods only (partial key + partial archetype)', () => {
    const result = parse({
      signal_likelihoods: {
        'cta.clicked': { yield_hunter: 1.2, flip_investor: 1.15 },
      },
    });
    expect(result.signal_likelihoods?.['cta.clicked']?.yield_hunter).toBe(1.2);
  });

  it('SHAPE-5: all three sub-fields together', () => {
    const input = {
      behavioral_damping: 0.25,
      priors: { family_buyer: 0.07, neutral: 0.3 },
      signal_likelihoods: {
        'cta.clicked': { yield_hunter: 1.2 },
        'listing.viewed': { portfolio_builder: 1.15 },
      },
    };
    expect(() => parse(input)).not.toThrow();
  });

  it('SHAPE-6: all 18 archetype keys are valid in priors', () => {
    const priors = Object.fromEntries(ARCHETYPE_KEYS.map((k) => [k, 0.05]));
    expect(() => parse({ priors })).not.toThrow();
  });

  it('SHAPE-7: all 13 signal keys are valid in signal_likelihoods', () => {
    const signal_likelihoods = Object.fromEntries(
      INTENT_SIGNAL_KEYS.map((k) => [k, { neutral: 1.0 }]),
    );
    expect(() => parse({ signal_likelihoods })).not.toThrow();
  });
});

// ─── Rejection tests ──────────────────────────────────────────────────────────

describe('IntentWeightsSchema — rejects invented keys (strict mode)', () => {
  it('REJECT-1: rejects signal_weights top-level key (previously-invented shape)', () => {
    const result = safeParse({ signal_weights: { quiz_answer: 2.0 } });
    expect(result.success).toBe(false);
  });

  it('REJECT-2a: rejects quiz_answer as a signal_likelihoods key', () => {
    const result = safeParse({ signal_likelihoods: { quiz_answer: { neutral: 0.5 } } });
    expect(result.success).toBe(false);
  });

  it('REJECT-2b: rejects chat_turn as a signal_likelihoods key', () => {
    const result = safeParse({ signal_likelihoods: { chat_turn: { neutral: 0.5 } } });
    expect(result.success).toBe(false);
  });

  it('REJECT-2c: rejects dwell as a signal_likelihoods key', () => {
    const result = safeParse({ signal_likelihoods: { dwell: { neutral: 0.5 } } });
    expect(result.success).toBe(false);
  });

  it('REJECT-2d: rejects pageview as a signal_likelihoods key', () => {
    const result = safeParse({ signal_likelihoods: { pageview: { neutral: 0.5 } } });
    expect(result.success).toBe(false);
  });

  it('REJECT-2e: rejects referrer as a signal_likelihoods key', () => {
    const result = safeParse({ signal_likelihoods: { referrer: { neutral: 0.5 } } });
    expect(result.success).toBe(false);
  });

  it('REJECT-2f: rejects filter_applied as a signal_likelihoods key', () => {
    const result = safeParse({ signal_likelihoods: { filter_applied: { neutral: 0.5 } } });
    expect(result.success).toBe(false);
  });

  it('REJECT-3: rejects unknown top-level field (strict mode)', () => {
    const result = safeParse({ unknown_field: 42 });
    expect(result.success).toBe(false);
  });
});

describe('IntentWeightsSchema — rejects invalid values', () => {
  it('REJECT-4: rejects non-numeric priors values', () => {
    const result = safeParse({ priors: { neutral: 'not-a-number' } });
    expect(result.success).toBe(false);
  });

  it('REJECT-5a: rejects zero priors value (must be positive)', () => {
    const result = safeParse({ priors: { neutral: 0 } });
    expect(result.success).toBe(false);
  });

  it('REJECT-5b: rejects negative priors value', () => {
    const result = safeParse({ priors: { neutral: -0.1 } });
    expect(result.success).toBe(false);
  });

  it('REJECT-6: rejects behavioral_damping > 1', () => {
    const result = safeParse({ behavioral_damping: 1.01 });
    expect(result.success).toBe(false);
  });

  it('REJECT-7a: rejects behavioral_damping = 0', () => {
    const result = safeParse({ behavioral_damping: 0 });
    expect(result.success).toBe(false);
  });

  it('REJECT-7b: rejects behavioral_damping < 0', () => {
    const result = safeParse({ behavioral_damping: -0.1 });
    expect(result.success).toBe(false);
  });

  it('REJECT-8: rejects unknown archetype key in priors', () => {
    const result = safeParse({ priors: { not_an_archetype: 0.5 } });
    expect(result.success).toBe(false);
  });

  it('REJECT-9: rejects unknown archetype key in signal_likelihoods inner record', () => {
    const result = safeParse({
      signal_likelihoods: { 'cta.clicked': { not_an_archetype: 1.2 } },
    });
    expect(result.success).toBe(false);
  });

  it('REJECT-10: rejects non-positive signal_likelihoods value', () => {
    const result = safeParse({
      signal_likelihoods: { 'cta.clicked': { neutral: -1.0 } },
    });
    expect(result.success).toBe(false);
  });
});

// ─── Key set completeness ─────────────────────────────────────────────────────

describe('ARCHETYPE_KEYS and INTENT_SIGNAL_KEYS completeness', () => {
  it('KEY-1: ARCHETYPE_KEYS has exactly 18 entries', () => {
    expect(ARCHETYPE_KEYS.length).toBe(18);
  });

  it('KEY-2: INTENT_SIGNAL_KEYS has exactly 13 entries', () => {
    expect(INTENT_SIGNAL_KEYS.length).toBe(13);
  });

  it('KEY-3: ARCHETYPE_KEYS includes neutral', () => {
    expect(ARCHETYPE_KEYS).toContain('neutral');
  });

  it('KEY-4: INTENT_SIGNAL_KEYS does not include filter.applied (payload-conditional, non-overridable in v1)', () => {
    expect(INTENT_SIGNAL_KEYS).not.toContain('filter.applied');
  });

  it('KEY-5: INTENT_SIGNAL_KEYS does not contain any of the 6 previously-invented keys', () => {
    const invented = [
      'quiz_answer',
      'chat_turn',
      'dwell',
      'pageview',
      'referrer',
      'filter_applied',
    ];
    for (const key of invented) {
      expect(INTENT_SIGNAL_KEYS).not.toContain(key);
    }
  });

  it('KEY-6: ARCHETYPE_KEYS has no duplicates', () => {
    const unique = new Set(ARCHETYPE_KEYS);
    expect(unique.size).toBe(ARCHETYPE_KEYS.length);
  });

  it('KEY-7: INTENT_SIGNAL_KEYS has no duplicates', () => {
    const unique = new Set(INTENT_SIGNAL_KEYS);
    expect(unique.size).toBe(INTENT_SIGNAL_KEYS.length);
  });
});

// ─── DEFAULT_INTENT_WEIGHTS (canonical defaults) ───────────────────────────────

describe('DEFAULT_INTENT_WEIGHTS — canonical defaults the Weight Editor resets to', () => {
  it('DEFAULT-1: validates against IntentWeightsSchema', () => {
    expect(() => IntentWeightsSchema.parse(DEFAULT_INTENT_WEIGHTS)).not.toThrow();
  });

  it('DEFAULT-2: behavioral_damping is the SDK default 0.3', () => {
    expect(DEFAULT_INTENT_WEIGHTS.behavioral_damping).toBe(0.3);
  });

  it('DEFAULT-3: priors cover all 18 archetype keys (matches BASE_PRIOR key set)', () => {
    const priorKeys = Object.keys(DEFAULT_INTENT_WEIGHTS.priors ?? {});
    expect(priorKeys.length).toBe(ARCHETYPE_KEYS.length);
    for (const k of ARCHETYPE_KEYS) {
      expect(DEFAULT_INTENT_WEIGHTS.priors).toHaveProperty(k);
    }
  });

  it('DEFAULT-4: priors sum to 1.0 (proper probability distribution per BASE_PRIOR)', () => {
    const sum = Object.values(DEFAULT_INTENT_WEIGHTS.priors ?? {}).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('DEFAULT-5: neutral carries the highest prior (0.37 fallback per BASE_PRIOR)', () => {
    expect(DEFAULT_INTENT_WEIGHTS.priors?.neutral).toBe(0.37);
  });

  it('DEFAULT-6: omits signal_likelihoods so the SDK applies its internal table', () => {
    expect(DEFAULT_INTENT_WEIGHTS.signal_likelihoods).toBeUndefined();
  });
});
