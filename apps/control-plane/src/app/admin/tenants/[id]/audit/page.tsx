/**
 * Estalara staff per-tenant audit log — /admin/tenants/[id]/audit
 *
 * ADR-0018 §3 / FOLLOW-599: the read-only staff view of a tenant's `staff_audit_log`
 * trail. A server component that resolves the URL `[id]`, validates it against the
 * `tenants` table via the SAME existence check the staff-override API path uses
 * ({@link tenantExists}), and renders `notFound()` (404) for an unknown/soft-deleted
 * tenant — so the page and the `?tenant_id`-scoped route it drives agree on what
 * "exists" means.
 *
 * On a known tenant it mounts {@link StaffAuditView} with an explicit `tenantId`, so
 * every GET carries `?tenant_id=<id>` (`GET /api/audit`, staff-only). Reads are NOT
 * audited (CEO Q4) — this surface never mutates `staff_audit_log`.
 *
 * Staff gating: the existing `/admin/*` middleware already requires a valid staff
 * session for this route — no new middleware is added here. Agency audit read is a
 * deferred Phase-2 item (rejected 403 in the route, ADR-0018 §3).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/audit/page
 */

import { notFound } from 'next/navigation';

import { tenantExists } from '@/lib/session-auth';
import { StaffAuditView } from './audit-view';

interface StaffTenantAuditPageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffTenantAuditPage({ params }: StaffTenantAuditPageProps) {
  const { id } = await params;

  // Validate the URL-supplied tenant id against real tenants (existence + not
  // soft-deleted) before rendering. Unknown/malformed → 404 (same fence the API
  // staff-override path applies). Fails closed: if validation cannot run,
  // tenantExists throws and the error boundary owns it — never renders as "found".
  const exists = await tenantExists(id);
  if (!exists) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tenant Audit Log</h1>
        <p className="mt-1 text-sm text-gray-500">
          Read-only staff view (ADR-0018 §3). Tenant:{' '}
          <span className="font-mono text-xs">{id}</span>
        </p>
      </div>

      <StaffAuditView tenantId={id} />
    </div>
  );
}
