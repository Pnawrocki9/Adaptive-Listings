/**
 * The control plane's browser-`Origin` decision. [FOLLOW-941, FOLLOW-1333]
 *
 * One constant list decides it: `@estalara/shared/browser-origins`, the same list the ingest
 * Worker reads (`apps/ingest/src/origin-gate.ts`). Production (`NODE_ENV === 'production'`)
 * accepts `https://app.estalara.com` and `https://admin.estalara.com` only; every other build
 * also accepts the local fixture / Estalara app (`http://localhost:5173`) and the local control
 * plane (`http://localhost:3000`).
 *
 * Before FOLLOW-1333 this module resolved a per-tenant policy from the per-key origin column of
 * `api_keys`, falling back to the per-tenant one of `tenants`, with the first-party tenant
 * inheriting a platform list. Adaptive Listings serves one tenant (ESC-085), so the per-tenant
 * layer had nothing to decide; both columns stay in Postgres and are no longer read.
 *
 * THE THREE LAYERS (all three read this module, so they cannot disagree):
 *   1. the CORS PREFLIGHT in `middleware.ts` answers `Access-Control-Allow-Origin` for a listed
 *      origin only — it no longer reflects an arbitrary `Origin` (FOLLOW-941's reflection existed
 *      so an external brand's unknown domain could reach the per-tenant check; there is none);
 *   2. the AUTHENTICATED gate (`resolveApiKey` in `api-key-auth.ts`, and the inline gate in
 *      `app/api/quiz/completion/route.ts`) refuses an unlisted origin with 403 before any handler
 *      side effect — omitting a CORS header alone would not stop a write;
 *   3. the ACTUAL-RESPONSE header in `middleware.ts` echoes a listed origin only.
 *
 * @module apps/control-plane/src/lib/origin-policy
 */

import { isAllowedBrowserOrigin } from '@estalara/shared/browser-origins';

/**
 * The decision, as a closed set. Module-local by Rule I: callers read `.verdict` structurally.
 *
 * - `allow` — no `Origin` (a server-side caller), or a listed origin.
 * - `deny`  — an `Origin` that is not on the list for this build. Refuse the request.
 */
type OriginDecision = { verdict: 'allow' } | { verdict: 'deny'; reason: 'forbidden_origin' };

/**
 * Whether this process applies the production origin list.
 *
 * `next start` always runs with `NODE_ENV=production`, so a LOCAL production-mode stack
 * (`CP_MODE=prod scripts/dev/localhost-up.sh`, FOLLOW-1376) would refuse its own localhost pages.
 * `ESTALARA_LOCAL_ORIGINS=1` keeps the non-production list for that case only. It is ignored
 * whenever `VERCEL` is set (Vercel sets it on every build and function), so it cannot widen a
 * deployed gate, and any value other than the exact string `1` is ignored.
 */
function usesProductionOriginList(): boolean {
  if (process.env.NODE_ENV !== 'production') return false;
  const localOverride = process.env.ESTALARA_LOCAL_ORIGINS === '1' && !process.env.VERCEL;
  return !localOverride;
}

/**
 * Resolve one request's origin verdict.
 *
 * A request with **no `Origin` header** is a server-side caller (curl, an HMAC-signed adapter,
 * another service). Browsers always send `Origin` on cross-origin requests, so absence is not a
 * bypass a hostile page can arrange — it is answered by the API-key check instead, exactly as the
 * ingest Worker does.
 *
 * The production flag is read per call, so a test can stub `NODE_ENV`.
 *
 * @param requestOrigin - the `Origin` request header, or `null` when absent.
 */
export function resolveOriginDecision(requestOrigin: string | null): OriginDecision {
  if (!requestOrigin) return { verdict: 'allow' };
  return isAllowedBrowserOrigin(requestOrigin, usesProductionOriginList())
    ? { verdict: 'allow' }
    : { verdict: 'deny', reason: 'forbidden_origin' };
}
