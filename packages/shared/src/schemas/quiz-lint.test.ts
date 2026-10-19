/**
 * Tests for the quiz authoring lint (FOLLOW-1356): one case per lint code, the authoring
 * schema (EN + PL are errors), the zero-error/zero-warning pin for the v2 default and the
 * serve-schema regression (a blob violating only authoring rules still serves).
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_QUIZ_DEFINITION_V2 } from '../quiz-default-v2.js';
import {
  DEFAULT_MAX_QUIZ_PATHS,
  QuizDefinitionSchema,
  quizWalkStepBudget,
  walkQuizPaths,
  type QuizDefinition,
} from './presentation-config.js';
import {
  QUIZ_LINT_ERROR_CODES,
  QUIZ_LINT_WARNING_CODES,
  QuizDefinitionAuthoringSchema,
  lintQuizDefinition,
  type QuizLintErrorCode,
  type QuizLintWarningCode,
} from './quiz-lint.js';

const v2 = (): QuizDefinition => structuredClone(DEFAULT_QUIZ_DEFINITION_V2);

function question(def: QuizDefinition, id: string): QuizDefinition['questions'][number] {
  const q = def.questions.find((x) => x.id === id);
  if (!q) throw new Error(`fixture: no question ${id}`);
  return q;
}

/** A filler question with two terminal answers (used to pad trees past the limits). */
function filler(id: string, next: string | null = null): QuizDefinition['questions'][number] {
  return {
    id,
    prompt_i18n: { en: `Q ${id}`, pl: `P ${id}` },
    answers: [
      { id: 'a', label_i18n: { en: 'A', pl: 'A pl' }, weights: { yield_hunter: 1 }, next },
      { id: 'b', label_i18n: { en: 'B', pl: 'B pl' }, weights: { flip_investor: 1 }, next },
    ],
  };
}

/** A chain of `depth` questions, each with `width` answers all leading to the next level. */
function levels(depth: number, width: number): QuizDefinition {
  const questions = Array.from({ length: depth }, (_, level) => ({
    id: `l${String(level)}`,
    prompt_i18n: { en: `Level ${String(level)}`, pl: `Poziom ${String(level)}` },
    answers: Array.from({ length: width }, (_, i) => ({
      id: `a${String(i)}`,
      label_i18n: { en: `Answer ${String(i)}`, pl: `Odpowiedź ${String(i)}` },
      weights: { yield_hunter: 1 },
      next: level + 1 < depth ? `l${String(level + 1)}` : null,
    })),
  }));
  return { schema_version: 1, root: 'l0', languages: ['en', 'pl'], questions };
}

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

// ─── the v2 default is clean ─────────────────────────────────────────────────

