/**
 * Quiz widget — the definition-driven walk (FOLLOW-639 / ADR-0019 D5). The SDK built-in tree is
 * gone (FOLLOW-1370): the widget walks only the served definition.
 *
 * Covers:
 *   - PARITY v3.0: the 12 results + neutral of the served EN + PL default are each reached by
 *     their documented path;
 *   - PARITY legacy: a served definition with the pre-FOLLOW-1357 shape (fixture) still resolves
 *     the 17 old leaves + the neutral skip;
 *   - the generic walker on a CUSTOM served tree, and `resolveLabel` i18n fallback to 'en'.
 */

import { describe, expect, it } from 'vitest';

import type { QuizDefinition } from '@estalara/shared';
import { DEFAULT_QUIZ_DEFINITION_V2 } from '@estalara/shared';

import { resolveArchetypeFromPath, resolveLabel } from '../ui/quiz-widget.js';
import { LEGACY_QUIZ_DEFINITION } from './fixtures/legacy-quiz-definition.js';

// ─── PARITY v3.0: the served default resolves the documented results ───────────

describe('parity v3.0 — DEFAULT_QUIZ_DEFINITION_V2 resolves the v3.0 results', () => {
  const walk = (path: (number | number[])[]): string =>
    resolveArchetypeFromPath(DEFAULT_QUIZ_DEFINITION_V2, path);

  it.each([
    [[0, 0, []], 'first_time_buyer'],
    [[0, 1, []], 'family_buyer'],
    [[0, 2, []], 'downsizer'],
    [[1, 0, []], 'diaspora_buyer'],
    [[1, 1, []], 'retiree_relocator'],
    [[1, 2, []], 'lifestyle_expat'],
    [[2, []], 'second_home_buyer'],
    [[3, 0, []], 'yield_hunter'],
    [[3, 1, []], 'vacation_rental_investor'],
    [[3, 2, []], 'flip_investor'],
    [[3, 3, []], 'commercial_investor'],
    [[3, 4, [0, 3]], 'yield_hunter'],
    [[4, [1]], 'student_parent'],
    [[5], 'neutral'],
  ] as [(number | number[])[], string][])('path %j → %s', (path, leaf) => {
    expect(walk(path)).toBe(leaf);
  });

  it('a trait screen never changes the result', () => {
    expect(walk([0, 1, [0, 1, 2]])).toBe(walk([0, 1, []]));
  });
});

// ─── PARITY: a served LEGACY definition still resolves the old leaves ──────────
//
// The pre-FOLLOW-1357 built-in tree is now a fixture: a tenant row authored to its shape must
// keep resolving exactly what the old resolveArchetype() switch did. The path arrays are the
// answer INDICES chosen at each question. Q1 index selects the branch; then Q2 (+ Q3).

