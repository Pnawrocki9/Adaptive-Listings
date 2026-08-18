/**
 * Runtime validation schema for the adapt response.
 *
 * Mirrors the canonical `AdaptationDirectives` type from
 * `packages/shared/src/directives.ts` (the source of truth for the `/api/adapt`
 * response contract). The SDK validates every adapt response against this schema
 * instead of an unchecked `as AdaptResponse` cast (FOLLOW-105 §F.5 / ADR-0006
 * §Decision 5A).
 *
 * Drift policy (ADR-0006 §Decision 4 / CI Rule H-adapt): the field set here MUST
 * match `AdaptationDirectives`. The CI guard `scripts/check-adapt-schema-drift.sh`
 * asserts both sides carry the same top-level field names.
 *
 * Parse semantics:
 *   - `.passthrough()` — unknown/extra fields are ALLOWED (forward-compatible:
 *     the server may add fields the SDK does not yet know about without breaking).
 *   - Missing required fields, type mismatches, or an out-of-enum archetype value
 *     all cause `.parse()` to throw; the caller (`fetchDirectives`) catches that,
 *     reports to Sentry when available, and returns `null` gracefully.
 *
 * `archetypeIdSchema` IS `@estalara/shared`'s `ArchetypeIdSchema` (re-exported, not
 * hand-copied) — see below. That schema derives from `CANONICAL_ARCHETYPE_IDS`
 * (`packages/shared/src/archetypes.ts`), which is itself guarded against
 * `ARCHETYPE_NAMES` (`packages/sdk/src/core/intent.ts`, the true canonical source) by
 * `packages/shared/src/__tests__/archetype-canonical-parity.test.ts`. There is no
 * hand-maintained literal left in this file to drift (FOLLOW-590 / RETRO-185).
 *
 * @module @estalara/sdk/core/adapt-schema
 */

import { ArchetypeIdSchema } from '@estalara/shared';
import { z } from 'zod';

/**
 * Canonical archetype identifiers — re-export of `@estalara/shared`'s
 * `ArchetypeIdSchema`, which derives from `CANONICAL_ARCHETYPE_IDS`
 * (`packages/shared/src/archetypes.ts`). Includes the `'neutral'` fallback.
 */
export const archetypeIdSchema = ArchetypeIdSchema;

/** Mirror of `TextDirective`. */
const textDirectiveSchema = z
  .object({
    type: z.literal('text'),
    slot: z.string(),
    value: z.string(),
    archetype: archetypeIdSchema,
    confidence: z.number(),
  })
  .passthrough();

/** Mirror of `ClassDirective`. */
const classDirectiveSchema = z
  .object({
    type: z.literal('class'),
    selector: z.string(),
    add: z.array(z.string()),
    remove: z.array(z.string()),
    archetype: archetypeIdSchema,
    confidence: z.number(),
  })
  .passthrough();

/** Mirror of `ReorderDirective` (its `archetype` field is a plain string upstream). */
const reorderDirectiveSchema = z
  .object({
    type: z.literal('reorder'),
    container_selector: z.string(),
    item_selector: z.string(),
    score_function: z.literal('archetype_affinity'),
    scores: z.array(
      z.object({
        listing_id: z.string(),
        score: z.number(),
      }),
    ),
    pin_top_n: z.number().optional(),
    archetype: z.string(),
    confidence: z.number(),
  })
  .passthrough();

const directiveSchema = z.discriminatedUnion('type', [
  textDirectiveSchema,
  classDirectiveSchema,
  reorderDirectiveSchema,
]);

/**
 * Zod schema for the canonical `AdaptationDirectives` adapt response.
 *
 * Top-level `.passthrough()` allows server-added fields the SDK does not model
 * yet (e.g. `holdout_group`, `reorderDirectives`, a future `explainability_id`).
 */
export const adaptResponseSchema = z
  .object({
    adapt_decision_id: z.string(),
    session_id: z.string(),
    archetype: archetypeIdSchema,
    confidence: z.number(),
    similarity: z.number(),
    // page_context: page-type signal from POST /api/adapt (FOLLOW-357, NOT an integration Tier).
    // Values: 2 = listing_detail (full directive set), 1 = list/search/home (lighter set).
    // Optional — absent on legacy GET responses.
    page_context: z.union([z.literal(1), z.literal(2)]).optional(),
    directives: z.array(directiveSchema),
    source: z.enum([
      'playbook',
      'llm_tweaked',
      'llm_full',
      'default',
      'playbook_fallback_llm_capped',
      'playbook_fallback_llm_unavailable',
    ]),
    variant: z.string().optional(),
    generated_at: z.string(),
    /**
     * Flattened chat-intent dimensions from Modal NLP pipeline (FOLLOW-101).
     * Absent when no shadow data exists for the session.
     */
    chat_intent_dimensions: z.record(z.string()).nullish(),
    // FOLLOW-1024: watermark for the line above — see `chat_intent_detected_at` in
    // `@estalara/shared`. Nullish because a pre-FOLLOW-1024 shadow record has no stamp.
    chat_intent_detected_at: z.string().nullish(),
    /**
     * Resolved slot selector map from detail_schema.slot_selectors (FOLLOW-340).
     *
     * Optional additive field — omitted when the tenant has no curated slot selectors
     * or when the control-plane schema lookup fails (fail-safe). The SDK uses this to
     * self-annotate DOM nodes with data-estalara-slot BEFORE the first applyDirectives()
     * call so pages without hand-coded slot attributes visibly adapt.
     */
    slot_selectors: z.record(z.string()).optional(),
  })
  .passthrough();

/** Inferred TypeScript type for a validated adapt response. */
export type ValidatedAdaptResponse = z.infer<typeof adaptResponseSchema>;
