-- Migration 0004: llm_calls table
-- Tracks LLM gateway invocations for spend monitoring and analytics.
-- Used by circuit breaker (rolling 24h sum of cost_usd).
--
-- Runner note: LOCAL=1 substitutes MergeTree for ReplicatedMergeTree (see migration 0001).

CREATE TABLE IF NOT EXISTS llm_calls
(
    session_id  String,
    tenant_id   String,
    archetype   LowCardinality(String),
    model       LowCardinality(String),
    tokens_in   UInt32,
    tokens_out  UInt32,
    cost_usd    Float32,
    latency_ms  UInt32,
    source      LowCardinality(String),
    ts          DateTime64(3, 'UTC')
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (tenant_id, session_id, ts);
