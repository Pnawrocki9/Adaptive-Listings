/** Tests for the quiz definition diff (FOLLOW-1356). */

import { describe, expect, it } from 'vitest';

import { DEFAULT_QUIZ_DEFINITION_V2 } from '../quiz-default-v2.js';
import type { QuizDefinition } from './presentation-config.js';
import { diffQuizDefinitions } from './quiz-diff.js';

const v2 = (): QuizDefinition => structuredClone(DEFAULT_QUIZ_DEFINITION_V2);

function question(def: QuizDefinition, id: string): QuizDefinition['questions'][number] {
  const q = def.questions.find((x) => x.id === id);
  if (!q) throw new Error(`fixture: no question ${id}`);
  return q;
}

function answer(def: QuizDefinition, qid: string, aid: string) {
  const a = question(def, qid).answers.find((x) => x.id === aid);
  if (!a) throw new Error(`fixture: no answer ${qid}/${aid}`);
  return a;
}

describe('diffQuizDefinitions', () => {
  it('returns [] for identical definitions', () => {
    expect(diffQuizDefinitions(v2(), v2())).toEqual([]);
  });

  it('reports a changed root', () => {
    const b = v2();
    b.root = 'q_home';
    expect(diffQuizDefinitions(v2(), b)).toEqual([
      { type: 'root_changed', before: 'q_purpose', after: 'q_home' },
    ]);
  });

  it('reports a changed languages list (as a set: order alone is no change)', () => {
    const b = v2();
    b.languages = ['en', 'pl', 'es'];
    expect(diffQuizDefinitions(v2(), b)).toEqual([
      { type: 'languages_changed', before: ['en', 'pl'], after: ['en', 'pl', 'es'] },
    ]);
    const c = v2();
    c.languages = ['pl', 'en'];
    expect(diffQuizDefinitions(v2(), c)).toEqual([]);
  });

  it('reports an added and a removed question', () => {
    const b = v2();
    b.questions = b.questions.filter((q) => q.id !== 't_student');
    b.questions.push({
      id: 'q_new',
      prompt_i18n: { en: 'New', pl: 'Nowe' },
      answers: [
        { id: 'x', label_i18n: { en: 'X', pl: 'X' }, weights: {}, next: null },
        { id: 'y', label_i18n: { en: 'Y', pl: 'Y' }, weights: {}, next: null },
      ],
    });
    expect(diffQuizDefinitions(v2(), b)).toEqual([
      { type: 'question_removed', questionId: 't_student', index: 8 },
      { type: 'question_added', questionId: 'q_new', index: 8 },
    ]);
  });

  it('reports a moved question once, not once per question it shifted', () => {
    const b = v2();
    const [first] = b.questions.splice(1, 1); // move q_home to the end
    if (!first) throw new Error('fixture');
    b.questions.push(first);
    expect(diffQuizDefinitions(v2(), b)).toEqual([
      { type: 'question_reordered', questionId: 'q_home', from: 1, to: 8 },
    ]);
  });

  it('reports question kind changes (absent = single)', () => {
    const b = v2();
    question(b, 't_home').kind = 'single';
    expect(diffQuizDefinitions(v2(), b)).toEqual([
      { type: 'question_kind_changed', questionId: 't_home', before: 'multi', after: 'single' },
    ]);
    const c = v2();
    question(c, 'q_home').kind = 'single'; // explicit single equals absent
    expect(diffQuizDefinitions(v2(), c)).toEqual([]);
  });

  it('reports prompt changes per language', () => {
    const b = v2();
    question(b, 'q_home').prompt_i18n.pl = 'Co Cię opisuje?';
    question(b, 'q_home').prompt_i18n.es = '¿Cuál te describe?';
    expect(diffQuizDefinitions(v2(), b)).toEqual([
      {
        type: 'prompt_changed',
        questionId: 'q_home',
        language: 'es',
        before: null,
        after: '¿Cuál te describe?',
      },
      {
        type: 'prompt_changed',
        questionId: 'q_home',
        language: 'pl',
        before: 'Co najlepiej Cię opisuje?',
        after: 'Co Cię opisuje?',
      },
    ]);
  });

  it('reports added, removed and reordered answers', () => {
    const b = v2();
    const q = question(b, 'q_move');
    q.answers = q.answers.filter((a) => a.id !== 'retire');
    q.answers.reverse(); // work, return
    const added = diffQuizDefinitions(v2(), b);
    expect(added).toEqual([
      { type: 'answer_removed', questionId: 'q_move', answerId: 'retire', index: 1 },
      { type: 'answer_reordered', questionId: 'q_move', answerId: 'return', from: 0, to: 1 },
    ]);
    const c = v2();
    question(c, 'q_move').answers.push({
      id: 'other',
      label_i18n: { en: 'Other', pl: 'Inne' },
      weights: {},
      next: 't_move',
    });
    expect(diffQuizDefinitions(v2(), c)).toEqual([
      { type: 'answer_added', questionId: 'q_move', answerId: 'other', index: 3 },
    ]);
  });

  it('reports label, next, weights and traits changes on an answer', () => {
    const b = v2();
    const a = answer(b, 'q_purpose', 'main_move');
    a.label_i18n.en = 'My main home abroad';
    a.next = 'q_home';
    a.weights = { diaspora_buyer: 1 };
    a.traits = ['buying_from_abroad', 'premium'];
    expect(diffQuizDefinitions(v2(), b)).toEqual([
      {
        type: 'label_changed',
        questionId: 'q_purpose',
        answerId: 'main_move',
        language: 'en',
        before: "My main home, in a country I'm moving to (or back to)",
        after: 'My main home abroad',
      },
      {
        type: 'next_changed',
        questionId: 'q_purpose',
        answerId: 'main_move',
        before: 'q_move',
        after: 'q_home',
      },
      {
        type: 'weights_changed',
        questionId: 'q_purpose',
        answerId: 'main_move',
        before: {},
        after: { diaspora_buyer: 1 },
      },
      {
        type: 'traits_changed',
        questionId: 'q_purpose',
        answerId: 'main_move',
        before: ['buying_from_abroad'],
        after: ['buying_from_abroad', 'premium'],
      },
    ]);
  });

  it('ignores the order of traits and of weight keys', () => {
    const a = v2();
    const b = v2();
    answer(a, 'q_purpose', 'main_move').traits = ['premium', 'buying_from_abroad'];
    answer(b, 'q_purpose', 'main_move').traits = ['buying_from_abroad', 'premium'];
    answer(a, 'q_home', 'first').weights = { first_time_buyer: 1, family_buyer: 2 };
    answer(b, 'q_home', 'first').weights = { family_buyer: 2, first_time_buyer: 1 };
    expect(diffQuizDefinitions(a, b)).toEqual([]);
  });

  it('reports confirm text and alternatives changes', () => {
    const b = v2();
    if (!b.confirm) throw new Error('fixture');
    b.confirm.sentences_i18n.downsizer = {
      en: "you've owned before and want less to look after",
      pl: 'masz już za sobą własne lokum i chcesz mniej obowiązków',
    };
    b.confirm.alternatives.downsizer = ['family_buyer', 'retiree_relocator', 'second_home_buyer'];
    const changes = diffQuizDefinitions(v2(), b);
    expect(changes.map((c) => c.type)).toEqual([
      'confirm_text_changed',
      'confirm_text_changed',
      'confirm_alternatives_changed',
    ]);
    expect(changes[0]).toMatchObject({
      field: 'sentence',
      archetypeId: 'downsizer',
      language: 'en',
    });
    expect(changes[2]).toEqual({
      type: 'confirm_alternatives_changed',
      archetypeId: 'downsizer',
      before: ['retiree_relocator', 'family_buyer', 'second_home_buyer'],
      after: ['family_buyer', 'retiree_relocator', 'second_home_buyer'],
    });
  });

  it('treats a removed confirm block as every confirm text going away', () => {
    const b = v2();
    delete b.confirm;
    const changes = diffQuizDefinitions(v2(), b);
    // 12 names + 12 sentences, EN and PL each, plus 12 alternatives lists
    expect(changes.filter((c) => c.type === 'confirm_text_changed')).toHaveLength(48);
    expect(changes.filter((c) => c.type === 'confirm_alternatives_changed')).toHaveLength(12);
    expect(changes.every((c) => c.type.startsWith('confirm_'))).toBe(true);
  });
});
