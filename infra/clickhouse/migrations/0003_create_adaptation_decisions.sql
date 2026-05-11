-- Migration: 0003_create_adaptation_decisions
-- Logs every adaptation decision for per-session analytics and A/B holdout tracking.
--
-- Engine notes:
--   Production (ClickHouse Cloud): MergeTree — ClickHouse Cloud handles replication
--   transparently; no explicit ReplicatedMergeTree paths needed.
--   Local / CI: MergeTree runs without modification.
--
-- Retention: no explicit TTL here — inherits default cluster retention settings.
-- Per-tenant TTL override will be layered in Sprint 9 along with the events table.
--
-- This table is append-only. One row per adaptation request. Downstream aggregation
-- (e.g. adaptation_rate, top_archetype) should be built as materialized views.

CREATE TABLE IF NOT EXISTS adaptation_decisions
(
    session_id      String,
    tenant_id       String,
    archetype       LowCardinality(String),
    confidence      Float32,
    similarity      Float32,
    source          LowCardinality(String),
    tier            UInt8,
    directive_count UInt16,
    ts              DateTime64(3, 'UTC')
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (tenant_id, session_id, ts);
