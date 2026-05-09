/**
 * demo_sessions — tracks active and historical Demo Mode sessions per tenant.
 *
 * Created when an agency activates Demo Mode from their back office. Revoked
 * when they stop it, when the session expires, or when an admin force-stops it.
 * The SDK validates demo activation via URL param, cookie, or localStorage
 * by checking the token hash against this table.
 *
 * @module @estalara/db/schema/demo_sessions
 */

import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const demoSessions = pgTable(
  'demo_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Foreign key → tenants.id */
    tenantId: uuid('tenant_id').notNull(),

    // Session configuration
    /** 'mockup' | 'production' */
    scope: text('scope').notNull(),
    /** 'self' | 'shareable' */
    visibility: text('visibility').notNull(),
    /** 'session' | '24h' | '7d' */
    duration: text('duration').notNull(),

    // Token storage (never store raw JWT — only the hash for revocation lookup)
    /** SHA-256 hash of the signed JWT. Used for revocation checks. */
    tokenHash: text('token_hash').notNull().unique(),
    /** Full shareable URL with ?demo=<token> — only set when visibility='shareable'. */
    shareableLink: text('shareable_link'),

    // Lifecycle
    /** Foreign key → users.id. The agency user who started the demo session. */
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Null means session is still active (not revoked). */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** 'user_stopped' | 'expired' | 'admin_force' */
    revokeReason: text('revoke_reason'),

    // Metadata
    /** Which domain the demo is active on (only applicable when scope='production'). */
    productionDomain: text('production_domain'),
    /** Currently selected persona — updated on persona switch. */
    personaId: text('persona_id'),
  },
  (t) => [
    index('demo_sessions_tenant_id_idx').on(t.tenantId),
    uniqueIndex('demo_sessions_token_hash_idx').on(t.tokenHash),
    index('demo_sessions_created_at_idx').on(t.createdAt),
    index('demo_sessions_active_idx')
      .on(t.tenantId, t.revokedAt)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

export type DemoSessionRow = typeof demoSessions.$inferSelect;
export type NewDemoSession = typeof demoSessions.$inferInsert;
