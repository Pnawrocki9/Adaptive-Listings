/**
 * staff_audit_log — immutable record of all Estalara admin actions.
 *
 * This table is APPEND-ONLY. Rows are never updated or deleted.
 * Retention: 7 years (GDPR Art. 30 + enterprise contractual requirement, Master Design V.5).
 * RLS is NOT enabled — accessed exclusively via service role (Estalara staff only).
 *
 * Example action values:
 *   'tenant.approved' | 'tenant.suspended' | 'tenant.canceled'
 *   'demo.force_stopped' | 'impersonation.started' | 'impersonation.ended'
 *   'subscription.changed' | 'profile_mode.enabled' | 'profile_mode.disabled'
 *   'api_key.revoked' | 'user.locked' | 'user.unlocked'
 *
 * @module @estalara/db/schema/staff_audit_log
 */

import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const staffAuditLog = pgTable(
  'staff_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Foreign key → users.id. The Estalara staff member who performed the action. */
    adminUserId: uuid('admin_user_id').notNull(),

    action: text('action').notNull(),

    /** Tenant affected by the action, if applicable. */
    targetTenantId: uuid('target_tenant_id'),
    /** User affected by the action, if applicable. */
    targetUserId: uuid('target_user_id'),

    /** Structured action details — schema varies per action type. */
    payload: jsonb('payload'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    /** Immutable creation timestamp. No updated_at — this table is append-only. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('staff_audit_log_admin_idx').on(t.adminUserId),
    index('staff_audit_log_tenant_idx').on(t.targetTenantId),
    index('staff_audit_log_action_idx').on(t.action),
    index('staff_audit_log_created_at_idx').on(t.createdAt),
  ],
);

export type StaffAuditLogEntry = typeof staffAuditLog.$inferSelect;
export type NewStaffAuditLogEntry = typeof staffAuditLog.$inferInsert;
