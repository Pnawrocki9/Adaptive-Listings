-- Migration 0007: description_generations table + verified_facts_used audit column
-- TICKET-DESC-PIVOT-001 v1.7.1 — description pipeline audit trail.
--
-- Creates the description_generations table that tracks each Sonnet-generated
-- listing description. The verified_facts_used column stores the facts Sonnet
-- self-reported as actually used, enabling per-tenant hallucination audits.
--
-- Runner note: LOCAL=1 substitutes MergeTree for ReplicatedMergeTree (see migration 0001).

CREATE TABLE IF NOT EXISTS description_generations
(
    tenant_id           String,
    listing_id          String,
    archetype           LowCardinality(String),
    locale              LowCardinality(String),
    tier                UInt8,
    model               LowCardinality(String),
    source              LowCardinality(String),
    description_chars   UInt32,
    verified_facts_used Array(String),
    generated_at        DateTime64(3, 'UTC'),
    created_at          DateTime64(3, 'UTC')
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (tenant_id, listing_id, archetype, locale, created_at);

-- Idempotent column add for environments where the table pre-existed without the column.
ALTER TABLE description_generations
    ADD COLUMN IF NOT EXISTS verified_facts_used Array(String) DEFAULT []
    AFTER generated_at;

-- Grafana query for audit:
--   SELECT listing_id, archetype, locale,
--          arrayJoin(verified_facts_used) AS fact_used, count() AS times_used
--   FROM description_generations
--   WHERE tenant_id = '{tenant_id}' AND toDate(created_at) >= today() - 7
--   GROUP BY listing_id, archetype, locale, fact_used
--   ORDER BY times_used DESC
