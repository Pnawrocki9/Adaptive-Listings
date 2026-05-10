import { describe, expect, it } from 'vitest';

import { QUIZ_CONTENT } from '../ui/quiz-widget.js';
import type { QuizAnswers } from '../ui/quiz-widget.js';

describe('QUIZ_CONTENT', () => {
  it('has both en and pl keys', () => {
    expect(QUIZ_CONTENT).toHaveProperty('en');
    expect(QUIZ_CONTENT).toHaveProperty('pl');
  });

  it('en content has q1 with question and 2 answers', () => {
    expect(QUIZ_CONTENT.en.q1.question).toBeTruthy();
    expect(QUIZ_CONTENT.en.q1.answers).toHaveLength(2);
  });

  it('en content has q2 with question and 2 answers', () => {
    expect(QUIZ_CONTENT.en.q2.question).toBeTruthy();
    expect(QUIZ_CONTENT.en.q2.answers).toHaveLength(2);
  });

  it('en content has cta and skip labels', () => {
    expect(QUIZ_CONTENT.en.cta).toBeTruthy();
    expect(QUIZ_CONTENT.en.skip).toBeTruthy();
  });

  it('pl content has q1 with question and 2 answers', () => {
    expect(QUIZ_CONTENT.pl.q1.question).toBeTruthy();
    expect(QUIZ_CONTENT.pl.q1.answers).toHaveLength(2);
  });

  it('pl content has q2 with question and 2 answers', () => {
    expect(QUIZ_CONTENT.pl.q2.question).toBeTruthy();
    expect(QUIZ_CONTENT.pl.q2.answers).toHaveLength(2);
  });

  it('pl content has cta and skip labels', () => {
    expect(QUIZ_CONTENT.pl.cta).toBeTruthy();
    expect(QUIZ_CONTENT.pl.skip).toBeTruthy();
  });
});

describe('QuizAnswers type', () => {
  it('accepts valid purpose + horizon combinations', () => {
    const a1: QuizAnswers = { purpose: 'personal', horizon: 'short' };
    const a2: QuizAnswers = { purpose: 'investment', horizon: 'long' };
    expect(a1.purpose).toBe('personal');
    expect(a2.purpose).toBe('investment');
    expect(a1.horizon).toBe('short');
    expect(a2.horizon).toBe('long');
  });
});
