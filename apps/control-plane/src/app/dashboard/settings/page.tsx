/**
 * /dashboard/settings — Admin Settings (agency zone)
 *
 * Thin wrapper around the shared GenerationModelSettings panel (FOLLOW-161).
 * Visible to agency:admin and agency:owner. NOTE: since FOLLOW-456 the PUT is
 * Estalara-staff-only, so agency admins can view the current model but a save
 * attempt is rejected server-side (surfaced in the panel's error state). The
 * writable surface for this setting is /admin/settings (staff zone).
 *
 * @module apps/control-plane/src/app/dashboard/settings/page
 */

import GenerationModelSettings from '@/components/generation-model-settings';

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Admin Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Global configuration for your Estalara workspace. Changes take effect for new content
          generations immediately. Cached content will regenerate on the next request after a model
          switch.
        </p>
      </div>

      <GenerationModelSettings />
    </main>
  );
}
