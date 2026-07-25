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

import { CANONICAL_ARCHETYPE_IDS } from '../archetypes.js';
import { QuizLanguageSchema, QuizPublicConfigResponseSchema } from './quiz-config.js';

/**
 * A canonical archetype identifier — one of the 18 members of `CANONICAL_ARCHETYPE_IDS`
 * (`packages/shared/src/archetypes.ts`), including the `'neutral'` fallback. Structurally
 * identical to the SDK's `Archetype` union (`packages/sdk/src/core/intent.ts`); kept as a
 * derived type here so this module has no dependency on `@estalara/sdk` (the reverse import
 * would create a circular package edge — see `archetypes.ts`).
 */
export type CanonicalArchetypeId = (typeof CANONICAL_ARCHETYPE_IDS)[number];

/** O(1) membership set for the canonical archetype ids (weights-key integrity checks). */
const CANONICAL_ARCHETYPE_ID_SET: ReadonlySet<string> = new Set<string>(CANONICAL_ARCHETYPE_IDS);

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

// ─── Quiz definition slice (FOLLOW-639 / ADR-0019 D3 + D5) ─────────────────────

/**
 * An i18n label bag: language code → string. Falls back to `'en'` at render time when
 * the requested language is absent (ADR-0019 D3). A served definition need only carry
 * the languages the brand authored; the SDK renderer resolves `bag[lang] ?? bag.en`.
 *
 * NOTE: `z.record(QuizLanguageSchema, …)` validates that PRESENT keys are valid language
 * codes; it does NOT require all three to be present (partial by design — the fallback
 * above is the contract).
 */
export const LabelI18nSchema = z.record(QuizLanguageSchema, z.string());

/** TypeScript type for an i18n label bag. Keys are optional; resolve with an `'en'` fallback. */
export type LabelI18n = z.infer<typeof LabelI18nSchema>;

/**
 * One selectable answer in a quiz question (ADR-0019 D3).
 *   - `weights` — archetype_id → numeric weight. Keys are refined to `CANONICAL_ARCHETYPE_IDS`
 *     by `QuizDefinitionSchema.superRefine` (unknown ids are a HARD write error). An empty
 *     object contributes nothing (used for pure branch/gate answers).
 *   - `next`    — the id of the next question, or `null` for a leaf (ends the walk).
 */
export const QuizAnswerSchema = z.object({
  id: z.string().min(1),
  label_i18n: LabelI18nSchema,
  weights: z.record(z.string(), z.number()),
  next: z.string().min(1).nullable(),
});

/** TypeScript type for one quiz answer. */
export type QuizAnswer = z.infer<typeof QuizAnswerSchema>;

/** One quiz question: a prompt plus ≥2 answers (ADR-0019 D3). */
export const QuizQuestionSchema = z.object({
  id: z.string().min(1),
  prompt_i18n: LabelI18nSchema,
  answers: z.array(QuizAnswerSchema).min(2),
});

/** TypeScript type for one quiz question. */
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

/**
 * The fully editable per-brand quiz definition (ADR-0019 D3 + D5 / FOLLOW-639).
 *
 * A directed graph of questions: the walk starts at `root` and follows each selected
 * answer's `next` until a leaf (`next: null`), accumulating the selected answers'
 * `weights` vectors. The SDK reduces the accumulated vector to a single archetype by
 * argmax (`reduceWeightsToArchetype`), preserving the byte-for-byte downstream
 * persistence contract (ADR-0014 SoT + FOLLOW-101/554 + the completion ping).
 *
 * `.superRefine` enforces the HARD integrity guardrails (CEO ruling + ADR-0019 D3) —
 * a definition that fails ANY of these is REJECTED on write (never served):
 *   1. Every `weights` key MUST be a member of `CANONICAL_ARCHETYPE_IDS`
 *      (`packages/shared/src/archetypes.ts`) — unknown archetype ids are rejected.
 *   2. `root` and every non-null `answer.next` MUST reference an existing question id —
 *      dangling references are rejected.
 *   3. Question ids MUST be unique — a duplicate id makes the graph ambiguous.
 *   4. The graph reachable from `root` MUST be acyclic — a cycle is rejected (the walk
 *      would never terminate).
 *
 * The unreachable-ARCHETYPE check is deliberately NOT here (CEO ruled it non-blocking) —
 * it is the separate `computeUnreachableArchetypes` warning helper below.
 */
