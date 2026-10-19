/**
 * Pins for `DEFAULT_QUIZ_DEFINITION_V2` (MASTER_DESIGN §E.4.2–§E.4.3 v3.0, FOLLOW-1356).
 */

import { describe, expect, it } from 'vitest';

import { CANONICAL_ARCHETYPE_IDS } from './archetypes.js';
import { DEFAULT_QUIZ_DEFINITION_V2 } from './quiz-default-v2.js';
import {
  QuizDefinitionSchema,
  QUIZ_TRAIT_ONLY_ARCHETYPE_IDS,
} from './schemas/presentation-config.js';
import { QuizDefinitionAuthoringSchema, lintQuizDefinition } from './schemas/quiz-lint.js';
import { enumerateQuizPaths } from './schemas/quiz-walk.js';
import { CANONICAL_TRAIT_IDS } from './traits.js';

const def = DEFAULT_QUIZ_DEFINITION_V2;

describe('DEFAULT_QUIZ_DEFINITION_V2', () => {
  it('passes the authoring schema with zero errors and zero warnings', () => {
    expect(QuizDefinitionAuthoringSchema.safeParse(def).success).toBe(true);
    expect(QuizDefinitionSchema.safeParse(def).success).toBe(true);
    expect(lintQuizDefinition(def)).toEqual({ errors: [], warnings: [] });
  });

  it('has the §E.4.2 question ids, in tree order', () => {
    expect(def.root).toBe('q_purpose');
    expect(def.questions.map((q) => q.id)).toEqual([
      'q_purpose',
      'q_home',
      'q_move',
      'q_invest',
      't_home',
      't_move',
      't_second',
      't_invest',
      't_student',
    ]);
    expect(def.languages).toEqual(['en', 'pl']);
  });

  it('has the §E.4.2 answer ids', () => {
    const ids = Object.fromEntries(def.questions.map((q) => [q.id, q.answers.map((a) => a.id)]));
    expect(ids).toEqual({
      q_purpose: ['main_here', 'main_move', 'second', 'invest', 'student', 'unsure'],
      q_home: ['first', 'up', 'down'],
      q_move: ['return', 'retire', 'work'],
      q_invest: ['long', 'short', 'flip', 'commercial', 'inv_undecided'],
      t_home: ['has_children', 'works_from_home', 'premium'],
      t_move: ['has_children', 'works_from_home', 'premium', 'residency_goal'],
      t_second: ['will_let', 'buying_from_abroad', 'works_from_home', 'residency_goal', 'premium'],
      t_invest: ['seasoned_investor', 'buying_from_abroad', 'residency_goal', 'premium'],
      t_student: ['buying_from_abroad', 'will_let'],
    });
  });

  it('routes every clarifier to its trait screen and every trait screen is last', () => {
    const next = (qid: string) => [
      ...new Set(def.questions.find((q) => q.id === qid)?.answers.map((a) => a.next)),
    ];
    expect(next('q_home')).toEqual(['t_home']);
    expect(next('q_move')).toEqual(['t_move']);
    expect(next('q_invest')).toEqual(['t_invest']);
    for (const q of def.questions.filter((x) => x.id.startsWith('t_'))) {
      expect(q.kind).toBe('multi');
      expect(q.answers.every((a) => a.next === null && Object.keys(a.weights).length === 0)).toBe(
        true,
      );
      expect(q.answers.every((a) => a.traits?.length === 1 && a.traits[0] === a.id)).toBe(true);
    }
  });

  it('weighs exactly one archetype by 1 on every path, and the right one', () => {
    const { paths } = enumerateQuizPaths(def);
    for (const p of paths) {
      const weighted = Object.entries(p.weights).filter(([, w]) => w !== 0);
      expect(weighted.length).toBeLessThanOrEqual(1);
      if (weighted[0]) expect(weighted[0][1]).toBe(1);
    }
    const leafBy = (...answerIds: string[]) =>
      paths.find((p) => answerIds.every((id, i) => p.answerIds[i] === id))?.leaf;
    expect(leafBy('main_here', 'first')).toBe('first_time_buyer');
    expect(leafBy('main_here', 'up')).toBe('family_buyer');
    expect(leafBy('main_here', 'down')).toBe('downsizer');
    expect(leafBy('main_move', 'return')).toBe('diaspora_buyer');
    expect(leafBy('main_move', 'retire')).toBe('retiree_relocator');
    expect(leafBy('main_move', 'work')).toBe('lifestyle_expat');
    expect(leafBy('second')).toBe('second_home_buyer');
    expect(leafBy('invest', 'long')).toBe('yield_hunter');
    expect(leafBy('invest', 'inv_undecided')).toBe('yield_hunter');
    expect(leafBy('invest', 'short')).toBe('vacation_rental_investor');
    expect(leafBy('invest', 'flip')).toBe('flip_investor');
    expect(leafBy('invest', 'commercial')).toBe('commercial_investor');
    expect(leafBy('student')).toBe('student_parent');
    expect(leafBy('unsure')).toBe('neutral');
  });

  it('has a non-empty EN and PL text for every question, answer and confirmation entry', () => {
    const bags = [
      ...def.questions.flatMap((q) => [q.prompt_i18n, ...q.answers.map((a) => a.label_i18n)]),
      ...Object.values(def.confirm?.names_i18n ?? {}),
      ...Object.values(def.confirm?.sentences_i18n ?? {}),
    ];
    expect(bags.length).toBeGreaterThan(60);
    for (const bag of bags) {
      expect((bag.en ?? '').trim()).not.toBe('');
      expect((bag.pl ?? '').trim()).not.toBe('');
      expect(bag.pl).not.toBe(bag.en);
    }
  });

  it('has a confirmation name, sentence and 3 alternatives for exactly the 12 results', () => {
    const results = CANONICAL_ARCHETYPE_IDS.filter(
      (id) => id !== 'neutral' && !QUIZ_TRAIT_ONLY_ARCHETYPE_IDS.includes(id),
    );
    expect(results).toHaveLength(12);
    const confirm = def.confirm;
    expect(Object.keys(confirm?.names_i18n ?? {}).sort()).toEqual([...results].sort());
    expect(Object.keys(confirm?.sentences_i18n ?? {}).sort()).toEqual([...results].sort());
    expect(Object.keys(confirm?.alternatives ?? {}).sort()).toEqual([...results].sort());
    for (const alts of Object.values(confirm?.alternatives ?? {})) expect(alts).toHaveLength(3);
  });

  it('keeps confirmation sentences free of a trailing full stop (the template adds it)', () => {
    for (const bag of Object.values(def.confirm?.sentences_i18n ?? {})) {
      expect(bag.en?.endsWith('.')).toBe(false);
      expect(bag.pl?.endsWith('.')).toBe(false);
    }
  });

  it('uses only canonical traits', () => {
    const used = new Set(def.questions.flatMap((q) => q.answers.flatMap((a) => a.traits ?? [])));
    expect([...used].sort()).toEqual([...CANONICAL_TRAIT_IDS].sort());
  });

  it('survives a JSON round trip unchanged (it is served as JSON)', () => {
    expect(JSON.parse(JSON.stringify(def))).toEqual(def);
    expect(QuizDefinitionSchema.parse(JSON.parse(JSON.stringify(def)))).toEqual(def);
  });

  it('does not share answer objects between trait screens', () => {
    const t_home = def.questions.find((q) => q.id === 't_home')?.answers[0];
    const t_move = def.questions.find((q) => q.id === 't_move')?.answers[0];
    expect(t_home).toEqual(t_move);
    expect(t_home).not.toBe(t_move);
  });
});
