/**
 * Tests for the pure quiz-draft operations (FOLLOW-1362 C2): every op, immutability, and the
 * "unknown fields round-trip" guarantee.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/definition-ops.test
 */

import { describe, it, expect } from 'vitest';
import type { QuizDefinition } from '@estalara/shared';

import {
  addAnswer,
  addQuestion,
  ancestorsOf,
  describePath,
  moveAnswer,
  nextCandidates,
  questionCompleteness,
  reachableResults,
  removeAnswer,
  removeQuestion,
  renameQuestionId,
  setAlternatives,
  setConfirmText,
  setLeafArchetype,
  setLocaleText,
  setNext,
  setQuestionKind,
  setTraits,
  setWeight,
  toggleLanguage,
} from './definition-ops';

/** q_a (root) → q_b → q_c, each with an early exit. An unknown `x_future` rides on the root. */
function tree(): QuizDefinition {
  return {
    schema_version: 1,
    root: 'q_a',
    languages: ['en', 'pl'],
    questions: [
      {
        id: 'q_a',
        prompt_i18n: { en: 'A?', pl: 'A PL?' },
        answers: [
          { id: 'a1', label_i18n: { en: 'a1', pl: 'a1 pl' }, weights: {}, next: 'q_b' },
          { id: 'a2', label_i18n: { en: 'a2', pl: '' }, weights: {}, next: null },
        ],
        x_future: 'keep-me',
      } as QuizDefinition['questions'][number],
      {
        id: 'q_b',
        prompt_i18n: { en: 'B?' },
        answers: [
          { id: 'b1', label_i18n: { en: 'b1' }, weights: {}, next: 'q_c' },
          { id: 'b2', label_i18n: { en: 'b2' }, weights: { yield_hunter: 1 }, next: null },
        ],
      },
      {
        id: 'q_c',
        prompt_i18n: { en: 'C?' },
        answers: [
          { id: 'c1', label_i18n: { en: 'c1' }, weights: { flip_investor: 1 }, next: null },
          { id: 'c2', label_i18n: { en: 'c2' }, weights: {}, next: null },
        ],
      },
    ],
  };
}

const q = (def: QuizDefinition, id: string) => def.questions.find((x) => x.id === id)!;

describe('ancestorsOf / nextCandidates', () => {
  it('lists every question that can reach the target, excluding the target itself', () => {
    expect([...ancestorsOf(tree(), 'q_c')].sort()).toEqual(['q_a', 'q_b']);
    expect([...ancestorsOf(tree(), 'q_a')]).toEqual([]);
  });

  it('candidates exclude self and ancestors', () => {
    expect(nextCandidates(tree(), 'q_b')).toEqual(['q_c']);
    expect(nextCandidates(tree(), 'q_a')).toEqual(['q_b', 'q_c']);
    expect(nextCandidates(tree(), 'q_c')).toEqual([]);
  });
});

describe('addQuestion', () => {
  it('appends an empty 2-answer question with a unique id, leaving the input untouched', () => {
    const def = tree();
    const out = addQuestion(def);
    expect(def.questions).toHaveLength(3);
    expect(out.questions).toHaveLength(4);
    const added = out.questions[3]!;
    expect(def.questions.map((x) => x.id)).not.toContain(added.id);
    expect(added.answers).toHaveLength(2);
    expect(added.answers[0]!.id).not.toBe(added.answers[1]!.id);
    expect(added.prompt_i18n).toEqual({ en: '', pl: '' });
    expect(added.answers.every((a) => a.next === null)).toBe(true);
  });

  it('honours an explicit id and refuses a duplicate', () => {
    expect(addQuestion(tree(), 'q_new').questions[3]!.id).toBe('q_new');
    expect(() => addQuestion(tree(), 'q_b')).toThrow(/already exists/);
  });
});

describe('removeQuestion', () => {
  it('nulls inbound next references and reports them', () => {
    const res = removeQuestion(tree(), 'q_c');
    expect(res.refused).toBe(false);
    expect(res.definition.questions.map((x) => x.id)).toEqual(['q_a', 'q_b']);
    expect(q(res.definition, 'q_b').answers[0]!.next).toBeNull();
    expect(res.flagged).toEqual([{ question_id: 'q_b', answer_id: 'b1' }]);
  });

  it('refuses to remove the root', () => {
    const def = tree();
    const res = removeQuestion(def, 'q_a');
    expect(res.refused).toBe(true);
    expect(res.definition).toBe(def);
  });

  it('is a no-op for an unknown id', () => {
    const def = tree();
    expect(removeQuestion(def, 'nope')).toEqual({ definition: def, flagged: [], refused: false });
  });
});

