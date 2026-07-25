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
 *   - `micro_polls_enabled` transport: post-ADR-0011, the SDK reads this value at runtime
 *     via `GET /api/quiz/public-config` → `fetchQuizConfig()` → `mergeQuizConfig()`.
 *     The snippet data-attributes `data-micro-polls-enabled` / `data-quiz-enabled` are
 *     RETIRED; `readConfig()` treats them as `DEPRECATED_FALLBACK` only (FOLLOW-275).
 *
 * FOLLOW-275 (2026-06-12): added `QuizLanguageSchema` Zod enum and
 * `QuizPublicConfigResponseSchema` for the new `GET /api/quiz/public-config` route
 * (ADR-0011, path ii). The schema is the canonical wire contract for the SDK runtime
 * fetch; the route is the non-test production consumer (Rule H / Rule I).
 *
 * Importers:
 *   - apps/control-plane/src/app/api/quiz/config/route.ts
 *   - apps/control-plane/src/app/api/quiz/public-config/route.ts  ← FOLLOW-275
 *   - apps/control-plane/src/app/dashboard/quiz/page.tsx
 *
 * @module @estalara/shared/schemas/quiz-config
 */

import { z } from 'zod';

import { WidgetPlacementSchema, type WidgetPlacement } from './widget-placement.js';

/**
 * Ordered tuple of all supported quiz widget language codes.
 * API, dashboard, and SDK must all reference this constant — never repeat the literal set.
 */
export const QUIZ_LANGUAGE_VALUES = ['en', 'pl', 'es'] as const;

/** Zod enum schema derived from the canonical language list. */
export const QuizLanguageSchema = z.enum(QUIZ_LANGUAGE_VALUES);

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
  /**
   * Quiz sticky-trigger placement (FOLLOW-640 / ADR-0019 D2). The corner+offset model lives
   * in `quiz_config` per ADR-0019 D2 (quiz-widget UX is `quiz_config`'s charter). Optional:
   * absent → the SDK uses `DEFAULT_QUIZ_PLACEMENT` (byte-identical to the pre-FOLLOW-640
   * hardcoded `bottom:24px; left:24px`). Consumed at runtime by the SDK via
   * `GET /api/quiz/public-config` → the `quiz_placement` slice → `renderQuizTrigger`.
   */
  placement: WidgetPlacementSchema.optional(),
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
   * Post-ADR-0011 (FOLLOW-275): the SDK fetches this value at runtime via
   * `GET /api/quiz/public-config` → `fetchQuizConfig()` → `mergeQuizConfig()`.
   * The `data-micro-polls-enabled` snippet attribute is RETIRED; `readConfig()` treats
   * it as `DEPRECATED_FALLBACK` only. No snippet re-install is needed when this changes.
   */
  micro_polls_enabled: boolean;
  /**
   * Quiz sticky-trigger placement (FOLLOW-640 / ADR-0019 D2). Optional — absent means the SDK
   * uses `DEFAULT_QUIZ_PLACEMENT` (byte-identical to pre-FOLLOW-640). Emitted on the SDK wire
   * as the `quiz_placement` slice of `GET /api/quiz/public-config`.
   */
  placement?: WidgetPlacement;
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
 * Wire contract for `GET /api/quiz/public-config` — the SDK runtime fetch endpoint
 * introduced in FOLLOW-275 (ADR-0011, path ii).
 *
 * Auth: `Authorization: Bearer <tenant-api-key>` (the SDK's `data-api-key`).
 * CORS: `Access-Control-Allow-Origin: *` (read-only, no PII).
 * Cache-Control: `max-age=300, stale-while-revalidate=60`.
 *
 * All four core fields are always present in a 200 response — no field is `null`.
 * The SDK falls back to snippet-attribute values, then to hardcoded defaults,
 * on any non-200 or network error.
 *
 * `data_source` (FOLLOW-277, Rule K.2): indicates whether the response reflects a live
 * DB read (`'db'`) or fallback defaults (`'fallback'`). The field is optional so
 * pre-277 cached responses without it still parse correctly. When `'fallback'`, the
 * SDK emits a `console.warn` in debug mode so the degraded state is observable.
 *
 * Non-test production consumer: `apps/control-plane/src/app/api/quiz/public-config/route.ts`
 * (Rule H / Rule I).
 */
export const QuizPublicConfigResponseSchema = z.object({
  quiz_enabled: z.boolean(),
  micro_polls_enabled: z.boolean(),
  language: QuizLanguageSchema,
  accent_color: z.string(),
  /**
   * Provenance flag (Rule K.2 / FOLLOW-277). Optional for backward compatibility with
   * responses cached before this field was added.
   *   - `'db'`       — values read from the live DB tenant row.
   *   - `'fallback'` — DB unavailable or not configured; default values returned.
   */
  data_source: z.enum(['db', 'fallback']).optional(),
});

/** TypeScript type for the `GET /api/quiz/public-config` 200 response body. */
export type QuizPublicConfigResponse = z.infer<typeof QuizPublicConfigResponseSchema>;

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
