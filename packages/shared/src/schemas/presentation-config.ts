/**
 * Per-tenant presentation & content config — the unified SDK runtime contract (ADR-0019).
 *
 * ADR-0019 (`docs/adr/ADR-0019-per-tenant-presentation-config.md`, ACCEPTED 2026-07-24)
 * unifies four per-brand customization surfaces (brand, quiz placement, opt-out widget,
 * quiz definition) into ONE transport: the existing `GET /api/quiz/public-config` response,
 * extended with new OPTIONAL top-level slices. The SDK already performs exactly one
 * API-key-authenticated runtime fetch at init (ADR-0011 path ii); every slice rides that
 * same fetch keyed by tenant identity (DOMAIN-INDEPENDENT — resolved from the API key, never
 * the serving host, per the CEO domain-independence ruling in the FOLLOW-622/623 facades
 * decision brief, `docs/DECISION-BRIEF-FACADES-622-623` dated 2026-07-24).
 *
 * This module currently ships ONLY the `brand` slice (FOLLOW-623). The other three ADR-0019
 * slices (`quiz_placement` — FOLLOW-640, `opt_out_widget` — FOLLOW-641, `quiz_definition` —
 * FOLLOW-639) are added by their respective tickets together with their real SDK consumers
 * (Rule L "all three limbs": producer + schema + consumer land together — no unwired schema
 * key is added ahead of its consumer, Rule U).
 *
 * Nullability invariant (ADR-0019 D3 / D7): brand `logo_url` is `string | null`, NEVER
 * `string | undefined`, across every limb — the `/api/config` write path
 * (`apps/control-plane/src/app/api/config/route.ts` `BrandConfig.logo_url`), this wire
 * schema, and the SDK's parsed `SdkConfig.brand.logoUrl`.
 *
 * @module @estalara/shared/schemas/presentation-config
 */

import { z } from 'zod';

import { QuizPublicConfigResponseSchema } from './quiz-config.js';

/**
 * Six-digit hex color, e.g. `#1a73e8`. Byte-identical to the `/api/config` write-path
 * validator (`apps/control-plane/src/app/api/config/route.ts` `HEX_COLOR_RE`) so a color
 * that passes the write path also passes this read schema.
 */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Brand slice (FOLLOW-623) — byte-identical shape to the `BrandConfig` interface written by
 * `apps/control-plane/src/app/api/config/route.ts` (`tenants.brand_config` jsonb column):
 *   - `primary_color` — 6-digit hex brand color (the umbrella widget color; see D4 precedence).
 *   - `logo_url`      — brand logo URL or `null` (NEVER `undefined` — ADR-0019 D-nullability).
 *   - `white_label`   — whether Estalara branding is suppressed for this tenant.
 */
export const BrandConfigSchema = z.object({
  primary_color: z.string().regex(HEX_COLOR_RE, 'primary_color must be a 6-digit hex color'),
  logo_url: z.string().url().nullable(),
  white_label: z.boolean(),
});

/** TypeScript type for the brand slice. `logo_url` is `string | null`, never `undefined`. */
export type BrandConfig = z.infer<typeof BrandConfigSchema>;

/**
 * Unified `GET /api/quiz/public-config` wire contract — a SUPERSET of ADR-0011's
 * `QuizPublicConfigResponseSchema`. All new slices are `.optional()` so the response stays
 * backward-compatible: a shipped SDK that reads only the ADR-0011 subset ignores unknown
 * fields, and pre-existing cached responses (without the slices) still parse.
 *
 * `data_source: 'db' | 'fallback'` is inherited from `QuizPublicConfigResponseSchema`
 * (Rule K.2 / FOLLOW-277 provenance).
 *
 * Non-test production consumers:
 *   - producer: `apps/control-plane/src/app/api/quiz/public-config/route.ts` (emits `brand`).
 *   - consumer: `packages/sdk/src/core/quiz-config.ts` (`fetchQuizConfig` parses with this
 *     schema) → `packages/sdk/src/index.ts` (`mergeQuizConfig` applies the brand slice).
 */
export const PresentationConfigResponseSchema = QuizPublicConfigResponseSchema.extend({
  /** Brand slice (FOLLOW-623). Absent → SDK uses hardcoded widget defaults (ADR-0019 D4). */
  brand: BrandConfigSchema.optional(),
  // quiz_placement  — FOLLOW-640 (added with its SDK consumer)
  // opt_out_widget  — FOLLOW-641 (added with its SDK consumer)
  // quiz_definition — FOLLOW-639 (added with its SDK consumer)
});

/** TypeScript type for the unified `GET /api/quiz/public-config` 200 response body. */
export type PresentationConfigResponse = z.infer<typeof PresentationConfigResponseSchema>;
