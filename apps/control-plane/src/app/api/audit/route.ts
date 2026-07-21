/**
 * GET /api/audit
 *
 * Returns paginated `staff_audit_log` rows for one tenant — the immutable record
 * of Estalara staff actions against that tenant (ADR-0018 §3).
 *
 * Authorization — STAFF-ONLY (ADR-0018 §3, FOLLOW-599):
 *   Uses `resolveTenantAccess(req, { allowStaffOverride: true, tenantId: <?tenant_id> })`.
 *   An AGENCY caller is rejected with 403 — agency audit read is an explicitly
 *   deferred Phase-2 item (ADR-0018 §3), OUT OF SCOPE here. A staff caller MUST
 *   supply `?tenant_id=<uuid>`, which the helper validates against the `tenants`
 *   table (invariant 4); that validated id becomes the SINGLE tenant fence.
 *
 *   The prior `x-tenant-id` header path is REMOVED — it trusted an unauthenticated
 *   header (an auth hole). There is no rank floor beyond "authenticated staff": a
 *   READ is not a write, so `canWrite`/superadmin is NOT required (ADR-0018 §3
 *   does not require it).
 *
 * Tenant fence (ADR-0018 §2 invariant 5): `staff_audit_log` has NO RLS and is read
 *   via `createAdminClient()` (service role), so the explicit
 *   `eq(staffAuditLog.targetTenantId, access.tenantId)` predicate in
 *   `fetchAuditEntries` is the ONLY tenant boundary. It is bound into every query;
 *   never omit it.
 *
 * Reads are NOT logged (CEO Q4, ADR-0018 §3): audit scope is writes only. This GET
 *   inserts NO `staff_audit_log` row.
 *
 * Rule K.2 — fail loud / provenance:
 *   When the admin DB is unconfigured (dev/CI) → 200 with deterministic mock entries
 *   marked `data_source: 'mock'` (the documented DB-unconfigured fallback, never a
 *   silent prod path). When the DB is configured but the query throws → HTTP 500 +
 *   Sentry capture (no fabricated rows). The real path returns `data_source: 'real'`.
 *
 * Query params:
 *   tenant_id: uuid (required for staff; the single fence)
 *   page:      number (default: 1)
 *   limit:     number (default: 20, max: 100)
 *   action:    string (optional filter by action type)
 *
 * @module apps/control-plane/src/app/api/audit/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';

import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';
import { createAdminClient, staffAuditLog } from '@estalara/db';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * One `staff_audit_log` row, mapped to the API shape. Columns map 1:1 to the real
 * table (`packages/db/src/schema/staff_audit_log.ts`). NOTE: there is no
 * `user_email` column — the old mock's `user_email` was fabricated; callers get
 * `admin_user_id` (the staff actor's user id) instead.
 */
