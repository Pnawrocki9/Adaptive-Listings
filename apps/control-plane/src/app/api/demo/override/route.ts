/**
 * GET  /api/demo/override — read the current DEMO MODE override for a tenant
 * PUT  /api/demo/override — set the DEMO MODE override (enable/disable, archetype, model)
 *
 * Auth (ADR-0018 §2, FOLLOW-596): `resolveTenantAccess` with `allowStaffOverride`.
 *   The agency path is byte-unchanged from the pre-596 behaviour — the tenant id is
 *   sourced ONLY from the session claim, GET requires `agency:viewer`+, PUT requires
 *   `agency:admin`+ (mutating), and agency writes are NOT audited. An Estalara staff
 *   caller may read/write ANY tenant by supplying an explicit `?tenant_id=<uuid>`,
 *   which is validated against the `tenants` table; that validated id becomes the
 *   SINGLE tenant fence bound into every query (ADR-0018 §2 invariant 5). This route
 *   uses `createAdminClient()` (service-role, RLS BYPASSED) on the staff write path,
 *   so the explicit `eq(demoOverrides.tenantId, access.tenantId)` fence is the ONLY
 *   tenant boundary.
 *
 *   GET  — agency `agency:viewer`+ or staff (read). Fails LOUD on a configured-but-
 *     failed DB dependency (Rule K.2): a thrown query returns HTTP 500, never an
 *     "enabled=false" default that would silently tell the dashboard DEMO MODE is off
 *     when we do not actually know the tenant's real state.
 *   PUT  — write. Agency: `agency:admin`+ (UNCHANGED — viewer may NOT write here,
 *     unlike quiz/config). Staff: additionally gated on `access.canWrite`
 *     (rank ≥ `estalara:ops`, CEO Q3) — a staff caller below ops rank
 *     (`estalara:readonly`) is 403. Every successful STAFF write appends one
 *     `staff_audit_log` row (`action: 'demo_override.update'`, ADR-0018 §3); agency
 *     writes are NOT audited.
 *     ATOMICITY (FOLLOW-605/607, ADR-0018 §3a): on the staff path the demo-override
 *     upsert and the `staff_audit_log` insert commit-or-roll-back TOGETHER in ONE
 *     `db.transaction()`, so an override mutation can never outlive a missing audit
 *     row (RETRO-190 §4a). Any failure inside the tx rolls BOTH back → 500
 *     `audit_write_failed` (no orphan mutation). This shape is mechanically enforced
 *     by `scripts/check-staff-write-atomicity.sh`.
 *
 *   Transaction-plumbing choice (FOLLOW-596 caveat): the staff write INLINES the
 *   demo-override upsert inside the `db.transaction()` block rather than delegating to
 *   `upsertDemoOverride` (which opens its own `createAdminClient()` and is not
 *   tx-aware). This mirrors the reference impl (`api/quiz/config/route.ts`, which
 *   inlines its write too) and — critically — keeps the data mutation textually IN the
 *   route so the FOLLOW-607 atomicity guard actually engages on it (a delegated write
 *   would leave only `insert(staffAuditLog)` in the file, which the guard treats as an
 *   audit-of-a-read and SKIPS, providing zero protection). The AGENCY path still calls
 *   `upsertDemoOverride` so its behaviour is byte-unchanged.
 *
 *   Identity caveat (RETRO-187): `resolveTenantAccess` REJECTS the headless
 *   `ADMIN_API_SECRET` Bearer path for staff (403 — a shared secret is not attributable
 *   to a staff user; a privileged staff write MUST be attributable to
 *   `staff_audit_log.adminUserId`). Staff need an identified SSR session or staff JWT.
 *
 * JWT/session-verified tenant claims are required for both methods. The tenant id is
 * NEVER taken from a request body or header.
 *
 * Inputs validated with Zod:
 *   - override_archetype ∈ REACHABLE_ARCHETYPES (13 values)
 *   - override_model ∈ DEMO_ALLOWED_MODELS (3 values)
 *   - enabled is required boolean
 *
 * When enabled=true and archetype is null/omitted, the PUT returns 400 — you must
 * pick an archetype before activating DEMO MODE.
 *
 * Response shape (200, PUT):
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
import * as Sentry from '@sentry/nextjs';

import { createAdminClient, demoOverrides, staffAuditLog } from '@estalara/db';
import type { DemoOverrideRow } from '@estalara/db';

import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';
import {
  getDemoOverride,
  upsertDemoOverride,
  REACHABLE_ARCHETYPES,
  DEMO_ALLOWED_MODELS,
  DEMO_DEFAULT_MODEL,
} from '@/lib/demo-override-store';
import type { DemoOverride } from '@/lib/demo-override-store';

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Best-effort client IP for the staff audit trail (no throw if absent). */
function requestIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

