/**
 * Shared two-step auth resolver for the read-only adaptation GET endpoints.
 *
 * FOLLOW-473 (RETRO-158 / FOLLOW-510). Extracted so that BOTH decision-grade GET
 * routes resolve their tenant identically, closing the fail-open + spoofable-
 * `x-tenant-id` gap that previously affected them. This mirrors the two-step
 * auth already shipped on `POST /api/adapt/feedback` (ADR-0015 / FOLLOW-450),
 * minus the HMAC body-signature step (GET requests carry no body to sign).
 *
 * CALL-SITE INVENTORY (Rule S — symmetric siblings; keep exhaustive):
 *   - `GET /api/adapt`             (app/api/adapt/route.ts)             — primary SDK pageview path
 *   - `GET /api/adapt/description` (app/api/adapt/description/route.ts) — long-form description path
 * Both MUST call this helper (never re-implement the two-step inline). A third
 * consumer added later MUST be appended here, AND must widen the `area` union
 * below (a real third route cannot reuse `'adapt'`/`'description'` as its own
 * tag) — the resulting compile error at every existing call site is the
 * forcing function that surfaces this docstring (RETRO-172 DG-1).
 *
 * Algorithm (fail CLOSED — never fabricate a tenant, never trust a header):
 *   Step 1 — Ops bypass (`ADAPT_API_KEY`): if the bearer constant-time-equals the
 *            shared ops secret, resolve the tenant from `OPS_TENANT_ID`. If
 *            `ADAPT_API_KEY` is set but `OPS_TENANT_ID` is not, this is a server
 *            misconfiguration → 500 (identical disposition to feedback/route.ts,
 *            ADR-0015 / CEO 2026-07-01). This branch is scoped to the single ops
 *            tenant — it can NEVER select an arbitrary caller-supplied tenant.
 *   Step 2 — `resolveApiKey(req)`: SHA-256(bearer) → `api_keys` row → real
 *            `tenantId` (constant-time belt-and-suspenders compare). Unknown /
 *            revoked / expired / empty key → 401. This is the primary path for
 *            real SDK traffic, which sends `Bearer ${config.apiKey}` (a real
 *            per-tenant key).
 *
 * `resolveApiKey` THROWS when a configured DB lookup fails (Rule K.2,
 * configured-but-failed). FOLLOW-532 (RETRO-164 §4a LG-1): this helper now
 * catches that throw ITSELF — Sentry-capturing and returning a normalized
 * `dbError: true` disposition — instead of leaving the try/catch + Sentry-tag
 * shape as an unenforced obligation duplicated at every call site. Before
 * FOLLOW-532, each of the two call sites owned its own identical try/catch;
 * an edit that dropped or altered ONE route's catch would silently regress
 * that route to an unhandled 500 on a DB outage, with the untouched sibling's
 * green CI giving no signal. Folding the catch in here makes divergence
 * structurally impossible: both callers now go through the SAME branch.
 *
 * @module apps/control-plane/src/lib/adapt-get-auth
 */

import * as Sentry from '@sentry/nextjs';
import type { NextRequest } from 'next/server';

import { resolveApiKey } from '@/lib/api-key-auth';
import { secretEquals } from '@/lib/secret-compare';

/**
 * Result of {@link resolveAdaptGetAuth}.
 *
 * On failure the caller renders `errorBody({ code, message, requestId })` with
 * the supplied HTTP `status` (401 for auth failures, 500 for the misconfiguration).
 * The `dbError: true` disposition (FOLLOW-532) is a 401 like any other invalid-key
 * failure to the caller/wire contract; it exists as a distinct discriminant purely
 * so tests can assert the DB-outage path was taken (vs. an ordinary unknown key).
 */
export type AdaptGetAuthResult =
  | { ok: true; tenantId: string }
  | { ok: false; status: 401 | 500; message: string }
  | { ok: false; status: 401; message: string; dbError: true }
  // [FOLLOW-943 AC(1)] An ORIGIN refusal, kept distinct from every auth failure above. It carries
  // the policy's machine-readable reason (`forbidden_origin`, `origin_policy_unconfigured`,
  // `first_party_unverified`) so the three causes are one grep apart instead of one 401.
  | { ok: false; status: 403; message: string; originReason: string };

