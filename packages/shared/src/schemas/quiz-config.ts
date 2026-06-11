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
 * Canonical Zod schema for the quiz widget configuration shape.
 *
 * All fields are optional for PATCH-style partial updates. Consumers that need a
 * complete config should merge the result with `QUIZ_DEFAULT_CONFIG`.
 *
 * Note on `enabled`: The JSONB `enabled` key is a legacy field that pre-dates the
 * `tenants.quiz_enabled` typed boolean column (added in FOLLOW-102). The typed column is
 * the authoritative source of truth for the ON/OFF toggle. `enabled` is still written
 * to the JSONB blob for backward compat but is NOT read by the freeze guard or the SDK.
 * FOLLOW-271 will strip it from the write path.
 */
export const QuizConfigSchema = z.object({
  enabled: z.boolean().optional(),
  // trigger_after_n_listings removed — Rule L / RETRO-050 HALF_WIRE_P (FOLLOW-264).
  // SDK consumer was deleted in FOLLOW-257; producer removed in FOLLOW-264.
  // Re-add ALL THREE LIMBS together under FOLLOW-199 (Quiz v2.0).
  sticky_widget: z.boolean().optional(),
  language: z.enum(QUIZ_LANGUAGE_VALUES).optional(),
  accent_color: z.string().optional(),
  /** Whether to show micro-poll bottom-toast prompts as a quiz supplement (FOLLOW-209). */
  micro_polls_enabled: z.boolean().optional(),
});

/** TypeScript type inferred from the Zod schema — use this everywhere. */
export interface QuizConfig {
  enabled: boolean;
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
  enabled: false,
  sticky_widget: false,
  language: 'en',
  accent_color: '#2563EB',
  micro_polls_enabled: false,
};
