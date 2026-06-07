/**
 * quiz_completions — MOAT training data for the quiz → archetype label chain.
 *
 * Every quiz completion links (session signals → quiz path → resolved archetype →
 * adaptation → conversion) into a durable training row. Without this table the full
 * label chain is permanently lost. This table is the foundation for per-tenant
 * fine-tuning of the archetype classifier (TALLRec/LoRA, Master_Design §D.5.7, §E.4.8).
 *
 * Written by POST /api/quiz/completion (FOLLOW-200) whenever the SDK quiz widget
 * reaches a leaf node and calls back to the control plane.
 *
 * RLS: tenant isolation on tenant_id (mirrors engagement_scores, conversion_labels).
 *
 * @module @estalara/db/schema/quiz_completions
 */

import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const quizCompletions = pgTable(
  'quiz_completions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Foreign key → tenants.id. Cascade delete when the tenant is removed. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /**
     * SDK anonymous session fingerprint (SHA-256 hex, 64 chars).
     * Joins this completion back to the behavioral signal stream.
     */
    sessionId: text('session_id').notNull(),

    /**
     * Resolved leaf archetype — one of the 17 non-neutral leaf archetypes or 'neutral'
     * (for Q1-D skip). Plain text (repo does not use pgEnum); taxonomy validated at the
     * API layer via the quiz-widget archetype union.
     */
    resolvedArchetype: text('resolved_archetype').notNull(),

    /**
     * Decision tree branch taken at Q1:
     *   'INWESTOR'     — investor path (6 leaf archetypes)
     *   'OWN_USE'      — own-use path  (6 leaf archetypes)
     *   'CROSS_BORDER' — cross-border path (5 leaf archetypes)
     *   null           — Q1-D skip → resolved_archetype = 'neutral'
     */
    branch: text('branch'),

    /**
     * Q1 gate answer index (0-based). Always present when branch is non-null.
     * Nullable to handle the neutral / pre-Q1 edge case.
     */
    q1Answer: integer('q1_answer'),

    /**
     * Q2 answer index (0-based). Present when the decision tree reached Q2.
     * Nullable for branches where Q2 was not shown.
     */
    q2Answer: integer('q2_answer'),

    /**
     * Q3 answer index (0-based). Present when the decision tree reached Q3
     * (currently only INWESTOR branch has a Q3).
     * Nullable for all branches where Q3 was not shown.
     */
    q3Answer: integer('q3_answer'),

    /**
     * Quiz locale at completion time — matches SDK config.language.
     * Constrained to 'en' | 'pl' | 'es' at the API layer.
     */
    language: text('language').notNull().default('en'),

    /** When the quiz completion was recorded. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('quiz_completions_tenant_id_idx').on(t.tenantId),
    index('quiz_completions_session_id_idx').on(t.sessionId),
    index('quiz_completions_tenant_archetype_idx').on(t.tenantId, t.resolvedArchetype),
  ],
);

export type QuizCompletion = typeof quizCompletions.$inferSelect;
export type NewQuizCompletion = typeof quizCompletions.$inferInsert;
