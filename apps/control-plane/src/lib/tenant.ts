/**
 * Tenant helpers for Next.js App Router Server Components and Route Handlers.
 *
 * These helpers assume the current request is inside a tenant dashboard context
 * where a layout has already called:
 *   `tenantContextStorage.run(ctx, renderCallback)`
 *
 * Calling any function here outside that context will throw.
 *
 * Usage in a Server Component:
 *   import { getTenantId } from '@/lib/tenant';
 *   const tenantId = getTenantId();
 *
 * @module apps/control-plane/src/lib/tenant
 */

import { createTenantClient, type Database } from '@estalara/db';
import { getTenantContext, getTenantContextOrNull } from '@estalara/auth';

export type { TenantContext } from '@estalara/auth';

/** Re-exported for use in Server Components that need the full context object. */
export { getTenantContext as getTenant, getTenantContextOrNull };

/**
 * Return the current tenant's UUID.
 * Convenience wrapper over `getTenant().tenant_id`.
 *
 * @throws {Error} if called outside a tenant request context
 */
export function getTenantId(): string {
  return getTenantContext().tenant_id;
}

/**
 * Create a Drizzle DB client scoped to the current tenant.
 *
 * Uses `createTenantClient()` from `@estalara/db`. Row Level Security is
 * enforced — queries will only see data belonging to the current tenant.
 *
 * NOTE: jwtToken propagation (for full Supabase RLS via auth.jwt()) is a
 * follow-up concern (TICKET-024+). For now the client uses the anon role
 * connection with tenant_id available from the context.
 *
 * @throws {Error} if called outside a tenant request context
 */
export function getTenantDb(): Database {
  getTenantContext(); // validates we're inside a tenant context; throws if not
  return createTenantClient();
}
