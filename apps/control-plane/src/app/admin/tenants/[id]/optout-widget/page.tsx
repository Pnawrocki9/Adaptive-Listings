/**
 * Estalara staff per-tenant opt-out toggle widget config — /admin/tenants/[id]/optout-widget
 *
 * FOLLOW-641 / ADR-0019 D7: the staff WRITE port of the per-brand appearance/placement/label
 * config for the EXISTING profiling opt-out toggle. A server component that resolves the URL
 * `[id]`, validates it against the `tenants` table via the SAME existence check the
 * staff-override API path uses ({@link tenantExists}), and renders `notFound()` (404) for an
 * unknown/soft-deleted tenant — so the page and the `?tenant_id`-scoped route it drives agree on
 * what "exists" means.
 *
 * On a known tenant it mounts {@link StaffOptOutWidgetEditor} with an explicit `tenantId`, so
 * every GET/PUT carries `?tenant_id=<id>` and the staff route fences its `createAdminClient()`
 * queries to that tenant (ADR-0018 §2 invariant 5). Staff writes below `estalara:ops` rank are
 * rejected server-side (403); successful writes append a `staff_audit_log` row inside the same
 * transaction as the mutation (ADR-0018 §3a) — both enforced in the route, not this page.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/optout-widget/page
 */

import { notFound } from 'next/navigation';

import { tenantExists } from '@/lib/session-auth';
import { StaffOptOutWidgetEditor } from './optout-widget-editor';

interface StaffTenantOptOutWidgetPageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffTenantOptOutWidgetPage({
  params,
}: StaffTenantOptOutWidgetPageProps) {
  const { id } = await params;

  // Validate the URL-supplied tenant id against real tenants (existence + not soft-deleted)
  // before rendering. Unknown/malformed → 404. Fails closed: if validation cannot run,
  // tenantExists throws and the error boundary owns it — never renders as "found".
  const exists = await tenantExists(id);
  if (!exists) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Opt-Out Widget</h1>
        <p className="mt-1 text-sm text-gray-500">
          Staff editor (ADR-0018 / FOLLOW-641). Per-brand placement + labels for the profiling
          opt-out toggle. Tenant: <span className="font-mono text-xs">{id}</span>
        </p>
      </div>

      <StaffOptOutWidgetEditor tenantId={id} />
    </div>
  );
}
