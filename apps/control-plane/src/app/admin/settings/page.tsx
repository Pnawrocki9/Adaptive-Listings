/**
 * /admin/settings — Platform Settings (Estalara staff zone)
 *
 * Staff-facing surface for PLATFORM-GLOBAL configuration. Currently hosts the
 * global LLM generation-model selector via the shared GenerationModelSettings
 * panel (FOLLOW-161). Staff are the ONLY accounts authorized to PUT this
 * setting (FOLLOW-456) — until this page existed, the selector lived solely in
 * the agency zone (/dashboard/settings), which staff sessions cannot reach
 * (middleware blocks estalara_staff from /dashboard/*), leaving the setting
 * writable by no reachable UI. Phase 0 of the superadmin-access work
 * (2026-07-20); per-tenant settings surfaces are designed in the
 * superadmin-tenant-access ADR (Phase 1).
 *
 * Zone gating: middleware admits estalara:readonly+ to /admin/*. Readonly staff
 * can view this page; the PUT is enforced server-side by verifyTracerAdminAuth
 * (estalara_staff), so no client-side gating is duplicated here.
 *
 * @module apps/control-plane/src/app/admin/settings/page
 */

import GenerationModelSettings from '@/components/generation-model-settings';

export default function AdminSettingsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Platform Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Platform-global configuration — applies to <strong>all tenants</strong>. Changes take
          effect for new content generations immediately; cached content regenerates on the next
          request after a model switch.
        </p>
      </div>

      <GenerationModelSettings />
    </main>
  );
}
