/**
 * api_keys — public and secret keys issued to tenants for SDK + server-side auth.
 *
 * Keys are never stored in plaintext. Only argon2id hash + last 4 chars are kept.
 * Key lifecycle: active → rotated (rotated_at set) → revoked (revoked_at set).
 *
 * @module @estalara/db/schema/api_keys
 */

import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Foreign key → tenants.id. */
    tenantId: uuid('tenant_id').notNull(),

    /** 'public' — used in SDK snippet | 'secret' — server-side only */
    type: text('type').notNull(),
    /** Key prefix for display, e.g. 'est_live_' | 'est_test_' */
    prefix: text('prefix').notNull(),
    /** argon2id hash of the raw key. */
    hashedKey: text('hashed_key').notNull().unique(),
    /** Last 4 characters of the raw key for identification in UI. */
    last4: text('last_4').notNull(),

    /** e.g. ['read:events', 'write:adaptations'] */
    scopes: text('scopes').array().notNull().default([]),
    /** CORS allowlist for this specific key (null = inherit tenant allowedOrigins). */
    allowedOrigins: text('allowed_origins').array(),

    /** Foreign key → users.id. Null if created programmatically. */
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /** Set when key is rotated (superseded by a new key). */
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    /** Set when key is permanently revoked. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    index('api_keys_tenant_id_idx').on(t.tenantId),
    uniqueIndex('api_keys_hashed_key_idx').on(t.hashedKey),
    index('api_keys_active_idx')
      .on(t.revokedAt)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
