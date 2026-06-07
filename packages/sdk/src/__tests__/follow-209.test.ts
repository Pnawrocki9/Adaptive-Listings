/**
 * FOLLOW-209 — Micro-poll bottom-toast intent prompts.
 *
 * Covers:
 *   AC1: renderMicroPoll is exported and has the correct signature (bottom toast)
 *   AC2: 3 default questions in Polish, shown in sequence
 *   AC4: applyBehavioralSignal with micro_poll.answered updates intent state
 *   AC5: isMicroPollDismissed guards against repeat shows; eraseMicroPollDismissal for Mode A
 *   AC6: Tests pass
 *
 * Environment: node (no DOM). DOM rendering is validated via E2E (Playwright).
 * Intent-engine tests are pure — no DOM required.
 */

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import {
  isMicroPollDismissed,
  eraseMicroPollDismissal,
  DEFAULT_MICRO_POLL_QUESTIONS,
  MICRO_POLL_DISMISS_KEY,
} from '../ui/micro-poll.js';
import { applyBehavioralSignal, initIntentState } from '../core/intent.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── AC2: 3 default questions in Polish ──────────────────────────────────────

describe('DEFAULT_MICRO_POLL_QUESTIONS', () => {
  const Q1 = DEFAULT_MICRO_POLL_QUESTIONS[0]!;
  const Q2 = DEFAULT_MICRO_POLL_QUESTIONS[1]!;
  const Q3 = DEFAULT_MICRO_POLL_QUESTIONS[2]!;

  it('has exactly 3 questions', () => {
    expect(DEFAULT_MICRO_POLL_QUESTIONS).toHaveLength(3);
  });

  it('Q1 key is purpose_investment and text is in Polish', () => {
    expect(Q1.key).toBe('purpose_investment');
    expect(Q1.text).toContain('inwestycją');
  });

  it('Q2 key is family_buyer and text is in Polish', () => {
    expect(Q2.key).toBe('family_buyer');
    expect(Q2.text).toContain('rodziny');
  });

  it('Q3 key is vacation_rental_investor and text is in Polish', () => {
    expect(Q3.key).toBe('vacation_rental_investor');
    expect(Q3.text).toContain('wynajem krótkoterminowy');
  });

  it('questions are in correct order (Q1→Q2→Q3)', () => {
    const keys = DEFAULT_MICRO_POLL_QUESTIONS.map((q) => q.key);
    expect(keys).toEqual(['purpose_investment', 'family_buyer', 'vacation_rental_investor']);
  });
});

// ─── AC1: renderMicroPoll export contract ────────────────────────────────────

describe('renderMicroPoll — export contract (AC1)', () => {
  it('is a function', async () => {
    const { renderMicroPoll } = await import('../ui/micro-poll.js');
    expect(typeof renderMicroPoll).toBe('function');
  });

  it('returns a cleanup function when called with a mock shadow root', async () => {
    const { renderMicroPoll } = await import('../ui/micro-poll.js');

    // Minimal shadow-root-like stub (no real DOM required)
    const appendedStyles: unknown[] = [];
    const appendedElements: unknown[] = [];
    const mockShadowRoot = {
      appendChild: vi.fn((el: unknown) => {
        if ((el as { textContent?: unknown }).textContent !== undefined) {
          appendedStyles.push(el);
        } else {
          appendedElements.push(el);
        }
      }),
    } as unknown as ShadowRoot;

    const Q1 = DEFAULT_MICRO_POLL_QUESTIONS[0]!;
    const onAnswer = vi.fn();
    const onDismiss = vi.fn();

    // renderMicroPoll uses document.createElement internally — in node env it throws.
    // We verify the function is exported and callable; actual rendering tested in E2E.
    // If document is unavailable, the function must return a no-op cleanup (catch block).
    const result = renderMicroPoll(
      mockShadowRoot,
      { accentColor: '#2563EB' },
      Q1,
      onAnswer,
      onDismiss,
    );
    expect(typeof result).toBe('function');
  });
});

// ─── AC4: applyBehavioralSignal with micro_poll.answered ─────────────────────

