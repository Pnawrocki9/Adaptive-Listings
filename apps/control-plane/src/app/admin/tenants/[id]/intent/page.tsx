/**
 * Estalara staff per-tenant intent weight override — /admin/tenants/[id]/intent
 *
 * ADR-0018 §6 Phase 2 / FOLLOW-597: the staff WRITE port for a per-tenant intent
 * weight override, backed by the NEW `GET/PUT /api/admin/intent-weights` route (a
 * separate, additive surface from the legacy global-only `/api/admin/intent/config` —
 * see that route's doc-comment for why).
 *
 * A server component that resolves the URL `[id]`, validates it against the
 * `tenants` table via the SAME existence check the staff-override API path uses
 * ({@link tenantExists}), and renders `notFound()` (404) for an unknown/soft-deleted
 * tenant — so the page and the `?tenant_id`-scoped route it drives agree on what
 * "exists" means.
 *
 * Staff gating: the existing `/admin/*` middleware already requires a valid staff
 * session for this route — no new middleware is added here.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/intent/page
 */

import { notFound } from 'next/navigation';

import { tenantExists } from '@/lib/session-auth';
import { StaffIntentWeightsEditor } from './intent-weights-editor';

interface StaffTenantIntentPageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffTenantIntentPage({ params }: StaffTenantIntentPageProps) {
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
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tenant Intent Weight Override</h1>
        <p className="mt-1 text-sm text-gray-500">
          Staff editor (ADR-0018). Tenant: <span className="font-mono text-xs">{id}</span>
        </p>
      </div>

      <StaffIntentWeightsEditor tenantId={id} />
    </div>
  );
}
