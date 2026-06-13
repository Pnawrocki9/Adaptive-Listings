/**
 * GET /api/intent/config
 *
 * K.3.6 Archetype Identification Tracer — SDK-facing weight config endpoint (AC8).
 *
 * Auth model (ADR-0012 §1 — mirrors GET /api/quiz/public-config per ADR-0011):
 *   - Header: `Authorization: Bearer <tenant-api-key>` (the SDK's `data-api-key` value).
 *   - Lookup: SHA-256(bearerToken) compared constant-time against `api_keys.hashed_key`.
 *   - `tenant_id` is derived from the authenticated key — NEVER accepted as a query param.
 *   - CORS: `Access-Control-Allow-Origin: *` (buyer-facing pages, no credentials).
 *
 * Fail-loud contract (Rule K.2):
 *   - DB configured but throws during auth lookup → 503 `{ error: "Service temporarily unavailable" }`.
 *   - Invalid/missing Bearer → 401 `{ error: "Invalid API key" }`.
 *   - Key not found in DB → 404 `{ error: "Tenant not found" }`.
 *   - DB unconfigured (dev/CI) → 200 with `weights: {}`, `data_source: 'mock'`.
 *   - No active weight row for tenant → 200 with `weights: {}`, `data_source: 'mock'`.
 *   - Active row found → 200 with `data_source: 'live'`.
 *   - DB configured but throws during weight fetch → 500 with `data_source: 'error'`.
 *
 * Rule H auth sign-off (read-only, no mutation):
 *   - Constant-time compare: `constantTimeEqual()` on SHA-256 hex digests.
 *   - Tenant-scoped: `tenant_id` resolved from the authenticated key, never from the request.
 *   - Cryptographic: SHA-256 hash lookup against `api_keys.hashed_key`.
 *   - Replay-resistant: read-only endpoint; no state mutation. Same risk model as
 *     `GET /api/quiz/public-config` (ADR-0011).
 *
 * Cache-Control: public, max-age=300 (5-min CDN TTL, same as ADR-0011 quiz config).
 *
 * Write path: FOLLOW-268-write (POST/PUT /api/admin/intent/config) creates real
 * intent_weight_configs rows that this route will serve as data_source: 'live'.
 * Until FOLLOW-268-write merges, all tenants receive data_source: 'mock' + empty weights.
 *
 * @module apps/control-plane/src/app/api/intent/config/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { and, eq, gt, isNull, or } from 'drizzle-orm';

import { createAdminClient, apiKeys, intentWeightConfigs } from '@estalara/db';
import type { IntentConfigResponse } from '@estalara/shared';
import { IntentWeightsSchema } from '@estalara/shared';

// ─── CORS + Cache headers ─────────────────────────────────────────────────────

const RESPONSE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization',
  'Cache-Control': 'public, max-age=300',
} as const;

// ─── Crypto helpers (same as quiz/public-config/route.ts) ─────────────────────

/**
 * Compute SHA-256 of a raw string → lower-case hex digest.
 * Used for api_keys lookup: the `hashed_key` column stores SHA-256(rawKey).
 *
 * @internal
 */
async function sha256Hex(input: string): Promise<string> {
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
 *
 * @internal
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

interface AuthOk {
  ok: true;
  tenantId: string;
}
interface AuthFail {
  ok: false;
  status: 401 | 404;
  error: string;
}

/**
 * Resolve `tenant_id` from the `Authorization: Bearer <api-key>` header.
 *
 * 1. SHA-256(bearerToken) compared (constant-time) against `api_keys.hashed_key`.
 * 2. Key must be active (not revoked, not expired).
 * 3. Returns 401 on invalid/missing bearer, 404 when key is not found in the DB.
 *
 * @internal
 */
async function resolveApiKey(req: NextRequest): Promise<AuthOk | AuthFail> {
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
    // Dev/CI: DB not configured — we cannot authenticate without a DB.
    // The GET handler catches this case before calling resolveApiKey, so this
    // branch is a safety net.
    return { ok: false, status: 401, error: 'Invalid API key' };
  }

  const keyHash = await sha256Hex(bearerToken);

  const db = createAdminClient();
  const now = new Date();

  const rows = await db
    .select({ tenantId: apiKeys.tenantId, hashedKey: apiKeys.hashedKey })
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

  return { ok: true, tenantId: keyRow.tenantId };
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/** Handle CORS preflight. */
export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: RESPONSE_HEADERS,
  });
}

