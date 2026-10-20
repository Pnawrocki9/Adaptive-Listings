/**
 * definition-ops — pure, immutable edit operations over a quiz draft (FOLLOW-1362 C2).
 *
 * The structured editor never mutates a definition: every operation returns a NEW one built with
 * object spread, so any field the editor does not know about (a future `kind`, extra keys on an
 * answer or on `confirm`) round-trips untouched. Operations that cannot be applied safely either
 * refuse (return the input unchanged, flagged in their result) or throw — the UI only offers
 * legal choices (e.g. the `next` dropdown excludes self and ancestors), so a throw means a bug,
 * never a normal user path.
 *
 * Consumers: `question-form.tsx`, `question-card.tsx`, `answer-row.tsx`, `confirmation-tab.tsx`
 * and `quiz-definition-editor.tsx`.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/definition-ops
 */

import type {
  QuizAnswer,
  QuizConfirm,
  QuizDefinition,
  QuizLanguage,
  QuizQuestion,
} from '@estalara/shared';
import { enumerateQuizPaths } from '@estalara/shared';

/** Where a prompt/label text lives: a question prompt (no `aid`) or one of its answer labels. */
export interface TextTarget {
  qid: string;
  aid?: string;
}

/** `{question, answer}` pair — an answer whose `next` an operation changed. */
export interface AnswerRef {
  question_id: string;
  answer_id: string;
}

function mapQuestion(
  def: QuizDefinition,
  qid: string,
  fn: (q: QuizQuestion) => QuizQuestion,
): QuizDefinition {
  return { ...def, questions: def.questions.map((q) => (q.id === qid ? fn(q) : q)) };
}

function mapAnswer(
  def: QuizDefinition,
  qid: string,
  aid: string,
  fn: (a: QuizAnswer) => QuizAnswer,
): QuizDefinition {
  return mapQuestion(def, qid, (q) => ({
    ...q,
    answers: q.answers.map((a) => (a.id === aid ? fn(a) : a)),
  }));
}

function requireQuestion(def: QuizDefinition, qid: string): QuizQuestion {
  const q = def.questions.find((x) => x.id === qid);
  if (!q) throw new Error(`unknown question "${qid}"`);
  return q;
}

/**
 * Ids of every question from which `qid` can be reached (its ancestors), NOT including `qid`.
 * Pointing an answer of `qid` at an ancestor — or at `qid` itself — would create a cycle.
 */
