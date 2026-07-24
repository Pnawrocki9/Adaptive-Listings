/**
 * FOLLOW-273 / FOLLOW-639: SDK quiz/locale path references the canonical shared enum.
 *
 * FOLLOW-273 originally asserted `QUIZ_CONTENT` keys equalled `QUIZ_LANGUAGE_VALUES`. Under
 * FOLLOW-639 (ADR-0019 D5/D6) the hardcoded multilingual `QUIZ_CONTENT` was replaced by the
 * built-in `DEFAULT_QUIZ_DEFINITION` (EN-only) plus the served-per-tenant definition, so the
 * question/answer strings no longer live in a fixed language-keyed record. What remains
 * canonical:
 *   - `DEFAULT_QUIZ_DEFINITION.languages` are all members of `QUIZ_LANGUAGE_VALUES` (the SDK
 *     never declares a language outside the shared enum);
 *   - `LocaleSchema.options` (description pipeline) equals `QUIZ_LANGUAGE_VALUES` (single
 *     source of truth, AC2 — unchanged by FOLLOW-639).
 */

import { describe, expect, it } from 'vitest';

import { QUIZ_LANGUAGE_VALUES, LocaleSchema } from '@estalara/shared';

import { DEFAULT_QUIZ_DEFINITION } from '../ui/quiz-widget.js';

describe('FOLLOW-273/639: quiz/locale canonical enum parity', () => {
  it('DEFAULT_QUIZ_DEFINITION.languages are all canonical language values', () => {
    for (const lang of DEFAULT_QUIZ_DEFINITION.languages) {
      expect(QUIZ_LANGUAGE_VALUES).toContain(lang);
    }
  });

  it('LocaleSchema.options matches QUIZ_LANGUAGE_VALUES (single source of truth, AC2)', () => {
    // LocaleSchema is z.enum(QUIZ_LANGUAGE_VALUES), so .options must equal the tuple.
    const localeOptions = [...LocaleSchema.options].sort();
    const quizValues = [...QUIZ_LANGUAGE_VALUES].sort();
    expect(localeOptions).toEqual(quizValues);
  });
});
