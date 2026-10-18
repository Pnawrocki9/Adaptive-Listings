/**
 * Browser-`Origin` validation for the ingest Worker. [FOLLOW-642, FOLLOW-1333]
 *
 * One constant list decides it: `@estalara/shared/browser-origins`, the same list the control
 * plane reads (`apps/control-plane/src/lib/origin-policy.ts`). With `ENVIRONMENT === 'production'`
 * it is `https://app.estalara.com` and `https://admin.estalara.com`; every other environment also
 * accepts `http://localhost:5173` (the FOLLOW-819 fixture page and the local Estalara app) and
 * `http://localhost:3000` (the local control plane). `[env.production]` in `wrangler.toml` sets
 * `ENVIRONMENT = "production"`, so a production deploy never accepts a localhost origin.
 *
 * Before FOLLOW-1333 the decision was per tenant: the browser-origin field of the
 * `KV_API_KEYS` record (absent = inherit this list, `[]` = deny every browser, `[...]` = exactly
 * those), guarded by a first-party tenant-id Worker secret so that only Estalara's own tenant
 * could inherit Estalara's domains. Adaptive Listings serves one tenant (ESC-085), so both are gone; a
 * record that still carries the field is read as if it did not.
 *
 * THREE LAYERS (`router.ts` + `handlers/events.ts`), all asking this module:
 *   1. the OPTIONS preflight answers `Access-Control-Allow-Origin` for a listed origin only;
 *   2. `POST /v1/events` refuses an unlisted `Origin` with 403 `forbidden_origin` BEFORE any
 *      side effect (rate limit, ClickHouse write), so a key embedded on another site ingests
 *      nothing;
 *   3. every actual response echoes a listed origin only.
 *
 * Pure and I/O-free, so it adds no failure surface to the <50 ms ACK path.
 *
 * @module apps/ingest/src/origin-gate
 */

import { isAllowedBrowserOrigin } from '@estalara/shared/browser-origins';

/**
 * True when the browser `Origin` header is on the list for this Worker's environment.
 *
 * @param requestOrigin - the `Origin` request header.
 * @param environment - `env.ENVIRONMENT`; only the exact value `'production'` is production.
 */
export function isOriginAllowed(requestOrigin: string, environment: string): boolean {
  return isAllowedBrowserOrigin(requestOrigin, environment === 'production');
}
