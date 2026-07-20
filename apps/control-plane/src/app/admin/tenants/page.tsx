/**
 * /admin/tenants — Tenant Fleet hub (FOLLOW-593, ADR-0018 §Decision 0).
 *
 * Un-hidden per the CEO's 2026-07-20 ruling, reversing the 2026-06-15
 * "single-tenant v1" hide. This is a React Server Component: it reads the
 * real `tenants` table via `getTenantsList()` (server-side, `createAdminClient`)
 * at render time — the page is already staff-gated by `middleware.ts`
 * (`/admin/*`), so no additional client-side fetch/auth wiring is needed.
 *
 * Rule K.2: mock data (`data_source: 'mock'`) renders ONLY when the admin DB
 * is unconfigured (dev/CI). A configured-but-failing DB renders a visible
 * error banner instead — it never silently substitutes mock numbers.
 *
 * Per-tenant K.3.6 Tracer links (FOLLOW-311) are preserved, now built from
 * real tenant ids.
 *
 * @module apps/control-plane/src/app/admin/tenants/page
 */

import Link from 'next/link';

import { getTenantsList } from './data';
import type { TenantRow, TenantsDataSource } from './data';

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-100 text-gray-700',
  observer: 'bg-gray-100 text-gray-700',
  starter: 'bg-gray-100 text-gray-700',
  growth: 'bg-blue-100 text-blue-700',
  augment: 'bg-blue-100 text-blue-700',
  enterprise: 'bg-purple-100 text-purple-700',
  native: 'bg-purple-100 text-purple-700',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  trial: 'bg-yellow-100 text-yellow-700',
  suspended: 'bg-red-100 text-red-700',
  canceled: 'bg-red-100 text-red-700',
};

/** Provenance badge — mirrors the DataSourceBadge used by the Tracer pages. */
function DataSourceBadge({ source }: { source: TenantsDataSource }) {
  const color =
    source === 'live'
      ? 'bg-green-100 text-green-800'
      : source === 'mock'
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-red-100 text-red-800';
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>
      data_source: {source}
    </span>
  );
}

function TenantRowActions({ tenant }: { tenant: TenantRow }) {
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <Link
        href={`/admin/tenants/${tenant.id}`}
        className="text-gray-600 underline hover:text-gray-900"
      >
        Overview
      </Link>
      <Link
        href={`/admin/tenants/${tenant.id}/tracer`}
        className="text-purple-600 underline hover:text-purple-800"
      >
        Live Monitor
      </Link>
      <Link
        href={`/admin/tenants/${tenant.id}/tracer/history`}
        className="text-purple-600 underline hover:text-purple-800"
      >
        History
      </Link>
      <Link
        href={`/admin/tenants/${tenant.id}/tracer/export`}
        className="text-purple-600 underline hover:text-purple-800"
      >
        Export
      </Link>
    </div>
  );
}

export default async function AdminTenantsPage() {
  const { dataSource, tenants, errorMessage } = await getTenantsList();

  const totalTenants = tenants.length;
  const activeTenants = tenants.filter((t) => t.status === 'active').length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Tenant Fleet</h2>
          <p className="mt-1 text-sm text-gray-500">Overview of all active agency tenants.</p>
        </div>
        <DataSourceBadge source={dataSource} />
      </div>

      {/* Error banner — Rule K.2: a configured-but-failing DB never renders fabricated rows. */}
      {dataSource === 'error' && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error loading tenants:</strong> {errorMessage ?? 'unknown error'}
        </div>
      )}

      {dataSource !== 'error' && (
        <>
          {/* Stats row — computed from the same rows rendered below, never fabricated. */}
          <div className="mb-6 grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-2xl font-bold text-gray-900">{totalTenants}</div>
              <div className="mt-0.5 text-xs text-gray-500">Total Tenants</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-2xl font-bold text-gray-900">{activeTenants}</div>
              <div className="mt-0.5 text-xs text-gray-500">Active</div>
            </div>
          </div>

          {tenants.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white py-16 text-center text-gray-400">
              No tenants yet
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {['Tenant', 'Plan', 'Status', 'Profile Mode', 'Created', 'Tracer'].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tenants.map((tenant) => (
                    <tr key={tenant.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{tenant.name}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            PLAN_COLORS[tenant.plan] ?? 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {tenant.plan}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            STATUS_COLORS[tenant.status] ?? 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {tenant.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {tenant.profileModeEnabled ? '✓' : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {new Date(tenant.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <TenantRowActions tenant={tenant} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
