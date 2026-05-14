/**
 * answers — per-listing agency FAQ entries with semantic embeddings.
 *
 * Agency staff store question/answer pairs for each listing. The
 * `question_embedding` column (1536-dim, OpenAI text-embedding-3-small) enables
 * cosine-similarity RAG retrieval in the adapt route: the top-3 answers whose
 * questions are closest to the current session intent vector are injected into
 * the LLM prompt as `listingContext`.
 *
 * RLS: each tenant can only read/write its own rows (tenant_isolation policy).
 *
 * @module @estalara/db/schema/answers
 */

import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { vector } from './_pgvector.js';
import { tenants } from './tenants.js';

export const answers = pgTable(
  'answers',
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

    /** Agency-authored question, e.g. "What is the rental yield?" */
    question: text('question').notNull(),

    /** Agency-authored answer, e.g. "6.5% gross yield based on current market rent." */
    answer: text('answer').notNull(),

    /**
     * 1536-dim OpenAI text-embedding-3-small vector for the `question` field.
     * Generated (and re-generated on question update) by the CRUD API route.
     * Used for cosine-similarity RAG at adapt time.
     */
    questionEmbedding: vector('question_embedding', 1536),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_answers_tenant_listing').on(t.tenantId, t.listingId)],
);

export type Answer = typeof answers.$inferSelect;
export type NewAnswer = typeof answers.$inferInsert;
