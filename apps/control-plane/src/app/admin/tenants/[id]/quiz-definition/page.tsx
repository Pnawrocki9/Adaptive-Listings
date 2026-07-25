/**
 * Estalara staff per-tenant editable quiz DEFINITION — /admin/tenants/[id]/quiz-definition
 *
 * FOLLOW-639 / ADR-0019 D7: the staff WRITE port of the fully editable per-brand quiz tree
 * (questions, answers, branching, answer→archetype weight mappings, i18n). A server component
 * that resolves the URL `[id]`, validates it against the `tenants` table via the SAME existence
 * check the staff-override API path uses ({@link tenantExists}), and renders `notFound()` (404)
 * for an unknown/soft-deleted tenant — so the page and the `?tenant_id`-scoped route it drives
 * agree on what "exists" means.
 *
 * On a known tenant it mounts {@link StaffQuizDefinitionEditor} with an explicit `tenantId`, so
 * every GET/PUT carries `?tenant_id=<id>` and the staff route fences its `createAdminClient()`
 * queries to that tenant (ADR-0018 §2 invariant 5). Staff writes below `estalara:ops` rank are
 * rejected server-side (403); successful writes append a `staff_audit_log` row inside the same
 * transaction as the mutation (ADR-0018 §3a) — both enforced in the route, not this page.
 *
 * Staff gating: the existing `/admin/*` middleware already requires a valid staff session for
 * this route — no new middleware is added here.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/page
 */

import { notFound } from 'next/navigation';

import { tenantExists } from '@/lib/session-auth';
import { StaffQuizDefinitionEditor } from './quiz-definition-editor';

interface StaffTenantQuizDefinitionPageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffTenantQuizDefinitionPage({
  params,
}: StaffTenantQuizDefinitionPageProps) {
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
        <h1 className="text-2xl font-bold text-gray-900">Tenant Quiz Definition</h1>
        <p className="mt-1 text-sm text-gray-500">
          Staff editor (ADR-0018 / FOLLOW-639). Fully editable per-brand quiz tree. Tenant:{' '}
          <span className="font-mono text-xs">{id}</span>
        </p>
      </div>

      <StaffQuizDefinitionEditor tenantId={id} />
    </div>
  );
}
