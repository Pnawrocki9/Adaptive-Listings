/**
 * quiz_definitions — versioned, audited, per-tenant editable quiz trees (FOLLOW-639 / ADR-0019 D2).
 *
 * The fully editable per-brand quiz (questions, answers, branching, answer→archetype weight
 * mappings, i18n) lives here rather than on `tenants.quiz_config` because it is large,
 * i18n-multiplied EDITED CONTENT — rollback + audit matter (ADR-0019 Alternatives B). Storing
 * it on `tenants` would bloat every hot-path tenant lookup and lose version history.
 *
 * Shape (ADR-0019 D2):
 *   - one row per SAVED version; `is_active` marks the single served version per tenant.
 *   - a PARTIAL UNIQUE index on `(tenant_id) WHERE is_active` enforces "at most one active
 *     version per tenant" while retaining full history (inactive rows accumulate).
 *   - `definition` is the JSONB payload validated at the app layer by `QuizDefinitionSchema`
 *     (`packages/shared/src/schemas/presentation-config.ts`) on every write — the DB stores it
 *     opaquely; integrity (unknown archetype ids, dangling refs, cycles) is enforced in code.
 *
 * Read path: `GET /api/quiz/public-config` selects the ACTIVE row and emits it as the
 * `quiz_definition` slice. Absent row → SDK built-in default tree (byte-identical, D4/D5).
 * Write path: the staff-only editor (`PUT /api/admin/tenants/quiz-definition`), which validates,
 * deactivates the prior active row, inserts the new active version, and appends a
 * `staff_audit_log` row — all in ONE `db.transaction()` (ADR-0018 §3a).
 *
 * RLS is NOT enabled — this table is accessed exclusively via the service-role client on
 * staff/SDK-key paths, each of which applies an explicit `WHERE tenant_id` fence (ADR-0018
 * §2 invariant 5). Mirrors `staff_audit_log` / the admin-write family.
 *
 * @module @estalara/db/schema/quiz_definitions
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const quizDefinitions = pgTable(
  'quiz_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Foreign key → tenants.id. Cascade delete when the tenant is removed. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /**
     * Monotonically increasing per-tenant version number. The editor computes the next
     * version as `max(version) + 1` for the tenant, so history is ordered and auditable.
     */
    version: integer('version').notNull().default(1),

    /**
     * The quiz definition payload. Validated by `QuizDefinitionSchema` at every write; stored
     * opaquely here. Never trusted unvalidated on read (belt-and-suspenders re-parse in the route).
     */
    definition: jsonb('definition').notNull(),

    /**
     * Whether this is the tenant's served version. The partial unique index below guarantees at
     * most one active row per tenant; the read path selects `WHERE is_active`.
     */
    isActive: boolean('is_active').notNull().default(true),

    /** Estalara staff user (users.id) who saved this version — attribution for the audit trail. */
    createdBy: uuid('created_by'),

    /** Immutable creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('quiz_definitions_tenant_id_idx').on(t.tenantId),
    // At most ONE active version per tenant (partial unique). History rows (is_active = false)
    // are unconstrained, so any number may accumulate.
    uniqueIndex('quiz_definitions_active_per_tenant_idx')
      .on(t.tenantId)
      .where(sql`${t.isActive}`),
  ],
);

export type QuizDefinitionRow = typeof quizDefinitions.$inferSelect;
export type NewQuizDefinitionRow = typeof quizDefinitions.$inferInsert;
