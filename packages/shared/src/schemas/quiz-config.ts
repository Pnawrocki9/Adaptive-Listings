/**
 * Canonical QuizConfig shape shared between the API route and the dashboard UI.
 *
 * Single source of truth for:
 *   - The `language` enum (`'en' | 'pl' | 'es'`), which was duplicated and had drifted
 *     between `apps/control-plane/src/app/api/quiz/config/route.ts` (API-authoritative,
 *     `'en' | 'pl' | 'es'`) and `apps/control-plane/src/app/dashboard/quiz/page.tsx`
 *     (UI, was `'en' | 'pl'` — missing `'es'`). Fixed in FOLLOW-270.
 *   - The full `QuizConfig` interface and `QUIZ_LANGUAGE_VALUES` tuple, so both the API
 *     Zod validator and the dashboard `onChange` cast reference the same literal set.
 *
 * FOLLOW-271 (2026-06-11): `enabled` removed from `QuizConfig`, `QuizConfigSchema`, and
 * `QUIZ_DEFAULT_CONFIG`. The `tenants.quiz_enabled` typed boolean column is the sole SoT
 * for quiz ON/OFF. `QuizConfigSchema` now `.omit({ enabled: true })` at the Zod level so
 * the key cannot re-enter the persisted JSONB blob via any write path (Rule U).
 *
 * FOLLOW-274 (2026-06-11): `sticky_widget` RETIRED — zero SDK consumer (Rule U).
 *   - Removed from `QuizConfig`, `QuizConfigSchema`, `_QuizConfigFullSchema`, and
 *     `QUIZ_DEFAULT_CONFIG`. The dashboard toggle UI is also removed.
 *   - Migration `0027_strip_quiz_config_sticky_widget` strips existing rows.
 *   - `micro_polls_enabled` WIRED — `buildSnippet` now emits `data-micro-polls-enabled="true"`
 *     when the flag is on; `readConfig` parses it into `SdkConfig.microPollsEnabled`.
 *
 * Importers:
 *   - apps/control-plane/src/app/api/quiz/config/route.ts
 *   - apps/control-plane/src/app/dashboard/quiz/page.tsx
 *
 * @module @estalara/shared/schemas/quiz-config
 */

import { z } from 'zod';

/**
 * Ordered tuple of all supported quiz widget language codes.
 * API, dashboard, and SDK must all reference this constant — never repeat the literal set.
 */
export const QUIZ_LANGUAGE_VALUES = ['en', 'pl', 'es'] as const;

/** Union type derived from the canonical language list. */
export type QuizLanguage = (typeof QUIZ_LANGUAGE_VALUES)[number];

/**
 * Internal full schema (including legacy `enabled` and `sticky_widget`) used only for
 * parsing legacy stored blobs during GET reads. Never used to validate POST write paths.
 *
 * @internal
 */
const _QuizConfigFullSchema = z.object({
  enabled: z.boolean().optional(),
  sticky_widget: z.boolean().optional(),
  language: z.enum(QUIZ_LANGUAGE_VALUES).optional(),
  accent_color: z.string().optional(),
  /** Whether to show micro-poll bottom-toast prompts as a quiz supplement (FOLLOW-209). */
  micro_polls_enabled: z.boolean().optional(),
});

/**
 * Canonical Zod schema for the quiz widget BLOB configuration shape.
 *
 * `enabled` is OMITTED — the typed `tenants.quiz_enabled` boolean column is the sole SoT
 * for quiz ON/OFF (FOLLOW-102 / FOLLOW-271). `sticky_widget` is OMITTED — zero SDK consumer;
 * retired in FOLLOW-274 (Rule U). Both keys are stripped at parse time so they can never
 * re-enter the JSONB blob via the POST write path.
 *
 * Valid blob keys: `language`, `accentColor`, `microPollsEnabled`.
 * (Stored as snake_case: `language`, `accent_color`, `micro_polls_enabled`.)
 *
 * All fields are optional for PATCH-style partial updates. Consumers that need a
 * complete config should merge the result with `QUIZ_DEFAULT_CONFIG`.
 */
export const QuizConfigSchema = _QuizConfigFullSchema.omit({ enabled: true, sticky_widget: true });

/** TypeScript type inferred from the Zod schema — use this everywhere for the persisted blob. */
export interface QuizConfig {
  // `enabled` intentionally absent — use `tenants.quiz_enabled` typed column (FOLLOW-271, Rule U).
  // trigger_after_n_listings removed — Rule L / RETRO-050 HALF_WIRE_P (FOLLOW-264).
  // sticky_widget removed — zero SDK consumer, FOLLOW-274 (Rule U).
  language: QuizLanguage;
  accent_color: string;
  /**
   * Whether to show micro-poll bottom-toast prompts as a quiz supplement (FOLLOW-209).
   * Wired in FOLLOW-274: buildSnippet emits `data-micro-polls-enabled="true"` when true;
   * readConfig() parses `data-micro-polls-enabled` → `config.microPollsEnabled`.
   */
  micro_polls_enabled: boolean;
}

/**
 * Default values used when a tenant has no stored config.
 * Shared between GET handler and dashboard initialisation to keep defaults in sync.
 */
export const QUIZ_DEFAULT_CONFIG: QuizConfig = {
  language: 'en',
  accent_color: '#2563EB',
  micro_polls_enabled: false,
};

/**
 * Parse a stored JSONB blob that may contain legacy `enabled` or `sticky_widget` keys.
 * Both keys are stripped on output (they are never returned from this helper).
 *
 * Use this in GET handlers when reading rows that pre-date the backfill migrations:
 *   - `0026_strip_quiz_config_enabled.sql` removes `enabled` from all existing rows.
 *   - `0027_strip_quiz_config_sticky_widget.sql` removes `sticky_widget` from all existing rows.
 * This helper acts as a belt-and-suspenders guard for rows not yet backfilled.
 */
export function parseStoredQuizConfig(raw: unknown): Partial<QuizConfig> {
  // Parse with the full schema (tolerates legacy `enabled` + `sticky_widget`), then strip them.
  const result = _QuizConfigFullSchema.safeParse(raw);
  if (!result.success) return {};
  // Destructure to drop `enabled` and `sticky_widget`; the rest is the canonical blob shape.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { enabled: _dropped, sticky_widget: _droppedSticky, ...blob } = result.data;
  return blob as Partial<QuizConfig>;
}
