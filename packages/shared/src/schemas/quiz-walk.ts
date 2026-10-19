/**
 * Pure quiz-walk helpers — the single walker shared by the SDK widget, the admin simulator and
 * the editor lint (MASTER_DESIGN §E.4.9 v3.0, FOLLOW-1356).
 *
 * `resolveLabel`, `resolveArchetypeFromPath` and `longestPathFrom` moved here from
 * `packages/sdk/src/ui/quiz-widget.ts` (which re-exports the first two under the same names so
 * existing imports keep working). New: `enumerateQuizPaths`, `resolveLeafArchetype`,
 * `resolveQuizOutcome` and the `nextStep` state machine.
 *
 * A WALK PATH is the buyer's selections in order, one entry per answered question:
 *   - a `number` for a `single` question (the answer index);
 *   - a `number[]` for a `multi` question (the selected answer indexes, possibly empty).
 * The walk starts at `def.root`, adds each selected answer's `weights` to an accumulator and
 * follows the answer's `next` (a `multi` question always ends the walk). The leaf archetype is
 * the argmax of the accumulator (`reduceWeightsToArchetype`).
 *
 * Consumers: the SDK quiz widget (FOLLOW-1357 / Q2) walks with `nextStep`; the admin
 * simulator and paths table (FOLLOW-1362 / Q7) use `nextStep` and `enumerateQuizPaths`;
 * `quiz-lint.ts` uses `enumerateQuizPaths` and `longestPathFrom`.
 *
 * @module @estalara/shared/schemas/quiz-walk
 */

import { CANONICAL_TRAIT_IDS, type TraitId } from '../traits.js';
import type { QuizLanguage } from './quiz-config.js';
import {
  DEFAULT_MAX_QUIZ_PATHS,
  reduceWeightsToArchetype,
  walkQuizPaths,
  type CanonicalArchetypeId,
  type QuizDefinition,
  type QuizAnswer,
  type QuizQuestion,
} from './presentation-config.js';

/**
 * One selection on a walk path: the answer index for a `single` question, or the list of
 * selected answer indexes for a `multi` question.
 */
export type QuizPathStep = number | number[];

/** Resolve an i18n label for a language, falling back to `'en'` then the first present value. */
export function resolveLabel(
  bag: Partial<Record<QuizLanguage, string>>,
  lang: QuizLanguage,
): string {
  return bag[lang] ?? bag.en ?? Object.values(bag)[0] ?? '';
}

/** Index a definition's questions by id. */
function indexQuestions(def: QuizDefinition): Map<string, QuizQuestion> {
  return new Map(def.questions.map((q) => [q.id, q]));
}

/** Result of replaying a walk path against a definition. */
interface ReplayedWalk {
  weights: Record<string, number>;
  traits: ReadonlySet<TraitId>;
  /** Id of the question still awaiting an answer, or `null` when the walk has ended. */
  pendingQuestionId: string | null;
}

/**
 * Replay `path` from the root, accumulating weights and traits. Tolerates bad indexes (a
 * `single` step with an unknown index leaves its question pending; unknown indexes on a
 * `multi` step are ignored) and dangling references in a draft (the walk ends). Written
 * compactly on purpose: the SDK bundle contains it (gzip budget, ESC-080).
 */
function replayPath(def: QuizDefinition, path: readonly QuizPathStep[]): ReplayedWalk {
  const byId = indexQuestions(def);
  const weights: Record<string, number> = {};
  const traits = new Set<TraitId>();
  let currentId: string | null = def.root;
  for (const step of path) {
    const q: QuizQuestion | undefined = currentId === null ? undefined : byId.get(currentId);
    if (!q) break;
    const multi: boolean = q.kind === 'multi';
    const picked: QuizAnswer[] = (
      multi ? [step].flat() : [Array.isArray(step) ? step[0] : step]
    ).flatMap((i): QuizAnswer[] => {
      const ans = i === undefined ? undefined : q.answers[i];
      return ans ? [ans] : [];
    });
    if (!multi && picked.length === 0) break; // invalid selection: still pending on q
    for (const ans of picked) {
      for (const [id, weight] of Object.entries(ans.weights))
        weights[id] = (weights[id] ?? 0) + weight;
      for (const trait of ans.traits ?? []) traits.add(trait);
    }
    currentId = multi ? null : (picked[0]?.next ?? null); // a trait screen is always last
  }
  if (currentId !== null && !byId.has(currentId)) currentId = null; // dangling draft reference
  return { weights, traits, pendingQuestionId: currentId };
}

/** Canonical-order, de-duplicated trait list. */
function orderTraits(traits: Iterable<TraitId>): TraitId[] {
  const set = new Set(traits);
  return CANONICAL_TRAIT_IDS.filter((t) => set.has(t));
}

/**
 * Resolve the leaf archetype for a walk path, walking `def` from its root. Pure. An empty or
 * all-zero accumulation resolves to `neutral`.
 *
 * @param def - the quiz definition.
 * @param path - the buyer's selections in order (see the module doc).
 */
export function resolveLeafArchetype(
  def: QuizDefinition,
  path: readonly QuizPathStep[],
): CanonicalArchetypeId {
  return reduceWeightsToArchetype(replayPath(def, path).weights);
}

/**
 * Resolve the leaf archetype for a sequence of answer selections (by answer index per
 * question; a `multi` step is an array of indexes). Same function as `resolveLeafArchetype`,
 * kept under its original name because the SDK widget and its tests import it from
 * `ui/quiz-widget.ts`.
 */
export function resolveArchetypeFromPath(
  def: QuizDefinition,
  answerIndices: (number | number[])[],
): CanonicalArchetypeId {
  return resolveLeafArchetype(def, answerIndices);
}

