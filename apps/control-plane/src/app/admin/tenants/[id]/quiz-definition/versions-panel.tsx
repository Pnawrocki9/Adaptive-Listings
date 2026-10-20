'use client';

/**
 * VersionsPanel — the version history of a tenant's quiz (FOLLOW-1362 C3): the newest 50
 * versions with "Diff vs active", "Restore" (copy-forward as a NEW version, `PUT …/activate`) and
 * "Revert to built-in default" (`PUT …/deactivate`), each behind a confirm dialog. Restore and
 * revert send the active version the caller saw as `base_version`; a 409 shows a reload prompt
 * instead of retrying. Read-only staff (`can_write: false`) see the list and the diff only.
 *
 * Response types come from the C1 routes — never redeclared here.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/versions-panel
 */

import { useEffect, useState } from 'react';

import type { QuizChange, QuizDefinition } from '@estalara/shared';
import { DEFAULT_QUIZ_DEFINITION_V2, diffQuizDefinitions } from '@estalara/shared';

import type {
  QuizDefinitionVersionDetail,
  QuizDefinitionVersionsResponse,
  QuizDefinitionVersionSummary,
} from '@/app/api/admin/tenants/quiz-definition/versions/route';

import { ConfirmDialog } from './confirm-dialog';
import { DiffList } from './diff-view';

type Pending = { kind: 'restore'; version: number } | { kind: 'revert' };

