/**
 * Quiz authoring lint — errors that block a save and warnings that never do
 * (MASTER_DESIGN §E.4.9 v3.0, FOLLOW-1356).
 *
 * Two validation levels, deliberately separate:
 *   - SERVE: `QuizDefinitionSchema` (`presentation-config.ts`). `GET /api/quiz/public-config`
 *     re-parses the stored row with it and DROPS the slice on failure (buyers then fall back to
 *     the default tree), so it stays lenient: structure, canonical ids, `confirm` key shape.
 *   - AUTHORING: `QuizDefinitionAuthoringSchema` below = the serve schema PLUS the errors
 *     `lintQuizDefinition` reports (EN + PL on every text, `multi` question shape, `confirm`
 *     completeness, size limits). The control-plane PUT, the editor Save and import use it
 *     (FOLLOW-1362 / Q7). A blob that violates only authoring rules still parses with the serve
 *     schema, so tightening these rules can never knock a stored definition out of service.
 *
 * `lintQuizDefinition` takes a structurally valid `QuizDefinition` and does not repeat the
 * serve-schema rules; it is draft-safe (dangling `next`, cycles) because the authoring schema
 * runs it even when the serve rules have already flagged the same draft.
 *
 * Every issue is `{ code, path, message }`; codes are stable snake_case strings listed in
 * `QUIZ_LINT_ERROR_CODES` / `QUIZ_LINT_WARNING_CODES`.
 *
 * @module @estalara/shared/schemas/quiz-lint
 */

import { z } from 'zod';

import { CANONICAL_ARCHETYPE_IDS } from '../archetypes.js';
import { isTraitId } from '../traits.js';
import type { QuizLanguage } from './quiz-config.js';
import {
  QuizDefinitionSchema,
  computeAmbiguousPaths,
  computeUnreachableArchetypes,
  type LabelI18n,
  type QuizDefinition,
} from './presentation-config.js';
import { enumerateQuizPaths, longestPathFrom } from './quiz-walk.js';

/** Languages every text must carry (CEO ruling Q-D, MASTER_DESIGN §E.4.7). */
export const REQUIRED_QUIZ_LANGUAGES = ['en', 'pl'] as const satisfies readonly QuizLanguage[];

/** Authoring limits (MASTER_DESIGN §E.4.9). */
export const QUIZ_AUTHORING_LIMITS = {
  maxQuestions: 40,
  minAnswers: 2,
  maxAnswers: 8,
  maxDepth: 6,
  maxPaths: 2000,
  maxLabelLength: 160,
  maxWeight: 10,
} as const;

/** Stable codes of the lint ERRORS (they block a save). */
export const QUIZ_LINT_ERROR_CODES = [
  'orphan_question',
  'duplicate_answer_id',
  'too_many_questions',
  'answers_out_of_range',
  'depth_exceeded',
  'too_many_paths',
  'missing_translation',
  'empty_label',
  'label_too_long',
  'multi_question_invalid',
  'confirm_missing_name',
  'confirm_missing_sentence',
  'confirm_missing',
  'confirm_alternative_unnamed',
  'confirm_alternative_duplicate',
  'languages_incomplete',
  'invalid_question_kind',
  'invalid_trait_list',
] as const;

/** Stable codes of the lint WARNINGS (they never block a save). */
export const QUIZ_LINT_WARNING_CODES = [
  'unreachable_archetype',
  'argmax_tie',
  'weight_out_of_range',
  'duplicate_label',
  'neutral_terminal_answer',
  'widget_language_incomplete',
  'ambiguous_path',
  'confirm_missing_alternatives',
] as const;

/** A lint error code. */
export type QuizLintErrorCode = (typeof QUIZ_LINT_ERROR_CODES)[number];
/** A lint warning code. */
export type QuizLintWarningCode = (typeof QUIZ_LINT_WARNING_CODES)[number];

/** One lint finding. `path` addresses the offending node of the definition (Zod-style). */
export interface QuizLintIssue<C extends string = string> {
  code: C;
  path: (string | number)[];
  message: string;
}

/** The result of `lintQuizDefinition`. */
export interface QuizLintResult {
  errors: QuizLintIssue<QuizLintErrorCode>[];
  warnings: QuizLintIssue<QuizLintWarningCode>[];
}

