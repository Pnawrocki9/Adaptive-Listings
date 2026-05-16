/**
 * tenant_compliance_records — stores executed Legitimate Interest Assessments (LIAs)
 * and any future compliance documents per tenant.
 *
 * One row per compliance record instance. Old records are never deleted (audit trail) —
 * they are soft-deleted by setting `metadata.deleted = true`. The latest non-deleted row
 * for a (tenant_id, record_type) pair is the active compliance record.
 *
 * record_type values: 'lia' (GDPR Art. 6(1)(f) Legitimate Interest Assessment)
 * version: template version string, e.g. 'lia-v1.0'
 *
 * RLS: tenant can SELECT only its own rows; only the backend service role can INSERT/UPDATE.
 * RLS policy is applied via the migration SQL file.
 *
 * TICKET-GDPR-003
 *
 * @module @estalara/db/schema/tenant_compliance_records
 */

import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const tenantComplianceRecords = pgTable(
  'tenant_compliance_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Foreign key → tenants.id. Cascade delete when the tenant is removed. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /**
     * Compliance document type. Current value: 'lia'.
     * Extensible for future compliance record types.
     */
    recordType: text('record_type').notNull(),
    /** Template version string, e.g. 'lia-v1.0'. Used to track which template was signed. */
    version: text('version').notNull(),

    // LIA-specific fields (populated for record_type = 'lia')
    /** Description of the legitimate interest being pursued. Minimum 50 characters. */
    purposeStatement: text('purpose_statement').notNull(),
    /** Justification for why processing is necessary to achieve the purpose. Minimum 50 chars. */
    necessityJustification: text('necessity_justification').notNull(),
    /** Conclusion of the balancing test (interests vs. data subject rights). */
    balancingConclusion: text('balancing_conclusion').notNull(),
    /** Description of the opt-out / objection mechanism provided to data subjects. */
    optoutMechanism: text('optout_mechanism').notNull(),

    // Signatory fields
    /** Full name of the person who signed/executed this compliance record. */
    signedByName: text('signed_by_name').notNull(),
    /** Email address of the signatory. */
    signedByEmail: text('signed_by_email').notNull(),
    /** Timestamp when the signatory executed this record. */
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),

    /**
     * Extensible metadata JSONB blob.
     * Key use cases:
     *   - `deleted: true` — soft delete flag (audit trail must never be physically removed)
     *   - Future: reviewer, review_at, notes
     */
    metadata: jsonb('metadata').default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_tenant_compliance_records_tenant_type').on(t.tenantId, t.recordType)],
);

export type TenantComplianceRecord = typeof tenantComplianceRecords.$inferSelect;
export type NewTenantComplianceRecord = typeof tenantComplianceRecords.$inferInsert;
