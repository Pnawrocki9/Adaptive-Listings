'use client';

/**
 * AnswerRow — one answer of a quiz question in the structured editor (FOLLOW-1362 C2).
 *
 * EN and PL inputs sit side by side (both are mandatory — the lint blocks Save without them).
 * A single-choice answer has a `next` dropdown ("End of quiz" or a question that is neither the
 * question itself nor one of its ancestors) and, when it ends the walk, a "Resolves to" archetype
 * picker that writes `weights: {X: 1}`. Free weights live under a collapsed "Advanced"; the
 * "Suggest weights (AI)" flow in the parent editor is unchanged. An answer of a trait screen
 * (`kind: 'multi'`) shows trait checkboxes and none of the branching controls.
 *
 * Pure presentation over {@link ./definition-ops}; persistence stays the parent's audited Save.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/answer-row
 */

import type { QuizAnswer, QuizDefinition, QuizQuestion } from '@estalara/shared';
import { CANONICAL_ARCHETYPE_IDS, CANONICAL_TRAIT_IDS } from '@estalara/shared';

import {
  moveAnswer,
  nextCandidates,
  removeAnswer,
  setLeafArchetype,
  setLocaleText,
  setNext,
  setTraits,
  setWeight,
} from './definition-ops';

/** Edit callback shared by the form components: the new draft plus an optional notice. */
export type OnDraftChange = (next: QuizDefinition, notice?: string) => void;

export interface AnswerRowProps {
  definition: QuizDefinition;
  question: QuizQuestion;
  answer: QuizAnswer;
  index: number;
  readOnly: boolean;
  onChange: OnDraftChange;
}

const RESULT_IDS = CANONICAL_ARCHETYPE_IDS.filter((id) => id !== 'neutral');
const CUSTOM = '__custom__';

