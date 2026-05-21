/**
 * listing_embeddings — per-tenant, per-listing embedding vectors.
 *
 * Stores OpenAI text-embedding-3-small vectors (1024 dims, Matryoshka-truncated)
 * computed from concatenated listing text fields (title, description, price,
 * location). Used by the adapt path to compute real archetype-listing affinity
 * via cosine similarity against `archetype_embeddings`, replacing the legacy
 * djb2 hash deterministic score (FOLLOW-019).
 *
 * Embeddings are nullable: a row may exist before its vector has been computed
 * (race condition between ingest and embedding compute). The adapt path
 * gracefully falls back to djb2 for null embeddings.
 *
 * RLS: each tenant can read/write only its own rows.
 *
 * @module @estalara/db/schema/listing_embeddings
 */

import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { vector } from './_pgvector.js';
import { tenants } from './tenants.js';

export const listingEmbeddings = pgTable(
  'listing_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Foreign key → tenants.id.
     * Cascade delete when the tenant is removed.
     */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /**
     * External listing identifier (tenant-defined, no FK to a listings table).
     * Tenants use their own opaque IDs (MLS number, CRM ID, etc.).
     */
    listingId: text('listing_id').notNull(),

    /**
     * 1024-dim OpenAI text-embedding-3-small vector for the concatenated
     * listing text fields. Nullable — a row may exist before the vector
     * has been computed. Adapt path falls back to djb2 when null.
     */
    embedding: vector('embedding', 1024),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('listing_embeddings_tenant_listing_uniq').on(t.tenantId, t.listingId),
    index('listing_embeddings_tenant_id_idx').on(t.tenantId),
  ],
);

export type ListingEmbedding = typeof listingEmbeddings.$inferSelect;
export type NewListingEmbedding = typeof listingEmbeddings.$inferInsert;
