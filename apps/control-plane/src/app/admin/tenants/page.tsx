// TODO Sprint 5: fetch from tenants table via createAdminClient()

import type { MockTenant } from './mock-data';
import { MOCK_TENANTS } from './mock-data';

const STATS = [
  { label: 'Total Tenants', value: '3' },
  { label: 'Active', value: '2' },
  { label: 'Demo Mode On', value: '2' },
  { label: 'Profile Mode', value: '0' },
];

const PLAN_COLORS: Record<MockTenant['plan'], string> = {
  starter: 'bg-gray-100 text-gray-700',
  growth: 'bg-blue-100 text-blue-700',
  enterprise: 'bg-purple-100 text-purple-700',
};

const STATUS_COLORS: Record<MockTenant['status'], string> = {
  active: 'bg-green-100 text-green-700',
  trial: 'bg-yellow-100 text-yellow-700',
  suspended: 'bg-red-100 text-red-700',
};

export default function AdminTenantsPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Tenant Fleet</h2>
        <p className="mt-1 text-sm text-gray-500">Overview of all active agency tenants.</p>
      </div>

      {/* Stats row */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        {STATS.map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-2xl font-bold text-gray-900">{value}</div>
            <div className="mt-0.5 text-xs text-gray-500">{label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {['Tenant', 'Plan', 'Status', 'SDK', 'Demo', 'Profile Mode', 'Created'].map((h) => (
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
            {MOCK_TENANTS.map((tenant) => (
              <tr key={tenant.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{tenant.name}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PLAN_COLORS[tenant.plan]}`}
                  >
                    {tenant.plan}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[tenant.status]}`}
                  >
                    {tenant.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">{tenant.sdk_status}</td>
                <td className="px-4 py-3 text-sm text-gray-700">{tenant.demo_mode ? '✓' : '—'}</td>
                <td className="px-4 py-3">
                  <button
                    disabled
                    title="Requires Master Admin approval workflow"
                    className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 opacity-50 cursor-not-allowed"
                  >
                    {tenant.profile_mode ? 'On' : 'Off'}
                  </button>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {new Date(tenant.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
