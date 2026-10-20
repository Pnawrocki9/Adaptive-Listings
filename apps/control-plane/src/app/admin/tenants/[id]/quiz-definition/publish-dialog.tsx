'use client';

/**
 * PublishDialog — the confirm step of "Publish…" (FOLLOW-1362 C3): the diff summary against the
 * ACTIVE version (or the built-in default when none is saved — that is what buyers see now) and
 * the propagation notice. The parent performs the PUT on confirm.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/publish-dialog
 */

import { useMemo } from 'react';

import type { QuizDefinition } from '@estalara/shared';
import { DEFAULT_QUIZ_DEFINITION_V2, diffQuizDefinitions } from '@estalara/shared';

import { ConfirmDialog } from './confirm-dialog';
import { DiffList } from './diff-view';

/** Public-config is served with `max-age=300, stale-while-revalidate=60` (≈ 6 minutes). */
export const PROPAGATION_NOTICE =
  'Live for new visitors within about 6 minutes (public-config is cached: max-age=300, ' +
  'stale-while-revalidate=60). Tabs that are already open keep their cached quiz.';

export function PublishDialog({
  draft,
  activeDefinition,
  activeVersion,
  source,
  busy,
  onConfirm,
  onCancel,
}: {
  draft: QuizDefinition;
  /** The loaded active definition; `null` = none saved (buyers get the built-in default). */
  activeDefinition: QuizDefinition | null;
  activeVersion: number | null;
  source: 'editor' | 'import';
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const changes = useMemo(
    () => diffQuizDefinitions(activeDefinition ?? DEFAULT_QUIZ_DEFINITION_V2, draft),
    [activeDefinition, draft],
  );
  const baseLabel =
    activeVersion === null ? 'the built-in default' : `active version ${String(activeVersion)}`;
  return (
    <ConfirmDialog
      testId="publish-dialog"
      title={`Publish as version ${String((activeVersion ?? 0) + 1)}?`}
      confirmLabel={busy ? 'Publishing…' : 'Publish'}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p className="mb-2 text-xs text-gray-500">
        Changes vs {baseLabel}
        {source === 'import' ? ' (this draft came from an imported file)' : ''}:
      </p>
      <div className="mb-3 rounded-lg bg-gray-50 p-3">
        <DiffList changes={changes} testId="publish-diff" />
      </div>
      <p
        data-testid="publish-propagation"
        className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900"
      >
        {PROPAGATION_NOTICE}
      </p>
    </ConfirmDialog>
  );
}
