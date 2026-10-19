/**
 * FOLLOW-1356 — the shared quiz model against the SDK's built-in default tree.
 *
 * Pins:
 *   - the SDK re-exports the walker helpers that moved to `@estalara/shared` (same functions);
 *   - `enumerateQuizPaths` agrees with `resolveArchetypeFromPath` and
 *     `computeUnreachableArchetypes` on BOTH default trees (the EN-only built-in and the
 *     EN + PL `DEFAULT_QUIZ_DEFINITION_V2`);
 *   - the built-in tree passes the SERVE schema with no errors but FAILS the authoring schema
 *     only because it has no PL text — which is why FOLLOW-1357 (Q2) replaces it.
 */

import { describe, expect, it } from 'vitest';

import {
  CANONICAL_ARCHETYPE_IDS,
  DEFAULT_QUIZ_DEFINITION_V2,
  QuizDefinitionAuthoringSchema,
  QuizDefinitionSchema,
  computeUnreachableArchetypes,
  enumerateQuizPaths,
  lintQuizDefinition,
  resolveArchetypeFromPath as sharedResolveArchetypeFromPath,
  resolveLabel as sharedResolveLabel,
} from '@estalara/shared';

import {
  DEFAULT_QUIZ_DEFINITION,
  resolveArchetypeFromPath,
  resolveLabel,
} from '../ui/quiz-widget.js';

describe('quiz-widget re-exports the shared walker helpers', () => {
  it('exposes the very same functions under the same names', () => {
    expect(resolveArchetypeFromPath).toBe(sharedResolveArchetypeFromPath);
    expect(resolveLabel).toBe(sharedResolveLabel);
  });
});

describe.each([
  ['the SDK built-in DEFAULT_QUIZ_DEFINITION', DEFAULT_QUIZ_DEFINITION],
  ['DEFAULT_QUIZ_DEFINITION_V2', DEFAULT_QUIZ_DEFINITION_V2],
])('enumerateQuizPaths parity on %s', (_name, def) => {
  const { paths, truncated } = enumerateQuizPaths(def);

  it('enumerates without truncation', () => {
    expect(paths.length).toBeGreaterThan(0);
    expect(truncated).toBe(false);
  });

  it('resolves every path to the same leaf as resolveArchetypeFromPath', () => {
    for (const p of paths) {
      expect(resolveArchetypeFromPath(def, p.selections)).toBe(p.leaf);
    }
  });

  it('reaches exactly the archetypes computeUnreachableArchetypes does not report', () => {
    const reached = new Set<string>(paths.map((p) => p.leaf));
    const unreachable = computeUnreachableArchetypes(def, []);
    for (const id of CANONICAL_ARCHETYPE_IDS) {
      if (id === 'neutral') continue;
      expect(reached.has(id)).toBe(!unreachable.includes(id));
    }
  });
});

describe('the SDK built-in default vs the serve and authoring schemas', () => {
  it('passes the serve schema (so it can still be stored and served)', () => {
    expect(QuizDefinitionSchema.safeParse(DEFAULT_QUIZ_DEFINITION).success).toBe(true);
  });

  it('has no unreachable result to warn about (all 17 archetypes are assigned)', () => {
    expect(computeUnreachableArchetypes(DEFAULT_QUIZ_DEFINITION)).toEqual([]);
  });

  it('fails the authoring schema ONLY for no PL, no confirm block and EN-only languages — Q2 replaces it', () => {
    const parsed = QuizDefinitionAuthoringSchema.safeParse(DEFAULT_QUIZ_DEFINITION);
    expect(parsed.success).toBe(false);
    const { errors } = lintQuizDefinition(DEFAULT_QUIZ_DEFINITION);
    const codes = new Set(errors.map((e) => e.code));
    expect([...codes].sort()).toEqual([
      'confirm_missing',
      'languages_incomplete',
      'missing_translation',
    ]);
    const missing = errors.filter((e) => e.code === 'missing_translation');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((e) => e.path[e.path.length - 1] === 'pl')).toBe(true);
  });

  it('is authored to the old override scheme, so it carries ambiguous paths (warnings)', () => {
    const { warnings } = lintQuizDefinition(DEFAULT_QUIZ_DEFINITION);
    expect(warnings.some((w) => w.code === 'ambiguous_path')).toBe(true);
  });
});