/** The outcome of a (possibly partial) walk: the leaf archetype and the collected traits. */
export interface QuizOutcome {
  /** Argmax leaf of the accumulated weights (`neutral` when nothing weighed in). */
  leaf: CanonicalArchetypeId;
  /** Traits collected from `single` and `multi` answers, de-duplicated, canonical order. */
  traits: TraitId[];
}

/**
 * Resolve the leaf and the traits for a walk path. Traits come from every selected answer
 * (the trait screen's answers and any `single` answer carrying `traits`, e.g. `main_move`).
 *
 * @param def - the quiz definition.
 * @param path - the buyer's selections in order (see the module doc).
 */
export function resolveQuizOutcome(
  def: QuizDefinition,
  path: readonly QuizPathStep[],
): QuizOutcome {
  const replayed = replayPath(def, path);
  return {
    leaf: reduceWeightsToArchetype(replayed.weights),
    traits: orderTraits(replayed.traits),
  };
}

/** The state `nextStep` reads: what the buyer has done so far. */
export interface QuizWalkState {
  /** The selections made so far, in order (see the module doc). */
  path: readonly QuizPathStep[];
  /**
   * True once the buyer has finished the confirmation screen (confirmed, corrected or chose
   * "none of these"), so `nextStep` moves from `confirm` to `done`.
   */
  confirmationResolved?: boolean;
}

/** What the widget (or the simulator) should show next. */
export type QuizNextStep =
  | { kind: 'question'; questionId: string }
  | { kind: 'confirm'; leaf: CanonicalArchetypeId; traits: TraitId[] }
  | { kind: 'done'; leaf: CanonicalArchetypeId; traits: TraitId[] };

/**
 * The quiz state machine shared by the SDK walker and the admin simulator.
 *
 *   - `question` — the walk has not ended: show `questionId` (re-asked when the last
 *     selection was invalid);
 *   - `confirm`  — the walk ended, `def.confirm` exists, the leaf is not `neutral` and the
 *     confirmation has not been resolved yet;
 *   - `done`     — nothing more to ask (no `confirm` block, a `neutral` leaf, or the
 *     confirmation is resolved).
 *
 * @param def - the quiz definition.
 * @param state - the buyer's progress.
 */
export function nextStep(def: QuizDefinition, state: QuizWalkState): QuizNextStep {
  const replayed = replayPath(def, state.path);
  if (replayed.pendingQuestionId !== null) {
    return { kind: 'question', questionId: replayed.pendingQuestionId };
  }
  const leaf = reduceWeightsToArchetype(replayed.weights);
  const traits = orderTraits(replayed.traits);
  if (def.confirm && leaf !== 'neutral' && !state.confirmationResolved) {
    return { kind: 'confirm', leaf, traits };
  }
  return { kind: 'done', leaf, traits };
}

/**
 * Longest number of questions on any walk from `qid` (inclusive) — the progress-indicator
 * denominator. Cycle-safe.
 */
export function longestPathFrom(def: QuizDefinition, qid: string): number {
  const byId = indexQuestions(def);
  const memo = new Map<string, number>();
  const visit = (id: string, seen: ReadonlySet<string>): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const q = byId.get(id);
    if (!q || seen.has(id)) return 0;
    const nextSeen = new Set(seen).add(id);
    let best = 0;
    for (const ans of q.answers) {
      const remaining = ans.next === null ? 0 : visit(ans.next, nextSeen);
      if (remaining > best) best = remaining;
    }
    const total = 1 + best;
    memo.set(id, total);
    return total;
  };
  return visit(qid, new Set<string>());
}

/** One complete root→leaf path through a definition, as listed by `enumerateQuizPaths`. */
export interface QuizPath {
  /** The selections (feed to `resolveQuizOutcome`); a trait screen appears as `[]`. */
  selections: QuizPathStep[];
  /** Question ids in walk order. */
  questionIds: string[];
  /** Selected answer ids in walk order; `[]` for a trait screen. */
  answerIds: (string | string[])[];
  /** Accumulated archetype weights. */
  weights: Record<string, number>;
  /** Argmax leaf of `weights`. */
  leaf: CanonicalArchetypeId;
  /** Traits recorded by the path's single answers, canonical order. */
  traits: TraitId[];
}

/**
 * Enumerate every root→leaf path (the simulator's "all paths" table and the editor lint).
 * A `multi` trait screen is listed once with an empty selection, not expanded into subsets.
 * Cycle-safe and bounded.
 *
 * @param def - the quiz definition (validated or a draft under edit).
 * @param options.maxPaths - cap on the number of paths (default 20 000).
 * @returns the paths in declaration order and whether the cap cut the enumeration short.
 */
export function enumerateQuizPaths(
  def: QuizDefinition,
  options: { maxPaths?: number } = {},
): { paths: QuizPath[]; truncated: boolean } {
  const paths: QuizPath[] = [];
  const { truncated } = walkQuizPaths(
    def,
    (raw) => {
      paths.push({
        selections: raw.steps.map((s) => s.answerIndex),
        questionIds: raw.steps.map((s) => s.question.id),
        answerIds: raw.steps.map((s) =>
          Array.isArray(s.answerIndex) ? [] : (s.question.answers[s.answerIndex]?.id ?? ''),
        ),
        weights: raw.weights,
        leaf: reduceWeightsToArchetype(raw.weights),
        traits: orderTraits(raw.traits),
      });
    },
    options.maxPaths ?? DEFAULT_MAX_QUIZ_PATHS,
  );
  return { paths, truncated };
}