export function ancestorsOf(def: QuizDefinition, qid: string): Set<string> {
  const parents = new Map<string, string[]>();
  for (const q of def.questions) {
    for (const a of q.answers) {
      if (a.next !== null) parents.set(a.next, [...(parents.get(a.next) ?? []), q.id]);
    }
  }
  const seen = new Set<string>();
  const stack = [...(parents.get(qid) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    stack.push(...(parents.get(id) ?? []));
  }
  seen.delete(qid);
  return seen;
}

/** Question ids an answer of `qid` may legally point its `next` at (not self, not an ancestor). */
export function nextCandidates(def: QuizDefinition, qid: string): string[] {
  const banned = ancestorsOf(def, qid);
  return def.questions.filter((q) => q.id !== qid && !banned.has(q.id)).map((q) => q.id);
}

function uniqueId(taken: Set<string>, prefix: string): string {
  let n = taken.size + 1;
  while (taken.has(`${prefix}${String(n)}`)) n += 1;
  return `${prefix}${String(n)}`;
}

/** A fresh, empty answer with an id unique within `existing`. */
function blankAnswer(existing: readonly QuizAnswer[]): QuizAnswer {
  const id = uniqueId(new Set(existing.map((a) => a.id)), 'a_');
  return { id, label_i18n: { en: '', pl: '' }, weights: {}, next: null };
}

/**
 * Append a new question (2 empty answers, ends the walk). It is an orphan until an answer points
 * at it — the lint reports `orphan_question` and blocks Save until it is linked or removed.
 */
export function addQuestion(def: QuizDefinition, id?: string): QuizDefinition {
  const qid = id ?? uniqueId(new Set(def.questions.map((q) => q.id)), 'q_');
  if (def.questions.some((q) => q.id === qid)) throw new Error(`question "${qid}" already exists`);
  const first = blankAnswer([]);
  const second = blankAnswer([first]);
  const question: QuizQuestion = {
    id: qid,
    prompt_i18n: { en: '', pl: '' },
    answers: [first, second],
  };
  return { ...def, questions: [...def.questions, question] };
}

/** Result of {@link removeQuestion}. */
export interface RemoveQuestionResult {
  definition: QuizDefinition;
  /** Answers whose `next` pointed at the removed question and was set to `null` (flag them). */
  flagged: AnswerRef[];
  /** True when nothing was removed because the question is the root. */
  refused: boolean;
}

/** Remove a question; inbound `next` references become `null` and are reported. Root is kept. */
export function removeQuestion(def: QuizDefinition, qid: string): RemoveQuestionResult {
  if (qid === def.root || !def.questions.some((q) => q.id === qid)) {
    return { definition: def, flagged: [], refused: qid === def.root };
  }
  const flagged: AnswerRef[] = [];
  const questions = def.questions
    .filter((q) => q.id !== qid)
    .map((q) => ({
      ...q,
      answers: q.answers.map((a) => {
        if (a.next !== qid) return a;
        flagged.push({ question_id: q.id, answer_id: a.id });
        return { ...a, next: null };
      }),
    }));
  return { definition: { ...def, questions }, flagged, refused: false };
}

/** Append a blank answer to a question. */
export function addAnswer(def: QuizDefinition, qid: string): QuizDefinition {
  return mapQuestion(def, qid, (q) => ({ ...q, answers: [...q.answers, blankAnswer(q.answers)] }));
}

/** Remove an answer (answers are not referenced by id elsewhere, so nothing else changes). */
export function removeAnswer(def: QuizDefinition, qid: string, aid: string): QuizDefinition {
  return mapQuestion(def, qid, (q) => ({ ...q, answers: q.answers.filter((a) => a.id !== aid) }));
}

/** Result of {@link moveAnswer}. */
export interface MoveAnswerResult {
  definition: QuizDefinition;
  /** Set when the move changed an index: stored quiz runs record answers by INDEX. */
  warning: string | null;
}

/** Move an answer to position `to` (clamped). Warns: answer indexes are how history is stored. */
export function moveAnswer(
  def: QuizDefinition,
  qid: string,
  aid: string,
  to: number,
): MoveAnswerResult {
  const q = requireQuestion(def, qid);
  const from = q.answers.findIndex((a) => a.id === aid);
  const target = Math.max(0, Math.min(q.answers.length - 1, to));
  if (from < 0 || from === target) return { definition: def, warning: null };
  const answers = [...q.answers];
  const [moved] = answers.splice(from, 1);
  if (!moved) return { definition: def, warning: null };
  answers.splice(target, 0, moved);
  return {
    definition: mapQuestion(def, qid, (x) => ({ ...x, answers })),
    warning:
      `Moving "${aid}" changes the answer indexes of "${qid}". Stored quiz runs record answers ` +
      'by index, so earlier completions of this question will read as different answers.',
  };
}

/** Point an answer at another question or end the walk (`null`). Refuses self and ancestors. */
export function setNext(
  def: QuizDefinition,
  qid: string,
  aid: string,
  next: string | null,
): QuizDefinition {
  if (next !== null) {
    requireQuestion(def, next);
    if (!nextCandidates(def, qid).includes(next)) {
      throw new Error(`"${next}" is "${qid}" itself or one of its ancestors — that is a cycle`);
    }
  }
  return mapAnswer(def, qid, aid, (a) => ({ ...a, next }));
}

/** Rename a question id; `root` and every `next` that referenced the old id follow. */
export function renameQuestionId(
  def: QuizDefinition,
  oldId: string,
  newId: string,
): QuizDefinition {
  const id = newId.trim();
  requireQuestion(def, oldId);
  if (id === '') throw new Error('a question id cannot be empty');
  if (id === oldId) return def;
  if (def.questions.some((q) => q.id === id)) throw new Error(`question "${id}" already exists`);
  return {
    ...def,
    root: def.root === oldId ? id : def.root,
    questions: def.questions.map((q) => ({
      ...q,
      id: q.id === oldId ? id : q.id,
      answers: q.answers.map((a) => (a.next === oldId ? { ...a, next: id } : a)),
    })),
  };
}

/** A terminal answer resolves to `archetypeId`: weights become `{X: 1}`; `null` clears them. */
export function setLeafArchetype(
  def: QuizDefinition,
  qid: string,
  aid: string,
  archetypeId: string | null,
): QuizDefinition {
  return mapAnswer(def, qid, aid, (a) => ({
    ...a,
    weights: archetypeId === null ? {} : { [archetypeId]: 1 },
  }));
}

/** Replace one archetype's weight on an answer (`null` removes it) — the "Advanced" editor. */
export function setWeight(
  def: QuizDefinition,
  qid: string,
  aid: string,
  archetypeId: string,
  weight: number | null,
): QuizDefinition {
  return mapAnswer(def, qid, aid, (a) => {
    const others = Object.entries(a.weights).filter(([id]) => id !== archetypeId);
    const weights = Object.fromEntries(
      weight === null ? others : [...others, [archetypeId, weight]],
    );
    return { ...a, weights };
  });
}

/** Set the traits an answer records; an empty list removes the key. */
export function setTraits(
  def: QuizDefinition,
  qid: string,
  aid: string,
  traits: readonly string[],
): QuizDefinition {
  return mapAnswer(def, qid, aid, (a) => {
    const rest = { ...a };
    delete rest.traits;
    return traits.length === 0 ? rest : { ...rest, traits: [...traits] };
  });
}

/**
 * Switch a question between `single` and `multi` (a trait screen). `multi` clears every answer's
 * weights and `next` (the authoring rule); `single` drops the `kind` key (the default).
 */
export function setQuestionKind(
  def: QuizDefinition,
  qid: string,
  kind: 'single' | 'multi',
): QuizDefinition {
  return mapQuestion(def, qid, (q) => {
    const rest = { ...q };
    delete rest.kind;
    if (kind === 'single') return rest;
    return {
      ...rest,
      kind: 'multi',
      answers: q.answers.map((a) => ({ ...a, weights: {}, next: null })),
    };
  });
}

/** Set one language's text of a question prompt (no `aid`) or an answer label. */
export function setLocaleText(
  def: QuizDefinition,
  target: TextTarget,
  lang: QuizLanguage,
  value: string,
): QuizDefinition {
  if (target.aid === undefined) {
    return mapQuestion(def, target.qid, (q) => ({
      ...q,
      prompt_i18n: { ...q.prompt_i18n, [lang]: value },
    }));
  }
  return mapAnswer(def, target.qid, target.aid, (a) => ({
    ...a,
    label_i18n: { ...a.label_i18n, [lang]: value },
  }));
}

const EMPTY_CONFIRM: QuizConfirm = { names_i18n: {}, sentences_i18n: {}, alternatives: {} };

/** Set one language of an archetype's confirmation name or sentence (creates `confirm`). */
export function setConfirmText(
  def: QuizDefinition,
  field: 'names_i18n' | 'sentences_i18n',
  archetypeId: string,
  lang: QuizLanguage,
  value: string,
): QuizDefinition {
  const confirm = def.confirm ?? EMPTY_CONFIRM;
  return {
    ...def,
    confirm: {
      ...confirm,
      [field]: {
        ...confirm[field],
        [archetypeId]: { ...confirm[field][archetypeId], [lang]: value },
      },
    },
  };
}

/** Set the "Not quite" alternatives offered for an archetype; an empty list removes the key. */
export function setAlternatives(
  def: QuizDefinition,
  archetypeId: string,
  alternatives: readonly string[],
): QuizDefinition {
  const confirm = def.confirm ?? EMPTY_CONFIRM;
  const others = Object.entries(confirm.alternatives).filter(([id]) => id !== archetypeId);
  const next = Object.fromEntries(
    alternatives.length === 0 ? others : [...others, [archetypeId, [...alternatives]]],
  );
  return { ...def, confirm: { ...confirm, alternatives: next } };
}

/** Add or remove a language from `languages` (the last remaining one is never removed). */
export function toggleLanguage(def: QuizDefinition, lang: QuizLanguage): QuizDefinition {
  if (!def.languages.includes(lang)) return { ...def, languages: [...def.languages, lang] };
  if (def.languages.length === 1) return def;
  return { ...def, languages: def.languages.filter((l) => l !== lang) };
}

/** Non-blank text count vs. total for one language across a question's prompt and labels. */
export function questionCompleteness(
  q: QuizQuestion,
  lang: QuizLanguage,
): { filled: number; total: number } {
  const bags = [q.prompt_i18n, ...q.answers.map((a) => a.label_i18n)];
  return { filled: bags.filter((b) => (b[lang] ?? '').trim() !== '').length, total: bags.length };
}

/**
 * Non-neutral archetypes some root-to-leaf path resolves to — the ones that need a confirmation
 * name, sentence and alternatives. Only call on a draft that passed the serve schema (acyclic).
 */
export function reachableResults(def: QuizDefinition): string[] {
  const leaves = new Set(enumerateQuizPaths(def).paths.map((p) => p.leaf));
  leaves.delete('neutral');
  return [...leaves].sort();
}

/** Human description of a lint/Zod issue path: `q_gate › a_yield › label_i18n.pl`. */
export function describePath(def: QuizDefinition, path: readonly (string | number)[]): string {
  const [head, qi, tail, ai, ...rest] = path;
  if (head !== 'questions' || typeof qi !== 'number') return path.join('.');
  const q = def.questions[qi];
  if (!q) return path.join('.');
  if (tail !== 'answers' || typeof ai !== 'number') {
    return [q.id, ...(tail === undefined ? [] : [String(tail)])].join(' › ');
  }
  const a = q.answers[ai];
  return [q.id, a?.id ?? `answers[${String(ai)}]`, ...(rest.length ? [rest.join('.')] : [])].join(
    ' › ',
  );
}
