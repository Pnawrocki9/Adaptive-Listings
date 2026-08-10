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
  /**
   * Whether the resolved tenant is the first party (Estalara itself), as a TRI-STATE.
   * [FOLLOW-951]
   *
   * `'unverified'` means `FIRST_PARTY_TENANT_ID` is unset/blank/malformed, so the answer is
   * UNKNOWABLE — it is deliberately NOT a synonym for `'confirmed'` here, because the two
   * branches below need opposite defaults on it. See `classifyFirstPartyTenant`.
   */
  firstPartyStatus: 'confirmed' | 'external' | 'unverified';
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
  const { requestOrigin, keyOrigins, tenantOrigins, firstPartyStatus, platformOrigins } = input;

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
    if (allowed.includes(canonical)) {
      return { verdict: 'allow', origin: canonical, source };
    }
    // FOLLOW-946 — the FIRST PARTY additionally keeps the platform list, and this is not a
    // convenience. `tenants.allowed_origins` exists to be populated for the INGEST KV projection
    // (`project-allowed-origins.mts`, `BRAND_PROVISIONING.md` §Step 6). Before this clause, doing
    // that documented thing for Estalara's own tenant would have silently locked Estalara out of
    // its OWN control plane — a column written for one layer taking precedence in another.
    //
    // **`'confirmed'` and not "not external" — this branch is fail-CLOSED, and the asymmetry with
    // the unconfigured branch below is the whole of FOLLOW-951.** This clause GRANTS origins a
    // tenant did not configure, so on unknowable first-party identity it must grant nothing:
    // `'unverified'` (env unset/blank/malformed) previously read as first-party via
    // `isFirstPartyTenant`'s fail-open and would have handed EVERY brand Estalara's two origins —
    // the FOLLOW-658 failure, found by RETRO-267 auditing the PR that introduced this clause.
    // Falsification: if a first party ever legitimately runs with the env unset AND a populated
    // origin list, it will be refused here, and the fix is to set the env var, not to widen this.
    if (firstPartyStatus === 'confirmed' && platformOrigins.includes(canonical)) {
      return { verdict: 'allow', origin: canonical, source: 'platform' };
    }
    return { verdict: 'deny', reason: 'forbidden_origin' };
  }

  // `!== 'external'` — this branch DELIBERATELY keeps the fail-open, which is the opposite
  // default to the grant branch above. [FOLLOW-951]
  //
  // It is not a grant of anything extra: an unconfigured tenant has no origin list at all, and
  // this is the only thing standing between the live first party and a 403 on every SDK request.
  // Prod runs exactly one tenant with `allowed_origins = []`, so EVERY live request takes this
  // branch. Requiring `'confirmed'` here would turn an unset or drifted `FIRST_PARTY_TENANT_ID`
  // into a total control-plane outage rather than a security fix — and that env var lives in two
  // unsynced stores (Doppler `prd` and Vercel), of which only Vercel's is read at runtime and its
  // value is not readable back. Measured 2026-08-10: Doppler `prd` holds the correct live tenant
  // UUID and the Vercel Production var is present (encrypted, unreadable), so `'unverified'` is
  // believed inactive in prod — believed, not proven, which is exactly why this direction stays
  // permissive and the granting one above does not.
  if (firstPartyStatus !== 'external') {
    return platformOrigins.includes(canonical)
      ? { verdict: 'allow', origin: canonical, source: 'platform' }
      : { verdict: 'deny', reason: 'forbidden_origin' };
  }

  return { verdict: 'unconfigured', reason: 'origin_policy_unconfigured' };
}
