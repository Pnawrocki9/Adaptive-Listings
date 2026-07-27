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
 * Producer (FOLLOW-659): `PATCH /api/config` (`{ brand: { brand_name,
 * legal_entity } }`, staff rank ≥ `estalara:ops`, audited) — surfaced in the
 * staff settings page. Before that ticket the keys had readers only and were
 * seeded out-of-band, which also meant any settings-page Save silently WIPED
 * them (the PATCH rewrites the whole `brand_config` blob).
 *
 * Fail-honest default (FOLLOW-654 AC): a tenant with no configured brand
 * identity falls back to the Estalara first-party identity EXPLICITLY — never an
 * empty string in legal text. This preserves the exact current behavior for the
 * single live first-party tenant. For an EXTERNAL brand that fallback is a
 * silent mis-branding, so {@link isUnprovisionedExternalBrand} (FOLLOW-659)
 * raises the alarm the fail-honest default cannot.
 *
 * @module apps/control-plane/src/lib/brand-identity
 */

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';
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
  // `.nullish()`, not `.optional()` (FOLLOW-659): `PATCH /api/config` represents
  // "identity not configured" as an ABSENT key, but a hand-seeded blob may carry
  // an explicit `null`. With `.optional()` a single null would fail the WHOLE
  // object parse, silently discarding a correctly-set sibling key (e.g. a set
  // `brand_name` next to a null `legal_entity` would resolve to the Estalara
  // fallback for both). Accepting null keeps each key independent.
  brand_name: z.string().min(1).max(120).nullish(),
  legal_entity: z.string().min(1).max(200).nullish(),
});

type BrandIdentityConfig = z.infer<typeof BrandIdentityConfigSchema>;

