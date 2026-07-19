/**
 * Zod schemas for the long-form listing description pipeline.
 *
 * Per Master Design E.7 and TICKET-DESC-001.
 *
 * `DescriptionResponseSchema` — the response shape of GET /api/adapt/description.
 * Used by the endpoint handler and by SDK TypeScript consumers.
 *
 * `DescriptionRequestedEventSchema` — the Redpanda event payload published when a
 * Tier 2/3 cache miss triggers a Modal async job. The ml-engineer's Modal job
 * subscribes to topic `estalara.descriptions` and consumes this shape.
 *
 * Source values:
 *   - `template_fallback` — returned immediately from PlaybookEntry.copy_template (Tier 1
 *     always; Tier 2/3 on cache miss while Modal job is enqueued)
 *   - `ai_cached` — the Redis cache was populated by a prior Modal job run; returned on hit
 *
 * Note: Master Design E.7.2 also lists `ai_generated` as a possible source value, but the
 * correct term is `ai_cached` — the endpoint only writes the description once Redis is
 * populated by the Modal job. The endpoint itself never waits for generation; callers on a
 * cache miss always receive `template_fallback` synchronously, and will receive `ai_cached`
 * on the next request after the Modal job completes.
 *
 * FOLLOW-273 (2026-06-11): `LocaleSchema` now derives from `QUIZ_LANGUAGE_VALUES` in
 * `quiz-config.ts` — that tuple is the single source of truth for `['en','pl','es']`.
 * This eliminates the previously duplicated literal array here.
 *
 * @module @estalara/shared/schemas/description
 */

import { z } from 'zod';

import { CANONICAL_ARCHETYPE_IDS } from '../archetypes.js';
import { QUIZ_LANGUAGE_VALUES } from './quiz-config.js';

/**
 * Valid archetype IDs — mirrors `ArchetypeId` in `@estalara/shared/directives`.
 *
 * Built from `CANONICAL_ARCHETYPE_IDS` (`../archetypes.js`), the single canonical source
 * of this list within `packages/shared` (FOLLOW-584). `z.enum()` requires a mutable,
 * non-empty tuple (`[string, ...string[]]`), so the readonly `as const` array is spread
 * into a fresh mutable array rather than passed directly.
 */
export const ArchetypeIdSchema = z.enum([...CANONICAL_ARCHETYPE_IDS]);

/**
 * Supported locale codes for the description pipeline.
 *
 * Derived from `QUIZ_LANGUAGE_VALUES` (packages/shared/src/schemas/quiz-config.ts) which is
 * the single source of truth for the `['en','pl','es']` tuple (FOLLOW-273). The two sets are
 * intentionally co-extensive: the description API locale and the quiz/UI locale share the
 * same supported language set. If a new locale is ever added, update `QUIZ_LANGUAGE_VALUES`
 * in quiz-config.ts and this schema updates automatically.
 */
export const LocaleSchema = z.enum(QUIZ_LANGUAGE_VALUES);
export type Locale = z.infer<typeof LocaleSchema>;

/** Integration tier for description gating. */
export const TierSchema = z.enum(['1', '2', '3']);

/**
 * The source of the description in the response.
 *
 * - `template_fallback` — static copy_template.en from the playbook (no Redis, no AI).
 *   Used for Tier 1 (always), and Tier 2/3 on cache miss while the Modal job is enqueued.
 * - `ai_cached`         — AI-generated text retrieved from Upstash Redis.
 *   Written by the Modal job (apps/llm-gateway/src/jobs/generate_description.py).
 */
export const DescriptionSourceSchema = z.enum(['template_fallback', 'ai_cached']);
export type DescriptionSource = z.infer<typeof DescriptionSourceSchema>;

/**
 * Response schema for GET /api/adapt/description.
 *
 * @example
 * // Tier 1 or cache miss (template fallback)
 * {
 *   description: "This income-producing property...",
 *   headline: null,
 *   source: "template_fallback",
 *   locale: "en",
 *   generated_at: null
 * }
 *
 * @example
 * // Cache hit (AI-generated description + headline present in Redis)
 * {
 *   description: "Exceptional gross yield of 7.2% makes this...",
 *   headline: "Strong yield play in a well-connected central location",
 *   source: "ai_cached",
 *   locale: "en",
 *   generated_at: "2026-05-14T12:00:00.000Z"
 * }
 */
