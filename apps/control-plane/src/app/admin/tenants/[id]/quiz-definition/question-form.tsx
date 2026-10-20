'use client';

/**
 * QuizQuestionForm — structured, form-based editor over a quiz draft's QUESTIONS
 * (FOLLOW-1003, extended by FOLLOW-1362 C2).
 *
 * C2 turns the English-text-only form into the full structured editor: every question is a
 * {@link QuestionCard} (EN | PL side by side, "PL n/m" meter, kind, rename, remove), every answer
 * an {@link AnswerRow} (`next` dropdown, "Resolves to" picker, traits, collapsed Advanced
 * weights); this component adds the question list, "Add question" and the language switches.
 * The parent editor keeps the JSON textarea as the single source of truth and the advanced
 * surface; this form is a pure view over the draft (`onChange` receives the new draft).
 *
 * Pure component: no fetches, no persistence — the parent's Save remains the only mutation path
 * (audited, versioned PUT).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/question-form
 */

import { useState } from 'react';

import type { QuizDefinition } from '@estalara/shared';

import type { OnDraftChange } from './answer-row';
import { addQuestion, setLocaleText, toggleLanguage } from './definition-ops';
import { QuestionCard } from './question-card';

/** Immutably set a question's `en` prompt. Exported for direct unit testing. */
export function updatePrompt(def: QuizDefinition, qid: string, value: string): QuizDefinition {
  return setLocaleText(def, { qid }, 'en', value);
}

/** Immutably set an answer's `en` label. Exported for direct unit testing. */
export function updateLabel(
  def: QuizDefinition,
  qid: string,
  aid: string,
  value: string,
): QuizDefinition {
  return setLocaleText(def, { qid, aid }, 'en', value);
}

export function QuizQuestionForm({
  definition,
  onChange,
  readOnly = false,
}: {
  definition: QuizDefinition;
  onChange: (next: QuizDefinition) => void;
  readOnly?: boolean;
}): React.JSX.Element {
  const [notice, setNotice] = useState<string | null>(null);

  const handle: OnDraftChange = (next, message) => {
    setNotice(message ?? null);
    onChange(next);
  };

  return (
    <div data-testid="question-form" className="mb-6 space-y-4">
      <p className="text-xs text-gray-500">
        Every text needs an English and a Polish version. Pick where each answer leads; an answer
        that ends the quiz resolves to an archetype. Use “Suggest weights (AI)” after rewording.
      </p>
      <div className="flex items-center gap-4 text-xs text-gray-600">
        <span>Languages:</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked disabled /> EN
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked disabled /> PL
        </label>
        <label className="flex items-center gap-1" title="No ES texts yet: buyers see English">
          <input
            type="checkbox"
            data-testid="lang-es"
            checked={definition.languages.includes('es')}
            disabled={readOnly}
            onChange={() => {
              handle(toggleLanguage(definition, 'es'));
            }}
          />{' '}
          ES (falls back to EN)
        </label>
      </div>
      {notice !== null && (
        <p
          role="status"
          data-testid="form-notice"
          className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800"
        >
          {notice}
        </p>
      )}
      {definition.questions.map((q) => (
        <QuestionCard
          key={q.id}
          definition={definition}
          question={q}
          readOnly={readOnly}
          onChange={handle}
        />
      ))}
      <button
        type="button"
        data-testid="add-question"
        disabled={readOnly || definition.questions.length >= 40}
        onClick={() => {
          handle(addQuestion(definition), 'Question added. Point an answer at it to link it in.');
        }}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
      >
        + Add question
      </button>
    </div>
  );
}
