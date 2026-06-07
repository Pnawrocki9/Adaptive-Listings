/**
 * Quiz widget v2.0 — decision tree tests.
 *
 * Covers:
 *   - All 17 non-neutral leaf archetype paths
 *   - Neutral path (Q1 → D / idx 3)
 *   - Q3 override rule in WŁASNY_UZYTKU: luxury_buyer and remote_worker override Q2 base
 *   - Progress indicator: 1/2 vs 1/3 by branch and Q2 answer
 */

import { describe, expect, it } from 'vitest';

import { QUIZ_CONTENT, resolveArchetype, computeStepCount } from '../ui/quiz-widget.js';

// ─── QUIZ_CONTENT structure ───────────────────────────────────────────────────

describe('QUIZ_CONTENT', () => {
  const languages = ['en', 'pl', 'es'] as const;

  languages.forEach((lang) => {
    describe(`language: ${lang}`, () => {
      it('has q1_gate with 4 answers', () => {
        expect(QUIZ_CONTENT[lang].q1_gate.question).toBeTruthy();
        expect(QUIZ_CONTENT[lang].q1_gate.answers).toHaveLength(4);
      });

      it('has inwestor_q2 with 4 answers', () => {
        expect(QUIZ_CONTENT[lang].inwestor_q2.question).toBeTruthy();
        expect(QUIZ_CONTENT[lang].inwestor_q2.answers).toHaveLength(4);
      });

      it('has inwestor_q3 with 3 answers', () => {
        expect(QUIZ_CONTENT[lang].inwestor_q3.question).toBeTruthy();
        expect(QUIZ_CONTENT[lang].inwestor_q3.answers).toHaveLength(3);
      });

      it('has own_use_q2 with 4 answers', () => {
        expect(QUIZ_CONTENT[lang].own_use_q2.question).toBeTruthy();
        expect(QUIZ_CONTENT[lang].own_use_q2.answers).toHaveLength(4);
      });

      it('has own_use_q3 with 4 answers', () => {
        expect(QUIZ_CONTENT[lang].own_use_q3.question).toBeTruthy();
        expect(QUIZ_CONTENT[lang].own_use_q3.answers).toHaveLength(4);
      });

      it('has cross_border_q2 with 3 answers', () => {
        expect(QUIZ_CONTENT[lang].cross_border_q2.question).toBeTruthy();
        expect(QUIZ_CONTENT[lang].cross_border_q2.answers).toHaveLength(3);
      });

      it('has cross_border_q3 with 3 answers', () => {
        expect(QUIZ_CONTENT[lang].cross_border_q3.question).toBeTruthy();
        expect(QUIZ_CONTENT[lang].cross_border_q3.answers).toHaveLength(3);
      });

      it('has cta_next, cta_finish, skip labels', () => {
        expect(QUIZ_CONTENT[lang].cta_next).toBeTruthy();
        expect(QUIZ_CONTENT[lang].cta_finish).toBeTruthy();
        expect(QUIZ_CONTENT[lang].skip).toBeTruthy();
      });
    });
  });
});

// ─── resolveArchetype — neutral path ─────────────────────────────────────────

describe('resolveArchetype — neutral (Q1→D)', () => {
  it('returns neutral when branch is null', () => {
    expect(resolveArchetype(null, null, null)).toBe('neutral');
  });
});

// ─── resolveArchetype — INWESTOR branch ──────────────────────────────────────

describe('resolveArchetype — INWESTOR branch', () => {
  it('Q2-A + Q3-A → yield_hunter', () => {
    expect(resolveArchetype('INWESTOR', 0, 0)).toBe('yield_hunter');
  });

  it('Q2-A + Q3-B → portfolio_builder', () => {
    expect(resolveArchetype('INWESTOR', 0, 1)).toBe('portfolio_builder');
  });

  it('Q2-A + Q3-C → golden_visa_buyer', () => {
    expect(resolveArchetype('INWESTOR', 0, 2)).toBe('golden_visa_buyer');
  });

  it('Q2-B → vacation_rental_investor', () => {
    expect(resolveArchetype('INWESTOR', 1, null)).toBe('vacation_rental_investor');
  });

  it('Q2-C → flip_investor', () => {
    expect(resolveArchetype('INWESTOR', 2, null)).toBe('flip_investor');
  });

  it('Q2-D → commercial_investor', () => {
    expect(resolveArchetype('INWESTOR', 3, null)).toBe('commercial_investor');
  });
});

