/**
 * @estalara/db — Drizzle ORM client and schemas for Supabase Postgres.
 *
 * Primary export: {@link createClient} — call this once per process and pass
 * the resulting {@link Database} instance to your services.
 *
 * Schema tables are added in TICKET-021+.
 *
 * @module @estalara/db
 */

export { createClient, createTenantClient, createAdminClient, withJwt } from './client.js';
export type { ClientOptions, Database, TenantDatabase } from './client.js';
export * from './schema/index.js';
export { upsertConversionLabel } from './upsert-conversion-label.js';
export type { UpsertConversionLabelInput } from './upsert-conversion-label.js';
