-- Migration: 0001_create_events
-- Creates the canonical events table for all ingest data.
--
-- Engine notes:
--   Production (ClickHouse Cloud): ReplicatedMergeTree — paths and replicas
--   are auto-assigned by ClickHouse Cloud; no explicit ZooKeeper paths needed.
--   Local / CI (LOCAL=1 in migrate.sh): ReplicatedMergeTree is substituted
--   with MergeTree by the migration runner.
--
-- Retention: 13 months default (TICKET compliance). Per-tenant overrides via
-- partition-level TTL will be layered in Sprint 9 — DO NOT change this TTL
-- without a compliance review.
--
-- Schema is additive-only within schema_version 1 (ADR-0003). Removing or
-- renaming columns requires a schema_version bump and new ADR.

CREATE TABLE IF NOT EXISTS events
(
    -- Identity
    event_id           UUID,
    tenant_id          String  CODEC(ZSTD(3)),
    session_id         String  CODEC(ZSTD(3)),

    -- Temporal
    ts                 DateTime64(3, 'UTC'),
    ingest_received_at DateTime64(3, 'UTC'),

    -- Routing / classification (low-cardinality = dictionary encoding, fast filter)
    region             LowCardinality(String),
    type               LowCardinality(String),
    schema_version     UInt16,
    consent_state      LowCardinality(String),

    -- Listing context (optional; empty string when absent)
    listing_id         String  CODEC(ZSTD(3)),

    -- Server-side annotation from intent engine (optional; empty string when absent)
    archetype_hint     LowCardinality(String),

    -- Event-type-specific payload stored as JSON string
    payload            String  CODEC(ZSTD(3))
)
ENGINE = ReplicatedMergeTree
PARTITION BY (tenant_id, toYYYYMMDD(ts))
ORDER BY (tenant_id, type, session_id, ts)
TTL toDateTime(ts) + INTERVAL 13 MONTH
SETTINGS index_granularity = 8192;
