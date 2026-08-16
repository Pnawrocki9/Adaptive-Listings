'use client';

/**
 * QuizQuestionForm — structured, form-based editor over a quiz draft's QUESTIONS
 * (FOLLOW-1003).
 *
 * The CEO's report that prompted this: the quiz-definition surface existed but was
 * a raw JSON textarea — there was no view where "the quiz questions live and can be
 * edited". This form renders every question and answer of the CURRENT draft as
 * plain inputs (question prompt, answer labels — the text staff actually rewords)
 * and calls back with an immutably-updated definition on every edit. The parent
 * editor keeps the JSON textarea as the single source of truth and the advanced
 * surface: structure changes (add/remove questions or answers, branching, extra
 * locales) stay JSON edits, and weights stay the "Suggest weights (AI)" flow —
 * this form deliberately edits the `en` text layer only, showing weights and
 * branching read-only so the reworder can see what their edit affects.
 *
 * Pure component: no fetches, no persistence — the parent's Save remains the only
 * mutation path (audited, versioned PUT).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/question-form
 */

import type { QuizDefinition } from '@estalara/shared';

/** Immutably set a question's `en` prompt. Exported for direct unit testing. */
export function updatePrompt(def: QuizDefinition, qid: string, value: string): QuizDefinition {
  return {
    ...def,
    questions: def.questions.map((q) =>
      q.id === qid ? { ...q, prompt_i18n: { ...q.prompt_i18n, en: value } } : q,
    ),
  };
}

/** Immutably set an answer's `en` label. Exported for direct unit testing. */
export function updateLabel(
  def: QuizDefinition,
  qid: string,
  aid: string,
  value: string,
): QuizDefinition {
  return {
    ...def,
    questions: def.questions.map((q) =>
      q.id === qid
        ? {
            ...q,
            answers: q.answers.map((a) =>
              a.id === aid ? { ...a, label_i18n: { ...a.label_i18n, en: value } } : a,
            ),
          }
        : q,
    ),
  };
}

function weightsSummary(weights: Record<string, number>): string {
  const entries = Object.entries(weights);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k}: ${String(v)}`).join(', ');
}

export function QuizQuestionForm({
  definition,
  onChange,
}: {
  definition: QuizDefinition;
  onChange: (next: QuizDefinition) => void;
}): React.JSX.Element {
  return (
    <div data-testid="question-form" className="mb-6 space-y-4">
      <p className="text-xs text-gray-500">
        Edit question and answer text directly (English). Branching and weights are shown for
        context — change structure in the JSON below, and derive weights with “Suggest weights (AI)”
        after rewording.
      </p>
      {definition.questions.map((q) => (
        <div key={q.id} className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-xs text-gray-400">{q.id}</span>
            {definition.root === q.id && (
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                root
              </span>
            )}
          </div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Question</label>
          <input
            type="text"
            data-testid={`qf-prompt-${q.id}`}
            value={q.prompt_i18n.en ?? ''}
            onChange={(e) => {
              onChange(updatePrompt(definition, q.id, e.target.value));
            }}
            className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <div className="space-y-2">
            {q.answers.map((a) => (
              <div key={a.id} className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    data-testid={`qf-label-${q.id}-${a.id}`}
                    value={a.label_i18n.en ?? ''}
                    onChange={(e) => {
                      onChange(updateLabel(definition, q.id, a.id, e.target.value));
                    }}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="shrink-0 font-mono text-xs text-gray-400">
                    {a.next === null ? 'END' : `→ ${a.next}`}
                  </span>
                </div>
                <p className="mt-1 pl-1 font-mono text-[11px] text-gray-400" title="weights">
                  {weightsSummary(a.weights)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
