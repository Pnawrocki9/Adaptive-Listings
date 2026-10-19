/**
 * Tests for the shared quiz walker (FOLLOW-1356): path enumeration parity, the `nextStep`
 * state machine, outcomes with traits, and draft-safety.
 */

import { describe, expect, it } from 'vitest';

import { CANONICAL_ARCHETYPE_IDS } from '../archetypes.js';
import { DEFAULT_QUIZ_DEFINITION_V2 } from '../quiz-default-v2.js';
import { EXAMPLE_QUIZ_DEFINITION } from '../examples/presentation-config.js';
import {
  QUIZ_TRAIT_ONLY_ARCHETYPE_IDS,
  computeUnreachableArchetypes,
  type QuizDefinition,
} from './presentation-config.js';
import {
  enumerateQuizPaths,
  longestPathFrom,
  nextStep,
  resolveArchetypeFromPath,
  resolveLabel,
  resolveLeafArchetype,
  resolveQuizOutcome,
  type QuizPathStep,
} from './quiz-walk.js';

const v2 = (): QuizDefinition => structuredClone(DEFAULT_QUIZ_DEFINITION_V2);

// q_purpose answer indexes in the v2 tree
const MAIN_HERE = 0;
const MAIN_MOVE = 1;
const SECOND = 2;
const INVEST = 3;
const STUDENT = 4;
const UNSURE = 5;

describe('resolveLabel', () => {
  it('prefers the language, then en, then the first value, then empty', () => {
    expect(resolveLabel({ en: 'Hi', pl: 'Cześć' }, 'pl')).toBe('Cześć');
    expect(resolveLabel({ en: 'Hi' }, 'pl')).toBe('Hi');
    expect(resolveLabel({ es: 'Hola' }, 'pl')).toBe('Hola');
    expect(resolveLabel({}, 'pl')).toBe('');
  });
});

describe('enumerateQuizPaths — v2 tree', () => {
  const { paths, truncated } = enumerateQuizPaths(DEFAULT_QUIZ_DEFINITION_V2);

  it('lists 14 paths (a trait screen counts once) and is not truncated', () => {
    expect(paths).toHaveLength(14);
    expect(truncated).toBe(false);
  });

  it('reaches exactly the 12 results plus neutral', () => {
    const leaves = new Set(paths.map((p) => p.leaf));
    expect(leaves.size).toBe(13);
    expect(leaves.has('neutral')).toBe(true);
    for (const trait_only of QUIZ_TRAIT_ONLY_ARCHETYPE_IDS) {
      expect(leaves.has(trait_only)).toBe(false);
    }
  });

  it('agrees with resolveArchetypeFromPath on every path', () => {
    for (const p of paths) {
      expect(resolveArchetypeFromPath(DEFAULT_QUIZ_DEFINITION_V2, p.selections)).toBe(p.leaf);
      expect(resolveLeafArchetype(DEFAULT_QUIZ_DEFINITION_V2, p.selections)).toBe(p.leaf);
    }
  });

  it('agrees with computeUnreachableArchetypes', () => {
    const reached = new Set<string>(paths.map((p) => p.leaf));
    const raw = CANONICAL_ARCHETYPE_IDS.filter((id) => id !== 'neutral' && !reached.has(id));
    expect(computeUnreachableArchetypes(DEFAULT_QUIZ_DEFINITION_V2, [])).toEqual(raw);
    expect(new Set(raw)).toEqual(new Set(QUIZ_TRAIT_ONLY_ARCHETYPE_IDS));
    expect(computeUnreachableArchetypes(DEFAULT_QUIZ_DEFINITION_V2)).toEqual([]);
  });

  it('records each path as question ids and answer ids, a trait screen as an empty selection', () => {
    const first = paths[0];
    expect(first?.questionIds).toEqual(['q_purpose', 'q_home', 't_home']);
    expect(first?.answerIds).toEqual(['main_here', 'first', []]);
    expect(first?.selections).toEqual([MAIN_HERE, 0, []]);
    expect(first?.leaf).toBe('first_time_buyer');
  });

  it('carries the traits of single answers (main_move records buying_from_abroad)', () => {
    const move = paths.filter((p) => p.answerIds[0] === 'main_move');
    expect(move).toHaveLength(3);
    for (const p of move) expect(p.traits).toEqual(['buying_from_abroad']);
  });
});

describe('enumerateQuizPaths — example tree parity', () => {
  it('matches resolveArchetypeFromPath and computeUnreachableArchetypes', () => {
    const { paths } = enumerateQuizPaths(EXAMPLE_QUIZ_DEFINITION);
    expect(paths.map((p) => p.leaf)).toEqual(['yield_hunter', 'flip_investor', 'neutral']);
    for (const p of paths) {
      expect(resolveArchetypeFromPath(EXAMPLE_QUIZ_DEFINITION, p.selections)).toBe(p.leaf);
    }
  });
});

