/**
 * Server-side data access for the `/admin/tenants/[id]` tenant hub and the
 * `/admin` landing page (FOLLOW-593, ADR-0018 §Decision 0; moved next to the
 * hub by FOLLOW-1329 / plan R7 so the fleet-list module can be deleted).
 *
 * Rule K.2 (CONVENTIONS_PATCH.md): a configured-but-failing DB is a real
 * production error and must fail loud (`data_source: 'error'` + Sentry
 * capture), never silently fall back to mock. Mock data (`MOCK_TENANTS`) is
 * used ONLY when the admin DB itself is unconfigured (`DATABASE_URL_ADMIN`
 * and `DATABASE_URL_DIRECT` both unset — dev/CI), mirroring the pattern
 * already used by `/api/pilot/cta-lift` (`clickhouseConfigured`).
 *
 * Excludes soft-deleted tenants (`deleted_at IS NULL`), same as the
 * `tenantExists` staff-tenant-validation lookup in
 * `apps/control-plane/src/lib/session-auth.ts` (FOLLOW-592).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/data
 */

import { and, eq, isNull } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';

import { createAdminClient, tenants } from '@estalara/db';

import { MOCK_TENANTS } from '../mock-data';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantsDataSource = 'live' | 'mock' | 'error';

export interface TenantRow {
  id: string;
  name: string;
  /** 'free' | 'observer' | 'augment' | 'native' */
  plan: string;
  /** 'pending' | 'active' | 'suspended' | 'canceled' */
  status: string;
  createdAt: string;
  profileModeEnabled: boolean;
}

export interface TenantLookupResult {
  dataSource: TenantsDataSource;
  /** null when the id is well-formed but no matching (non-deleted) tenant exists. */
  tenant: TenantRow | null;
  errorMessage?: string;
}

/** DB is "configured" when either admin connection string is present. */
export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT);
}

export function mockToRow(m: (typeof MOCK_TENANTS)[number]): TenantRow {
  return {
    id: m.id,
    name: m.name,
    plan: m.plan,
    status: m.status,
    createdAt: m.created_at,
    profileModeEnabled: m.profile_mode,
  };
}

/**
 * Look up a single tenant by id for the `/admin/tenants/[id]` landing page.
 *
 * Validation mirrors `tenantExists()` (`lib/session-auth.ts`, FOLLOW-592): a
 * malformed (non-UUID) id never reaches the DB (the mock path uses non-UUID
 * ids by design — `tenant-001` etc. — so this only applies when the DB is
 * configured). Soft-deleted tenants are treated as not-found.
 */
export async function getTenantById(id: string): Promise<TenantLookupResult> {
  if (!isDbConfigured()) {
    const mock = MOCK_TENANTS.find((m) => m.id === id);
    return { dataSource: 'mock', tenant: mock ? mockToRow(mock) : null };
  }

  if (!UUID_RE.test(id)) {
    return { dataSource: 'live', tenant: null };
  }

  try {
    const db = createAdminClient();
    const rows = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        plan: tenants.plan,
        status: tenants.status,
        createdAt: tenants.createdAt,
        profileModeEnabled: tenants.profileModeEnabled,
      })
      .from(tenants)
      .where(and(eq(tenants.id, id), isNull(tenants.deletedAt)))
      .limit(1);

    const r = rows[0];
    if (!r) return { dataSource: 'live', tenant: null };

    return {
      dataSource: 'live',
      tenant: {
        id: r.id,
        name: r.name,
        plan: r.plan,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        profileModeEnabled: r.profileModeEnabled,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { admin_tenant_lookup_error: 'true' }, extra: { id } });
    return { dataSource: 'error', tenant: null, errorMessage: message };
  }
}
