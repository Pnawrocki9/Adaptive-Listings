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
export * from './demo_sessions.js';
export * from './archetype_embeddings.js';
export * from './session_embeddings.js';
export * from './tenant_site_schemas.js';
export * from './ab_bandit_weights.js';
export * from './answers.js';
export * from './schema_validation_history.js';
export * from './tenant_compliance_records.js';
export * from './dsr_verifications.js';
