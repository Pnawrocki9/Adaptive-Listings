/**
 * WeightSuggestionsPanel — renders the LLM weight proposals of "Suggest weights (AI)"
 * (FOLLOW-1002) for review; "Apply all to draft" hands control back to the editor, which merges
 * ONLY weights ({@link ./apply-suggestions}). Advisory: nothing persists until the audited Save.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/weight-suggestions-panel
 */

export interface WeightSuggestion {
  question_id: string;
  answer_id: string;
  weights: Record<string, number>;
  rationale: string;
}

export interface SuggestResponse {
  model: string;
  suggestions: WeightSuggestion[];
  rejected: { question_id: string; answer_id: string; reason: string }[];
}

export function WeightSuggestionsPanel({
  suggest,
  onApply,
}: {
  suggest: SuggestResponse;
  onApply: () => void;
}): React.JSX.Element {
  return (
    <div
      data-testid="weight-suggestions"
      className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm"
    >
      <p className="font-medium text-indigo-900">
        Proposed archetype weights ({suggest.model}) — review, then Apply and Save:
      </p>
      <ul className="mt-2 space-y-2">
        {suggest.suggestions.map((s) => (
          <li key={`${s.question_id}/${s.answer_id}`} className="text-indigo-900">
            <span className="font-mono text-xs">
              {s.question_id} / {s.answer_id}
            </span>{' '}
            → <span className="font-mono text-xs">{JSON.stringify(s.weights)}</span>
            <p className="text-xs text-indigo-700">{s.rationale}</p>
          </li>
        ))}
      </ul>
      {suggest.rejected.length > 0 && (
        <div className="mt-2 text-xs text-amber-800">
          <p className="font-medium">Rejected by validation (not applied):</p>
          <ul className="list-disc pl-5">
            {suggest.rejected.map((r, i) => (
              <li key={i}>
                {r.question_id}/{r.answer_id}: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        data-testid="apply-suggestions"
        onClick={onApply}
        className="mt-3 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
      >
        Apply all to draft
      </button>
    </div>
  );
}
