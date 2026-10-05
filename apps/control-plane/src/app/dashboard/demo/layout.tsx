import type React from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { isDemoModeEnabled } from '@/lib/demo/demo-mode';

/**
 * Gate for every `/dashboard/demo/*` page (FOLLOW-1288, WP-2.3): the demo tooling exists only when
 * the control plane runs with `DEMO_MODE=1`; otherwise the whole segment renders Next's 404, the
 * same answer an absent route gives.
 *
 * `connection()` makes the segment render per request, so the flag is read from the running
 * process — never baked in at `next build` time.
 *
 * @module apps/control-plane/src/app/dashboard/demo/layout
 */
export default async function DemoLayout({ children }: { children: React.ReactNode }) {
  await connection();
  if (!isDemoModeEnabled()) notFound();
  return <>{children}</>;
}
