/**
 * tenant_registrations — inbound agency sign-up requests awaiting approval.
 *
 * Records are created by the public onboarding form (U.3 Magic Link wizard).
 * On approval, a tenant row is created and tenant_id set here.
 * This table is accessed via service role only (no RLS).
 *
 * @module @estalara/db/schema/tenant_registrations
 */

import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const tenantRegistrations = pgTable(
  'tenant_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Form data
    agencyName: text('agency_name').notNull(),
    websiteUrl: text('website_url').notNull(),
    contactName: text('contact_name').notNull(),
    contactEmail: text('contact_email').notNull(),
    contactPhone: text('contact_phone'),
    country: text('country').notNull(),
    /** '<100' | '100-1000' | '1000+' */
    listingsVolume: text('listings_volume'),
    referralSource: text('referral_source'),

    // Approval workflow
    /** 'pending' | 'approved' | 'rejected' | 'needs_info' */
    status: text('status').notNull().default('pending'),
    /** Set to the created tenant.id on approval. */
    tenantId: uuid('tenant_id'),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),

    // Request metadata
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tenant_registrations_status_idx').on(t.status),
    index('tenant_registrations_email_idx').on(t.contactEmail),
    index('tenant_registrations_created_at_idx').on(t.createdAt),
  ],
);

export type TenantRegistration = typeof tenantRegistrations.$inferSelect;
export type NewTenantRegistration = typeof tenantRegistrations.$inferInsert;