export const QuizDefinitionSchema = z
  .object({
    schema_version: z.literal(1),
    root: z.string().min(1),
    questions: z.array(QuizQuestionSchema).min(1),
    languages: z.array(QuizLanguageSchema).min(1),
  })
  .superRefine((def, ctx) => {
    // Build the question-id index and detect duplicates (guardrail 3).
    const byId = new Map<string, QuizQuestion>();
    for (const q of def.questions) {
      if (byId.has(q.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate question id "${q.id}"`,
          path: ['questions'],
        });
      }
      byId.set(q.id, q);
    }

    // Guardrail 1: unknown archetype weight keys.
    def.questions.forEach((q, qi) => {
      q.answers.forEach((ans, ai) => {
        for (const archetypeId of Object.keys(ans.weights)) {
          if (!CANONICAL_ARCHETYPE_ID_SET.has(archetypeId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `unknown archetype id "${archetypeId}" in weights — not a member of CANONICAL_ARCHETYPE_IDS`,
              path: ['questions', qi, 'answers', ai, 'weights', archetypeId],
            });
          }
        }
      });
    });

    // Guardrail 2: dangling references (root + every answer.next).
    if (!byId.has(def.root)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `root references unknown question id "${def.root}"`,
        path: ['root'],
      });
    }
    def.questions.forEach((q, qi) => {
      q.answers.forEach((ans, ai) => {
        if (ans.next !== null && !byId.has(ans.next)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `answer.next references unknown question id "${ans.next}"`,
            path: ['questions', qi, 'answers', ai, 'next'],
          });
        }
      });
    });

    // Guardrail 4: cycle detection via DFS colouring from root (only over resolvable
    // edges — dangling edges are already reported above and are skipped here).
    const WHITE = 0;
    const GREY = 1;
    const BLACK = 2;
    const colour = new Map<string, number>();
    let cycleFound = false;
    const visit = (qid: string): void => {
      if (cycleFound) return;
      colour.set(qid, GREY);
      const q = byId.get(qid);
      if (q) {
        for (const ans of q.answers) {
          if (ans.next === null) continue;
          const nextColour = colour.get(ans.next) ?? WHITE;
          if (nextColour === GREY) {
            cycleFound = true;
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `cycle detected in question graph (back-edge to "${ans.next}")`,
              path: ['questions'],
            });
            return;
          }
          if (nextColour === WHITE && byId.has(ans.next)) visit(ans.next);
        }
      }
      colour.set(qid, BLACK);
    };
    if (byId.has(def.root)) visit(def.root);
  });

/** TypeScript type for a full quiz definition. */
export type QuizDefinition = z.infer<typeof QuizDefinitionSchema>;

/**
 * Reduce an accumulated archetype-weight vector to a SINGLE resolved archetype by argmax
 * (ADR-0019 D5). This is the ONE source of truth for the reduction semantics — used by
 * both the SDK tree-walker (`packages/sdk/src/ui/quiz-widget.ts`) and the editor's
 * `computeUnreachableArchetypes` warning helper below, so the warning can never disagree
 * with what the SDK actually resolves.
 *
 * Semantics (deterministic):
 *   - Iterate `CANONICAL_ARCHETYPE_IDS` IN ORDER; the earliest-canonical archetype among
 *     ties wins (the ADR-0019 tie-break). Non-canonical keys are ignored (the schema
 *     rejects them on write anyway).
 *   - An empty / all-non-positive vector reduces to `'neutral'` (the Q1-skip default).
 *
 * @param weights - archetype_id → accumulated numeric weight.
 * @returns the argmax canonical archetype id, or `'neutral'`.
 */
export function reduceWeightsToArchetype(weights: Record<string, number>): CanonicalArchetypeId {
  let best: CanonicalArchetypeId = 'neutral';
  let bestValue = 0;
  for (const id of CANONICAL_ARCHETYPE_IDS) {
    if (id === 'neutral') continue;
    const value = weights[id] ?? 0;
    if (value > bestValue) {
      bestValue = value;
      best = id;
    }
  }
  return best;
}

/**
 * Compute the archetypes that can NEVER be the resolved leaf of any complete path through
 * a quiz definition (ADR-0019 D3 — the NON-BLOCKING editor warning). Enumerates every
 * root→leaf path, runs `reduceWeightsToArchetype` on each accumulated vector, and reports
 * the canonical non-neutral archetypes that no path ever produces.
 *
 * Non-blocking by design: a brand may author a tree that narrows the reachable archetype
 * space; the CEO ruled this a warning, not a write error. Cycle-safe (a per-path visited
 * guard bounds recursion even if called on a not-yet-validated draft) and path-bounded
 * (`MAX_PATHS`) so a pathological draft cannot hang the editor.
 *
 * @param def - the quiz definition (validated or a draft under edit).
 * @returns canonical non-neutral archetype ids unreachable under this tree (may be empty).
 */
export function computeUnreachableArchetypes(def: QuizDefinition): CanonicalArchetypeId[] {
  const byId = new Map<string, QuizQuestion>(def.questions.map((q) => [q.id, q]));
  const reachedLeaves = new Set<string>();
  const MAX_PATHS = 20_000;
  let pathCount = 0;

  const walk = (qid: string, acc: Record<string, number>, seen: ReadonlySet<string>): void => {
    if (pathCount >= MAX_PATHS) return;
    const q = byId.get(qid);
    if (!q || seen.has(qid)) return;
    const nextSeen = new Set(seen);
    nextSeen.add(qid);
    for (const ans of q.answers) {
      const merged: Record<string, number> = { ...acc };
      for (const [archetypeId, weight] of Object.entries(ans.weights)) {
        merged[archetypeId] = (merged[archetypeId] ?? 0) + weight;
      }
      if (ans.next === null || !byId.has(ans.next)) {
        pathCount += 1;
        reachedLeaves.add(reduceWeightsToArchetype(merged));
      } else {
        walk(ans.next, merged, nextSeen);
      }
    }
  };
  walk(def.root, {}, new Set<string>());

  return CANONICAL_ARCHETYPE_IDS.filter((id) => id !== 'neutral' && !reachedLeaves.has(id));
}

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
  /**
   * Quiz-definition slice (FOLLOW-639). The tenant's ACTIVE editable quiz tree. Absent →
   * SDK uses its built-in default tree (`DEFAULT_QUIZ_DEFINITION`), byte-identical to
   * pre-ADR-0019 (ADR-0019 D4/D5). The producer
   * (`apps/control-plane/src/app/api/quiz/public-config/route.ts`) emits this only when a
   * validated active `quiz_definitions` row exists; the consumer
   * (`packages/sdk/src/ui/quiz-widget.ts` walker via `index.ts` `mergeQuizConfig`) walks it.
   */
  quiz_definition: QuizDefinitionSchema.optional(),
});

/** TypeScript type for the unified `GET /api/quiz/public-config` 200 response body. */
export type PresentationConfigResponse = z.infer<typeof PresentationConfigResponseSchema>;
