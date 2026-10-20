'use client';

/**
 * QuizSimulator — walk the DRAFT as a buyer (FOLLOW-1362 C3). It drives the SAME state machine
 * the SDK widget uses (`nextStep`): breadcrumb, the current question (multi = checkboxes), the
 * resolved leaf + traits, then the confirmation screen exactly as the buyer sees it, with the
 * alternatives on "Not quite". A collapsible "all paths" table (`enumerateQuizPaths`) lists every
 * root-to-leaf path with its leaf, flagging ties.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/quiz-simulator
 */

import { useMemo, useState } from 'react';

import type { QuizDefinition, QuizLanguage, QuizPathStep } from '@estalara/shared';
import { enumerateQuizPaths, nextStep, resolveLabel } from '@estalara/shared';

/** The buyer-facing confirmation strings (mirror of the SDK widget's EN / PL copy). */
const COPY = {
  en: {
    basedOn: 'Based on your answers:',
    isRight: 'Is that right?',
    yes: "Yes, that's me",
    no: 'Not quite',
    which: 'Which fits you better?',
    noneAll: 'None of these — show me everything',
    cont: 'Continue',
  },
  pl: {
    basedOn: 'Na podstawie Twoich odpowiedzi:',
    isRight: 'Zgadza się?',
    yes: 'Tak, to ja',
    no: 'Nie do końca',
    which: 'Co pasuje lepiej?',
    noneAll: 'Żadne — pokaż wszystkie oferty',
    cont: 'Dalej',
  },
} as const;

const MAX_TABLE_ROWS = 500;
type Resolution = { kind: 'confirmed' | 'corrected'; archetype: string } | { kind: 'none' };

function pickCopy(lang: QuizLanguage): Record<keyof (typeof COPY)['en'], string> {
  return lang === 'pl' ? COPY.pl : COPY.en;
}

