/**
 * A served EN-only definition without `confirm` texts — the shape of an old served row (and of
 * the built-in tree the SDK carried until FOLLOW-1370). `DEFAULT_QUIZ_DEFINITION_V2` with every
 * non-EN text and its `confirm` block dropped: same ids, structure, weights and traits. The
 * widget walks it to `done` (no confirmation step) and shows no EN | PL switcher.
 */

import type { QuizDefinition } from '@estalara/shared';
import { DEFAULT_QUIZ_DEFINITION_V2 } from '@estalara/shared';

/** Deep copy keeping only the `en` entry of every i18n bag. */
function enOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(enOnly);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return Object.fromEntries(
      entries.filter(([k]) => k !== 'pl' && k !== 'es').map(([k, v]) => [k, enOnly(v)]),
    );
  }
  return value;
}

function build(): QuizDefinition {
  const def = enOnly(DEFAULT_QUIZ_DEFINITION_V2) as QuizDefinition;
  delete def.confirm;
  return { ...def, languages: ['en'] };
}

export const EN_ONLY_QUIZ_DEFINITION: QuizDefinition = build();
