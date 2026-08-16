/**
 * /admin/registrations — Pending Registrations (FOLLOW-593, ADR-0018 §Decision 0).
 *
 * Un-hidden per the CEO's 2026-07-20 ruling. React Server Component reading
 * the real `tenant_registrations` table via `getPendingRegistrations()`
 * (`./data`) — already staff-gated by `middleware.ts` (`/admin/*`).
 *
 * Rule K.2: mock renders only when the admin DB is unconfigured; a
 * configured-but-failing query renders a visible error banner instead.
 *
 * Approve/Reject actions remain disabled (write wiring is a later ticket —
 * this ticket is read-only per its hard limits).
 *
 * @module apps/control-plane/src/app/admin/registrations/page
 */

/**
 * FOLLOW-1001: this page MUST render at request time, never be statically
 * prerendered. Two independent reasons:
 * (1) the Vercel build runs through `turbo run build` with NO `env` declared in
 *     turbo.json, so Turborepo's strict env mode STRIPS `DATABASE_URL_ADMIN` /
 *     `DATABASE_URL_DIRECT` (and every other non-NEXT_PUBLIC var) from the build
 *     — a build-time prerender therefore always sees "DB unconfigured" and BAKES
 *     the mock/unconfigured state into static HTML that runtime env can never
 *     fix. Observed live on the /admin list pages [MP-009].
 * (2) even with build-time env, a staff fleet page frozen at build time would
 *     show stale data until the next deploy — wrong for an operator surface.
 */
export const dynamic = 'force-dynamic';

import { getPendingRegistrations } from './data';

function DataSourceBadge({ source }: { source: 'live' | 'mock' | 'error' }) {
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

export default async function AdminRegistrationsPage() {
  const { dataSource, registrations: pending, errorMessage } = await getPendingRegistrations();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Pending Registrations</h2>
          <p className="mt-1 text-sm text-gray-500">
            Review and approve or reject new agency sign-up requests.
          </p>
        </div>
        <DataSourceBadge source={dataSource} />
      </div>

      {dataSource === 'error' && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error loading registrations:</strong> {errorMessage ?? 'unknown error'}
        </div>
      )}

      {dataSource !== 'error' &&
        (pending.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white py-16 text-center text-gray-400">
            No pending registrations
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {[
                    'Agency',
                    'Website',
                    'Contact Email',
                    'Country',
                    'Volume',
                    'Date',
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
                {pending.map((reg) => (
                  <tr key={reg.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {reg.agency_name}
                    </td>
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
                          title="Write wiring is a later ticket (ADR-0018 §6 Phase 2)"
                          className="cursor-not-allowed rounded-md bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          disabled
                          title="Write wiring is a later ticket (ADR-0018 §6 Phase 2)"
                          className="cursor-not-allowed rounded-md bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 opacity-50"
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
        ))}
    </div>
  );
}
