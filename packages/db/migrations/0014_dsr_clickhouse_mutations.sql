-- Migration: 0014_dsr_clickhouse_mutations
-- FOLLOW-039 — ClickHouse DSR hard-delete (RODO Art. 17 erasure)
--
-- Operational state table tracking each ClickHouse erasure mutation issued by
-- POST /api/dsr/erase. One row per (DSR request, ClickHouse table) tuple —
-- we issue one mutation per PII-bearing table (events, adaptation_decisions,
-- llm_calls, session_quality), so a single DSR-erase request typically writes
-- 4 rows here.
--
-- Status transitions:
--   pending      → mutation issued, awaiting first poll
--   in_progress  → polled at least once, ClickHouse system.mutations.is_done = 0
--   done         → ClickHouse system.mutations.is_done = 1 and latest_failed_reason empty
--   failed       → ClickHouse system.mutations.latest_failed_reason non-empty AND retry_count = 3
--
-- The Vercel Cron poller (/api/dsr/mutation-poll, every 5 min) walks this table
-- and updates rows. When ALL rows for a given dsr_verification_id reach 'done'
-- (or 'failed'), the corresponding ClickHouse `dsr_audit_log` row's
-- clickhouse_mutation_status is updated to the aggregate state and
-- clickhouse_mutation_completed_at is stamped.
--
-- Idempotency: re-running POST /api/dsr/erase for an already-erased session
-- looks up rows here by (tenant_id, session_id). If any row exists and is not
-- in a terminal state, return its current status. If all rows are 'done',
-- return success immediately (no new mutations issued).
--
-- Retention: rows kept for 7 years per legal-claims retention basis (GDPR
-- Art. 17(3)(b)). NOT subject to DSR erasure itself — operational audit trail
-- of the erasure performed.
--
-- RLS: this table is operational; access scoped to the service role (cron
-- poller + DSR routes). No tenant_isolation policy — tenants do not read this
-- table directly.

CREATE TABLE IF NOT EXISTS "dsr_clickhouse_mutations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  -- Link back to the DSR verification record (and indirectly to the user).
  "dsr_verification_id" uuid NOT NULL,

  -- Replicated for fast lookups + idempotency checks without a join.
  "tenant_id" uuid NOT NULL,
  "session_id" text NOT NULL,

  -- ClickHouse table the mutation targets — 'events', 'adaptation_decisions',
  -- 'llm_calls', 'session_quality'. Free-text so adding tables doesn't require
  -- an enum migration.
  "table_name" text NOT NULL,

  -- ClickHouse mutation_id captured from system.mutations after ALTER TABLE.
  -- May be empty string until the first poll resolves it.
  "mutation_id" text NOT NULL DEFAULT '',

  -- Coarse status enum (enforced by check constraint).
  "status" text NOT NULL DEFAULT 'pending',

  -- Number of mutation retries attempted (0..3). Exponential backoff between.
  "retry_count" integer NOT NULL DEFAULT 0,

  -- Last failure reason from system.mutations.latest_failed_reason.
  "last_failed_reason" text,

  -- Backoff scheduling: poller will not retry before this timestamp.
  "next_retry_at" timestamp with time zone,

  -- Original ALTER TABLE SQL issued (for audit / replay).
  "alter_sql" text NOT NULL,

  "issued_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone,
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

ALTER TABLE "dsr_clickhouse_mutations"
  ADD CONSTRAINT "dsr_clickhouse_mutations_dsr_verification_id_fk"
  FOREIGN KEY ("dsr_verification_id") REFERENCES "public"."dsr_verifications"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "dsr_clickhouse_mutations"
  ADD CONSTRAINT "dsr_clickhouse_mutations_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "dsr_clickhouse_mutations"
  ADD CONSTRAINT "dsr_clickhouse_mutations_status_check"
  CHECK ("status" IN ('pending', 'in_progress', 'done', 'failed'));
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "dsr_clickhouse_mutations_tenant_session_idx"
  ON "dsr_clickhouse_mutations" USING btree ("tenant_id", "session_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "dsr_clickhouse_mutations_status_idx"
  ON "dsr_clickhouse_mutations" USING btree ("status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "dsr_clickhouse_mutations_verification_idx"
  ON "dsr_clickhouse_mutations" USING btree ("dsr_verification_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "dsr_clickhouse_mutations_next_retry_idx"
  ON "dsr_clickhouse_mutations" USING btree ("next_retry_at")
  WHERE "status" IN ('pending', 'in_progress', 'failed');
--> statement-breakpoint

-- RLS: service-role only. No tenant_isolation policy — this is an operational
-- audit trail not surfaced to tenants. Default behavior is no access without
-- bypassing RLS (service-role does).
ALTER TABLE "dsr_clickhouse_mutations" ENABLE ROW LEVEL SECURITY;