describe('parity — a served legacy definition resolves the old leaves', () => {
  const walk = (indices: number[]): string =>
    resolveArchetypeFromPath(LEGACY_QUIZ_DEFINITION, indices);

  it('Q1-D (skip) → neutral', () => {
    expect(walk([3])).toBe('neutral');
  });

  // INWESTOR (Q1 index 0)
  it('INWESTOR Q2-A Q3-A → yield_hunter', () => {
    expect(walk([0, 0, 0])).toBe('yield_hunter');
  });
  it('INWESTOR Q2-A Q3-B → portfolio_builder', () => {
    expect(walk([0, 0, 1])).toBe('portfolio_builder');
  });
  it('INWESTOR Q2-A Q3-C → golden_visa_buyer', () => {
    expect(walk([0, 0, 2])).toBe('golden_visa_buyer');
  });
  it('INWESTOR Q2-B → vacation_rental_investor', () => {
    expect(walk([0, 1])).toBe('vacation_rental_investor');
  });
  it('INWESTOR Q2-C → flip_investor', () => {
    expect(walk([0, 2])).toBe('flip_investor');
  });
  it('INWESTOR Q2-D → commercial_investor', () => {
    expect(walk([0, 3])).toBe('commercial_investor');
  });

  // OWN_USE (Q1 index 1) — Q3-B overrides to luxury, Q3-C to remote, else confirm base
  it('OWN_USE Q2-A Q3-A → first_time_buyer', () => {
    expect(walk([1, 0, 0])).toBe('first_time_buyer');
  });
  it('OWN_USE Q2-B Q3-A → family_buyer', () => {
    expect(walk([1, 1, 0])).toBe('family_buyer');
  });
  it('OWN_USE Q2-C Q3-A → upsizer', () => {
    expect(walk([1, 2, 0])).toBe('upsizer');
  });
  it('OWN_USE Q2-D Q3-D → downsizer', () => {
    expect(walk([1, 3, 3])).toBe('downsizer');
  });
  it('OWN_USE Q2-A Q3-B → luxury_buyer (override)', () => {
    expect(walk([1, 0, 1])).toBe('luxury_buyer');
  });
  it('OWN_USE Q2-D Q3-B → luxury_buyer (override beats base)', () => {
    expect(walk([1, 3, 1])).toBe('luxury_buyer');
  });
  it('OWN_USE Q2-A Q3-C → remote_worker (override)', () => {
    expect(walk([1, 0, 2])).toBe('remote_worker');
  });
  it('OWN_USE Q2-C Q3-C → remote_worker (override)', () => {
    expect(walk([1, 2, 2])).toBe('remote_worker');
  });

  // CROSS_BORDER (Q1 index 2)
  it('CROSS_BORDER Q2-A Q3-A → retiree_relocator', () => {
    expect(walk([2, 0, 0])).toBe('retiree_relocator');
  });
  it('CROSS_BORDER Q2-A Q3-B → diaspora_buyer', () => {
    expect(walk([2, 0, 1])).toBe('diaspora_buyer');
  });
  it('CROSS_BORDER Q2-A Q3-C → lifestyle_expat', () => {
    expect(walk([2, 0, 2])).toBe('lifestyle_expat');
  });
  it('CROSS_BORDER Q2-B → second_home_buyer', () => {
    expect(walk([2, 1])).toBe('second_home_buyer');
  });
  it('CROSS_BORDER Q2-C → student_parent', () => {
    expect(walk([2, 2])).toBe('student_parent');
  });

  it('covers exactly the 17 non-neutral archetypes', () => {
    const paths: number[][] = [
      [0, 0, 0],
      [0, 0, 1],
      [0, 0, 2],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0, 0],
      [1, 1, 0],
      [1, 2, 0],
      [1, 3, 3],
      [1, 0, 1],
      [1, 0, 2],
      [2, 0, 0],
      [2, 0, 1],
      [2, 0, 2],
      [2, 1],
      [2, 2],
    ];
    const resolved = new Set(paths.map(walk));
    expect(resolved).toEqual(
      new Set([
        'yield_hunter',
        'portfolio_builder',
        'golden_visa_buyer',
        'vacation_rental_investor',
        'flip_investor',
        'commercial_investor',
        'first_time_buyer',
        'family_buyer',
        'upsizer',
        'downsizer',
        'luxury_buyer',
        'remote_worker',
        'retiree_relocator',
        'diaspora_buyer',
        'lifestyle_expat',
        'second_home_buyer',
        'student_parent',
      ]),
    );
  });
});

// ─── Generic walker on a CUSTOM served tree ────────────────────────────────────

describe('resolveArchetypeFromPath — custom served tree', () => {
  const custom: QuizDefinition = {
    schema_version: 1,
    root: 'start',
    languages: ['en'],
    questions: [
      {
        id: 'start',
        prompt_i18n: { en: 'Pick one' },
        answers: [
          { id: 'a', label_i18n: { en: 'Luxury' }, weights: { luxury_buyer: 5 }, next: null },
          { id: 'b', label_i18n: { en: 'None' }, weights: {}, next: null },
        ],
      },
    ],
  };

  it('resolves the custom leaf archetype', () => {
    expect(resolveArchetypeFromPath(custom, [0])).toBe('luxury_buyer');
  });

  it('resolves an all-zero path to neutral', () => {
    expect(resolveArchetypeFromPath(custom, [1])).toBe('neutral');
  });
});

// ─── resolveLabel — i18n fallback ──────────────────────────────────────────────

describe('resolveLabel', () => {
  it('returns the requested language when present', () => {
    expect(resolveLabel({ en: 'Hi', pl: 'Cześć' }, 'pl')).toBe('Cześć');
  });

  it('falls back to en when the requested language is absent', () => {
    expect(resolveLabel({ en: 'Hi' }, 'pl')).toBe('Hi');
  });

  it('falls back to the first present value when en is absent', () => {
    expect(resolveLabel({ es: 'Hola' }, 'pl')).toBe('Hola');
  });
});
