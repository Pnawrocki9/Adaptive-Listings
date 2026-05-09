import type React from 'react';

/**
 * Layout for the Demo Mode mock-up listings section.
 * Provides the demo context wrapper without adding auth checks —
 * access is controlled by the parent /dashboard middleware.
 *
 * @module apps/control-plane/src/app/dashboard/demo/mockup/layout
 */
export default function MockupLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-50">{children}</div>;
}
