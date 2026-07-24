/**
 * GET  /api/config  — return current tenant configuration
 * PATCH /api/config — partial update of tenant configuration
 *
 * FOLLOW-600 (ADR-0018 §5/§6): wires this route to the REAL `tenants` table via
 * `createAdminClient()`, replacing the FOLLOW-614-era in-memory `configStore` stub.
 *
 * Auth (ADR-0018 §2, FOLLOW-614 — spoofable-header hole closed; unchanged by this PR):
 *   GET   — `resolveTenantAccess(req, { allowStaffOverride: true, minAgencyRole: 'agency:viewer' })`
 *   PATCH — `resolveTenantAccess(req, { allowStaffOverride: true, minAgencyRole: 'agency:admin' })`
 *
 *   The tenant and the caller's role come ONLY from the verified session/JWT claims
 *   (the agency path sources the tenant from `claims.tenant_id`; the role floor is
 *   enforced by `minAgencyRole`). An Estalara staff caller may target any tenant via
 *   `?tenant_id=<uuid>`, which `resolveTenantAccess` validates against the `tenants`
 *   table (invariant 4).
 *
 *   RLS TRAP (ADR-0018 §2 invariant 5): this route uses `createAdminClient()`
 *   (service-role, RLS BYPASSED) for BOTH the agency and staff paths — same choice
 *   as `quiz/config/route.ts` (the reference implementation this route copies). The
 *   explicit `eq(tenants.id, access.tenantId)` fence bound into every query below is
 *   the ONLY tenant boundary; there is no database-level fence backstopping it.
 *
 * Write-rank gate (ADR-0018 §4, FOLLOW-615): PATCH rejects any staff caller below
 *   `estalara:ops` (rank < 2) with 403, mirroring every sibling staff write
 *   (`quiz/config`, `demo/override`, `admin/intent-weights`). GET is unaffected —
 *   readonly staff keeps read access, matching the `/api/audit` precedent.
 *
 * Staff-write atomicity (ADR-0018 §3a, RETRO-202): the staff PATCH path commits the
 *   `tenants` update and the `staff_audit_log` insert (`action: 'tenant_config.update'`)
 *   TOGETHER in ONE `db.transaction()`, mirroring `quiz/config/route.ts`'s POST staff
 *   branch byte-for-byte in shape. The mutation is kept INLINE in this route file
 *   (not delegated through a `@/lib/*` helper or the `@estalara/db` barrel to a
 *   separate mutation function) so `scripts/check-staff-write-atomicity.cjs` proves
 *   the mutation and the audit insert share the same transaction scope directly —
 *   this was an explicit, deliberate choice (see FOLLOW-613's barrel-re-export-
 *   delegation bypass finding) over the `demo/override/route.ts` delegated-helper
 *   shape, to keep this route's atomicity trivially provable without relying on the
 *   guard's cross-module resolution.
 *
 * Schema mapping (FOLLOW-600 — real `tenants` columns, verified against
 * `packages/db/src/schema/tenants.ts`):
 *   - `plan`               → `tenants.plan` (text). READ-ONLY here — plan changes are
 *     a billing decision, out of this route's scope; PATCH never accepts a `plan` key.
 *   - `brand.*`            → `tenants.brandConfig` (jsonb: `primary_color`, `logo_url`,
 *     `white_label`).
 *   - `sdk.allowed_origins` → `tenants.allowedOrigins` (text array).
 *
 * Two fields from the pre-FOLLOW-600 stub were DELIBERATELY DROPPED, not carried
 * forward (Rule U — delete unwired stub fields rather than invent schema for them,
 * per the FOLLOW-271/274 `tenants.ts` precedent):
 *   - `sdk.active_domains` — grepped repo-wide (control-plane + packages/sdk): ZERO
 *     consumer of this key anywhere, and no `tenants` column backs it. Adding a
 *     migration for a field nothing reads would be exactly the FOLLOW-006/007/008/010
 *     anti-pattern (Rule H). Dropped rather than invented.
 *   - `quiz.{enabled,language}` — `tenants.quizEnabled` and `tenants.quizConfig.language`
 *     DO have real columns, but Investor Quiz config already has its OWN dedicated
 *     staff-ported surface (`/api/quiz/config` + `/admin/tenants/[id]/quiz`, FOLLOW-595,
 *     per ADR-0018 §5's table). Also threading quiz fields through THIS route would
 *     create a second, divergent write path for the same columns — the exact
 *     two-source-of-truth drift this codebase's retros repeatedly flag (e.g. the
 *     `quiz_config` vs snippet-attribute split fixed by ADR-0011). Quiz settings stay
 *     on their existing dedicated surface; this route does not touch them.
 *
 * `generation_model` intentionally never appears here (CEO Q1, ADR-0018 §5 — it is
 * GLOBAL-only, owned by `/admin/settings` + `generation-model/route.ts`).
 *
 * @module apps/control-plane/src/app/api/config/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';

import { createAdminClient, tenants, staffAuditLog } from '@estalara/db';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrandConfig {
  primary_color: string;
  logo_url: string | null;
  white_label: boolean;
}

export interface TenantConfig {
  tenant_id: string;
  /** `tenants.plan` — READ-ONLY here; plan changes are a billing concern. */
  plan: string;
  brand: BrandConfig;
  sdk: {
    allowed_origins: string[];
  };
  updated_at: string;
  /**
   * Provenance (FOLLOW-627, Rule K.2 amendment / RETRO-072): `'stored'` when the
   * body reflects a real `tenants` row; `'default'` when no row exists for this
   * `tenant_id` and every field below is a fabricated default. A caller MUST
   * branch on this — never treat a `'default'` body as real stored config (the
   * FOLLOW-624 client-side clause of the same rule).
   */
  data_source: 'stored' | 'default';
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const ConfigPatchSchema = z.object({
  brand: z
    .object({
      primary_color: z
        .string()
        .regex(HEX_COLOR_RE, 'primary_color must be a 6-digit hex color, e.g. #1a73e8')
        .optional(),
      logo_url: z.string().url().nullable().optional(),
      white_label: z.boolean().optional(),
    })
    .optional(),
  sdk: z
    .object({
      allowed_origins: z.array(z.string().url()).optional(),
    })
    .optional(),
});

