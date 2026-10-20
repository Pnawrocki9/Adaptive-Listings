'use client';

/**
 * QuestionCard — one question of the structured editor (FOLLOW-1362 C2): id (renamable, rewrites
 * `root` and every `next`), single/multi kind, EN | PL prompt side by side, the "PL n/m"
 * completeness meter, remove, add-answer and the {@link AnswerRow}s.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/question-card
 */

import { useState } from 'react';

import type { QuizDefinition, QuizQuestion } from '@estalara/shared';

import { AnswerRow, type OnDraftChange } from './answer-row';
import {
  addAnswer,
  questionCompleteness,
  removeQuestion,
  renameQuestionId,
  setLocaleText,
  setQuestionKind,
} from './definition-ops';

export interface QuestionCardProps {
  definition: QuizDefinition;
  question: QuizQuestion;
  readOnly: boolean;
  onChange: OnDraftChange;
}

const INPUT =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50';

export function QuestionCard({
  definition,
  question: q,
  readOnly,
  onChange,
}: QuestionCardProps): React.JSX.Element {
  const [idDraft, setIdDraft] = useState(q.id);
  const isRoot = definition.root === q.id;
  const pl = questionCompleteness(q, 'pl');
  const multi = q.kind === 'multi';

  function commitId(): void {
    if (idDraft === q.id) return;
    try {
      onChange(renameQuestionId(definition, q.id, idDraft), `Renamed "${q.id}" to "${idDraft}".`);
    } catch (err) {
      onChange(definition, err instanceof Error ? err.message : 'Cannot rename the question.');
      setIdDraft(q.id);
    }
  }

  function remove(): void {
    const res = removeQuestion(definition, q.id);
    const notice = res.refused
      ? 'The root question cannot be removed.'
      : res.flagged.length > 0
        ? `Removed "${q.id}". These answers pointed at it and now end the quiz: ` +
          res.flagged.map((f) => `${f.question_id}/${f.answer_id}`).join(', ')
        : `Removed "${q.id}".`;
    onChange(res.definition, notice);
  }

  return (
    <div
      data-testid={`question-card-${q.id}`}
      className="rounded-xl border border-gray-200 bg-white p-4"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          aria-label={`Id of ${q.id}`}
          data-testid={`qf-id-${q.id}`}
          value={idDraft}
          disabled={readOnly}
          onChange={(e) => {
            setIdDraft(e.target.value);
          }}
          onBlur={commitId}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitId();
          }}
          className="w-44 rounded border border-gray-200 px-2 py-0.5 font-mono text-xs text-gray-600 disabled:bg-gray-50"
        />
        {isRoot && (
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
            root
          </span>
        )}
        <span
          data-testid={`pl-meter-${q.id}`}
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${pl.filled === pl.total ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}
        >
          {`PL ${String(pl.filled)}/${String(pl.total)}`}
        </span>
        <label className="ml-auto flex items-center gap-1 text-xs text-gray-600">
          Type
          <select
            data-testid={`qf-kind-${q.id}`}
            value={multi ? 'multi' : 'single'}
            disabled={readOnly}
            onChange={(e) => {
              onChange(
                setQuestionKind(definition, q.id, e.target.value === 'multi' ? 'multi' : 'single'),
                e.target.value === 'multi'
                  ? `"${q.id}" is now a trait screen: answer weights and next were cleared.`
                  : undefined,
              );
            }}
            className="rounded border border-gray-300 bg-white px-2 py-1"
          >
            <option value="single">Single choice</option>
            <option value="multi">Trait screen (tick all that apply)</option>
          </select>
        </label>
        <button
          type="button"
          data-testid={`qf-remove-${q.id}`}
          disabled={readOnly || isRoot}
          title={isRoot ? 'The root question cannot be removed' : undefined}
          onClick={remove}
          className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 disabled:opacity-40"
        >
          Remove question
        </button>
      </div>

      <div className="mb-1 grid grid-cols-2 gap-2 text-xs font-medium text-gray-500">
        <span>Question — EN</span>
        <span>Pytanie — PL</span>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <input
          type="text"
          data-testid={`qf-prompt-${q.id}`}
          aria-label={`EN prompt of ${q.id}`}
          value={q.prompt_i18n.en ?? ''}
          disabled={readOnly}
          onChange={(e) => {
            onChange(setLocaleText(definition, { qid: q.id }, 'en', e.target.value));
          }}
          className={INPUT}
        />
        <input
          type="text"
          data-testid={`qf-prompt-pl-${q.id}`}
          aria-label={`PL prompt of ${q.id}`}
          value={q.prompt_i18n.pl ?? ''}
          disabled={readOnly}
          onChange={(e) => {
            onChange(setLocaleText(definition, { qid: q.id }, 'pl', e.target.value));
          }}
          className={INPUT}
        />
      </div>

      <div className="space-y-2">
        {q.answers.map((a, i) => (
          <AnswerRow
            key={a.id}
            definition={definition}
            question={q}
            answer={a}
            index={i}
            readOnly={readOnly}
            onChange={onChange}
          />
        ))}
      </div>
      <button
        type="button"
        data-testid={`qf-add-answer-${q.id}`}
        disabled={readOnly || q.answers.length >= 8}
        onClick={() => {
          onChange(addAnswer(definition, q.id));
        }}
        className="mt-2 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-40"
      >
        + Add answer
      </button>
    </div>
  );
}
