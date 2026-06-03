-- Migration: 0013_adaptation_decisions_label_fuel
-- FOLLOW-170 (Conversion Label Loop §T, MASTER_DESIGN v3.9) — T0, BLOCKING.
--
-- Adds the prediction-side "label fuel" the Conversion Label Loop needs so each scored
-- decision can later be paired with its real-world outcome and used to fine-tune a
-- per-tenant classifier (TALLRec/LoRA, §D.5.7). This data CANNOT be reconstructed
-- retroactively — every decision logged without these columns is permanently unusable
-- as training data, which is why this is the blocking first step.
--
-- Columns added (all idempotent, all backfill-safe with a default so existing analytics
-- joins keep working):
--   * model_version     — which scorer produced the decision (`rulebased-bandit-v1` today,
--                          later `lora-tenant-{id}-v*`). LowCardinality: few distinct values.
--   * features_snapshot  — PII-free JSON of the scorer inputs/outputs the server saw at
--                          decision time (archetype, confidence, similarity, source, tier,
--                          holdout, variant). A plain String holding compact JSON. Lets a
--                          stored label be replayed against a future model.
--   * lead_id            — durable pseudonymous lead key (§T.6), distinct from the anonymous
--                          session_id; survives across sessions. Empty until a durable id is
--                          wired through the adapt request (follow-up); the COLUMN must exist
--                          from day one so the field is never lost.
--
-- Also FORMALIZES `demo_override`: `logDecisionAsync` (adapt/route.ts) already writes this
-- column, but no prior migration ever created it. On a table without it, ClickHouse rejects
-- the whole INSERT and the route's catch silently swallows the error (zero analytics rows).
-- Adding it here makes the existing INSERT correct. UInt8 boolean: 1 = demo-driven, 0 = normal.
--
-- ClickHouse ALTER TABLE ADD COLUMN is non-blocking for MergeTree. IF NOT EXISTS keeps the
-- migration idempotent (migrate.sh re-applies all files; no applied-migrations table yet).

ALTER TABLE adaptation_decisions
    ADD COLUMN IF NOT EXISTS demo_override UInt8 DEFAULT 0
    AFTER adapt_decision_id;

ALTER TABLE adaptation_decisions
    ADD COLUMN IF NOT EXISTS model_version LowCardinality(String) DEFAULT ''
    AFTER demo_override;

ALTER TABLE adaptation_decisions
    ADD COLUMN IF NOT EXISTS features_snapshot String DEFAULT ''
    AFTER model_version;

ALTER TABLE adaptation_decisions
    ADD COLUMN IF NOT EXISTS lead_id String DEFAULT ''
    AFTER features_snapshot;
