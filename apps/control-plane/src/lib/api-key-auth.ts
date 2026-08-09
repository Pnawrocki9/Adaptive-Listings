/**
 * Shared API key authentication helpers for tenant-scoped endpoints.
 *
 * Canonical implementation of the SHA-256 bearer-token → tenant resolution
 * pattern used across the control plane. Extracted from
 * `apps/control-plane/src/app/api/quiz/public-config/route.ts` per ADR-0015
 * (FOLLOW-443) to eliminate Rule K.1 intra-runtime duplication.
 *
 * Consumers:
 *   - `GET /api/quiz/public-config`   (quiz/public-config/route.ts)
 *   - `GET /api/intent/config`        (intent/config/route.ts)
 *   - `POST /api/adapt/feedback`      (adapt/feedback/route.ts)
 *   - `POST /api/quiz/completion`     (quiz/completion/route.ts — sha256Hex only)
 *   - `POST /api/crm/outcome`         (crm/outcome/route.ts — sha256Hex only)
 *
 * Algorithm:
 *   1. Extract `Authorization: Bearer <rawKey>` from the request.
 *   2. Compute `keyHash = SHA-256(rawKey)` (hex).
 *   3. SELECT from `api_keys` WHERE `hashed_key = $keyHash`
 *        AND `revoked_at IS NULL`
 *        AND (`expires_at IS NULL` OR `expires_at > NOW()`).
 *   4. Belt-and-suspenders: `constantTimeEqual(row.hashedKey, keyHash)`.
 *   5. Return `{ ok: true, tenantId }` on success.
 *
 * Timing guarantees:
 *   - The DB lookup is an indexed equality scan on `hashed_key` (unique index
 *     `api_keys_hashed_key_idx`). Timing depends on DB I/O, NOT key matching.
 *   - `constantTimeEqual` XOR-accumulates over all bytes without short-circuiting,
 *     eliminating any in-process timing oracle on the hash comparison.
 *
 * @see packages/db/src/schema/api_keys.ts — hashed_key = SHA-256(rawKey), unique index
 * @see docs/adr/ADR-0015-feedback-endpoint-authentication.md — canonical auth design
 * @module apps/control-plane/src/lib/api-key-auth
 */

import type { NextRequest } from 'next/server';
import { and, eq, gt, isNull, or } from 'drizzle-orm';

import { createAdminClient, apiKeys, tenants } from '@estalara/db';

import { isFirstPartyTenant } from './brand-identity';
import { CORS_PROD_ORIGINS, resolveOriginDecision } from './origin-policy';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApiKeyAuthResult =
  | {
      ok: true;
      tenantId: string;
      /**
       * The origin to echo in `Access-Control-Allow-Origin`, or `''` for a server-side caller
       * that sent no `Origin`. [FOLLOW-941]
       */
      allowedOrigin: string;
    }
  | { ok: false; status: 401 | 403 | 404; error: string };

// ─── Crypto helpers ───────────────────────────────────────────────────────────

/**
 * Compute SHA-256 of a raw string → lower-case hex digest.
 * Used for api_keys lookup: the `hashed_key` column stores SHA-256(rawKey).
 *
 * @see packages/db/src/schema/api_keys.ts — hashed_key = SHA-256(rawKey)
 * @see ADR-0015 — permanent auth fix for ESC-035
 */
export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time string comparison. Returns true iff `a === b` without short-circuiting.
 * Prevents timing side-channels when comparing SHA-256 hex digests.
 *
 * Both inputs must be lower-case hex of equal length; if lengths differ the function
 * returns false immediately (length itself is not secret for fixed-length hashes).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ─── resolveApiKey ────────────────────────────────────────────────────────────

