import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import {
  isQuizDismissed,
  QUIZ_LABELS,
  QUIZ_TRIGGER_DELAY_MS,
  scheduleQuizTrigger,
} from '../ui/quiz-trigger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QUIZ_TRIGGER_DELAY_MS', () => {
  it('is 30 seconds', () => {
    expect(QUIZ_TRIGGER_DELAY_MS).toBe(30_000);
  });
});

describe('scheduleQuizTrigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Default: not dismissed
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls onTrigger after 30s when not dismissed', () => {
    const onTrigger = vi.fn();
    scheduleQuizTrigger(onTrigger);
    expect(onTrigger).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it('does NOT call onTrigger when quiz is dismissed (24h cooldown)', () => {
    const recentTs = Date.now() - 60 * 1000; // 1 minute ago
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => String(recentTs)),
      setItem: vi.fn(),
    });
    const onTrigger = vi.fn();
    scheduleQuizTrigger(onTrigger);
    vi.advanceTimersByTime(60_000);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('cancel function prevents trigger from firing', () => {
    const onTrigger = vi.fn();
    const cancel = scheduleQuizTrigger(onTrigger);
    cancel();
    vi.advanceTimersByTime(60_000);
    expect(onTrigger).not.toHaveBeenCalled();
  });
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

  it('en trigger contains "match"', () => {
    // v2: no longer references "2 questions" — shorter label (FOLLOW-199)
    expect(QUIZ_LABELS.en.trigger).toContain('match');
  });

  it('pl trigger contains "dopasowanie"', () => {
    // v2: no longer references "2 pytaniach" — shorter label (FOLLOW-199)
    expect(QUIZ_LABELS.pl.trigger).toContain('dopasowanie');
  });
});