describe('enumerateQuizPaths — bounds and drafts', () => {
  it('honours maxPaths and reports truncation', () => {
    const out = enumerateQuizPaths(DEFAULT_QUIZ_DEFINITION_V2, { maxPaths: 3 });
    expect(out.paths).toHaveLength(3);
    expect(out.truncated).toBe(true);
    const exact = enumerateQuizPaths(DEFAULT_QUIZ_DEFINITION_V2, { maxPaths: 14 });
    expect(exact.paths).toHaveLength(14);
    expect(exact.truncated).toBe(false);
  });

  it('terminates on a cyclic draft and treats a dangling next as a leaf', () => {
    const def = v2();
    const q_home = def.questions.find((q) => q.id === 'q_home');
    const answer = q_home?.answers[0];
    if (!answer) throw new Error('fixture');
    answer.next = 'q_purpose'; // cycle back to the root
    const dangling = def.questions.find((q) => q.id === 'q_move')?.answers[0];
    if (!dangling) throw new Error('fixture');
    dangling.next = 'nope';
    const out = enumerateQuizPaths(def);
    expect(out.truncated).toBe(true); // the re-entry is flagged: the enumeration is not exhaustive
    expect(out.paths.length).toBeGreaterThan(0);
    expect(longestPathFrom(def, def.root)).toBeGreaterThan(0);
  });
});

describe('longestPathFrom', () => {
  it('is 3 for the v2 tree (purpose, clarifier, trait screen)', () => {
    expect(longestPathFrom(DEFAULT_QUIZ_DEFINITION_V2, 'q_purpose')).toBe(3);
    expect(longestPathFrom(DEFAULT_QUIZ_DEFINITION_V2, 't_home')).toBe(1);
    expect(longestPathFrom(DEFAULT_QUIZ_DEFINITION_V2, 'missing')).toBe(0);
  });
});

describe('resolveQuizOutcome', () => {
  it('collects traits from single and multi answers, de-duplicated, in canonical order', () => {
    // main_move (buying_from_abroad) -> retire -> t_move: has_children(0), residency_goal(3)
    const out = resolveQuizOutcome(DEFAULT_QUIZ_DEFINITION_V2, [MAIN_MOVE, 1, [0, 3]]);
    expect(out.leaf).toBe('retiree_relocator');
    expect(out.traits).toEqual(['residency_goal', 'buying_from_abroad', 'has_children']);
  });

  it('de-duplicates a trait selected on a single answer and again on the trait screen', () => {
    // second -> t_second: buying_from_abroad(1) twice, will_let(0)
    const out = resolveQuizOutcome(DEFAULT_QUIZ_DEFINITION_V2, [SECOND, [1, 1, 0]]);
    expect(out.leaf).toBe('second_home_buyer');
    expect(out.traits).toEqual(['buying_from_abroad', 'will_let']);
  });

  it('counts a repeated multi index once and ignores weights on trait-screen answers', () => {
    const def = v2();
    const screen = def.questions.find((q) => q.id === 't_home');
    const tick = screen?.answers[0];
    if (!tick) throw new Error('fixture');
    tick.weights = { yield_hunter: 5 }; // authoring forbids this; the walker must not use it
    const once = resolveQuizOutcome(def, [MAIN_HERE, 0, [0]]);
    const twice = resolveQuizOutcome(def, [MAIN_HERE, 0, [0, 0, 0]]);
    expect(twice).toEqual(once);
    expect(once.leaf).toBe('first_time_buyer'); // yield_hunter 5 is NOT added
    // walkQuizPaths / enumerateQuizPaths agree: they also ignore a multi answer's weights
    const paths = enumerateQuizPaths(def).paths;
    const first = paths.find((p) => p.answerIds[0] === 'main_here' && p.answerIds[1] === 'first');
    expect(first?.weights).toEqual({ first_time_buyer: 1 });
    expect(first?.leaf).toBe('first_time_buyer');
  });

  it('never lets traits change the leaf', () => {
    const none = resolveQuizOutcome(DEFAULT_QUIZ_DEFINITION_V2, [INVEST, 2, []]);
    const all = resolveQuizOutcome(DEFAULT_QUIZ_DEFINITION_V2, [INVEST, 2, [0, 1, 2, 3]]);
    expect(none.leaf).toBe('flip_investor');
    expect(all.leaf).toBe('flip_investor');
    expect(all.traits).toEqual([
      'premium',
      'residency_goal',
      'buying_from_abroad',
      'seasoned_investor',
    ]);
    expect(none.traits).toEqual([]);
  });

  it('ignores out-of-range indexes and works on a partial path', () => {
    expect(resolveQuizOutcome(DEFAULT_QUIZ_DEFINITION_V2, [])).toEqual({
      leaf: 'neutral',
      traits: [],
    });
    expect(resolveQuizOutcome(DEFAULT_QUIZ_DEFINITION_V2, [STUDENT, [9, -1]])).toEqual({
      leaf: 'student_parent',
      traits: [],
    });
  });
});