/**
 * Resolve `tenant_id` from the `Authorization: Bearer <api-key>` header.
 *
 * Computes SHA-256(bearerToken), looks up `api_keys.hashed_key` via unique
 * index (O(1)). Belt-and-suspenders constant-time compare prevents timing oracle.
 *
 * @returns `{ ok: true, tenantId }` on success.
 * @returns `{ ok: false, status: 401, error }` — missing / invalid / empty bearer.
 * @returns `{ ok: false, status: 404, error }` — key not found in DB (unknown key
 *          or revoked/expired). NOTE: mutation-endpoint callers should normalize
 *          404 → 401 to prevent key-existence enumeration.
 *
 * @see ADR-0015 §Verification Algorithm Step 3-4
 */
export async function resolveApiKey(req: NextRequest): Promise<ApiKeyAuthResult> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Invalid API key' };
  }

  const bearerToken = authHeader.slice('Bearer '.length).trim();
  if (!bearerToken) {
    return { ok: false, status: 401, error: 'Invalid API key' };
  }

  const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!adminUrl) {
    // Dev/CI: DB not configured — cannot authenticate without a DB.
    // Callers handle the unconfigured case before calling resolveApiKey where appropriate.
    return { ok: false, status: 401, error: 'Invalid API key' };
  }

  const keyHash = await sha256Hex(bearerToken);

  // Constant-time path: hash the presented token, do an indexed equality lookup.
  // Timing depends only on DB I/O, not on key matching.
  // Belt-and-suspenders constantTimeEqual removes any residual in-process oracle.
  const db = createAdminClient();
  const now = new Date();

  const rows = await db
    .select({
      tenantId: apiKeys.tenantId,
      hashedKey: apiKeys.hashedKey,
      // FOLLOW-941 — Postgres is the SOURCE OF TRUTH for the origin policy; the KV copy the
      // ingest Worker reads is a projection of this column and the tenant's.
      keyOrigins: apiKeys.allowedOrigins,
    })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.hashedKey, keyHash),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
      ),
    )
    .limit(1);

  const keyRow = rows[0];
  if (!keyRow) {
    return { ok: false, status: 404, error: 'Tenant not found' };
  }

  // Belt-and-suspenders: constant-time compare the stored hash with our computed hash.
  if (!constantTimeEqual(keyRow.hashedKey, keyHash)) {
    return { ok: false, status: 401, error: 'Invalid API key' };
  }

  // ── Per-tenant browser-origin gate [FOLLOW-941] ────────────────────────────
  // Enforced HERE, at the authenticated layer, rather than in middleware: the preflight carries
  // no API key, so middleware cannot know the tenant (the ingest Worker documents the same
  // two-layer split). Refusing with 403 rather than merely omitting the CORS header is the
  // stronger half — omitting a header stops the BROWSER reading the response, but the request
  // already ran and any write already happened.
  //
  // **Short-circuits when there is no `Origin`,** BEFORE the tenant lookup. That is not just an
  // optimisation: a server-side caller (curl, an HMAC-signed adapter, another service) is not a
  // browser and has no origin to police, and skipping the query keeps this gate off the hot path
  // for every non-browser caller.
  const requestOrigin = req.headers.get('Origin');
  if (!requestOrigin) {
    return { ok: true, tenantId: keyRow.tenantId, allowedOrigin: '' };
  }

  // Deliberately a SECOND query rather than a join on the lookup above: the join changed the
  // shape of a query six routes' tests mock, and a gate that forces eight unrelated test files
  // to be rewritten is a gate that will be reverted.
  const tenantRows = await db
    .select({ allowedOrigins: tenants.allowedOrigins })
    .from(tenants)
    .where(eq(tenants.id, keyRow.tenantId))
    .limit(1);

  const decision = resolveOriginDecision({
    requestOrigin,
    keyOrigins: keyRow.keyOrigins,
    tenantOrigins: tenantRows[0]?.allowedOrigins ?? [],
    isFirstParty: isFirstPartyTenant(keyRow.tenantId),
    platformOrigins: CORS_PROD_ORIGINS,
  });
  if (decision.verdict !== 'allow') {
    return { ok: false, status: 403, error: decision.reason };
  }

  return { ok: true, tenantId: keyRow.tenantId, allowedOrigin: decision.origin };
}
