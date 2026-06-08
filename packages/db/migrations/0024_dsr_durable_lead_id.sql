-- Migration: 0024_dsr_durable_lead_id
-- FOLLOW-184: Add durable_lead_id to dsr_verifications so a DSR erase request
-- can carry the data subject's CRM lead_id (opaque pseudonymous token) alongside
-- their Estalara session_id.
--
-- Background (RETRO-031 §4a LG-1 / FOLLOW-184):
--   The DSR erase cascade deletes conversion_labels WHERE lead_id = session_id.
--   But the CRM webhook writes lead_id = <opaque CRM token> — a DIFFERENT namespace
--   from the Estalara session_id. So CRM-sourced rows survive a DSR erasure.
--
-- Resolution model (§T.6 update):
--   When the tenant admin initiates a DSR, they may supply the data subject's
--   durable_lead_id (the same opaque token the CRM webhook uses). The erase route
--   then deletes conversion_labels on BOTH keys:
--     (a) lead_id = session_id   — covers SDK feedback-ping labels (existing guard)
--     (b) lead_id = durable_lead_id — covers CRM deep-outcome labels (new, FOLLOW-184)
--   Both deletes use the ne(lead_id, '') guard: an empty key can never match-all.
--   If durable_lead_id is NULL (no CRM identity known), only path (a) runs — safe
--   fallback for sessions that pre-date CRM integration.
--
-- Column is nullable: NULL = no durable CRM identity known for this DSR request.
-- GDPR Art. 17 note: NULL is legitimate when the data subject has no CRM record
-- in the tenant's system (SDK-only session).
--
-- Forward-only migration.

ALTER TABLE dsr_verifications
  ADD COLUMN IF NOT EXISTS durable_lead_id text;

-- Index for the erase query: DELETE FROM conversion_labels WHERE lead_id = durable_lead_id
-- and for DSR audits that need to look up requests by CRM lead_id.
CREATE INDEX IF NOT EXISTS dsr_verifications_durable_lead_id_idx
  ON dsr_verifications (durable_lead_id)
  WHERE durable_lead_id IS NOT NULL;
