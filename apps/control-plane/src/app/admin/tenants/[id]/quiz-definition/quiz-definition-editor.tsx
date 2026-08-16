'use client';

/**
 * StaffQuizDefinitionEditor — Estalara-staff editor for a tenant's fully editable quiz tree
 * (FOLLOW-639 / ADR-0019 D3 + D7).
 *
 * v1 was a JSON-only editor (per the ticket: a drag-drop tree UI is explicitly NOT required).
 * FOLLOW-1003 adds a structured QUESTION FORM above the JSON ({@link QuizQuestionForm}) — the
 * prompts and answer labels staff actually reword are plain inputs; the JSON stays the single
 * source of truth and the advanced surface for structure/branching/weights/locales. Both edit the
 * SAME `text` state, so form edits and JSON edits round-trip freely.
 *
 * The textarea holds the `QuizDefinition` JSON; on every change it
 * is parsed and validated CLIENT-SIDE with the SAME `QuizDefinitionSchema` the server enforces, so
 * the HARD integrity errors (unknown archetype id, dangling `next`, cycle, duplicate id) surface
 * immediately and Save is disabled until they clear. The NON-BLOCKING unreachable-archetype
 * warning (`computeUnreachableArchetypes`) is shown but never blocks the save (CEO ruling).
 *
 * Every fetch carries `?tenant_id=<tenantId>` so the staff route fences its `createAdminClient()`
 * queries to that tenant (ADR-0018 §2 invariant 5). The write is PUT (create-a-new-active-version
 * semantics); the route performs the mutation + `staff_audit_log` insert in one transaction.
 *
 * FOLLOW-1002 — "Suggest weights (AI)": after editing questions, staff can ask the LLM
 * (via `POST …/quiz-definition/suggest-weights`) to derive answer→archetype weight vectors from
 * the CURRENT draft's wording, so a reworded question does not silently keep mappings authored
 * for its old meaning. The proposals render below with per-answer rationale; "Apply all to
 * draft" merges ONLY the weights into the JSON ({@link applySuggestions}) — nothing is persisted
 * until the staff reviews and hits the same audited Save as always. Runtime stays deterministic;
 * the LLM runs only on this explicit authoring click.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/quiz-definition-editor
 */

import { useEffect, useMemo, useState } from 'react';

import type { QuizDefinition } from '@estalara/shared';
import { QuizDefinitionSchema, computeUnreachableArchetypes } from '@estalara/shared';

import { applySuggestions } from './apply-suggestions';
import { QuizQuestionForm } from './question-form';

interface WeightSuggestion {
  question_id: string;
  answer_id: string;
  weights: Record<string, number>;
  rationale: string;
}

interface SuggestResponse {
  model: string;
  suggestions: WeightSuggestion[];
  rejected: { question_id: string; answer_id: string; reason: string }[];
}

/** A minimal starter tree offered when a tenant has no saved definition yet. */
const STARTER_DEFINITION: QuizDefinition = {
  schema_version: 1,
  root: 'q_gate',
  languages: ['en'],
  questions: [
    {
      id: 'q_gate',
      prompt_i18n: { en: 'What are you looking for?' },
      answers: [
        { id: 'a_invest', label_i18n: { en: 'Investment property' }, weights: {}, next: 'q_focus' },
        { id: 'a_skip', label_i18n: { en: 'Just browsing' }, weights: {}, next: null },
      ],
    },
    {
      id: 'q_focus',
      prompt_i18n: { en: 'What is your focus?' },
      answers: [
        {
          id: 'a_yield',
          label_i18n: { en: 'Rental income (yield)' },
          weights: { yield_hunter: 1 },
          next: null,
        },
        {
          id: 'a_flip',
          label_i18n: { en: 'Flip / renovation' },
          weights: { flip_investor: 1 },
          next: null,
        },
      ],
    },
  ],
};

interface ValidationResult {
  /** Parsed + schema-valid definition, or null when the text is not a valid definition. */
  definition: QuizDefinition | null;
  /** Human-readable hard errors (JSON parse OR schema integrity). Empty when valid. */
  errors: string[];
  /** Non-blocking unreachable-archetype warning (only when the definition is valid). */
  unreachable: string[];
}

