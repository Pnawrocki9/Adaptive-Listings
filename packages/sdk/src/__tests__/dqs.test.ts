/**
 * Unit tests for DqsTracker (packages/sdk/src/core/dqs.ts). TICKET-DQS-001.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DqsTracker } from '../core/dqs.js';
import type { DqsSnapshot } from '../core/dqs.js';

const SESSION_ID = 'a'.repeat(64);

describe('DqsTracker — prediction_stability_score', () => {
  it('returns 0.8 for history [A,A,B,A,A] where current is A', () => {
    const tracker = new DqsTracker(SESSION_ID);
    tracker.update('family_buyer', 0.7); // A
    tracker.update('family_buyer', 0.7); // A
    tracker.update('yield_hunter', 0.5); // B
    tracker.update('family_buyer', 0.7); // A
    tracker.update('family_buyer', 0.8); // A (current)
    const snap = tracker.snapshot();
    // 4 of last 5 match current archetype 'family_buyer' → 0.8
    expect(snap.prediction_stability_score).toBeCloseTo(0.8);
  });

  it('returns 1.0 when all 5 entries match', () => {
    const tracker = new DqsTracker(SESSION_ID);
    for (let i = 0; i < 5; i++) {
      tracker.update('yield_hunter', 0.9);
    }
    expect(tracker.snapshot().prediction_stability_score).toBeCloseTo(1.0);
  });

  it('returns score based on actual history when fewer than 5 updates', () => {
    const tracker = new DqsTracker(SESSION_ID);
    tracker.update('family_buyer', 0.6); // 1 entry, current = family_buyer
    // 1/1 = 1.0
    expect(tracker.snapshot().prediction_stability_score).toBeCloseTo(1.0);

    tracker.update('yield_hunter', 0.8); // 2 entries, current = yield_hunter
    // history = [family_buyer, yield_hunter]; current = yield_hunter → 1/2 = 0.5
    expect(tracker.snapshot().prediction_stability_score).toBeCloseTo(0.5);

    tracker.update('yield_hunter', 0.9); // 3 entries
    // history = [family_buyer, yield_hunter, yield_hunter]; current = yield_hunter → 2/3
    expect(tracker.snapshot().prediction_stability_score).toBeCloseTo(2 / 3);
  });

  it('returns 0 before any updates', () => {
    const tracker = new DqsTracker(SESSION_ID);
    expect(tracker.snapshot().prediction_stability_score).toBe(0);
  });

  it('slides window past 5 entries', () => {
    const tracker = new DqsTracker(SESSION_ID);
    // 6 updates: first is family_buyer, rest are yield_hunter
    tracker.update('family_buyer', 0.5);
    for (let i = 0; i < 5; i++) {
      tracker.update('yield_hunter', 0.9);
    }
    // sliding window should now contain only the last 5 (all yield_hunter) → 1.0
    expect(tracker.snapshot().prediction_stability_score).toBeCloseTo(1.0);
  });
});

describe('DqsTracker — convergence_time_events', () => {
  it('returns convergence_time_events = 5 for sequence [A,B,A,A,A]', () => {
    const tracker = new DqsTracker(SESSION_ID);
    tracker.update('family_buyer', 0.6); // 1: streak=1 (A)
    tracker.update('yield_hunter', 0.7); // 2: streak=1 (B, resets)
    tracker.update('family_buyer', 0.6); // 3: streak=1 (A, resets)
    tracker.update('family_buyer', 0.6); // 4: streak=2 (A)
    tracker.update('family_buyer', 0.6); // 5: streak=3 → converged at event 5
    const snap = tracker.snapshot();
    expect(snap.convergence_time_events).toBe(5);
  });

  it('returns null when fewer than 3 consecutive identical predictions', () => {
    const tracker = new DqsTracker(SESSION_ID);
    tracker.update('family_buyer', 0.6); // 1
    tracker.update('family_buyer', 0.6); // 2 (streak=2, not yet 3)
    tracker.update('yield_hunter', 0.7); // 3 (resets streak)
    tracker.update('yield_hunter', 0.7); // 4 (streak=2, not yet 3)
    expect(tracker.snapshot().convergence_time_events).toBeNull();
  });

  it('convergence_time_events does not change after first convergence', () => {
    const tracker = new DqsTracker(SESSION_ID);
    // Converge at event 3
    tracker.update('yield_hunter', 0.8);
    tracker.update('yield_hunter', 0.8);
    tracker.update('yield_hunter', 0.8);
    expect(tracker.snapshot().convergence_time_events).toBe(3);

    // More updates should not alter it
    tracker.update('neutral', 0.1);
    tracker.update('neutral', 0.1);
    tracker.update('neutral', 0.1);
    expect(tracker.snapshot().convergence_time_events).toBe(3);
  });

  it('returns null when no updates', () => {
    const tracker = new DqsTracker(SESSION_ID);
    expect(tracker.snapshot().convergence_time_events).toBeNull();
  });
});

describe('DqsTracker — signal_density_per_min', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 8.0 for 8 events in 60 seconds', () => {
    vi.useFakeTimers();
    const tracker = new DqsTracker(SESSION_ID);
    const base = Date.now();
    vi.setSystemTime(base);

    for (let i = 0; i < 8; i++) {
      vi.setSystemTime(base + i * 1000); // 1s apart, all within 60s window
      tracker.update('neutral', 0.1);
    }

    const snap = tracker.snapshot();
    expect(snap.signal_density_per_min).toBe(8);
  });

  it('caps at 10.0 for 15 events within 60 seconds', () => {
    vi.useFakeTimers();
    const tracker = new DqsTracker(SESSION_ID);
    const base = Date.now();
    vi.setSystemTime(base);

    for (let i = 0; i < 15; i++) {
      vi.setSystemTime(base + i * 1000); // 1s apart, all within 60s window
      tracker.update('neutral', 0.1);
    }

    const snap = tracker.snapshot();
    expect(snap.signal_density_per_min).toBe(10);
  });

  it('excludes events older than 60 seconds', () => {
    vi.useFakeTimers();
    const tracker = new DqsTracker(SESSION_ID);
    const base = Date.now();

    // 5 events at t=0
    vi.setSystemTime(base);
    for (let i = 0; i < 5; i++) {
      tracker.update('neutral', 0.1);
    }

    // Advance 61 seconds — those 5 events are now outside the window
    vi.setSystemTime(base + 61_000);
    // 3 new events
    for (let i = 0; i < 3; i++) {
      tracker.update('neutral', 0.1);
    }

    const snap = tracker.snapshot();
    expect(snap.signal_density_per_min).toBe(3);
  });
});

describe('DqsTracker — snapshot() shape', () => {
  it('returns a valid DqsSnapshot after N updates', () => {
    const tracker = new DqsTracker(SESSION_ID);
    for (let i = 0; i < 3; i++) {
      tracker.update('first_time_buyer', 0.55);
    }
    const snap: DqsSnapshot = tracker.snapshot();

    expect(snap.session_id).toBe(SESSION_ID);
    expect(typeof snap.prediction_stability_score).toBe('number');
    expect(snap.prediction_stability_score).toBeGreaterThanOrEqual(0);
    expect(snap.prediction_stability_score).toBeLessThanOrEqual(1);
    expect(snap.final_archetype).toBe('first_time_buyer');
    expect(snap.final_confidence).toBeCloseTo(0.55);
    expect(snap.total_events).toBe(3);
    expect(typeof snap.signal_density_per_min).toBe('number');
    expect(snap.signal_density_per_min).toBeGreaterThanOrEqual(0);
    expect(snap.signal_density_per_min).toBeLessThanOrEqual(10);
  });

  it('snapshot reflects state of the most recent update', () => {
    const tracker = new DqsTracker(SESSION_ID);
    tracker.update('family_buyer', 0.4);
    tracker.update('yield_hunter', 0.9);
    const snap = tracker.snapshot();
    expect(snap.final_archetype).toBe('yield_hunter');
    expect(snap.final_confidence).toBeCloseTo(0.9);
    expect(snap.total_events).toBe(2);
  });
});

describe('DqsTracker — reset()', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('clears all accumulated state', () => {
    const tracker = new DqsTracker(SESSION_ID);
    tracker.update('family_buyer', 0.6);
    tracker.update('family_buyer', 0.6);
    tracker.update('family_buyer', 0.6);

    tracker.reset();
    const snap = tracker.snapshot();

    expect(snap.total_events).toBe(0);
    expect(snap.prediction_stability_score).toBe(0);
    expect(snap.convergence_time_events).toBeNull();
    expect(snap.signal_density_per_min).toBe(0);
    expect(snap.final_archetype).toBe('neutral');
    expect(snap.final_confidence).toBe(0);
  });

  it('allows fresh convergence detection after reset', () => {
    const tracker = new DqsTracker(SESSION_ID);
    // Converge before reset
    tracker.update('family_buyer', 0.6);
    tracker.update('family_buyer', 0.6);
    tracker.update('family_buyer', 0.6);
    expect(tracker.snapshot().convergence_time_events).toBe(3);

    tracker.reset();

    // Converge again after reset
    tracker.update('yield_hunter', 0.9);
    tracker.update('yield_hunter', 0.9);
    tracker.update('yield_hunter', 0.9);
    expect(tracker.snapshot().convergence_time_events).toBe(3);
  });
});
