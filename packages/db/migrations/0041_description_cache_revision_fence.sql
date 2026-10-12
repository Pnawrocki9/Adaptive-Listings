-- Migration: 0041_description_cache_revision_fence
-- FOLLOW-1291 (WP-2.6 amendment, Codex WP11 F-03/F-17): a revision fence and model identity for
-- every writer of description_cache_persistent.
--
-- The two defects this closes:
--   F-03  A generation job grounded on a listing BEFORE an update could complete AFTER the
--         listing.updated webhook had invalidated the cache, and its callback inserted a fresh,
--         active row - the withdrawn fact was served again, permanently.
--   F-17  The active-row uniqueness key ignored `model`, and the callback invalidated every
--         model's active row before inserting its own: an old callback from a DIFFERENT model
--         destroyed the row the read path (model-scoped since FOLLOW-464) was serving.
--
-- Revision source (declared; there is no authoritative upstream revision):
--   The listing-details backend exposes no updated_at, version or ETag, and our Postgres has no
--   listings table. The only change signal we receive is POST /api/webhooks/listing-updated. So
--   the revision is LOCAL: `listing_revisions.revision`, a per-(tenant, listing) counter the
--   webhook advances. A listing that was never updated has no row and is at revision 0.
--   Upstream lag: the fence is exactly as fresh as that webhook. If the backend sends the webhook
--   before it serves the new text (read-your-write lag at the source), a job started in that gap
--   grounds on the OLD text and is stamped with the NEW revision; the fence cannot see that, and
--   the row stands until the next listing.updated. Sending the webhook after the new text is
--   readable is the upstream's half of the contract (MASTER_DESIGN E.7.3).
--
-- What this migration adds (all additive, safe on the live table):
--   1. listing_revisions - new table, PK (tenant_id, listing_id), RLS tenant isolation (same
--      policy shape as description_cache_persistent, 0023).
--   2. description_cache_persistent.listing_revision bigint NOT NULL DEFAULT 0 - a constant
--      default is a catalog-only change on Postgres 11+ (no table rewrite). Every existing row is
--      revision 0, which is the current revision of every listing (listing_revisions starts
--      empty), so nothing that is served today stops being served.
--   3. The active-row unique index gains `model` (F-17). It is CREATED before the old one is
--      DROPPED. The new key is a superset of the old one's columns, so every set of rows that
--      satisfied the old index satisfies the new one: the CREATE cannot fail on existing data.
--      Not CONCURRENTLY: the Drizzle migrator runs each file inside a transaction, where
--      CONCURRENTLY is not allowed. The table holds one row per generated
--      (listing, archetype, locale, model) - small - so the SHARE lock lasts milliseconds.
--
-- Deploy window (PG migrations auto-apply to prod on merge via db-migrate.yml; Vercel and the
-- Modal deploy run alongside):
--   * Migration first, old code still live: the old writer invalidates every active row of the
--     (tenant, listing, archetype, locale) before inserting, so it never creates two active rows
--     for one key under either index. The old reader ignores the new column. Safe.
--   * New code first, migration not yet applied: the new reader's query names listing_revisions
--     and fails; the reader is fail-open (miss), and the miss path fails CLOSED when it cannot read
--     the revision - it serves template_fallback (the seller's copy) and does NOT enqueue a
--     generation. The callback answers 500 and the Modal job logs it. No unchecked or stale copy
--     can be served in either order.
--
-- Forward-only.

CREATE TABLE IF NOT EXISTS listing_revisions (
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  listing_id  text        NOT NULL,
  -- Advanced by +1 on every listing.updated webhook for this (tenant, listing).
  revision    bigint      NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, listing_id)
);

ALTER TABLE listing_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY listing_revisions_tenant_isolation
  ON listing_revisions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- The listing revision the row's text was grounded at (the revision the description route read
-- BEFORE it fetched the grounding source for the job that produced it).
ALTER TABLE description_cache_persistent
  ADD COLUMN IF NOT EXISTS listing_revision bigint NOT NULL DEFAULT 0;

-- F-17: one active row per (tenant, listing, archetype, locale, MODEL) - the read key.
CREATE UNIQUE INDEX IF NOT EXISTS description_cache_persistent_active_model_uniq
  ON description_cache_persistent (tenant_id, listing_id, archetype, locale, model)
  WHERE invalidated_at IS NULL;

DROP INDEX IF EXISTS description_cache_persistent_active_uniq;
