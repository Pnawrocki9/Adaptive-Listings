'use client';

/**
 * EditorBanners — the status banners above the quiz editor (extracted from the editor in
 * FOLLOW-1362 C3): failed load, invalid active definition (Rule K.2), 409 version conflict,
 * read-only mode and the local-draft restore prompt. Test ids are unchanged.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/editor-banners
 */

import type { StoredDraft } from './use-local-draft';

const BANNER = 'mb-4 rounded-lg px-4 py-3 text-sm';

export function EditorBanners({
  loadStatus,
  loadErrorMsg,
  invalidActive,
  version,
  conflict,
  canWrite,
  localDraft,
  onReload,
  onRestoreDraft,
  onDiscardDraft,
}: {
  loadStatus: 'loading' | 'loaded' | 'error';
  loadErrorMsg: string;
  invalidActive: { raw: unknown } | null;
  version: number | null;
  conflict: { activeVersion: number | null } | null;
  canWrite: boolean;
  localDraft: StoredDraft | null;
  onReload: () => void;
  onRestoreDraft: () => void;
  onDiscardDraft: () => void;
}): React.JSX.Element {
  return (
    <>
      {loadStatus === 'error' && (
        <div role="alert" className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>Failed to load quiz definition: {loadErrorMsg}</p>
          <p className="mt-1 text-xs">
            Saving is disabled until the definition loads successfully — this prevents overwriting
            the tenant&apos;s real quiz with a starter template.
          </p>
          <button
            type="button"
            onClick={onReload}
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
            onClick={onReload}
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

      {localDraft !== null && (
        <div
          role="status"
          data-testid="local-draft-prompt"
          className={`${BANNER} border border-blue-200 bg-blue-50 text-blue-900`}
        >
          An unpublished draft from this browser
          {localDraft.saved_at ? ` (${new Date(localDraft.saved_at).toLocaleString()})` : ''}{' '}
          differs from the loaded version. Restore it?
          <button
            type="button"
            data-testid="restore-local-draft"
            onClick={onRestoreDraft}
            className="ml-3 rounded-lg border border-blue-400 bg-white px-3 py-1 font-medium"
          >
            Restore draft
          </button>
          <button
            type="button"
            data-testid="discard-local-draft"
            onClick={onDiscardDraft}
            className="ml-2 rounded-lg border border-gray-300 bg-white px-3 py-1"
          >
            Discard
          </button>
        </div>
      )}
    </>
  );
}
