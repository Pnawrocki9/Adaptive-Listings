import type React from 'react';
import Script from 'next/script';

/**
 * Layout for the Demo Mode mock-up listings section.
 * Provides the demo context wrapper without adding auth checks —
 * access is controlled by the parent /dashboard middleware.
 *
 * Loads the Estalara SDK IIFE so personalization runs during demos.
 * Events are routed to /api/demo/ingest (stub, Sprint 5 wires real pipeline).
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
        data-tier="observer"
        data-debug="true"
        data-ingest-url="/api/demo/ingest"
        data-accent-color="#2563EB"
      />
    </div>
  );
}
