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
import { isTraitId, type TraitId } from '../traits.js';
import { QuizLanguageSchema, QuizPublicConfigResponseSchema } from './quiz-config.js';
import { WidgetPlacementSchema } from './widget-placement.js';

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

// ─── Opt-out toggle widget slice (FOLLOW-641 / ADR-0019 D3) ────────────────────

/**
 * Per-brand config for the EXISTING profiling opt-out toggle widget
 * (`packages/sdk/src/ui/profiling-toggle.ts`, mounted unconditionally since PR #337).
 *
 * PREMISE-CORRECTED DEVIATION FROM ADR-0019 D3/D4 (FOLLOW-653, PR #622): the ADR's original
 * `OptOutWidgetConfigSchema` carried an `enabled: boolean` gate (default `false` → no widget)
 * because the ADR was authored under the belief that NO toggle UI existed. It does — and it
 * renders unconditionally. Adding an `enabled` gate here would (a) leave that field with no
 * consumer unless we ALSO changed the mount to opt-in (a behavior change the ticket forbids —
 * "unconfigured = byte-identical"), and (b) violate Rule U (an inert config key). So this
 * slice is APPEARANCE/PLACEMENT/LABEL config ONLY, applied to the always-rendered widget:
 *   - `placement` — corner+offsets; absent → `DEFAULT_OPTOUT_PLACEMENT` (bottom-left 16/16,
 *     byte-identical to the pre-FOLLOW-641 hardcoded position).
 *   - `labels`    — optional i18n overrides for the on/off state words + the aria label; each
 *     is a partial i18n bag resolved with an `'en'` fallback. Absent → the SDK's hardcoded
 *     per-locale COPY (byte-identical). The toggle's ACCENT COLOR is NOT here: per ADR-0019 D4
 *     the opt-out toggle (a widget with no per-widget color) takes `brand.primary_color`,
 *     carried by the `brand` slice.
 *
 * All keys optional → an unconfigured tenant omits the slice entirely and the widget renders
 * byte-identically to today (ADR-0019 D4).
 */
export const OptOutWidgetConfigSchema = z.object({
  placement: WidgetPlacementSchema.optional(),
  labels: z
    .object({ on: LabelI18nSchema, off: LabelI18nSchema, aria: LabelI18nSchema })
    .partial()
    .optional(),
});

/** TypeScript type for the opt-out toggle widget slice. */
export type OptOutWidgetConfig = z.infer<typeof OptOutWidgetConfigSchema>;

/**
 * One selectable answer in a quiz question (ADR-0019 D3).
 *   - `weights` — archetype_id → numeric weight. Keys are refined to `CANONICAL_ARCHETYPE_IDS`
 *     by `QuizDefinitionSchema.superRefine` (unknown ids are a HARD write error). An empty
 *     object contributes nothing (used for pure branch/gate answers).
 *   - `next`    — the id of the next question, or `null` for a leaf (ends the walk).
 *   - `traits`  — optional buyer traits this answer records (MASTER_DESIGN §E.4.2 v3.0,
 *     FOLLOW-1356). Traits never change the resolved archetype; they ride alongside it
 *     (`resolveQuizOutcome` in `quiz-walk.ts`). At SERVE time the entries are plain strings, so
 *     a trait added to `CANONICAL_TRAIT_IDS` later cannot make an older cached SDK reject the
 *     whole presentation config; the walker drops anything that is not a canonical trait
 *     (`isTraitId`). The authoring schema enforces canonical ids, at most 4, no duplicates.
 */
export const QuizAnswerSchema = z.object({
  id: z.string().min(1),
  label_i18n: LabelI18nSchema,
  weights: z.record(z.string(), z.number()),
  next: z.string().min(1).nullable(),
  traits: z.array(z.string()).optional(),
});

/** TypeScript type for one quiz answer. */
export type QuizAnswer = z.infer<typeof QuizAnswerSchema>;

