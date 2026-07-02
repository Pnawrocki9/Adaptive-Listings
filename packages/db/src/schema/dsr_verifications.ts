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

import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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

    /**
     * FOLLOW-184: Durable CRM lead_id for the data subject, if known at DSR initiation time.
     *
     * The CRM webhook writes `conversion_labels.lead_id` using an opaque pseudonymous token
     * supplied by the tenant (§T.6 Option i). That token is NOT the Estalara session_id —
     * the two identifiers live in different namespaces.
     *
     * When the tenant admin initiates a DSR for a data subject who has a CRM record, they
     * SHOULD supply this field so the erase cascade can reach CRM-written conversion_labels
     * rows (GDPR Art. 17 completeness).
     *
     * NULL = no durable CRM identity known; DSR erasure covers only SDK-ping labels
     *        (conversion_labels.lead_id = session_id path). This is safe and correct for
     *        sessions that pre-date CRM integration or where no CRM record exists.
     *
     * INVARIANT: this value is the SAME opaque token the tenant sent as `lead_id` in the
     * CRM webhook. It is NOT a CRM contact ID / email / PII — tenant is contractually
     * responsible for this (DPA clause + onboarding gate, §A.3).
     */
    durableLeadId: text('durable_lead_id'),

    /**
     * FOLLOW-455 / audit F-20: number of failed OTP-verification attempts
     * against this specific request. Incremented atomically on every wrong
     * guess. Once it reaches `MAX_OTP_ATTEMPTS` (see
     * `apps/control-plane/src/lib/dsr-verify.ts`) the row is locked — no
     * further verification attempts are accepted, even with the correct
     * code. This bounds the brute-force search space for a single request
     * to `MAX_OTP_ATTEMPTS` guesses instead of the full 6-digit (1e6) space.
     */
    attemptCount: integer('attempt_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('dsr_verifications_tenant_session_idx').on(t.tenantId, t.sessionId),
    index('dsr_verifications_otp_hash_idx').on(t.otpHash),
    index('dsr_verifications_expires_at_idx').on(t.expiresAt),
    index('dsr_verifications_tenant_email_created_idx').on(t.tenantId, t.email, t.createdAt),
  ],
);

export type DsrVerification = typeof dsrVerifications.$inferSelect;
export type NewDsrVerification = typeof dsrVerifications.$inferInsert;
