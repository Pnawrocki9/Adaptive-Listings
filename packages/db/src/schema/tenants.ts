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
     * E.4 investor quiz widget configuration — widget UX settings only.
     *
     * SCOPE (valid keys — all wired to a non-test producer AND consumer):
     *   `language`           → GET /api/quiz/public-config → SDK runtime fetch → quiz widget locale
     *   `accent_color`       → GET /api/quiz/public-config → SDK runtime fetch → quiz widget brand color
     *   `micro_polls_enabled`→ GET /api/quiz/public-config → SDK runtime fetch → micro-poll trigger
     * (Stored as snake_case: `language`, `accent_color`, `micro_polls_enabled`.)
     * Persisted via POST /api/quiz/config; read by GET /api/quiz/config (dashboard, JWT auth) AND
     * GET /api/quiz/public-config (SDK runtime fetch, API-key auth, ADR-0011 / FOLLOW-275).
     *
     * ADR-0011 (FOLLOW-275): quiz config is no longer threaded through snippet data-attributes
     * (`data-quiz-enabled`, `data-micro-polls-enabled`). These attributes are retired. The SDK
     * fetches this config at init time via GET /api/quiz/public-config (anonymous buyer context).
     *
     * NOT the source-of-truth for quiz enabled/disabled state — use `quizEnabled`
     * (the typed boolean column below) for that.
     *
     * FOLLOW-271 (2026-06-11, Rule U): the `enabled` key has been ELIMINATED from this blob.
     *   - Write path: `QuizConfigSchema` (packages/shared) uses `.omit({ enabled: true })`
     *     so the key cannot re-enter the blob via POST /api/quiz/config.
     *   - Existing rows: migration `0026_strip_quiz_config_enabled` removes the key from
     *     all rows via `quiz_config = quiz_config - 'enabled'`.
     * FOLLOW-274 (2026-06-11, Rule U): the `sticky_widget` key has been ELIMINATED.
     *   - Write path: `QuizConfigSchema` uses `.omit({ sticky_widget: true })`.
     *   - Existing rows: migration `0027_strip_quiz_config_sticky_widget` strips the key.
     * The blob no longer carries `enabled` or `sticky_widget`. ON/OFF gating lives
     * exclusively in `quizEnabled`.
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
     * Master ON/OFF switch for Adaptive Listings serving for this tenant (FOLLOW-633).
     *
     * The single per-tenant kill switch a staff/superadmin operator controls from
     * `/admin/tenants/[id]/al-state` (audited write → `staff_audit_log.action =
     * 'tenant_al_state.update'`). Consumed at runtime by the adapt path
     * (`api/adapt/route.ts` GET + POST) via `resolveAlEnablement()` — when `false`,
     * the adapt endpoint serves a valid neutral / pass-through 200 with NO adaptation
     * (page still works) instead of directives.
     *
     * Default TRUE (additive migration 0034): every existing tenant — critically the
     * single live tenant, Estalara itself — inherits `al_enabled = true` and stays ON
     * when the migration auto-applies to prod on merge (db-migrate.yml). Do NOT default
     * this to false.
     *
     * Distinct from `status`: `status IN ('suspended','canceled')` is ALSO treated as
     * OFF at the same enforcement point (billing/lifecycle cut-off), while `al_enabled`
     * is the explicit operator override. `pending` and `active` stay ON.
     */
    alEnabled: boolean('al_enabled').notNull().default(true),

    /**
     * Whether the quiz widget is enabled for this tenant.
     * Default true — pilot tenant behavior is not changed (Sprint 13b freeze rule).
     * Tenants with high-quality chat coverage may set this to false to rely on
     * behavioral + chat NLP signals only (§B.1 / §D.6 rationale).
     * Added in FOLLOW-102.
     *
     * ADR-0011 / FOLLOW-275: this column is now propagated to the SDK via the runtime fetch
     * `GET /api/quiz/public-config` (API-key-authenticated, anonymous buyer context) rather
     * than via the `data-quiz-enabled` snippet attribute. The attribute is retired.
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