/**
 * One quiz question: a prompt plus ≥2 answers (ADR-0019 D3).
 *
 * `kind` (FOLLOW-1356, MASTER_DESIGN §E.4.2 v3.0): `'single'` (the default when absent — one
 * answer, then follow its `next`) or `'multi'` (a tick-all-that-apply trait screen: the buyer
 * selects zero or more answers). The hard rule that a `multi` question's answers carry empty
 * `weights` and `next: null`, and that `kind` is one of the two values, are AUTHORING rules
 * (`QuizDefinitionAuthoringSchema`), not serve rules — see `quiz-lint.ts`. At serve time `kind`
 * is a plain string (forward compatibility, like `traits`) and the walker treats anything but
 * `'multi'` as `'single'`.
 */
export const QuizQuestionSchema = z.object({
  id: z.string().min(1),
  prompt_i18n: LabelI18nSchema,
  answers: z.array(QuizAnswerSchema).min(2),
  kind: z.string().optional(),
});

/** TypeScript type for one quiz question. */
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

/**
 * The result-confirmation block of a quiz definition (MASTER_DESIGN §E.4.2–§E.4.3 v3.0,
 * FOLLOW-1356) — the texts of the "Based on your answers: {name} — {sentence}. Is that right?"
 * screen and the correction ("Not quite") alternatives.
 *   - `names_i18n`     — archetype_id → display name bag.
 *   - `sentences_i18n` — archetype_id → one-sentence fact summary bag (second person).
 *   - `alternatives`   — archetype_id → 2–4 other archetype ids offered on "Not quite".
 *
 * Shape only here. Canonical, non-neutral, non-self keys are checked by
 * `QuizDefinitionSchema.superRefine` (cheap and safe at serve time); completeness (every
 * reachable archetype has a name and a sentence) and EN + PL presence are AUTHORING rules
 * (`quiz-lint.ts`). Consumed by the SDK confirmation screen (FOLLOW-1357 / Q2) and the admin
 * simulator and confirmation tab (FOLLOW-1362 / Q7) via `nextStep` in `quiz-walk.ts`.
 */
export const QuizConfirmSchema = z.object({
  names_i18n: z.record(z.string(), LabelI18nSchema),
  sentences_i18n: z.record(z.string(), LabelI18nSchema),
  alternatives: z.record(z.string(), z.array(z.string()).min(2).max(4)),
});

/** TypeScript type for the confirmation block. */
export type QuizConfirm = z.infer<typeof QuizConfirmSchema>;

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
 *   5. (FOLLOW-1356) When `confirm` is present, its keys and alternatives MUST be canonical
 *      non-neutral archetype ids and an archetype MUST NOT list itself.
 *
 * This is the SERVE schema: `GET /api/quiz/public-config` re-parses stored rows with it and
 * drops the slice on failure (buyers fall back to the default tree), so it stays LENIENT. The
 * stricter AUTHORING rules (EN + PL on every text, `multi` question shape, `confirm`
 * completeness, size limits) live in `QuizDefinitionAuthoringSchema` (`quiz-lint.ts`).
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
    confirm: QuizConfirmSchema.optional(),
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

    // Guardrail 5 (FOLLOW-1356): `confirm` keys and alternatives MUST be canonical,
    // non-neutral archetype ids and an archetype MUST NOT list itself. Cheap and safe at serve
    // time; the completeness and EN + PL rules are authoring-only (quiz-lint.ts). Written
    // compactly on purpose: this runs inside the SDK bundle (gzip budget, ESC-080).
    const confirm = def.confirm;
    if (confirm) {
      const bad = (id: string, path: (string | number)[], owner?: string): void => {
        const message =
          id === 'neutral' || !CANONICAL_ARCHETYPE_ID_SET.has(id)
            ? `"${id}" is not a canonical non-neutral archetype id`
            : id === owner
              ? `"${id}" lists itself`
              : '';
        if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
      };
      for (const field of ['names_i18n', 'sentences_i18n'] as const) {
        for (const id of Object.keys(confirm[field])) bad(id, ['confirm', field, id]);
      }
      for (const [id, alts] of Object.entries(confirm.alternatives)) {
        bad(id, ['confirm', 'alternatives', id]);
        alts.forEach((alt, i) => {
          bad(alt, ['confirm', 'alternatives', id, i], id);
        });
      }
    }
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
 * The `allowList` (default `QUIZ_TRAIT_ONLY_ARCHETYPE_IDS`) names archetypes the editor must
 * NOT warn about because the quiz deliberately no longer assigns them (MASTER_DESIGN §E.4.3
 * v3.0) — they stay in `CANONICAL_ARCHETYPE_IDS` and are reachable only through chat and
 * behaviour. Pass `[]` to get the raw list.
 *
 * @param def - the quiz definition (validated or a draft under edit).
 * @param allowList - archetype ids to leave out of the result.
 * @returns canonical non-neutral archetype ids unreachable under this tree (may be empty).
 */