/**
 * Resolve the authoritative tenant for a GET adaptation request.
 *
 * @param req         - The incoming request (passed to `resolveApiKey` for the bearer).
 * @param bearerToken - The already-extracted, trimmed bearer token (non-empty; the
 *                      caller has already rejected a missing/empty Authorization header).
 * @param area        - Sentry/log tag identifying the calling route (e.g. `'adapt'` /
 *                      `'description'') — the ONLY thing the call site still supplies;
 *                      everything else about the DB-throw disposition lives here now.
 * @returns `{ ok: true, tenantId }` — tenant derived server-side (ops secret or api_keys row).
 * @returns `{ ok: false, status: 401, message }` — invalid/unknown/revoked key.
 * @returns `{ ok: false, status: 500, message }` — `ADAPT_API_KEY` set without `OPS_TENANT_ID`.
 * @returns `{ ok: false, status: 401, message, dbError: true }` — `resolveApiKey` threw on a
 *          configured-but-failed DB lookup (Rule K.2); captured here to Sentry AND `console.error`.
 *          ⚠️ **The Sentry leg is INERT in production (FOLLOW-965):** `SENTRY_DSN_CONTROL_PLANE` is
 *          absent from every Vercel environment [MP-004], so the only channel that
 *          actually distinguishes this disposition from a genuinely bad key is the `console.error`
 *          in Vercel runtime logs. See `docs/runbooks/observability.md` §Control-plane Sentry
 *          signals. Never fabricates a tenant. Does NOT throw — the caller no longer needs
 *          try/catch.
 */
export async function resolveAdaptGetAuth(
  req: NextRequest,
  bearerToken: string,
  area: 'adapt' | 'description',
): Promise<AdaptGetAuthResult> {
  // ── Step 1: Ops bypass (ADAPT_API_KEY) — scoped to OPS_TENANT_ID ─────────────
  // Constant-time compare (secret-compare.ts) so the shared secret is not exposed
  // to a timing oracle. Checked FIRST, mirroring feedback/route.ts ordering.
  const adaptApiKey = process.env.ADAPT_API_KEY;
  if (adaptApiKey && secretEquals(adaptApiKey, bearerToken)) {
    const opsTenantId = process.env.OPS_TENANT_ID;
    if (!opsTenantId) {
      return {
        ok: false,
        status: 500,
        message: 'OPS_TENANT_ID must be set alongside ADAPT_API_KEY (server misconfiguration).',
      };
    }
    return { ok: true, tenantId: opsTenantId };
  }

  // ── Step 2: resolveApiKey — SHA-256(bearer) → api_keys row → real tenantId ───
  // FOLLOW-532: the throw on a configured-but-failed DB (Rule K.2) is caught
  // HERE (not left to the caller) so both call sites share one fail-loud path.
  let keyAuth: Awaited<ReturnType<typeof resolveApiKey>>;
  try {
    keyAuth = await resolveApiKey(req);
  } catch (err) {
    console.error(`[${area}] GET auth DB error`, err);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { area, kind: 'api_key_auth_db_error' },
    });
    return { ok: false, status: 401, message: 'Invalid API key', dbError: true };
  }
  if (!keyAuth.ok) {
    // An ORIGIN refusal is NOT an auth failure and must not be normalised into one.
    // [FOLLOW-943 AC(1)]
    //
    // The 401 below has a good original reason — no key-existence oracle on this endpoint — and
    // that reason does NOT extend to an origin verdict: `resolveApiKey` only reaches its origin
    // check AFTER the key has been found and validated, so 403 is reachable only with a VALID
    // key and leaks nothing about which keys exist. (Structurally, not by assertion: `status: 403`
    // has exactly one producer in `api-key-auth.ts`, the `resolveOriginDecision` result.)
    //
    // Collapsing it cost more than tidiness: `origin_policy_unconfigured` is a PROVISIONING gap
    // and `first_party_unverified` is a first-party lockout, and both surfaced as "invalid API
    // key" — the exact failure the FOLLOW-658/659/660 class was closed to prevent.
    if (keyAuth.status === 403) {
      return { ok: false, status: 403, message: keyAuth.error, originReason: keyAuth.error };
    }
    // Normalize 404 (key not found) → 401 so this endpoint is not a key-existence oracle.
    return { ok: false, status: 401, message: 'Invalid API key' };
  }
  return { ok: true, tenantId: keyAuth.tenantId };
}
