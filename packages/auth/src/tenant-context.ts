/**
 * Tenant context — typed wrapper around per-request tenant state.
 *
 * Provides an AsyncLocalStorage-based context for Node.js Server Components
 * and Route Handlers (Next.js App Router). Cloudflare Workers use Hono's
 * c.set() instead — do NOT import this module in Worker code.
 *
 * Typical lifecycle:
 *   1. Next.js middleware validates JWT and injects x-tenant-id into request headers.
 *   2. A tenant layout (e.g. app/dashboard/layout.tsx) reads those headers and calls
 *      tenantContextStorage.run(ctx, callback) to make the context available to all
 *      Server Components nested inside it.
 *   3. Server Components call getTenantContext() or getTenantId() to access the context.
 *
 * @module @estalara/auth/tenant-context
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { AgencyRole, TenantClaims } from './jwt.js';

// ─── Type ──────────────────────────────────────────────────────────────────

/**
 * Immutable snapshot of the authenticated tenant's identity for a single request.
 * Created once per request during JWT validation and stored in AsyncLocalStorage.
 */
export interface TenantContext {
  /** Tenant UUID — matches tenants.id in the database. */
  tenant_id: string;
  /** Agency role extracted from JWT. */
  agency_role: AgencyRole;
  /** User UUID — sub from JWT, matches users.id. */
  user_id: string;
  /** Correlation ID for logging and tracing. */
  request_id: string;
}

// ─── Factory ───────────────────────────────────────────────────────────────

/**
 * Build a {@link TenantContext} from validated JWT claims and a request correlation ID.
 *
 * @throws {Error} if claims.tenant_id is missing or empty (should never happen after
 *   extractClaims() validation, but guards against misuse)
 */
export function createTenantContext(claims: TenantClaims, requestId: string): TenantContext {
  if (!claims.tenant_id) {
    throw new Error('Cannot create tenant context: tenant_id is missing from claims');
  }
  return {
    tenant_id: claims.tenant_id,
    agency_role: claims.agency_role,
    user_id: claims.sub,
    request_id: requestId,
  };
}

// ─── AsyncLocalStorage ─────────────────────────────────────────────────────

/**
 * AsyncLocalStorage instance for tenant context in Node.js environments.
 *
 * Usage:
 * ```ts
 * // In a layout / route entry point:
 * const ctx = createTenantContext(claims, requestId);
 * return tenantContextStorage.run(ctx, async () => {
 *   // All Server Components rendered inside this callback can call getTenantContext()
 *   return renderChildren();
 * });
 * ```
 */
export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

// ─── Accessors ─────────────────────────────────────────────────────────────

/**
 * Return the current tenant context from AsyncLocalStorage.
 *
 * @throws {Error} if called outside a `tenantContextStorage.run()` block,
 *   i.e. in code that is not inside an authenticated tenant request context.
 */
export function getTenantContext(): TenantContext {
  const ctx = tenantContextStorage.getStore();
  if (!ctx) {
    throw new Error(
      'No tenant context in scope. Ensure this code runs inside tenantContextStorage.run().',
    );
  }
  return ctx;
}

/**
 * Return the current tenant context, or null if not inside a tenant request context.
 * Use this in code that may run in both tenant and non-tenant contexts.
 */
export function getTenantContextOrNull(): TenantContext | null {
  return tenantContextStorage.getStore() ?? null;
}
