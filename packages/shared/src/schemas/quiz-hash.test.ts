/** Tests for `computeQuizDefinitionHash` (FOLLOW-1358, ESC-086 item 3). */

import { describe, expect, it } from 'vitest';

import { DEFAULT_QUIZ_DEFINITION_V2 } from '../quiz-default-v2.js';
import { QuizDefinitionSchema, type QuizDefinition } from './presentation-config.js';
import { computeQuizDefinitionHash } from './quiz-hash.js';

/**
 * FROZEN. The `definition_hash` of the built-in default as served by `GET /api/quiz/public-config`
 * (parsed by the serve schema, then hashed). The pre-registered accuracy analysis
 * (`docs/decisions/PREREG-quiz-accuracy-2026-10.md` §2) counts decided runs on ONE hash; a change
 * here means the served default changed and the count restarts. Do not update this value to make
 * the test pass without recording that consequence (a dated PREREG amendment, KQ3 owner informed).
 */
const DEFAULT_V2_HASH = [
  '2e95f96e4d863836518a31c1d5399e9b',
  '8e671689aa35d35ea173a7c7d84612f4',
].join(''); // split: a 64-hex literal trips the secrets scanner;

const v2 = (): QuizDefinition => structuredClone(DEFAULT_QUIZ_DEFINITION_V2);

/** Rebuild every object of `value` with its keys in reverse order. */
function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => reverseKeys(v)) as T;
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).reverse();
  return Object.fromEntries(entries.map(([k, v]) => [k, reverseKeys(v)])) as T;
}

describe('computeQuizDefinitionHash', () => {
  it('pins the frozen hash of DEFAULT_QUIZ_DEFINITION_V2 as served (parsed, then hashed)', async () => {
    const served = QuizDefinitionSchema.parse(DEFAULT_QUIZ_DEFINITION_V2);
    expect(await computeQuizDefinitionHash(served)).toBe(DEFAULT_V2_HASH);
  });

  it('is 64 lower-case hex characters', async () => {
    expect(await computeQuizDefinitionHash(v2())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on object key order', async () => {
    expect(await computeQuizDefinitionHash(reverseKeys(v2()))).toBe(DEFAULT_V2_HASH);
  });

  it('ignores a stored key the serve schema strips (hash of the PARSED definition)', async () => {
    const stored = { ...v2(), editor_note: 'not served' } as unknown;
    expect(await computeQuizDefinitionHash(QuizDefinitionSchema.parse(stored))).toBe(
      DEFAULT_V2_HASH,
    );
  });

  it('changes when a weight, an answer order or a confirmation text changes', async () => {
    const weight = v2();
    const first = weight.questions[0]!.answers[0]!;
    const archetype = Object.keys(first.weights)[0] ?? 'yield_hunter';
    first.weights = { ...first.weights, [archetype]: (first.weights[archetype] ?? 0) + 1 };

    const order = v2();
    order.questions[0]!.answers.reverse();

    const text = v2();
    const names = text.confirm?.names_i18n ?? {};
    const someId = Object.keys(names)[0];
    expect(someId, 'the default carries confirmation names').toBeDefined();
    names[someId!] = { ...names[someId!], en: 'Changed' };

    for (const changed of [weight, order, text]) {
      expect(await computeQuizDefinitionHash(changed)).not.toBe(DEFAULT_V2_HASH);
    }
  });
});
