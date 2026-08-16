/**
 * Estalara staff per-tenant quiz completions viewer — /admin/tenants/[id]/quiz-completions
 * (FOLLOW-999).
 *
 * The read-only staff surface for the `quiz_completions` MOAT table (FOLLOW-200):
 * every SDK quiz completion's resolved archetype, decision-tree branch, Q1–Q3
 * answer indexes and locale, newest first, with all-time archetype/branch
 * distributions. Until this page the ONLY read surface was the aggregate COUNT on
 * `/admin/analytics` — inspecting actual answers meant raw SQL against Supabase.
 *
 * A server component that resolves the URL `[id]`, validates it against the
 * `tenants` table via the SAME existence check the staff-override API path uses
 * ({@link tenantExists}), and renders `notFound()` (404) for an unknown/soft-deleted
 * tenant — so the page and the `?tenant_id`-scoped route it drives agree on what
 * "exists" means.
 *
 * Staff gating: the existing `/admin/*` middleware already requires a valid staff
 * session for this route — no new middleware is added here. Read-only: any staff
 * rank may view (the route has no write to rank-gate).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-completions/page
 */

import { notFound } from 'next/navigation';

import { tenantExists } from '@/lib/session-auth';
import { QuizCompletionsViewer } from './quiz-completions-viewer';

interface StaffTenantQuizCompletionsPageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffTenantQuizCompletionsPage({
  params,
}: StaffTenantQuizCompletionsPageProps) {
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
        <h1 className="text-2xl font-bold text-gray-900">Quiz Completions</h1>
        <p className="mt-1 text-sm text-gray-500">
          Read-only staff viewer (FOLLOW-999). Every SDK quiz completion recorded for this tenant —
          resolved archetype, branch, answer indexes. Tenant:{' '}
          <span className="font-mono text-xs">{id}</span>
        </p>
      </div>

      <QuizCompletionsViewer tenantId={id} />
    </div>
  );
}
