/**
 * `POST /api/quiz/run` body — one quiz-run lifecycle ping from the SDK quiz widget (ESC-086 item 2,
 * MASTER_DESIGN §E.4.8 v3.0, FOLLOW-1358 / package Q3; the sender is FOLLOW-1357 / package Q2).
 *
 * One quiz shown to one buyer is one run (`quiz_run_id`, a random UUID the SDK draws when the card
 * renders). The SDK pings at each lifecycle step: `shown` on render, `dismissed` (+ `last_step`) on
 * Skip or ×, `completed` at the leaf, then `confirmed` / `corrected` / `unconfirmed` on the
 * confirmation screen. The control plane folds the pings into ONE `quiz_runs` row with a
 * forward-only state machine (`apps/control-plane/src/lib/quiz-runs.ts`).
 *
 * Privacy (ESC-086 privacy check): every field is pseudonymous or a closed list — `session_id` (the
 * random per-tab session UUID v4, Activity 2, ESC-070), a random run UUID, answer INDEXES (never answer text), canonical
 * archetype and trait ids, timings in whole milliseconds (the server rounds them to 100 ms). There is
 * no free-text field: `confirmed_archetype: 'none_of_these'` is an enum value. Unknown keys are
 * stripped (Zod default), so a newer SDK cannot smuggle a field into storage.
 *
 * Required: `quiz_run_id`, `event`, `tenant_id`, `session_id`. Everything else is optional because
 * each step knows a different subset (a `shown` ping has no answers yet).
 *
 * Built behind a `@__PURE__` call: the SDK bundle imports `@estalara/shared` and must not pay for a
 * schema only the control plane parses.
 *
 * Consumer: `apps/control-plane/src/app/api/quiz/run/route.ts` (parses with it) and
 * `apps/control-plane/src/lib/quiz-runs.ts` (`QuizRunPing` type).
 *
 * @module @estalara/shared/schemas/quiz-run
 */

import { z } from 'zod';

import { CANONICAL_ARCHETYPE_IDS } from '../archetypes.js';
import { CANONICAL_TRAIT_IDS } from '../traits.js';
import { ConsentStateSchema } from './event.js';
import { QuizLanguageSchema } from './quiz-config.js';

/** The lifecycle events a quiz-run ping may carry, in state-machine order. */
const QUIZ_RUN_EVENTS = [
  'shown',
  'dismissed',
  'completed',
  'confirmed',
  'corrected',
  'unconfirmed',
] as const;

/** One lifecycle event (= the `quiz_runs.status` it moves the row to). */
export type QuizRunEvent = (typeof QUIZ_RUN_EVENTS)[number];

/** Upper bound of one timing value: 10 minutes (ESC-086 "timings capped"). */
export const QUIZ_RUN_MAX_MS = 600_000;

function buildQuizRunPingSchema() {
  const archetypeId = z.enum(CANONICAL_ARCHETYPE_IDS);
  const ms = z.number().int().min(0).max(QUIZ_RUN_MAX_MS);
  const answerIndex = z.number().int().min(0).max(63);

  /**
   * One step of the walk — the shape of `quiz_completions.answer_path` (`answer_index`), plus
   * `answer_indexes` for a `kind: 'multi'` trait screen. Exactly one of the two is present.
   */
  const answerStep = z
    .object({
      question_id: z.string().min(1).max(128),
      answer_index: answerIndex.optional(),
      answer_indexes: z.array(answerIndex).max(64).optional(),
    })
    .refine((s) => (s.answer_index === undefined) !== (s.answer_indexes === undefined), {
      message: 'exactly one of answer_index / answer_indexes is required',
    });

  return z
    .object({
      quiz_run_id: z.string().uuid(),
      event: z.enum(QUIZ_RUN_EVENTS),
      /** Must equal the tenant of the API key; the server never writes a body-supplied tenant. */
      tenant_id: z.string().uuid(),
      /** The random per-tab session UUID v4 (Activity 2, ESC-070) the completion ping sends. */
      session_id: z.string().min(1).max(512),
      /**
       * The visitor's banner consent state as the SDK knows it. The SDK must ALWAYS send it: the
       * route writes only on `consented` and answers 204 with nothing written when it is absent or
       * anything else, `legitimate-interest` included (FOLLOW-1358 compliance conditions C3/C5).
       * Optional in the schema only so a missing value is a silent 204, not a 400.
       */
      consent_state: ConsentStateSchema.optional(),
      language: QuizLanguageSchema.optional(),
      /** `sha-256` hex of the served definition, or a label (`unhashed`, older `builtin-en-v2`). */
      definition_hash: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
        .optional(),
      /** `quiz_definitions.version` of the served row; `null` for the built-in default. */
      definition_version: z.number().int().min(0).nullable().optional(),
      sdk_version: z
        .string()
        .regex(/^[0-9A-Za-z.+-]{1,64}$/)
        .optional(),
      /** The step (0-based) the buyer was on when the run ended or the ping was sent. */
      last_step: z.number().int().min(0).max(64).optional(),
      resolved_archetype: archetypeId.optional(),
      answer_path: z.array(answerStep).min(1).max(32).optional(),
      traits: z.array(z.enum(CANONICAL_TRAIT_IDS)).max(CANONICAL_TRAIT_IDS.length).optional(),
      /** Time on each question, in walk order. */
      step_ms: z.array(ms).max(40).optional(),
      /** Time on the confirmation screen. */
      result_ms: ms.optional(),
      /** The alternatives offered after "Not quite", in display order. */
      offered: z.array(archetypeId).max(4).optional(),
      /** The leaf (confirmed), the correction target, or `none_of_these` (corrected). */
      confirmed_archetype: z.union([archetypeId, z.literal('none_of_these')]).optional(),
    })
    .refine(
      (p) =>
        p.confirmed_archetype === undefined || p.event === 'confirmed' || p.event === 'corrected',
      {
        message: 'confirmed_archetype is allowed only with event confirmed or corrected',
        path: ['confirmed_archetype'],
      },
    );
}

/** Zod schema of the `POST /api/quiz/run` body. See the module doc. */
export const QuizRunPingSchema = /* @__PURE__ */ buildQuizRunPingSchema();

/** A validated `POST /api/quiz/run` body. */
export type QuizRunPing = z.infer<typeof QuizRunPingSchema>;
