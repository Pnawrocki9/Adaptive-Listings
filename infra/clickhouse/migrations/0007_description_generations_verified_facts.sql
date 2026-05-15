-- Migration: 0007_description_generations_verified_facts
-- TICKET-DESC-PIVOT-001 v1.7.1 — anti-hallucination audit trail.
--
-- Adds verified_facts_used column to description_generations so we can audit
-- which facts Sonnet self-reported as actually used when generating each
-- adaptive description. Populated by apps/llm-gateway/src/jobs/generate_description.py
-- via the <verified_facts_used> JSON block emitted at the end of Sonnet's output.
--
-- ClickHouse: ALTER TABLE ADD COLUMN IF NOT EXISTS is idempotent on modern
-- servers. The DEFAULT [] backfills existing rows without rewriting parts.
--
-- Runner note: LOCAL=1 substitutes MergeTree for ReplicatedMergeTree (see migration 0001).

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
