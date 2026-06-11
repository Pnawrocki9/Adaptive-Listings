/**
 * FOLLOW-273: SDK quiz/locale path must reference canonical shared enum.
 *
 * AC3 parity test: asserts that the keys of `QUIZ_CONTENT` in quiz-widget.ts
 * are exactly equal to `QUIZ_LANGUAGE_VALUES` from `@estalara/shared`.
 *
 * This test catches future locale additions that update `QUIZ_LANGUAGE_VALUES`
 * but forget to add the corresponding content block in `QUIZ_CONTENT` — or vice
 * versa. Without this gate, the SDK would silently `undefined`-index at runtime
 * when `renderQuizWidget` calls `QUIZ_CONTENT[config.language]`.
 *
 * AC2 parity: also asserts that `LocaleSchema.options` (description pipeline)
 * equals `QUIZ_LANGUAGE_VALUES` (quiz/UI), confirming they derive from the same
 * single source (FOLLOW-273: LocaleSchema is now `z.enum(QUIZ_LANGUAGE_VALUES)`).
 */

import { describe, expect, it } from 'vitest';

import { QUIZ_LANGUAGE_VALUES, LocaleSchema } from '@estalara/shared';

import { QUIZ_CONTENT } from '../ui/quiz-widget.js';

describe('FOLLOW-273: quiz/locale canonical enum parity', () => {
  it('QUIZ_CONTENT keys match QUIZ_LANGUAGE_VALUES exactly', () => {
    const quizContentKeys = Object.keys(QUIZ_CONTENT).sort();
    const sharedValues = [...QUIZ_LANGUAGE_VALUES].sort();
    expect(quizContentKeys).toEqual(sharedValues);
  });

  it('every QUIZ_LANGUAGE_VALUES entry has a non-empty QUIZ_CONTENT entry', () => {
    for (const lang of QUIZ_LANGUAGE_VALUES) {
      expect(QUIZ_CONTENT[lang], `QUIZ_CONTENT["${lang}"] must be defined`).toBeDefined();
      expect(
        QUIZ_CONTENT[lang].q1_gate.answers.length,
        `QUIZ_CONTENT["${lang}"].q1_gate.answers must be non-empty`,
      ).toBeGreaterThan(0);
    }
  });

  it('LocaleSchema.options matches QUIZ_LANGUAGE_VALUES (single source of truth, AC2)', () => {
    // LocaleSchema is z.enum(QUIZ_LANGUAGE_VALUES), so .options must equal the tuple.
    const localeOptions = [...LocaleSchema.options].sort();
    const quizValues = [...QUIZ_LANGUAGE_VALUES].sort();
    expect(localeOptions).toEqual(quizValues);
  });
});