describe('applyBehavioralSignal — micro_poll.answered (AC4)', () => {
  it('yes to purpose_investment boosts portfolio_builder, flip_investor, yield_hunter', () => {
    const state = initIntentState();
    const next = applyBehavioralSignal(state, 'micro_poll.answered', {
      question: 'purpose_investment',
      answer: 'yes',
    });
    expect(next.probabilities.portfolio_builder).toBeGreaterThan(
      state.probabilities.portfolio_builder,
    );
    expect(next.probabilities.flip_investor).toBeGreaterThan(state.probabilities.flip_investor);
    expect(next.probabilities.yield_hunter).toBeGreaterThan(state.probabilities.yield_hunter);
    expect(next.signal_count).toBe(state.signal_count + 1);
  });

  it('no to purpose_investment boosts family_buyer, first_time_buyer, upsizer', () => {
    const state = initIntentState();
    const next = applyBehavioralSignal(state, 'micro_poll.answered', {
      question: 'purpose_investment',
      answer: 'no',
    });
    expect(next.probabilities.family_buyer).toBeGreaterThan(state.probabilities.family_buyer);
    expect(next.probabilities.first_time_buyer).toBeGreaterThan(
      state.probabilities.first_time_buyer,
    );
    expect(next.probabilities.upsizer).toBeGreaterThan(state.probabilities.upsizer);
    expect(next.signal_count).toBe(state.signal_count + 1);
  });

  it('yes to family_buyer boosts family_buyer', () => {
    const state = initIntentState();
    const next = applyBehavioralSignal(state, 'micro_poll.answered', {
      question: 'family_buyer',
      answer: 'yes',
    });
    expect(next.probabilities.family_buyer).toBeGreaterThan(state.probabilities.family_buyer);
    expect(next.signal_count).toBe(state.signal_count + 1);
  });

  it('no to family_buyer does NOT boost family_buyer (only yes is handled)', () => {
    const state = initIntentState();
    const next = applyBehavioralSignal(state, 'micro_poll.answered', {
      question: 'family_buyer',
      answer: 'no',
    });
    // no-answer on family_buyer: no boost applied; family_buyer prob should be <= initial
    expect(next.probabilities.family_buyer).toBeLessThanOrEqual(
      state.probabilities.family_buyer * 1.001,
    );
  });

  it('yes to vacation_rental_investor boosts vacation_rental_investor', () => {
    const state = initIntentState();
    const next = applyBehavioralSignal(state, 'micro_poll.answered', {
      question: 'vacation_rental_investor',
      answer: 'yes',
    });
    expect(next.probabilities.vacation_rental_investor).toBeGreaterThan(
      state.probabilities.vacation_rental_investor,
    );
    expect(next.signal_count).toBe(state.signal_count + 1);
  });

  it('missing question returns state unchanged (signal_count not incremented)', () => {
    const state = initIntentState();
    const next = applyBehavioralSignal(state, 'micro_poll.answered', {
      answer: 'yes',
    });
    expect(next.signal_count).toBe(state.signal_count);
  });

  it('missing answer returns state unchanged (signal_count not incremented)', () => {
    const state = initIntentState();
    const next = applyBehavioralSignal(state, 'micro_poll.answered', {
      question: 'purpose_investment',
    });
    expect(next.signal_count).toBe(state.signal_count);
  });

  it('invalid answer value returns state unchanged', () => {
    const state = initIntentState();
    const next = applyBehavioralSignal(state, 'micro_poll.answered', {
      question: 'purpose_investment',
      answer: 'maybe', // invalid
    });
    expect(next.signal_count).toBe(state.signal_count);
  });

  it('probabilities sum to ~1.0 after yes to purpose_investment', () => {
    const state = initIntentState();
    const next = applyBehavioralSignal(state, 'micro_poll.answered', {
      question: 'purpose_investment',
      answer: 'yes',
    });
    const sum = Object.values(next.probabilities).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('probabilities sum to ~1.0 after yes to vacation_rental_investor', () => {
    const state = initIntentState();
    const next = applyBehavioralSignal(state, 'micro_poll.answered', {
      question: 'vacation_rental_investor',
      answer: 'yes',
    });
    const sum = Object.values(next.probabilities).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('investor boost from yes-to-investment reduces neutral probability', () => {
    const state = initIntentState();
    const next = applyBehavioralSignal(state, 'micro_poll.answered', {
      question: 'purpose_investment',
      answer: 'yes',
    });
    // After renormalization, neutral should decrease as investor archetypes gain mass
    expect(next.probabilities.neutral).toBeLessThan(state.probabilities.neutral);
  });
});

// ─── AC5 + Mode A: isMicroPollDismissed and eraseMicroPollDismissal ───────────

describe('isMicroPollDismissed (AC5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns false when localStorage is empty', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    expect(isMicroPollDismissed()).toBe(false);
  });

  it('returns true when dismissed <24h ago', () => {
    const recentTs = Date.now() - 60 * 1000; // 1 minute ago
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => String(recentTs)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    expect(isMicroPollDismissed()).toBe(true);
  });

  it('returns false when dismissed >24h ago', () => {
    const oldTs = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => String(oldTs)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    expect(isMicroPollDismissed()).toBe(false);
  });

  it('returns false when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      get getItem() {
        throw new Error('storage unavailable');
      },
    });
    expect(isMicroPollDismissed()).toBe(false);
  });

  it('returns false when localStorage is undefined (globalThis pattern)', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(isMicroPollDismissed()).toBe(false);
  });
});

describe('eraseMicroPollDismissal — Mode A compliance', () => {
  it('calls removeItem with the dismiss key', () => {
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem,
    });
    eraseMicroPollDismissal();
    expect(removeItem).toHaveBeenCalledWith(MICRO_POLL_DISMISS_KEY);
  });

  it('does not throw when localStorage is undefined', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => { eraseMicroPollDismissal(); }).not.toThrow();
  });

  it('does not throw when localStorage.removeItem throws', () => {
    vi.stubGlobal('localStorage', {
      removeItem: vi.fn(() => {
        throw new Error('storage full');
      }),
    });
    expect(() => { eraseMicroPollDismissal(); }).not.toThrow();
  });
});