function weightsSummary(weights: Record<string, number>): string {
  const entries = Object.entries(weights);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k}: ${String(v)}`).join(', ');
}

/** The picker value for an answer's weights: one archetype at 1, none, or custom. */
function resolvesTo(weights: Record<string, number>): string {
  const entries = Object.entries(weights);
  if (entries.length === 0) return '';
  const [first] = entries;
  return entries.length === 1 && first?.[1] === 1 ? first[0] : CUSTOM;
}

const INPUT =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50';

export function AnswerRow({
  definition,
  question: q,
  answer: a,
  index,
  readOnly,
  onChange,
}: AnswerRowProps): React.JSX.Element {
  const id = `${q.id}-${a.id}`;
  const multi = q.kind === 'multi';
  const candidates = nextCandidates(definition, q.id);
  const nextIsValid = a.next === null || candidates.includes(a.next);
  const traits = a.traits ?? [];

  function toggleTrait(trait: string): void {
    const next = traits.includes(trait) ? traits.filter((t) => t !== trait) : [...traits, trait];
    onChange(setTraits(definition, q.id, a.id, next));
  }

  const traitBoxes = (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {CANONICAL_TRAIT_IDS.map((trait) => (
        <label key={trait} className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            data-testid={`qf-trait-${id}-${trait}`}
            checked={traits.includes(trait)}
            disabled={readOnly}
            onChange={() => {
              toggleTrait(trait);
            }}
          />
          {trait}
        </label>
      ))}
    </div>
  );

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
      <div className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2">
        <span className="font-mono text-[11px] text-gray-400" title={a.id}>
          {String(index + 1)}
        </span>
        <input
          type="text"
          aria-label={`EN label of ${a.id}`}
          data-testid={`qf-label-${id}`}
          value={a.label_i18n.en ?? ''}
          disabled={readOnly}
          onChange={(e) => {
            onChange(setLocaleText(definition, { qid: q.id, aid: a.id }, 'en', e.target.value));
          }}
          className={INPUT}
        />
        <input
          type="text"
          aria-label={`PL label of ${a.id}`}
          data-testid={`qf-label-pl-${id}`}
          value={a.label_i18n.pl ?? ''}
          disabled={readOnly}
          onChange={(e) => {
            onChange(setLocaleText(definition, { qid: q.id, aid: a.id }, 'pl', e.target.value));
          }}
          className={INPUT}
        />
        <span className="flex gap-1 text-xs">
          <button
            type="button"
            data-testid={`qf-up-${id}`}
            aria-label={`Move ${a.id} up`}
            disabled={readOnly || index === 0}
            onClick={() => {
              const moved = moveAnswer(definition, q.id, a.id, index - 1);
              onChange(moved.definition, moved.warning ?? undefined);
            }}
            className="rounded border border-gray-300 px-1.5 disabled:opacity-40"
          >
            ↑
          </button>
          <button
            type="button"
            data-testid={`qf-down-${id}`}
            aria-label={`Move ${a.id} down`}
            disabled={readOnly || index === q.answers.length - 1}
            onClick={() => {
              const moved = moveAnswer(definition, q.id, a.id, index + 1);
              onChange(moved.definition, moved.warning ?? undefined);
            }}
            className="rounded border border-gray-300 px-1.5 disabled:opacity-40"
          >
            ↓
          </button>
          <button
            type="button"
            data-testid={`qf-remove-answer-${id}`}
            aria-label={`Remove answer ${a.id}`}
            disabled={readOnly || q.answers.length <= 2}
            onClick={() => {
              onChange(removeAnswer(definition, q.id, a.id));
            }}
            className="rounded border border-red-200 px-1.5 text-red-600 disabled:opacity-40"
          >
            ✕
          </button>
        </span>
      </div>

      {multi ? (
        <div className="mt-2 pl-5">{traitBoxes}</div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3 pl-5 text-xs text-gray-600">
          <label className="flex items-center gap-1">
            Next
            <select
              data-testid={`qf-next-${id}`}
              value={a.next ?? ''}
              disabled={readOnly}
              onChange={(e) => {
                onChange(setNext(definition, q.id, a.id, e.target.value || null));
              }}
              className="rounded border border-gray-300 bg-white px-2 py-1"
            >
              <option value="">End of quiz</option>
              {!nextIsValid && a.next !== null && (
                <option value={a.next}>{a.next} (invalid: cycle)</option>
              )}
              {candidates.map((cid) => (
                <option key={cid} value={cid}>
                  {cid}
                </option>
              ))}
            </select>
          </label>
          <span className="font-mono text-gray-400">{a.next === null ? 'END' : `→ ${a.next}`}</span>
          {a.next === null && (
            <label className="flex items-center gap-1">
              Resolves to
              <select
                data-testid={`qf-resolves-${id}`}
                value={resolvesTo(a.weights)}
                disabled={readOnly}
                onChange={(e) => {
                  if (e.target.value === CUSTOM) return;
                  onChange(setLeafArchetype(definition, q.id, a.id, e.target.value || null));
                }}
                className="rounded border border-gray-300 bg-white px-2 py-1"
              >
                <option value="">Not sure yet (neutral)</option>
                {resolvesTo(a.weights) === CUSTOM && (
                  <option value={CUSTOM}>Custom weights (see Advanced)</option>
                )}
                {RESULT_IDS.map((rid) => (
                  <option key={rid} value={rid}>
                    {rid}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {!multi && (
        <>
          <p className="mt-1 pl-5 font-mono text-[11px] text-gray-400" title="weights">
            {weightsSummary(a.weights)}
          </p>
          <details className="mt-1 pl-5 text-xs text-gray-600" data-testid={`qf-advanced-${id}`}>
            <summary className="cursor-pointer text-gray-500">Advanced</summary>
            <div className="mt-2 space-y-2">
              {Object.entries(a.weights).map(([arch, weight]) => (
                <label key={arch} className="flex items-center gap-2">
                  <span className="w-44 font-mono">{arch}</span>
                  <input
                    type="number"
                    step="0.1"
                    data-testid={`qf-weight-${id}-${arch}`}
                    value={weight}
                    disabled={readOnly}
                    onChange={(e) => {
                      const n = Number.parseFloat(e.target.value);
                      if (!Number.isNaN(n)) onChange(setWeight(definition, q.id, a.id, arch, n));
                    }}
                    className="w-20 rounded border border-gray-300 px-2 py-1"
                  />
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => {
                      onChange(setWeight(definition, q.id, a.id, arch, null));
                    }}
                    className="text-red-600 disabled:opacity-40"
                  >
                    remove
                  </button>
                </label>
              ))}
              <select
                aria-label={`Add weight to ${a.id}`}
                data-testid={`qf-add-weight-${id}`}
                value=""
                disabled={readOnly}
                onChange={(e) => {
                  if (e.target.value) {
                    onChange(setWeight(definition, q.id, a.id, e.target.value, 1));
                  }
                }}
                className="rounded border border-gray-300 bg-white px-2 py-1"
              >
                <option value="">+ add archetype weight…</option>
                {RESULT_IDS.filter((rid) => !(rid in a.weights)).map((rid) => (
                  <option key={rid} value={rid}>
                    {rid}
                  </option>
                ))}
              </select>
              <div>
                <p className="mb-1 text-gray-500">Traits this answer records</p>
                {traitBoxes}
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
