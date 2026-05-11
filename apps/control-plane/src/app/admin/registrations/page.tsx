// TODO Sprint 5: fetch from tenant_registrations table via createAdminClient()

import { MOCK_REGISTRATIONS } from './mock-data';

export default function AdminRegistrationsPage() {
  const pending = MOCK_REGISTRATIONS.filter((r) => r.status === 'pending');

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Pending Registrations</h2>
        <p className="mt-1 text-sm text-gray-500">
          Review and approve or reject new agency sign-up requests.
        </p>
      </div>

      {pending.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white py-16 text-center text-gray-400">
          No pending registrations
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Agency', 'Website', 'Contact Email', 'Country', 'Volume', 'Date', 'Actions'].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pending.map((reg) => (
                <tr key={reg.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{reg.agency_name}</td>
                  <td className="px-4 py-3 text-sm text-blue-600">
                    <a
                      href={reg.website_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {reg.website_url.replace('https://', '')}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{reg.contact_email}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{reg.country}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{reg.listings_volume}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(reg.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        disabled
                        title="Coming Sprint 5"
                        className="rounded-md bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 opacity-50 cursor-not-allowed"
                      >
                        Approve
                      </button>
                      <button
                        disabled
                        title="Coming Sprint 5"
                        className="rounded-md bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 opacity-50 cursor-not-allowed"
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
