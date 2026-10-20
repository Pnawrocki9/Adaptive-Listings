/**
 * validateDraft — client-side validation of the editor's JSON draft (FOLLOW-1362 C2): the SAME
 * serve schema the server enforces (hard integrity errors), then `lintQuizDefinition` (authoring
 * errors that block Save, warnings that never do).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/validate-draft
 */

import type { QuizDefinition, QuizLintIssue } from '@estalara/shared';
import {
  QuizDefinitionSchema,
  computeUnreachableArchetypes,
  lintQuizDefinition,
} from '@estalara/shared';

export interface ValidationResult {
  /** Parsed + serve-schema-valid definition, or null when the text is not a valid definition. */
  definition: QuizDefinition | null;
  /** Human-readable hard errors (JSON parse OR schema integrity). Empty when valid. */
  errors: string[];
  /** Non-blocking unreachable-archetype warning (only when the definition is valid). */
  unreachable: string[];
  /** Authoring lint ERRORS (block Save) — only computed for a serve-valid definition. */
  lintErrors: QuizLintIssue[];
  /** Authoring lint WARNINGS (never block), minus `unreachable_archetype` (own banner). */
  lintWarnings: QuizLintIssue[];
}

const EMPTY_VALIDATION: Omit<ValidationResult, 'definition' | 'errors'> = {
  unreachable: [],
  lintErrors: [],
  lintWarnings: [],
};

/** Parse + validate the editor text: the SAME serve schema the server enforces, then the lint. */
export function validateDraft(text: string): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      definition: null,
      errors: [`JSON parse error: ${err instanceof Error ? err.message : 'invalid JSON'}`],
      ...EMPTY_VALIDATION,
    };
  }
  const result = QuizDefinitionSchema.safeParse(raw);
  if (!result.success) {
    return {
      definition: null,
      errors: result.error.issues.map(
        (i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`,
      ),
      ...EMPTY_VALIDATION,
    };
  }
  const lint = lintQuizDefinition(result.data);
  return {
    definition: result.data,
    errors: [],
    unreachable: computeUnreachableArchetypes(result.data),
    lintErrors: lint.errors,
    lintWarnings: lint.warnings.filter((w) => w.code !== 'unreachable_archetype'),
  };
}