/** Options of `lintQuizDefinition`. */
export interface QuizLintOptions {
  /**
   * The tenant's widget language (`quiz_config.language`). When it is not `en` and the
   * definition lacks texts in it, a `widget_language_incomplete` warning is added (the widget
   * would show the English fallback). Omit to skip the check.
   */
  widgetLanguage?: QuizLanguage;
}

/**
 * True when a cycle is reachable from the root (iterative three-colour DFS). Dangling `next`
 * references are ignored. The serve schema already rejects a cycle; lint uses this to skip the
 * path enumeration, which is exponential in visits on a cyclic draft.
 */
function hasCycleFromRoot(def: QuizDefinition): boolean {
  const byId = new Map(def.questions.map((q) => [q.id, q]));
  const colour = new Map<string, 1 | 2>(); // 1 = on the stack, 2 = finished
  const stack: { id: string; next: number }[] = [];
  if (byId.has(def.root)) stack.push({ id: def.root, next: 0 });
  if (byId.has(def.root)) colour.set(def.root, 1);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (!frame) break;
    const answers = byId.get(frame.id)?.answers ?? [];
    const target = answers[frame.next]?.next;
    frame.next += 1;
    if (frame.next > answers.length) {
      colour.set(frame.id, 2);
      stack.pop();
    } else if (typeof target === 'string' && byId.has(target)) {
      const seen = colour.get(target);
      if (seen === 1) return true;
      if (seen === undefined) {
        colour.set(target, 1);
        stack.push({ id: target, next: 0 });
      }
    }
  }
  return false;
}

/** A text bag in the definition together with where it lives. */
interface TextRef {
  path: (string | number)[];
  bag: LabelI18n;
}

function collectTexts(def: QuizDefinition): TextRef[] {
  const refs: TextRef[] = [];
  def.questions.forEach((q, qi) => {
    refs.push({ path: ['questions', qi, 'prompt_i18n'], bag: q.prompt_i18n });
    q.answers.forEach((a, ai) => {
      refs.push({ path: ['questions', qi, 'answers', ai, 'label_i18n'], bag: a.label_i18n });
    });
  });
  if (def.confirm) {
    for (const [id, bag] of Object.entries(def.confirm.names_i18n)) {
      refs.push({ path: ['confirm', 'names_i18n', id], bag });
    }
    for (const [id, bag] of Object.entries(def.confirm.sentences_i18n)) {
      refs.push({ path: ['confirm', 'sentences_i18n', id], bag });
    }
  }
  return refs;
}

/**
 * Lint a quiz definition: authoring errors (block a save) and warnings (informational).
 *
 * Errors: `orphan_question`, `duplicate_answer_id`, `too_many_questions` (> 40),
 * `answers_out_of_range` (not 2–8), `depth_exceeded` (> 6), `too_many_paths` (> 2000),
 * `missing_translation` (EN or PL absent), `empty_label` (blank text in any language),
 * `label_too_long` (> 160 characters), `multi_question_invalid` (a `multi` answer with weights
 * or a `next`), `confirm_missing_name` / `confirm_missing_sentence` (a reachable non-neutral
 * archetype without a confirmation name / sentence), `confirm_missing` (no `confirm` block at
 * all — a tenant must not be able to silently drop the confirmation and with it the accuracy
 * metric), `confirm_alternative_unnamed` (an alternative without an EN + PL name),
 * `confirm_alternative_duplicate`, `languages_incomplete` (`languages` lacks `en` or `pl`),
 * `invalid_question_kind`, `invalid_trait_list` (unknown trait, more than 4, or a repeat).
 *
 * A cyclic draft (already rejected by the serve schema) skips every path-based check.
 *
 * Warnings: `unreachable_archetype` (outside the allow-list), `argmax_tie`,
 * `weight_out_of_range` (negative or > 10), `duplicate_label`, `neutral_terminal_answer`
 * (a non-root terminal answer resolving to `neutral`), `widget_language_incomplete`,
 * `ambiguous_path`, `confirm_missing_alternatives`.
 *
 * @param def - a structurally valid definition (or a draft that already passed the serve schema).
 * @param options - see `QuizLintOptions`.
 */
