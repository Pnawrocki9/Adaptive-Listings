/**
 * Tests for applySuggestions (FOLLOW-1002) — the pure client-side merge of LLM
 * weight proposals into a quiz draft.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/apply-suggestions.test
 */

import { describe, expect, it } from 'vitest';
import type { QuizDefinition } from '@estalara/shared';

import { applySuggestions } from './apply-suggestions';

const DEF: QuizDefinition = {
  schema_version: 1,
  root: 'q_gate',
  languages: ['en'],
  questions: [
    {
      id: 'q_gate',
      prompt_i18n: { en: 'What are you looking for?' },
      answers: [
        {
          id: 'a_invest',
          label_i18n: { en: 'Investment property' },
          weights: { yield_hunter: 0.2 },
          next: 'q_focus',
        },
        { id: 'a_skip', label_i18n: { en: 'Just browsing' }, weights: {}, next: null },
      ],
    },
    {
      id: 'q_focus',
      prompt_i18n: { en: 'What is your focus?' },
      answers: [
        { id: 'a_yield', label_i18n: { en: 'Rental income' }, weights: {}, next: null },
        {
          id: 'a_flip',
          label_i18n: { en: 'Flip / renovation' },
          weights: { flip_investor: 0.5 },
          next: null,
        },
      ],
    },
  ],
};

describe('applySuggestions (FOLLOW-1002)', () => {
  it('REPLACES weights on targeted pairs and preserves everything else verbatim', () => {
    const out = applySuggestions(DEF, [
      { question_id: 'q_focus', answer_id: 'a_yield', weights: { yield_hunter: 1 } },
    ]);

    // Targeted answer got the proposed vector.
    expect(out.questions[1]!.answers[0]!.weights).toEqual({ yield_hunter: 1 });
    // Untargeted answers keep their existing weights (incl. non-empty ones).
    expect(out.questions[0]!.answers[0]!.weights).toEqual({ yield_hunter: 0.2 });
    expect(out.questions[1]!.answers[1]!.weights).toEqual({ flip_investor: 0.5 });
    // Structure/prompts/branching untouched.
    expect(out.root).toBe('q_gate');
    expect(out.questions[0]!.answers[0]!.next).toBe('q_focus');
    expect(out.questions[1]!.prompt_i18n).toEqual({ en: 'What is your focus?' });
  });

  it('replacement is total, not a merge — stale keys on the answer are dropped', () => {
    const out = applySuggestions(DEF, [
      { question_id: 'q_focus', answer_id: 'a_flip', weights: { upsizer: 0.9 } },
    ]);
    // flip_investor: 0.5 must NOT survive under the new vector.
    expect(out.questions[1]!.answers[1]!.weights).toEqual({ upsizer: 0.9 });
  });

  it('ignores pairs that no longer exist in the draft (drift between suggest and apply)', () => {
    const out = applySuggestions(DEF, [
      { question_id: 'q_gone', answer_id: 'a_gone', weights: { upsizer: 1 } },
      { question_id: 'q_focus', answer_id: 'a_gone', weights: { upsizer: 1 } },
    ]);
    expect(out).toEqual(DEF);
  });

  it('does not mutate its input', () => {
    const before = structuredClone(DEF);
    applySuggestions(DEF, [
      { question_id: 'q_focus', answer_id: 'a_yield', weights: { yield_hunter: 1 } },
    ]);
    expect(DEF).toEqual(before);
  });
});
