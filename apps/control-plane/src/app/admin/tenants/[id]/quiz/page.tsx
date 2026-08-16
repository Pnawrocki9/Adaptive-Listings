/**
 * Estalara staff per-tenant quiz config — /admin/tenants/[id]/quiz
 *
 * ADR-0018 §6 Phase 2 / FOLLOW-595: the staff WRITE port of the agency quiz-config
 * editor. A server component that resolves the URL `[id]`, validates it against the
 * `tenants` table via the SAME existence check the staff-override API path uses
 * ({@link tenantExists}), and renders `notFound()` (404) for an unknown/soft-deleted
 * tenant — so the page and the `?tenant_id`-scoped route it drives agree on what
 * "exists" means.
 *
 * On a known tenant it mounts {@link StaffQuizConfigEditor} with an explicit
 * `tenantId`, so every GET/POST carries `?tenant_id=<id>` and the staff-override
 * route fences its `createAdminClient()` queries to that tenant (invariant 5). Staff
 * writes below `estalara:ops` rank are rejected server-side (403); successful staff
 * writes append a `staff_audit_log` row (ADR-0018 §3) — both enforced in the route,
 * not this page.
 *
 * Staff gating: the existing `/admin/*` middleware already requires a valid staff
 * session for this route — no new middleware is added here.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz/page
 */

import { notFound } from 'next/navigation';

import { tenantExists } from '@/lib/session-auth';
import { StaffQuizConfigEditor } from './quiz-config-editor';
import { StaffQuizStateToggle } from './quiz-state-toggle';

interface StaffTenantQuizPageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffTenantQuizPage({ params }: StaffTenantQuizPageProps) {
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
        <h1 className="text-2xl font-bold text-gray-900">Tenant Quiz Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Staff editor (ADR-0018). Tenant: <span className="font-mono text-xs">{id}</span>
        </p>
      </div>

      {/* FOLLOW-998: staff quiz ON/OFF (tenants.quiz_enabled) — audited via the
          staff-only /api/admin/tenants/quiz-state route, mirroring al-state. */}
      <div className="mb-6">
        <StaffQuizStateToggle tenantId={id} />
      </div>

      <StaffQuizConfigEditor tenantId={id} />
    </div>
  );
}
