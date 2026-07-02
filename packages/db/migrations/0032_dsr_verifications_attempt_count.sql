-- Migration: 0032_dsr_verifications_attempt_count
-- FOLLOW-455 / audit F-20: DSR OTP hardening.
--
-- Adds attempt_count so the request-scoped OTP verifier
-- (apps/control-plane/src/lib/dsr-verify.ts) can enforce a per-capability
-- attempt cap + lockout: once a single DSR request's OTP has been guessed
-- wrong MAX_OTP_ATTEMPTS times, the row is locked regardless of whether the
-- correct code is eventually submitted. This bounds the brute-force search
-- space for any ONE request to MAX_OTP_ATTEMPTS instead of the full 6-digit
-- (1e6) space.
--
-- Also adds a composite index supporting the anti-email-bomb rate limiter on
-- POST /api/dsr/initiate (apps/control-plane/src/lib/dsr-rate-limit.ts), which
-- counts recent dsr_verifications rows for (tenant_id, email) within a
-- rolling window.
--
-- Forward-only migration.

ALTER TABLE dsr_verifications
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS dsr_verifications_tenant_email_created_idx
  ON dsr_verifications (tenant_id, email, created_at);
