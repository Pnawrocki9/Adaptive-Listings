/**
 * Estalara staff per-tenant Adaptive Listings ON/OFF — /admin/tenants/[id]/al-state
 * (FOLLOW-633).
 *
 * The staff/superadmin surface for the real per-tenant Adaptive Listings kill
 * switch (`tenants.al_enabled`). A server component that resolves the URL `[id]`,
 * validates it against the `tenants` table via the SAME existence check the staff-
 * override API path uses ({@link tenantExists}), and renders `notFound()` (404) for
 * an unknown/soft-deleted tenant — so the page and the `?tenant_id`-scoped route it
 * drives agree on what "exists" means.
 *
 * On a known tenant it mounts {@link StaffAlStateEditor} with an explicit `tenantId`,
 * so every GET/PUT carries `?tenant_id=<id>` and the staff-only route fences its
 * `createAdminClient()` queries to that tenant (invariant 5). Staff writes below
 * `estalara:ops` rank are rejected server-side (403); successful staff writes append
 * a `staff_audit_log` row (`tenant_al_state.update`, ADR-0018 §3) — enforced in the
 * route, not here.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/al-state/page
 */

import { notFound } from 'next/navigation';

import { tenantExists } from '@/lib/session-auth';
import { StaffAlStateEditor } from './al-state-editor';

interface StaffTenantAlStatePageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffTenantAlStatePage({ params }: StaffTenantAlStatePageProps) {
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
        <h1 className="text-2xl font-bold text-gray-900">Adaptive Listings On/Off</h1>
        <p className="mt-1 text-sm text-gray-500">
          Staff editor (ADR-0018 / FOLLOW-633). Tenant:{' '}
          <span className="font-mono text-xs">{id}</span>
        </p>
      </div>

      <StaffAlStateEditor tenantId={id} />
    </div>
  );
}
