/**
 * session_embeddings — per-session behavioral embedding + archetype match.
 *
 * Each row stores the embedding vector computed for one anonymous session,
 * plus the archetype it was matched to via cosine similarity against
 * `archetype_embeddings`. When the quiz is answered, `quiz_archetype` is
 * populated and `final_archetype` is reconciled (quiz overrides).
 *
 * @module @estalara/db/schema/session_embeddings
 */

import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { vector } from './_pgvector.js';

export const sessionEmbeddings = pgTable(
  'session_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Foreign key → tenants.id (RLS scope). */
    tenantId: uuid('tenant_id').notNull(),

    /** Matches the SDK session fingerprint hash (SHA-256, 64 hex chars). */
    sessionId: text('session_id').notNull(),

    /** 1024-dim behavioral embedding for this session. */
    embedding: vector('embedding', 1024),

    /** Result of cosine similarity match against archetype_embeddings. */
    matchedArchetype: text('matched_archetype'),

    /** 0.0–1.0 cosine similarity score from the match. */
    similarityScore: numeric('similarity_score', { precision: 6, scale: 5 }),

    /** Count of behavioral signals processed when the embedding was last refreshed. */
    signalCount: integer('signal_count').notNull().default(0),

    /** Self-declared archetype from quiz, if quiz answered. */
    quizArchetype: text('quiz_archetype'),

    /** Reconciled archetype: quiz_archetype if set, otherwise matched_archetype. */
    finalArchetype: text('final_archetype'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('session_embeddings_tenant_session_idx').on(t.tenantId, t.sessionId),
    index('session_embeddings_matched_archetype_idx').on(t.matchedArchetype),
    index('session_embeddings_created_at_idx').on(t.createdAt),
  ],
);

export type SessionEmbedding = typeof sessionEmbeddings.$inferSelect;
export type NewSessionEmbedding = typeof sessionEmbeddings.$inferInsert;