export const DescriptionResponseSchema = z.object({
  /** The property description text. */
  description: z.string().min(1),

  /**
   * Per-listing LLM-generated headline (ADR-0009).
   * Present (non-null) on `ai_cached` responses when the Modal job successfully
   * generated a headline alongside the description.
   * Null on `template_fallback` responses (cold-start) and when headline
   * generation failed — in both cases the SDK keeps the playbook headline directive.
   */
  headline: z.string().nullable().optional(),

  /** How the description was produced. */
  source: DescriptionSourceSchema,

  /** BCP-47 locale code of the returned text. */
  locale: LocaleSchema,

  /**
   * ISO 8601 timestamp of the most recent AI generation.
   * Null for `template_fallback` responses (no generation occurred).
   * For `ai_cached` responses, this is the timestamp embedded in the Redis JSON value
   * by the Modal job.
   */
  generated_at: z.string().datetime().nullable(),
});

export type DescriptionResponse = z.infer<typeof DescriptionResponseSchema>;

/**
 * The `description.requested` Redpanda event published by the control-plane endpoint
 * on a cache miss.
 *
 * Topic: `estalara.descriptions`
 * Consumer: apps/llm-gateway/src/jobs/generate_description.py (ml-engineer)
 *
 * The Modal job uses this payload to:
 *   1. Build a Sonnet 4.6 prompt using copy_template as seed + listing_context
 *   2. Call Anthropic Sonnet 4.6 directly (not through llm-gateway.ts)
 *   3. Write the result to Redis at cache_key (no TTL — Redis eviction handles memory pressure;
 *      Postgres in FOLLOW-204 is the durable truth)
 *
 * CEO decision 2026-06-05 (FOLLOW-203): Tier logic removed. All tenants use the same
 * generation path. `tier` and `ttl_seconds` are now optional for backward compat with
 * existing Python consumers that use event.get() with defaults; new events omit them.
 * `priority` is also deprecated (Tier 3 no longer exists).
 *
 * @example
 * {
 *   tenant_id: "550e8400-e29b-41d4-a716-446655440000",
 *   listing_id: "prop-123",
 *   archetype: "yield_hunter",
 *   locale: "en",
 *   copy_template: "This income-producing property...",
 *   listing_context: { "What is the rental yield?": "7.2%" },
 *   cache_key: "desc:550e8400...:prop-123:yield_hunter:en:claude-sonnet-4-6",
 *   max_tokens: 500,
 *   generation_model: "claude-sonnet-4-6"
 * }
 */
export const DescriptionRequestedEventSchema = z.object({
  /** Tenant UUID. */
  tenant_id: z.string().uuid(),

  /** The tenant's listing identifier (external, non-UUID). */
  listing_id: z.string().min(1).max(256),

  /** Archetype to generate the description for. */
  archetype: ArchetypeIdSchema,

  /** Locale for the generated text. */
  locale: LocaleSchema,

  /**
   * Integration tier.
   * @deprecated Tier logic removed (CEO decision 2026-06-05, FOLLOW-203). Optional for
   * backward compat with Python consumers that use event.get() with defaults.
   */
  tier: z.union([z.literal(2), z.literal(3)]).optional(),

  /**
   * Static ~100-150 word seed text from PlaybookEntry.copy_template.en.
   * Used as the base for Sonnet prompt construction.
   */
  copy_template: z.string().min(1),

  /**
   * The listing's ORIGINAL agent-authored description — the factual source of truth
   * the Modal job grounds the adapted description AND the per-listing headline in
   * (ESC-018 / ADR-0009). Fetched server-side by the control-plane route from the
   * Estalara backend listing-details API. May be an empty string when the listing
   * has no description or the backend is unreachable (fail-open); the key is always
   * present because the Modal consumer treats it as required and drops messages that
   * omit it. The v1.8 prompt handles an empty original via its thin-original exception.
   */
  original_description: z.string(),

  /**
   * Agency FAQ key-value pairs from RAG retrieval.
   * May be empty ({}) when no relevant FAQ answers were found.
   * Used to fill {variable} placeholders in the description.
   */
  listing_context: z.record(z.string()),

  /**
   * The Upstash Redis key where the Modal job must write the result.
   * Format: `desc:{tenant_id}:{listing_id}:{archetype}:{locale}:{model}`
   */
  cache_key: z.string().min(1),

  /**
   * Redis TTL in seconds for the SET command.
   * @deprecated No longer set by the control-plane (FOLLOW-203). Python job falls back to
   * its internal default_ttl when absent. Keys now persist until Redis eviction.
   */
  ttl_seconds: z.number().int().positive().optional(),

  /**
   * Job priority.
   * @deprecated Tier 3 (high priority) removed (FOLLOW-203). Field retained for backward
   * compat with existing Python consumers.
   */
  priority: z.enum(['normal', 'high']).optional(),

  /**
   * Maximum number of tokens for Sonnet to generate.
   * Single value: 500 (FOLLOW-203).
   */
  max_tokens: z.number().int().positive().optional(),

  /**
   * Optional LLM model override for DEMO MODE (DEMO-001).
   * When present, the Modal job must use this model instead of its default.
   * Must be one of the curated allow-list: claude-haiku-4-5-20251001,
   * claude-sonnet-4-6, claude-opus-4-8.
   * Consumed by ml-engineer in FOLLOW-166.
   * Takes precedence over generation_model (FOLLOW-161).
   */
  override_model: z.string().optional(),

  /**
   * Global admin-configured generation model (FOLLOW-161).
   * Threaded by the control-plane route on cache miss for standard (non-DEMO) requests.
   * Must be one of the curated allow-list: claude-haiku-4-5-20251001,
   * claude-sonnet-4-6, claude-opus-4-8.
   * Precedence in the Modal job: override_model > generation_model > _DEFAULT_GENERATION_MODEL.
   * Not present when override_model is set (DEMO MODE path uses override_model instead).
   */
  generation_model: z.string().optional(),
});

