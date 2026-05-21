/**
 * /dashboard/onboarding/detect — Magic Link onboarding wizard page.
 *
 * Server Component wrapper around the <DetectWizard> client component.
 * Protected by the existing /dashboard/* auth middleware (agency:viewer minimum).
 * Unauthenticated visitors are redirected to /login by middleware.ts.
 *
 * Renders the wizard inside the shared dashboard layout (sidebar nav).
 *
 * @module apps/control-plane/src/app/dashboard/onboarding/detect/page
 */

import type React from 'react';
import { DetectWizard } from '@/components/onboarding/DetectWizard';

/**
 * Magic Link onboarding detect page.
 *
 * Uses the dashboard layout (inherited from apps/control-plane/src/app/dashboard/layout.tsx).
 * Auth is enforced by middleware.ts for all /dashboard/* routes.
 */
export default function OnboardingDetectPage(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Auto-Detect Your Site Schema</h1>
        <p className="mt-1.5 text-sm text-gray-500">
          Paste a URL from your listing site. Estalara will analyse the page and automatically map
          your CSS selectors for prices, headlines, bedrooms, and more.
        </p>
      </div>

      <DetectWizard />
    </div>
  );
}