/** Parse + validate the editor text with the SAME schema the server enforces. */
function validate(text: string): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      definition: null,
      errors: [`JSON parse error: ${err instanceof Error ? err.message : 'invalid JSON'}`],
      unreachable: [],
    };
  }
  const result = QuizDefinitionSchema.safeParse(raw);
  if (!result.success) {
    return {
      definition: null,
      errors: result.error.issues.map(
        (i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`,
      ),
      unreachable: [],
    };
  }
  return {
    definition: result.data,
    errors: [],
    unreachable: computeUnreachableArchetypes(result.data),
  };
}

export function StaffQuizDefinitionEditor({ tenantId }: { tenantId: string }): React.JSX.Element {
  const [text, setText] = useState<string>('');
  const [version, setVersion] = useState<number | null>(null);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadErrorMsg, setLoadErrorMsg] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorMsg, setSaveErrorMsg] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);
  // FOLLOW-1002 — suggest-weights state. `suggest` holds the LAST proposal set;
  // it is cleared on apply (the draft now embodies it) but deliberately kept
  // across hand-edits so staff can compare while tweaking.
  const [suggestStatus, setSuggestStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [suggestErrorMsg, setSuggestErrorMsg] = useState('');
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);

  const url = `/api/admin/tenants/quiz-definition?tenant_id=${encodeURIComponent(tenantId)}`;
  const suggestUrl = `/api/admin/tenants/quiz-definition/suggest-weights?tenant_id=${encodeURIComponent(tenantId)}`;

  useEffect(() => {
    setLoadStatus('loading');
    setLoadErrorMsg('');
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
      .then((data: unknown) => {
        const d = data as { version?: number | null; definition?: QuizDefinition | null };
        const active = d.definition ?? STARTER_DEFINITION;
        setText(JSON.stringify(active, null, 2));
        setVersion(d.version ?? null);
        setLoadStatus('loaded');
      })
      .catch((err: unknown) => {
        // Rule K.2 consumer-side: do NOT silently present a blank editor as real config — a
        // Save from that state would clobber the tenant's real definition.
        setLoadErrorMsg(err instanceof Error ? err.message : 'Failed to load quiz definition.');
        setLoadStatus('error');
      });
  }, [url, retryNonce]);

  const validation = useMemo(() => validate(text), [text]);
  const canSave =
    loadStatus === 'loaded' && validation.definition !== null && saveStatus !== 'saving';

  async function handleSave(): Promise<void> {
    if (validation.definition === null || loadStatus !== 'loaded') return;
    setSaveStatus('saving');
    setSaveErrorMsg('');
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: validation.definition }),
      });
      if (!res.ok) {
        const bodyUnknown: unknown = await res.json().catch(() => ({}));
        const body = bodyUnknown as { error?: string | { message?: string } };
        const msg =
          typeof body.error === 'string' ? body.error : (body.error?.message ?? 'Failed to save.');
        setSaveErrorMsg(msg);
        setSaveStatus('error');
        return;
      }
      const saved = (await res.json()) as { version?: number | null };
      setVersion(saved.version ?? null);
      setSaveStatus('saved');
      setTimeout(() => {
        setSaveStatus('idle');
      }, 2500);
    } catch {
      setSaveErrorMsg('Network error. Please try again.');
      setSaveStatus('error');
    }
  }

  // FOLLOW-1002: ask the LLM for weight proposals derived from the CURRENT draft.
  async function handleSuggest(): Promise<void> {
    if (validation.definition === null || loadStatus !== 'loaded') return;
    setSuggestStatus('loading');
    setSuggestErrorMsg('');
    try {
      const res = await fetch(suggestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: validation.definition }),
      });
      if (!res.ok) {
        const bodyUnknown: unknown = await res.json().catch(() => ({}));
        const body = bodyUnknown as { error?: string | { message?: string } };
        const msg =
          typeof body.error === 'string'
            ? body.error
            : (body.error?.message ?? 'Failed to get suggestions.');
        setSuggestErrorMsg(msg);
        setSuggestStatus('error');
        return;
      }
      setSuggest((await res.json()) as SuggestResponse);
      setSuggestStatus('idle');
    } catch {
      setSuggestErrorMsg('Network error. Please try again.');
      setSuggestStatus('error');
    }
  }

  // FOLLOW-1002: merge the proposed weights into the draft (weights ONLY —
  // prompts/labels/branching untouched). Persisting still requires Save.
  function handleApplySuggestions(): void {
    if (validation.definition === null || suggest === null) return;
    const merged = applySuggestions(validation.definition, suggest.suggestions);
    setText(JSON.stringify(merged, null, 2));
    setSuggest(null);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
      {loadStatus === 'error' && (
        <div role="alert" className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>Failed to load quiz definition: {loadErrorMsg}</p>
          <p className="mt-1 text-xs">
            Saving is disabled until the definition loads successfully — this prevents overwriting
            the tenant&apos;s real quiz with a starter template.
          </p>
          <button
            type="button"
            onClick={() => {
              setRetryNonce((n) => n + 1);
            }}
            className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {version === null
            ? 'No saved definition — the SDK uses its built-in default tree. Saving creates version 1.'
            : `Active version: ${String(version)}. Saving creates the next version.`}
        </p>
      </div>

      {/* FOLLOW-1003 — structured question editor. Renders only from a VALID draft
          (the JSON below stays the single source of truth); on hard errors the form
          hides rather than editing a definition that cannot round-trip. */}
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Questions</h2>
      {validation.definition !== null ? (
        <QuizQuestionForm
          definition={validation.definition}
          onChange={(next) => {
            setText(JSON.stringify(next, null, 2));
          }}
        />
      ) : (
        <p data-testid="question-form-unavailable" className="mb-6 text-sm text-gray-400">
          Fix the JSON errors below to edit questions in form view.
        </p>
      )}

      <label
        htmlFor="quiz-definition-json"
        className="mb-1 block text-sm font-medium text-gray-700"
      >
        Advanced: full definition (JSON) — structure, branching, weights, extra languages
      </label>
      <textarea
        id="quiz-definition-json"
        data-testid="quiz-definition-json"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
        }}
        disabled={loadStatus !== 'loaded'}
        rows={22}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
      />

      {/* HARD errors — block saving. */}
      {validation.errors.length > 0 && (
        <div role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">This definition cannot be saved:</p>
          <ul className="mt-1 list-disc pl-5">
            {validation.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* NON-BLOCKING unreachable-archetype warning (ADR-0019 D3). */}
      {validation.errors.length === 0 && validation.unreachable.length > 0 && (
        <div
          role="status"
          data-testid="unreachable-warning"
          className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <p className="font-medium">Warning (does not block saving):</p>
          <p className="mt-1">
            These archetypes cannot be reached under this tree:{' '}
            <span className="font-mono">{validation.unreachable.join(', ')}</span>
          </p>
        </div>
      )}

      {saveStatus === 'error' && (
        <div role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {saveErrorMsg}
        </div>
      )}

      {/* FOLLOW-1002 — LLM weight suggestions (advisory; nothing persists until Save). */}
      {suggestStatus === 'error' && (
        <div role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Suggestion request failed: {suggestErrorMsg}
        </div>
      )}
      {suggest !== null && (
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
            onClick={handleApplySuggestions}
            className="mt-3 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Apply all to draft
          </button>
        </div>
      )}

      <div className="mt-4 flex items-center gap-4">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {saveStatus === 'saving' ? 'Saving…' : 'Save Definition'}
        </button>
        <button
          type="button"
          data-testid="suggest-weights"
          onClick={() => void handleSuggest()}
          disabled={!canSave || suggestStatus === 'loading'}
          title="Ask the LLM to derive answer→archetype weights from the current question wording"
          className="rounded-lg border border-indigo-300 bg-white px-5 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-50"
        >
          {suggestStatus === 'loading' ? 'Asking model…' : 'Suggest weights (AI)'}
        </button>
        {saveStatus === 'saved' && (
          <span className="text-sm font-medium text-green-600">Definition saved!</span>
        )}
      </div>
    </div>
  );
}