describe('addAnswer / removeAnswer', () => {
  it('adds a blank answer with a fresh id and removes one by id', () => {
    const added = addAnswer(tree(), 'q_c');
    const ids = q(added, 'q_c').answers.map((a) => a.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    const removed = removeAnswer(added, 'q_c', 'c1');
    expect(q(removed, 'q_c').answers.map((a) => a.id)).not.toContain('c1');
  });
});

describe('moveAnswer', () => {
  it('reorders and warns that stored answer indexes change', () => {
    const res = moveAnswer(tree(), 'q_c', 'c1', 1);
    expect(q(res.definition, 'q_c').answers.map((a) => a.id)).toEqual(['c2', 'c1']);
    expect(res.warning).toMatch(/index/i);
  });

  it('clamps the target and does nothing (no warning) when the position is unchanged', () => {
    const def = tree();
    expect(moveAnswer(def, 'q_c', 'c1', -5)).toEqual({ definition: def, warning: null });
    expect(q(moveAnswer(def, 'q_c', 'c1', 99).definition, 'q_c').answers[1]!.id).toBe('c1');
  });
});

describe('setNext', () => {
  it('points an answer at a legal question or at the end', () => {
    expect(q(setNext(tree(), 'q_a', 'a2', 'q_c'), 'q_a').answers[1]!.next).toBe('q_c');
    expect(q(setNext(tree(), 'q_a', 'a1', null), 'q_a').answers[0]!.next).toBeNull();
  });

  it('refuses self, ancestors and unknown questions', () => {
    expect(() => setNext(tree(), 'q_b', 'b2', 'q_b')).toThrow(/cycle/);
    expect(() => setNext(tree(), 'q_c', 'c1', 'q_a')).toThrow(/cycle/);
    expect(() => setNext(tree(), 'q_b', 'b2', 'q_zzz')).toThrow(/unknown question/);
  });
});

describe('renameQuestionId', () => {
  it('rewrites the root and every next that referenced the old id, keeping unknown fields', () => {
    const renamed = renameQuestionId(tree(), 'q_a', 'q_start');
    expect(renamed.root).toBe('q_start');
    expect((q(renamed, 'q_start') as { x_future?: string }).x_future).toBe('keep-me');

    const mid = renameQuestionId(tree(), 'q_b', 'q_mid');
    expect(q(mid, 'q_a').answers[0]!.next).toBe('q_mid');
    expect(mid.root).toBe('q_a');
    expect(mid.questions.map((x) => x.id)).toEqual(['q_a', 'q_mid', 'q_c']);
  });

  it('rejects duplicate, empty and unknown ids; same id is a no-op', () => {
    const def = tree();
    expect(() => renameQuestionId(def, 'q_a', 'q_b')).toThrow(/already exists/);
    expect(() => renameQuestionId(def, 'q_a', '  ')).toThrow(/empty/);
    expect(() => renameQuestionId(def, 'nope', 'x')).toThrow(/unknown question/);
    expect(renameQuestionId(def, 'q_a', 'q_a')).toBe(def);
  });
});

describe('setLeafArchetype / setWeight', () => {
  it('writes weights {X: 1} and clears them with null', () => {
    const set = setLeafArchetype(tree(), 'q_c', 'c2', 'family_buyer');
    expect(q(set, 'q_c').answers[1]!.weights).toEqual({ family_buyer: 1 });
    const cleared = setLeafArchetype(set, 'q_c', 'c2', null);
    expect(q(cleared, 'q_c').answers[1]!.weights).toEqual({});
  });

  it('setWeight adds, updates and removes a single archetype weight', () => {
    const a = setWeight(tree(), 'q_b', 'b2', 'flip_investor', 0.5);
    expect(q(a, 'q_b').answers[1]!.weights).toEqual({ yield_hunter: 1, flip_investor: 0.5 });
    const b = setWeight(a, 'q_b', 'b2', 'yield_hunter', null);
    expect(q(b, 'q_b').answers[1]!.weights).toEqual({ flip_investor: 0.5 });
  });
});

describe('setTraits', () => {
  it('sets the traits and removes the key for an empty list', () => {
    const set = setTraits(tree(), 'q_c', 'c1', ['premium', 'has_children']);
    expect(q(set, 'q_c').answers[0]!.traits).toEqual(['premium', 'has_children']);
    const cleared = setTraits(set, 'q_c', 'c1', []);
    expect('traits' in q(cleared, 'q_c').answers[0]!).toBe(false);
  });
});

describe('setQuestionKind', () => {
  it('multi clears every answer weights and next; single drops the kind key', () => {
    const multi = setQuestionKind(tree(), 'q_b', 'multi');
    expect(q(multi, 'q_b').kind).toBe('multi');
    expect(q(multi, 'q_b').answers.every((a) => a.next === null)).toBe(true);
    expect(q(multi, 'q_b').answers.every((a) => Object.keys(a.weights).length === 0)).toBe(true);
    const single = setQuestionKind(multi, 'q_b', 'single');
    expect('kind' in q(single, 'q_b')).toBe(false);
  });
});

describe('setLocaleText', () => {
  it('sets one language of a prompt or a label without touching the other', () => {
    const p = setLocaleText(tree(), { qid: 'q_b' }, 'pl', 'B PL?');
    expect(q(p, 'q_b').prompt_i18n).toEqual({ en: 'B?', pl: 'B PL?' });
    const l = setLocaleText(tree(), { qid: 'q_a', aid: 'a2' }, 'pl', 'a2 pl');
    expect(q(l, 'q_a').answers[1]!.label_i18n).toEqual({ en: 'a2', pl: 'a2 pl' });
    expect((q(l, 'q_a') as { x_future?: string }).x_future).toBe('keep-me');
  });
});

describe('setConfirmText / setAlternatives', () => {
  it('creates the confirm block on first use and sets one language', () => {
    const out = setConfirmText(tree(), 'names_i18n', 'yield_hunter', 'pl', 'Łowca');
    expect(out.confirm).toEqual({
      names_i18n: { yield_hunter: { pl: 'Łowca' } },
      sentences_i18n: {},
      alternatives: {},
    });
    const both = setConfirmText(out, 'names_i18n', 'yield_hunter', 'en', 'Hunter');
    expect(both.confirm!.names_i18n.yield_hunter).toEqual({ pl: 'Łowca', en: 'Hunter' });
    const sentence = setConfirmText(both, 'sentences_i18n', 'yield_hunter', 'en', 'You want yield');
    expect(sentence.confirm!.sentences_i18n.yield_hunter).toEqual({ en: 'You want yield' });
  });

  it('sets alternatives and removes the key for an empty list', () => {
    const set = setAlternatives(tree(), 'yield_hunter', ['flip_investor', 'family_buyer']);
    expect(set.confirm!.alternatives.yield_hunter).toEqual(['flip_investor', 'family_buyer']);
    const cleared = setAlternatives(set, 'yield_hunter', []);
    expect('yield_hunter' in cleared.confirm!.alternatives).toBe(false);
  });
});

describe('toggleLanguage', () => {
  it('adds and removes a language, never removing the last one', () => {
    const added = toggleLanguage(tree(), 'es');
    expect(added.languages).toEqual(['en', 'pl', 'es']);
    expect(toggleLanguage(added, 'es').languages).toEqual(['en', 'pl']);
    const single: QuizDefinition = { ...tree(), languages: ['en'] };
    expect(toggleLanguage(single, 'en')).toBe(single);
  });
});

describe('read helpers', () => {
  it('questionCompleteness counts non-blank texts of a language', () => {
    expect(questionCompleteness(q(tree(), 'q_a'), 'pl')).toEqual({ filled: 2, total: 3 });
    expect(questionCompleteness(q(tree(), 'q_b'), 'pl')).toEqual({ filled: 0, total: 3 });
  });

  it('reachableResults lists the non-neutral leaves', () => {
    expect(reachableResults(tree())).toEqual(['flip_investor', 'yield_hunter']);
  });

  it('describePath turns indexes into ids', () => {
    const def = tree();
    expect(describePath(def, ['questions', 1, 'answers', 0, 'label_i18n', 'pl'])).toBe(
      'q_b › b1 › label_i18n.pl',
    );
    expect(describePath(def, ['questions', 2, 'prompt_i18n', 'pl'])).toBe('q_c › prompt_i18n');
    expect(describePath(def, ['confirm', 'names_i18n'])).toBe('confirm.names_i18n');
  });

  it('operations never mutate their input', () => {
    const def = tree();
    const snapshot = JSON.stringify(def);
    removeQuestion(def, 'q_c');
    renameQuestionId(def, 'q_a', 'q_z');
    setQuestionKind(def, 'q_b', 'multi');
    setConfirmText(def, 'names_i18n', 'yield_hunter', 'en', 'x');
    expect(JSON.stringify(def)).toBe(snapshot);
  });
});
