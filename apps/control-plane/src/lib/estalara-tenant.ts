/**
 * The single Estalara tenant for the single-tenant admin (ESC-085, supersedes the
 * 2026-06-15 "pilot tenant" naming).
 *
 * Resolution order: `NEXT_PUBLIC_ESTALARA_TENANT_ID`, then the baked production tenant.
 * Localhost sets the variable to the seeded tenant (`scripts/dev/localhost-up.sh`), because the
 * production id does not exist in a local database. The legacy pilot-tenant variable's
 * one-release fallback (FOLLOW-1322) was retired by FOLLOW-1335: the 2026-10-19 production check
 * (ESC-085, R10 condition C2) found it absent from Vercel Production.
 *
 * FOLLOW-1332 adds the tenant's legal display identity and `isEstalaraTenant`, replacing
 * `lib/brand-identity.ts`.
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
export const ESTALARA_TENANT_ID = firstSet(process.env.NEXT_PUBLIC_ESTALARA_TENANT_ID);

/**
 * Whether `tenantId` is the Estalara tenant — the only tenant Adaptive Listings serves (ESC-085,
 * FOLLOW-1332). Replaces the env-driven first-party classification of the former
 * `lib/brand-identity.ts` (a first-party env var, a tenant-count probe, an external-brand
 * tri-state): with one tenant there is nothing to classify.
 *
 * Both sides are trimmed and lower-cased, as the former `isFirstPartyTenant` did (FOLLOW-678), so a
 * caller-supplied id differing only by case or surrounding whitespace is still recognised.
 *
 * @param tenantId - A tenant UUID (from a verified key row or a validated request body).
 */
export function isEstalaraTenant(tenantId: string): boolean {
  return tenantId.trim().toLowerCase() === ESTALARA_TENANT_ID.trim().toLowerCase();
}

/** Display name in the consent text and DSR e-mails. Read by regex by `scripts/check-consent-text-sync.mjs`. */
const ESTALARA_BRAND_NAME = 'Estalara' as const;

/** Legal entity in the consent text. Read by regex by `scripts/check-consent-text-sync.mjs`. */
const ESTALARA_LEGAL_ENTITY = 'Time2Show, Inc.' as const;

/**
 * Estalara's legal display identity — the values the former `lib/brand-identity.ts` resolved for
 * the first-party tenant (its `FIRST_PARTY_BRAND_IDENTITY`, and the fallback of
 * `resolveBrandIdentity`). Rendered into the §6.1 platform-registration consent text (and so into
 * `CANONICAL_CONSENT_TEXT_HASH`) and into the DSR OTP e-mail. A constant since FOLLOW-1332:
 * `tenants.brand_config.brand_name` / `legal_entity` are no longer read.
 *
 * Built from the two constants above rather than repeating their values: the `consent-text-sync`
 * CI gate reads `ESTALARA_BRAND_NAME` / `ESTALARA_LEGAL_ENTITY` out of THIS file by regex to render
 * the published §6.1 comparison, so a second copy of either string would be a drift surface the
 * gate cannot see.
 */
export const ESTALARA_BRAND_IDENTITY: Readonly<{ brandName: string; legalEntity: string }> =
  Object.freeze({
    brandName: ESTALARA_BRAND_NAME,
    legalEntity: ESTALARA_LEGAL_ENTITY,
  });
