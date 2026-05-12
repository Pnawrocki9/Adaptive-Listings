/**
 * tenant_site_schemas — persists auto-detected site schemas per tenant domain.
 *
 * Created by the Auto-Detection Engine (AUTO-003 / AUTO-004) via the
 * `POST /api/detect` endpoint. One row per (tenant_id, domain) pair.
 * Updated whenever the detection runs again for the same domain.
 *
 * The `schema` JSONB column stores the full `TenantSiteSchema` object.
 * `detection_source` and `detection_confidence` are denormalised out of
 * the JSONB for cheap filtering / sorting without parsing JSON.
 *
 * RLS: tenant_isolation policy applied via migration SQL.
 *
 * @module @estalara/db/schema/tenant_site_schemas
 */

import { index, jsonb, pgTable, real, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const tenantSiteSchemas = pgTable(
  'tenant_site_schemas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Foreign key → tenants.id. Cascade delete when the tenant is removed. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Bare domain (e.g. `rightmove.co.uk`). */
    domain: text('domain').notNull(),
    /**
     * Full `TenantSiteSchema` JSON blob.
     * Typed as `unknown` at the Drizzle level — callers must cast to `TenantSiteSchema`.
     */
    schema: jsonb('schema').notNull(),
    /**
     * Denormalised from `schema.detection_source` for cheap querying.
     *
     * Values: 'data_estalara' | 'json_ld' | 'data_testid' | 'article_tag' |
     *         'css_modules' | 'mui' | 'css_in_js' | 'angular' |
     *         'wordpress' | 'drupal' | 'php_classic' | 'ai_vision' | 'manual'
     */
    detectionSource: text('detection_source').notNull(),
    /**
     * Denormalised from `schema.detection_confidence` for cheap sorting / filtering.
     * Float 0.0 – 1.0.
     */
    detectionConfidence: real('detection_confidence').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_tenant_site_schemas_tenant_id').on(t.tenantId),
    unique('tenant_site_schemas_tenant_domain_uniq').on(t.tenantId, t.domain),
  ],
);

export type TenantSiteSchemaRow = typeof tenantSiteSchemas.$inferSelect;
export type NewTenantSiteSchemaRow = typeof tenantSiteSchemas.$inferInsert;
