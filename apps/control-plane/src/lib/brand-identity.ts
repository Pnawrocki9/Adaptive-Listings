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
 * The first-party (Estalara) display identity as a render-ready pair.
 *
 * Exported for ONE consumer (FOLLOW-815): the platform-registration consent module derives
 * `CANONICAL_CONSENT_TEXT_HASH` as
 * `computeConsentTextHash(renderPlatformConsentText(FIRST_PARTY_BRAND_IDENTITY))`, so the
 * canonical hash and the text the first-party data subject actually reads cannot diverge —
 * they are the same expression. Before FOLLOW-815 that constant was a hand-typed literal tied
 * to no text at all (FOLLOW-704 / RETRO-227 §4a LG-1).
 *
 * Deliberately built from the two constants above rather than repeating their values: the
 * `consent-text-sync` CI gate (`scripts/check-consent-text-sync.mjs`) reads
 * `ESTALARA_BRAND_NAME` / `ESTALARA_LEGAL_ENTITY` out of THIS file by regex to render the
 * published §6.1 comparison, so a second copy of either string would be a silent drift surface
 * the gate cannot see.
 */
export const FIRST_PARTY_BRAND_IDENTITY: Readonly<
  Pick<BrandIdentity, 'brandName' | 'legalEntity'>
> = Object.freeze({
  brandName: ESTALARA_BRAND_NAME,
  legalEntity: ESTALARA_LEGAL_ENTITY,
});

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

/** Set once the AUTHORISATION consumer has reported an unresolved `FIRST_PARTY_TENANT_ID` for
 * this server instance. [FOLLOW-957 AC(2)]
 *
 * DELIBERATELY NOT `firstPartyTenantIdMalformedWarned`. That flag is shared between consumers on
 * purpose (`:207-209`, "so both warn exactly once between them"), which was right when they had
 * the same stake — but they no longer do. For the `consent_text_hash` consumer an unresolved env
 * means "keep today's single-tenant behaviour"; for the CORS consumer it means an authorisation
 * verdict FLIPS. Sharing the flag lets the low-stakes consumer consume the only signal the
 * high-stakes one has, and the operator sees nothing.
 *
 * It also fires on `unset`/blank, not only `malformed`. Unset is the DOMINANT case and the one
 * that flips the verdict; warning only about the exotic one is the wrong way round. */
let firstPartyUnresolvedWarnedForAuth = false;

/**
 * Reports, once per server instance, that an AUTHORISATION decision was taken without a resolvable
 * first-party identity. [FOLLOW-957 AC(2)/AC(4)]
 *
 * This is the instrument that makes `'unverified'` observable at all. Without it the state is
 * invisible: the refusal it causes was byte-identical to a wrong-origin refusal, and four of six
 * callers collapse that into a 401 (FOLLOW-943), so a first-party lockout surfaced as "a 401 on a
 * correct API key" with nothing in any log naming the cause.
 *
 * ⚠️ **CORRECTED 2026-08-12 (FOLLOW-965) — only the `console.warn` leg below is live in prod.**
 * `SENTRY_DSN_CONTROL_PLANE` is absent from EVERY Vercel environment (measured 2026-08-12;
 * `docs/runbooks/observability.md` §Control-plane Sentry signals), so `Sentry.init()` never runs
 * and the `captureMessage` below is a silent no-op — not a delayed send. The surviving channel is
 * the `console.warn`, readable only in Vercel runtime logs, once per server instance. Anything
 * that says this state is "visible in Sentry" is true of the CODE and false of PRODUCTION until
 * the DSN is set and one event is OBSERVED arriving (FOLLOW-965 AC(1)/AC(2), operator steps).
 *
 * The value is never logged — only its STATUS. `unset` has no value to leak and the malformed
 * value is already reported by the FOLLOW-678 warning above.
 */
function reportUnresolvedFirstPartyForAuth(status: FirstPartyTenantIdStatus): void {
  if (status.status === 'valid') return;
  if (firstPartyUnresolvedWarnedForAuth) return;
  firstPartyUnresolvedWarnedForAuth = true;
  console.warn(
    '[brand-identity] FIRST_PARTY_TENANT_ID is ' +
      status.status +
      ' — first-party identity is UNVERIFIABLE, so origin decisions that would GRANT the platform ' +
      'allow-list now refuse with `first_party_unverified`. If Estalara has been locked out of its ' +
      'own control plane, this is the cause. Set FIRST_PARTY_TENANT_ID in VERCEL (the store read ' +
      'at runtime), not only in Doppler. See docs/runbooks/BRAND_PROVISIONING.md §Step 6.',
  );
  Sentry.captureMessage('first_party_tenant_id_unresolved', {
    level: 'warning',
    tags: {
      area: 'brand-identity',
      config: 'first_party_tenant_id',
      consumer: 'authorisation',
      env_status: status.status,
    },
  });
}

