/**
 * FOLLOW-1362 C4 - pure text helpers behind the completions viewer and the quiz analytics tab.
 *
 * @module apps/control-plane/src/lib/quiz-text.test
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_QUIZ_DEFINITION_V2 } from '@estalara/shared';
import { archetypeLabel, branchLabels, describePath, pendingQuestion } from './quiz-text';

const DEF = DEFAULT_QUIZ_DEFINITION_V2;

describe('describePath', () => {
  it('returns null for a path that was never reported or is not a path', () => {
    expect(describePath(DEF, null)).toBeNull();
    expect(describePath(DEF, 'x')).toBeNull();
    expect(describePath(DEF, [{ nope: 1 }])).toBeNull();
  });

  it('gives EN text with PL beside it, and null for an index the definition no longer has', () => {
    const steps = describePath(DEF, [
      { question_id: 'q_purpose', answer_index: 0 },
      { question_id: 'gone_question', answer_index: 1 },
      { question_id: 'q_purpose', answer_index: 99 },
    ]);
    expect(steps?.[0]?.prompt).toEqual({
      en: 'What will this property be for?',
      pl: 'Do czego ma służyć ta nieruchomość?',
    });
    expect(steps?.[0]?.answers[0]?.label?.en).toBe('My main home, in the country where I live now');
    expect(steps?.[1]?.prompt).toBeNull();
    expect(steps?.[1]?.answers[0]?.label).toBeNull();
    expect(steps?.[2]?.answers[0]).toEqual({ index: 99, label: null });
  });

  it('lists every chosen trait of a multi step, and keeps an empty selection empty', () => {
    const steps = describePath(DEF, [
      { question_id: 't_second', answer_indexes: [0, 2] },
      { question_id: 't_second', answer_indexes: [] },
    ]);
    expect(steps?.[0]?.answers).toHaveLength(2);
    expect(steps?.[0]?.answers.every((a) => a.label !== null)).toBe(true);
    expect(steps?.[1]?.answers).toEqual([]);
  });
});

describe('archetypeLabel / branchLabels', () => {
  it('names an archetype from the confirmation block, null when it has no name', () => {
    expect(archetypeLabel(DEF, 'yield_hunter')?.en).toBe('Long-term rental investment');
    expect(archetypeLabel(DEF, 'not_an_archetype')).toBeNull();
  });

  it('joins several root answers that lead into the same question', () => {
    const def = {
      ...DEF,
      questions: DEF.questions.map((q) =>
        q.id === DEF.root
          ? {
              ...q,
              answers: q.answers.map((a) => (a.next === 'q_move' ? { ...a, next: 'q_home' } : a)),
            }
          : q,
      ),
    };
    const labels = branchLabels(def);
    expect(labels.q_move).toBeUndefined();
    expect(labels.q_home?.en).toContain(' / ');
    expect(labels.q_home?.pl).toContain(' / ');
  });
});

describe('pendingQuestion', () => {
  it('is the root with no path at step 0, and unknown without a path elsewhere', () => {
    expect(pendingQuestion(DEF, null, 0)?.id).toBe(DEF.root);
    expect(pendingQuestion(DEF, null, 2)).toBeNull();
  });

  it('replays the recorded path to the next unanswered question', () => {
    const q = pendingQuestion(DEF, [{ question_id: 'q_purpose', answer_index: 0 }], 1);
    expect(q?.id).toBe('q_home');
    expect(q?.prompt.en.length).toBeGreaterThan(0);
  });
});
