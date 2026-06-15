/**
 * Pilot tenant identity for the single-tenant v1 admin (CEO decision 2026-06-15).
 *
 * Adaptive Listings v1 ships for exactly one tenant — "app.estalara.com pilot".
 * The admin shell is scoped to it: the per-tenant Tracer (live monitor, session
 * history) is reached directly via this id instead of through a multi-tenant
 * tenants list (which is hidden in v1).
 *
 * `NEXT_PUBLIC_PILOT_TENANT_ID` overrides the baked default so non-prod
 * environments can point at a different tenant without a code change.
 *
 * @module apps/control-plane/src/lib/pilot-tenant
 */

/** The app.estalara.com pilot tenant (Supabase tenants.id), single-tenant v1. */
export const PILOT_TENANT_ID =
  process.env.NEXT_PUBLIC_PILOT_TENANT_ID ?? 'cbc51cfa-1056-40aa-b0a9-6e982b52b1de';
