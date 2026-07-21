'use client';

/**
 * StaffAuditView — read-only Estalara-staff view of a tenant's `staff_audit_log`
 * trail (ADR-0018 §3 / FOLLOW-599).
 *
 * Mirrors {@link StaffLabelsEditor}'s fetch/badge shape, but READ-ONLY: staff can
 * only SEE the write trail they generate — there is no mutation here, and reads are
 * NOT audited (CEO Q4). Every GET carries `?tenant_id=<tenantId>` so the staff-only
 * API path (`GET /api/audit`) fences its `createAdminClient()` query to that tenant
 * (ADR-0018 §2 invariant 5 — the `WHERE target_tenant_id` predicate is the only
 * fence, since `staff_audit_log` has no RLS).
 *
 * Canonical `AuditEntry`/`AuditResponse` types imported from the route — never
 * redeclared inline (Rule H / RETRO-005/008/013/015).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/audit/audit-view
 */

import { useEffect, useState } from 'react';

import type { AuditEntry, AuditResponse } from '../../../../api/audit/route';

function MockDataBadge() {
  return (
    <span
      aria-label="MOCK DATA"
      className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-800"
    >
      MOCK DATA
    </span>
  );
}

export function StaffAuditView({ tenantId }: { tenantId: string }): React.JSX.Element {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Every call is fenced to this tenant via ?tenant_id — the staff-only API path.
  const listUrl = `/api/audit?tenant_id=${encodeURIComponent(tenantId)}&page=1&limit=25`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetch(listUrl)
      .then(async (r) => {
        const json = (await r.json()) as AuditResponse & { error?: { message?: string } };
        if (!r.ok) throw new Error(json.error?.message ?? `HTTP ${String(r.status)}`);
        if (cancelled) return;
        setData(json);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load audit log.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listUrl]);

  const entries: AuditEntry[] = data?.entries ?? [];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Staff Audit Trail</h2>
        {!loading && data?.data_source !== 'real' && <MockDataBadge />}
      </div>

      {loadError && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {loading && <p className="text-sm text-gray-400">Loading audit log…</p>}

      {!loading && !loadError && entries.length === 0 && (
        <p className="text-sm text-gray-400">No staff actions recorded for this tenant.</p>
      )}

      {!loading && !loadError && entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="pb-2 font-medium">When</th>
                <th className="pb-2 font-medium">Action</th>
                <th className="pb-2 font-medium">Staff User</th>
                <th className="pb-2 font-medium">IP</th>
                <th className="pb-2 font-medium">Payload</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="py-2 text-xs text-gray-500">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 font-mono text-xs text-gray-700">{e.action}</td>
                  <td className="py-2 font-mono text-xs text-gray-500">{e.admin_user_id}</td>
                  <td className="py-2 text-xs text-gray-500">{e.ip_address ?? '—'}</td>
                  <td className="py-2 text-xs text-gray-500">
                    {e.payload ? (
                      <code className="whitespace-pre-wrap break-all">
                        {JSON.stringify(e.payload)}
                      </code>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
