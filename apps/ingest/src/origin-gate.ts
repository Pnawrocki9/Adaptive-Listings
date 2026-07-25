/**
 * Per-tenant browser-`Origin` validation for the ingest Worker. [FOLLOW-642]
 *
 * BUSINESS MODEL (DOMAIN-INDEPENDENCE ruling, CEO 2026-07-24 —
 * `docs/DECISION-BRIEF-FACADES-622-623-2026-07-24.md` §DECISION): each client brand is a
 * white-label re-deployment of OUR app on the client's OWN domain (e.g.
 * `listings.clientX.com`). Adaptive Listings runtime must be independent of the domain it
 * runs on — tenant identity comes from the `api_key`, never from the host. The old hardcoded
 * env CORS allow-list (`router.ts`) does NOT scale to N client domains and is the anti-pattern
 * the ruling forbids. This module replaces it with a per-tenant, data-driven origin gate.
 *
 * SECURITY GOAL: a leaked/stolen `api_key` of brand X must only work from brand X's own
 * domains. This is enforced at the ACTUAL request (`POST /v1/events`), where the api key is
 * present: after auth resolves the tenant, the browser `Origin` header is matched against the
 * tenant's `allowed_origins`. A mismatch returns HTTP 403 BEFORE any ingest side effect
 * (Redpanda/ClickHouse), so a stolen key embedded on `evil.com` ingests nothing.
 *
 * WHY NOT the CORS preflight: browsers strip custom headers (`X-Estalara-API-Key`) from the
 * OPTIONS preflight, so the tenant cannot be resolved there. Preflight is therefore a
 * permissive browser-negotiation step (it reflects the requested origin); it grants nothing,
 * because the actual POST is the enforcement boundary. See `router.ts`.
 *
 * FAIL-SAFE (Rule K.2 spirit): this module is PURE — it operates only on data the auth layer
 * ALREADY fetched from KV (the api-key record). It performs ZERO I/O, so it cannot fail on a
 * store outage, cannot fabricate an allow decision, and adds no new failure surface to the
 * <50ms ACK hot path. If KV itself is unreadable, `authenticateRequest` fails the request
 * closed (401) upstream — an explicit-allow-list tenant is never silently failed open.
 *
 * @module apps/ingest/src/origin-gate
 */

/**
 * Browser origins permitted to call the ingest API directly from the SDK in production.
 *
 * These back the `inherit` policy (see {@link resolveOriginPolicy}) — the backward-compatible
 * default for a tenant whose api-key record carries NO explicit `allowed_origins` (critically,
 * Estalara's own first-party tenant, whose KV records predate FOLLOW-642).
 *
 * - `https://app.estalara.com` — the pilot site the SDK posts events from.
 * - `https://admin.estalara.com` — the control-plane host (onboarding "Test ping" / previews).
 */
export const PROD_ALLOWED_ORIGINS: readonly string[] = [
  'https://app.estalara.com',
  'https://admin.estalara.com',
];

/**
 * Additional localhost origins permitted in NON-production environments only.
 *
 * Gated on `ENVIRONMENT !== 'production'`. NEVER added in `[env.production]`. Lets the browser
 * SDK on the local Estalara-app dev server (`http://localhost:5173`) and the local
 * control-plane (`http://localhost:3000`) reach the Worker at `http://localhost:8787` during
 * local E2E.
 */
export const DEV_EXTRA_ORIGINS: readonly string[] = [
  'http://localhost:5173',
  'http://localhost:3000',
];

/**
 * Build the effective env-level CORS allow-list, gated on `env.ENVIRONMENT`.
 *
 * Returns only {@link PROD_ALLOWED_ORIGINS} when `ENVIRONMENT === 'production'`; adds
 * {@link DEV_EXTRA_ORIGINS} for every other value (development, staging, test, …). This list
 * backs BOTH the `inherit` origin policy and the router's fallback CORS decoration for
 * non-tenant-scoped responses (health, 404, pre-auth errors).
 */
