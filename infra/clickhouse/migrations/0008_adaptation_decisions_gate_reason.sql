-- Migration: 0008_adaptation_decisions_gate_reason
-- TICKET-GDPR-004 — Consent State Gate for Decision API
--
-- Adds gate_reason column to adaptation_decisions.
-- Populated when the consent gate fires; empty string otherwise.
--
-- Values:
--   '' (empty)          — no gate applied (normal flow)
--   'consent_required'  — session gated because tenant requires consent and
--                         consent_state was not 'granted'
--
-- ClickHouse ALTER TABLE ADD COLUMN is non-blocking for MergeTree tables.
-- The default value ('') backfills all existing rows.

ALTER TABLE adaptation_decisions
    ADD COLUMN IF NOT EXISTS gate_reason LowCardinality(String) DEFAULT ''
    AFTER holdout_group;
