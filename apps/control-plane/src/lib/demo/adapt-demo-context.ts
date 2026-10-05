/**
 * The demo-only half of `POST /api/adapt` (FOLLOW-1288, WP-2.3): the demo-JWT and ops-caller auth
 * variants, demo-session revocation and the per-tenant archetype override.
 *
 * `app/api/adapt/route.ts` calls these ONLY when `isDemoModeEnabled()` (`./demo-mode.ts`) is true.
 * With `DEMO_MODE` unset the route never imports a decision from here: every bearer goes straight
 * to the tenant API-key path (`resolveApiKey`, ADR-0015), `DEMO_MODE_JWT_SECRET` is not read, and
 * the override store is not queried. The behaviour below is moved verbatim from `route.ts` at
 * `879833ce`; `route.demo.test.ts` pins it with the flag on and pins its absence with the flag off.
 *
 * Crypto/replay posture (unchanged): ops caller — `secretEquals` constant-time compare against
 * `ADAPT_API_KEY`, tenant pinned server-side to `OPS_TENANT_ID`; demo JWT — HS256 verified with
 * `crypto.subtle.verify` (constant-time), `exp` enforced, revocable at runtime via
 * `demo_sessions.revoked_at`.
 *
 * ── The demo-JWT path is NOT origin-gated, and that is a decision, not an oversight ──
 *
 * [FOLLOW-943 AC(3)] `verifyDemoJwt` returns a tenant WITHOUT reaching `resolveApiKey`, so no
 * `resolveOriginDecision` runs on this branch. Acceptable because a demo JWT is minted by Estalara
 * for a demo session, is short-lived (`exp`), is revocable at runtime (`isDemoSessionRevoked`), and
 * is never issued to a brand's own domain — the demo runs on Estalara's origins, which are exactly
 * the platform allow-list the gate would grant anyway.
 *
 * FALSIFICATION — the condition that turns this into a hole: **the day a demo JWT is issued for, or
 * usable from, a tenant's own domain**, this path grants an adaptation with no per-tenant origin
 * check at all. If demo sessions ever become embeddable on brand sites, gate this path before
 * shipping that.
 *
 * @module apps/control-plane/src/lib/demo/adapt-demo-context
 */

import {
  getDemoOverride,
  DEMO_OVERRIDE_CONFIDENCE,
  DEMO_OVERRIDE_SIMILARITY,
} from '@/lib/demo-override-store';
import {
  verifyDemoJwt,
  DemoJwtSecretMissingError,
  DemoJwtInvalidError,
  type DemoJwtClaims,
} from '@/lib/demo-jwt-verify';
import { resolveDemoSessionRevocation } from '@/lib/demo-session-revocation';
import { secretEquals } from '@/lib/secret-compare';

/** A caller authenticated by one of the demo-mode variants. */
export type DemoAuth =
  /**
   * FOLLOW-1201 / FOLLOW-1102: the ops caller — the ONLY caller whose body `holdout_pct` is
   * honoured. How the FOLLOW-819 harness forces its control arm (`holdout_pct: 1`) — with the ops
   * secret, not with the tenant's public key, which any page visitor also holds.
   */
  | { kind: 'ops'; tenantId: string }
  /** FOLLOW-205: a verified demo-session JWT. */
  | { kind: 'demo_jwt'; claims: DemoJwtClaims };

type DemoAuthResult =
  /** `auth: null` — the bearer is neither variant; the route continues to `resolveApiKey`. */
  | { ok: true; auth: DemoAuth | null }
  /** Terminal: the route answers `{ error }` with `status`. */
  | { ok: false; status: 500; error: 'ops_auth_misconfigured' | 'demo_auth_misconfigured' };

/**
 * Try the demo-mode auth variants for `token`, in the order the route always used: ops key, then
 * demo JWT.
 *
 * @param token - The bearer, without the `Bearer ` prefix.
 * @returns the authenticated variant, `auth: null` when the token is not a demo credential, or a
 *   terminal 500 when the deployment is half-configured (`OPS_TENANT_ID` missing for a matching
 *   ops key; `DEMO_MODE_JWT_SECRET` missing — never falls through to the API-key path, it is a
 *   misconfiguration signal).
 * @throws whatever `verifyDemoJwt` throws that is neither of its two typed errors (surfaces as 500).
 */
export async function resolveDemoAuth(token: string): Promise<DemoAuthResult> {
  const adaptApiKey = process.env.ADAPT_API_KEY;
  if (adaptApiKey && secretEquals(adaptApiKey, token)) {
    const opsTenantId = process.env.OPS_TENANT_ID;
    if (!opsTenantId) return { ok: false, status: 500, error: 'ops_auth_misconfigured' };
    return { ok: true, auth: { kind: 'ops', tenantId: opsTenantId } };
  }
  try {
    return { ok: true, auth: { kind: 'demo_jwt', claims: await verifyDemoJwt(token) } };
  } catch (err) {
    if (err instanceof DemoJwtSecretMissingError) {
      return { ok: false, status: 500, error: 'demo_auth_misconfigured' };
    }
    // Not a valid demo JWT — the route falls back to the tenant API-key path (FOLLOW-451).
    if (err instanceof DemoJwtInvalidError) return { ok: true, auth: null };
    throw err;
  }
}

/**
 * FOLLOW-636: runtime demo-session revocation. `verifyDemoJwt` proves signature + `exp` only; a
 * revoke writes `demo_sessions.revoked_at`, which an issued token cannot reflect. Applies only to
 * the demo-JWT variant that carries a `session_id`. Fail-OPEN on a lookup problem (Sentry-captured
 * inside the helper); signature + exp stay fail-closed.
 *
 * @returns true when the route must answer the same `401 invalid_demo_token` as a bad token.
 */
export async function isDemoSessionRevoked(auth: DemoAuth): Promise<boolean> {
  if (auth.kind !== 'demo_jwt' || !auth.claims.session_id) return false;
  const { revoked } = await resolveDemoSessionRevocation(auth.claims.session_id);
  return revoked;
}

/** What an enabled DEMO MODE override substitutes for the SDK's hint (DEMO-001 / AC4). */
interface DemoArchetypeOverride {
  archetypeId: string;
  confidence: number;
  similarity: number;
  /** Anthropic model the operator chose; the route forces it on the LLM call. */
  forceModel: string;
}

/**
 * Load the per-tenant demo override. When enabled, the route ignores the SDK's
 * `archetype_hint`/`confidence`/`similarity` and substitutes the operator's archetype at high
 * confidence and medium similarity, so Branch 3 (LLM tweak) runs with the chosen model.
 *
 * Fail behaviour: a configured store that throws is logged and the route degrades to the SDK hint
 * (Rule K.2 — loud in logs; the response carries no `demo_override` flag, so it is observable).
 *
 * @param tenantId - The server-derived tenant.
 * @returns the override, or null when disabled, unset or unreadable.
 */
export async function resolveDemoArchetypeOverride(
  tenantId: string,
): Promise<DemoArchetypeOverride | null> {
  try {
    const state = await getDemoOverride(tenantId);
    if (!state.enabled || !state.overrideArchetype) return null;
    return {
      archetypeId: state.overrideArchetype,
      confidence: DEMO_OVERRIDE_CONFIDENCE,
      similarity: DEMO_OVERRIDE_SIMILARITY,
      forceModel: state.overrideModel,
    };
  } catch (err: unknown) {
    console.error(
      '[adapt POST] demo override DB read failed — falling back to SDK hint:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
