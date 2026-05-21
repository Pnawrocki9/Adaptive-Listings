-- Migration: 0013_listing_embeddings
-- FOLLOW-019 — Real archetype-listing affinity scoring.
--
-- Creates the `listing_embeddings` table for per-tenant, per-listing 1024-dim
-- OpenAI text-embedding-3-small vectors. Used by the adapt path to compute
-- cosine similarity against archetype_embeddings, replacing the legacy djb2
-- deterministic hash in apps/decision-api/src/lib/reorder.ts (and its
-- duplicate in apps/control-plane/src/app/api/adapt/route.ts).
--
-- The embedding column is NULLABLE: a row may exist before its vector has
-- been computed. Adapt path falls back to djb2 for null embeddings, so
-- graceful degradation is preserved end-to-end.
--
-- Requires the pgvector extension (CREATE EXTENSION IF NOT EXISTS vector) to be
-- enabled in the database before applying this migration. Already enabled by
-- prior migration 0006_answers; the IF NOT EXISTS makes it idempotent.
--
-- RLS: tenant_isolation policy applied below using the modern
-- current_setting('request.jwt.claims', true) pattern per CLAUDE.md spec
-- (matches 0012_rls_policies and 0011_aromatic_triton style).
--
-- Forward-only migration. [FOLLOW-019]

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "listing_embeddings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "listing_id" text NOT NULL,
  "embedding" vector(1024),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "listing_embeddings"
  ADD CONSTRAINT "listing_embeddings_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "listing_embeddings"
  ADD CONSTRAINT "listing_embeddings_tenant_listing_uniq"
  UNIQUE ("tenant_id", "listing_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "listing_embeddings_tenant_id_idx"
  ON "listing_embeddings" USING btree ("tenant_id");
--> statement-breakpoint

-- RLS: tenant isolation policy (matches 0012_rls_policies pattern)
ALTER TABLE "listing_embeddings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "listing_embeddings: tenant isolation"
    ON "listing_embeddings" FOR ALL TO authenticated
    USING (
      tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid
    )
    WITH CHECK (
      tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
