/**
 * Quiz definition diff — a typed, ordered change list between two definitions
 * (MASTER_DESIGN §E.4.9 v3.0, FOLLOW-1356).
 *
 * Consumers: the admin versions panel and the publish dialog (diff summary) in the quiz
 * editor (FOLLOW-1362 / Q7). Questions and answers are matched by id; a text change is
 * reported per language so the editor can show "EN changed, PL unchanged".
 *
 * @module @estalara/shared/schemas/quiz-diff
 */

import type { LabelI18n, QuizAnswer, QuizDefinition, QuizQuestion } from './presentation-config.js';

/** One difference between two quiz definitions. Texts are `null` when absent on that side. */
export type QuizChange =
  | { type: 'root_changed'; before: string; after: string }
  | { type: 'languages_changed'; before: string[]; after: string[] }
  | { type: 'question_added'; questionId: string; index: number }
  | { type: 'question_removed'; questionId: string; index: number }
  | { type: 'question_reordered'; questionId: string; from: number; to: number }
  | {
      type: 'question_kind_changed';
      questionId: string;
      before: string;
      after: string;
    }
  | {
      type: 'prompt_changed';
      questionId: string;
      language: string;
      before: string | null;
      after: string | null;
    }
  | { type: 'answer_added'; questionId: string; answerId: string; index: number }
  | { type: 'answer_removed'; questionId: string; answerId: string; index: number }
  | {
      type: 'answer_reordered';
      questionId: string;
      answerId: string;
      from: number;
      to: number;
    }
  | {
      type: 'label_changed';
      questionId: string;
      answerId: string;
      language: string;
      before: string | null;
      after: string | null;
    }
  | {
      type: 'next_changed';
      questionId: string;
      answerId: string;
      before: string | null;
      after: string | null;
    }
  | {
      type: 'weights_changed';
      questionId: string;
      answerId: string;
      before: Record<string, number>;
      after: Record<string, number>;
    }
  | {
      type: 'traits_changed';
      questionId: string;
      answerId: string;
      before: string[];
      after: string[];
    }
  | {
      type: 'confirm_text_changed';
      field: 'name' | 'sentence';
      archetypeId: string;
      language: string;
      before: string | null;
      after: string | null;
    }
  | {
      type: 'confirm_alternatives_changed';
      archetypeId: string;
      before: string[];
      after: string[];
    };

/**
 * Indexes (into `ids`) that are NOT part of a longest increasing subsequence of `targets` —
 * the minimal set of items that moved when `ids` is rearranged into the order of `targets`.
 */
function movedIndexes(targets: readonly number[]): Set<number> {
  const n = targets.length;
  const tails: number[] = []; // tails[k] = index of the smallest tail of an LIS of length k + 1
  const prev: number[] = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i += 1) {
    const value = targets[i] ?? 0;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((targets[tails[mid] ?? 0] ?? 0) < value) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? (tails[lo - 1] ?? -1) : -1;
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let k = tails[tails.length - 1] ?? -1; k >= 0; k = prev[k] ?? -1) keep.add(k);
  const moved = new Set<number>();
  for (let i = 0; i < n; i += 1) if (!keep.has(i)) moved.add(i);
  return moved;
}

/** Items present in both lists whose relative order changed: `[id, indexInA, indexInB]`. */
function reorderedIds(a: readonly string[], b: readonly string[]): [string, number, number][] {
  const inB = new Set(b);
  const inA = new Set(a);
  const commonA = a.filter((id) => inB.has(id));
  const commonB = b.filter((id) => inA.has(id));
  const targets = commonA.map((id) => commonB.indexOf(id));
  const out: [string, number, number][] = [];
  for (const i of [...movedIndexes(targets)].sort((x, y) => x - y)) {
    const id = commonA[i];
    if (id !== undefined) out.push([id, a.indexOf(id), b.indexOf(id)]);
  }
  return out;
}

function textChanges(
  before: LabelI18n | undefined,
  after: LabelI18n | undefined,
): { language: string; before: string | null; after: string | null }[] {
  const b: Record<string, string | undefined> = before ?? {};
  const a: Record<string, string | undefined> = after ?? {};
  const languages = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  const out: { language: string; before: string | null; after: string | null }[] = [];
  for (const language of languages) {
    const x = b[language] ?? null;
    const y = a[language] ?? null;
    if (x !== y) out.push({ language, before: x, after: y });
  }
  return out;
}

function sameWeights(x: Record<string, number>, y: Record<string, number>): boolean {
  const kx = Object.keys(x);
  return kx.length === Object.keys(y).length && kx.every((k) => y[k] === x[k]);
}