/** Returns a trimmed non-empty string, or `undefined` for nullish/blank input. */
function normalizeNonEmpty(value: string | null | undefined): string | undefined {
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

/** Well-formed (RFC 4122-shaped) UUID, case-insensitive. Same shape as `apps/ingest`'s copy
 * (`origin-gate.ts`); not extracted to a shared package because each app's copy has a distinct,
 * app-local warn-once side effect (see {@link firstPartyTenantIdStatus}) and neither imports the
 * other's runtime. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Result of classifying a raw `FIRST_PARTY_TENANT_ID` env value. [FOLLOW-678] */
export type FirstPartyTenantIdStatus =
  | { status: 'unset' }
  | { status: 'malformed'; raw: string }
  | { status: 'valid'; value: string };

/**
 * Classifies + canonicalizes a raw `FIRST_PARTY_TENANT_ID` env value. [FOLLOW-678]
 *
 * Canonicalization is trim + lower-case, applied BEFORE the UUID-shape check, so a value that
 * only differs from a real tenant id by case or incidental whitespace (a copy-paste artifact, not
 * a typo) is classified `valid`, not `malformed`.
 *
 * @param raw - `process.env.FIRST_PARTY_TENANT_ID`.
 */
export function resolveFirstPartyTenantId(raw: string | undefined): FirstPartyTenantIdStatus {
  const trimmed = raw?.trim();
  if (!trimmed) return { status: 'unset' };
  const lower = trimmed.toLowerCase();
  if (!UUID_RE.test(lower)) return { status: 'malformed', raw: trimmed };
  return { status: 'valid', value: lower };
}

/** Set once a `first_party_tenant_id_malformed` warning has fired for this server instance.
 * [FOLLOW-678 AC 2] Module-level state persists across invocations handled by the same warm
 * Vercel function instance, so this fires ONCE per instance rather than once per request — a
 * mis-pasted env is visible in Sentry/logs without needing to spam either. Resets naturally on
 * the next cold start / deploy; that is the desired behavior (a fixed env should stop warning
 * without requiring a manual reset). */
let firstPartyTenantIdMalformedWarned = false;

/**
 * Reads + classifies `process.env.FIRST_PARTY_TENANT_ID`, warning ONCE per server instance if it
 * is present but malformed (not a well-formed UUID). [FOLLOW-678 AC 2] Centralized here so both
 * {@link isFirstPartyTenant} and the module-private external-brand check warn exactly once
 * between them, not once each.
 */
function firstPartyTenantIdStatus(): FirstPartyTenantIdStatus {
  const resolved = resolveFirstPartyTenantId(process.env.FIRST_PARTY_TENANT_ID);
  if (resolved.status === 'malformed' && !firstPartyTenantIdMalformedWarned) {
    firstPartyTenantIdMalformedWarned = true;
    console.warn(
      '[brand-identity] FIRST_PARTY_TENANT_ID is set but not a well-formed UUID — treating as ' +
        'unset (fails to the safe/existing unset behavior, never to "deny every tenant"):',
      resolved.raw,
    );
    Sentry.captureMessage('first_party_tenant_id_malformed', {
      level: 'warning',
      tags: { area: 'brand-identity', config: 'first_party_tenant_id' },
      extra: { first_party_tenant_id_raw: resolved.raw },
    });
  }
  return resolved;
}

/**
 * Whether `tenantId` is the first-party Estalara tenant for the purposes of the
 * `consent_text_hash` requirement (FOLLOW-654 leg 2).
 *
 * Determined by the `FIRST_PARTY_TENANT_ID` env allowlist:
 *   - env UNSET, blank, OR malformed (not a well-formed UUID once trimmed + lower-cased —
 *     FOLLOW-678) → returns `true` for ALL tenants. This preserves the current live registration
 *     flow: today exactly one tenant (Estalara) exists, and making the hash suddenly required
 *     would break that flow. A malformed value is deliberately treated the SAME as unset (not as
 *     "deny every tenant") — see {@link resolveFirstPartyTenantId}. Ops MUST set
 *     `FIRST_PARTY_TENANT_ID` to a WELL-FORMED, CORRECT UUID before onboarding any external brand
 *     (documented in `.env.example`; go-live gate in FOLLOW-656).
 *   - env SET to a well-formed UUID → returns `true` only for the exact matching tenant id
 *     (canonicalized: trim + lower-case on both sides, so case/whitespace never cause a false
 *     mismatch); every other tenant is treated as a non-first-party external brand and MUST
 *     supply its own `consent_text_hash`. A well-formed but WRONG UUID (mistyped, or the wrong
 *     tenant's id pasted) is NOT safe — it is indistinguishable from an intentional scoping and
 *     will require `consent_text_hash` from the real first-party tenant too.
 *
 * @param tenantId - The tenant UUID from the validated request body.
 */
export function isFirstPartyTenant(tenantId: string): boolean {
  const resolved = firstPartyTenantIdStatus();
  if (resolved.status !== 'valid') return true;
  return tenantId.trim().toLowerCase() === resolved.value;
}

/**
 * Code-level guard for the `FIRST_PARTY_TENANT_ID` fail-open (FOLLOW-660).
 *
 * {@link isFirstPartyTenant} answers `true` for EVERY tenant when the env is unset, which lets
 * `consent_text_hash` be omitted and silently default to the canonical Estalara hash. That is
 * correct only while Estalara is genuinely the only tenant. The moment a second tenant exists
 * with the env still unset, the same fail-open fabricates the audit record for every external
 * brand — it would attest that the visitor accepted Estalara's disclosure text when they
 * accepted the client's. Documentation (`.env.example`, the provisioning runbook §Step 0) was
 * the only defence; this is the code one.
 *
 * Decision table:
 *
 * | `FIRST_PARTY_TENANT_ID`        | tenant count | hash required?                             |
 * | ------------------------------ | ------------ | ------------------------------------------- |
 * | SET, well-formed UUID          | any          | only for tenants other than the configured one |
 * | UNSET / blank / MALFORMED      | ≤ 1          | NO — today's single-tenant Estalara path, unchanged |
 * | UNSET / blank / MALFORMED      | > 1          | YES, for every tenant — first-party is unknowable |
 *
 * A malformed value (present but not a well-formed UUID — FOLLOW-678) is deliberately folded
 * into the SAME row as unset/blank, never into the "SET" row: taking the exact-match branch on a
 * typo would incorrectly flag the REAL first-party tenant as external too (every tenant fails to
 * match a garbled string), which is the "deny everyone" outcome this ticket forbids. Falling
 * through to the tenant-count probe instead reuses the existing FOLLOW-660 safety net.
 *
 * The `> 1` case deliberately refuses rather than guessing: with no env there is no way to tell
 * which row is Estalara, and defaulting the canonical hash for the wrong one is exactly the
 * fabrication this closes. The fix is one CORRECT, well-formed env var, and the 400 says so.
 *
 * Fail-CLOSED on a count error: if the tenant count cannot be read we require the hash, because
 * the alternative is defaulting a legal attestation on unknown state.
 *
 * @param db - An admin (service-role) Drizzle client.
 * @param tenantId - The tenant UUID from the validated request body.
 * @returns `true` when the request MUST carry an explicit `consent_text_hash`.
 */
export async function requiresExplicitConsentHash(
  db: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<boolean> {
  return isTreatedAsExternalBrand(db, tenantId);
}

/**
 * Core first-party detection shared by every "is this an external brand?" gate in this module
 * (FOLLOW-659 — extracted from {@link requiresExplicitConsentHash} rather than re-derived, so a
 * second differently-shaped check can never drift from the first).
 *
 * Module-private on purpose: callers should express their INTENT
 * ({@link requiresExplicitConsentHash}, {@link isUnprovisionedExternalBrand}) so each gate's
 * fail-closed semantics stay documented at its own call site.
 *
 * See {@link requiresExplicitConsentHash} for the decision table and the fail-CLOSED rationale.
 *
 * @param db - An admin (service-role) Drizzle client.
 * @param tenantId - The tenant UUID.
 * @returns `true` when the tenant must be treated as a non-first-party external brand.
 */
async function isTreatedAsExternalBrand(
  db: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<boolean> {
  const resolved = firstPartyTenantIdStatus();
  // Env SET to a well-formed UUID — the configured tenant is first-party; everyone else is
  // external. Both operands canonicalized (trim + lower-case) so case/whitespace never cause a
  // false mismatch [FOLLOW-678]. UNSET *and* malformed both fall through to the tenant-count
  // probe below — see this function's docstring decision table for why malformed must NOT take
  // this branch.
  if (resolved.status === 'valid') return tenantId.trim().toLowerCase() !== resolved.value;

  // Env UNSET (or malformed) — "everyone is first-party" is safe only while exactly one tenant
  // can exist.
  try {
    const rows = await db.select({ id: tenants.id }).from(tenants).limit(2);
    return rows.length > 1;
  } catch (err: unknown) {
    console.error(
      '[brand-identity] tenant-count guard failed — treating tenant as external:',
      err instanceof Error ? err.message : err,
    );
    return true;
  }
}

/**
 * Whether `tenantId` is an EXTERNAL brand that is still running on the Estalara fallback identity
 * (FOLLOW-659) — i.e. its legal-facing surfaces would name "Estalara" / "Time2Show, Inc." to that
 * brand's data subjects because no operator ever seeded `brand_config.brand_name`.
 *
 * This is the fail-silent producer gap RETRO-219 flagged: nothing in this repo WRITES those keys
 * on a code path (the only producer is the operator's `PATCH /api/config` in the provisioning
 * runbook §Step 3a), and the reader fails HONEST — so an unprovisioned external brand emits
 * plausible, wrong legal identity with no error anywhere. This predicate is the alarm.
 *
 * Cheap by construction: short-circuits on `identity.isFallbackIdentity` (already computed by
 * {@link resolveBrandIdentity}), so a provisioned brand — and every first-party request once
 * `FIRST_PARTY_TENANT_ID` is set — costs zero extra queries.
 *
 * The first-party tenant is NEVER flagged: for it, the Estalara identity is the CORRECT identity,
 * not a fallback artefact.
 *
 * Callers decide the consequence, because it differs by surface (see each call site):
 *   - `GET /api/v1/consent/platform-registration` REFUSES to serve mis-branded consent text.
 *   - `POST /api/dsr/initiate` alerts but STILL SENDS — dropping a data subject's verification
 *     e-mail would obstruct a GDPR Art. 12/15 right, a worse compliance outcome than a
 *     mis-branded sender name.
 *
 * @param db - An admin (service-role) Drizzle client.
 * @param tenantId - The tenant UUID.
 * @param identity - The already-resolved identity for that tenant.
 * @returns `true` when the tenant is external AND has no configured brand identity.
 */
export async function isUnprovisionedExternalBrand(
  db: ReturnType<typeof createAdminClient>,
  tenantId: string,
  identity: Pick<BrandIdentity, 'isFallbackIdentity'>,
): Promise<boolean> {
  if (!identity.isFallbackIdentity) return false;
  return isTreatedAsExternalBrand(db, tenantId);
}