export type ConfigPatch = z.infer<typeof ConfigPatchSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_BRAND: BrandConfig = {
  primary_color: '#1a73e8',
  logo_url: null,
  white_label: false,
};

/** Parses the `tenants.brand_config` jsonb blob defensively (untyped column). */
function parseStoredBrandConfig(raw: unknown): BrandConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BRAND };
  const obj = raw as Record<string, unknown>;
  return {
    primary_color:
      typeof obj.primary_color === 'string' ? obj.primary_color : DEFAULT_BRAND.primary_color,
    logo_url: typeof obj.logo_url === 'string' ? obj.logo_url : null,
    white_label: typeof obj.white_label === 'boolean' ? obj.white_label : DEFAULT_BRAND.white_label,
  };
}

/** Best-effort client IP for the staff audit trail (no throw if absent). */
function requestIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

/**
 * Thrown when a PATCH's `.update(tenants)...returning()` affects zero rows
 * (FOLLOW-627): the caller's `tenant_id` has no `tenants` row. Distinguished
 * from a generic tx failure so the staff branch's catch block can return 404
 * instead of the audit-atomicity 500.
 */
class UnknownTenantError extends Error {
  constructor(tenantId: string) {
    super(`No tenants row found for tenant_id: ${tenantId}`);
    this.name = 'UnknownTenantError';
  }
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth + tenant resolution (ADR-0018 §2, FOLLOW-614) ────────────────────
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      minAgencyRole: 'agency:viewer',
      // exactOptionalPropertyTypes (RETRO-189): omit the key when absent so a staff
      // caller without ?tenant_id reaches resolve's 400 rather than passing undefined.
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
  } catch (err) {
    return accessErrorToResponse(err);
  }

  const tenantId = access.tenantId;

  try {
    const db = createAdminClient();
    // Fenced on access.tenantId (invariant 5) — the ONLY tenant boundary on this
    // service-role client.
    const rows = await db
      .select({
        plan: tenants.plan,
        allowedOrigins: tenants.allowedOrigins,
        brandConfig: tenants.brandConfig,
        updatedAt: tenants.updatedAt,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const row = rows[0];
    const body: TenantConfig = {
      tenant_id: tenantId,
      plan: row?.plan ?? 'free',
      brand: parseStoredBrandConfig(row?.brandConfig),
      sdk: { allowed_origins: row?.allowedOrigins ?? [] },
      updated_at: (row?.updatedAt ?? new Date()).toISOString(),
      // FOLLOW-627 (Rule K.2 amendment): 200 + fabricated defaults is only safe
      // to return when the fabrication is OBSERVABLE on the wire. `row` absent
      // means no `tenants` row exists for this tenant_id — every field above is
      // a default, not stored config.
      data_source: row ? 'stored' : 'default',
    };
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    // Rule K.2 — fail loud: the DB is configured but the query threw. Returning
    // fabricated defaults here would silently misrepresent the tenant's real
    // config on a staff/agency-facing settings surface.
    console.error('[config GET] DB error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to load tenant configuration' } },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  // ── Auth + tenant resolution (ADR-0018 §2, FOLLOW-614) ────────────────────
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      minAgencyRole: 'agency:admin',
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
  } catch (err) {
    return accessErrorToResponse(err);
  }

  // Write-rank gate (CEO Q3, ADR-0018 §4; FOLLOW-615): staff below `estalara:ops`
  // (rank < 2) is view-only. `canWrite` is set on the staff branch iff rank ≥ ops.
  if (access.via === 'staff' && !access.canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Staff write requires estalara:ops or higher' } },
      { status: 403 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  const parsed = ConfigPatchSchema.safeParse(rawBody);
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

  const patch = parsed.data;
  const tenantId = access.tenantId;
  const db = createAdminClient();

  // Read current row first (fenced on tenantId — invariant 5) so a partial `brand`
  // patch merges onto the real stored blob and the audit payload can carry a real
  // before/after delta.
  let currentPlan = 'free';
  let currentBrand: BrandConfig = { ...DEFAULT_BRAND };
  let currentOrigins: string[] = [];
  try {
    const rows = await db
      .select({
        plan: tenants.plan,
        allowedOrigins: tenants.allowedOrigins,
        brandConfig: tenants.brandConfig,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const row = rows[0];
    currentPlan = row?.plan ?? 'free';
    currentBrand = parseStoredBrandConfig(row?.brandConfig);
    currentOrigins = row?.allowedOrigins ?? [];
  } catch (err: unknown) {
    console.error(
      '[config PATCH] failed to read current config:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to load tenant configuration' } },
      { status: 500 },
    );
  }

  // Explicit field-by-field merge (not `{ ...a, ...b }`) — with
  // `exactOptionalPropertyTypes`, spreading a `Partial<BrandConfig>` whose keys are
  // `string | undefined` widens the merged type incorrectly. `logo_url` needs an
  // explicit `!== undefined` check (not `??`) because `null` is a legitimate patch
  // value distinct from "field omitted".
  const updatedBrand: BrandConfig = patch.brand
    ? {
        primary_color: patch.brand.primary_color ?? currentBrand.primary_color,
        logo_url: patch.brand.logo_url !== undefined ? patch.brand.logo_url : currentBrand.logo_url,
        white_label: patch.brand.white_label ?? currentBrand.white_label,
      }
    : currentBrand;
  const updatedOrigins: string[] = patch.sdk?.allowed_origins ?? currentOrigins;

  const setValues = {
    brandConfig: updatedBrand,
    allowedOrigins: updatedOrigins,
    updatedAt: new Date(),
  };

  if (access.via === 'staff') {
    // ── Atomic staff write (ADR-0018 §3a) ──────────────────────────────────
    // The tenant config mutation and its staff_audit_log row commit-or-roll-back
    // TOGETHER in ONE transaction (RETRO-190 §4a / RETRO-202), mirroring
    // quiz/config/route.ts's POST staff branch.
    try {
      await db.transaction(async (tx) => {
        // FOLLOW-627: `.returning()` proves the update actually matched a row.
        // A 0-row match (tenant_id has no `tenants` row) must never fall
        // through to a "saved" 200 — throw so the outer catch returns 404
        // instead of committing an audit row for a mutation that never
        // happened.
        const updated = await tx
          .update(tenants)
          .set(setValues)
          .where(eq(tenants.id, tenantId))
          .returning({ id: tenants.id });
        if (updated.length === 0) {
          throw new UnknownTenantError(tenantId);
        }
        // Staff audit trail (§3) — attributed to the acting staff user. AWAITED
        // inside the tx so it commits atomically with the update.
        await tx.insert(staffAuditLog).values({
          adminUserId: access.staff.sub,
          action: 'tenant_config.update',
          targetTenantId: tenantId,
          payload: {
            before: {
              plan: currentPlan,
              brand: currentBrand,
              sdk: { allowed_origins: currentOrigins },
            },
            after: {
              plan: currentPlan,
              brand: updatedBrand,
              sdk: { allowed_origins: updatedOrigins },
            },
          },
          ipAddress: requestIp(req),
          userAgent: req.headers.get('user-agent'),
        });
      });
    } catch (err: unknown) {
      // FOLLOW-627: a 0-row update surfaces as UnknownTenantError, not a
      // generic tx failure — 404, no Sentry capture (expected caller error,
      // not a dependency failure).
      if (err instanceof UnknownTenantError) {
        return NextResponse.json(
          { error: { code: 'unknown_tenant', message: err.message } },
          { status: 404 },
        );
      }
      // Any other failure INSIDE the tx (the update OR the audit insert) rolls
      // BOTH back — there is no orphan config mutation to leave behind. Fail
      // loud: capture to Sentry and return 500, never a silent unattributed 200
      // (Rule K.2). A retry is safe: it re-reads, re-applies the same config
      // (idempotent) and appends a fresh audit row inside a new tx.
      Sentry.captureException(err, {
        tags: { route: 'config', staff_audit_error: 'true' },
        extra: { tenant_id: tenantId, admin_user_id: access.staff.sub },
      });
      return NextResponse.json(
        {
          error: {
            code: 'audit_write_failed',
            message:
              'The tenant config change could not be recorded atomically with its staff ' +
              'audit row; the change was rolled back and NOT applied. Retry the action.',
          },
        },
        { status: 500 },
      );
    }
  } else {
    // Agency self-service write — UNCHANGED and NOT audited (§3 audits STAFF only).
    try {
      // FOLLOW-627: `.returning()` proves the update matched a row — a 0-row
      // match must fail loud (404) rather than fall through to a "saved" 200
      // for a tenant that was never written.
      const updated = await db
        .update(tenants)
        .set(setValues)
        .where(eq(tenants.id, tenantId))
        .returning({ id: tenants.id });
      if (updated.length === 0) {
        return NextResponse.json(
          {
            error: {
              code: 'unknown_tenant',
              message: `No tenants row found for tenant_id: ${tenantId}`,
            },
          },
          { status: 404 },
        );
      }
    } catch (err: unknown) {
      console.error(
        '[config PATCH] failed to update tenant configuration:',
        err instanceof Error ? err.message : err,
      );
      return NextResponse.json(
        { error: { code: 'internal_error', message: 'Failed to update tenant configuration' } },
        { status: 500 },
      );
    }
  }

  const body: TenantConfig = {
    tenant_id: tenantId,
    plan: currentPlan,
    brand: updatedBrand,
    sdk: { allowed_origins: updatedOrigins },
    updated_at: setValues.updatedAt.toISOString(),
    // Reaching here means the update above matched a real row — always 'stored'.
    data_source: 'stored',
  };
  return NextResponse.json(body, { status: 200 });
}