// ─── resolveArchetype — OWN_USE branch ───────────────────────────────────────

describe('resolveArchetype — OWN_USE branch', () => {
  it('Q2-A + Q3-A → first_time_buyer (confirms base)', () => {
    expect(resolveArchetype('OWN_USE', 0, 0)).toBe('first_time_buyer');
  });

  it('Q2-B + Q3-A → family_buyer (confirms base)', () => {
    expect(resolveArchetype('OWN_USE', 1, 0)).toBe('family_buyer');
  });

  it('Q2-C + Q3-A → upsizer (confirms base)', () => {
    expect(resolveArchetype('OWN_USE', 2, 0)).toBe('upsizer');
  });

  it('Q2-D + Q3-D → downsizer (confirms base)', () => {
    expect(resolveArchetype('OWN_USE', 3, 3)).toBe('downsizer');
  });

  it('Q2-A + Q3-B → luxury_buyer (override)', () => {
    expect(resolveArchetype('OWN_USE', 0, 1)).toBe('luxury_buyer');
  });

  it('Q2-B + Q3-B → luxury_buyer (override, Q2-base irrelevant)', () => {
    expect(resolveArchetype('OWN_USE', 1, 1)).toBe('luxury_buyer');
  });

  it('Q2-C + Q3-B → luxury_buyer (override)', () => {
    expect(resolveArchetype('OWN_USE', 2, 1)).toBe('luxury_buyer');
  });

  it('Q2-D + Q3-B → luxury_buyer (override)', () => {
    expect(resolveArchetype('OWN_USE', 3, 1)).toBe('luxury_buyer');
  });

  it('Q2-A + Q3-C → remote_worker (override)', () => {
    expect(resolveArchetype('OWN_USE', 0, 2)).toBe('remote_worker');
  });

  it('Q2-B + Q3-C → remote_worker (override)', () => {
    expect(resolveArchetype('OWN_USE', 1, 2)).toBe('remote_worker');
  });

  it('Q2-C + Q3-C → remote_worker (override)', () => {
    expect(resolveArchetype('OWN_USE', 2, 2)).toBe('remote_worker');
  });

  it('Q2-D + Q3-C → remote_worker (override)', () => {
    expect(resolveArchetype('OWN_USE', 3, 2)).toBe('remote_worker');
  });
});

// ─── resolveArchetype — CROSS_BORDER branch ──────────────────────────────────

describe('resolveArchetype — CROSS_BORDER branch', () => {
  it('Q2-A + Q3-A → retiree_relocator', () => {
    expect(resolveArchetype('CROSS_BORDER', 0, 0)).toBe('retiree_relocator');
  });

  it('Q2-A + Q3-B → diaspora_buyer', () => {
    expect(resolveArchetype('CROSS_BORDER', 0, 1)).toBe('diaspora_buyer');
  });

  it('Q2-A + Q3-C → lifestyle_expat', () => {
    expect(resolveArchetype('CROSS_BORDER', 0, 2)).toBe('lifestyle_expat');
  });

  it('Q2-B → second_home_buyer', () => {
    expect(resolveArchetype('CROSS_BORDER', 1, null)).toBe('second_home_buyer');
  });

  it('Q2-C → student_parent', () => {
    expect(resolveArchetype('CROSS_BORDER', 2, null)).toBe('student_parent');
  });
});

// ─── computeStepCount — progress indicator ───────────────────────────────────

