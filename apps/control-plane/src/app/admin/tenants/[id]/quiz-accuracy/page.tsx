/**
 * Estalara staff per-tenant quiz accuracy tab — /admin/tenants/[id]/quiz-accuracy (FOLLOW-1363).
 *
 * The read-only report of the pre-registered claim "the quiz alone identifies the archetype with
 * >= 90 % accuracy" (`docs/decisions/PREREG-quiz-accuracy-2026-10.md`): headline + Wilson interval +
 * verdict, funnel, per-leaf table, confusion matrix, language and speed splits, monthly rows.
 *
 * A server component that validates `[id]` with the same {@link tenantExists} check the
 * staff-override API path uses and renders `notFound()` for an unknown tenant. The `/admin/*`
 * middleware already requires a staff session; read-only, so any staff rank may view.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-accuracy/page
 */

import { notFound } from 'next/navigation';

import { tenantExists } from '@/lib/session-auth';
import { QuizAccuracyView } from './quiz-accuracy-view';

interface StaffTenantQuizAccuracyPageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffTenantQuizAccuracyPage({
  params,
}: StaffTenantQuizAccuracyPageProps) {
  const { id } = await params;

  // Fails closed: if validation cannot run, tenantExists throws and the error boundary owns it.
  const exists = await tenantExists(id);
  if (!exists) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Quiz Accuracy</h1>
        <p className="mt-1 text-sm text-gray-500">
          Read-only staff report (FOLLOW-1363) for the pre-registered claim: the quiz alone
          identifies the archetype with at least 90 % accuracy. One analysis, fixed n = 400 on one
          definition hash. Tenant: <span className="font-mono text-xs">{id}</span>
        </p>
      </div>

      <QuizAccuracyView tenantId={id} />
    </div>
  );
}
