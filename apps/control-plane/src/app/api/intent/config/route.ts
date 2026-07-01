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
 * Tie-break (FOLLOW-301):
 *   The weight query uses ORDER BY created_at DESC so newest-active-wins is
 *   deterministic even if the one-active-row invariant is ever transiently breached.
 *   Without ORDER BY the served config can be non-deterministic across CDN cache fills,
 *   causing FOLLOW-268-sdk weight flap.
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
import { and, desc, eq, isNull, or } from 'drizzle-orm';

import { createAdminClient, intentWeightConfigs } from '@estalara/db';
import type { IntentConfigResponse } from '@estalara/shared';
import { IntentWeightsSchema } from '@estalara/shared';
import { resolveApiKey } from '@/lib/api-key-auth';

// ─── CORS + Cache headers ─────────────────────────────────────────────────────

const RESPONSE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization',
  'Cache-Control': 'public, max-age=300',
} as const;

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
    // ORDER BY created_at DESC: newest-active-wins is deterministic even if the
    // one-active-row invariant is transiently breached (FOLLOW-301 LG-3 fix).
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
      .orderBy(desc(intentWeightConfigs.createdAt))
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
