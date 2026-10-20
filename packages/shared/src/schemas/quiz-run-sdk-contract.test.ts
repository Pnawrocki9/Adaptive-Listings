/**
 * FOLLOW-1357 — the SDK side of the ESC-086 contract, pinned in `packages/shared`:
 *   - the run-ping bodies the SDK quiz widget sends at each lifecycle step parse with
 *     `QuizRunPingSchema` (FOLLOW-1358 owns the schema; this pins what the sender relies on:
 *     a trait step as `answer_indexes`, the `builtin-en-v2` / `unhashed` identities, the
 *     `none_of_these` correction);
 *   - the additive `quiz.event` and `intent.snapshot` fields keep their values through parsing.
 */

import { describe, expect, it } from 'vitest';

import { QuizEventPayloadSchema } from './events/quiz.js';
import { IntentSnapshotPayloadSchema } from './events/intent-snapshot.js';
import { QUIZ_RUN_MAX_MS, QuizRunPingSchema } from './quiz-run.js';

const BASE = {
  quiz_run_id: '3f1e2d4c-5b6a-4789-8abc-def012345678',
  tenant_id: '550e8400-e29b-41d4-a716-446655440000',
  session_id: 'a'.repeat(64),
  consent_state: 'consented',
  language: 'pl',
  definition_hash: 'f'.repeat(64),
  definition_version: 3,
  sdk_version: '0.0.0',
} as const;

describe('QuizRunPingSchema accepts every body the SDK widget sends', () => {
  it.each([
    [{ event: 'shown' }],
    [{ event: 'dismissed', last_step: 2 }],
    [
      {
        event: 'completed',
        resolved_archetype: 'family_buyer',
        answer_path: [
          { question_id: 'q_purpose', answer_index: 0 },
          { question_id: 'q_home', answer_index: 1 },
          { question_id: 't_home', answer_indexes: [0, 2] },
        ],
        traits: ['has_children', 'premium'],
        step_ms: [1200, QUIZ_RUN_MAX_MS, 0],
      },
    ],
    [
      {
        event: 'confirmed',
        resolved_archetype: 'yield_hunter',
        confirmed_archetype: 'yield_hunter',
        result_ms: 2400,
      },
    ],
    [
      {
        event: 'corrected',
        resolved_archetype: 'yield_hunter',
        confirmed_archetype: 'none_of_these',
        offered: ['vacation_rental_investor', 'flip_investor', 'student_parent'],
        result_ms: 0,
      },
    ],
    [{ event: 'unconfirmed', resolved_archetype: 'downsizer', result_ms: 100 }],
  ])('%j', (fields) => {
    expect(QuizRunPingSchema.safeParse({ ...BASE, ...fields }).success).toBe(true);
  });

  it('accepts the built-in and unhashed identities with a null version', () => {
    for (const definition_hash of ['builtin-en-v2', 'unhashed']) {
      const body = { ...BASE, event: 'shown', definition_hash, definition_version: null };
      expect(QuizRunPingSchema.safeParse(body).success).toBe(true);
    }
  });

  it('an "None of these" trait step is an empty answer_indexes list', () => {
    const body = {
      ...BASE,
      event: 'completed',
      answer_path: [
        { question_id: 'q_purpose', answer_index: 2 },
        { question_id: 't_second', answer_indexes: [] },
      ],
    };
    expect(QuizRunPingSchema.safeParse(body).success).toBe(true);
  });

  it('rejects confirmed_archetype on an unconfirmed ping (the SDK never sends one)', () => {
    const body = { ...BASE, event: 'unconfirmed', confirmed_archetype: 'downsizer' };
    expect(QuizRunPingSchema.safeParse(body).success).toBe(false);
  });
});

describe('ESC-086 additive event fields', () => {
  it('quiz.event keeps quiz_run_id, resolved_archetype and definition_hash', () => {
    const payload = {
      step: 'unconfirmed',
      archetype: 'downsizer',
      quiz_run_id: BASE.quiz_run_id,
      resolved_archetype: 'downsizer',
      definition_hash: 'builtin-en-v2',
    };
    expect(QuizEventPayloadSchema.parse(payload)).toEqual(payload);
    expect(QuizEventPayloadSchema.safeParse({ step: 'completed' }).success).toBe(true);
  });

  it('intent.snapshot accepts traits and still accepts a payload without them', () => {
    const base = {
      archetype: 'family_buyer',
      confidence: 0.9,
      signal_count: 3,
      probabilities: { family_buyer: 0.9 },
      quiz_completed: true,
      quiz_leaf: 'family_buyer',
      chat_turns: 0,
    };
    expect(IntentSnapshotPayloadSchema.parse({ ...base, traits: ['has_children'] }).traits).toEqual(
      ['has_children'],
    );
    expect(IntentSnapshotPayloadSchema.safeParse(base).success).toBe(true);
  });
});
