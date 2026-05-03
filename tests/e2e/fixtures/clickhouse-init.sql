-- E2E local ClickHouse schema for smoke tests.
-- Production schema (ReplicatedMergeTree + ClickHouse Cloud DDL) lives in infra/clickhouse/migrations/ (TICKET-014).
-- This file is mounted into /docker-entrypoint-initdb.d/ by tests/e2e/docker-compose.yml.

CREATE TABLE IF NOT EXISTS events
(
    event_id           String CODEC(ZSTD(1)),
    tenant_id          String CODEC(ZSTD(1)),
    session_id         String CODEC(ZSTD(1)),
    ts                 DateTime64(3, 'UTC'),
    region             LowCardinality(String),
    type               LowCardinality(String),
    schema_version     UInt16,
    consent_state      LowCardinality(String),
    listing_id         String CODEC(ZSTD(1)),
    archetype_hint     LowCardinality(String),
    payload            String CODEC(ZSTD(1)),
    ingest_received_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree()
PARTITION BY (tenant_id, toYYYYMMDD(ts))
ORDER BY (tenant_id, type, session_id, ts)
TTL ts + INTERVAL 13 MONTH;

-- session_summary: one aggregate row per (tenant, session) per insertion batch.
-- Queried with FINAL or via count(*) > 0 to confirm sessions exist.
CREATE TABLE IF NOT EXISTS session_summary
(
    tenant_id  String,
    session_id String,
    region     LowCardinality(String),
    started_at DateTime64(3, 'UTC'),
    ended_at   DateTime64(3, 'UTC')
)
ENGINE = MergeTree()
PARTITION BY tenant_id
ORDER BY (tenant_id, session_id, started_at);

CREATE MATERIALIZED VIEW IF NOT EXISTS session_summary_mv
TO session_summary
AS
SELECT
    tenant_id,
    session_id,
    any(region)  AS region,
    min(ts)      AS started_at,
    max(ts)      AS ended_at
FROM events
GROUP BY tenant_id, session_id;
