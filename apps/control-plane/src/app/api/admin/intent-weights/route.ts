/**
 * GET/PUT /api/admin/intent-weights — per-tenant intent weight override, staff-ported
 * (ADR-0018 §6 Phase 2, §5 "Intent config", FOLLOW-597).
 *
 * This is a NEW, additive route — it does NOT modify `/api/admin/intent/config`
 * (`[/[id]]`), the existing GLOBAL-only K.3.6 admin surface (ADR-0013 Contract 2,
 * `GET ?tenant_id=` explicitly locked to 400 `unsupported_param` in v1) or its
 * `verifyTracerAdminAuth`-gated write routes consumed by `admin/tracer/weights/page.tsx`
 * and by headless `ADMIN_API_SECRET` automation. Retrofitting THAT route's
 * `is_active:false` plain-update/insert branches with tenant-scoped audit+atomicity
 * would require pre-fetching the target row before knowing whether to open a
 * transaction — which breaks the existing hard-asserted invariant that a plain
 * `is_active:false` write never calls `db.transaction()` (see
 * `[id]/route.test.ts` INV-3, `route.test.ts` INV-6). Rather than risk that
 * exhaustively-tested global surface, this ticket adds a SEPARATE, per-tenant,
 * URL/query-scoped surface that mirrors `api/quiz/config` and `api/demo/override`
 * exactly (ADR-0018 §2's actual designed shape for a staff-override port).
 *
 * Both routes read/write the SAME `intent_weight_configs` table — a tenant's active
 * row written here is picked up by the SDK-facing `GET /api/intent/config` exactly
 * like a row written via the legacy admin route (`is_tenant_specific: true`).
 *
 * Auth (ADR-0018 §2, FOLLOW-597): `resolveTenantAccess` with `allowStaffOverride`.
 *   Agency: `agency:viewer`+ may read; `agency:admin`+ may write their OWN tenant
 *   (mirrors `demo/override`'s write gating — intent weights directly steer the
 *   ML intent engine, a sensitive per-tenant knob). Staff: read/write ANY tenant via
 *   `?tenant_id=<uuid>` (validated against `tenants`, invariant 4); that validated id
 *   is the SINGLE tenant fence bound into every query (invariant 5). This route uses
 *   `createAdminClient()` (service-role, RLS BYPASSED), so the explicit
 *   `eq(intentWeightConfigs.tenantId, access.tenantId)` fence is the ONLY tenant
 *   boundary.
 *
 *   PUT — write. Staff additionally gated on `access.canWrite` (rank ≥
 *   `estalara:ops`, CEO Q3) — below-ops staff is 403. Every successful STAFF write
 *   appends one `staff_audit_log` row (`action: 'intent_weights.update'`); agency
 *   writes are NOT audited (§3 audits STAFF only).
 *   ATOMICITY (ADR-0018 §3a): the one-active-row swap (deactivate the tenant's
 *   current active row, then insert the new one) and the `staff_audit_log` insert
 *   commit-or-roll-back TOGETHER in ONE `db.transaction()` — mirrors `quiz/config`
 *   POST (FOLLOW-605). Any failure inside the tx rolls BOTH back → 500
 *   `audit_write_failed` (no orphan mutation, Rule K.2).
 *
 *   Identity caveat (RETRO-187): `resolveTenantAccess` REJECTS the headless
 *   `ADMIN_API_SECRET` Bearer path for staff (403) — a shared secret is not
 *   attributable to a staff user.
 *
 * Reuses `AdminIntentConfigResponseSchema` (`@estalara/shared`) for the GET response
 * shape — structurally identical (`id`/`tenant_id`/`is_active`/`weights`/`created_at`,
 * all always-present, `id`/`created_at` nullable). Its doc-comment says "Global-only
 * in v1: tenant_id is always null" — that describes ITS ORIGINAL caller
 * (`/api/admin/intent/config`); THIS route's `tenant_id` is always the resolved
 * tenant (non-null), a superset use the schema's types already permit
 * (`z.string().uuid().nullable()`). No type is redeclared (Rule H).
 *
 * Rule K.2 — fail loud: DB unconfigured OR configured-but-throws → 500 (no mock
 * fallback), matching the existing admin intent-config surface's convention (an
 * admin/staff config surface must never silently show fabricated weights).
 *
 * @module apps/control-plane/src/app/api/admin/intent-weights/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';

import { createAdminClient, intentWeightConfigs, staffAuditLog } from '@estalara/db';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';
import {
  IntentWeightsSchema,
  AdminIntentConfigResponseSchema,
  type AdminIntentConfigResponse,
} from '@estalara/shared';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Best-effort client IP for the staff audit trail (no throw if absent). */
function requestIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

/** Resolve tenant access shared by GET + PUT (agency read floor vs write floor differ). */
async function resolveAccess(
  req: NextRequest,
  minAgencyRole: 'agency:viewer' | 'agency:admin',
): Promise<TenantAccess> {
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  return resolveTenantAccess(req, {
    allowStaffOverride: true,
    minAgencyRole,
    // exactOptionalPropertyTypes (RETRO-189): omit the key when absent rather than
    // passing `undefined`, so a staff caller without ?tenant_id reaches resolve's 400.
    ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
  });
}

const PutBodySchema = z.object({
  weights: IntentWeightsSchema,
});