export function QuizSimulator({
  definition,
}: {
  definition: QuizDefinition | null;
}): React.JSX.Element {
  const [lang, setLang] = useState<QuizLanguage>('en');
  const [path, setPath] = useState<QuizPathStep[]>([]);
  const [ticks, setTicks] = useState<number[]>([]);
  const [notQuite, setNotQuite] = useState(false);
  const [resolution, setResolution] = useState<Resolution | null>(null);

  function reset(): void {
    setPath([]);
    setTicks([]);
    setNotQuite(false);
    setResolution(null);
  }

  const paths = useMemo(
    () => (definition ? enumerateQuizPaths(definition) : { paths: [], truncated: false }),
    [definition],
  );

  if (definition === null) {
    return (
      <section data-testid="quiz-simulator" className="mt-6 rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-800">Simulator</h3>
        <p className="mt-1 text-sm text-gray-400">Fix the draft errors above to simulate it.</p>
      </section>
    );
  }

  const copy = pickCopy(lang);
  const step = nextStep(definition, { path, confirmationResolved: resolution !== null });
  const byId = new Map(definition.questions.map((q) => [q.id, q]));
  const question = step.kind === 'question' ? byId.get(step.questionId) : undefined;

  // Breadcrumb: the questions answered so far, with the chosen answer text.
  const crumbs: string[] = [];
  let cursor: string | null = definition.root;
  for (const sel of path) {
    const q: QuizDefinition['questions'][number] | undefined =
      cursor === null ? undefined : byId.get(cursor);
    if (!q) break;
    const picked: QuizDefinition['questions'][number]['answers'] = (
      Array.isArray(sel) ? sel : [sel]
    ).flatMap((i): QuizDefinition['questions'][number]['answers'] => {
      const ans = q.answers[i];
      return ans ? [ans] : [];
    });
    crumbs.push(
      `${resolveLabel(q.prompt_i18n, lang)} → ${picked.map((a) => resolveLabel(a.label_i18n, lang)).join(', ') || '(none)'}`,
    );
    cursor = Array.isArray(sel) ? null : (picked[0]?.next ?? null);
  }

  const confirm = definition.confirm;
  const leaf = step.kind === 'question' ? null : step.leaf;
  const alternatives = leaf && confirm ? (confirm.alternatives[leaf] ?? []) : [];

  function answerLabel(qid: string, aid: string): string {
    const a = byId.get(qid)?.answers.find((x) => x.id === aid);
    return a ? resolveLabel(a.label_i18n, lang) : aid;
  }

  return (
    <section data-testid="quiz-simulator" className="mt-6 rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-800">Simulator</h3>
        <div className="flex items-center gap-2 text-xs">
          {(['en', 'pl'] as const).map((l) => (
            <button
              key={l}
              type="button"
              data-testid={`sim-lang-${l}`}
              aria-pressed={lang === l}
              onClick={() => {
                setLang(l);
              }}
              className={`rounded px-2 py-1 ${lang === l ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-700'}`}
            >
              {l.toUpperCase()}
            </button>
          ))}
          <button
            type="button"
            data-testid="sim-reset"
            onClick={reset}
            className="rounded border border-gray-300 px-2 py-1 text-gray-700"
          >
            Restart
          </button>
        </div>
      </div>

      {crumbs.length > 0 && (
        <ol data-testid="sim-breadcrumb" className="mt-2 list-decimal pl-5 text-xs text-gray-500">
          {crumbs.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ol>
      )}

      {step.kind === 'question' && question && (
        <div data-testid="sim-question" className="mt-3">
          <p className="font-medium text-gray-900">{resolveLabel(question.prompt_i18n, lang)}</p>
          {question.kind === 'multi' ? (
            <div className="mt-2 space-y-1">
              {question.answers.map((a, i) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-testid={`sim-answer-${a.id}`}
                    checked={ticks.includes(i)}
                    onChange={(e) => {
                      setTicks((t) => (e.target.checked ? [...t, i] : t.filter((x) => x !== i)));
                    }}
                  />
                  {resolveLabel(a.label_i18n, lang)}
                </label>
              ))}
              <button
                type="button"
                data-testid="sim-multi-continue"
                onClick={() => {
                  setPath((p) => [...p, [...ticks].sort((a, b) => a - b)]);
                  setTicks([]);
                }}
                className="mt-1 rounded bg-blue-600 px-3 py-1 text-sm text-white"
              >
                {copy.cont}
              </button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {question.answers.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  data-testid={`sim-answer-${a.id}`}
                  onClick={() => {
                    setPath((p) => [...p, i]);
                  }}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  {resolveLabel(a.label_i18n, lang)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step.kind !== 'question' && (
        <div data-testid="sim-result" className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">
          Resolved leaf: <span className="font-mono">{step.leaf}</span> · traits:{' '}
          <span className="font-mono">
            {step.traits.length ? step.traits.join(', ') : '(none)'}
          </span>
        </div>
      )}

      {step.kind === 'confirm' && confirm && leaf && (
        <div data-testid="sim-confirm" className="mt-3 rounded-lg border border-blue-200 p-3">
          <p data-testid="sim-confirm-text">
            {copy.basedOn} <strong>{resolveLabel(confirm.names_i18n[leaf] ?? {}, lang)}</strong> —{' '}
            {resolveLabel(confirm.sentences_i18n[leaf] ?? {}, lang)}. {copy.isRight}
          </p>
          {!notQuite ? (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                data-testid="sim-yes"
                onClick={() => {
                  setResolution({ kind: 'confirmed', archetype: leaf });
                }}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
              >
                {copy.yes}
              </button>
              <button
                type="button"
                data-testid="sim-not-quite"
                onClick={() => {
                  setNotQuite(true);
                }}
                className="rounded border border-gray-300 px-3 py-1 text-sm"
              >
                {copy.no}
              </button>
            </div>
          ) : (
            <div data-testid="sim-alternatives" className="mt-2">
              <p className="text-sm text-gray-600">{copy.which}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {alternatives.map((alt) => (
                  <button
                    key={alt}
                    type="button"
                    data-testid={`sim-alt-${alt}`}
                    onClick={() => {
                      setResolution({ kind: 'corrected', archetype: alt });
                    }}
                    className="rounded border border-gray-300 px-3 py-1 text-sm"
                  >
                    {resolveLabel(confirm.names_i18n[alt] ?? {}, lang) || alt}
                  </button>
                ))}
                <button
                  type="button"
                  data-testid="sim-none"
                  onClick={() => {
                    setResolution({ kind: 'none' });
                  }}
                  className="rounded border border-gray-300 px-3 py-1 text-sm"
                >
                  {copy.noneAll}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {resolution !== null && (
        <p data-testid="sim-resolution" className="mt-3 text-sm text-green-700">
          {resolution.kind === 'none'
            ? 'Buyer chose “none of these”: no archetype is applied.'
            : `Buyer ${resolution.kind === 'confirmed' ? 'confirmed' : 'corrected to'}: ${resolution.archetype}.`}
        </p>
      )}

      <details data-testid="sim-paths" className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-gray-700">
          All paths ({String(paths.paths.length)}
          {paths.truncated ? '+' : ''})
        </summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-gray-500">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">Path</th>
                <th className="py-1 pr-2">Leaf</th>
                <th className="py-1">Traits</th>
              </tr>
            </thead>
            <tbody>
              {paths.paths.slice(0, MAX_TABLE_ROWS).map((p, i) => {
                const top = Object.entries(p.weights).sort((a, b) => b[1] - a[1]);
                const tie = top.length > 1 && top[0]?.[1] === top[1]?.[1] && (top[0]?.[1] ?? 0) > 0;
                return (
                  <tr key={i} data-testid="sim-path-row" className="border-b align-top">
                    <td className="py-1 pr-2">{i + 1}</td>
                    <td className="py-1 pr-2">
                      {p.questionIds
                        .map((qid, k) => {
                          const aid = p.answerIds[k];
                          return typeof aid === 'string'
                            ? answerLabel(qid, aid)
                            : `${qid} (traits)`;
                        })
                        .join(' → ')}
                    </td>
                    <td className="py-1 pr-2 font-mono">
                      {p.leaf}
                      {tie && (
                        <span
                          data-testid="sim-tie"
                          title={`Tie: ${top
                            .filter((t) => t[1] === top[0]?.[1])
                            .map((t) => t[0])
                            .join(', ')}`}
                          className="ml-1 rounded bg-amber-100 px-1 text-amber-800"
                        >
                          tie
                        </span>
                      )}
                    </td>
                    <td className="py-1 font-mono">{p.traits.join(', ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(paths.truncated || paths.paths.length > MAX_TABLE_ROWS) && (
            <p className="mt-1 text-xs text-amber-700">
              List truncated — the tree has more paths than are shown.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
