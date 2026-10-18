/**
 * The single Estalara tenant for the single-tenant admin (ESC-085, supersedes the
 * 2026-06-15 "pilot tenant" naming).
 *
 * Resolution order: `NEXT_PUBLIC_ESTALARA_TENANT_ID`, then the legacy
 * `NEXT_PUBLIC_PILOT_TENANT_ID` (ONE-release fallback, FOLLOW-1322 — remove next
 * release), then the baked production tenant. Localhost sets the first one to the
 * seeded tenant (`scripts/dev/localhost-up.sh`), because the production id does
 * not exist in a local database.
 *
 * @module apps/control-plane/src/lib/estalara-tenant
 */

/** Baked production tenant (Supabase tenants.id). */
const PRODUCTION_ESTALARA_TENANT_ID = 'cbc51cfa-1056-40aa-b0a9-6e982b52b1de';

/** First non-empty value wins (an empty env var counts as unset). */
function firstSet(...values: (string | undefined)[]): string {
  return values.find((v) => v !== undefined && v !== '') ?? PRODUCTION_ESTALARA_TENANT_ID;
}

/** The Estalara tenant id the admin landing and sidebar are scoped to. */
export const ESTALARA_TENANT_ID = firstSet(
  process.env.NEXT_PUBLIC_ESTALARA_TENANT_ID,
  process.env.NEXT_PUBLIC_PILOT_TENANT_ID,
);
