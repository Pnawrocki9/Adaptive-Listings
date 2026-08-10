/**
 * Runtime per-tenant browser-`Origin` policy for the control plane. [FOLLOW-941]
 *
 * **Why this exists when two origin resolvers already do.** The estate now has three, and they
 * are genuinely different jobs rather than three copies of one (Rule AQ — the justification is
 * the point, so it is written down here):
 *
 * | module | when it runs | reads | `[]` means |
 * |---|---|---|---|
 * | `apps/ingest/src/origin-gate.ts` | ingest request | **KV** | **deny-all** |
 * | `apps/control-plane/scripts/project-allowed-origins.mts` | operator projection | Postgres → KV | ambiguous → **refuses** |
 * | this module | control-plane request | **Postgres** | **not configured** |
 *
 * The trap the whole estate keeps circling: `tenants.allowed_origins` is
 * `NOT NULL DEFAULT []`, where `[]` means *"nobody has configured this yet"* — the **opposite**
 * of the KV `[]` the ingest gate reads as deny-all. Reading Postgres with KV semantics would
 * lock out every tenant that has simply never been provisioned.
 *
 * **What this fixes.** `CORS_PROD_ORIGINS` was a hardcoded two-entry list of Estalara's own
 * domains, while `docs/runbooks/BRAND_PROVISIONING.md:16` puts external brands on *the client's
 * own domain*. The ingest Worker already resolved origins per tenant (FOLLOW-642); the control
 * plane did not, so at first external-brand go-live the events stream would keep flowing while
 * every adaptation and the archetype write were refused — a half-working integration, which is
 * harder to diagnose than a dead one.
 *
 * @module apps/control-plane/src/lib/origin-policy
 */

/**
 * Estalara's own origins — the PLATFORM list, inherited only by the first-party tenant.
 *
 * Lives here rather than in `middleware.ts` so the preflight layer and the authenticated gate
 * read one list (Rule AQ). It is explicitly NOT the answer for an external brand: those come
 * from `tenants.allowed_origins`, per tenant.
 */
export const CORS_PROD_ORIGINS: readonly string[] = [
  'https://app.estalara.com',
  'https://admin.estalara.com',
];

/** Localhost origins added outside production only. */
export const CORS_DEV_EXTRA_ORIGINS: readonly string[] = [
  'http://localhost:5173',
  'http://localhost:3000',
];

/**
 * Canonical `scheme://host[:port]`, or `null` when the value is not a parseable http(s) URL.
 *
 * Module-local by Rule H: only `resolveOriginDecision` needs it, and an exported symbol whose
 * sole consumer is a test is dead surface. Its behaviour is asserted through that function.
 */
function toCanonicalOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.origin;
}

/**
 * The decision, as a closed set so no caller has to re-derive it.
 *
 * - `allow`    — echo `origin` in `Access-Control-Allow-Origin`.
 * - `deny`     — the tenant IS configured and this origin is not on its list. Refuse the request.
 * - `unconfigured` — a non-first-party tenant with nothing configured at either level. Refuse,
 *   and say so distinctly: inheriting Estalara's own domains here would silently grant an
 *   external brand the first party's allow-list (the FOLLOW-658 failure, one layer over).
 */
/**
 * Module-local by Rule I: callers read `.verdict` structurally and never name this type, and an
 * exported symbol with no non-test importer is dead surface. Third instance of that shape in this
 * session — the others were `CONSENT_TEXT_TIMEOUT_MS` and `toCanonicalOrigin`.
 */
type OriginDecision =
  | { verdict: 'allow'; origin: string; source: 'api_key' | 'tenant' | 'platform' }
  | { verdict: 'deny'; reason: string }
  | { verdict: 'unconfigured'; reason: string };

/** Module-local by Rule I — callers pass an object literal, never the named type. */
interface OriginPolicyInput {
  /** The browser's `Origin` header. Absent for server-side callers. */
  requestOrigin: string | null;
  /** `api_keys.allowed_origins` — nullable; `null` or `[]` means "no per-key override". */
  keyOrigins: string[] | null;
  /** `tenants.allowed_origins` — `NOT NULL DEFAULT []`; `[]` means NOT CONFIGURED, not deny-all. */
  tenantOrigins: string[];
  /** Whether the resolved tenant is the first party (Estalara itself). */
  isFirstParty: boolean;
  /** The platform allow-list, inherited only by the first party. */
  platformOrigins: readonly string[];
}

/**
 * Resolve one request's origin verdict.
 *
 * A request with **no `Origin` header** is a server-side caller (curl, an HMAC-signed adapter,
 * another service). Browsers always send `Origin` on cross-origin requests, so absence is not a
 * bypass a hostile page can arrange — it is answered by the API-key check instead, exactly as the
 * ingest Worker does.
 */
export function resolveOriginDecision(input: OriginPolicyInput): OriginDecision {
  const { requestOrigin, keyOrigins, tenantOrigins, isFirstParty, platformOrigins } = input;

  if (!requestOrigin) {
    return { verdict: 'allow', origin: '', source: 'platform' };
  }

  const canonical = toCanonicalOrigin(requestOrigin);
  if (canonical === null) {
    return { verdict: 'deny', reason: 'origin_unparseable' };
  }

  // Precedence: per-key override → tenant column → platform (first party only).
  // An EMPTY array at either level is "not configured" and falls through; it is never deny-all.
  const fromKey = keyOrigins ?? [];
  const configured = fromKey.length > 0 ? fromKey : tenantOrigins;
  const source: 'api_key' | 'tenant' = fromKey.length > 0 ? 'api_key' : 'tenant';

  if (configured.length > 0) {
    // An unparseable entry is DROPPED rather than fatal — fail closed at read, mirroring the
    // ingest gate. The projection script is the strict half: it refuses to WRITE one.
    const allowed = configured.map(toCanonicalOrigin).filter((o): o is string => o !== null);
    return allowed.includes(canonical)
      ? { verdict: 'allow', origin: canonical, source }
      : { verdict: 'deny', reason: 'forbidden_origin' };
  }

  if (isFirstParty) {
    return platformOrigins.includes(canonical)
      ? { verdict: 'allow', origin: canonical, source: 'platform' }
      : { verdict: 'deny', reason: 'forbidden_origin' };
  }

  return { verdict: 'unconfigured', reason: 'origin_policy_unconfigured' };
}
