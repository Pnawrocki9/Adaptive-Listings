'use client';

/**
 * LintPanel — the authoring lint of the draft (FOLLOW-1362 C2). Errors block Save (the parent
 * disables it); warnings never do. The same panel renders the SERVER's 400 `issues[]` after a
 * rejected PUT, so a rule the client lint missed (or a newer server rule) is still visible.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/lint-panel
 */

import type { QuizDefinition, QuizLintIssue } from '@estalara/shared';

import { describePath } from './definition-ops';

function IssueList({
  definition,
  issues,
}: {
  definition: QuizDefinition | null;
  issues: readonly QuizLintIssue[];
}): React.JSX.Element {
  return (
    <ul className="mt-1 list-disc pl-5">
      {issues.map((issue, i) => (
        <li key={`${issue.code}-${String(i)}`}>
          <span className="font-mono text-xs">{issue.code}</span>
          {issue.path.length > 0 && (
            <span className="text-xs opacity-70">
              {' '}
              [{definition ? describePath(definition, issue.path) : issue.path.join('.')}]
            </span>
          )}{' '}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

export function LintPanel({
  definition,
  errors,
  warnings,
  serverIssues,
}: {
  definition: QuizDefinition | null;
  errors: readonly QuizLintIssue[];
  warnings: readonly QuizLintIssue[];
  /** The `issues[]` of the last rejected save (400), if any. */
  serverIssues: readonly QuizLintIssue[];
}): React.JSX.Element | null {
  if (errors.length === 0 && warnings.length === 0 && serverIssues.length === 0) return null;
  return (
    <div data-testid="lint-panel" className="mt-3 space-y-2">
      {errors.length > 0 && (
        <div
          role="alert"
          data-testid="lint-errors"
          className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <p className="font-medium">
            {String(errors.length)} problem{errors.length === 1 ? '' : 's'} block saving:
          </p>
          <IssueList definition={definition} issues={errors} />
        </div>
      )}
      {serverIssues.length > 0 && (
        <div
          role="alert"
          data-testid="server-issues"
          className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <p className="font-medium">The server rejected this definition:</p>
          <IssueList definition={definition} issues={serverIssues} />
        </div>
      )}
      {warnings.length > 0 && (
        <div
          role="status"
          data-testid="lint-warnings"
          className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <p className="font-medium">
            {String(warnings.length)} warning{warnings.length === 1 ? '' : 's'} (do not block
            saving):
          </p>
          <IssueList definition={definition} issues={warnings} />
        </div>
      )}
    </div>
  );
}
