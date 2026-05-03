-- Migration: 0002_create_session_summary_mv
-- Session-level aggregate table + materialized view over `events`.
--
-- Pattern: AggregatingMergeTree target table + MV that feeds it.
-- Query the table with SELECT ... FINAL or using *Merge() aggregate combinators
-- to correctly fold SimpleAggregateFunction / AggregateFunction states:
--
--   SELECT
--     tenant_id, session_id, region, started_at,
--     maxSimpleState(ended_at)              AS ended_at,
--     sumSimpleState(page_count)            AS page_count,
--     uniqMerge(listing_ids_seen)           AS unique_listings,
--     maxSimpleState(has_chat)              AS has_chat,
--     maxSimpleState(has_inquiry)           AS has_inquiry,
--     anyLastSimpleState(last_event_type)   AS last_event_type
--   FROM session_summary FINAL
--   WHERE tenant_id = '...'
--   GROUP BY tenant_id, session_id, region, started_at;
--
-- Columns with SimpleAggregateFunction are efficient (no serialization overhead)
-- and support direct INSERT of the raw value from the MV.
-- listing_ids_seen uses full AggregateFunction(uniq) for HyperLogLog accuracy.

CREATE TABLE IF NOT EXISTS session_summary
(
    tenant_id        String,
    session_id       String,

    -- Denormalised for fast dashboard reads (consistent within a session)
    region           LowCardinality(String),

    -- Session start: min(ts) of the first INSERT batch that created this row.
    -- Reliable when sessions fit in one calendar day (>99% of RE browsing sessions).
    started_at       DateTime64(3, 'UTC'),

    -- Aggregated session features
    ended_at         SimpleAggregateFunction(max,     DateTime64(3, 'UTC')),
    page_count       SimpleAggregateFunction(sum,     UInt32),
    listing_ids_seen AggregateFunction(uniq,          String),
    has_chat         SimpleAggregateFunction(max,     UInt8),
    has_inquiry      SimpleAggregateFunction(max,     UInt8),
    last_event_type  SimpleAggregateFunction(anyLast, LowCardinality(String))
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMMDD(started_at)
ORDER BY (tenant_id, session_id);

-- Materialized view: fires on every INSERT into events.
-- One output row per (tenant_id, session_id) GROUP per INSERT batch.
CREATE MATERIALIZED VIEW IF NOT EXISTS session_summary_mv
TO session_summary
AS
SELECT
    tenant_id,
    session_id,
    any(region)                                                             AS region,
    min(ts)                                                                 AS started_at,
    max(ts)                                                                 AS ended_at,
    countIf(type = 'page.view')                                             AS page_count,
    uniqState(listing_id)                                                   AS listing_ids_seen,
    toUInt8(maxIf(1, type IN ('chat.opened', 'chat.message.sent')))         AS has_chat,
    toUInt8(maxIf(1, type IN ('inquiry.started', 'inquiry.completed')))     AS has_inquiry,
    argMax(type, ts)                                                        AS last_event_type
FROM events
GROUP BY tenant_id, session_id;
