/**
 * Canonical shape of a `KV_API_KEYS` value — the ingest Worker's edge-cached tenant projection.
 *
 * WHY THIS LIVES IN `@estalara/shared` (FOLLOW-658): the record has exactly two sides — a CONSUMER
 * (`apps/ingest/src/auth.ts`, which reads it on every `POST /v1/events`) and a PRODUCER
 * (`apps/control-plane/scripts/issue-tenant-api-key.mts`, which prints it at issuance for the
 * operator to write with wrangler). They live in different apps and cannot import each other, so
 * one declaration imported by both is what keeps them from drifting.
 *
 * Type-only module: no runtime export, so importing it costs zero bytes in the SDK bundle.
 *
 * @module @estalara/shared/api-key-record
 */

/**
 * Shape of a `KV_API_KEYS` value. Stored as JSON, looked up by `api_key:<raw token>`.
 *
 * The raw api key is the KV KEY (never stored in Postgres — Postgres keeps only
 * `api_keys.hashed_key` = SHA-256(raw)), so the record can only be written by someone holding the
 * raw key: today, the operator who captured it at activation.
 */
export interface ApiKeyRecord {
  /** Tenant UUID owning this API key. */
  tenant_id: string;
  /** Permission scopes (e.g. `read:events`, `write:adaptations`). Master Design J.2. */
  scopes: string[];
  /** Hex-encoded HMAC-SHA256 secret. Optional — public client keys may omit it. */
  hmac_secret?: string;
  /** Optional human label for ops dashboards. */
  label?: string;
  // FOLLOW-1333: no browser-origin field. Origins are one constant list
  // (`@estalara/shared/browser-origins`); a record written before FOLLOW-1333 may still carry an
  // `allowed_origins` key, which the Worker ignores.
}