export type DescriptionRequestedEvent = z.infer<typeof DescriptionRequestedEventSchema>;

/**
 * The archetype-fit gate verdict (ADR-0010) attached to a cache entry.
 *
 * - `FIT`     — a description was generated; `text`/`description` is non-empty.
 * - `NEUTRAL` — the archetype-fit gate declined to adapt this (listing, archetype)
 *   pair (FOLLOW-465 negative cache). `text`/`description` is `''` and `headline`
 *   is `null`. A consumer that sees `NEUTRAL` must serve `template_fallback` and
 *   must NOT re-enqueue a new Sonnet generation.
 *
 * Absent/undefined on a cache entry means the implicit `FIT` verdict — every row
 * written before FOLLOW-465 lacks this field and is treated as FIT for full
 * backward compatibility.
 */
export const DescriptionVerdictSchema = z.enum(['FIT', 'NEUTRAL']);
export type DescriptionVerdict = z.infer<typeof DescriptionVerdictSchema>;

/**
 * Upstash Redis value shape stored by the Modal job.
 *
 * FOLLOW-465: `text` is normally non-empty, but a `NEUTRAL` verdict is a
 * negative-cache marker whose `text` is deliberately `''` (no description was
 * generated — the archetype-fit gate, ADR-0010, declined to adapt). The `.min(1)`
 * constraint on `text` is therefore relaxed via `superRefine` to apply only when
 * `verdict !== 'NEUTRAL'`, rather than overloading `''` as an undocumented silent
 * sentinel for every caller.
 */
export const DescriptionCacheValueSchema = z
  .object({
    /** The AI-generated description text. `''` only when verdict is `NEUTRAL`. */
    text: z.string(),
    /**
     * Per-listing LLM-generated headline (ADR-0009).
     * Null when headline generation failed, when generation was skipped, or when
     * verdict is `NEUTRAL`; absent in entries written before ADR-0009.
     * Optional so existing cache entries without the field remain valid.
     */
    headline: z.string().nullable().optional(),
    /** ISO 8601 timestamp of generation. */
    generated_at: z.string().datetime(),
    /** Archetype-fit verdict (ADR-0010 / FOLLOW-465). Absent ⇒ implicit `FIT`. */
    verdict: DescriptionVerdictSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.verdict !== 'NEUTRAL' && val.text.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: 1,
        type: 'string',
        inclusive: true,
        path: ['text'],
        message: 'text must be non-empty unless verdict is NEUTRAL',
      });
    }
  });

export type DescriptionCacheValue = z.infer<typeof DescriptionCacheValueSchema>;
