/**
 * Tests for the additive v3.0 quiz schema fields (FOLLOW-1356): answer `traits`, question
 * `kind`, the `confirm` block, `computeAmbiguousPaths` and the unreachable allow-list.
 * The pre-existing schema tests live in `presentation-config.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_QUIZ_DEFINITION_V2 } from '../quiz-default-v2.js';
import { EXAMPLE_QUIZ_DEFINITION } from '../examples/presentation-config.js';
import { QuizDefinitionAuthoringSchema } from './quiz-lint.js';
import { nextStep, resolveQuizOutcome } from './quiz-walk.js';
import {
  QUIZ_TRAIT_ONLY_ARCHETYPE_IDS,
  QuizAnswerSchema,
  QuizDefinitionSchema,
  QuizQuestionSchema,
  computeAmbiguousPaths,
  computeUnreachableArchetypes,
  type QuizDefinition,
} from './presentation-config.js';

const v2 = (): QuizDefinition => structuredClone(DEFAULT_QUIZ_DEFINITION_V2);
const answer = (extra: Record<string, unknown>) => ({
  id: 'a',
  label_i18n: { en: 'A', pl: 'A' },
  weights: {},
  next: null,
  ...extra,
});

describe('QuizAnswerSchema.traits and QuizQuestionSchema.kind (serve schema: forward compatible)', () => {
  const q = (kind?: string) => ({
    id: 'q',
    prompt_i18n: { en: 'Q', pl: 'Q' },
    answers: [answer({ id: 'a' }), answer({ id: 'b' })],
    ...(kind === undefined ? {} : { kind }),
  });

  it('accepts traits as plain strings, so a trait added later cannot break an older cached SDK', () => {
    expect(QuizAnswerSchema.safeParse(answer({})).success).toBe(true);
    expect(QuizAnswerSchema.safeParse(answer({ traits: [] })).success).toBe(true);
    expect(
      QuizAnswerSchema.safeParse(answer({ traits: ['premium', 'a_future_trait'] })).success,
    ).toBe(true);
    expect(QuizAnswerSchema.safeParse(answer({ traits: [7] })).success).toBe(false);
  });

  it('accepts any string kind (unknown kinds are walked as single)', () => {
    for (const kind of [undefined, 'single', 'multi', 'a_future_kind']) {
      expect(QuizQuestionSchema.safeParse(q(kind)).success).toBe(true);
    }
  });

  it('serves a row with an unknown trait and kind, and the walker drops the trait / walks single', () => {
    const def = v2();
    const first = def.questions[0]?.answers[0];
    const home = def.questions.find((x) => x.id === 'q_home');
    if (!first || !home) throw new Error('fixture');
    first.traits = ['a_future_trait', 'premium'];
    home.kind = 'a_future_kind';
    const parsed = QuizDefinitionSchema.safeParse(def);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // unknown trait dropped, canonical one kept
    expect(resolveQuizOutcome(parsed.data, [0, 0, []])).toEqual({
      leaf: 'first_time_buyer',
      traits: ['premium'],
    });
    // q_home with an unknown kind behaves as single: picks one answer and follows its next
    expect(nextStep(parsed.data, { path: [0] })).toEqual({
      kind: 'question',
      questionId: 'q_home',
    });
    expect(nextStep(parsed.data, { path: [0, 1] })).toEqual({
      kind: 'question',
      questionId: 't_home',
    });
    // the same row is an AUTHORING error
    expect(QuizDefinitionAuthoringSchema.safeParse(def).success).toBe(false);
  });
});

describe('QuizDefinitionSchema.confirm (serve schema)', () => {
  it('accepts the v2 default (a definition without confirm still parses too)', () => {
    expect(QuizDefinitionSchema.safeParse(v2()).success).toBe(true);
    expect(QuizDefinitionSchema.safeParse(structuredClone(EXAMPLE_QUIZ_DEFINITION)).success).toBe(
      true,
    );
  });

  it('rejects a non-canonical or neutral key in names, sentences and alternatives', () => {
    for (const bad of ['not_an_archetype', 'neutral']) {
      const names = v2();
      const sentences = v2();
      const alternatives = v2();
      if (!names.confirm || !sentences.confirm || !alternatives.confirm) {
        throw new Error('fixture');
      }
      names.confirm.names_i18n[bad] = { en: 'x', pl: 'x' };
      sentences.confirm.sentences_i18n[bad] = { en: 'x', pl: 'x' };
      alternatives.confirm.alternatives[bad] = ['yield_hunter', 'flip_investor'];
      const cases: [QuizDefinition, string][] = [
        [names, `confirm.names_i18n.${bad}`],
        [sentences, `confirm.sentences_i18n.${bad}`],
        [alternatives, `confirm.alternatives.${bad}`],
      ];
      for (const [def, path] of cases) {
        const result = QuizDefinitionSchema.safeParse(def);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.map((i) => i.path.join('.'))).toContain(path);
        }
      }
    }
  });

  it('rejects a non-canonical or neutral alternative', () => {
    for (const bad of ['luxury_buyer_x', 'neutral']) {
      const def = v2();
      if (!def.confirm) throw new Error('fixture');
      def.confirm.alternatives.downsizer = ['family_buyer', bad];
      const result = QuizDefinitionSchema.safeParse(def);
      expect(result.success).toBe(false);
    }
  });

  it('rejects an archetype listing itself', () => {
    const def = v2();
    if (!def.confirm) throw new Error('fixture');
    def.confirm.alternatives.downsizer = ['family_buyer', 'downsizer'];
    const result = QuizDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message).join()).toContain('lists itself');
    }
  });

  it('rejects alternatives lists shorter than 2 or longer than 4', () => {
    const short = v2();
    const long = v2();
    if (!short.confirm || !long.confirm) throw new Error('fixture');
    short.confirm.alternatives.downsizer = ['family_buyer'];
    long.confirm.alternatives.downsizer = [
      'family_buyer',
      'first_time_buyer',
      'yield_hunter',
      'flip_investor',
      'student_parent',
    ];
    expect(QuizDefinitionSchema.safeParse(short).success).toBe(false);
    expect(QuizDefinitionSchema.safeParse(long).success).toBe(false);
  });

  it('stays lenient on the authoring-only rules (missing PL, incomplete confirm, multi weights)', () => {
    const def = v2();
    if (!def.confirm) throw new Error('fixture');
    delete def.confirm.names_i18n.yield_hunter;
    delete def.confirm.sentences_i18n.downsizer?.pl;
    const trait = def.questions.find((x) => x.id === 't_home')?.answers[0];
    if (!trait) throw new Error('fixture');
    trait.weights = { yield_hunter: 1 };
    expect(QuizDefinitionSchema.safeParse(def).success).toBe(true);
  });
});

describe('computeUnreachableArchetypes allow-list', () => {
  it('defaults to the five ids the quiz no longer assigns', () => {
    expect([...QUIZ_TRAIT_ONLY_ARCHETYPE_IDS].sort()).toEqual([
      'golden_visa_buyer',
      'luxury_buyer',
      'portfolio_builder',
      'remote_worker',
      'upsizer',
    ]);
    const unreachable = computeUnreachableArchetypes(EXAMPLE_QUIZ_DEFINITION);
    for (const id of QUIZ_TRAIT_ONLY_ARCHETYPE_IDS) expect(unreachable).not.toContain(id);
    expect(unreachable).toContain('student_parent');
  });

  it('can be overridden, and an empty list returns the raw unreachable set', () => {
    const raw = computeUnreachableArchetypes(EXAMPLE_QUIZ_DEFINITION, []);
    for (const id of QUIZ_TRAIT_ONLY_ARCHETYPE_IDS) expect(raw).toContain(id);
    expect(computeUnreachableArchetypes(EXAMPLE_QUIZ_DEFINITION, ['student_parent'])).not.toContain(
      'student_parent',
    );
  });
});

describe('computeAmbiguousPaths', () => {
  it('finds nothing in the v2 tree (one weighted answer per path)', () => {
    expect(computeAmbiguousPaths(DEFAULT_QUIZ_DEFINITION_V2)).toEqual([]);
  });

  it('flags a path that adds weight to more than one archetype', () => {
    const def = v2();
    const first = def.questions.find((q) => q.id === 'q_home')?.answers[0];
    if (!first) throw new Error('fixture');
    first.weights = { first_time_buyer: 1, family_buyer: 1 };
    expect(computeAmbiguousPaths(def)).toEqual([
      {
        questionIds: ['q_purpose', 'q_home'],
        answerIds: ['main_here', 'first'],
        archetypes: ['family_buyer', 'first_time_buyer'],
      },
    ]);
  });

  it('counts weight accumulated across questions on one path', () => {
    const def = v2();
    const purpose = def.questions.find((q) => q.id === 'q_purpose')?.answers[0];
    if (!purpose) throw new Error('fixture');
    purpose.weights = { yield_hunter: 1 }; // main_here now weighs in, then q_home weighs in again
    const paths = computeAmbiguousPaths(def);
    expect(paths).toHaveLength(3);
    expect(paths.every((p) => p.archetypes.includes('yield_hunter'))).toBe(true);
  });
});
