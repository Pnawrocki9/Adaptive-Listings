/**
 * GET /api/intent/config
 *
 * K.3.6 Archetype Identification Tracer — SDK-facing weight config endpoint (AC8).
 *
 * PUBLIC route (no auth). Returns the active intent weight configuration for the
 * requesting tenant. The SDK calls this on init to fetch signal weights.
 *
 * Priority:
 *   1. Tenant-specific active row (tenant_id = :tenantId AND is_active = true)
 *   2. Global default row (tenant_id IS NULL AND is_active = true)
 *
 * Query params:
 *   tenant_id (required) — tenant UUID to look up. The SDK supplies its own pk_live_
 *   key context; this endpoint does not require authentication (same risk profile
 *   as /api/quiz/public-config per ADR-0011).
 *
 * Cache-Control: public, max-age=300 (5-min CDN TTL, same pattern as ADR-0011 quiz config).
 *
 * Rule K.2: when DATABASE_URL_ADMIN is configured but fails → HTTP 500 with
 * data_source: 'error'. When unconfigured → 200 with data_source: 'mock'.
 *
 * @module apps/control-plane/src/app/api/intent/config/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { and, eq, isNull, or } from 'drizzle-orm';

import { createAdminClient, intentWeightConfigs } from '@estalara/db';
import type { IntentConfigResponse } from '@estalara/shared';

// ─── Cache-Control headers (ADR-0011 pattern) ─────────────────────────────────

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300',
};

// ─── Query param schema ───────────────────────────────────────────────────────

const QuerySchema = z.object({
  tenant_id: z.string().uuid('tenant_id must be a valid UUID'),
});

// ─── Default weights (mock / unconfigured) ────────────────────────────────────

/**
 * Default weight configuration returned when the database is unconfigured
 * (dev/CI) or when no active row exists for the tenant. This is the same
 * baseline weight set used by the SDK intent engine's built-in prior.
 *
 * These values are illustrative defaults — real production weights are managed
 * via the FOLLOW-268 weight editor API.
 */
const DEFAULT_WEIGHTS: Record<string, unknown> = {
  signal_weights: {
    quiz_answer: 2.0,
    chat_turn: 1.5,
    behavioral: 0.8,
    dwell: 0.5,
    pageview: 0.3,
    referrer: 0.4,
    filter_applied: 0.6,
  },
  priors: {
    neutral: 1.0,
  },
  behavioral_damping: 0.85,
};

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/intent/config?tenant_id=<uuid>
 *
 * @returns 200 IntentConfigResponse with Cache-Control: public, max-age=300.
 * @returns 400 on missing/invalid tenant_id.
 * @returns 500 if the database is configured but throws.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Validate query params ─────────────────────────────────────────────────
  const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_error', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { tenant_id: tenantId } = parsed.data;

  // ── Unconfigured (dev/CI): return mock with observable flag ───────────────
  const dbConfigured =
    Boolean(process.env.DATABASE_URL_ADMIN) || Boolean(process.env.DATABASE_URL_DIRECT);

  if (!dbConfigured) {
    const body: IntentConfigResponse = {
      weights: DEFAULT_WEIGHTS,
      effective_at: new Date().toISOString(),
      is_tenant_specific: false,
      data_source: 'mock',
    };
    return NextResponse.json(body, {
      status: 200,
      headers: CACHE_HEADERS,
    });
  }

  // ── Live path: query Postgres ─────────────────────────────────────────────
  try {
    const db = createAdminClient();

    // Fetch both tenant-specific and global rows in one query.
    // Tenant-specific (tenant_id = tenantId) takes priority over global (tenant_id IS NULL).
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
      // No active config — return default weights with mock provenance.
      const body: IntentConfigResponse = {
        weights: DEFAULT_WEIGHTS,
        effective_at: new Date().toISOString(),
        is_tenant_specific: false,
        data_source: 'mock',
      };
      return NextResponse.json(body, {
        status: 200,
        headers: CACHE_HEADERS,
      });
    }

    const body: IntentConfigResponse = {
      weights: activeRow.weights as Record<string, unknown>,
      effective_at: activeRow.createdAt.toISOString(),
      is_tenant_specific: activeRow.tenantId !== null,
      data_source: 'live',
    };
    return NextResponse.json(body, {
      status: 200,
      headers: CACHE_HEADERS,
    });
  } catch (err: unknown) {
    // Configured-but-failed: fail loud (Rule K.2). Never return mock data.
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      extra: { route: 'GET /api/intent/config', tenantId, message },
    });
    return NextResponse.json(
      {
        error: {
          code: 'db_error',
          message: 'Postgres query failed — see Sentry for details',
        },
        data_source: 'error',
      },
      { status: 500 },
    );
  }
}
