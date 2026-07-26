/**
 * api_keys — public and secret keys issued to tenants for SDK + server-side auth.
 *
 * Keys are never stored in plaintext. Only SHA-256(rawKey) hex digest + last 4
 * chars are kept. Key lifecycle: active → rotated (rotated_at set) → revoked
 * (revoked_at set). The hashed_key column has a unique index enabling O(1)
 * bearer-token → tenant resolution (see ADR-0015).
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
    /** SHA-256(rawKey) hex digest. Used for O(1) bearer→row resolution. See ADR-0015. */
    hashedKey: text('hashed_key').notNull().unique(),
    /** Last 4 characters of the raw key for identification in UI. */
    last4: text('last_4').notNull(),

    /** e.g. ['read:events', 'write:adaptations'] */
    scopes: text('scopes').array().notNull().default([]),
    /**
     * CORS allowlist for this specific key (null = inherit tenant allowedOrigins).
     *
     * The per-tenant browser-`Origin` allow-list is ENFORCED as of FOLLOW-642 (2026-07-25).
     * Enforcement lives in the ingest Worker, which reads its tenant projection from
     * `KV_API_KEYS` (`ApiKeyRecord.allowed_origins`), NOT directly from this Postgres column
     * — ingest has no Postgres binding. `null` here means "inherit the tenant-level list"
     * (`tenants.allowed_origins`), which is the precedence the projection script applies.
     *
     * The projection onto KV is NOT automatic (corrected by FOLLOW-658 — the earlier wording
     * asserted it happened "at provisioning" and no such code existed). It is an explicit
     * operator step: `apps/control-plane/scripts/project-allowed-origins.mts`, documented in
     * `docs/runbooks/BRAND_PROVISIONING.md` §Step 6. Nothing in this repo writes `KV_API_KEYS`
     * at runtime.
     */
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
