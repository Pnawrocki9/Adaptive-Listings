/**
 * Quiz interaction events. Emitted by the SDK quiz widget after a user answers the
 * intent-clarification quiz (shown after 3+ listing views).
 *
 * @module @estalara/shared/schemas/events/quiz
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * Quiz answer shape — mirrors the QuizAnswers type in the SDK quiz widget.
 * Using z.string() for forward-compat as answer options may expand.
 */
const QuizAnswersSchema = z.object({
  purpose: z.string().min(1),
  horizon: z.string().min(1),
});

/**
 * `quiz.event` — the user completed the quiz widget.
 *
 * Emitted by: packages/sdk/src/index.ts (quiz onComplete callback)
 *
 * @example
 * {
 *   type: 'quiz.event',
 *   payload: {
 *     step: 'completed',
 *     answers: { purpose: 'investment', horizon: '12m' },
 *     trigger: 'prompt_after_3_listings',
 *     archetype: 'yield_hunter',
 *     confidence: 0.87
 *   }
 * }
 */
export const QuizEventPayloadSchema = z.object({
  /** Which step of the quiz this event covers. */
  step: z.string().min(1),
  /** User-provided answers. */
  answers: QuizAnswersSchema.optional(),
  /** What triggered the quiz to appear. */
  trigger: z.string().min(1).optional(),
  /** Archetype inferred after applying the quiz prior. */
  archetype: z.string().min(1).optional(),
  /** Confidence level after quiz prior application (0–1). */
  confidence: z.number().min(0).max(1).optional(),
  /**
   * Micro-poll question key (e.g. 'purpose_investment') when trigger='micro_poll'.
   * Omitted for standard quiz events (FOLLOW-209).
   */
  micro_poll_question: z.string().optional(),
  /**
   * Micro-poll answer when trigger='micro_poll'.
   * 'yes' or 'no' — omitted for standard quiz events (FOLLOW-209).
   */
  micro_poll_answer: z.enum(['yes', 'no']).optional(),
});
export const QuizEventEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('quiz.event'),
  payload: QuizEventPayloadSchema,
});
export type QuizEventEvent = z.infer<typeof QuizEventEventSchema>;
export type QuizEventPayload = z.infer<typeof QuizEventPayloadSchema>;

/**
 * `quiz.mismatch` — the archetype inferred from the quiz conflicts with the
 * archetype inferred from prior behavioral signals. Feeds the mismatch-detection
 * model in the intent engine.
 *
 * Emitted by: packages/sdk/src/index.ts (after quiz completion, only when
 * detectMismatch() returns a non-null result)
 *
 * @example
 * {
 *   type: 'quiz.mismatch',
 *   payload: {
 *     quiz_archetype: 'yield_hunter',
 *     behavioral_archetype: 'family_comfort',
 *     confidence_gap: 0.43,
 *     signal_count: 12
 *   }
 * }
 */
export const QuizMismatchPayloadSchema = z.object({
  /** Archetype reported by the quiz. */
  quiz_archetype: z.string().min(1),
  /** Archetype inferred from behavioral signals only (pre-quiz). */
  behavioral_archetype: z.string().min(1),
  /** Absolute difference in confidence between the two archetypes (0–1). */
  confidence_gap: z.number().min(0).max(1),
  /** Number of behavioral signals accumulated before the quiz was shown. */
  signal_count: z.number().int().nonnegative(),
});
export const QuizMismatchEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('quiz.mismatch'),
  payload: QuizMismatchPayloadSchema,
});
export type QuizMismatchEvent = z.infer<typeof QuizMismatchEventSchema>;
export type QuizMismatchPayload = z.infer<typeof QuizMismatchPayloadSchema>;