export function VersionsPanel({
  tenantId,
  canWrite,
  activeVersion,
  activeDefinition,
  onChanged,
}: {
  tenantId: string;
  canWrite: boolean;
  /** The active version the editor loaded (`null` = built-in default). */
  activeVersion: number | null;
  activeDefinition: QuizDefinition | null;
  /** Called after a successful restore / revert (or the reload prompt): re-load the editor. */
  onChanged: () => void;
}): React.JSX.Element {
  const [versions, setVersions] = useState<QuizDefinitionVersionSummary[] | null>(null);
  const [error, setError] = useState('');
  const [diff, setDiff] = useState<{ version: number; changes: QuizChange[] } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [actionError, setActionError] = useState('');
  // Collapsed by default: the history is fetched only when staff open it.
  const [open, setOpen] = useState(false);

  const q = `tenant_id=${encodeURIComponent(tenantId)}`;
  const base = '/api/admin/tenants/quiz-definition';

  useEffect(() => {
    if (!open) return;
    setVersions(null);
    setError('');
    void fetch(`${base}/versions?${q}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json() as Promise<QuizDefinitionVersionsResponse>;
      })
      .then((d) => {
        if (!Array.isArray(d.versions)) throw new Error('Malformed versions response');
        setVersions(d.versions);
      })
      .catch((err: unknown) => {
        // Rule K.2: a failed history read is shown, never rendered as "no versions".
        setError(err instanceof Error ? err.message : 'Failed to load versions.');
      });
  }, [q, activeVersion, open]);

  async function showDiff(version: number): Promise<void> {
    setActionError('');
    try {
      const r = await fetch(`${base}/versions?${q}&version=${String(version)}`);
      if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
      const d = (await r.json()) as QuizDefinitionVersionDetail;
      if (d.definition === null) throw new Error('This version does not parse (invalid).');
      setDiff({
        version,
        changes: diffQuizDefinitions(activeDefinition ?? DEFAULT_QUIZ_DEFINITION_V2, d.definition),
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to load the version.');
    }
  }

  async function confirmPending(): Promise<void> {
    if (pending === null) return;
    setBusy(true);
    setActionError('');
    try {
      const res = await fetch(
        `${base}/${pending.kind === 'restore' ? 'activate' : 'deactivate'}?${q}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            pending.kind === 'restore'
              ? { from_version: pending.version, base_version: activeVersion }
              : { base_version: activeVersion },
          ),
        },
      );
      if (res.status === 409) {
        setConflict(true);
      } else if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string } | string;
        };
        setActionError(
          typeof body.error === 'string'
            ? body.error
            : (body.error?.message ?? 'The request failed.'),
        );
      } else {
        onChanged();
      }
    } catch {
      setActionError('Network error. Please try again.');
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <section data-testid="versions-panel" className="mt-6 rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          data-testid="versions-toggle"
          aria-expanded={open}
          onClick={() => {
            setOpen((o) => !o);
          }}
          className="text-sm font-semibold text-gray-800"
        >
          {open ? '▾' : '▸'} Versions
        </button>
        {open && canWrite && activeVersion !== null && (
          <button
            type="button"
            data-testid="revert-default"
            onClick={() => {
              setPending({ kind: 'revert' });
            }}
            className="rounded-lg border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
          >
            Revert to built-in default
          </button>
        )}
      </div>

      {open && (
        <>
          {conflict && (
            <div
              role="alert"
              data-testid="versions-conflict"
              className="mt-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              The active version changed while you were looking — nothing was changed. Reload to
              continue.
              <button
                type="button"
                data-testid="versions-reload"
                onClick={() => {
                  setConflict(false);
                  onChanged();
                }}
                className="ml-3 rounded-lg border border-amber-400 bg-white px-3 py-1 font-medium"
              >
                Reload
              </button>
            </div>
          )}
          {error !== '' && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              Failed to load versions: {error}
            </p>
          )}
          {actionError !== '' && (
            <p
              role="alert"
              data-testid="versions-action-error"
              className="mt-2 text-sm text-red-700"
            >
              {actionError}
            </p>
          )}

          {versions !== null && versions.length === 0 && (
            <p className="mt-2 text-sm text-gray-500">
              No saved versions — buyers see the built-in default.
            </p>
          )}
          {versions !== null && versions.length > 0 && (
            <table className="mt-2 w-full text-left text-xs">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="py-1 pr-2">Version</th>
                  <th className="py-1 pr-2">Saved</th>
                  <th className="py-1 pr-2">By</th>
                  <th className="py-1 pr-2">Q / A</th>
                  <th className="py-1 pr-2">sha256</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr
                    key={v.version}
                    data-testid={`version-row-${String(v.version)}`}
                    className="border-b"
                  >
                    <td className="py-1 pr-2 font-mono">
                      v{String(v.version)}
                      {v.is_active && (
                        <span className="ml-1 rounded bg-green-100 px-1 text-green-800">
                          active
                        </span>
                      )}
                      {!v.valid && (
                        <span className="ml-1 rounded bg-red-100 px-1 text-red-800">invalid</span>
                      )}
                    </td>
                    <td className="py-1 pr-2">{new Date(v.created_at).toLocaleString()}</td>
                    <td className="py-1 pr-2 font-mono">{v.created_by?.slice(0, 8) ?? '—'}</td>
                    <td className="py-1 pr-2">
                      {v.question_count ?? '?'} / {v.answer_count ?? '?'}
                    </td>
                    <td className="py-1 pr-2 font-mono">{v.sha256?.slice(0, 8) ?? '—'}</td>
                    <td className="py-1 text-right">
                      {v.valid && !v.is_active && (
                        <button
                          type="button"
                          data-testid={`diff-${String(v.version)}`}
                          onClick={() => void showDiff(v.version)}
                          className="mr-2 text-blue-700 underline"
                        >
                          Diff vs active
                        </button>
                      )}
                      {canWrite && v.valid && !v.is_active && (
                        <button
                          type="button"
                          data-testid={`restore-${String(v.version)}`}
                          onClick={() => {
                            setPending({ kind: 'restore', version: v.version });
                          }}
                          className="text-blue-700 underline"
                        >
                          Restore
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {diff !== null && (
            <div data-testid="version-diff" className="mt-3 rounded-lg bg-gray-50 p-3">
              <p className="mb-1 text-xs text-gray-500">
                Active {activeVersion === null ? '(built-in default)' : `v${String(activeVersion)}`}{' '}
                → v{String(diff.version)}:
              </p>
              <DiffList changes={diff.changes} testId="version-diff-list" />
            </div>
          )}

          {pending !== null && (
            <ConfirmDialog
              testId="versions-confirm"
              title={
                pending.kind === 'restore'
                  ? `Restore version ${String(pending.version)}?`
                  : 'Revert to the built-in default?'
              }
              confirmLabel={pending.kind === 'restore' ? 'Restore' : 'Revert'}
              busy={busy}
              onConfirm={() => void confirmPending()}
              onCancel={() => {
                setPending(null);
              }}
            >
              <p>
                {pending.kind === 'restore'
                  ? `Version ${String(pending.version)} is copied forward as a new active version; history is kept.`
                  : 'Buyers will be served the built-in default quiz; all saved versions are kept.'}{' '}
                Unsaved edits in the editor are discarded when it reloads.
              </p>
            </ConfirmDialog>
          )}
        </>
      )}
    </section>
  );
}