describe('nextStep — v2 tree', () => {
  /** Drive the state machine along `selections`, returning the final step and visited kinds. */
  function drive(def: QuizDefinition, selections: QuizPathStep[], resolveConfirm = false) {
    const path: QuizPathStep[] = [];
    const kinds: string[] = [];
    for (let guard = 0; guard < 20; guard += 1) {
      const step = nextStep(def, { path, confirmationResolved: resolveConfirm });
      kinds.push(step.kind);
      if (step.kind !== 'question') return { step, kinds, path };
      const sel = selections[path.length];
      if (sel === undefined) return { step, kinds, path };
      path.push(sel);
    }
    throw new Error('state machine did not terminate');
  }

  it('starts at the root question', () => {
    expect(nextStep(DEFAULT_QUIZ_DEFINITION_V2, { path: [] })).toEqual({
      kind: 'question',
      questionId: 'q_purpose',
    });
  });

  it('walks every non-neutral path to a confirm step with the path leaf, then to done', () => {
    const { paths } = enumerateQuizPaths(DEFAULT_QUIZ_DEFINITION_V2);
    const nonNeutral = paths.filter((p) => p.leaf !== 'neutral');
    expect(nonNeutral).toHaveLength(13);
    for (const p of nonNeutral) {
      const asked = drive(DEFAULT_QUIZ_DEFINITION_V2, p.selections);
      expect(asked.step).toEqual({ kind: 'confirm', leaf: p.leaf, traits: p.traits });
      expect(asked.kinds.filter((k) => k === 'question')).toHaveLength(p.selections.length);
      const done = drive(DEFAULT_QUIZ_DEFINITION_V2, p.selections, true);
      expect(done.step).toEqual({ kind: 'done', leaf: p.leaf, traits: p.traits });
    }
  });

  it('goes straight to done for "unsure" (neutral never asks for confirmation)', () => {
    const out = drive(DEFAULT_QUIZ_DEFINITION_V2, [UNSURE]);
    expect(out.step).toEqual({ kind: 'done', leaf: 'neutral', traits: [] });
    expect(out.kinds).toEqual(['question', 'done']);
  });

  it('asks the trait screen after the clarifier and only confirms after it', () => {
    const afterClarifier = nextStep(DEFAULT_QUIZ_DEFINITION_V2, { path: [MAIN_HERE, 0] });
    expect(afterClarifier).toEqual({ kind: 'question', questionId: 't_home' });
    const afterTraits = nextStep(DEFAULT_QUIZ_DEFINITION_V2, { path: [MAIN_HERE, 0, [2]] });
    expect(afterTraits).toEqual({ kind: 'confirm', leaf: 'first_time_buyer', traits: ['premium'] });
  });

  it('re-asks the same question after an invalid selection', () => {
    expect(nextStep(DEFAULT_QUIZ_DEFINITION_V2, { path: [99] })).toEqual({
      kind: 'question',
      questionId: 'q_purpose',
    });
  });

  it('never confirms when the definition has no confirm block', () => {
    const def = v2();
    delete def.confirm;
    const out = nextStep(def, { path: [MAIN_HERE, 0, []] });
    expect(out).toEqual({ kind: 'done', leaf: 'first_time_buyer', traits: [] });
  });

  it('confirms only when the leaf has BOTH a name and a sentence', () => {
    const path: QuizPathStep[] = [MAIN_HERE, 0, []];
    expect(nextStep(v2(), { path }).kind).toBe('confirm');
    const noName = v2();
    delete noName.confirm?.names_i18n.first_time_buyer;
    expect(nextStep(noName, { path })).toEqual({
      kind: 'done',
      leaf: 'first_time_buyer',
      traits: [],
    });
    const noSentence = v2();
    delete noSentence.confirm?.sentences_i18n.first_time_buyer;
    expect(nextStep(noSentence, { path }).kind).toBe('done');
    // another leaf is unaffected
    expect(nextStep(noSentence, { path: [MAIN_HERE, 1, []] }).kind).toBe('confirm');
  });

  it('ends the walk (done) when a draft has a dangling root', () => {
    const def = v2();
    def.root = 'missing';
    expect(nextStep(def, { path: [] })).toEqual({ kind: 'done', leaf: 'neutral', traits: [] });
  });
});
