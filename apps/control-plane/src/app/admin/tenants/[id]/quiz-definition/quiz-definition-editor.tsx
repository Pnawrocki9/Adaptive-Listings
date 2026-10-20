'use client';

/**
 * StaffQuizDefinitionEditor — Estalara-staff editor for a tenant's fully editable quiz tree
 * (FOLLOW-639 / ADR-0019 D3 + D7; structured EN | PL editor FOLLOW-1362 C2).
 *
 * The draft is one JSON `text` state: the structured form ({@link QuizQuestionForm}) and the
 * Confirmation tab ({@link ConfirmationTab}) edit it through the pure ops in `definition-ops.ts`,
 * and the "Advanced" JSON textarea edits the same string, so all three round-trip. On every
 * change the draft is parsed with the SERVE schema (hard integrity errors: unknown archetype,
 * dangling `next`, cycle, duplicate id) and then linted client-side with `lintQuizDefinition`
 * (EN + PL on every text, limits, confirm completeness). Any hard error or lint ERROR disables
 * Save; lint WARNINGS and the unreachable-archetype list never do. A rejected save renders the
 * server's 400 `issues[]` in the same lint panel.
 *
 * Provenance (Rule K.2): the GET carries `can_write` (false → read-only: inputs disabled, Save
 * hidden) and `invalid_active` + `raw` (the stored row no longer parses, buyers get the built-in
 * default → a blocking banner with the raw JSON; no silent starter is loaded). "Load built-in
 * default" loads `DEFAULT_QUIZ_DEFINITION_V2`. Save sends `base_version` (the loaded active
 * version) and `source: 'editor'`; a 409 `version_conflict` shows "someone else published
 * version N — reload".
 *
 * Every fetch carries `?tenant_id=<tenantId>` so the staff route fences its `createAdminClient()`
 * queries to that tenant (ADR-0018 §2 invariant 5). The write is PUT (create-a-new-active-version
 * semantics); the route performs the mutation + `staff_audit_log` insert in one transaction.
 *
 * FOLLOW-1002 — "Suggest weights (AI)": derives answer→archetype weights from the CURRENT draft
 * via `POST …/quiz-definition/suggest-weights`; "Apply all to draft" merges ONLY weights
 * ({@link applySuggestions}) — nothing persists until the audited Save.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/quiz-definition-editor
 */

import { useEffect, useMemo, useState } from 'react';

import type { QuizDefinition, QuizLintIssue } from '@estalara/shared';
import { DEFAULT_QUIZ_DEFINITION_V2 } from '@estalara/shared';

import type { QuizDefinitionState } from '@/app/api/admin/tenants/quiz-definition/route';

import { applySuggestions } from './apply-suggestions';
import { ConfirmationTab } from './confirmation-tab';
import { LintPanel } from './lint-panel';
import { QuizQuestionForm } from './question-form';
import { validateDraft } from './validate-draft';
import { WeightSuggestionsPanel, type SuggestResponse } from './weight-suggestions-panel';

/** The error envelope of a failed write (`409 version_conflict`, `400 validation_failed`, …). */
interface WriteErrorBody {
  error?:
    | string
    | { code?: string; message?: string; issues?: QuizLintIssue[]; active_version?: number | null };
}

function errorOf(
  body: WriteErrorBody,
  fallback: string,
): { code?: string | undefined; message: string } {
  if (typeof body.error === 'string') return { message: body.error };
  return { code: body.error?.code, message: body.error?.message ?? fallback };
}

const BUILT_IN_DEFAULT_JSON = JSON.stringify(DEFAULT_QUIZ_DEFINITION_V2, null, 2);

const BANNER = 'mb-4 rounded-lg px-4 py-3 text-sm';