/**
 * The same question as {@link isFirstPartyTenant}, but as a TRI-STATE that does not collapse
 * "we know this is Estalara" into "we cannot tell". [FOLLOW-951]
 *
 * `isFirstPartyTenant` fails OPEN — unset, blank or malformed env answers `true` for every
 * tenant. That is correct and deliberate for the `consent_text_hash` consumer, which pairs it
 * with a tenant-count probe ({@link requiresExplicitConsentHash}) as the compensating net. The
 * CORS consumer added in FOLLOW-941 inherited the fail-open and none of the net, so an external
 * brand could be handed Estalara's platform origins — the FOLLOW-658 failure one layer up
 * (RETRO-267).
 *
 * A caller that GRANTS something extra on the strength of "this is the first party" must use
 * this and require `'confirmed'`. A caller preserving today's single-tenant behaviour may treat
 * `'unverified'` as first-party, but must say so at the call site and state what falsifies it.
 *
 *   - `'confirmed'`  — env is a well-formed UUID and this tenant matches it.
 *   - `'external'`   — env is a well-formed UUID and this tenant does NOT match it.
 *   - `'unverified'` — env unset, blank or malformed (FOLLOW-678 folds malformed in here): the
 *                      first party is UNKNOWABLE, so neither answer is available.
 *
 * @param tenantId - The resolved tenant UUID (not a body-supplied one).
 */