export function computeUnreachableArchetypes(
  def: QuizDefinition,
  allowList: readonly CanonicalArchetypeId[] = QUIZ_TRAIT_ONLY_ARCHETYPE_IDS,
): CanonicalArchetypeId[] {
  const reachedLeaves = new Set<string>();
  walkQuizPaths(def, (path) => {
    reachedLeaves.add(reduceWeightsToArchetype(path.weights));
  });
  const allowed = new Set<string>(allowList);
  return CANONICAL_ARCHETYPE_IDS.filter(
    (id) => id !== 'neutral' && !reachedLeaves.has(id) && !allowed.has(id),
  );
}

/**
 * The five archetype ids the v3.0 quiz no longer assigns (MASTER_DESIGN §E.4.3): `upsizer`
 * (merged into `family_buyer`), `portfolio_builder` (merged into `yield_hunter`),
 * `luxury_buyer` / `remote_worker` / `golden_visa_buyer` (now the `premium` /
 * `works_from_home` / `residency_goal` traits). They remain canonical — the behaviour engine,
 * bandit seeds and description cache depend on them — and are reachable only via chat and
 * behaviour, so `computeUnreachableArchetypes` skips them by default.
 */
export const QUIZ_TRAIT_ONLY_ARCHETYPE_IDS: readonly CanonicalArchetypeId[] = [
  'upsizer',
  'portfolio_builder',
  'luxury_buyer',
  'remote_worker',
  'golden_visa_buyer',
];

/** One step of a root→leaf quiz path as produced by `walkQuizPaths`. */
export interface RawQuizPathStep {
  /** The question answered at this step. */
  question: QuizQuestion;
  /**
   * The chosen answer index (`single` question), or `[]` for a `multi` question (the walker
   * never branches on a trait screen; it records the empty selection).
   */
  answerIndex: number | number[];
}

/** A complete root→leaf path as produced by `walkQuizPaths`. */
export interface RawQuizPath {
  /** Steps in walk order. */
  steps: RawQuizPathStep[];
  /** Accumulated archetype weights along the path. */
  weights: Record<string, number>;
  /** Traits recorded by the path's `single` answers, in encounter order (may repeat). */
  traits: TraitId[];
}

/** Maximum number of root→leaf paths `walkQuizPaths` visits unless told otherwise. */
export const DEFAULT_MAX_QUIZ_PATHS = 20_000;

/**
 * The ONE root→leaf path enumerator behind `computeUnreachableArchetypes`,
 * `computeAmbiguousPaths` and `enumerateQuizPaths` (`quiz-walk.ts`), so the warnings can
 * never disagree with the walker.
 *
 * Depth-first, in question/answer declaration order. A path ends at an answer with
 * `next: null` or a dangling `next` (draft-safe), or at a `multi` question (a trait screen is
 * always last and carries no weights, so it is recorded once with an empty selection instead
 * of branching over its answers; the weights and traits of a `multi` question's answers are
 * ignored here, exactly as `replayPath` in `quiz-walk.ts` ignores their weights — authoring
 * forbids weights on them). Traits that are not canonical are dropped, as in the walker.
 *
 * Cycle-safe AND bounded: a per-path visited guard drops a path that re-enters a question, and
 * a dropped re-entry marks the result `truncated` (the enumeration is not exhaustive). Both the
 * number of emitted paths (`maxPaths`) and the number of question visits (`stepBudget`) are
 * capped, because a cycle low in the tree makes the number of VISITS exponential while emitting
 * no path at all.
 *
 * @param def - the quiz definition (validated or a draft under edit).
 * @param visit - called once per complete path.
 * @param maxPaths - stop after this many paths.
 * @returns `{ truncated, steps }` — `truncated` is true when a cap or a cycle stopped the walk
 *   before it was exhaustive; `steps` is the number of question visits made (at most
 *   `quizWalkStepBudget(maxPaths)`).
 */
