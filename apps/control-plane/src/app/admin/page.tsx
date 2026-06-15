import { permanentRedirect } from 'next/navigation';

import { PILOT_TENANT_ID } from '@/lib/pilot-tenant';

/**
 * /admin landing — redirects to the pilot tenant's Tracer live monitor.
 *
 * Single-tenant v1 (CEO decision 2026-06-15): the old /admin/registrations landing
 * is a hidden multi-tenant screen, so the admin opens directly on the Tracer.
 */
export default function AdminIndexPage() {
  permanentRedirect(`/admin/tenants/${PILOT_TENANT_ID}/tracer`);
}
