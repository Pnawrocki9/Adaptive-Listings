-- Migration: 0016_pilot_inquiry_selector
-- FOLLOW-141 — Seed inquiry_submit_selector on pilot tenant (idempotent)
--
-- Background:
--   FOLLOW-127 (PR #161) wired the auto-detect pipeline to populate
--   inquiry_submit_selector for new tenants. The real pilot tenant row
--   (slug = '000-app-estalara') was created before that change and has
--   inquiry_submit_selector = NULL inside its tenant_site_schemas.schema JSONB
--   blob, so the SDK inquiry-submit observer never activates on the pilot site.
--
-- What this migration does:
--   Updates all tenant_site_schemas rows for the pilot tenant where
--   schema->>'inquiry_submit_selector' is NULL or empty string, setting it to
--   the canonical data-estalara-slot value '[data-estalara-slot=''inquiry-submit'']'.
--
-- Pilot tenant identification:
--   Resolved at apply-time by slug = '000-app-estalara'. A pre-flight assertion
--   (DO block below) verifies the slug exists and raises a loud exception if not,
--   so a production apply against a differently-slugged tenant fails visibly rather
--   than silently no-oping. PILOT_FREEZE_RULE.md references DEMO_TENANT_ID as the
--   canonical env-var handle — both should resolve to the same row; the assertion
--   catches divergence at apply-time.
--
-- Idempotency:
--   The WHERE guard ensures this UPDATE is a no-op if the key already has a
--   non-empty value. Safe to re-run.
--
-- Schema note:
--   inquiry_submit_selector lives inside the JSONB `schema` column of
--   tenant_site_schemas (not a top-level column). jsonb_set with create_missing=true
--   inserts the key even when the top-level object does not yet contain it.
--
-- Forward-only migration. FOLLOW-141.

-- Pre-flight assertion: fail loudly if the pilot tenant slug is missing.
-- Prevents a silent 0-row UPDATE on production if the slug was never seeded.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM tenants
    WHERE slug = '000-app-estalara'
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'Migration 0016 aborted: tenant with slug "000-app-estalara" not found. '
      'Verify the pilot tenant exists and its slug matches the fixture identifier. '
      'If the production tenant uses a different slug, update this migration or seed '
      'the tenant row before applying. (FOLLOW-141 / FOLLOW-147)';
  END IF;
END $$;

UPDATE tenant_site_schemas
SET schema = jsonb_set(
  schema,
  '{inquiry_submit_selector}',
  '"[data-estalara-slot=''inquiry-submit'']"'::jsonb,
  true
)
WHERE tenant_id = (
  SELECT id
  FROM tenants
  WHERE slug = '000-app-estalara'
    AND deleted_at IS NULL
  LIMIT 1
)
AND (
  schema->>'inquiry_submit_selector' IS NULL
  OR schema->>'inquiry_submit_selector' = ''
);
