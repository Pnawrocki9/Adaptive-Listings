/**
 * Canonical shape of a `KV_API_KEYS` value — the ingest Worker's edge-cached tenant projection.
 *
 * WHY THIS LIVES IN `@estalara/shared` (FOLLOW-658): the record has exactly two sides —
 * a CONSUMER (`apps/ingest/src/auth.ts` → `apps/ingest/src/origin-gate.ts`, which reads it on
 * every `POST /v1/events`) and a PRODUCER (`apps/control-plane/scripts/project-allowed-origins.mts`,
 * the provisioning tool that writes it). They live in different apps and cannot import each other,
 * so before this module the shape existed only on the read side and the write side was
 * hand-authored JSON. One declaration, imported by both, is what keeps them from drifting.
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
  /**
   * Per-tenant browser-`Origin` allow-list enforced by the ingest origin gate. [FOLLOW-642]
   *
   * WRITE PATH (reality, corrected by FOLLOW-658 — the earlier docstring claimed an automatic
   * projection that does not exist): NO service writes `KV_API_KEYS`. The record is seeded by an
   * explicit operator provisioning step — `docs/runbooks/BRAND_PROVISIONING.md` §Step 6, using
   * `apps/control-plane/scripts/project-allowed-origins.mts`, which reads the Postgres
   * source-of-truth (`api_keys.allowed_origins` ?? `tenants.allowed_origins`) and translates it
   * into the KV semantics below. The ingest Worker has no Postgres binding, so KV is the only
   * tenant config it can read; nothing reconciles the two stores automatically.
   *
   * Values SHOULD be canonical origins (`scheme://host[:port]`), but the gate re-normalizes
   * defensively at read (`origin-gate.ts` `normalizeToOrigin`), so a full-URL / trailing-path
   * value still matches correctly.
   *
   * SEMANTICS — three states, and `null` is NOT `[]` (see `origin-gate.ts` `resolveOriginPolicy`):
   *   - `undefined` / `null` (absent) → INHERIT the env allow-list. That list is *Estalara's own*
   *     domains, so this is correct for the first-party tenant only; for any other tenant it means
   *     the provisioning step never ran and the ingest guard refuses the request with 403
   *     `origin_policy_unconfigured` (FOLLOW-658).
   *   - `[]` → DENY every cross-origin browser request (deliberate lock-down).
   *   - `[...]` → allow exactly those origins.
   *
   * TRAP: Postgres `tenants.allowed_origins` is `NOT NULL DEFAULT []` where `[]` means "nothing
   * configured yet" (i.e. inherit), the OPPOSITE of the KV `[]` above. Never copy the column
   * mechanically — `project-allowed-origins.mts` refuses the ambiguous empty case instead of
   * guessing.
   */
  allowed_origins?: string[] | null;
}
