/**
 * intent_sessions — K.3.6 Archetype Identification Tracer: session-level accumulator.
 *
 * Tracks the lifecycle of a single buyer session's archetype inference state.
 * This table is the mutable "head" for the K.3.6 tracer — it accumulates signals
 * and resolves to a final archetype when enough confidence is gathered.
 *
 * The granular, append-only per-signal event trail lives in ClickHouse `intent_events`
 * (infra/clickhouse/migrations/0014_intent_events.sql). This Postgres table holds the
 * mutable aggregate state so the control plane can UPSERT on every signal without
 * needing to replay the full ClickHouse log.
 *
 * Writer: FOLLOW-266 Phase 2 (backend-engineer) — POST /api/intent/event CF Worker
 * and the SDK intent-engine → control-plane sync path.
 *
 * RLS: tenant isolation on tenant_id (mirrors conversion_labels, engagement_scores).
 *
 * @module @estalara/db/schema/intent-sessions
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const intentSessions = pgTable(
  'intent_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Foreign key → tenants.id. Cascade delete when the tenant is removed. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /**
     * SDK anonymous session fingerprint (SHA-256 hex, 64 chars).
     * Joins this session back to the behavioral event stream in ClickHouse.
     */
    sessionId: text('session_id').notNull(),

    /**
     * Durable cross-session identifier stored in localStorage (90-day TTL, per §13.2).
     * Null until the SDK has an established cross-session identity.
     */
    crossSessionId: text('cross_session_id'),

    /** When the first signal arrived for this session. */
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),

    /** Updated on every signal; used for recency sorting and TTL enforcement. */
    lastEventAt: timestamp('last_event_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Set when confidence crosses the resolution threshold (null until finalized).
     * Index on (tenant_id, finalized_at DESC NULLS FIRST) supports dashboard queries.
     */
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),

    /**
     * The resolved archetype label — one of the 17 non-neutral leaf archetypes or 'neutral'.
     * Null until finalized. Plain text (the repo does not use pgEnum; validated at the API layer).
     */
    finalArchetype: text('final_archetype'),

    /**
     * Resolved confidence score in [0.000, 1.000]. numeric(4,3).
     * Null until finalized.
     */
    finalConfidence: numeric('final_confidence', { precision: 4, scale: 3 }),

    /** Running count of signals (behavioral events, quiz answers, chat turns) processed. */
    signalCount: integer('signal_count').notNull().default(0),

    /** True when the quiz widget reached a leaf node this session. */
    quizCompleted: boolean('quiz_completed').notNull().default(false),

    /**
     * The archetype leaf resolved by the quiz (null until quiz_completed is true).
     * Provided by the POST /api/quiz/completion route (FOLLOW-200).
     */
    quizLeaf: text('quiz_leaf'),

    /** Count of buyer chat turns observed this session (incremented on each chat signal). */
    chatTurns: integer('chat_turns').notNull().default(0),

    /**
     * Full archetype weight distribution in JSONB (mirrors the SDK-side IntentState envelope).
     * Updated on every signal via UPSERT. Null until the first signal arrives.
     * Schema: { weights: Record<archetype, number>, topArchetype: string, confidence: number }
     */
    intentState: jsonb('intent_state'),
  },
  (t) => [
    unique('intent_sessions_tenant_session_unique').on(t.tenantId, t.sessionId),
    index('idx_intent_sessions_tenant_last_event').on(t.tenantId, t.lastEventAt),
    index('idx_intent_sessions_tenant_finalized').on(t.tenantId, t.finalizedAt),
  ],
);

export type IntentSession = typeof intentSessions.$inferSelect;
export type NewIntentSession = typeof intentSessions.$inferInsert;