export interface AuditEntry {
  id: string;
  admin_user_id: string;
  action: string;
  target_tenant_id: string | null;
  payload: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditResponse {
  tenant_id: string;
  page: number;
  limit: number;
  total: number;
  entries: AuditEntry[];
  /** Provenance flag (Rule K.2): 'real' = live `staff_audit_log`, 'mock' = DB-unconfigured fallback. */
  data_source: 'real' | 'mock';
}

// ─── Query param schema ───────────────────────────────────────────────────────

const QuerySchema = z.object({
  tenant_id: z.string().uuid().optional(),
  action: z.string().min(1).max(128).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

type Query = z.infer<typeof QuerySchema>;

// ─── Mock data (Rule K.2 DB-unconfigured fallback — NEW shape) ─────────────────

/**
 * Deterministic staff-action entries in the real `staff_audit_log` shape. Served
 * ONLY when the admin DB is unconfigured (dev/CI), always with
 * `data_source: 'mock'`. `target_tenant_id` is overwritten with the requested
 * tenant so the fenced shape is preserved even in the mock path.
 */
const MOCK_ENTRIES: readonly Omit<AuditEntry, 'target_tenant_id'>[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    admin_user_id: '11111111-1111-4111-8111-111111111111',
    action: 'tenant.approved',
    payload: { plan: 'growth', region: 'EU' },
    ip_address: '203.0.113.7',
    user_agent: 'Mozilla/5.0 (staff-console)',
    created_at: '2026-05-01T10:00:00.000Z',
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    admin_user_id: '11111111-1111-4111-8111-111111111111',
    action: 'conversion_label.reclassify',
    payload: { label_id: 'aabbccdd-0001', outcome_class: 'contract_signed' },
    ip_address: '203.0.113.7',
    user_agent: 'Mozilla/5.0 (staff-console)',
    created_at: '2026-05-03T14:30:00.000Z',
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    admin_user_id: '22222222-2222-4222-8222-222222222222',
    action: 'profile_mode.enabled',
    payload: { reason: 'pilot go-live' },
    ip_address: '203.0.113.42',
    user_agent: 'Mozilla/5.0 (staff-console)',
    created_at: '2026-05-05T09:15:00.000Z',
  },
];

function buildMockAuditResponse(tenantId: string, query: Query): AuditResponse {
  const all: AuditEntry[] = MOCK_ENTRIES.map((e) => ({ ...e, target_tenant_id: tenantId }));
  const filtered = query.action ? all.filter((e) => e.action === query.action) : all;
  const total = filtered.length;
  const start = (query.page - 1) * query.limit;
  const entries = filtered.slice(start, start + query.limit);
  return {
    tenant_id: tenantId,
    page: query.page,
    limit: query.limit,
    total,
    entries,
    data_source: 'mock',
  };
}

// ─── Postgres read ─────────────────────────────────────────────────────────────

/**
 * Fetch paginated `staff_audit_log` rows for one tenant, applying the optional
 * `action` filter, newest first. Uses Drizzle parameterised ORM (no raw SQL
 * concatenation). The `eq(staffAuditLog.targetTenantId, tenantId)` predicate is
 * the ONLY tenant fence (service-role client, RLS off — invariant 5).
 *
 * Throws on DB failure (Rule K.2 — fail loud when the DB is configured).
 */
async function fetchAuditEntries(
  tenantId: string,
  query: Query,
): Promise<{ entries: AuditEntry[]; total: number }> {
  const db = createAdminClient();

  const conditions = [eq(staffAuditLog.targetTenantId, tenantId)];
  if (query.action) {
    conditions.push(eq(staffAuditLog.action, query.action));
  }
  const whereClause = and(...conditions);

  const allRows = await db
    .select({
      id: staffAuditLog.id,
      admin_user_id: staffAuditLog.adminUserId,
      action: staffAuditLog.action,
      target_tenant_id: staffAuditLog.targetTenantId,
      payload: staffAuditLog.payload,
      ip_address: staffAuditLog.ipAddress,
      user_agent: staffAuditLog.userAgent,
      created_at: staffAuditLog.createdAt,
    })
    .from(staffAuditLog)
    .where(whereClause)
    .orderBy(desc(staffAuditLog.createdAt));

  const total = allRows.length;
  const start = (query.page - 1) * query.limit;
  const pageRows = allRows.slice(start, start + query.limit);

  const entries: AuditEntry[] = pageRows.map((r) => ({
    id: r.id,
    admin_user_id: r.admin_user_id,
    action: r.action,
    target_tenant_id: r.target_tenant_id ?? null,
    payload: (r.payload as Record<string, unknown> | null) ?? null,
    ip_address: r.ip_address ?? null,
    user_agent: r.user_agent ?? null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));

  return { entries, total };
}

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/audit — staff-only, tenant-fenced read of `staff_audit_log`.
 *
 * @returns 200 AuditResponse on success (`data_source: 'real' | 'mock'`).
 * @returns 400 when staff supplies no `tenant_id`, or query params fail Zod.
 * @returns 401 when unauthenticated; 403 for an agency caller (deferred Phase-2).
 * @returns 404 when the staff-supplied `tenant_id` is unknown/soft-deleted.
 * @returns 500 when the DB is configured but the query throws (Rule K.2).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth + tenant resolution (ADR-0018 §2/§3, FOLLOW-599) ─────────────────
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      // exactOptionalPropertyTypes (RETRO-189): omit the key when absent so a staff
      // caller without ?tenant_id reaches resolve's 400 rather than passing undefined.
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
  } catch (err) {
    return accessErrorToResponse(err);
  }

  // STAFF-ONLY: agency audit read is a deferred Phase-2 item (ADR-0018 §3).
  if (access.via === 'agency') {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message:
            'Audit log read is Estalara-staff-only (ADR-0018 §3); agency audit access is a deferred Phase-2 item.',
        },
      },
      { status: 403 },
    );
  }

  const tenantId = access.tenantId;

  // ── Parse + validate query params ─────────────────────────────────────────
  const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_error',
          message: 'Invalid query parameters',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }
  const query = parsed.data;

  // ── Dev / CI mock path (Rule K.2 — observable data_source) ────────────────
  const dbConfigured = Boolean(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT);
  if (!dbConfigured) {
    return NextResponse.json(buildMockAuditResponse(tenantId, query), { status: 200 });
  }

  // ── Real read from staff_audit_log (fenced to tenantId) ───────────────────
  let result: { entries: AuditEntry[]; total: number };
  try {
    result = await fetchAuditEntries(tenantId, query);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      tags: { audit_read_postgres_error: 'true' },
      extra: { tenant_id: tenantId },
    });
    return NextResponse.json(
      {
        error: {
          code: 'audit_query_failed',
          message: `staff_audit_log query failed: ${message}`,
        },
      },
      { status: 500 },
    );
  }

  const body: AuditResponse = {
    tenant_id: tenantId,
    page: query.page,
    limit: query.limit,
    total: result.total,
    entries: result.entries,
    data_source: 'real',
  };

  return NextResponse.json(body, { status: 200 });
}
