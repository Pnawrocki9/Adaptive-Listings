/**
 * app_config — global key-value configuration table for Estalara admin settings.
 *
 * One row per config key. No per-tenant scoping — this is a GLOBAL table.
 * Accessed exclusively via the admin client (service role); no RLS required
 * because there is no per-row tenant isolation concern (all rows are global).
 *
 * Current keys:
 *   - `generation_model` — the global default LLM model for content generation
 *     (FOLLOW-161). Values must be in the ALLOWED_GENERATION_MODELS allow-list.
 *
 * New keys require:
 *   1. A Zod validator in the consumer (apps/control-plane/src/lib/global-config-store.ts).
 *   2. A production consumer or a FOLLOW + AC deferral per Rule H.
 *
 * No RLS: this table is not per-tenant. Service role access only.
 *
 * @module @estalara/db/schema/app_config
 */

import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const appConfig = pgTable('app_config', {
  /**
   * Config key (primary key). Examples:
   *   `generation_model` — global default LLM model for description/adaptation generation.
   */
  key: text('key').primaryKey(),

  /** The config value as a text string. Consumer must validate/coerce the type. */
  value: text('value').notNull(),

  /** User UUID of the admin who last updated this key. Nullable for seeded/migration defaults. */
  updatedBy: uuid('updated_by'),

  /** TIMESTAMPTZ — last write time. */
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AppConfigRow = typeof appConfig.$inferSelect;
export type NewAppConfig = typeof appConfig.$inferInsert;