describe('DEFAULT_QUIZ_DEFINITION_V2 under the authoring lint', () => {
  it('has zero errors and zero warnings (also with widgetLanguage pl)', () => {
    expect(lintQuizDefinition(DEFAULT_QUIZ_DEFINITION_V2)).toEqual({ errors: [], warnings: [] });
    expect(lintQuizDefinition(DEFAULT_QUIZ_DEFINITION_V2, { widgetLanguage: 'pl' })).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('parses with the authoring schema and the serve schema', () => {
    expect(QuizDefinitionAuthoringSchema.safeParse(DEFAULT_QUIZ_DEFINITION_V2).success).toBe(true);
    expect(QuizDefinitionSchema.safeParse(DEFAULT_QUIZ_DEFINITION_V2).success).toBe(true);
  });
});

// ─── one case per lint code ──────────────────────────────────────────────────

const ERROR_CASES: Record<QuizLintErrorCode, () => QuizDefinition> = {
  orphan_question: () => {
    const def = v2();
    def.questions.push(filler('orphan'));
    return def;
  },
  duplicate_answer_id: () => {
    const def = v2();
    const answers = question(def, 'q_home').answers;
    const second = answers[1];
    if (!second) throw new Error('fixture');
    second.id = 'first';
    return def;
  },
  too_many_questions: () => {
    const def = v2();
    for (let i = 0; i < 40; i += 1) def.questions.push(filler(`extra${String(i)}`));
    return def;
  },
  answers_out_of_range: () => {
    const def = v2();
    const answers = question(def, 'q_home').answers;
    for (let i = 0; i < 6; i += 1) {
      answers.push({
        id: `more${String(i)}`,
        label_i18n: { en: `More ${String(i)}`, pl: `Więcej ${String(i)}` },
        weights: {},
        next: 't_home',
      });
    }
    return def;
  },
  depth_exceeded: () => levels(7, 2),
  too_many_paths: () => levels(4, 8), // 8^4 = 4096 paths
  missing_translation: () => {
    const def = v2();
    delete question(def, 'q_purpose').prompt_i18n.pl;
    return def;
  },
  empty_label: () => {
    const def = v2();
    const first = question(def, 'q_home').answers[0];
    if (!first) throw new Error('fixture');
    first.label_i18n.en = '   ';
    return def;
  },
  label_too_long: () => {
    const def = v2();
    question(def, 'q_home').prompt_i18n.en = 'x'.repeat(161);
    return def;
  },
  multi_question_invalid: () => {
    const def = v2();
    const first = question(def, 't_home').answers[0];
    if (!first) throw new Error('fixture');
    first.weights = { yield_hunter: 1 };
    return def;
  },
  confirm_missing_name: () => {
    const def = v2();
    delete def.confirm?.names_i18n.yield_hunter;
    return def;
  },
  confirm_missing_sentence: () => {
    const def = v2();
    delete def.confirm?.sentences_i18n.yield_hunter;
    return def;
  },
  confirm_missing: () => {
    const def = v2();
    delete def.confirm;
    return def;
  },
  confirm_alternative_unnamed: () => {
    const def = v2();
    delete def.confirm?.names_i18n.student_parent?.pl; // alternative of yield_hunter
    return def;
  },
  confirm_alternative_duplicate: () => {
    const def = v2();
    if (!def.confirm) throw new Error('fixture');
    def.confirm.alternatives.downsizer = ['family_buyer', 'family_buyer', 'second_home_buyer'];
    return def;
  },
  languages_incomplete: () => {
    const def = v2();
    def.languages = ['en'];
    return def;
  },
  invalid_question_kind: () => {
    const def = v2();
    question(def, 'q_home').kind = 'checkbox';
    return def;
  },
  invalid_trait_list: () => {
    const def = v2();
    const first = question(def, 'q_purpose').answers[0];
    if (!first) throw new Error('fixture');
    first.traits = ['luxury_buyer'];
    return def;
  },
};

const WARNING_CASES: Record<QuizLintWarningCode, () => QuizDefinition> = {
  unreachable_archetype: () => {
    const def = v2();
    const q = question(def, 'q_purpose');
    q.answers = q.answers.filter((a) => a.id !== 'student');
    return def;
  },
  argmax_tie: () => {
    const def = v2();
    const first = question(def, 'q_home').answers[0];
    if (!first) throw new Error('fixture');
    first.weights = { first_time_buyer: 1, family_buyer: 1 };
    return def;
  },
  weight_out_of_range: () => {
    const def = v2();
    const first = question(def, 'q_home').answers[0];
    if (!first) throw new Error('fixture');
    first.weights = { first_time_buyer: 11 };
    return def;
  },
  duplicate_label: () => {
    const def = v2();
    const answers = question(def, 'q_home').answers;
    const [first, second] = answers;
    if (!first || !second) throw new Error('fixture');
    second.label_i18n = { ...first.label_i18n };
    return def;
  },
  neutral_terminal_answer: () => {
    const def = v2();
    const first = question(def, 'q_home').answers[0];
    if (!first) throw new Error('fixture');
    first.weights = {};
    return def;
  },
  widget_language_incomplete: () => {
    const def = v2();
    delete question(def, 'q_purpose').prompt_i18n.pl;
    return def;
  },
  ambiguous_path: () => {
    const def = v2();
    const first = question(def, 'q_home').answers[0];
    if (!first) throw new Error('fixture');
    first.weights = { first_time_buyer: 1, family_buyer: 2 };
    return def;
  },
  confirm_missing_alternatives: () => {
    const def = v2();
    delete def.confirm?.alternatives.first_time_buyer;
    return def;
  },
};

describe('lintQuizDefinition — errors, one case per code', () => {
  it('has a case for every error code', () => {
    expect(Object.keys(ERROR_CASES).sort()).toEqual([...QUIZ_LINT_ERROR_CODES].sort());
  });

  for (const code of QUIZ_LINT_ERROR_CODES) {
    it(`reports ${code}`, () => {
      const def = ERROR_CASES[code]();
      const { errors } = lintQuizDefinition(def);
      expect(codes(errors)).toContain(code);
      const issue = errors.find((e) => e.code === code);
      expect(issue?.path.length).toBeGreaterThan(0);
      expect(issue?.message.length).toBeGreaterThan(0);
      // the authoring schema carries the same finding as a blocking issue
      const parsed = QuizDefinitionAuthoringSchema.safeParse(def);
      expect(parsed.success).toBe(false);
      const lintCodes = parsed.success
        ? []
        : parsed.error.issues.map((i) =>
            i.code === 'custom' ? (i.params as { lint_code?: string } | undefined)?.lint_code : '',
          );
      expect(lintCodes).toContain(code);
    });
  }

  it('addresses a missing PL text by path', () => {
    const { errors } = lintQuizDefinition(ERROR_CASES.missing_translation());
    expect(errors).toContainEqual({
      code: 'missing_translation',
      path: ['questions', 0, 'prompt_i18n', 'pl'],
      message: expect.stringContaining('PL'),
    });
  });

  it('flags a missing EN text just like a missing PL one', () => {
    const def = v2();
    delete question(def, 'q_purpose').prompt_i18n.en;
    expect(codes(lintQuizDefinition(def).errors)).toContain('missing_translation');
  });

  it('applies the EN + PL rule to confirm names and sentences', () => {
    const def = v2();
    delete def.confirm?.sentences_i18n.downsizer?.pl;
    delete def.confirm?.names_i18n.downsizer?.en;
    const { errors } = lintQuizDefinition(def);
    const paths = errors
      .filter((e) => e.code === 'missing_translation')
      .map((e) => e.path.join('.'));
    expect(paths).toContain('confirm.sentences_i18n.downsizer.pl');
    expect(paths).toContain('confirm.names_i18n.downsizer.en');
  });

  it('accepts an optional ES text and rejects a blank one', () => {
    const def = v2();
    question(def, 'q_purpose').prompt_i18n.es = '¿Para qué será esta propiedad?';
    expect(lintQuizDefinition(def).errors).toEqual([]);
    question(def, 'q_purpose').prompt_i18n.es = ' ';
    expect(codes(lintQuizDefinition(def).errors)).toEqual(['empty_label']);
  });

  it('allows exactly 40 questions, 8 answers, depth 6 and 160 characters', () => {
    const def = v2();
    question(def, 'q_home').prompt_i18n.en = 'x'.repeat(160);
    expect(lintQuizDefinition(def).errors).toEqual([]);
    const deep = levels(6, 2);
    expect(codes(lintQuizDefinition(deep).errors)).toEqual(['confirm_missing']); // only the missing confirm block
    const wide = levels(2, 8);
    expect(codes(lintQuizDefinition(wide).errors)).toEqual(['confirm_missing']);
  });

  it('requires a confirm block: its absence is the ONLY finding on an otherwise clean tree', () => {
    const def = v2();
    delete def.confirm;
    const { errors, warnings } = lintQuizDefinition(def);
    expect(errors).toEqual([
      { code: 'confirm_missing', path: ['confirm'], message: expect.stringContaining('required') },
    ]);
    expect(warnings).toEqual([]);
  });

  it('flags an unnamed or blank-named alternative and a repeated one, by index', () => {
    const def = v2();
    if (!def.confirm) throw new Error('fixture');
    delete def.confirm.names_i18n.student_parent; // an alternative of yield_hunter
    def.confirm.alternatives.downsizer = ['family_buyer', 'family_buyer', 'second_home_buyer'];
    const { errors } = lintQuizDefinition(def);
    const at = (code: string) => errors.filter((e) => e.code === code).map((e) => e.path.join('.'));
    expect(at('confirm_alternative_unnamed')).toEqual(
      expect.arrayContaining([
        'confirm.alternatives.yield_hunter.2',
        'confirm.alternatives.first_time_buyer.2',
      ]),
    );
    expect(at('confirm_alternative_duplicate')).toEqual(['confirm.alternatives.downsizer.1']);
    // a blank EN name counts as unnamed too
    const blank = v2();
    if (!blank.confirm) throw new Error('fixture');
    blank.confirm.names_i18n.flip_investor = { en: ' ', pl: 'Remont i sprzedaż' };
    expect(codes(lintQuizDefinition(blank).errors)).toContain('confirm_alternative_unnamed');
  });

  it('requires both en and pl in languages', () => {
    for (const languages of [['en'], ['pl'], ['es']] as const) {
      const def = v2();
      def.languages = [...languages];
      expect(codes(lintQuizDefinition(def).errors)).toContain('languages_incomplete');
    }
    const ok = v2();
    ok.languages = ['pl', 'es', 'en'];
    expect(lintQuizDefinition(ok).errors).toEqual([]);
  });

  it('rejects unknown, repeated and more than 4 traits, and an unknown question kind', () => {
    const cases: string[][] = [
      ['premium', 'premium'],
      ['premium', 'has_children', 'will_let', 'residency_goal', 'works_from_home'],
      ['not_a_trait'],
    ];
    for (const traits of cases) {
      const def = v2();
      const first = question(def, 'q_purpose').answers[0];
      if (!first) throw new Error('fixture');
      first.traits = traits;
      expect(codes(lintQuizDefinition(def).errors)).toEqual(['invalid_trait_list']);
    }
    const kind = v2();
    question(kind, 'q_home').kind = 'checkbox';
    expect(codes(lintQuizDefinition(kind).errors)).toEqual(['invalid_question_kind']);
  });
});

describe('lintQuizDefinition on a cyclic draft', () => {
  /** A chain of `n` questions with 2 answers each; the last points back to the root. */
  function cyclicChain(n: number): QuizDefinition {
    const questions = Array.from({ length: n }, (_, i) => ({
      id: `c${String(i)}`,
      prompt_i18n: { en: 'Q', pl: 'P' },
      answers: ['a', 'b'].map((id) => ({
        id,
        label_i18n: { en: id, pl: `${id} pl` },
        weights: { yield_hunter: 1 },
        next: `c${String((i + 1) % n)}`,
      })),
    }));
    return { schema_version: 1, root: 'c0', languages: ['en', 'pl'], questions };
  }

  it('stays within the step budget: the walk is cut off and flagged, never exponential', () => {
    const def = cyclicChain(30);
    let visited = 0;
    const out = walkQuizPaths(def, () => {
      visited += 1;
    });
    expect(out.truncated).toBe(true);
    expect(out.steps).toBeLessThanOrEqual(quizWalkStepBudget(DEFAULT_MAX_QUIZ_PATHS));
    expect(visited).toBe(0); // every path re-enters the cycle: none is complete
    const small = walkQuizPaths(def, () => undefined, 50);
    expect(small.steps).toBeLessThanOrEqual(quizWalkStepBudget(50));
  });

  it('skips every path-based check (no walk) and reports no path findings', () => {
    const { errors, warnings } = lintQuizDefinition(cyclicChain(30));
    const all = [...errors, ...warnings].map((i) => i.code);
    for (const code of [
      'too_many_paths',
      'unreachable_archetype',
      'ambiguous_path',
      'argmax_tie',
    ]) {
      expect(all).not.toContain(code);
    }
    // the serve schema is what rejects the cycle, and the authoring schema keeps that rule
    const parsed = QuizDefinitionAuthoringSchema.safeParse(cyclicChain(30));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.message).join()).toContain('cycle detected');
    }
  });
});