export function classifyFirstPartyTenant(
  tenantId: string,
): 'confirmed' | 'external' | 'unverified' {
  const resolved = firstPartyTenantIdStatus();
  if (resolved.status !== 'valid') {
    // [FOLLOW-957 AC(2)] Announce it. A producer of a security-relevant state with no consumer
    // that can observe it is the HALF_WIRE_P shape RETRO-268 classified this as.
    reportUnresolvedFirstPartyForAuth(resolved);
    return 'unverified';
  }
  return tenantId.trim().toLowerCase() === resolved.value ? 'confirmed' : 'external';
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
 * the alternative is defaulting a legal attestation on unknown state. That direction is correct
 * HERE because the consequence is "ask the caller for more input", not "refuse a write" — see
 * {@link classifyTenantBrandScope} for the tri-state the write path consumes instead
 * (FOLLOW-698).
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
 * Evidence-carrying answer to "is this tenant the first-party (Estalara) tenant?" [FOLLOW-698]
 *
 * TRI-STATE on purpose (Rule K.2 fail-CLOSED-value-laundering amendment). The pre-FOLLOW-698
 * shape was a bare `boolean` produced partly inside a `catch`, so "I could not determine this"
 * was indistinguishable from "I determined this tenant is external" — and every caller then
 * rendered that value to a client as a statement of fact. `indeterminate` makes the unknown
 * legible to the caller, which is the only way a WRITE path can refuse to refuse.
 *
 * `basis` records HOW the scope was reached, because the two `external` bases carry very
 * different evidential weight:
 *   - `env_mismatch` — `FIRST_PARTY_TENANT_ID` is set and this tenant is NOT it. PROVEN external.
 *   - `first_party_unidentifiable` — the env is unset/malformed and more than one tenant row
 *     exists, so no code path can say which row is Estalara. Every fail-closed gate treats this
 *     as external (that is the FOLLOW-660 safety net and it is correct for gates that refuse to
 *     SERVE or demand more input), but it is NOT proof that THIS tenant is external — the caller
 *     may be Estalara itself. A gate that refuses or discards a WRITE must not fire on it.
 *
 * @see {@link requiresExplicitConsentHash} for the decision table this classification implements.
 */
export type TenantBrandScope =
  | { scope: 'first_party'; basis: 'env_match' | 'sole_tenant' }
  | { scope: 'external'; basis: 'env_mismatch' | 'first_party_unidentifiable' }
  | { scope: 'indeterminate'; basis: 'tenant_count_read_failed' };

/**
 * Core first-party detection shared by every "is this an external brand?" gate in this module
 * (FOLLOW-659 — extracted from {@link requiresExplicitConsentHash} rather than re-derived, so a
 * second differently-shaped check can never drift from the first; made tri-state by FOLLOW-698).
 *
 * Exported because `POST /api/v1/consent/platform-registration` step 7c — the only gate here
 * that can refuse a WRITE — must read the evidence directly rather than a fail-closed boolean.
 * Gates that merely refuse to SERVE or demand more input keep consuming the boolean wrappers
 * ({@link requiresExplicitConsentHash}, {@link isUnprovisionedExternalBrand}), whose behaviour is
 * unchanged by this function's tri-state shape.
 *
 * See {@link requiresExplicitConsentHash} for the decision table and the fail-CLOSED rationale.
 *
 * @param db - An admin (service-role) Drizzle client.
 * @param tenantId - The tenant UUID.
 * @returns The scope plus the evidence it was derived from — never a laundered unknown.
 */
export async function classifyTenantBrandScope(
  db: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<TenantBrandScope> {
  const resolved = firstPartyTenantIdStatus();
  // Env SET to a well-formed UUID — the configured tenant is first-party; everyone else is
  // external. Both operands canonicalized (trim + lower-case) so case/whitespace never cause a
  // false mismatch [FOLLOW-678]. UNSET *and* malformed both fall through to the tenant-count
  // probe below — see {@link requiresExplicitConsentHash}'s decision table for why malformed
  // must NOT take this branch.
  if (resolved.status === 'valid') {
    return tenantId.trim().toLowerCase() === resolved.value
      ? { scope: 'first_party', basis: 'env_match' }
      : { scope: 'external', basis: 'env_mismatch' };
  }

  // Env UNSET (or malformed) — "everyone is first-party" is safe only while exactly one tenant
  // can exist.
  try {
    const rows = await db.select({ id: tenants.id }).from(tenants).limit(2);
    return rows.length > 1
      ? { scope: 'external', basis: 'first_party_unidentifiable' }
      : { scope: 'first_party', basis: 'sole_tenant' };
  } catch (err: unknown) {
    console.error(
      '[brand-identity] tenant-count guard failed — brand scope is INDETERMINATE (boolean ' +
        'callers still fail CLOSED to "external"; write-path callers must NOT refuse on this):',
      err instanceof Error ? err.message : err,
    );
    return { scope: 'indeterminate', basis: 'tenant_count_read_failed' };
  }
}

/**
 * Boolean fail-CLOSED collapse of {@link classifyTenantBrandScope}, preserved verbatim for the
 * gates whose consequence is "refuse to SERVE" or "demand more input" — where treating an
 * unknown as external is the correct direction (Rule K.2 amendment §2).
 *
 * `indeterminate` collapses to `true`, exactly as the pre-FOLLOW-698 `catch → return true` did,
 * so {@link requiresExplicitConsentHash} (consent POST step 7b) and
 * {@link isUnprovisionedExternalBrand} (consent GET, DSR initiate) are behaviourally unchanged.
 *
 * @param db - An admin (service-role) Drizzle client.
 * @param tenantId - The tenant UUID.
 * @returns `true` when the tenant must be treated as a non-first-party external brand.
 */
async function isTreatedAsExternalBrand(
  db: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<boolean> {
  return (await classifyTenantBrandScope(db, tenantId)).scope !== 'first_party';
}

/**
 * Whether a resolved identity renders the FIRST-PARTY Estalara display identity — either because
 * it is the fail-honest fallback, or because a tenant explicitly configured those exact values.
 *
 * Used by the consent POST's canonical-hash refusal (FOLLOW-697): the canonical EN §6.1 hash is
 * only PROVABLY the wrong text for a tenant that renders some OTHER display identity.
 *
 * Corrected 2026-08-07 (FOLLOW-815, Rule AH): this docblock used to say
 * `CANONICAL_CONSENT_TEXT_HASH` "is NOT equal to
 * `computeConsentTextHash(renderPlatformConsentText(estalaraIdentity))`" — true of the hand-typed
 * placeholder, false now that the constant is DERIVED from exactly that expression. The predicate
 * is unchanged and still load-bearing: it scopes the refusal to tenants rendering some other
 * identity, which is the invariant rather than a workaround for the old inequality.
 *
 * @param identity - A resolved brand identity.
 */
export function rendersFirstPartyIdentity(
  identity: Pick<BrandIdentity, 'brandName' | 'legalEntity'>,
): boolean {
  return (
    identity.brandName === ESTALARA_BRAND_NAME && identity.legalEntity === ESTALARA_LEGAL_ENTITY
  );
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
 * Callers decide the consequence, because it differs by surface. There are THREE call sites, and
 * no two behave the same way — do not generalise from one to another [FOLLOW-699]:
 *   - `GET /api/v1/consent/platform-registration` REFUSES to serve mis-branded consent text
 *     (409 `brand_identity_not_provisioned`). Nothing is recorded; registration is blocked.
 *   - `POST /api/dsr/initiate` alerts but STILL SENDS — dropping a data subject's verification
 *     e-mail would obstruct a GDPR Art. 12/15 right, a worse compliance outcome than a
 *     mis-branded sender name.
 *   - `POST /api/v1/consent/platform-registration` is HYBRID, and its refusal is keyed on the
 *     EVIDENCE rather than on this predicate alone [FOLLOW-697]: it always alerts, but refuses
 *     (422 `consent_text_hash_fabricated`, nothing written) only for the sub-case it can prove
 *     wrong — a submitted hash equal to the canonical Estalara constant when the route can show
 *     that is not this tenant's text. Any other mismatching hash is WRITTEN plus alerted, because
 *     unverifiable is not the same as provably wrong (legitimate translated copy lives there).
 *     Note this write path must NOT refuse on an INDETERMINATE scope — see
 *     {@link classifyTenantBrandScope} and FOLLOW-698: this predicate's boolean fails CLOSED to
 *     "external", which is right for the two read/send paths above and wrong for a write that
 *     would discard the first-party tenant's genuine consent.
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