export function lintQuizDefinition(
  def: QuizDefinition,
  options: QuizLintOptions = {},
): QuizLintResult {
  const errors: QuizLintResult['errors'] = [];
  const warnings: QuizLintResult['warnings'] = [];
  const error = (code: QuizLintErrorCode, path: (string | number)[], message: string) => {
    errors.push({ code, path, message });
  };
  const warn = (code: QuizLintWarningCode, path: (string | number)[], message: string) => {
    warnings.push({ code, path, message });
  };
  const limits = QUIZ_AUTHORING_LIMITS;

  // ── Structure ────────────────────────────────────────────────────────────────
  if (def.questions.length > limits.maxQuestions) {
    error(
      'too_many_questions',
      ['questions'],
      `${String(def.questions.length)} questions — the limit is ${String(limits.maxQuestions)}`,
    );
  }

  const byId = new Map(def.questions.map((q) => [q.id, q]));
  const reachable = new Set<string>();
  const queue: string[] = byId.has(def.root) ? [def.root] : [];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || reachable.has(id)) continue;
    reachable.add(id);
    for (const ans of byId.get(id)?.answers ?? []) {
      if (ans.next !== null && byId.has(ans.next)) queue.push(ans.next);
    }
  }

  def.questions.forEach((q, qi) => {
    if (!reachable.has(q.id)) {
      error(
        'orphan_question',
        ['questions', qi],
        `question "${q.id}" cannot be reached from the root "${def.root}"`,
      );
    }
    if (q.answers.length < limits.minAnswers || q.answers.length > limits.maxAnswers) {
      error(
        'answers_out_of_range',
        ['questions', qi, 'answers'],
        `question "${q.id}" has ${String(q.answers.length)} answers — allowed ${String(limits.minAnswers)}–${String(limits.maxAnswers)}`,
      );
    }
    const seenAnswerIds = new Set<string>();
    q.answers.forEach((a, ai) => {
      if (seenAnswerIds.has(a.id)) {
        error(
          'duplicate_answer_id',
          ['questions', qi, 'answers', ai, 'id'],
          `answer id "${a.id}" is used twice in question "${q.id}"`,
        );
      }
      seenAnswerIds.add(a.id);
      if (q.kind === 'multi' && (Object.keys(a.weights).length > 0 || a.next !== null)) {
        error(
          'multi_question_invalid',
          ['questions', qi, 'answers', ai],
          `answer "${a.id}" of the multi question "${q.id}" must have empty weights and next: null`,
        );
      }
    });
  });

  if (byId.has(def.root) && longestPathFrom(def, def.root) > limits.maxDepth) {
    error(
      'depth_exceeded',
      ['root'],
      `a path is more than ${String(limits.maxDepth)} questions deep`,
    );
  }

  // A cyclic draft is rejected by the serve schema already; enumerating its paths would burn
  // time (exponential visits) for nothing, so every path-based check is skipped for it.
  const cyclic = hasCycleFromRoot(def);
  const { paths, truncated } = cyclic
    ? { paths: [] as ReturnType<typeof enumerateQuizPaths>['paths'], truncated: false }
    : enumerateQuizPaths(def);
  if (paths.length > limits.maxPaths || truncated) {
    error(
      'too_many_paths',
      ['questions'],
      `more than ${String(limits.maxPaths)} root-to-leaf paths — simplify the tree`,
    );
  }

  // ── Texts: EN + PL mandatory, non-empty, ≤ 160 characters ────────────────────
  for (const ref of collectTexts(def)) {
    for (const lang of REQUIRED_QUIZ_LANGUAGES) {
      if (ref.bag[lang] === undefined) {
        error(
          'missing_translation',
          [...ref.path, lang],
          `missing ${lang.toUpperCase()} text (EN and PL are both required)`,
        );
      }
    }
    for (const [lang, text] of Object.entries(ref.bag)) {
      if (text.trim() === '') {
        error('empty_label', [...ref.path, lang], `empty ${lang.toUpperCase()} text`);
      } else if (text.length > limits.maxLabelLength) {
        error(
          'label_too_long',
          [...ref.path, lang],
          `${lang.toUpperCase()} text is ${String(text.length)} characters — the limit is ${String(limits.maxLabelLength)}`,
        );
      }
    }
  }

  // ── Languages, question kinds, trait lists ───────────────────────────────────
  for (const lang of REQUIRED_QUIZ_LANGUAGES) {
    if (!def.languages.includes(lang)) {
      error(
        'languages_incomplete',
        ['languages'],
        `"languages" must include ${lang.toUpperCase()} (EN and PL are both required)`,
      );
    }
  }
  def.questions.forEach((q, qi) => {
    if (q.kind !== undefined && q.kind !== 'single' && q.kind !== 'multi') {
      error(
        'invalid_question_kind',
        ['questions', qi, 'kind'],
        `question "${q.id}" has kind "${q.kind}" — allowed: single, multi`,
      );
    }
    q.answers.forEach((a, ai) => {
      const traits = a.traits ?? [];
      const unknown = traits.filter((t) => !isTraitId(t));
      if (unknown.length > 0 || traits.length > 4 || new Set(traits).size !== traits.length) {
        error(
          'invalid_trait_list',
          ['questions', qi, 'answers', ai, 'traits'],
          unknown.length > 0
            ? `unknown trait(s): ${unknown.join(', ')}`
            : 'traits must be at most 4 and must not repeat',
        );
      }
    });
  });

  // ── Confirmation completeness ────────────────────────────────────────────────
  const reachableLeaves = new Set<string>(paths.map((p) => p.leaf));
  if (!def.confirm) {
    error(
      'confirm_missing',
      ['confirm'],
      'a confirm block is required — every non-neutral result needs a confirmation screen',
    );
  } else {
    const named = (id: string): boolean => {
      const bag = def.confirm?.names_i18n[id];
      return REQUIRED_QUIZ_LANGUAGES.every((lang) => (bag?.[lang] ?? '').trim() !== '');
    };
    for (const [id, alts] of Object.entries(def.confirm.alternatives)) {
      const seen = new Set<string>();
      alts.forEach((alt, i) => {
        if (seen.has(alt)) {
          error(
            'confirm_alternative_duplicate',
            ['confirm', 'alternatives', id, i],
            `"${alt}" is listed twice in the alternatives of "${id}"`,
          );
        }
        seen.add(alt);
        if (!named(alt)) {
          error(
            'confirm_alternative_unnamed',
            ['confirm', 'alternatives', id, i],
            `alternative "${alt}" of "${id}" has no EN + PL name in confirm.names_i18n`,
          );
        }
      });
    }
    for (const id of CANONICAL_ARCHETYPE_IDS) {
      if (id === 'neutral' || !reachableLeaves.has(id)) continue;
      if (!def.confirm.names_i18n[id]) {
        error(
          'confirm_missing_name',
          ['confirm', 'names_i18n', id],
          `reachable result "${id}" has no confirmation name`,
        );
      }
      if (!def.confirm.sentences_i18n[id]) {
        error(
          'confirm_missing_sentence',
          ['confirm', 'sentences_i18n', id],
          `reachable result "${id}" has no confirmation sentence`,
        );
      }
      if (!def.confirm.alternatives[id]) {
        warn(
          'confirm_missing_alternatives',
          ['confirm', 'alternatives', id],
          `reachable result "${id}" has no correction alternatives ("Not quite" would offer none)`,
        );
      }
    }
  }

  // ── Warnings ─────────────────────────────────────────────────────────────────
  for (const id of cyclic ? [] : computeUnreachableArchetypes(def)) {
    warn('unreachable_archetype', ['questions'], `no path resolves to "${id}"`);
  }

  const warned = new Set<string>();
  const warnOnce = (
    key: string,
    code: QuizLintWarningCode,
    path: (string | number)[],
    message: string,
  ) => {
    if (warned.has(key)) return;
    warned.add(key);
    warn(code, path, message);
  };
  /**
   * The question/answer indexes of a path's last single (non-trait-screen) step.
   */
  const terminalOf = (path: (typeof paths)[number]): { qi: number; ai: number } | null => {
    let i = path.selections.length - 1;
    while (i >= 0 && Array.isArray(path.selections[i])) i -= 1;
    const sel = path.selections[i];
    const qid = path.questionIds[i];
    if (typeof sel !== 'number' || qid === undefined) return null;
    const qi = def.questions.findIndex((q) => q.id === qid);
    return qi < 0 ? null : { qi, ai: sel };
  };

  for (const path of paths) {
    const terminal = terminalOf(path);
    const where = terminal ? ['questions', terminal.qi, 'answers', terminal.ai] : ['questions'];
    const whereKey = where.join('.');

    // argmax tie among the positive canonical weights
    let top = 0;
    let tied: string[] = [];
    for (const id of CANONICAL_ARCHETYPE_IDS) {
      if (id === 'neutral') continue;
      const w = path.weights[id] ?? 0;
      if (w > top) {
        top = w;
        tied = [id];
      } else if (w > 0 && w === top) {
        tied.push(id);
      }
    }
    if (tied.length > 1) {
      warnOnce(
        `tie:${whereKey}:${tied.join(',')}`,
        'argmax_tie',
        where,
        `${tied.join(' / ')} tie on weight ${String(top)}; the earliest in canonical order wins`,
      );
    }

    // a terminal answer (not under the root question) that resolves to neutral; the root
    // "not sure" answer is the intended skip and is exempt
    if (terminal && path.leaf === 'neutral') {
      const q = def.questions[terminal.qi];
      if (q && q.id !== def.root) {
        warnOnce(
          `neutral:${whereKey}`,
          'neutral_terminal_answer',
          where,
          `a path ending at answer "${q.answers[terminal.ai]?.id ?? ''}" of "${q.id}" resolves to neutral`,
        );
      }
    }
  }

  def.questions.forEach((q, qi) => {
    q.answers.forEach((a, ai) => {
      for (const [archetypeId, weight] of Object.entries(a.weights)) {
        if (weight < 0 || weight > limits.maxWeight) {
          warn(
            'weight_out_of_range',
            ['questions', qi, 'answers', ai, 'weights', archetypeId],
            `weight ${String(weight)} for "${archetypeId}" is outside 0–${String(limits.maxWeight)}`,
          );
        }
      }
    });
    const seen = new Map<string, string>();
    q.answers.forEach((a, ai) => {
      for (const [lang, text] of Object.entries(a.label_i18n)) {
        const key = `${lang}:${text.trim().toLowerCase()}`;
        if (text.trim() === '') continue;
        const first = seen.get(key);
        if (first !== undefined) {
          warn(
            'duplicate_label',
            ['questions', qi, 'answers', ai, 'label_i18n', lang],
            `${lang.toUpperCase()} label "${text}" duplicates answer "${first}" in question "${q.id}"`,
          );
        } else {
          seen.set(key, a.id);
        }
      }
    });
  });

  for (const amb of cyclic ? [] : computeAmbiguousPaths(def)) {
    const lastQuestion = amb.questionIds[amb.questionIds.length - 1] ?? '';
    const qi = def.questions.findIndex((q) => q.id === lastQuestion);
    const lastAnswer = amb.answerIds[amb.answerIds.length - 1] ?? '';
    const ai = def.questions[qi]?.answers.findIndex((a) => a.id === lastAnswer) ?? -1;
    warn(
      'ambiguous_path',
      qi >= 0 && ai >= 0 ? ['questions', qi, 'answers', ai] : ['questions'],
      `path ${amb.answerIds.join(' > ')} adds weight to ${amb.archetypes.join(', ')}`,
    );
  }

  if (options.widgetLanguage && options.widgetLanguage !== 'en') {
    const lang = options.widgetLanguage;
    const missing = collectTexts(def).filter((ref) => (ref.bag[lang] ?? '').trim() === '').length;
    if (missing > 0) {
      warn(
        'widget_language_incomplete',
        ['languages'],
        `the widget language is ${lang.toUpperCase()} but ${String(missing)} text(s) have no ${lang.toUpperCase()} version — buyers would see English`,
      );
    }
  }

  return { errors, warnings };
}

/**
 * The AUTHORING schema: `QuizDefinitionSchema` (the serve schema) plus every error
 * `lintQuizDefinition` reports, as Zod issues with the lint code in `params.lint_code`. Used
 * by the control-plane PUT, the editor Save and JSON import (FOLLOW-1362 / Q7). NEVER used on
 * the serve path — see the module doc.
 *
 * The `@__PURE__` annotation lets a bundler drop this schema, and with it the whole lint, from
 * a consumer that never uses it: the SDK bundle imports `@estalara/shared` and its gzip budget
 * (ESC-028 / ESC-080) must not pay for authoring-only code.
 */
export const QuizDefinitionAuthoringSchema = /* @__PURE__ */ QuizDefinitionSchema.superRefine(
  (def, ctx) => {
    for (const issue of lintQuizDefinition(def).errors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: issue.message,
        path: issue.path,
        params: { lint_code: issue.code },
      });
    }
  },
);