// ─── GET ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/demo/override
 *
 * Returns the current DEMO MODE override state for the resolved tenant.
 * Agency: `agency:viewer`+ on its own tenant. Staff: read any tenant via
 * `?tenant_id=<uuid>` (validated).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      minAgencyRole: 'agency:viewer',
      // exactOptionalPropertyTypes (RETRO-189): omit the key when absent rather than
      // passing `undefined`, so a staff caller without ?tenant_id reaches resolve's 400.
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
  } catch (err) {
    return accessErrorToResponse(err);
  }

  const tenantId = access.tenantId;

  try {
    // Fenced on access.tenantId inside the store query (invariant 5) — for a staff
    // caller this is the validated ?tenant_id, for an agency caller the session claim.
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
    // Rule K.2 — fail loud: the DB is configured but the query threw. Returning an
    // "enabled=false" default here would silently tell the dashboard DEMO MODE is off
    // when we don't actually know the tenant's real state (RETRO-008 class). 500.
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
 * Creates or replaces the DEMO MODE override for the resolved tenant.
 * Agency: `agency:admin`+ on its own tenant (UNCHANGED). Staff: write any tenant via
 * `?tenant_id=<uuid>`, gated on `access.canWrite` (rank ≥ `estalara:ops`), audited.
 *
 * Validation:
 *   - enabled=true requires override_archetype to be set (non-null).
 *   - override_model must be in the curated allow-list.
 *   - override_archetype must be one of the 13 reachable archetypes.
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      // AGENCY WRITE semantics UNCHANGED: admin+ only (viewer may NOT write demo mode).
      minAgencyRole: 'agency:admin',
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
  } catch (err) {
    return accessErrorToResponse(err);
  }

  // Write-rank gate (CEO Q3, ADR-0018 §4): staff below `estalara:ops` (rank < 2) is
  // view-only. Agency writes are gated by `minAgencyRole: 'agency:admin'` above.
  if (access.via === 'staff' && !access.canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Staff write requires estalara:ops or higher' } },
      { status: 403 },
    );
  }

  const tenantId = access.tenantId;

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

  const patch = {
    enabled: body.enabled,
    overrideArchetype: body.override_archetype ?? null,
    overrideModel: body.override_model,
  };

  if (access.via === 'staff') {
    return putStaff(req, access, tenantId, patch);
  }

  // ── Agency self-service write — UNCHANGED and NOT audited (§3 audits STAFF only). ──
  try {
    const row = await upsertDemoOverride(tenantId, patch, access.claims.sub);
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

/**
 * Staff write path (ADR-0018 §3/§3a). The demo-override upsert and its
 * `staff_audit_log` row commit-or-roll-back TOGETHER in one `db.transaction()`.
 *
 * The upsert is INLINED here (not delegated to `upsertDemoOverride`) so the data
 * mutation participates in the passed transaction handle AND stays textually in the
 * route for the FOLLOW-607 atomicity guard — see the module doc-comment.
 *
 * @param req      - The incoming request (for audit IP / user-agent).
 * @param access   - The resolved STAFF access (narrowed; carries `staff.sub`).
 * @param tenantId - The validated tenant fence (invariant 5).
 * @param patch    - The validated override fields to persist.
 */
async function putStaff(
  req: NextRequest,
  access: Extract<TenantAccess, { via: 'staff' }>,
  tenantId: string,
  patch: { enabled: boolean; overrideArchetype: string | null; overrideModel: string },
): Promise<NextResponse> {
  const db = createAdminClient();

  // Read the current state first so the audit row can capture before/after. A failure
  // here fails loud (500) — we never write an override we cannot attribute a delta for.
  let before: DemoOverride;
  try {
    before = await getDemoOverride(tenantId);
  } catch (err: unknown) {
    console.error(
      '[demo/override PUT staff] read-before failed:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to read demo override' } },
      { status: 500 },
    );
  }

  let row: DemoOverrideRow;
  try {
    row = await db.transaction(async (tx) => {
      // Upsert the override, fenced on `demo_overrides.tenant_id` (unique). `.returning()`
      // gives the committed row for the response.
      const rows = await tx
        .insert(demoOverrides)
        .values({
          tenantId,
          enabled: patch.enabled,
          overrideArchetype: patch.overrideArchetype,
          overrideModel: patch.overrideModel,
          updatedBy: access.staff.sub,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: demoOverrides.tenantId,
          set: {
            enabled: patch.enabled,
            overrideArchetype: patch.overrideArchetype,
            overrideModel: patch.overrideModel,
            updatedBy: access.staff.sub,
            updatedAt: new Date(),
          },
        })
        .returning();
      const upserted = rows[0];
      if (!upserted) {
        // Force a rollback — an upsert that returns nothing means neither limb committed.
        throw new Error('[demo/override PUT staff] upsert returned no rows');
      }

      // Staff audit trail (§3) — attributed to the acting staff user. AWAITED inside the
      // tx (never fire-and-forget) so it commits atomically with the upsert.
      await tx.insert(staffAuditLog).values({
        adminUserId: access.staff.sub,
        action: 'demo_override.update',
        targetTenantId: tenantId,
        payload: {
          before,
          after: {
            enabled: patch.enabled,
            overrideArchetype: patch.overrideArchetype,
            overrideModel: patch.overrideModel,
          },
        },
        ipAddress: requestIp(req),
        userAgent: req.headers.get('user-agent'),
      });

      return upserted;
    });
  } catch (err: unknown) {
    // Any failure INSIDE the tx (the upsert OR the audit insert) rolls BOTH back — there
    // is no orphan override mutation left behind. Fail loud: capture to Sentry and return
    // 500, never a silent unattributed 200 (Rule K.2). A retry is safe (idempotent upsert
    // + a fresh audit row in a new tx).
    Sentry.captureException(err, {
      tags: { route: 'demo/override', staff_audit_error: 'true' },
      extra: { tenant_id: tenantId, admin_user_id: access.staff.sub },
    });
    return NextResponse.json(
      {
        error: {
          code: 'audit_write_failed',
          message:
            'The demo override change could not be recorded atomically with its staff ' +
            'audit row; the change was rolled back and NOT applied. Retry the action.',
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    tenant_id: tenantId,
    enabled: row.enabled,
    override_archetype: row.overrideArchetype,
    override_model: row.overrideModel,
    updated_at: row.updatedAt.toISOString(),
  });
}