export function allowedOriginsForEnv(environment: string): readonly string[] {
  return environment === 'production'
    ? PROD_ALLOWED_ORIGINS
    : [...PROD_ALLOWED_ORIGINS, ...DEV_EXTRA_ORIGINS];
}

/**
 * Normalize a stored allow-list entry (or a request `Origin`) to a canonical origin string:
 * `scheme://host[:non-default-port]`, lower-cased host, no path/query/fragment/userinfo.
 *
 * This is the fix for the `z.string().url()` validation bug called out in FOLLOW-642: that
 * validator accepted full URLs with paths/query (`https://x.com/listings?a=1`) that can NEVER
 * equal a browser `Origin` header (`https://x.com`), so a well-intentioned config would have
 * silently matched nothing. Normalizing BOTH sides to an origin makes the comparison correct
 * regardless of how sloppily the value was stored. Applied defensively at READ time so a
 * malformed stored value can never bypass the gate.
 *
 * @returns the canonical origin, or `null` when the value is unparseable or not http/https.
 *   A `null` (unparseable) entry is EXCLUDED from the allow-list — a config typo fails safe
 *   (deny) rather than becoming a wildcard allow.
 */
export function normalizeToOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // `URL.origin` already drops path/query/fragment/userinfo, lower-cases the host, and omits
  // default ports (443 for https, 80 for http). It returns the string 'null' for opaque
  // origins — guarded by the protocol check above.
  return url.origin;
}

/** Normalize a list, dropping entries that fail {@link normalizeToOrigin} and de-duping. */
function normalizeList(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const n = normalizeToOrigin(v);
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return out;
}

/** How a tenant's `allowed_origins` config resolves for the current request. */
export type OriginPolicyMode = 'inherit' | 'deny-all' | 'explicit';

export interface ResolvedOriginPolicy {
  mode: OriginPolicyMode;
  /** Normalized allow-list to match the request `Origin` against. */
  allowList: string[];
}

/**
 * Resolve a tenant's `allowed_origins` into an effective, normalized allow-list.
 *
 * SEMANTICS (documented in the FOLLOW-642 stub + PR):
 * - `null` / `undefined` (field absent) → `inherit`: fall back to the env allow-list. This is
 *   the BACKWARD-COMPAT default for Estalara's own tenant, whose api-key records predate this
 *   field. Its browser traffic is never disrupted.
 * - `[]` (explicit empty array) → `deny-all`: reject ALL cross-origin browser requests. Only a
 *   caller with NO `Origin` header (server-side, HMAC-signed adapter) passes — CORS is a
 *   browser-only concern. This is the explicit lock-down a tenant chooses.
 * - `[...]` (non-empty) → `explicit`: allow exactly those origins (normalized), nothing else.
 *
 * @param tenantOrigins - the tenant's `allowed_origins` from the resolved api-key record.
 * @param envFallback - `allowedOriginsForEnv(env.ENVIRONMENT)`, used only for `inherit`.
 */
export function resolveOriginPolicy(
  tenantOrigins: readonly string[] | null | undefined,
  envFallback: readonly string[],
): ResolvedOriginPolicy {
  if (tenantOrigins === null || tenantOrigins === undefined) {
    return { mode: 'inherit', allowList: normalizeList(envFallback) };
  }
  if (tenantOrigins.length === 0) {
    return { mode: 'deny-all', allowList: [] };
  }
  return { mode: 'explicit', allowList: normalizeList(tenantOrigins) };
}

/**
 * True when the browser `Origin` header is permitted by the resolved allow-list.
 *
 * Normalizes the request origin the same way as stored entries, so a comparison never fails on
 * a default-port or casing artifact. An unparseable `Origin` is denied.
 */
export function isOriginAllowed(requestOrigin: string, allowList: readonly string[]): boolean {
  const normalized = normalizeToOrigin(requestOrigin);
  if (normalized === null) return false;
  return allowList.includes(normalized);
}
