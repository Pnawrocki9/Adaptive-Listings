import { describe, expect, it, vi, afterEach } from 'vitest';

import { isQuizDismissed, QUIZ_LABELS } from '../ui/quiz-trigger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isQuizDismissed', () => {
  it('returns false when localStorage is empty', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
    expect(isQuizDismissed()).toBe(false);
  });

  it('returns false when localStorage has an old dismissal (>24h ago)', () => {
    const oldTs = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => String(oldTs)),
      setItem: vi.fn(),
    });
    expect(isQuizDismissed()).toBe(false);
  });

  it('returns true when localStorage has a recent dismissal (<24h ago)', () => {
    const recentTs = Date.now() - 60 * 1000; // 1 minute ago
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => String(recentTs)),
      setItem: vi.fn(),
    });
    expect(isQuizDismissed()).toBe(true);
  });

  it('returns false when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => {
        throw new Error('storage unavailable');
      }),
    });
    expect(isQuizDismissed()).toBe(false);
  });
});

describe('QUIZ_LABELS', () => {
  it('has both en and pl keys', () => {
    expect(QUIZ_LABELS).toHaveProperty('en');
    expect(QUIZ_LABELS).toHaveProperty('pl');
  });

  it('en labels have trigger and dismiss', () => {
    expect(QUIZ_LABELS.en.trigger).toBeTruthy();
    expect(QUIZ_LABELS.en.dismiss).toBeTruthy();
  });

  it('pl labels have trigger and dismiss', () => {
    expect(QUIZ_LABELS.pl.trigger).toBeTruthy();
    expect(QUIZ_LABELS.pl.dismiss).toBeTruthy();
  });

  it('en trigger contains "2 questions"', () => {
    expect(QUIZ_LABELS.en.trigger).toContain('2 questions');
  });

  it('pl trigger contains "2 pytaniach"', () => {
    expect(QUIZ_LABELS.pl.trigger).toContain('2 pytaniach');
  });
});
