/**
 * engagement_scores — per-session engagement intensity score.
 *
 * Stores a normalised engagement score (0–1) computed by the Modal intent engine
 * from behavioral signals (dwell, interaction, scroll). Surfaced to tenants in
 * the analytics dashboard. Included in the GDPR Art. 17 DSR erasure cascade
 * (DPIA §8 line 773; ROPA Activity 13).
 *
 * Retention: 90 days from last active event (enforced by a TTL cron — FOLLOW-193
 * AC1 / FOLLOW-193 mutation-poll restore). Deleted synchronously inside the
 * Drizzle erasure transaction in `apps/control-plane/src/app/api/dsr/erase/route.ts`.
 *
 * RLS: tenant isolation on tenant_id (mirrors session_embeddings).
 *
 * @module @estalara/db/schema/engagement_scores
 */

import { index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const engagementScores = pgTable(
  'engagement_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Foreign key → tenants.id (RLS scope). */
    tenantId: uuid('tenant_id').notNull(),

    /** Matches the SDK session fingerprint hash (SHA-256, 64 hex chars). */
    sessionId: text('session_id').notNull(),

    /**
     * Normalised engagement intensity score in [0, 1].
     * Computed by the Modal intent engine from dwell_score,
     * interaction_score, and scroll_score.
     */
    engagementScore: numeric('engagement_score', { precision: 6, scale: 5 }),

    /** Fraction of time the listing was in the viewport (0–1). */
    dwellScore: numeric('dwell_score', { precision: 6, scale: 5 }),

    /** Normalised click + hover interaction rate (0–1). */
    interactionScore: numeric('interaction_score', { precision: 6, scale: 5 }),

    /** Normalised scroll depth (0–1). */
    scrollScore: numeric('scroll_score', { precision: 6, scale: 5 }),

    /** When this score was last computed. */
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('engagement_scores_tenant_session_idx').on(t.tenantId, t.sessionId),
    index('engagement_scores_tenant_id_idx').on(t.tenantId),
    index('engagement_scores_computed_at_idx').on(t.computedAt),
  ],
);

export type EngagementScore = typeof engagementScores.$inferSelect;
export type NewEngagementScore = typeof engagementScores.$inferInsert;
