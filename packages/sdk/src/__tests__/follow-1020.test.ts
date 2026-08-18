/**
 * FOLLOW-1020 — the quiz completion ping reports the walk, not only the leaf.
 *
 * The defect: `postQuizCompletionPing` sent `{ session_id, resolved_archetype, language }`
 * and nothing else, while `quiz_completions` has carried `branch` / `q1_answer` /
 * `q2_answer` / `q3_answer` since migration 0022 and the staff viewer renders them. A real
 * Investment → Rental → Steady walk therefore displayed as "neutral (Q1 skip)" with three
 * em-dashes, and the Branch Split card counted it as a skip (2026-08-17 audit).
 *
 * These tests drive the REAL exported functions — the widget walker and the real ping — so
 * they fail if either end of the contract is reverted, not only if a helper changes shape.
 *
 * @module packages/sdk/src/__tests__/follow-1020.test
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postQuizCompletionPing } from '../core/adapt.js';
import type { QuizAnswerPath } from '../core/adapt.js';
import { DEFAULT_QUIZ_DEFINITION, renderQuizWidget } from '../ui/quiz-widget.js';
import type { QuizResolvedArchetype } from '../ui/quiz-widget.js';
import type { SdkConfig } from '../core/config.js';

const SESSION_ID = 'a'.repeat(64);

const BASE_CONFIG: SdkConfig = {
  apiKey: 'test-follow1020-api-key',
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  tier: 'observer',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#6c5ce7',
  decisionApiUrl: 'https://api.example.com/api',
  tenantId: '550e8400-e29b-41d4-a716-446655440000',
};

/** Read the JSON body of the single fetch the ping issued. */
function pingBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls[0] as [string, RequestInit] | undefined;
  const body = call?.[1].body;
  if (typeof body !== 'string') throw new Error('ping body was not a JSON string');
  return JSON.parse(body) as Record<string, unknown>;
}

describe('postQuizCompletionPing — answer path (FOLLOW-1020)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends branch + q1..q3 + the full ordered path for a three-question walk', async () => {
    const path: QuizAnswerPath = {
      question_ids: ['q1_gate', 'inwestor_q2', 'inwestor_q3'],
      answer_indexes: [0, 0, 1],
    };
    postQuizCompletionPing(BASE_CONFIG, SESSION_ID, 'yield_hunter', 'en', false, path);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const body = pingBody(fetchMock);
    // `branch` is the question the ROOT answer led to — the generic form of the old
    // INWESTOR / OWN_USE / CROSS_BORDER split, and the one that survives a tree edit.
    expect(body.branch).toBe('inwestor_q2');
    expect(body.q1_answer).toBe(0);
    expect(body.q2_answer).toBe(0);
    expect(body.q3_answer).toBe(1);
    expect(body.answer_path).toEqual([
      { question_id: 'q1_gate', answer_index: 0 },
      { question_id: 'inwestor_q2', answer_index: 0 },
      { question_id: 'inwestor_q3', answer_index: 1 },
    ]);
  });

  it('a Q1 skip reports a one-entry path and a null branch — not an absent path', async () => {
    const path: QuizAnswerPath = { question_ids: ['q1_gate'], answer_indexes: [3] };
    postQuizCompletionPing(BASE_CONFIG, SESSION_ID, 'neutral', 'en', false, path);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const body = pingBody(fetchMock);
    expect(body.branch).toBeNull();
    expect(body.q1_answer).toBe(3);
    expect(body.q2_answer).toBeNull();
    // This is what separates a genuine skip from a legacy row at the storage layer.
    expect(body.answer_path).toEqual([{ question_id: 'q1_gate', answer_index: 3 }]);
  });

  it('omits every path field when no path is reported, rather than defaulting them', async () => {
    postQuizCompletionPing(BASE_CONFIG, SESSION_ID, 'yield_hunter', 'en', false);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const body = pingBody(fetchMock);
    expect(body).not.toHaveProperty('answer_path');
    expect(body).not.toHaveProperty('branch');
    expect(body).not.toHaveProperty('q1_answer');
  });
});

describe('renderQuizWidget — reports the walk it took (FOLLOW-1020)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** Click the answer at `index` on the currently rendered question. */
  function answer(root: ShadowRoot, index: number): void {
    const buttons = root.querySelectorAll<HTMLButtonElement>('.estalara-quiz-answer');
    buttons[index]?.click();
    const cta = root.querySelector<HTMLButtonElement>('.estalara-quiz-cta');
    if (cta && !cta.disabled) cta.click();
  }

  it('hands onComplete the question ids and answer indexes it actually visited', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });

    let resolved: QuizResolvedArchetype | null = null;
    let path: QuizAnswerPath | null = null;
    renderQuizWidget(
      root,
      {
        accentColor: '#6c5ce7',
        language: 'en',
        definition: DEFAULT_QUIZ_DEFINITION,
      },
      (r, p) => {
        resolved = r;
        path = p;
      },
      () => {
        /* dismissed */
      },
    );

    // "Just browsing" is the root's fourth answer and is itself a leaf.
    answer(root, 3);

    expect(resolved).toBe('neutral');
    expect(path).not.toBeNull();
    const walked = path as unknown as QuizAnswerPath;
    expect(walked.question_ids).toEqual(['q1_gate']);
    expect(walked.answer_indexes).toEqual([3]);
    // The arrays pair positionally — a length mismatch would silently misattribute answers.
    expect(walked.question_ids).toHaveLength(walked.answer_indexes.length);
  });
});
