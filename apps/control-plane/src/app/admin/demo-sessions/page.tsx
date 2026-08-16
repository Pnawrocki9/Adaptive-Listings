/**
 * /admin/demo-sessions — Demo Sessions monitor (FOLLOW-593, ADR-0018 §Decision 0).
 *
 * Un-hidden per the CEO's 2026-07-20 ruling. React Server Component reading
 * the real `demo_sessions` table (left-joined to `tenants` for the display
 * name) via `getDemoSessionsList()` (`./data`) — already staff-gated by
 * `middleware.ts` (`/admin/*`).
 *
 * Rule K.2: mock renders only when the admin DB is unconfigured; a
 * configured-but-failing query renders a visible error banner instead.
 *
 * "Force Stop" remains disabled (write wiring is a later ticket — this
 * ticket is read-only per its hard limits).
 *
 * @module apps/control-plane/src/app/admin/demo-sessions/page
 */

/**
 * FOLLOW-1001: this page MUST render at request time, never be statically
 * prerendered. Two independent reasons, both observed in production 2026-08-16:
 * (1) the Vercel build runs through `turbo run build` with NO `env` declared in
 *     turbo.json, so Turborepo's strict env mode STRIPS `DATABASE_URL_ADMIN` /
 *     `DATABASE_URL_DIRECT` (and every other non-NEXT_PUBLIC var) from the build
 *     — a build-time prerender therefore always sees "DB unconfigured" and BAKES
 *     the mock/unconfigured state into static HTML that runtime env can never fix
 *     (admin.estalara.com/admin/tenants served `data_source: mock` with three
 *     fictional tenants while DATABASE_URL_ADMIN sat present in Vercel prod env);
 * (2) even with build-time env, a staff fleet page frozen at build time would
 *     show stale data until the next deploy — wrong for an operator surface.
 */
export const dynamic = 'force-dynamic';

import { getDemoSessionsList } from './data';
import type { DemoSessionStatus } from './data';

const STATUS_COLORS: Record<DemoSessionStatus, string> = {
  active: 'bg-green-100 text-green-700',
  revoked: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
};

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

export default async function AdminDemoSessionsPage() {
  const { dataSource, sessions, errorMessage } = await getDemoSessionsList();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Demo Sessions</h2>
          <p className="mt-1 text-sm text-gray-500">
            Monitor all active and recent demo mode sessions across tenants.
          </p>
        </div>
        <DataSourceBadge source={dataSource} />
      </div>

      {dataSource === 'error' && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error loading demo sessions:</strong> {errorMessage ?? 'unknown error'}
        </div>
      )}

      {dataSource !== 'error' &&
        (sessions.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white py-16 text-center text-gray-400">
            No demo sessions yet
          </div>
        ) : (
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
                {sessions.map((session) => (
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
                        title="Write wiring is a later ticket (ADR-0018 §6 Phase 2)"
                        className="cursor-not-allowed rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 opacity-50"
                      >
                        Force Stop
                      </button>
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
