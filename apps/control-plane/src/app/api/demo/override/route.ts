/**
 * GET  /api/demo/override — read the current DEMO MODE override for the tenant
 * PUT  /api/demo/override — set the DEMO MODE override (enable/disable, archetype, model)
 *
 * Auth:
 *   GET — agency:viewer minimum (read-only, same as /api/demo/sessions)
 *   PUT — agency:admin minimum (mutating, per Rule H: auth in same PR as endpoint)
 *
 * JWT-verified tenant claims are required for both methods via requireTenantAccess.
 * The tenant_id is taken from the verified JWT — never from a request body or header.
 *
 * Inputs validated with Zod:
 *   - archetype ∈ REACHABLE_ARCHETYPES (13 values)
 *   - model ∈ DEMO_ALLOWED_MODELS (3 values)
 *   - enabled is required boolean
 *
 * When enabled=true and archetype is null/omitted, the PUT returns 400 — you must
 * pick an archetype before activating DEMO MODE.
 *
 * Response shape (200):
 *   {
 *     tenant_id:          string,
 *     enabled:            boolean,
 *     override_archetype: string | null,
 *     override_model:     string,
 *     updated_at:         string (ISO)
 *   }
 *
 * @module apps/control-plane/src/app/api/demo/override/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
// FOLLOW-555 (A3-F-04): both methods are called by the demo-override dashboard page, so
// they must accept the @supabase/ssr browser session in addition to Bearer/legacy cookie.
import { requireTenantSessionAccess } from '@/lib/session-auth';
import {
  getDemoOverride,
  upsertDemoOverride,
  REACHABLE_ARCHETYPES,
  DEMO_ALLOWED_MODELS,
  DEMO_DEFAULT_MODEL,
} from '@/lib/demo-override-store';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const PutBodySchema = z.object({
  enabled: z.boolean(),
  /**
   * Required when enabled=true; optional (null) when disabling.
   * Must be one of the 13 reachable archetypes.
   */
  override_archetype: z.enum(REACHABLE_ARCHETYPES).nullable().optional(),
  /** Defaults to claude-sonnet-4-6 when omitted. */
  override_model: z.enum(DEMO_ALLOWED_MODELS).optional().default(DEMO_DEFAULT_MODEL),
});

// ─── GET ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/demo/override
 *
 * Returns the current DEMO MODE override state for the authenticated tenant.
 * Requires agency:viewer role minimum.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  let claims;
  try {
    claims = await requireTenantSessionAccess(req, 'agency:viewer');
  } catch {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Valid JWT with tenant access is required' } },
      { status: 401 },
    );
  }

  const tenantId = claims.tenant_id;

  try {
    const override = await getDemoOverride(tenantId);
    return NextResponse.json({
      tenant_id: tenantId,
      enabled: override.enabled,
      override_archetype: override.overrideArchetype,
      override_model: override.overrideModel,
      archetypes: REACHABLE_ARCHETYPES,
      models: DEMO_ALLOWED_MODELS,
    });
  } catch (err: unknown) {
    console.error('[demo/override GET] DB read failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to read demo override' } },
      { status: 500 },
    );
  }
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

/**
 * PUT /api/demo/override
 *
 * Creates or replaces the DEMO MODE override for the authenticated tenant.
 * Requires agency:admin role minimum (agency:admin or agency:owner).
 *
 * Validation:
 *   - enabled=true requires override_archetype to be set (non-null).
 *   - override_model must be in the curated allow-list.
 *   - override_archetype must be one of the 13 reachable archetypes.
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  let claims;
  try {
    claims = await requireTenantSessionAccess(req, 'agency:admin');
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'unauthorized',
          message: 'Valid JWT with agency:admin or agency:owner role is required',
        },
      },
      { status: 401 },
    );
  }

  const tenantId = claims.tenant_id;
  const updatedBy = claims.sub;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  const parsed = PutBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Invalid request body',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const body = parsed.data;

  // When enabling demo mode, archetype must be set.
  if (body.enabled && !body.override_archetype) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'override_archetype is required when enabled is true',
        },
      },
      { status: 400 },
    );
  }

  try {
    const row = await upsertDemoOverride(
      tenantId,
      {
        enabled: body.enabled,
        overrideArchetype: body.override_archetype ?? null,
        overrideModel: body.override_model,
      },
      updatedBy,
    );

    return NextResponse.json({
      tenant_id: tenantId,
      enabled: row.enabled,
      override_archetype: row.overrideArchetype,
      override_model: row.overrideModel,
      updated_at: row.updatedAt.toISOString(),
    });
  } catch (err: unknown) {
    console.error('[demo/override PUT] DB write failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to save demo override' } },
      { status: 500 },
    );
  }
}
