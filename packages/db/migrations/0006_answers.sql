-- Migration: 0006_answers
-- TICKET-AGENCY-001 — Agency Answers RAG Pipeline
--
-- Creates the `answers` table for agency staff to store per-listing FAQ/metadata.
-- The `question_embedding` column (1536-dim, OpenAI text-embedding-3-small) enables
-- cosine-similarity RAG retrieval at adapt time: top-3 most-relevant answers are
-- injected into the LLM prompt as `listingContext`.
--
-- Requires the pgvector extension (CREATE EXTENSION IF NOT EXISTS vector) to be
-- enabled in the database before applying this migration.
--
-- Forward-only migration. TICKET-AGENCY-001.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS answers (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  listing_id          TEXT        NOT NULL,
  question            TEXT        NOT NULL,
  answer              TEXT        NOT NULL,
  question_embedding  vector(1536) NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_answers_tenant_listing
  ON answers(tenant_id, listing_id);

-- RLS: tenants can read/write only their own rows.
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "answers: tenant isolation"
  ON answers FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
