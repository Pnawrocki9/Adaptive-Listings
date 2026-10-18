/**
 * The browser origins Adaptive Listings accepts — ONE list for the control plane and the ingest
 * Worker. [FOLLOW-1333]
 *
 * Adaptive Listings serves one tenant on one host (ESC-085), so the origin decision is a constant,
 * not data: before FOLLOW-1333 it was read per tenant from `tenants.allowed_origins` /
 * `api_keys.allowed_origins` (control plane) and from the `allowed_origins` field of the
 * `KV_API_KEYS` record (ingest), with a three-state meaning that differed between the two stores.
 * Those columns stay in Postgres and are no longer read.
 *
 * Imported through its own sub-path (`@estalara/shared/browser-origins`) rather than the package
 * root, so the control-plane middleware bundle pulls in this file only, not every shared schema.
 *
 * WHO DECIDES "production". Each runtime passes its own flag, by its existing convention: the
 * control plane `process.env.NODE_ENV === 'production'` (`lib/origin-policy.ts`), the ingest
 * Worker `env.ENVIRONMENT === 'production'` (`origin-gate.ts`). A production build therefore never
 * accepts a localhost origin, whatever the request says.
 *
 * @module @estalara/shared/browser-origins
 */

/** Estalara's own hosts: the app the SDK runs on and the backoffice. */
const PRODUCTION_BROWSER_ORIGINS: readonly string[] = Object.freeze([
  'https://app.estalara.com',
  'https://admin.estalara.com',
]);

/**
 * Added outside production only. `:5173` is the FOLLOW-819 fixture page AND the local Estalara
 * app (both are served there — `scripts/dev/localhost-up.sh` step 6, the Estalara repo's
 * `ADAPTIVE_LISTINGS_LOCAL.md`); `:3000` is the local control plane.
 */
const NON_PRODUCTION_EXTRA_ORIGINS: readonly string[] = Object.freeze([
  'http://localhost:5173',
  'http://localhost:3000',
]);

/**
 * The accepted origins for one environment. Module-local by Rule I: every consumer asks the
 * yes/no question below, and tests drive it through that function.
 */
function browserOriginsFor(isProduction: boolean): readonly string[] {
  return isProduction
    ? PRODUCTION_BROWSER_ORIGINS
    : [...PRODUCTION_BROWSER_ORIGINS, ...NON_PRODUCTION_EXTRA_ORIGINS];
}

/**
 * Whether a browser `Origin` header value is on the list for this environment.
 *
 * The value is canonicalised with `URL.origin` first (lower-case host, default port dropped), so
 * a casing or `:443` artefact cannot cause a false refusal. Anything that is not an http(s) URL —
 * including the literal `null` a sandboxed frame sends — is refused.
 *
 * @param requestOrigin - the `Origin` request header.
 * @param isProduction - the caller's production flag (see the module docblock).
 */
export function isAllowedBrowserOrigin(requestOrigin: string, isProduction: boolean): boolean {
  let url: URL;
  try {
    url = new URL(requestOrigin.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return browserOriginsFor(isProduction).includes(url.origin);
}
