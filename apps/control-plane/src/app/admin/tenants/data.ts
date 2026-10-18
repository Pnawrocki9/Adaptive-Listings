/**
 * Server-side data access for the `/admin/tenants` hub + `/admin/tenants/[id]`
 * landing page (FOLLOW-593, ADR-0018 §Decision 0).
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
 * @module apps/control-plane/src/app/admin/tenants/data
 */

import { desc, isNull } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';

import { createAdminClient, tenants } from '@estalara/db';

import { MOCK_TENANTS } from './mock-data';
import { isDbConfigured, mockToRow, type TenantRow, type TenantsDataSource } from './[id]/data';

export type { TenantRow, TenantsDataSource };

export interface TenantsListResult {
  dataSource: TenantsDataSource;
  tenants: TenantRow[];
  errorMessage?: string;
}

/**
 * Fetch the full tenant fleet (excluding soft-deleted rows) for the Tenants hub.
 *
 * @returns `dataSource: 'mock'` when the admin DB is unconfigured (dev/CI);
 *   `dataSource: 'live'` with real rows on success; `dataSource: 'error'` when
 *   the DB is configured but the query throws (fail loud, never fabricate).
 */
export async function getTenantsList(): Promise<TenantsListResult> {
  if (!isDbConfigured()) {
    return { dataSource: 'mock', tenants: MOCK_TENANTS.map(mockToRow) };
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
      .where(isNull(tenants.deletedAt))
      .orderBy(desc(tenants.createdAt));

    return {
      dataSource: 'live',
      tenants: rows.map((r) => ({
        id: r.id,
        name: r.name,
        plan: r.plan,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        profileModeEnabled: r.profileModeEnabled,
      })),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { admin_tenants_list_error: 'true' } });
    return { dataSource: 'error', tenants: [], errorMessage: message };
  }
}