describe('lintQuizDefinition — warnings, one case per code', () => {
  it('has a case for every warning code', () => {
    expect(Object.keys(WARNING_CASES).sort()).toEqual([...QUIZ_LINT_WARNING_CODES].sort());
  });

  for (const code of QUIZ_LINT_WARNING_CODES) {
    it(`reports ${code} without blocking`, () => {
      const def = WARNING_CASES[code]();
      const { errors, warnings } = lintQuizDefinition(
        def,
        code === 'widget_language_incomplete' ? { widgetLanguage: 'pl' } : {},
      );
      expect(codes(warnings)).toContain(code);
      if (code !== 'widget_language_incomplete' && code !== 'unreachable_archetype') {
        // none of these warning fixtures introduce an error
        expect(errors.filter((e) => e.code !== 'orphan_question')).toEqual([]);
      }
    });
  }

  it('does not warn about the five trait-only ids but does about a dropped result', () => {
    const { warnings } = lintQuizDefinition(WARNING_CASES.unreachable_archetype());
    const unreachable = warnings.filter((w) => w.code === 'unreachable_archetype');
    expect(unreachable.map((w) => w.message)).toEqual(['no path resolves to "student_parent"']);
  });

  it('exempts the root "not sure" answer from neutral_terminal_answer', () => {
    const { warnings } = lintQuizDefinition(v2());
    expect(codes(warnings)).not.toContain('neutral_terminal_answer');
    const flagged = lintQuizDefinition(WARNING_CASES.neutral_terminal_answer()).warnings.find(
      (w) => w.code === 'neutral_terminal_answer',
    );
    expect(flagged?.path).toEqual(['questions', 1, 'answers', 0]);
  });

  it('flags a negative weight as out of range', () => {
    const def = v2();
    const first = question(def, 'q_home').answers[0];
    if (!first) throw new Error('fixture');
    first.weights = { first_time_buyer: -1 };
    const w = lintQuizDefinition(def).warnings.filter((x) => x.code === 'weight_out_of_range');
    expect(w).toHaveLength(1);
    expect(w[0]?.path).toEqual(['questions', 1, 'answers', 0, 'weights', 'first_time_buyer']);
  });

  it('only checks the widget language when one is given, and not for en', () => {
    const def = WARNING_CASES.widget_language_incomplete();
    expect(codes(lintQuizDefinition(def).warnings)).not.toContain('widget_language_incomplete');
    expect(codes(lintQuizDefinition(def, { widgetLanguage: 'en' }).warnings)).not.toContain(
      'widget_language_incomplete',
    );
    expect(codes(lintQuizDefinition(v2(), { widgetLanguage: 'es' }).warnings)).toContain(
      'widget_language_incomplete',
    );
  });

  it('reports the argmax tie once per terminal answer', () => {
    const def = v2();
    const first = question(def, 'q_home').answers[0];
    if (!first) throw new Error('fixture');
    first.weights = { first_time_buyer: 1, family_buyer: 1 };
    const ties = lintQuizDefinition(def).warnings.filter((w) => w.code === 'argmax_tie');
    expect(ties).toHaveLength(1);
    expect(ties[0]?.message).toContain('family_buyer / first_time_buyer');
  });
});

