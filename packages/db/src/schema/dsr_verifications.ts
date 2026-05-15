/**
 * dsr_verifications — OTP records for Data Subject Rights request verification.
 *
 * Each row represents a single DSR request initiated by a tenant admin on behalf
 * of a data subject. The 6-digit OTP is hashed (SHA-256) before storage — the raw
 * OTP is never persisted.
 *
 * Flow:
 *   1. Tenant admin calls POST /api/dsr/initiate — row inserted with otp_hash and
 *      a 15-minute TTL stored in expires_at.
 *   2. Data subject receives OTP email, submits it to the access / erase / portability
 *      endpoint.
 *   3. Endpoint verifies hash, checks expiry and used_at, then marks used_at = now().
 *
 * RLS: tenant_isolation policy applied via migration SQL (same pattern as other tables).
 *
 * @module @estalara/db/schema/dsr_verifications
 */

import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const dsrVerifications = pgTable(
  'dsr_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Foreign key → tenants.id. Cascade delete when the tenant is removed. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /** The anonymous session fingerprint hash this DSR applies to. */
    sessionId: text('session_id').notNull(),

    /** Email address the OTP was sent to (stored for audit purposes only). */
    email: text('email').notNull(),

    /**
     * Type of DSR requested.
     * Values: 'access' | 'erase' | 'portability'
     */
    dsrType: text('dsr_type').notNull(),

    /** SHA-256 hex of the 6-digit OTP. Never store the raw OTP. */
    otpHash: text('otp_hash').notNull(),

    /** When the OTP expires — now() + 15 minutes at insert time. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /** Null until the OTP is successfully consumed. Set to now() on first use. */
    usedAt: timestamp('used_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('dsr_verifications_tenant_session_idx').on(t.tenantId, t.sessionId),
    index('dsr_verifications_otp_hash_idx').on(t.otpHash),
    index('dsr_verifications_expires_at_idx').on(t.expiresAt),
  ],
);

export type DsrVerification = typeof dsrVerifications.$inferSelect;
export type NewDsrVerification = typeof dsrVerifications.$inferInsert;