// ─── GET ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/intent-weights?tenant_id=<uuid>
 *
 * Returns the resolved tenant's ACTIVE intent-weight override row, or the
 * "no override" nulled shape when none exists (the tenant then follows the
 * global default served by `GET /api/intent/config`).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  let access: TenantAccess;
  try {
    access = await resolveAccess(req, 'agency:viewer');
  } catch (err) {
    return accessErrorToResponse(err);
  }

  const tenantId = access.tenantId;

  const dbConfigured =
    Boolean(process.env.DATABASE_URL_ADMIN) || Boolean(process.env.DATABASE_URL_DIRECT);
  if (!dbConfigured) {
    return NextResponse.json(
      {
        error: {
          code: 'db_unconfigured',
          message: 'DATABASE_URL_ADMIN or DATABASE_URL_DIRECT must be set to read intent weights',
        },
      },
      { status: 500 },
    );
  }

  try {
    const db = createAdminClient();
    const rows = await db
      .select({
        id: intentWeightConfigs.id,
        weights: intentWeightConfigs.weights,
        createdAt: intentWeightConfigs.createdAt,
      })
      .from(intentWeightConfigs)
      // invariant 5: the ONLY tenant fence — bound into the WHERE clause itself.
      .where(
        and(eq(intentWeightConfigs.tenantId, tenantId), eq(intentWeightConfigs.isActive, true)),
      )
      .orderBy(desc(intentWeightConfigs.createdAt))
      .limit(1);

    const row = rows[0];
    if (!row) {
      const body: AdminIntentConfigResponse = AdminIntentConfigResponseSchema.parse({
        id: null,
        tenant_id: tenantId,
        is_active: false,
        weights: {},
        created_at: null,
      });
      return NextResponse.json(body, { status: 200 });
    }

    const weightsResult = IntentWeightsSchema.safeParse(row.weights);
    const weights = weightsResult.success ? weightsResult.data : {};

    const body: AdminIntentConfigResponse = AdminIntentConfigResponseSchema.parse({
      id: row.id,
      tenant_id: tenantId,
      is_active: true,
      weights,
      created_at: row.createdAt.toISOString(),
    });
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      extra: { route: 'GET /api/admin/intent-weights', tenant_id: tenantId, message },
    });
    return NextResponse.json(
      { error: { code: 'db_error', message: 'Postgres query failed — see Sentry for details' } },
      { status: 500 },
    );
  }
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

/**
 * PUT /api/admin/intent-weights?tenant_id=<uuid>
 *
 * Creates/replaces the resolved tenant's active weight override (atomic swap:
 * deactivate the current active row for this tenant, insert the new one).
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  let access: TenantAccess;
  try {
    access = await resolveAccess(req, 'agency:admin');
  } catch (err) {
    return accessErrorToResponse(err);
  }

  // Write-rank gate (CEO Q3, ADR-0018 §4): staff below `estalara:ops` is view-only.
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
      { error: { code: 'validation_error', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  const parsed = PutBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_error',
          message: 'Invalid request body',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const { weights } = parsed.data;

  const dbConfigured =
    Boolean(process.env.DATABASE_URL_ADMIN) || Boolean(process.env.DATABASE_URL_DIRECT);
  if (!dbConfigured) {
    return NextResponse.json(
      {
        error: {
          code: 'db_unconfigured',
          message: 'DATABASE_URL_ADMIN or DATABASE_URL_DIRECT must be set to write intent weights',
        },
      },
      { status: 500 },
    );
  }

  const createdBy = access.via === 'staff' ? access.staff.sub : access.claims.sub;

  try {
    const db = createAdminClient();

    const row = await db.transaction(async (tx) => {
      // Atomic swap (correctness for the one-active-row-per-tenant invariant,
      // independent of audit logging — mirrors admin/intent/config's POST swap).
      // invariant 5: the ONLY tenant fence — bound into the WHERE clause itself.
      await tx
        .update(intentWeightConfigs)
        .set({ isActive: false })
        .where(
          and(eq(intentWeightConfigs.tenantId, tenantId), eq(intentWeightConfigs.isActive, true)),
        );

      const inserted = await tx
        .insert(intentWeightConfigs)
        .values({ tenantId, weights, isActive: true, createdBy })
        .returning({
          id: intentWeightConfigs.id,
          weights: intentWeightConfigs.weights,
          createdAt: intentWeightConfigs.createdAt,
        });

      if (access.via === 'staff') {
        // Staff audit trail (§3) — attributed to the acting staff user. AWAITED
        // inside the tx (never fire-and-forget) so it commits atomically with the
        // swap (ADR-0018 §3a).
        await tx.insert(staffAuditLog).values({
          adminUserId: access.staff.sub,
          action: 'intent_weights.update',
          targetTenantId: tenantId,
          payload: { weights },
          ipAddress: requestIp(req),
          userAgent: req.headers.get('user-agent'),
        });
      }

      return inserted[0];
    });

    if (!row) {
      throw new Error('[intent-weights PUT] insert returned no rows');
    }

    const body: AdminIntentConfigResponse = AdminIntentConfigResponseSchema.parse({
      id: row.id,
      tenant_id: tenantId,
      is_active: true,
      weights: row.weights,
      created_at: row.createdAt.toISOString(),
    });
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    // Any failure INSIDE the tx (the swap OR, for staff, the audit insert) rolls
    // BOTH back — there is no orphan weight mutation to leave behind. Fail loud:
    // capture to Sentry and return 500, never a silent unattributed 200 (Rule K.2).
    const isStaffWrite = access.via === 'staff';
    Sentry.captureException(err, {
      tags: { route: 'admin/intent-weights', staff_audit_error: String(isStaffWrite) },
      extra: { tenant_id: tenantId },
    });
    return NextResponse.json(
      {
        error: {
          code: isStaffWrite ? 'audit_write_failed' : 'db_write_failed',
          message: isStaffWrite
            ? 'The intent weight change could not be recorded atomically with its staff ' +
              'audit row; the change was rolled back and NOT applied. Retry the action.'
            : 'The intent weight change could not be saved. Retry the action.',
        },
      },
      { status: 500 },
    );
  }
}
