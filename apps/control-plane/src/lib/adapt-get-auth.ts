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
 * consumer added later MUST be appended here.
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
 * configured-but-failed). This helper does NOT catch it — the caller MUST wrap
 * the call in try/catch, capture to Sentry, and fail loud (401), so a DB outage
 * is observable and never silently fabricates a tenant.
 *
 * @module apps/control-plane/src/lib/adapt-get-auth
 */

import type { NextRequest } from 'next/server';

import { resolveApiKey } from '@/lib/api-key-auth';
import { secretEquals } from '@/lib/secret-compare';

/**
 * Result of {@link resolveAdaptGetAuth}.
 *
 * On failure the caller renders `errorBody({ code, message, requestId })` with
 * the supplied HTTP `status` (401 for auth failures, 500 for the misconfiguration).
 */
export type AdaptGetAuthResult =
  | { ok: true; tenantId: string }
  | { ok: false; status: 401 | 500; message: string };

/**
 * Resolve the authoritative tenant for a GET adaptation request.
 *
 * @param req         - The incoming request (passed to `resolveApiKey` for the bearer).
 * @param bearerToken - The already-extracted, trimmed bearer token (non-empty; the
 *                      caller has already rejected a missing/empty Authorization header).
 * @returns `{ ok: true, tenantId }` — tenant derived server-side (ops secret or api_keys row).
 * @returns `{ ok: false, status: 401, message }` — invalid/unknown/revoked key.
 * @returns `{ ok: false, status: 500, message }` — `ADAPT_API_KEY` set without `OPS_TENANT_ID`.
 * @throws  Propagates any error thrown by `resolveApiKey` (configured DB failure) — the
 *          caller MUST catch, Sentry-capture, and fail loud (401).
 */
export async function resolveAdaptGetAuth(
  req: NextRequest,
  bearerToken: string,
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
  // Throws on configured-but-failed DB (Rule K.2) — caller catches + fails loud.
  const keyAuth = await resolveApiKey(req);
  if (!keyAuth.ok) {
    // Normalize 404 (key not found) → 401 so this endpoint is not a key-existence oracle.
    return { ok: false, status: 401, message: 'Invalid API key' };
  }
  return { ok: true, tenantId: keyAuth.tenantId };
}
