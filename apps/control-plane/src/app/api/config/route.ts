/**
 * GET  /api/config  — return current tenant configuration
 * PATCH /api/config — partial update of tenant configuration
 *
 * MVP stub: deterministic mock config keyed on the VERIFIED tenant id.
 *
 * // TODO Sprint 5 / FOLLOW-600: read/write the `tenants` table via createTenantClient()
 *
 * Auth (ADR-0018 §2, FOLLOW-614 — spoofable-header hole closed):
 *   GET   — `resolveTenantAccess(req, { allowStaffOverride: true, minAgencyRole: 'agency:viewer' })`
 *   PATCH — `resolveTenantAccess(req, { allowStaffOverride: true, minAgencyRole: 'agency:admin' })`
 *
 *   Prior to FOLLOW-614 this route trusted an `x-tenant-id` request header as the SOLE
 *   tenant authority, and PATCH additionally gated on a spoofable `x-agency-role` header.
 *   Both were caller-supplied and unauthenticated — any client could set
 *   `x-tenant-id: <victim>` + `x-agency-role: agency:owner` and read/mutate another
 *   tenant's config. BOTH header reads are REMOVED. The tenant and the caller's role now
 *   come ONLY from the verified session/JWT claims (the agency path sources the tenant
 *   from `claims.tenant_id`; the role floor is enforced by `minAgencyRole`). An Estalara
 *   staff caller may target any tenant via `?tenant_id=<uuid>`, which `resolveTenantAccess`
 *   validates against the `tenants` table (invariant 4). `access.tenantId` is the config key.
 *
 * DB-coupling note (FOLLOW-614): the config store itself is an in-memory stub with NO DB,
 *   but `resolveTenantAccess` on the STAFF override path calls `tenantExists` →
 *   `createAdminClient()`. When the admin DB is unconfigured/unreachable, a STAFF request
 *   with `?tenant_id` fails CLOSED with a 500 (the epic-wide "cannot verify tenant scope"
 *   property, identical to /api/audit and /api/admin/labels). The AGENCY path does NOT
 *   touch the DB (the tenant comes from the verified claim), so an agency caller keeps
 *   working against the pure in-memory stub with no DB infra. This is consistent with the
 *   labels/audit precedent.
 *
 * Staff-write audit — DELIBERATELY OUT OF SCOPE (FOLLOW-614): the `staff_audit_log`
 *   §3/§3a "audit-in-transaction" pattern (see intent-weights / quiz-config / labels[id])
 *   pairs a staff write against REAL data with an audit row that commits atomically.
 *   This PATCH mutates ONLY the in-memory `configStore` Map — there is no DB mutation to
 *   atomically pair an audit row with, so NO `staff_audit_log` insert is added here (and
 *   the staff-write-atomicity guard must NOT see this as a staff write). WHEN FOLLOW-600
 *   wires `/api/config` to the real `tenants` table, a staff PATCH via the override path
 *   MUST then adopt the §3a audit-in-`db.transaction()` pattern. This PR is auth-only.
 *
 * @module apps/control-plane/src/app/api/config/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TenantConfig {
  tenant_id: string;
  plan: string;
  brand: {
    primary_color: string;
    logo_url: string | null;
    white_label: boolean;
  };
  quiz: {
    enabled: boolean;
    // trigger_after_n_listings removed — FOLLOW-264 / Rule L / RETRO-050 HALF_WIRE_P.
    // SDK consumer deleted in FOLLOW-257; dead name cleared here (AC2 LG-2).
    // Re-add under FOLLOW-199 (Quiz v2.0) with a matching SDK consumer.
    language: string;
  };
  sdk: {
    allowed_origins: string[];
    active_domains: string[];
  };
  updated_at: string;
}

export interface ConfigPatch {
  brand?: Partial<TenantConfig['brand']>;
  quiz?: Partial<TenantConfig['quiz']>;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

/** Per-tenant in-memory state for the stub (survives within a single server process). */
const configStore = new Map<string, TenantConfig>();

function defaultConfig(tenantId: string): TenantConfig {
  return {
    tenant_id: tenantId,
    plan: 'observer',
    brand: {
      primary_color: '#1a73e8',
      logo_url: null,
      white_label: false,
    },
    quiz: {
      enabled: false,
      language: 'en',
    },
    sdk: {
      allowed_origins: ['https://listings.example.com'],
      active_domains: ['listings.example.com'],
    },
    updated_at: new Date().toISOString(),
  };
}

function getConfig(tenantId: string): TenantConfig {
  if (!configStore.has(tenantId)) {
    configStore.set(tenantId, defaultConfig(tenantId));
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return configStore.get(tenantId)!;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth + tenant resolution (ADR-0018 §2, FOLLOW-614) ────────────────────
  // Tenant comes ONLY from the verified claim (agency) or the validated ?tenant_id
  // (staff) — never from the removed `x-tenant-id` header.
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

  return NextResponse.json(getConfig(access.tenantId), { status: 200 });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  // ── Auth + tenant resolution (ADR-0018 §2, FOLLOW-614) ────────────────────
  // The role floor (agency:admin) is enforced from the VERIFIED claim by
  // `minAgencyRole` — the old spoofable `x-agency-role` header gate is GONE.
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

  let patch: ConfigPatch;
  try {
    patch = (await req.json()) as ConfigPatch;
  } catch {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  const current = getConfig(access.tenantId);
  const updated: TenantConfig = {
    ...current,
    brand: patch.brand ? { ...current.brand, ...patch.brand } : current.brand,
    quiz: patch.quiz ? { ...current.quiz, ...patch.quiz } : current.quiz,
    updated_at: new Date().toISOString(),
  };
  configStore.set(access.tenantId, updated);

  return NextResponse.json(updated, { status: 200 });
}
