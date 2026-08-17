import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  isQuizCompleted,
  isQuizDismissed,
  markQuizCompleted,
  markQuizDismissed,
} from '../ui/quiz-session-state.js';

/**
 * FOLLOW-1015: this file used to be `quiz-trigger.test.ts` and covered the sticky
 * "Find your match →" button plus its 30s `scheduleQuizTrigger` timer. Both are gone — the quiz
 * card opens by itself. What still matters, and is covered here, is the pair of storage flags
 * that decide whether it MAY open: they are now the only brake on an auto-opening modal.
 *
 * The auto-open behaviour itself (opens once consent resolves; suppressed when disabled /
 * opted-out / completed / dismissed) is covered against the real `init()` in
 * follow-257 / follow-275 / follow-389 / follow-102.
 */

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

describe('markQuizDismissed', () => {
  it('writes a timestamp that isQuizDismissed then reads as dismissed', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((k: string) => store.get(k) ?? null),
      setItem: vi.fn((k: string, v: string) => {
        store.set(k, v);
      }),
    });

    expect(isQuizDismissed()).toBe(false);
    markQuizDismissed();
    // FOLLOW-1015: the card's own close/skip calls this, so closing an auto-opened quiz
    // must be what starts the cooldown — otherwise it reopens on the next page view.
    expect(isQuizDismissed()).toBe(true);
  });

  it('does not throw when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      setItem: vi.fn(() => {
        throw new Error('storage unavailable');
      }),
    });
    expect(() => {
      markQuizDismissed();
    }).not.toThrow();
  });
});

describe('quiz completion flag', () => {
  it('round-trips through sessionStorage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((k: string) => store.get(k) ?? null),
      setItem: vi.fn((k: string, v: string) => {
        store.set(k, v);
      }),
    });

    expect(isQuizCompleted()).toBe(false);
    markQuizCompleted();
    expect(isQuizCompleted()).toBe(true);
  });

  it('returns false when sessionStorage throws', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(() => {
        throw new Error('storage unavailable');
      }),
    });
    expect(isQuizCompleted()).toBe(false);
  });

  it('does not throw when sessionStorage is unavailable on write', () => {
    vi.stubGlobal('sessionStorage', {
      setItem: vi.fn(() => {
        throw new Error('storage unavailable');
      }),
    });
    expect(() => {
      markQuizCompleted();
    }).not.toThrow();
  });
});