// ─── authoring vs serve ──────────────────────────────────────────────────────

describe('QuizDefinitionAuthoringSchema vs QuizDefinitionSchema', () => {
  it('rejects a definition with a missing PL label (error, not warning)', () => {
    const def = v2();
    const first = question(def, 'q_home').answers[0];
    if (!first) throw new Error('fixture');
    delete first.label_i18n.pl;
    const parsed = QuizDefinitionAuthoringSchema.safeParse(def);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain(
      'questions.1.answers.0.label_i18n.pl',
    );
  });

  it('still serves a stored blob that violates only authoring rules', () => {
    const blobs: QuizDefinition[] = [
      ERROR_CASES.missing_translation(),
      ERROR_CASES.empty_label(),
      ERROR_CASES.label_too_long(),
      ERROR_CASES.multi_question_invalid(),
      ERROR_CASES.confirm_missing_name(),
      ERROR_CASES.confirm_missing_sentence(),
      ERROR_CASES.orphan_question(),
      ERROR_CASES.duplicate_answer_id(),
      ERROR_CASES.too_many_questions(),
      ERROR_CASES.answers_out_of_range(),
      ERROR_CASES.depth_exceeded(),
      ERROR_CASES.too_many_paths(),
      ERROR_CASES.confirm_missing(),
      ERROR_CASES.confirm_alternative_unnamed(),
      ERROR_CASES.confirm_alternative_duplicate(),
      ERROR_CASES.languages_incomplete(),
      ERROR_CASES.invalid_question_kind(),
      ERROR_CASES.invalid_trait_list(),
    ];
    for (const blob of blobs) {
      expect(QuizDefinitionSchema.safeParse(blob).success).toBe(true);
      expect(QuizDefinitionAuthoringSchema.safeParse(blob).success).toBe(false);
    }
  });

  it('keeps the serve rules inside the authoring schema (unknown archetype, dangling next)', () => {
    const def = v2();
    const first = question(def, 'q_home').answers[0];
    if (!first) throw new Error('fixture');
    first.weights = { not_an_archetype: 1 };
    first.next = 'nowhere';
    const parsed = QuizDefinitionAuthoringSchema.safeParse(def);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const messages = parsed.error.issues.map((i) => i.message).join('\n');
    expect(messages).toContain('unknown archetype id "not_an_archetype"');
    expect(messages).toContain('unknown question id "nowhere"');
  });
});
