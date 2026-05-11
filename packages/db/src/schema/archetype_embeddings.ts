/**
 * archetype_embeddings — global archetype embedding vectors.
 *
 * Stores pre-computed OpenAI text-embedding-3-small vectors (1024 dims)
 * for each named archetype. Used for cosine similarity matching during
 * cold-start sessions (before quiz or sufficient behavioral signals).
 *
 * These are cross-tenant, DP-protected aggregate embeddings.
 * Updated by the Archetype Update Job (Modal, daily).
 *
 * @module @estalara/db/schema/archetype_embeddings
 */

import { boolean, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { vector } from './_pgvector.js';

export const archetypeEmbeddings = pgTable('archetype_embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),

  /** 'investor' | 'family' | 'neutral' | future archetypes. Unique. */
  archetypeName: text('archetype_name').notNull().unique(),

  /** Human-readable description used to seed the embedding generation. */
  description: text('description').notNull(),

  /** 1024-dim OpenAI text-embedding-3-small vector. */
  embedding: vector('embedding', 1024),

  /** Min cosine similarity required to assign this archetype (0.0–1.0). */
  confidenceThreshold: numeric('confidence_threshold', { precision: 4, scale: 3 }).default('0.600'),

  /** How many sessions contributed to this archetype embedding. */
  sampleCount: integer('sample_count').notNull().default(0),

  /** Soft disable — set false to exclude from matching without deleting. */
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ArchetypeEmbedding = typeof archetypeEmbeddings.$inferSelect;
export type NewArchetypeEmbedding = typeof archetypeEmbeddings.$inferInsert;
