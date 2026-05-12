-- Migration 0005: session_quality table — per-session DQS convergence metrics.
-- Stores Detection Quality Score snapshots emitted by the SDK DqsTracker.
-- One row per snapshot (SDK emits every 5th update + on session end).
--
-- convergence_time_events is stored as UInt16 (0 = not yet converged, sentinel value).
-- The SDK sends null for unset convergence; the stream consumer maps null → 0.
--
-- Runner note: LOCAL=1 substitutes MergeTree for ReplicatedMergeTree (see migration 0001).

CREATE TABLE IF NOT EXISTS session_quality
(
    session_id                 String,
    tenant_id                  String,
    prediction_stability_score Float32,
    convergence_time_events    UInt16,
    signal_density_per_min     Float32,
    final_archetype            LowCardinality(String),
    final_confidence           Float32,
    total_events               UInt32,
    ts                         DateTime64(3, 'UTC')
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (tenant_id, session_id, ts);