function sameList(x: readonly string[], y: readonly string[]): boolean {
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function diffAnswers(qa: QuizQuestion, qb: QuizQuestion, out: QuizChange[]): void {
  const questionId = qb.id;
  const idsA = qa.answers.map((a) => a.id);
  const idsB = qb.answers.map((a) => a.id);
  const answerA = new Map<string, QuizAnswer>(qa.answers.map((a) => [a.id, a]));
  const answerB = new Map<string, QuizAnswer>(qb.answers.map((a) => [a.id, a]));

  idsA.forEach((answerId, index) => {
    if (!answerB.has(answerId)) out.push({ type: 'answer_removed', questionId, answerId, index });
  });
  idsB.forEach((answerId, index) => {
    if (!answerA.has(answerId)) out.push({ type: 'answer_added', questionId, answerId, index });
  });
  for (const [answerId, from, to] of reorderedIds(idsA, idsB)) {
    out.push({ type: 'answer_reordered', questionId, answerId, from, to });
  }
  for (const a of qb.answers) {
    const old = answerA.get(a.id);
    if (!old) continue;
    for (const t of textChanges(old.label_i18n, a.label_i18n)) {
      out.push({ type: 'label_changed', questionId, answerId: a.id, ...t });
    }
    if (old.next !== a.next) {
      out.push({
        type: 'next_changed',
        questionId,
        answerId: a.id,
        before: old.next,
        after: a.next,
      });
    }
    if (!sameWeights(old.weights, a.weights)) {
      out.push({
        type: 'weights_changed',
        questionId,
        answerId: a.id,
        before: old.weights,
        after: a.weights,
      });
    }
    const tb = [...(old.traits ?? [])].sort();
    const ta = [...(a.traits ?? [])].sort();
    if (!sameList(tb, ta)) {
      out.push({
        type: 'traits_changed',
        questionId,
        answerId: a.id,
        before: old.traits ?? [],
        after: a.traits ?? [],
      });
    }
  }
}

function diffConfirm(a: QuizDefinition, b: QuizDefinition, out: QuizChange[]): void {
  const fields = [
    ['name', 'names_i18n'],
    ['sentence', 'sentences_i18n'],
  ] as const;
  for (const [field, key] of fields) {
    const bagA = a.confirm?.[key] ?? {};
    const bagB = b.confirm?.[key] ?? {};
    for (const archetypeId of [...new Set([...Object.keys(bagA), ...Object.keys(bagB)])].sort()) {
      for (const t of textChanges(bagA[archetypeId], bagB[archetypeId])) {
        out.push({ type: 'confirm_text_changed', field, archetypeId, ...t });
      }
    }
  }
  const altA = a.confirm?.alternatives ?? {};
  const altB = b.confirm?.alternatives ?? {};
  for (const archetypeId of [...new Set([...Object.keys(altA), ...Object.keys(altB)])].sort()) {
    const before = altA[archetypeId] ?? [];
    const after = altB[archetypeId] ?? [];
    if (!sameList(before, after)) {
      out.push({ type: 'confirm_alternatives_changed', archetypeId, before, after });
    }
  }
}

/**
 * Diff two quiz definitions into an ordered, typed change list: root, `languages` (as a set), then question
 * add / remove / reorder, then per question (in `b` order) kind, prompt texts and answer
 * changes, then the confirmation block. Identical definitions give `[]`. A moved item is
 * reported once (minimal-move reorder), not once per item it shifted.
 *
 * @param a - the "before" definition.
 * @param b - the "after" definition.
 */
export function diffQuizDefinitions(a: QuizDefinition, b: QuizDefinition): QuizChange[] {
  const out: QuizChange[] = [];
  if (a.root !== b.root) out.push({ type: 'root_changed', before: a.root, after: b.root });
  if (!sameList([...a.languages].sort(), [...b.languages].sort())) {
    out.push({ type: 'languages_changed', before: a.languages, after: b.languages });
  }

  const idsA = a.questions.map((q) => q.id);
  const idsB = b.questions.map((q) => q.id);
  const questionA = new Map<string, QuizQuestion>(a.questions.map((q) => [q.id, q]));
  const questionB = new Map<string, QuizQuestion>(b.questions.map((q) => [q.id, q]));

  idsA.forEach((questionId, index) => {
    if (!questionB.has(questionId)) out.push({ type: 'question_removed', questionId, index });
  });
  idsB.forEach((questionId, index) => {
    if (!questionA.has(questionId)) out.push({ type: 'question_added', questionId, index });
  });
  for (const [questionId, from, to] of reorderedIds(idsA, idsB)) {
    out.push({ type: 'question_reordered', questionId, from, to });
  }

  for (const qb of b.questions) {
    const qa = questionA.get(qb.id);
    if (!qa) continue;
    const kindA = qa.kind ?? 'single';
    const kindB = qb.kind ?? 'single';
    if (kindA !== kindB) {
      out.push({ type: 'question_kind_changed', questionId: qb.id, before: kindA, after: kindB });
    }
    for (const t of textChanges(qa.prompt_i18n, qb.prompt_i18n)) {
      out.push({ type: 'prompt_changed', questionId: qb.id, ...t });
    }
    diffAnswers(qa, qb, out);
  }

  diffConfirm(a, b, out);
  return out;
}