describe('computeStepCount', () => {
  it('INWESTOR + Q2 not yet answered → 2 (default)', () => {
    expect(computeStepCount('INWESTOR', null)).toBe(2);
  });

  it('INWESTOR + Q2-A (yield focus) → 3', () => {
    expect(computeStepCount('INWESTOR', 0)).toBe(3);
  });

  it('INWESTOR + Q2-B → 2', () => {
    expect(computeStepCount('INWESTOR', 1)).toBe(2);
  });

  it('INWESTOR + Q2-C → 2', () => {
    expect(computeStepCount('INWESTOR', 2)).toBe(2);
  });

  it('INWESTOR + Q2-D → 2', () => {
    expect(computeStepCount('INWESTOR', 3)).toBe(2);
  });

  it('OWN_USE always → 3', () => {
    expect(computeStepCount('OWN_USE', null)).toBe(3);
    expect(computeStepCount('OWN_USE', 0)).toBe(3);
    expect(computeStepCount('OWN_USE', 1)).toBe(3);
    expect(computeStepCount('OWN_USE', 2)).toBe(3);
    expect(computeStepCount('OWN_USE', 3)).toBe(3);
  });

  it('CROSS_BORDER + Q2-A → 3', () => {
    expect(computeStepCount('CROSS_BORDER', 0)).toBe(3);
  });

  it('CROSS_BORDER + Q2-B → 2', () => {
    expect(computeStepCount('CROSS_BORDER', 1)).toBe(2);
  });

  it('CROSS_BORDER + Q2-C → 2', () => {
    expect(computeStepCount('CROSS_BORDER', 2)).toBe(2);
  });
});

// ─── All 17 non-neutral archetypes are reachable ──────────────────────────────

describe('all 17 non-neutral archetypes are reachable', () => {
  const expected = [
    // INWESTOR
    'yield_hunter',
    'portfolio_builder',
    'golden_visa_buyer',
    'vacation_rental_investor',
    'flip_investor',
    'commercial_investor',
    // OWN_USE
    'first_time_buyer',
    'family_buyer',
    'upsizer',
    'downsizer',
    'luxury_buyer',
    'remote_worker',
    // CROSS_BORDER
    'retiree_relocator',
    'diaspora_buyer',
    'lifestyle_expat',
    'second_home_buyer',
    'student_parent',
  ] as const;

  const paths: [Parameters<typeof resolveArchetype>, string][] = [
    [['INWESTOR', 0, 0], 'yield_hunter'],
    [['INWESTOR', 0, 1], 'portfolio_builder'],
    [['INWESTOR', 0, 2], 'golden_visa_buyer'],
    [['INWESTOR', 1, null], 'vacation_rental_investor'],
    [['INWESTOR', 2, null], 'flip_investor'],
    [['INWESTOR', 3, null], 'commercial_investor'],
    [['OWN_USE', 0, 0], 'first_time_buyer'],
    [['OWN_USE', 1, 0], 'family_buyer'],
    [['OWN_USE', 2, 0], 'upsizer'],
    [['OWN_USE', 3, 3], 'downsizer'],
    [['OWN_USE', 0, 1], 'luxury_buyer'],
    [['OWN_USE', 0, 2], 'remote_worker'],
    [['CROSS_BORDER', 0, 0], 'retiree_relocator'],
    [['CROSS_BORDER', 0, 1], 'diaspora_buyer'],
    [['CROSS_BORDER', 0, 2], 'lifestyle_expat'],
    [['CROSS_BORDER', 1, null], 'second_home_buyer'],
    [['CROSS_BORDER', 2, null], 'student_parent'],
  ];

  it('covers exactly the 17 expected archetypes', () => {
    const resolved = paths.map(([args]) => resolveArchetype(...args));
    const uniqueResolved = new Set(resolved);
    const expectedSet = new Set(expected);
    expect(uniqueResolved).toEqual(expectedSet);
  });

  paths.forEach(([args, archetype]) => {
    it(`path (${args.join(', ')}) → ${archetype}`, () => {
      expect(resolveArchetype(...args)).toBe(archetype);
    });
  });
});
