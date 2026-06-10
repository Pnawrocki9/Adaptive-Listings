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
    /**
     * E.4 investor quiz widget configuration (questions, decay logic, Bayesian prior).
     *
     * SCOPE: widget UX settings only (trigger thresholds, sticky_widget, language,
     * accent_color, micro_polls_enabled). Persisted via POST /api/quiz/config and
     * read by GET /api/quiz/config.
     *
     * NOT the source-of-truth for quiz enabled/disabled state — use `quizEnabled`
     * (the typed boolean column below) for that. The `enabled` key inside this JSONB
     * blob is intentionally ignored by the freeze guard and by all code paths that
     * determine whether the quiz runs. Any code that reads `quizConfig.enabled` for
     * on/off control is incorrect — read `quizEnabled` instead.
     *
     * FOLLOW-265 (2026-06-11): annotated to resolve third-consecutive-retro JSONB
     * blob decay flag (RETRO-049 §5d, RETRO-051 §5d). The `enabled` key inside this
     * blob is ORPHANED for freeze-guard purposes and intentionally not read. The
     * JSONB blob itself remains for widget UX configuration (non-deprecated).
     */
    quizConfig: jsonb('quiz_config').default({}),

    /**
     * Whether personalization requires explicit consent for this tenant.
     * Defaults to true (conservative). EU/UK tenants must keep this true.
     * US/UAE tenants may set to false after compliance review.
     * Added in TICKET-GDPR-004.
     */
    consentRequired: boolean('consent_required').notNull().default(true),

    /**
     * Pilot freeze guard — set to true by TICKET-PILOT-001 on the shadow→live flip.
     * When true, the adapt route emits a non-blocking structured warning if any
     * Lane C feature flag is active, protecting the CTA-lift measurement window.
     * Default false (normal operating state). Added in FOLLOW-106.
     */
    pilotFrozen: boolean('pilot_frozen').notNull().default(false),

    /**
     * Whether the quiz widget is enabled for this tenant.
     * Default true — pilot tenant behavior is not changed (Sprint 13b freeze rule).
     * Tenants with high-quality chat coverage may set this to false to rely on
     * behavioral + chat NLP signals only (§B.1 / §D.6 rationale).
     * Added in FOLLOW-102.
     */
    quizEnabled: boolean('quiz_enabled').notNull().default(true),

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
