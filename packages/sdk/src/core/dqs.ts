/**
 * Detection Quality Score (DQS) — per-session convergence metrics.
 *
 * Tracks how quickly and stably the intent engine converges on an archetype
 * for a given session. Emits `session.quality.snapshot` events that are forwarded
 * to ClickHouse for offline quality analysis.
 *
 * Integration note: `DqsTracker` is intentionally kept stateless with respect to
 * event dispatch. The `snapshot()` method returns a `DqsSnapshot` that the session
 * manager should forward via `dispatchEvents()` at the right cadence (every 5th
 * update and on session end). This avoids coupling the tracker to the full SDK
 * config / session context, which would require circular imports through session.ts.
 *
 * @module @estalara/sdk/core/dqs
 */

import type { ArchetypeId } from '@estalara/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Immutable snapshot of detection quality metrics at a point in time.
 * Maps 1:1 to the `session.quality.snapshot` event payload.
 */
export interface DqsSnapshot {
  session_id: string;
  /** Fraction of last 5 updates where archetype matched current archetype. 0.0–1.0. */
  prediction_stability_score: number;
  /**
   * Total update count at the moment the prediction first stayed stable for
   * 3 consecutive updates. `null` until convergence is observed; once set, immutable.
   */
  convergence_time_events: number | null;
  /** Count of update() calls in the last 60 seconds, capped at 10. */
  signal_density_per_min: number;
  /** Archetype from the most recent update() call. */
  final_archetype: ArchetypeId | 'neutral';
  /** Confidence from the most recent update() call. */
  final_confidence: number;
  /** Cumulative count of update() calls since construction / last reset(). */
  total_events: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Rolling window size for stability score. */
const STABILITY_WINDOW = 5;

/** Number of consecutive identical predictions required to declare convergence. */
const CONVERGENCE_STREAK = 3;

/** Window for signal density calculation (ms). */
const DENSITY_WINDOW_MS = 60_000;

/** Maximum signal density value (events / min). */
const DENSITY_CAP = 10;

// ─── DqsTracker ───────────────────────────────────────────────────────────────

/**
 * Per-session DQS tracker. One instance per session; reset on session.reset().
 *
 * All methods are synchronous and never throw.
 */
export class DqsTracker {
  /** Ring buffer of archetype IDs for the last STABILITY_WINDOW updates. */
  private readonly _history: (ArchetypeId | 'neutral')[] = [];

  /** Timestamps (Date.now()) of recent update() calls — used for density. */
  private readonly _timestamps: number[] = [];

  /** Archetype from the most recent update(). */
  private _lastArchetype: ArchetypeId | 'neutral' = 'neutral';

  /** Confidence from the most recent update(). */
  private _lastConfidence = 0;

  /** Total update() calls. */
  private _totalEvents = 0;

  /** Streak counter for convergence detection. */
  private _streak = 0;

  /** Archetype of the current streak. */
  private _streakArchetype: ArchetypeId | 'neutral' = 'neutral';

  /** Convergence event count — null until first convergence. */
  private _convergenceTimeEvents: number | null = null;

  constructor(private readonly sessionId: string) {}

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Record one archetype prediction. Called after every intent-engine update
   * that produces a new archetype / confidence pair.
   */
  update(archetypeId: ArchetypeId | 'neutral', confidence: number): void {
    const now = Date.now();

    this._lastArchetype = archetypeId;
    this._lastConfidence = confidence;
    this._totalEvents += 1;

    // Rolling history for stability score (keep last STABILITY_WINDOW entries).
    this._history.push(archetypeId);
    if (this._history.length > STABILITY_WINDOW) {
      this._history.shift();
    }

    // Timestamp buffer for density calculation.
    this._timestamps.push(now);
    // Prune entries older than DENSITY_WINDOW_MS to keep the buffer small.
    const cutoff = now - DENSITY_WINDOW_MS;
    while (this._timestamps.length > 0 && (this._timestamps[0] ?? 0) < cutoff) {
      this._timestamps.shift();
    }

    // Convergence detection — track consecutive identical archetypes.
    if (this._convergenceTimeEvents === null) {
      if (archetypeId === this._streakArchetype) {
        this._streak += 1;
      } else {
        this._streak = 1;
        this._streakArchetype = archetypeId;
      }
      if (this._streak >= CONVERGENCE_STREAK) {
        this._convergenceTimeEvents = this._totalEvents;
      }
    }
  }

  /**
   * Return an immutable snapshot of the current DQS metrics.
   *
   * Callers (session manager) should call this every 5th update() and on session end,
   * then forward the result as a `session.quality.snapshot` event.
   */
  snapshot(): DqsSnapshot {
    return {
      session_id: this.sessionId,
      prediction_stability_score: this._computeStabilityScore(),
      convergence_time_events: this._convergenceTimeEvents,
      signal_density_per_min: this._computeSignalDensity(),
      final_archetype: this._lastArchetype,
      final_confidence: this._lastConfidence,
      total_events: this._totalEvents,
    };
  }

  /**
   * Reset all accumulated state. Called when the session is recycled / restarted.
   */
  reset(): void {
    this._history.length = 0;
    this._timestamps.length = 0;
    this._lastArchetype = 'neutral';
    this._lastConfidence = 0;
    this._totalEvents = 0;
    this._streak = 0;
    this._streakArchetype = 'neutral';
    this._convergenceTimeEvents = null;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Fraction of last STABILITY_WINDOW updates that matched the current archetype.
   * Returns 0 when no updates have been recorded.
   */
  private _computeStabilityScore(): number {
    if (this._history.length === 0) return 0;
    const current = this._lastArchetype;
    const matches = this._history.filter((a) => a === current).length;
    return matches / this._history.length;
  }

  /**
   * Count of update() calls in the last 60 seconds, capped at DENSITY_CAP.
   */
  private _computeSignalDensity(): number {
    const now = Date.now();
    const cutoff = now - DENSITY_WINDOW_MS;
    const recent = this._timestamps.filter((t) => t >= cutoff).length;
    return Math.min(recent, DENSITY_CAP);
  }
}
