'use client';

/**
 * ConfirmDialog — a minimal modal confirm (FOLLOW-1362 C3): the versions panel's restore / revert
 * and the publish dialog. `role="dialog"` + `aria-modal`; Escape cancels.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/confirm-dialog
 */

import { useEffect } from 'react';

export function ConfirmDialog({
  testId,
  title,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  testId: string;
  title: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 className="mb-3 text-base font-semibold text-gray-900">{title}</h2>
        <div className="text-sm text-gray-700">{children}</div>
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            data-testid={`${testId}-cancel`}
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid={`${testId}-confirm`}
            disabled={busy}
            onClick={onConfirm}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
