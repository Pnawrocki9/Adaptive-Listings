'use client';

/**
 * ConfirmationTab — edits `confirm` (FOLLOW-1362 C2): for every archetype some path resolves to,
 * the confirmation name and one-sentence summary (EN | PL side by side) and the 2–4 "Not quite"
 * alternatives. An alternative that is not itself a reachable result still needs an EN + PL name
 * (lint `confirm_alternative_unnamed`), so those names are edited in a second block.
 *
 * Text shown to the buyer: "Based on your answers: {name} — {sentence}. Is that right?".
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/confirmation-tab
 */

import { useState } from 'react';

import type { QuizDefinition, QuizLanguage } from '@estalara/shared';
import { CANONICAL_ARCHETYPE_IDS } from '@estalara/shared';

import type { OnDraftChange } from './answer-row';
import { reachableResults, setAlternatives, setConfirmText } from './definition-ops';

const RESULT_IDS = CANONICAL_ARCHETYPE_IDS.filter((id) => id !== 'neutral');
const LANGS: readonly QuizLanguage[] = ['en', 'pl'];
const INPUT =
  'w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50';

function TextPair({
  definition,
  field,
  id,
  testPrefix,
  readOnly,
  onChange,
}: {
  definition: QuizDefinition;
  field: 'names_i18n' | 'sentences_i18n';
  id: string;
  testPrefix: string;
  readOnly: boolean;
  onChange: OnDraftChange;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2">
      {LANGS.map((lang) => (
        <input
          key={lang}
          type="text"
          aria-label={`${lang.toUpperCase()} ${field === 'names_i18n' ? 'name' : 'sentence'} of ${id}`}
          data-testid={`${testPrefix}-${lang}-${id}`}
          value={definition.confirm?.[field][id]?.[lang] ?? ''}
          disabled={readOnly}
          onChange={(e) => {
            onChange(setConfirmText(definition, field, id, lang, e.target.value));
          }}
          className={INPUT}
        />
      ))}
    </div>
  );
}

export function ConfirmationTab({
  definition,
  readOnly,
  onChange,
}: {
  definition: QuizDefinition;
  readOnly: boolean;
  onChange: OnDraftChange;
}): React.JSX.Element {
  // A single alternative is not a valid `confirm` (the schema needs 2–4), so it must never reach
  // the draft — that would flip the whole form to "fix the JSON". The first tick is held here.
  const [pending, setPending] = useState<Record<string, string[]>>({});
  const results = reachableResults(definition);
  const alternatives = definition.confirm?.alternatives ?? {};
  const alsoNamed = [...new Set(Object.values(alternatives).flat())]
    .filter((id) => !results.includes(id))
    .sort();

  function chosenOf(id: string): string[] {
    const committed = alternatives[id] ?? [];
    return committed.length === 0 ? (pending[id] ?? []) : committed;
  }

  function toggleAlt(id: string, alt: string): void {
    const current = chosenOf(id);
    const next = current.includes(alt) ? current.filter((x) => x !== alt) : [...current, alt];
    setPending((p) => ({ ...p, [id]: next.length === 1 ? next : [] }));
    onChange(setAlternatives(definition, id, next.length >= 2 ? next : []));
  }

  return (
    <div data-testid="confirmation-tab" className="mb-6 space-y-4">
      <p className="text-xs text-gray-500">
        Shown after the last question: “Based on your answers: <i>name</i> — <i>sentence</i>. Is
        that right?” Each reachable result needs a name and a sentence in English and Polish, and
        2–4 alternatives for “Not quite”.
      </p>
      {results.length === 0 && (
        <p className="text-sm text-gray-400">No question path resolves to an archetype yet.</p>
      )}
      {results.map((id) => {
        const chosen = chosenOf(id);
        return (
          <div
            key={id}
            data-testid={`cf-card-${id}`}
            className="rounded-xl border border-gray-200 bg-white p-4"
          >
            <p className="mb-2 font-mono text-xs text-gray-500">{id}</p>
            <div className="mb-1 grid grid-cols-2 gap-2 text-xs font-medium text-gray-500">
              <span>Name — EN</span>
              <span>Nazwa — PL</span>
            </div>
            <TextPair
              definition={definition}
              field="names_i18n"
              id={id}
              testPrefix="cf-name"
              readOnly={readOnly}
              onChange={onChange}
            />
            <div className="mb-1 mt-3 grid grid-cols-2 gap-2 text-xs font-medium text-gray-500">
              <span>Sentence — EN</span>
              <span>Zdanie — PL</span>
            </div>
            <TextPair
              definition={definition}
              field="sentences_i18n"
              id={id}
              testPrefix="cf-sentence"
              readOnly={readOnly}
              onChange={onChange}
            />
            <p className="mb-1 mt-3 text-xs font-medium text-gray-500">
              Not quite — alternatives ({String(chosen.length)}/4)
            </p>
            {chosen.length === 1 && (
              <p data-testid={`cf-alt-hint-${id}`} className="mb-1 text-xs text-amber-700">
                Pick at least 2 — one alternative is not saved yet.
              </p>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {RESULT_IDS.filter((alt) => alt !== id).map((alt) => (
                <label key={alt} className="flex items-center gap-1 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    data-testid={`cf-alt-${id}-${alt}`}
                    checked={chosen.includes(alt)}
                    disabled={readOnly || (!chosen.includes(alt) && chosen.length >= 4)}
                    onChange={() => {
                      toggleAlt(id, alt);
                    }}
                  />
                  {alt}
                </label>
              ))}
            </div>
          </div>
        );
      })}
      {alsoNamed.length > 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 p-4">
          <p className="mb-2 text-xs font-medium text-gray-500">
            Offered as an alternative only — these also need a name (EN | PL)
          </p>
          {alsoNamed.map((id) => (
            <div key={id} className="mb-2">
              <p className="font-mono text-xs text-gray-500">{id}</p>
              <TextPair
                definition={definition}
                field="names_i18n"
                id={id}
                testPrefix="cf-name"
                readOnly={readOnly}
                onChange={onChange}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
