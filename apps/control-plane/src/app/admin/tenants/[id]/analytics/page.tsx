/**
 * Estalara staff per-tenant analytics — /admin/tenants/[id]/analytics
 *
 * ADR-0018 §1 / FOLLOW-594: the read-only staff port of the agency analytics
 * dashboard. A server component that resolves the URL `[id]`, validates it against
 * the `tenants` table via the SAME existence check the staff-override API path uses
 * ({@link tenantExists}), and renders `notFound()` (404) for an unknown/soft-deleted
 * tenant — so the page and the `?tenant_id`-scoped routes it drives agree on what
 * "exists" means.
 *
 * On a known tenant it mounts the shared {@link AnalyticsView} with an explicit
 * `tenantId`, so every panel GET carries `?tenant_id=<id>` and the staff-override
 * routes (summary, lift, ab/weights) fence their queries to that tenant. This is
 * READ-ONLY: `allowResume` is left false — the Panel-5 bandit-weight PATCH stays
 * agency-only (FOLLOW-598).
 *
 * Staff gating: the existing `/admin/*` middleware already requires a valid staff
 * session for this route — no new middleware is added here.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/analytics/page
 */

import { notFound } from 'next/navigation';

import { tenantExists } from '@/lib/session-auth';
import { AnalyticsView } from '@/components/analytics/analytics-view';

interface StaffTenantAnalyticsPageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffTenantAnalyticsPage({ params }: StaffTenantAnalyticsPageProps) {
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
        <h1 className="text-2xl font-bold text-gray-900">Tenant Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          Read-only staff view (ADR-0018). Tenant: <span className="font-mono text-xs">{id}</span>
        </p>
      </div>

      <AnalyticsView tenantId={id} />
    </div>
  );
}
