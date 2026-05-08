/**
 * consent_records — generic consent tracking for all consent types.
 *
 * Designed for forward-compatibility with Profile Mode (U.11.6, Sprint 12+).
 * All subject identification is ANONYMOUS — session_id (fingerprint hash) only.
 * No PII is stored directly; ip_address is encrypted at the application layer before insert.
 *
 * Current consent_type values: 'behavioral_tracking' | 'quiz_completion'
 * Future (Profile Mode, Sprint 12+):
 *   'profile_creation' | 'phone_contact' | 'email_contact' | 'team_sharing'
 *
 * profile_id column is null in MVP; an index will be added in the Sprint 12+ migration
 * when Profile Mode is activated.
 *
 * @module @estalara/db/schema/consent_records
 */

import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Foreign key → tenants.id. Which agency's site generated this consent event. */
    tenantId: uuid('tenant_id').notNull(),

    // Subject identification — anonymous
    /** Anonymous fingerprint hash from the SDK. 32–64 chars. Never contains PII. */
    sessionId: text('session_id').notNull(),
    /** Null in MVP. Populated in Sprint 12+ Profile Mode. */
    profileId: uuid('profile_id'),

    // Consent details
    /**
     * Consent category. Current values: 'behavioral_tracking' | 'quiz_completion'.
     * Future (Sprint 12+): 'profile_creation' | 'phone_contact' | 'email_contact' | 'team_sharing'
     */
    consentType: text('consent_type').notNull(),
    /** true = granted, false = explicitly denied/withdrawn */
    granted: boolean('granted').notNull(),

    // Legal proof
    /** Version string of the Terms of Service shown at consent time. */
    tosVersion: text('tos_version').notNull(),
    /** SHA-256 hex of the exact consent text displayed to the user. */
    consentTextHash: text('consent_text_hash'),
    /** Encrypted at application layer before insert. Never stored as plaintext. */
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    // Timestamps
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    /** Null = consent still active. Set when user revokes. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('consent_records_tenant_session_idx').on(t.tenantId, t.sessionId),
    index('consent_records_type_idx').on(t.consentType),
    index('consent_records_granted_at_idx').on(t.grantedAt),
  ],
);

export type ConsentRecord = typeof consentRecords.$inferSelect;
export type NewConsentRecord = typeof consentRecords.$inferInsert;
