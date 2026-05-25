import type React from 'react';
import Script from 'next/script';
import { CONTROL_PLANE_URL } from '@estalara/shared';

/**
 * Layout for the Demo Mode mock-up listings section.
 * Provides the demo context wrapper without adding auth checks —
 * access is controlled by the parent /dashboard middleware.
 *
 * Loads the Estalara SDK IIFE so personalization runs during demos.
 * Events are routed to /api/demo/ingest (stub, Sprint 5 wires real pipeline).
 *
 * data-decision-url = `${CONTROL_PLANE_URL}/api` (absolute host) — the SDK appends
 * "/adapt" itself, so the final fetch target becomes
 * `https://admin.estalara.com/api/adapt` (the canonical control-plane endpoint).
 *
 * Why absolute (not the previous relative "/api"): a relative path resolves
 * against whatever origin the SDK <script> is loaded on. Inside the demo this
 * happened to be the control-plane origin (correct), but the same value copied
 * into an external tenant snippet would resolve against the TENANT's domain —
 * silently sending adapt requests to the wrong host. An absolute host is the
 * only safe canonical target. [FOLLOW-105 §F.2]
 *
 * @module apps/control-plane/src/app/dashboard/demo/mockup/layout
 */
export default function MockupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {children}
      <Script
        src="/api/sdk"
        strategy="afterInteractive"
        data-api-key="est_demo_mockup"
        data-tenant-id="est_demo_tenant"
        data-tier="observer"
        data-debug="true"
        data-ingest-url="/api/demo/ingest"
        data-decision-url={`${CONTROL_PLANE_URL}/api`}
        data-accent-color="#2563EB"
      />
    </div>
  );
}
