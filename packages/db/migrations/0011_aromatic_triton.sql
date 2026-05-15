-- Migration: 0011_aromatic_triton
-- TICKET-GDPR-002 — Data Subject Rights (DSR) endpoints
--
-- Adds dsr_verifications table for OTP-based DSR request verification.
--
-- Each row represents one DSR request (access / erase / portability).
-- The raw OTP is NEVER stored — only a SHA-256 hash (otp_hash).
-- OTPs expire after 15 minutes (expires_at = now() + interval '15 minutes').
-- Once consumed, used_at is set to prevent replay attacks.
--
-- RLS: tenant_isolation policy applied below.
-- Forward-only migration. TICKET-GDPR-002.

CREATE TABLE IF NOT EXISTS "dsr_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "session_id" text NOT NULL,
  "email" text NOT NULL,
  "dsr_type" text NOT NULL,
  "otp_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dsr_verifications"
  ADD CONSTRAINT "dsr_verifications_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dsr_verifications_tenant_session_idx"
  ON "dsr_verifications" USING btree ("tenant_id","session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dsr_verifications_otp_hash_idx"
  ON "dsr_verifications" USING btree ("otp_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dsr_verifications_expires_at_idx"
  ON "dsr_verifications" USING btree ("expires_at");
--> statement-breakpoint

-- RLS: tenant isolation policy
ALTER TABLE "dsr_verifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "dsr_verifications"
  FOR ALL TO authenticated
  USING (
    tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid
  );
