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
 * Internal full schema (including `enabled`) used only for parsing legacy stored blobs
 * during GET reads. Never used to validate POST write paths.
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
 * for quiz ON/OFF (FOLLOW-102 / FOLLOW-271). Calling `.parse()` or `.safeParse()` on this
 * schema strips the `enabled` key if present in the input, so it can never re-enter the
 * JSONB blob via the POST write path (Rule U).
 *
 * Valid blob keys: `accentColor`, `language`, `stickyWidget`, `microPollsEnabled`.
 * (Stored as snake_case: `accent_color`, `language`, `sticky_widget`, `micro_polls_enabled`.)
 *
 * All fields are optional for PATCH-style partial updates. Consumers that need a
 * complete config should merge the result with `QUIZ_DEFAULT_CONFIG`.
 */
export const QuizConfigSchema = _QuizConfigFullSchema.omit({ enabled: true });

/** TypeScript type inferred from the Zod schema — use this everywhere for the persisted blob. */
export interface QuizConfig {
  // `enabled` intentionally absent — use `tenants.quiz_enabled` typed column (FOLLOW-271, Rule U).
  // trigger_after_n_listings removed — Rule L / RETRO-050 HALF_WIRE_P (FOLLOW-264).
  // The SDK consumer was deleted in FOLLOW-257; producer removed here in FOLLOW-264.
  // Re-add under FOLLOW-199 (Quiz v2.0) with a matching SDK consumer.
  sticky_widget: boolean;
  language: QuizLanguage;
  accent_color: string;
  /** Whether to show micro-poll bottom-toast prompts as a quiz supplement (FOLLOW-209). */
  micro_polls_enabled: boolean;
}

/**
 * Default values used when a tenant has no stored config.
 * Shared between GET handler and dashboard initialisation to keep defaults in sync.
 */
export const QUIZ_DEFAULT_CONFIG: QuizConfig = {
  sticky_widget: false,
  language: 'en',
  accent_color: '#2563EB',
  micro_polls_enabled: false,
};

/**
 * Parse a stored JSONB blob that may contain a legacy `enabled` key.
 * The `enabled` key is stripped on output (it is never returned from this helper).
 *
 * Use this in GET handlers when reading rows that pre-date FOLLOW-271 backfill migration.
 * The migration (`0026_strip_quiz_config_enabled.sql`) removes `enabled` from all existing
 * rows, so this helper acts as a belt-and-suspenders guard.
 */
export function parseStoredQuizConfig(raw: unknown): Partial<QuizConfig> {
  // Parse with the full schema (tolerates legacy `enabled`), then strip it.
  const result = _QuizConfigFullSchema.safeParse(raw);
  if (!result.success) return {};
  // Destructure to drop `enabled`; the rest is the canonical blob shape.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { enabled: _dropped, ...blob } = result.data;
  return blob as Partial<QuizConfig>;
}
