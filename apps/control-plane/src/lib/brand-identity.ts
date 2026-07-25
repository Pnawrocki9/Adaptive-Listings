/**
 * Per-tenant brand identity resolution (FOLLOW-654).
 *
 * Every external client brand is a white-label deployment of this app on the
 * client's own domain, represented by a `tenants` row. The legally-visible
 * "display identity" (the brand name shown in consent text and DSR emails, and
 * the legal entity named in the §6.1 umbrella disclosure) must be brand-correct
 * on those deployments — never hardcoded to "Estalara" / "Time2Show, Inc.".
 *
 * This module is the SINGLE source of that identity. Both the platform
 * registration consent surface
 * (`api/v1/consent/platform-registration/route.ts`) and the DSR OTP email
 * (`api/dsr/initiate/route.ts`) resolve identity through here so they can never
 * drift.
 *
 * Storage: the identity lives in the existing `tenants.brand_config` JSONB
 * column under two ADDITIVE, server-side-only keys — `brand_name` and
 * `legal_entity`. It is deliberately NOT added to the SDK public-config wire
 * (`packages/shared/src/schemas/presentation-config.ts`): there is no SDK
 * consumer for the legal display identity, and Rule L requires schema keys to
 * ship with a real consumer. Keeping it server-side avoids leaking an unwired
 * key onto the anonymous-buyer runtime fetch.
 *
 * Fail-honest default (FOLLOW-654 AC): a tenant with no configured brand
 * identity falls back to the Estalara first-party identity EXPLICITLY — never an
 * empty string in legal text. This preserves the exact current behavior for the
 * single live first-party tenant.
 *
 * @module apps/control-plane/src/lib/brand-identity
 */

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { createAdminClient } from '@estalara/db';
import { tenants } from '@estalara/db';

/** First-party display name used whenever no per-tenant brand name is configured. */
const ESTALARA_BRAND_NAME = 'Estalara' as const;

/** First-party legal entity used whenever no per-tenant legal entity is configured. */
const ESTALARA_LEGAL_ENTITY = 'Time2Show, Inc.' as const;

/**
 * Resolved, render-ready brand identity. Both fields are guaranteed non-empty:
 * they fall back to the Estalara first-party identity rather than an empty
 * string in any legal / email text.
 */
export interface BrandIdentity {
  /** Display name (e.g. "Estalara", "Costa Sol Properties"). Never empty. */
  brandName: string;
  /** Legal entity (e.g. "Time2Show, Inc."). Never empty. */
  legalEntity: string;
  /**
   * `true` when `brandName` was taken from the Estalara fallback because the
   * tenant has no `brand_config.brand_name` configured. Consumers may use this
   * for provenance / logging; it does NOT by itself imply first-party status
   * (use {@link isFirstPartyTenant} for the leg-2 hash requirement).
   */
  isFallbackIdentity: boolean;
}

/**
 * Server-side-only slice of `tenants.brand_config` that carries the legal
 * display identity. Both keys are optional so pre-existing rows (which only
 * hold `primary_color` / `logo_url` / `white_label`) parse cleanly.
 */
const BrandIdentityConfigSchema = z.object({
  brand_name: z.string().min(1).max(120).optional(),
  legal_entity: z.string().min(1).max(200).optional(),
});

type BrandIdentityConfig = z.infer<typeof BrandIdentityConfigSchema>;

/** Returns a trimmed non-empty string, or `undefined` for nullish/blank input. */
function normalizeNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

/**
 * Resolves a {@link BrandIdentity} from a raw (untyped) `brand_config` JSONB
 * value. Parses defensively — a malformed blob yields the Estalara fallback
 * rather than throwing.
 *
 * @param brandConfigRaw - The raw `tenants.brand_config` value (unknown shape).
 */
export function resolveBrandIdentity(brandConfigRaw: unknown): BrandIdentity {
  const source =
    brandConfigRaw && typeof brandConfigRaw === 'object'
      ? (brandConfigRaw as Record<string, unknown>)
      : {};
  const parsed = BrandIdentityConfigSchema.safeParse(source);
  const cfg: BrandIdentityConfig = parsed.success ? parsed.data : {};

  // Normalize to a non-empty trimmed value or `undefined`, so a whitespace-only
  // config value falls back to the Estalara identity (never an empty string in
  // legal text) while keeping the `??` fallback lint-clean.
  const normalizedName = normalizeNonEmpty(cfg.brand_name);
  const normalizedEntity = normalizeNonEmpty(cfg.legal_entity);

  return {
    brandName: normalizedName ?? ESTALARA_BRAND_NAME,
    legalEntity: normalizedEntity ?? ESTALARA_LEGAL_ENTITY,
    isFallbackIdentity: normalizedName === undefined,
  };
}

/**
 * Fetches and resolves the brand identity for a tenant from the `tenants`
 * table. Returns the Estalara fallback identity when the tenant row is absent
 * (fail-honest — never an empty string).
 *
 * @param db - An admin (service-role) Drizzle client.
 * @param tenantId - The tenant UUID.
 */
export async function fetchBrandIdentity(
  db: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<BrandIdentity> {
  const rows = await db
    .select({ brandConfig: tenants.brandConfig })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return resolveBrandIdentity(rows[0]?.brandConfig ?? null);
}

/**
 * Whether `tenantId` is the first-party Estalara tenant for the purposes of the
 * `consent_text_hash` requirement (FOLLOW-654 leg 2).
 *
 * Determined by the `FIRST_PARTY_TENANT_ID` env allowlist:
 *   - env UNSET → returns `true` for ALL tenants. This preserves the current
 *     live registration flow: today exactly one tenant (Estalara) exists, and
 *     making the hash suddenly required would break that flow. Ops MUST set
 *     `FIRST_PARTY_TENANT_ID` before onboarding any external brand (documented
 *     in `.env.example`; go-live gate in FOLLOW-656).
 *   - env SET → returns `true` only for the exact matching tenant UUID; every
 *     other tenant is treated as a non-first-party external brand and MUST
 *     supply its own `consent_text_hash`.
 *
 * @param tenantId - The tenant UUID from the validated request body.
 */
export function isFirstPartyTenant(tenantId: string): boolean {
  const firstParty = process.env.FIRST_PARTY_TENANT_ID?.trim();
  if (!firstParty) return true;
  return tenantId === firstParty;
}
