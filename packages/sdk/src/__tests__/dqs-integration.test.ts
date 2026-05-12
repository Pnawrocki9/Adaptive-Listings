/**
 * Integration tests for DQS — verifies snapshot cadence and Zod schema acceptance.
 * TICKET-DQS-001.
 */

import { describe, expect, it } from 'vitest';

import { DqsTracker } from '../core/dqs.js';
import type { DqsSnapshot } from '../core/dqs.js';

// Import the shared Zod schema to validate snapshot payloads at the boundary.
import { SessionQualitySnapshotPayloadSchema } from '@estalara/shared';

const SESSION_ID = 'b'.repeat(64);

// ─── Cadence tests ─────────────────────────────────────────────────────────────

describe('DQS snapshot cadence (every 5th update + on session end)', () => {
  it('emits a snapshot at the 5th update boundary', () => {
    const tracker = new DqsTracker(SESSION_ID);
    const snapshots: DqsSnapshot[] = [];

    for (let i = 1; i <= 10; i++) {
      tracker.update('family_buyer', 0.5 + i * 0.01);
      // Simulate what session manager does: collect snapshot every 5th call
      if (i % 5 === 0) {
        snapshots.push(tracker.snapshot());
      }
    }

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.total_events).toBe(5);
    expect(snapshots[1]?.total_events).toBe(10);
  });

  it('emits a final snapshot on session end (regardless of interval)', () => {
    const tracker = new DqsTracker(SESSION_ID);
    const snapshots: DqsSnapshot[] = [];

    // 7 updates — interval fires at 5, final fires at end
    for (let i = 1; i <= 7; i++) {
      tracker.update('yield_hunter', 0.6);
      if (i % 5 === 0) {
        snapshots.push(tracker.snapshot());
      }
    }
    // Simulate session end flush
    snapshots.push(tracker.snapshot());

    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]?.total_events).toBe(7);
  });
});

// ─── Zod schema tests ─────────────────────────────────────────────────────────

describe('SessionQualitySnapshotPayloadSchema', () => {
  const validPayload = {
    session_id: SESSION_ID,
    prediction_stability_score: 0.8,
    convergence_time_events: 5,
    signal_density_per_min: 3.0,
    final_archetype: 'family_buyer',
    final_confidence: 0.72,
    total_events: 10,
  };

  it('accepts a valid snapshot payload', () => {
    expect(() => SessionQualitySnapshotPayloadSchema.parse(validPayload)).not.toThrow();
  });

  it('accepts null for convergence_time_events', () => {
    const payload = { ...validPayload, convergence_time_events: null };
    expect(() => SessionQualitySnapshotPayloadSchema.parse(payload)).not.toThrow();
  });

  it('rejects a missing required field (total_events)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { total_events: _omit, ...payload } = validPayload;
    expect(() => SessionQualitySnapshotPayloadSchema.parse(payload)).toThrow();
  });

  it('rejects prediction_stability_score < 0', () => {
    const payload = { ...validPayload, prediction_stability_score: -0.1 };
    expect(() => SessionQualitySnapshotPayloadSchema.parse(payload)).toThrow();
  });

  it('rejects prediction_stability_score > 1', () => {
    const payload = { ...validPayload, prediction_stability_score: 1.1 };
    expect(() => SessionQualitySnapshotPayloadSchema.parse(payload)).toThrow();
  });

  it('rejects signal_density_per_min > 10', () => {
    const payload = { ...validPayload, signal_density_per_min: 11 };
    expect(() => SessionQualitySnapshotPayloadSchema.parse(payload)).toThrow();
  });

  it('rejects signal_density_per_min < 0', () => {
    const payload = { ...validPayload, signal_density_per_min: -1 };
    expect(() => SessionQualitySnapshotPayloadSchema.parse(payload)).toThrow();
  });

  it('rejects final_confidence > 1', () => {
    const payload = { ...validPayload, final_confidence: 1.5 };
    expect(() => SessionQualitySnapshotPayloadSchema.parse(payload)).toThrow();
  });

  it('rejects total_events < 0', () => {
    const payload = { ...validPayload, total_events: -1 };
    expect(() => SessionQualitySnapshotPayloadSchema.parse(payload)).toThrow();
  });

  it('rejects non-integer convergence_time_events', () => {
    const payload = { ...validPayload, convergence_time_events: 2.5 };
    expect(() => SessionQualitySnapshotPayloadSchema.parse(payload)).toThrow();
  });

  it('snapshot from DqsTracker passes Zod schema', () => {
    const tracker = new DqsTracker(SESSION_ID);
    tracker.update('first_time_buyer', 0.6);
    tracker.update('first_time_buyer', 0.6);
    tracker.update('first_time_buyer', 0.6);
    const snap = tracker.snapshot();
    // DqsSnapshot maps directly to payload schema
    expect(() => SessionQualitySnapshotPayloadSchema.parse(snap)).not.toThrow();
  });
});
