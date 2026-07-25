-- Migration: 0036_tenants_optout_widget_config
-- FOLLOW-641 / ADR-0019 D2: add the per-brand opt-out toggle widget config column.
--
-- Background:
--   The profiling opt-out toggle (packages/sdk/src/ui/profiling-toggle.ts) has been
--   mounted unconditionally since PR #337, but its appearance/placement/label text were
--   hardcoded. This column stores the per-brand overrides (placement corner+offsets and
--   i18n label texts) validated at the app layer by OptOutWidgetConfigSchema
--   (packages/shared/src/schemas/presentation-config.ts) and served to the SDK via the
--   GET /api/quiz/public-config `opt_out_widget` slice.
--
-- Default '{}'::jsonb: the migration auto-applies to prod on merge (db-migrate.yml). Every
--   existing tenant — critically the single live tenant, Estalara itself — inherits an EMPTY
--   config, so the SDK omits the `opt_out_widget` slice and the toggle renders BYTE-IDENTICAL
--   to today (ADR-0019 D4). DEFAULT '{}' is why this additive migration is safe on a
--   populated table without a separate backfill step.
--
-- Forward-only, purely additive (ADD COLUMN only). Distinct column from brand_config /
-- quiz_config because the opt-out toggle is a distinct widget with a distinct §H.9 lifecycle
-- (ADR-0019 D2 rationale).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS optout_widget_config jsonb NOT NULL DEFAULT '{}'::jsonb;
