-- Migration: 0019_conversion_labels
-- Conversion Label Loop (MASTER_DESIGN §T, FOLLOW-171).
--
-- Persists durable (prediction → outcome) training pairs so a per-tenant classifier can be
-- fine-tuned later (TALLRec/LoRA, §D.5.7). One row per labeled lead-outcome, joined to its
-- prediction by `prediction_id` (= ClickHouse `adaptation_decisions.adapt_decision_id`,
-- migration 0012). Today the bandit feedback ping (POST /api/adapt/feedback) collapses
-- outcomes into Beta counters on ab_bandit_weights and discards the per-event tuple; the
-- feedback route now ALSO writes a row here (label_source='system') so the pair survives.
--
-- outcome_class / label_source are plain text (the repo does not use pgEnum); the canonical
-- taxonomy lives in @estalara/shared/schemas/conversion-label and is validated at the API
-- layer (ConversionOutcomeClass / ConversionLabelSource).
--
-- RLS: tenant isolation on tenant_id, mirroring demo_overrides (0017). Forward-only.

CREATE TABLE IF NOT EXISTS conversion_labels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Join key to the prediction (adaptation_decisions.adapt_decision_id). NOT NULL: a label
  -- with no prediction is not training fuel.
  prediction_id text NOT NULL,
  -- Durable pseudonymous lead key (§T.6); '' until a durable id is wired (follow-up).
  lead_id       text NOT NULL DEFAULT '',
  -- One of ConversionOutcomeClass: viewing_booked | offer_made | contract_signed | purchased | lost | no_response
  outcome_class text NOT NULL,
  -- Raw inbound payload (feedback ping / CRM webhook) before mapping.
  outcome_raw   jsonb,
  labeled_at    timestamptz NOT NULL DEFAULT now(),
  -- One of ConversionLabelSource: system | manual_admin
  label_source  text NOT NULL,
  confidence    real,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversion_labels_tenant_id_idx     ON conversion_labels (tenant_id);
CREATE INDEX IF NOT EXISTS conversion_labels_prediction_id_idx ON conversion_labels (prediction_id);
CREATE INDEX IF NOT EXISTS conversion_labels_tenant_outcome_idx ON conversion_labels (tenant_id, outcome_class);

-- RLS: enable row-level security and create the tenant-isolation policy (mirrors 0017).
ALTER TABLE conversion_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversion_labels_tenant_isolation
  ON conversion_labels
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
