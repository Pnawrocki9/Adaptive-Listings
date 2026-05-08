/**
 * Schema barrel — re-exports all Drizzle table definitions.
 *
 * Add one `export * from './your-table.js'` line per schema file.
 * TICKET-021 and later tickets populate this directory.
 *
 * @module @estalara/db/schema
 */

export * from './tenants.js';
export * from './tenant_registrations.js';
export * from './users.js';
export * from './api_keys.js';
export * from './staff_audit_log.js';
export * from './consent_records.js';
