/**
 * users — RBAC for agency staff and Estalara employees.
 *
 * Two role axes are mutually exclusive:
 *  - Agency users: have tenant_id + agency_role, estalara_staff = false
 *  - Estalara staff: have estalara_staff = true + estalara_role, tenant_id = null
 *
 * Brute-force lockout (V.2.3): failed_login_count incremented per failure;
 * locked_until set to now() + backoff when threshold exceeded.
 * Sudo mode (V.2.5): last_sudo_auth_at tracks re-authentication for sensitive ops.
 *
 * @module @estalara/db/schema/users
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    fullName: text('full_name'),

    // Agency user fields (null for Estalara staff)
    /** Foreign key → tenants.id. Null for Estalara staff accounts. */
    tenantId: uuid('tenant_id'),
    /** 'agency:owner' | 'agency:admin' | 'agency:viewer' */
    agencyRole: text('agency_role'),

    // Estalara staff fields (null for agency users)
    estalaraStaff: boolean('estalara_staff').notNull().default(false),
    /** 'estalara:superadmin' | 'estalara:ops' | 'estalara:readonly' */
    estalaraRole: text('estalara_role'),

    // MFA
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaVerifiedAt: timestamp('mfa_verified_at', { withTimezone: true }),

    // Session security
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastLoginIp: text('last_login_ip'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    /** Brute-force lockout expiry. Null = not locked. */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),

    // Sudo mode (V.2.5)
    lastSudoAuthAt: timestamp('last_sudo_auth_at', { withTimezone: true }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete — null means active. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_idx').on(t.email),
    index('users_tenant_id_idx').on(t.tenantId),
    index('users_estalara_staff_idx')
      .on(t.estalaraStaff)
      .where(sql`${t.estalaraStaff} = true`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