export function StaffQuizDefinitionEditor({ tenantId }: { tenantId: string }): React.JSX.Element {
  const [text, setText] = useState<string>('');
  const [version, setVersion] = useState<number | null>(null);
  const [canWrite, setCanWrite] = useState(true);
  // `raw` of an active row that no longer parses (Rule K.2) — blocks editing until acknowledged.
  const [invalidActive, setInvalidActive] = useState<{ raw: unknown } | null>(null);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadErrorMsg, setLoadErrorMsg] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorMsg, setSaveErrorMsg] = useState('');
  const [serverIssues, setServerIssues] = useState<QuizLintIssue[]>([]);
  // Set by a 409: the version somebody else published (null = reverted to the built-in default).
  const [conflict, setConflict] = useState<{ activeVersion: number | null } | null>(null);
  const [tab, setTab] = useState<'questions' | 'confirmation'>('questions');
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
    setConflict(null);
    setServerIssues([]);
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
      .then((data: unknown) => {
        const d = data as Partial<QuizDefinitionState>;
        setCanWrite(d.can_write !== false);
        setVersion(d.version ?? null);
        if (d.invalid_active === true) {
          // The stored row fails the serve schema: show it, never swap in a starter silently.
          setInvalidActive({ raw: d.raw ?? null });
          setText('');
        } else {
          setInvalidActive(null);
          // No saved row → buyers are served the built-in default, so that IS the baseline.
          setText(d.definition ? JSON.stringify(d.definition, null, 2) : BUILT_IN_DEFAULT_JSON);
        }
        setLoadStatus('loaded');
      })
      .catch((err: unknown) => {
        // Rule K.2 consumer-side: do NOT silently present a blank editor as real config — a
        // Save from that state would clobber the tenant's real definition.
        setLoadErrorMsg(err instanceof Error ? err.message : 'Failed to load quiz definition.');
        setLoadStatus('error');
      });
  }, [url, retryNonce]);

  const validation = useMemo(() => validateDraft(text), [text]);
  const readOnly = !canWrite || invalidActive !== null || loadStatus !== 'loaded';
  const canSave =
    loadStatus === 'loaded' &&
    canWrite &&
    invalidActive === null &&
    validation.definition !== null &&
    validation.lintErrors.length === 0 &&
    saveStatus !== 'saving';

  async function handleSave(): Promise<void> {
    if (!canSave || validation.definition === null) return;
    setSaveStatus('saving');
    setSaveErrorMsg('');
    setServerIssues([]);
    setConflict(null);
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definition: validation.definition,
          base_version: version,
          source: 'editor',
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as WriteErrorBody;
        const { code, message } = errorOf(body, 'Failed to save.');
        const detail = typeof body.error === 'object' ? body.error : undefined;
        if (res.status === 409 && code === 'version_conflict') {
          setConflict({ activeVersion: detail?.active_version ?? null });
        } else if (detail?.issues && detail.issues.length > 0) {
          setServerIssues(detail.issues);
        } else {
          setSaveErrorMsg(message);
        }
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
        const body = (await res.json().catch(() => ({}))) as WriteErrorBody;
        setSuggestErrorMsg(errorOf(body, 'Failed to get suggestions.').message);
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

  function updateDraft(next: QuizDefinition): void {
    setText(JSON.stringify(next, null, 2));
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

      {invalidActive !== null && (
        <div
          role="alert"
          data-testid="invalid-active-banner"
          className={`${BANNER} border border-red-300 bg-red-50 text-red-800`}
        >
          <p className="font-semibold">
            The active quiz definition (version {String(version)}) is invalid.
          </p>
          <p className="mt-1">
            Buyers are being served the built-in default instead. Editing is blocked until you
            decide: reload, or load the built-in default as a new draft (saving then replaces
            version {String(version)}). The stored JSON:
          </p>
          <pre
            data-testid="invalid-active-raw"
            className="mt-2 max-h-64 overflow-auto rounded bg-white p-2 font-mono text-xs"
          >
            {JSON.stringify(invalidActive.raw, null, 2)}
          </pre>
        </div>
      )}

      {conflict !== null && (
        <div
          role="alert"
          data-testid="version-conflict"
          className={`${BANNER} bg-amber-50 text-amber-900`}
        >
          {conflict.activeVersion === null
            ? 'Someone else reverted this quiz to the built-in default — reload to continue.'
            : `Someone else published version ${String(conflict.activeVersion)} — reload to continue.`}{' '}
          Your draft was not saved.
          <button
            type="button"
            data-testid="reload-definition"
            onClick={() => {
              setRetryNonce((n) => n + 1);
            }}
            className="ml-3 rounded-lg border border-amber-400 bg-white px-3 py-1 font-medium"
          >
            Reload
          </button>
        </div>
      )}

      {!canWrite && loadStatus === 'loaded' && (
        <div
          role="status"
          data-testid="read-only-banner"
          className={`${BANNER} bg-gray-100 text-gray-700`}
        >
          Read-only: saving quiz changes needs the ops staff rank.
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-4">
        <p className="text-sm text-gray-600">
          {version === null
            ? 'No saved definition — buyers see the built-in default shown here. Saving creates version 1.'
            : `Active version: ${String(version)}. Saving creates the next version.`}
        </p>
        <button
          type="button"
          data-testid="load-default"
          disabled={loadStatus !== 'loaded' || !canWrite}
          onClick={() => {
            setInvalidActive(null);
            setText(BUILT_IN_DEFAULT_JSON);
          }}
          className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          Load built-in default
        </button>
      </div>

      <div className="mb-3 flex gap-2 border-b border-gray-200 text-sm">
        {(['questions', 'confirmation'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            data-testid={`tab-${t}`}
            onClick={() => {
              setTab(t);
            }}
            className={`px-3 py-1.5 ${tab === t ? 'border-b-2 border-blue-600 font-semibold text-blue-700' : 'text-gray-500'}`}
          >
            {t === 'questions' ? 'Questions' : 'Confirmation'}
          </button>
        ))}
      </div>

      {/* The form renders only from a VALID draft (the JSON below stays the single source of
          truth); on hard errors it hides rather than editing a definition that cannot round-trip. */}
      {validation.definition === null ? (
        <p data-testid="question-form-unavailable" className="mb-6 text-sm text-gray-400">
          {invalidActive !== null
            ? 'Resolve the invalid active definition above to edit questions in form view.'
            : 'Fix the JSON errors below to edit questions in form view.'}
        </p>
      ) : tab === 'questions' ? (
        <QuizQuestionForm
          definition={validation.definition}
          onChange={updateDraft}
          readOnly={readOnly}
        />
      ) : (
        <ConfirmationTab
          definition={validation.definition}
          readOnly={readOnly}
          onChange={updateDraft}
        />
      )}

      <label
        htmlFor="quiz-definition-json"
        className="mb-1 block text-sm font-medium text-gray-700"
      >
        Advanced: full definition (JSON)
      </label>
      <textarea
        id="quiz-definition-json"
        data-testid="quiz-definition-json"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
        }}
        disabled={readOnly}
        rows={14}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
      />

      {/* HARD errors — block saving. */}
      {validation.errors.length > 0 && invalidActive === null && (
        <div role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">This definition cannot be saved:</p>
          <ul className="mt-1 list-disc pl-5">
            {validation.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <LintPanel
        definition={validation.definition}
        errors={validation.lintErrors}
        warnings={validation.lintWarnings}
        serverIssues={serverIssues}
      />

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

      {saveStatus === 'error' && saveErrorMsg !== '' && (
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
        <WeightSuggestionsPanel suggest={suggest} onApply={handleApplySuggestions} />
      )}

      <div className="mt-4 flex items-center gap-4">
        {canWrite && (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saveStatus === 'saving' ? 'Saving…' : 'Save Definition'}
          </button>
        )}
        {canWrite && (
          <button
            type="button"
            data-testid="suggest-weights"
            onClick={() => void handleSuggest()}
            disabled={
              loadStatus !== 'loaded' ||
              invalidActive !== null ||
              validation.definition === null ||
              suggestStatus === 'loading'
            }
            title="Ask the LLM to derive answer→archetype weights from the current question wording"
            className="rounded-lg border border-indigo-300 bg-white px-5 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-50"
          >
            {suggestStatus === 'loading' ? 'Asking model…' : 'Suggest weights (AI)'}
          </button>
        )}
        {saveStatus === 'saved' && (
          <span className="text-sm font-medium text-green-600">Definition saved!</span>
        )}
      </div>
    </div>
  );
}
