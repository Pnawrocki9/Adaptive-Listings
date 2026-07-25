-- Migration: 0035_quiz_definitions
-- FOLLOW-639 / ADR-0019 D2: per-tenant, versioned, audited editable quiz trees.
--
-- Background:
--   The fully editable per-brand quiz (questions, answers, branching, answer→archetype
--   weight mappings, i18n) is large, i18n-multiplied EDITED CONTENT for which rollback +
--   audit matter. It does NOT belong on tenants.quiz_config (a small settings blob read on
--   every hot-path tenant lookup). This dedicated table isolates its size and preserves
--   version history (an edit inserts a NEW active version; prior versions are retained).
--
-- Purely additive + default-preserving (db-migrate.yml auto-applies to staging→prod on
--   merge with NO human gate — memory project_postgres_migrations_no_autoapply):
--     * Creates a NEW table only. Touches NO existing table, column, or row.
--     * A tenant with NO quiz_definitions row behaves BYTE-IDENTICALLY to today: the
--       GET /api/quiz/public-config route omits the quiz_definition slice and the SDK
--       uses its built-in default tree (ADR-0019 D4/D5). Zero backfill required.
--   Forward-only. Safe to apply to the populated production tenants table because it adds
--   no constraints to, and reads/writes none of, existing rows.
--
-- The partial UNIQUE index enforces "at most one ACTIVE version per tenant" while leaving
--   inactive history rows unconstrained (any number may accumulate). The read path selects
--   the single is_active row; the staff editor flips is_active inside one transaction.

CREATE TABLE IF NOT EXISTS quiz_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  definition jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quiz_definitions_tenant_id_idx ON quiz_definitions (tenant_id);

-- At most one active version per tenant (partial unique index). Inactive history rows are
-- exempt, so a tenant may retain many prior versions with is_active = false.
CREATE UNIQUE INDEX IF NOT EXISTS quiz_definitions_active_per_tenant_idx
  ON quiz_definitions (tenant_id)
  WHERE is_active;