export function walkQuizPaths(
  def: QuizDefinition,
  visit: (path: RawQuizPath) => void,
  maxPaths: number = DEFAULT_MAX_QUIZ_PATHS,
): { truncated: boolean; steps: number } {
  const byId = new Map<string, QuizQuestion>(def.questions.map((q) => [q.id, q]));
  const budget = quizWalkStepBudget(maxPaths);
  const state = { truncated: false, stop: false, steps: 0, paths: 0 };
  const stopped = (): boolean => state.stop;
  const halt = (): void => {
    state.truncated = true;
    state.stop = true;
  };

  const emit = (steps: RawQuizPathStep[], weights: Record<string, number>, traits: TraitId[]) => {
    state.paths += 1;
    visit({ steps, weights, traits });
  };

  const walk = (
    qid: string,
    steps: RawQuizPathStep[],
    acc: Record<string, number>,
    traits: TraitId[],
    seen: ReadonlySet<string>,
  ): void => {
    if (stopped()) return;
    const q = byId.get(qid);
    if (!q) return;
    if (state.steps >= budget) {
      halt();
      return;
    }
    state.steps += 1;
    if (seen.has(qid)) {
      state.truncated = true; // a re-entry (cycle): the paths through it are not enumerated
      return;
    }
    if (state.paths >= maxPaths) {
      halt();
      return;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(qid);
    if (q.kind === 'multi') {
      emit([...steps, { question: q, answerIndex: [] }], acc, traits);
      return;
    }
    for (let ai = 0; ai < q.answers.length; ai += 1) {
      if (stopped()) return;
      const ans = q.answers[ai];
      if (!ans) continue;
      const merged: Record<string, number> = { ...acc };
      for (const [archetypeId, weight] of Object.entries(ans.weights)) {
        merged[archetypeId] = (merged[archetypeId] ?? 0) + weight;
      }
      const nextTraits = ans.traits ? [...traits, ...ans.traits.filter(isTraitId)] : traits;
      const nextSteps = [...steps, { question: q, answerIndex: ai }];
      if (ans.next === null || !byId.has(ans.next)) {
        if (state.paths >= maxPaths) {
          halt();
          return;
        }
        emit(nextSteps, merged, nextTraits);
      } else {
        walk(ans.next, nextSteps, merged, nextTraits, nextSeen);
      }
    }
  };
  walk(def.root, [], {}, [], new Set<string>());
  return { truncated: state.truncated, steps: state.steps };
}

/**
 * Upper bound on the question visits `walkQuizPaths` makes for a given `maxPaths`. A valid
 * tree needs at most (paths x depth) visits; the factor of 10 leaves room for the deepest
 * allowed tree (6 questions) many times over while still cutting a cyclic draft off in
 * milliseconds (the authoring lint walks the tree several times).
 */
export function quizWalkStepBudget(maxPaths: number): number {
  return maxPaths * 10;
}

/** A root→leaf path that adds weight to more than one archetype. */
export interface AmbiguousQuizPath {
  /** Question ids along the path, in walk order. */
  questionIds: string[];
  /** Selected answer ids along the path, in walk order. */
  answerIds: string[];
  /** The archetypes the path adds non-zero weight to (canonical order), at least two. */
  archetypes: CanonicalArchetypeId[];
}

/**
 * Compute the root→leaf paths that add weight to MORE THAN ONE archetype (the NON-BLOCKING
 * editor warning, MASTER_DESIGN §E.4.2 v3.0). The v3.0 tree gives every path exactly one
 * weighted answer, so the resolved leaf never depends on an argmax tiebreak or an override;
 * a path that spreads weight over several archetypes is a drafting smell (and the cause of
 * the v2.0 "luxury overrides the situation" defect). Bounded by the same path cap as
 * `computeUnreachableArchetypes`.
 *
 * @param def - the quiz definition (validated or a draft under edit).
 * @returns one entry per ambiguous path (may be empty).
 */
export function computeAmbiguousPaths(def: QuizDefinition): AmbiguousQuizPath[] {
  const out: AmbiguousQuizPath[] = [];
  walkQuizPaths(def, (path) => {
    const archetypes = CANONICAL_ARCHETYPE_IDS.filter((id) => (path.weights[id] ?? 0) !== 0);
    if (archetypes.length < 2) return;
    const questionIds: string[] = [];
    const answerIds: string[] = [];
    for (const step of path.steps) {
      if (Array.isArray(step.answerIndex)) continue; // a trait screen carries no weights
      questionIds.push(step.question.id);
      answerIds.push(step.question.answers[step.answerIndex]?.id ?? '');
    }
    out.push({ questionIds, answerIds, archetypes });
  });
  return out;
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
  /**
   * Quiz placement slice (FOLLOW-640). The tenant's `quiz_config.placement`, if configured.
   * Producer: `apps/control-plane/src/app/api/quiz/public-config/route.ts`.
   *
   * Consumer: `packages/sdk/src/ui/quiz-widget.ts` (`renderQuizWidget`) via `index.ts`.
   * Absent → SDK uses `DEFAULT_QUIZ_PLACEMENT` (byte-identical, ADR-0019 D4).
   *
   * FOLLOW-1015 moved this from the sticky trigger (deleted) to the auto-opening quiz card.
   * For the brief window where the card was a full-viewport modal the slice had NO consumer;
   * anchoring the card restored it rather than leaving a producer-only Rule L HALF_WIRE_P.
   */
  quiz_placement: WidgetPlacementSchema.optional(),
  /**
   * Opt-out toggle widget slice (FOLLOW-641). The tenant's `optout_widget_config`, if
   * configured. Absent → SDK renders the existing toggle with hardcoded defaults
   * (byte-identical, ADR-0019 D4). Producer:
   * `apps/control-plane/src/app/api/quiz/public-config/route.ts`. Consumer:
   * `packages/sdk/src/ui/profiling-toggle.ts` (`renderProfilingToggle`) via `index.ts`.
   */
  opt_out_widget: OptOutWidgetConfigSchema.optional(),
  /**
   * Quiz-definition slice (FOLLOW-639). The tenant's ACTIVE editable quiz tree. Absent →
   * SDK uses its built-in default tree (`DEFAULT_QUIZ_DEFINITION`), byte-identical to
   * pre-ADR-0019 (ADR-0019 D4/D5). The producer
   * (`apps/control-plane/src/app/api/quiz/public-config/route.ts`) emits this only when a
   * validated active `quiz_definitions` row exists; the consumer
   * (`packages/sdk/src/ui/quiz-widget.ts` walker via `index.ts` `mergeQuizConfig`) walks it.
   */
  quiz_definition: QuizDefinitionSchema.optional(),
  /**
   * The `quiz_definitions.version` of the served `quiz_definition`, or `null` when the served
   * tree is the built-in `DEFAULT_QUIZ_DEFINITION_V2` (ESC-086 item 3, FOLLOW-1358). Present
   * exactly when `quiz_definition` is. Echoed by the SDK in its `POST /api/quiz/run` pings.
   */
  definition_version: z.number().int().nullable().optional(),
  /**
   * `computeQuizDefinitionHash(quiz_definition)` — the identity the pre-registered accuracy
   * analysis counts runs on (ESC-086 item 3, FOLLOW-1358). Present exactly when
   * `quiz_definition` is.
   */
  definition_hash: z.string().max(128).optional(),
});

/** TypeScript type for the unified `GET /api/quiz/public-config` 200 response body. */
export type PresentationConfigResponse = z.infer<typeof PresentationConfigResponseSchema>;
