/**
 * FOLLOW-1356 — a pinned table of `resolveArchetypeFromPath` on the SDK's built-in (legacy)
 * tree, generated from the implementation that lived in `ui/quiz-widget.ts` before the walker
 * moved to `@estalara/shared` (commit 0857a7aa). It protects the widget refactor of
 * FOLLOW-1357 (Q2): valid prefixes of length 0-3, invalid indexes (-1, 99) at every position,
 * and over-long paths (lengths 4-6, where the walk has already ended). An invalid index stops
 * the walk and keeps what was accumulated so far; an empty accumulation is `neutral`.
 *
 * FOLLOW-1357: the v3.0 tree replaced the legacy one as the built-in; the legacy tree lives on as
 * a fixture (`fixtures/legacy-quiz-definition.ts`) because served rows may still have its shape.
 */

import { describe, expect, it } from 'vitest';

import { resolveArchetypeFromPath } from '../ui/quiz-widget.js';
import { LEGACY_QUIZ_DEFINITION } from './fixtures/legacy-quiz-definition.js';

const LEGACY_TABLE: [number[], string][] = [
  [[], 'neutral'],
  [[0], 'neutral'],
  [[0, 0], 'neutral'],
  [[0, 0, 0], 'yield_hunter'],
  [[0, 0, 1], 'portfolio_builder'],
  [[0, 0, 2], 'golden_visa_buyer'],
  [[0, 1], 'vacation_rental_investor'],
  [[0, 2], 'flip_investor'],
  [[0, 3], 'commercial_investor'],
  [[1], 'neutral'],
  [[1, 0], 'first_time_buyer'],
  [[1, 0, 0], 'first_time_buyer'],
  [[1, 0, 1], 'luxury_buyer'],
  [[1, 0, 2], 'remote_worker'],
  [[1, 0, 3], 'first_time_buyer'],
  [[1, 1], 'family_buyer'],
  [[1, 1, 0], 'family_buyer'],
  [[1, 1, 1], 'luxury_buyer'],
  [[1, 1, 2], 'remote_worker'],
  [[1, 1, 3], 'family_buyer'],
  [[1, 2], 'upsizer'],
  [[1, 2, 0], 'upsizer'],
  [[1, 2, 1], 'luxury_buyer'],
  [[1, 2, 2], 'remote_worker'],
  [[1, 2, 3], 'upsizer'],
  [[1, 3], 'downsizer'],
  [[1, 3, 0], 'downsizer'],
  [[1, 3, 1], 'luxury_buyer'],
  [[1, 3, 2], 'remote_worker'],
  [[1, 3, 3], 'downsizer'],
  [[2], 'neutral'],
  [[2, 0], 'neutral'],
  [[2, 0, 0], 'retiree_relocator'],
  [[2, 0, 1], 'diaspora_buyer'],
  [[2, 0, 2], 'lifestyle_expat'],
  [[2, 1], 'second_home_buyer'],
  [[2, 2], 'student_parent'],
  [[3], 'neutral'],
  // invalid indexes (-1, 99) at every position
  [[-1, 0, 0], 'neutral'],
  [[99, 0, 0], 'neutral'],
  [[0, -1, 0], 'neutral'],
  [[0, 99, 0], 'neutral'],
  [[0, 0, -1], 'neutral'],
  [[0, 0, 99], 'neutral'],
  [[-1, 2], 'neutral'],
  [[99, 2], 'neutral'],
  [[0, -1], 'neutral'],
  [[0, 99], 'neutral'],
  [[-1, 0, 2], 'neutral'],
  [[99, 0, 2], 'neutral'],
  [[1, -1, 2], 'neutral'],
  [[1, 99, 2], 'neutral'],
  [[1, 0, -1], 'first_time_buyer'],
  [[1, 0, 99], 'first_time_buyer'],
  [[-1, 1, 2], 'neutral'],
  [[99, 1, 2], 'neutral'],
  [[1, 1, -1], 'family_buyer'],
  [[1, 1, 99], 'family_buyer'],
  [[-1, 2, 2], 'neutral'],
  [[99, 2, 2], 'neutral'],
  [[1, 2, -1], 'upsizer'],
  [[1, 2, 99], 'upsizer'],
  [[-1, 3, 2], 'neutral'],
  [[99, 3, 2], 'neutral'],
  [[1, 3, -1], 'downsizer'],
  [[1, 3, 99], 'downsizer'],
  [[2, -1, 2], 'neutral'],
  [[2, 99, 2], 'neutral'],
  [[2, 0, -1], 'neutral'],
  [[2, 0, 99], 'neutral'],
  // over-long paths: the walk ended at a leaf, the extra indexes are ignored (lengths 4-6)
  [[0, 0, 0, 0], 'yield_hunter'],
  [[0, 0, 0, 0, 0], 'yield_hunter'],
  [[0, 0, 0, 0, 0, 0], 'yield_hunter'],
  [[1, 0, 1, 0], 'luxury_buyer'],
  [[1, 0, 1, 0, 0], 'luxury_buyer'],
  [[1, 0, 1, 0, 0, 0], 'luxury_buyer'],
  [[1, 2, 0, 0], 'upsizer'],
  [[1, 2, 0, 0, 0], 'upsizer'],
  [[1, 2, 0, 0, 0, 0], 'upsizer'],
  [[1, 3, 3, 0], 'downsizer'],
  [[1, 3, 3, 0, 0], 'downsizer'],
  [[1, 3, 3, 0, 0, 0], 'downsizer'],
];

describe('resolveArchetypeFromPath on the legacy tree (pinned before the Q2 widget refactor)', () => {
  it('covers path lengths 0-6 and both invalid indexes', () => {
    const lengths = new Set(LEGACY_TABLE.map(([p]) => p.length));
    expect([...lengths].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(LEGACY_TABLE.some(([p]) => p.includes(-1))).toBe(true);
    expect(LEGACY_TABLE.some(([p]) => p.includes(99))).toBe(true);
  });

  it.each(LEGACY_TABLE)('path %j resolves to %s', (path, expected) => {
    expect(resolveArchetypeFromPath(LEGACY_QUIZ_DEFINITION, path)).toBe(expected);
  });
});
