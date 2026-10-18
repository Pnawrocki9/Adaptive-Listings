import { redirect } from 'next/navigation';

import { ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';
import { getTenantById } from './tenants/[id]/data';

/**
 * /admin landing — resolves the Estalara tenant and redirects to its Tracer live monitor.
 *
 * Single tenant (ESC-085). 307 (not 308): the target depends on per-environment config,
 * and browsers cache a permanent redirect. If the configured tenant is missing or
 * soft-deleted, render an explicit error instead of redirecting to an empty monitor.
 */
export default async function AdminIndexPage() {
  const { tenant, dataSource, errorMessage } = await getTenantById(ESTALARA_TENANT_ID);

  if (dataSource === 'error') {
    return (
      <div role="alert" className="max-w-xl">
        <h2 className="text-lg font-semibold text-red-700">Tenant lookup failed</h2>
        <p className="mt-2 text-sm text-gray-700">
          Could not verify the Estalara tenant (data_source: error
          {errorMessage ? `, ${errorMessage}` : ''}).
        </p>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div role="alert" className="max-w-xl">
        <h2 className="text-lg font-semibold text-red-700">Estalara tenant not configured</h2>
        <p className="mt-2 text-sm text-gray-700">
          No active tenant with id <code>{ESTALARA_TENANT_ID}</code> exists in this database. Set{' '}
          <code>NEXT_PUBLIC_ESTALARA_TENANT_ID</code> to an existing tenant id.
        </p>
      </div>
    );
  }

  redirect(`/admin/tenants/${tenant.id}/tracer`);
}
