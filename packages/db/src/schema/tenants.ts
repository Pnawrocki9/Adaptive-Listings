/**
 * tenants — one row per agency account.
 *
 * Plans map to SDK integration tiers (observer / augment / native).
 * Profile Mode (U.11) is a master-admin-gated POST-MVP feature; the gate columns
 * are included here for forward-compatibility but must default to false.
 *
 * @module @estalara/db/schema/tenants
 */

import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** URL-safe identifier, e.g. "marbella-premium". */
    slug: text('slug').notNull().unique(),
    /** 'pending' | 'active' | 'suspended' | 'canceled' */
    status: text('status').notNull().default('pending'),
    /** 'free' | 'observer' | 'augment' | 'native' */
    plan: text('plan').notNull().default('free'),

    /** Domains where the Estalara SDK snippet is permitted to run. */
    allowedOrigins: text('allowed_origins').array().notNull().default([]),

    /** White-label colors, fonts, logo overrides. */
    brandConfig: jsonb('brand_config').default({}),
    /** E.4 investor quiz configuration (questions, decay logic, Bayesian prior). */
    quizConfig: jsonb('quiz_config').default({}),

    // Profile Mode gate — U.11, POST-MVP, master-admin gated
    profileModeEnabled: boolean('profile_mode_enabled').notNull().default(false),
    profileModeEnabledAt: timestamp('profile_mode_enabled_at', { withTimezone: true }),
    /** Estalara staff user who flipped the gate. */
    profileModeEnabledBy: uuid('profile_mode_enabled_by'),

    // Billing
    stripeCustomerId: text('stripe_customer_id').unique(),
    stripeSubscriptionId: text('stripe_subscription_id').unique(),

    // Registration linkage (set at approval)
    registrationId: uuid('registration_id'),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete — null means active. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('tenants_slug_idx').on(t.slug),
    index('tenants_status_idx').on(t.status),
    index('tenants_plan_idx').on(t.plan),
    uniqueIndex('tenants_stripe_customer_idx').on(t.stripeCustomerId),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
