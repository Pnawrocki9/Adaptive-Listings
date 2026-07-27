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

/** Well-formed (RFC 4122-shaped) UUID, case-insensitive. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Result of classifying a raw `FIRST_PARTY_TENANT_ID` env value. [FOLLOW-678] */
export type FirstPartyTenantIdStatus =
  | { status: 'unset' }
  | { status: 'malformed'; raw: string }
  | { status: 'valid'; value: string };

/**
 * Classifies + canonicalizes a raw `FIRST_PARTY_TENANT_ID` env value. [FOLLOW-678]
 *
 * Canonicalization is trim + lower-case, applied BEFORE the UUID-shape check, so a value that
 * only differs from a real tenant id by case or incidental whitespace (a copy-paste artifact,
 * not a typo) is treated as `valid`, not `malformed`.
 *
 * A value that is present but NOT a well-formed UUID (a truncated paste, a stray character) is
 * classified `malformed` — DISTINCT from `unset` so a caller can warn about it — but callers of
 * {@link isUnprovisionedExternalTenant} treat `malformed` exactly like `unset` (guard disabled),
 * because deny-listing every tenant on a config typo is a worse outcome than the guard being off
 * for one deploy (see that function's docstring).
 *
 * @param raw - `env.FIRST_PARTY_TENANT_ID`, as read from the Worker binding.
 */
export function resolveFirstPartyTenantId(
  raw: string | null | undefined,
): FirstPartyTenantIdStatus {
  const trimmed = raw?.trim();
  if (!trimmed) return { status: 'unset' };
  const lower = trimmed.toLowerCase();
  if (!UUID_RE.test(lower)) return { status: 'malformed', raw: trimmed };
  return { status: 'valid', value: lower };
}

/**
 * True when a tenant is running on the `inherit` policy but is NOT the configured first-party
 * tenant — i.e. its KV api-key record was never seeded with `allowed_origins`. [FOLLOW-658]
 *
 * WHY THIS IS A DEFECT, NOT A DEFAULT: `inherit` resolves to {@link PROD_ALLOWED_ORIGINS}, which
 * is *Estalara's own* domain list. It is the correct backward-compatible default for exactly one
 * tenant — the first-party one, whose KV records predate FOLLOW-642. For any external brand it
 * means the provisioning step that writes the KV field (an explicit operator step — NO in-repo
 * code writes `KV_API_KEYS`; see `docs/runbooks/BRAND_PROVISIONING.md` §Step 6) never ran, and the
 * brand ends up with the *inverse* of the intended policy: its own domain is rejected while its
 * api key still works from `app.estalara.com` / `admin.estalara.com`.
 *
 * FAIL-LOUD, NOT FAIL-SILENT: the caller turns a `true` here into an explicit
 * `origin_policy_unconfigured` 403 + a Sentry error, so a missed provisioning step surfaces as a
 * self-describing failure during onboarding verification instead of a silent mis-scoped key.
 *
 * ONLY A CORRECTLY-SET, UNSET, OR BLANK ENV IS SAFE FOR FIRST-PARTY TRAFFIC — A WRONG ONE IS NOT.
 * [FOLLOW-678] `firstPartyTenantId` is classified by {@link resolveFirstPartyTenantId} and
 * canonicalized (trim + lower-case) before comparison, so a case difference or incidental
 * whitespace between the stored value and the env paste can never cause a false mismatch. Two
 * env states degrade the guard to OFF (returns `false` for everyone, exactly pre-FOLLOW-658
 * behavior): `unset`/blank (the Worker cannot know which tenant is first-party) AND `malformed`
 * (not a well-formed UUID — a bad paste must degrade to "guard off", never to "deny everyone",
 * per FOLLOW-678 AC). A forgotten OR garbled env can therefore never black-hole Estalara's live
 * traffic. But a env that IS a well-formed UUID and simply does not match the real first-party
 * tenant's id (e.g. mistyped one digit, or the wrong tenant's UUID pasted) is NOT safe — it is
 * indistinguishable from an intentional `explicit` allow-list scoping and WILL 403 every
 * first-party browser request with `origin_policy_unconfigured`. See
 * {@link resolveFirstPartyTenantId} for the `malformed`-vs-`unset` distinction and
 * `docs/runbooks/INGEST_WORKER_DEPLOY.md` for the post-flip verification step this class of bug
 * motivated. (Configuring the env at all is §Step 0 of `BRAND_PROVISIONING.md`.)
 *
 * @param mode - the resolved policy mode from {@link resolveOriginPolicy}.
 * @param tenantId - the authenticated tenant id from the KV api-key record.
 * @param firstPartyTenantId - `env.FIRST_PARTY_TENANT_ID` (may be undefined/blank/malformed).
 */
export function isUnprovisionedExternalTenant(
  mode: OriginPolicyMode,
  tenantId: string,
  firstPartyTenantId: string | null | undefined,
): boolean {
  if (mode !== 'inherit') return false;
  const resolved = resolveFirstPartyTenantId(firstPartyTenantId);
  if (resolved.status !== 'valid') return false;
  return tenantId.trim().toLowerCase() !== resolved.value;
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
