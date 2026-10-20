'use client';

/**
 * DiffList — a human-readable rendering of `diffQuizDefinitions` (FOLLOW-1362 C3). Shared by the
 * versions panel ("Diff vs active") and the publish dialog (diff summary vs the active version).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/diff-view
 */

import type { QuizChange } from '@estalara/shared';

const q = (s: string | null): string => (s === null ? '(none)' : `"${s}"`);

/** One change as a sentence (EN, for staff). Exhaustive over the `QuizChange` union. */
export function describeQuizChange(c: QuizChange): string {
  switch (c.type) {
    case 'root_changed':
      return `First question changed: ${c.before} → ${c.after}`;
    case 'languages_changed':
      return `Languages changed: ${c.before.join(', ')} → ${c.after.join(', ')}`;
    case 'question_added':
      return `Question ${c.questionId} added (position ${String(c.index + 1)})`;
    case 'question_removed':
      return `Question ${c.questionId} removed`;
    case 'question_reordered':
      return `Question ${c.questionId} moved from position ${String(c.from + 1)} to ${String(c.to + 1)}`;
    case 'question_kind_changed':
      return `Question ${c.questionId} kind: ${c.before} → ${c.after}`;
    case 'prompt_changed':
      return `Question ${c.questionId} prompt (${c.language.toUpperCase()}): ${q(c.before)} → ${q(c.after)}`;
    case 'answer_added':
      return `Answer ${c.answerId} added to ${c.questionId}`;
    case 'answer_removed':
      return `Answer ${c.answerId} removed from ${c.questionId}`;
    case 'answer_reordered':
      return `Answer ${c.answerId} of ${c.questionId} moved from ${String(c.from + 1)} to ${String(c.to + 1)}`;
    case 'label_changed':
      return `Answer ${c.questionId}/${c.answerId} text (${c.language.toUpperCase()}): ${q(c.before)} → ${q(c.after)}`;
    case 'next_changed':
      return `Answer ${c.questionId}/${c.answerId} leads to: ${c.before ?? 'end'} → ${c.after ?? 'end'}`;
    case 'weights_changed':
      return `Answer ${c.questionId}/${c.answerId} weights: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`;
    case 'traits_changed':
      return `Answer ${c.questionId}/${c.answerId} traits: [${c.before.join(', ')}] → [${c.after.join(', ')}]`;
    case 'confirm_text_changed':
      return `Confirmation ${c.field} for ${c.archetypeId} (${c.language.toUpperCase()}): ${q(c.before)} → ${q(c.after)}`;
    case 'confirm_alternatives_changed':
      return `Confirmation alternatives for ${c.archetypeId}: [${c.before.join(', ')}] → [${c.after.join(', ')}]`;
  }
}

export function DiffList({
  changes,
  testId = 'diff-list',
}: {
  changes: readonly QuizChange[];
  testId?: string;
}): React.JSX.Element {
  if (changes.length === 0) {
    return (
      <p data-testid={testId} className="text-sm text-gray-500">
        No differences.
      </p>
    );
  }
  return (
    <div data-testid={testId}>
      <p className="mb-1 text-sm font-medium text-gray-700">
        {String(changes.length)} change{changes.length === 1 ? '' : 's'}
      </p>
      <ul className="max-h-64 list-disc space-y-0.5 overflow-auto pl-5 text-xs text-gray-700">
        {changes.map((c, i) => (
          <li key={`${c.type}-${String(i)}`}>{describeQuizChange(c)}</li>
        ))}
      </ul>
    </div>
  );
}