/**
 * GET /api/intent/config
 *
 * @returns 200 IntentConfigResponse (weights may be empty `{}` — SDK uses defaults).
 * @returns 401 on missing/invalid Authorization bearer.
 * @returns 404 when the API key is not found.
 * @returns 503 when the auth DB throws.
 * @returns 500 when the weight-fetch DB throws (configured-but-failed, Rule K.2).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;

  // ── Unconfigured DB (dev/CI): return mock immediately ─────────────────────
  if (!adminUrl) {
    const body: IntentConfigResponse = {
      weights: {},
      effective_at: new Date().toISOString(),
      is_tenant_specific: false,
      data_source: 'mock',
    };
    return NextResponse.json(body, {
      status: 200,
      headers: RESPONSE_HEADERS,
    });
  }

  // ── Auth: Bearer API key → tenant_id ──────────────────────────────────────
  let auth: Awaited<ReturnType<typeof resolveApiKey>>;
  try {
    auth = await resolveApiKey(req);
  } catch (err) {
    // DB threw during auth lookup — 503 (same pattern as quiz/public-config).
    // We do NOT fall back to mock here: we have no tenant_id yet, so serving
    // mock to an unauthenticated caller would silently bypass auth.
    console.error('[intent/config] auth DB error', err);
    try {
      const { captureException } = await import('@sentry/nextjs');
      captureException(err);
    } catch {
      // Sentry not configured in this env
    }
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }

  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: RESPONSE_HEADERS },
    );
  }

  const { tenantId } = auth;

  // ── Live path: query Postgres for active weight config ────────────────────
  try {
    const db = createAdminClient();

    // Fetch both tenant-specific and global rows in one query.
    // Tenant-specific (tenant_id = tenantId) takes priority over global (tenant_id IS NULL).
    // or(eq, isNull) covers both scopes; at most 2 rows can be returned.
    const rows = await db
      .select({
        id: intentWeightConfigs.id,
        tenantId: intentWeightConfigs.tenantId,
        weights: intentWeightConfigs.weights,
        createdAt: intentWeightConfigs.createdAt,
        isActive: intentWeightConfigs.isActive,
      })
      .from(intentWeightConfigs)
      .where(
        and(
          eq(intentWeightConfigs.isActive, true),
          or(eq(intentWeightConfigs.tenantId, tenantId), isNull(intentWeightConfigs.tenantId)),
        ),
      )
      .limit(2); // At most 2: one tenant-specific + one global.

    // Prefer tenant-specific over global (tenant_id NOT NULL wins).
    const tenantRow = rows.find((r) => r.tenantId !== null);
    const globalRow = rows.find((r) => r.tenantId === null);
    const activeRow = tenantRow ?? globalRow;

    if (!activeRow) {
      // No active config — SDK uses internal defaults.
      const body: IntentConfigResponse = {
        weights: {},
        effective_at: new Date().toISOString(),
        is_tenant_specific: false,
        data_source: 'mock',
      };
      return NextResponse.json(body, {
        status: 200,
        headers: RESPONSE_HEADERS,
      });
    }

    // Parse stored JSONB through IntentWeightsSchema to validate the shape.
    // If the stored value is invalid (e.g. legacy shape), surface as 500.
    const parsedWeights = IntentWeightsSchema.parse(activeRow.weights ?? {});

    const body: IntentConfigResponse = {
      weights: parsedWeights,
      effective_at: activeRow.createdAt.toISOString(),
      is_tenant_specific: activeRow.tenantId !== null,
      data_source: 'live',
    };
    return NextResponse.json(body, {
      status: 200,
      headers: RESPONSE_HEADERS,
    });
  } catch (err: unknown) {
    // Configured-but-failed: fail loud (Rule K.2). Never return mock data.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[intent/config] DB error fetching weight config', err);
    try {
      const { captureException } = await import('@sentry/nextjs');
      captureException(err, {
        extra: { route: 'GET /api/intent/config', tenantId, message },
      });
    } catch {
      // Sentry not configured in this env
    }
    return NextResponse.json(
      {
        error: {
          code: 'db_error',
          message: 'Postgres query failed — see Sentry for details',
        },
        data_source: 'error',
      },
      { status: 500, headers: RESPONSE_HEADERS },
    );
  }
}
