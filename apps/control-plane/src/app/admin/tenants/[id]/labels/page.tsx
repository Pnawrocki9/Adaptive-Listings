/**
 * Estalara staff per-tenant conversion label management — /admin/tenants/[id]/labels
 *
 * ADR-0018 §6 Phase 2 / FOLLOW-597: the staff WRITE port of the agency conversion-label
 * management page (`dashboard/analytics/labels/page.tsx`, FOLLOW-174). A server
 * component that resolves the URL `[id]`, validates it against the `tenants` table via
 * the SAME existence check the staff-override API path uses ({@link tenantExists}),
 * and renders `notFound()` (404) for an unknown/soft-deleted tenant — so the page and
 * the `?tenant_id`-scoped routes it drives agree on what "exists" means.
 *
 * On a known tenant it mounts {@link StaffLabelsEditor} with an explicit `tenantId`, so
 * every GET carries `?tenant_id=<id>` (`GET /api/admin/labels`, already staff-ported)
 * and every reclassify PATCHes `/api/admin/labels/[id]` (the label's own tenant_id FK
 * fences the write — invariant 5; staff below `estalara:ops` rank are rejected
 * server-side, 403). Successful staff writes append a `staff_audit_log` row
 * (ADR-0018 §3) — both enforced in the routes, not this page.
 *
 * Staff gating: the existing `/admin/*` middleware already requires a valid staff
 * session for this route — no new middleware is added here.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/labels/page
 */

import { notFound } from 'next/navigation';

import { tenantExists } from '@/lib/session-auth';
import { StaffLabelsEditor } from './labels-editor';

interface StaffTenantLabelsPageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffTenantLabelsPage({ params }: StaffTenantLabelsPageProps) {
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
        <h1 className="text-2xl font-bold text-gray-900">Tenant Conversion Labels</h1>
        <p className="mt-1 text-sm text-gray-500">
          Staff editor (ADR-0018). Tenant: <span className="font-mono text-xs">{id}</span>
        </p>
      </div>

      <StaffLabelsEditor tenantId={id} />
    </div>
  );
}
