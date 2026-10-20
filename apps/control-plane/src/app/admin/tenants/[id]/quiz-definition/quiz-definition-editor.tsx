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
 * FOLLOW-1362 C3: "Publish…" opens {@link PublishDialog} (diff vs active + propagation notice)
 * before the PUT; {@link useLocalDraft} autosaves to localStorage and guards unload;
 * {@link ImportExport} loads a file into the DRAFT only (`source: 'import'` on publish);
 * {@link QuizSimulator} and {@link VersionsPanel} sit below the form.
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

import { ConfirmationTab } from './confirmation-tab';
import { EditorBanners } from './editor-banners';
import { ImportExport } from './import-export';
import { LintPanel } from './lint-panel';
import { PublishDialog } from './publish-dialog';
import { QuizQuestionForm } from './question-form';
import { QuizSimulator } from './quiz-simulator';
import { useLocalDraft } from './use-local-draft';
import { errorOf, useSuggestWeights, type WriteErrorBody } from './use-suggest-weights';
import { validateDraft } from './validate-draft';
import { VersionsPanel } from './versions-panel';
import { WeightSuggestionsPanel } from './weight-suggestions-panel';

const BUILT_IN_DEFAULT_JSON = JSON.stringify(DEFAULT_QUIZ_DEFINITION_V2, null, 2);

export function StaffQuizDefinitionEditor({ tenantId }: { tenantId: string }): React.JSX.Element {
  const [text, setText] = useState<string>('');
  // The loaded version's text — what "unchanged" means for the local draft and the unload guard.
  const [baseline, setBaseline] = useState<string>('');
  // The loaded active definition (null = none saved → buyers get the built-in default).
  const [activeDef, setActiveDef] = useState<QuizDefinition | null>(null);
  // 'import' once a file was loaded into the draft; sent as `source` on publish.
  const [source, setSource] = useState<'editor' | 'import'>('editor');
  const [publishOpen, setPublishOpen] = useState(false);
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

  const url = `/api/admin/tenants/quiz-definition?tenant_id=${encodeURIComponent(tenantId)}`;

  useEffect(() => {
    setLoadStatus('loading');
    setLoadErrorMsg('');
    setConflict(null);
    setServerIssues([]);
    setSource('editor');
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
          setActiveDef(null);
          setText('');
          setBaseline('');
        } else {
          setInvalidActive(null);
          // No saved row → buyers are served the built-in default, so that IS the baseline.
          const loaded = d.definition
            ? JSON.stringify(d.definition, null, 2)
            : BUILT_IN_DEFAULT_JSON;
          setActiveDef(d.definition ?? null);
          setText(loaded);
          setBaseline(loaded);
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

  const localDraft = useLocalDraft({
    tenantId,
    baseVersion: version,
    text,
    baseline,
    ready: loadStatus === 'loaded' && canWrite && invalidActive === null,
  });

  const suggestWeights = useSuggestWeights({
    tenantId,
    definition: validation.definition,
    loaded: loadStatus === 'loaded',
    onApply: (merged) => {
      setText(JSON.stringify(merged, null, 2));
    },
  });

  async function handleSave(): Promise<void> {
    if (!canSave || validation.definition === null) return;
    setPublishOpen(false);
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
          source,
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
      setActiveDef(validation.definition);
      setBaseline(text);
      setSource('editor');
      localDraft.clear();
      setSaveStatus('saved');
      setTimeout(() => {
        setSaveStatus('idle');
      }, 2500);
    } catch {
      setSaveErrorMsg('Network error. Please try again.');
      setSaveStatus('error');
    }
  }

  function updateDraft(next: QuizDefinition): void {
    setText(JSON.stringify(next, null, 2));
  }

  function reload(): void {
    setRetryNonce((n) => n + 1);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
      <EditorBanners
        loadStatus={loadStatus}
        loadErrorMsg={loadErrorMsg}
        invalidActive={invalidActive}
        version={version}
        conflict={conflict}
        canWrite={canWrite}
        localDraft={localDraft.pending}
        onReload={reload}
        onRestoreDraft={() => {
          const restored = localDraft.restore();
          if (restored !== null) setText(restored);
        }}
        onDiscardDraft={localDraft.discard}
      />

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
            setSource('editor');
            setText(BUILT_IN_DEFAULT_JSON);
          }}
          className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          Load built-in default
        </button>
      </div>

      {loadStatus === 'loaded' && (
        <ImportExport
          tenantId={tenantId}
          version={version}
          draftText={text}
          canWrite={canWrite && invalidActive === null}
          onImport={(imported) => {
            setText(imported);
            setSource('import');
          }}
        />
      )}

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
      {suggestWeights.status === 'error' && (
        <div role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Suggestion request failed: {suggestWeights.errorMsg}
        </div>
      )}
      {suggestWeights.suggest !== null && (
        <WeightSuggestionsPanel suggest={suggestWeights.suggest} onApply={suggestWeights.apply} />
      )}

      <div className="mt-4 flex items-center gap-4">
        {canWrite && (
          <button
            type="button"
            data-testid="publish-open"
            onClick={() => {
              setPublishOpen(true);
            }}
            disabled={!canSave}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saveStatus === 'saving' ? 'Publishing…' : 'Publish…'}
          </button>
        )}
        {canWrite && (
          <button
            type="button"
            data-testid="suggest-weights"
            onClick={() => void suggestWeights.request()}
            disabled={
              loadStatus !== 'loaded' ||
              invalidActive !== null ||
              validation.definition === null ||
              suggestWeights.status === 'loading'
            }
            title="Ask the LLM to derive answer→archetype weights from the current question wording"
            className="rounded-lg border border-indigo-300 bg-white px-5 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-50"
          >
            {suggestWeights.status === 'loading' ? 'Asking model…' : 'Suggest weights (AI)'}
          </button>
        )}
        {saveStatus === 'saved' && (
          <span className="text-sm font-medium text-green-600">Definition saved!</span>
        )}
      </div>

      {publishOpen && validation.definition !== null && (
        <PublishDialog
          draft={validation.definition}
          activeDefinition={activeDef}
          activeVersion={version}
          source={source}
          busy={saveStatus === 'saving'}
          onConfirm={() => void handleSave()}
          onCancel={() => {
            setPublishOpen(false);
          }}
        />
      )}

      <QuizSimulator definition={validation.definition} />
      {loadStatus === 'loaded' && (
        <VersionsPanel
          tenantId={tenantId}
          canWrite={canWrite}
          activeVersion={version}
          activeDefinition={activeDef}
          onChanged={reload}
        />
      )}
    </div>
  );
}
