// TODO Sprint 5: fetch from demo_sessions table via createAdminClient()

import type { MockDemoSession } from './mock-data';
import { MOCK_DEMO_SESSIONS } from './mock-data';

const STATUS_COLORS: Record<MockDemoSession['status'], string> = {
  active: 'bg-green-100 text-green-700',
  revoked: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
};

export default function AdminDemoSessionsPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Demo Sessions</h2>
        <p className="mt-1 text-sm text-gray-500">
          Monitor all active and recent demo mode sessions across tenants.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {[
                'Tenant',
                'Scope',
                'Visibility',
                'Duration',
                'Status',
                'Created',
                'Expires',
                'Actions',
              ].map((h) => (
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
            {MOCK_DEMO_SESSIONS.map((session) => (
              <tr key={session.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">
                  {session.tenant_name}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">{session.scope}</td>
                <td className="px-4 py-3 text-sm text-gray-700">{session.visibility}</td>
                <td className="px-4 py-3 text-sm text-gray-700">{session.duration}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[session.status]}`}
                  >
                    {session.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {new Date(session.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {new Date(session.expires_at).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <button
                    disabled
                    title="Coming Sprint 5"
                    className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 opacity-50 cursor-not-allowed"
                  >
                    Force Stop
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
