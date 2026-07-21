/**
 * Estalara staff per-tenant DEMO MODE / Archetype Simulator — /admin/tenants/[id]/demo
 *
 * ADR-0018 §6 Phase 2 / FOLLOW-596: the staff WRITE port of the agency Archetype
 * Simulator (`/dashboard/demo/override`). A server component that resolves the URL
 * `[id]`, validates it against the `tenants` table via the SAME existence check the
 * staff-override API path uses ({@link tenantExists}), and renders `notFound()` (404)
 * for an unknown/soft-deleted tenant — so the page and the `?tenant_id`-scoped route it
 * drives agree on what "exists" means.
 *
 * On a known tenant it mounts {@link StaffDemoOverrideEditor} with an explicit
 * `tenantId`, so every GET/PUT carries `?tenant_id=<id>` and the staff-override route
 * fences its `createAdminClient()` queries to that tenant (invariant 5). Staff writes
 * below `estalara:ops` rank are rejected server-side (403); successful staff writes
 * append a `staff_audit_log` row (ADR-0018 §3) — both enforced in the route, not here.
 *
 * Staff gating: the existing `/admin/*` middleware already requires a valid staff
 * session for this route — no new middleware is added here.
 *
 * NOT wired into the `/admin/tenants/[id]` hub landing links in this ticket — that
 * cross-surface wiring is FOLLOW-606's job.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/demo/page
 */

import { notFound } from 'next/navigation';

import { tenantExists } from '@/lib/session-auth';
import { StaffDemoOverrideEditor } from './demo-override-editor';

interface StaffTenantDemoPageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffTenantDemoPage({ params }: StaffTenantDemoPageProps) {
  const { id } = await params;

  // Validate the URL-supplied tenant id against real tenants (existence + not
  // soft-deleted) before rendering. Unknown/malformed → 404 (same fence the API
  // staff-override path applies). Fails closed: if validation cannot run, tenantExists
  // throws and the error boundary owns it — never renders as "found".
  const exists = await tenantExists(id);
  if (!exists) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tenant Archetype Simulator</h1>
        <p className="mt-1 text-sm text-gray-500">
          Staff editor (ADR-0018). Tenant: <span className="font-mono text-xs">{id}</span>
        </p>
      </div>

      <StaffDemoOverrideEditor tenantId={id} />
    </div>
  );
}
