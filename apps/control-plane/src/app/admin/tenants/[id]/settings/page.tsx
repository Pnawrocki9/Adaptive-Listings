/**
 * Estalara staff per-tenant settings — /admin/tenants/[id]/settings (FOLLOW-600,
 * ADR-0018 §5/§6).
 *
 * Ports the per-tenant subset of settings enumerated in ADR-0018 §5 that are NOT
 * already covered by a dedicated staff surface (quiz → `/admin/tenants/[id]/quiz`,
 * demo mode → `/demo`, labels → `/labels`, intent → `/intent`): plan (read-only
 * display), brand config (`primary_color`, `logo_url`, `white_label`), and the SDK
 * `allowed_origins` allow-list. Backed by `GET`/`PATCH /api/config`.
 *
 * NOTE (CEO Q1, ADR-0018 §5, binding): `generation_model` is GLOBAL-only and MUST
 * NOT appear on this page (the dropped FOLLOW-601). `page.test.tsx` asserts this
 * directly.
 *
 * A server component that resolves the URL `[id]`, validates it against the
 * `tenants` table via the SAME existence check the staff-override API path uses
 * ({@link tenantExists}), and renders `notFound()` (404) for an unknown/soft-deleted
 * tenant — mirrors `/admin/tenants/[id]/quiz/page.tsx`.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/settings/page
 */

import { notFound } from 'next/navigation';

import { tenantExists } from '@/lib/session-auth';
import { StaffTenantConfigEditor } from './tenant-config-editor';

interface StaffTenantSettingsPageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffTenantSettingsPage({ params }: StaffTenantSettingsPageProps) {
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
        <h1 className="text-2xl font-bold text-gray-900">Tenant Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Staff editor (ADR-0018 §5/§6). Tenant: <span className="font-mono text-xs">{id}</span>
        </p>
      </div>

      <StaffTenantConfigEditor tenantId={id} />
    </div>
  );
}
