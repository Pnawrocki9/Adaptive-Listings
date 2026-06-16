/**
 * Shared ClickHouse HTTP Basic-auth helper for the control-plane.
 *
 * All 12 sites in the control-plane that previously built their own
 * `Basic base64(":" + password)` header (empty username → ClickHouse Code 516
 * AUTHENTICATION_FAILED) have been migrated to use this module.
 *
 * The canonical correct form mirrors the ingest worker:
 *   apps/ingest/src/clickhouse-producer.ts:214 — `btoa(`${user}:${password}`)`
 *
 * Fix: include `CLICKHOUSE_USER` (default `'default'`) before the colon.
 * When the password is absent (dev / CI without ClickHouse), no Authorization
 * header is emitted — preserving the existing "no password → no header" guard.
 *
 * Production deploy prerequisite (documented in PR description):
 *   CLICKHOUSE_USER=ingest_worker must be set in Vercel control-plane env.
 *   Without it, the code falls back to `'default'` which is the wrong ClickHouse
 *   user for this service.
 *
 * @module apps/control-plane/src/lib/clickhouse-http
 */

/**
 * Build HTTP Basic auth headers for a ClickHouse request.
 *
 * When `password` is empty (dev / CI passwordless instance) returns an empty
 * object so no Authorization header is sent.
 *
 * The username is always included before the colon — empty-username headers
 * are rejected by ClickHouse Cloud with Code 516 AUTHENTICATION_FAILED.
 */
export function clickhouseAuthHeaders(cfg: {
  user: string;
  password: string;
}): Record<string, string> {
  if (!cfg.password) return {};
  const token = Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}
