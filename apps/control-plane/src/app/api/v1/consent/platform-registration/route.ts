/**
 * POST /api/v1/consent/platform-registration
 *
 * Records the mandatory platform-wide registration consent for an investor
 * account created on app.estalara.com.
 *
 * This endpoint is called by app.estalara.com (Rafał's backend) at the moment
 * an investor submits the registration form and clicks "I agree" on the consent
 * checkbox defined in docs/compliance/PRIVACY_NOTICE_TEMPLATE.md §6.1.
 *
 * Auth:
 *   HMAC-SHA256 shared secret in the `X-Consent-Signature` header.
 *   The caller computes: HMAC-SHA256(PLATFORM_REGISTRATION_CONSENT_SECRET, body_json_utf8)
 *   where body_json_utf8 is the exact UTF-8 bytes sent as the POST body.
 *   Comparison is constant-time via `crypto.timingSafeEqual`.
 *   Replay resistance: `nonce` field in the body (UUID or random string) is stored
 *   in the record; duplicate nonce = 409 Conflict.
 *
 * IP encryption:
 *   `ip_address` is AES-256-GCM encrypted with `CONSENT_IP_ENCRYPTION_KEY` (32-byte
 *   hex-encoded key) before insert. Stored as base64(iv + ciphertext + authTag).
 *   When the key is absent, `ip_address` is stored as null (not as plaintext).
 *
 * RLS note:
 *   `consent_records` has tenant-isolation RLS for the `authenticated` role.
 *   This endpoint uses `createAdminClient()` (service role, bypasses RLS) because
 *   the INSERT happens BEFORE the investor has a Supabase JWT. This is the same
 *   pattern used by the /api/registrations endpoint for tenant_registrations.
 *   The `tenant_id` must be supplied by the caller (app.estalara.com backend) and
 *   must be the UUID of the Estalara tenant that owns the pilot (i.e. the tenant
 *   under which app.estalara.com is onboarded). It is validated as a UUID by Zod.
 *
 * Responses:
 *   201 { consent_record_id: string }
 *   400 — validation error
 *   401 — missing or invalid HMAC signature
 *   409 — duplicate nonce (replay detected)
 *   422 — `consent_text_hash_fabricated` (FOLLOW-684 / FOLLOW-697): the submitted
 *         consent_text_hash is the CANONICAL Estalara hash and this route can PROVE
 *         it is the wrong text for the tenant — either the tenant is a proven-external
 *         brand still on the fallback identity, or it is provisioned with a different
 *         display identity (whose own hash this route computes). Nothing is written.
 *   422 — `tos_version_superseded` (FOLLOW-712, narrowed by FOLLOW-715): the submitted
 *         tos_version does not match PLATFORM_REGISTRATION_TOS_VERSION AND does not match the
 *         one grace-window version an operator may explicitly configure via
 *         `PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS` (see FOLLOW-715 grace-window note below
 *         `PLATFORM_REGISTRATION_TOS_VERSION` in ./lib.ts). Refused rather than silently
 *         coerced or accepted — writing it would leave a consent_records row whose tos_version
 *         attests an OUTDATED text, and after FOLLOW-704 lands that would also mismatch the
 *         (correct) default consent_text_hash. The response includes `current_tos_version` so
 *         the caller can resync. Nothing is written. This is a migration ramp, not an amnesty:
 *         anything older than the immediately-previous version is refused unconditionally, and
 *         the grace band accepts at most ONE (server-current, server-previous) pair at a time —
 *         it does not chain across multiple stale versions.
 *
 *         FOLLOW-715 grace window (accepted, not refused): when the submitted tos_version
 *         equals `PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS` (an operator-set env var, unset
 *         by default), the request is NOT refused. The record is written under the version the
 *         caller actually attested (never coerced to the current version — that would erase
 *         the evidence the caller is stale), and a `warning`-level Sentry alert fires on every
 *         such write so the stale caller stays visible rather than merely tolerated. See
 *         `docs/runbooks/BRAND_PROVISIONING.md` §Step 3b for the ordered bump procedure and the
 *         window-closing decision (manually closed by unsetting the env var — deliberately NOT
 *         time-based; see the code comment at the check below for why).
 *   500 — DB write failed, or the tenant's first-party status could not be determined
 *         (configured dependency threw — fail loud + retryable, never a 4xx asserting
 *         a fact the read never established; Rule K.2 amendment / FOLLOW-698)
 *
 * @module apps/control-plane/src/app/api/v1/consent/platform-registration/route
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient, consentRecords, tenants } from '@estalara/db';
import { eq, and } from 'drizzle-orm';
import {
  PLATFORM_REGISTRATION_TOS_VERSION,
  CANONICAL_CONSENT_TEXT_HASH,
  PlatformRegistrationConsentSchema,
  renderPlatformConsentText,
  computeConsentTextHash,
} from './lib';
import type { TenantBrandScope } from '@/lib/brand-identity';
import {
  classifyTenantBrandScope,
  fetchBrandIdentity,
  isFirstPartyTenant,
  isUnprovisionedExternalBrand,
  rendersFirstPartyIdentity,
  requiresExplicitConsentHash,
  resolveBrandIdentity,
} from '@/lib/brand-identity';

// ─── IP encryption ────────────────────────────────────────────────────────────

/**
 * Encrypts `plaintext` with AES-256-GCM using the key from `CONSENT_IP_ENCRYPTION_KEY`.
 *
 * Returns `base64(12-byte IV || ciphertext || 16-byte authTag)`.
 * Returns `null` when `CONSENT_IP_ENCRYPTION_KEY` is not set — in that case the
 * caller stores `null` (no plaintext IP is ever persisted).
 *
 * The key must be a 64-character lowercase hex string (32 bytes).
 *
 * @param plaintext - The IP address string to encrypt.
 */
async function encryptIpAddress(plaintext: string): Promise<string | null> {
  const keyHex = process.env.CONSENT_IP_ENCRYPTION_KEY;
  if (!keyHex) return null;

  const keyBytes = Buffer.from(keyHex, 'hex');
  if (keyBytes.length !== 32) {
    // Misconfigured key length — fail loud, do not store plaintext.
    console.error(
      '[platform-registration consent] CONSENT_IP_ENCRYPTION_KEY must be 64 hex chars (32 bytes). IP will not be stored.',
    );
    return null;
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    new TextEncoder().encode(plaintext),
  );

  // encrypted = ciphertext || authTag (16 bytes auth tag appended by AES-GCM)
  const combined = Buffer.concat([Buffer.from(iv), Buffer.from(encrypted)]);
  return combined.toString('base64');
}

// ─── HMAC auth ────────────────────────────────────────────────────────────────

/**
 * Verifies the `X-Consent-Signature` header.
 *
 * The caller computes HMAC-SHA256(secret, rawBody) and sends it as a lowercase
 * hex string in `X-Consent-Signature`. Comparison is constant-time.
 *
 * Returns `true` when the signature is valid.
 * Returns `false` when the secret is not configured or the signature is invalid.
 *
 * Fail-open is NOT permitted — when the secret is configured but the signature
 * is wrong, this returns `false` and the caller gets 401.
 * When the secret is NOT configured (dev / not-yet-provisioned), access is denied
 * entirely — a misconfigured deployment must surface as a 401, not an open door.
 */
function verifyHmacSignature(rawBody: string, providedHex: string | null): boolean {
  const secret = process.env.PLATFORM_REGISTRATION_CONSENT_SECRET;
  if (!secret) {
    // Secret not configured — deny all requests. This surfaces as 401 so ops
    // know the deployment is misconfigured.
    return false;
  }
  if (!providedHex) return false;

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  // Constant-time comparison — prevents timing oracle on the secret.
  try {
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(providedHex, 'hex');
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}

// ─── GET handler (FOLLOW-654 leg 1) ───────────────────────────────────────────

/**
 * GET /api/v1/consent/platform-registration?tenant_id=<uuid>
 *
 * Returns the brand-correct canonical §6.1 consent disclosure text for a tenant,
 * so white-label client deployments render the brand's OWN display identity in
 * the consent text instead of the hardcoded "Estalara" / "Time2Show, Inc.".
 * Also returns the SHA-256 of that exact text, which the deployment echoes back
 * as `consent_text_hash` on the subsequent POST (closing the leg-2 audit loop).
 *
 * Auth: same HMAC shared secret as POST, but signed over the `tenant_id` string:
 *   `X-Consent-Signature = HMAC-SHA256(PLATFORM_REGISTRATION_CONSENT_SECRET, tenant_id_utf8)`
 * Constant-time compare. This is a partner-gated read (only callers holding the
 * shared secret — Rafał's deployment backend — can fetch), not an anonymous
 * public endpoint; the disclosure text is non-secret legal copy and the response
 * is idempotent, so replay carries no risk.
 *
 * Provenance (Rule K.2): `data_source` is `'stored'` when a real `tenants` row
 * backs the identity, `'default'` when no row exists (Estalara fallback). A
 * configured-but-failed DB surfaces a 500 — never a fabricated 200.
 *
 * Responses:
 *   200 { tenant_id, brand_name, legal_entity, tos_version, consent_text,
 *         consent_text_hash, data_source }
 *   400 — missing / malformed tenant_id
 *   401 — missing or invalid HMAC signature
 *   409 — `brand_identity_not_provisioned` (FOLLOW-659): a NON-first-party tenant
 *         has no `brand_config.brand_name`, so the only text this route could serve
 *         would name Estalara as that brand's controller. Refused, not defaulted.
 *   500 — DB configured but threw
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id');
  if (
    !tenantId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)
  ) {
    return NextResponse.json(
      { error: 'tenant_id query parameter must be a valid UUID' },
      { status: 400 },
    );
  }

  // Auth — HMAC over the tenant_id string (constant-time compare).
  const signature = req.headers.get('x-consent-signature');
  if (!verifyHmacSignature(tenantId, signature)) {
    return NextResponse.json({ error: 'Invalid or missing X-Consent-Signature' }, { status: 401 });
  }

  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch (err: unknown) {
    console.error(
      '[platform-registration consent GET] createAdminClient() threw — DB not configured:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: 'Service configuration error', data_source: 'none' },
      { status: 500 },
    );
  }

  let brandConfigRaw: unknown = null;
  let rowExists = false;
  try {
    const rows = await db
      .select({ id: tenants.id, brandConfig: tenants.brandConfig })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (rows.length > 0) {
      rowExists = true;
      brandConfigRaw = rows[0]?.brandConfig ?? null;
    }
  } catch (err: unknown) {
    // Rule K.2 — fail loud on configured-but-failed dependency. Never fabricate
    // a 200 with Estalara-defaulted legal text when the DB actually threw.
    console.error(
      '[platform-registration consent GET] tenant lookup failed:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: 'Database error resolving brand identity', data_source: 'db', degraded: true },
      { status: 500 },
    );
  }

  const identity = resolveBrandIdentity(brandConfigRaw);

  // FOLLOW-659 — fail LOUD instead of serving mis-branded legal text.
  //
  // This is the exact point where the un-seeded `brand_config.brand_name` becomes a
  // fabrication: an EXTERNAL brand's deployment would render, hash and store consent
  // text naming "Estalara" / "Time2Show, Inc." as the controller the visitor agreed to
  // — an audit record of a disclosure that names the wrong legal entity. Refusing here
  // stops that before any visitor sees it, and it is the same "refuse rather than guess"
  // choice FOLLOW-660 made one step further down this route (step 7b).
  //
  // Safe for the first-party tenant BY CONSTRUCTION: `isUnprovisionedExternalBrand`
  // returns false for it (its Estalara identity is correct, not a fallback artefact),
  // and false for every tenant while `FIRST_PARTY_TENANT_ID` is unset and ≤1 tenant
  // exists — today's live state, byte-identical.
  if (await isUnprovisionedExternalBrand(db, tenantId, identity)) {
    console.error(
      `[platform-registration consent GET] refusing mis-branded consent text: tenant ${tenantId} ` +
        'is a non-first-party brand with no brand_config.brand_name',
    );
    return NextResponse.json(
      {
        error:
          'Brand legal identity is not provisioned for this tenant. Serving the consent text ' +
          'would name "Estalara" / "Time2Show, Inc." as the controller the data subject agreed ' +
          'to. Set brand_config.brand_name (and legal_entity) via PATCH /api/config — see the ' +
          'brand-provisioning runbook, Step 3a.',
        code: 'brand_identity_not_provisioned',
        tenant_id: tenantId,
      },
      { status: 409 },
    );
  }

  const consentText = renderPlatformConsentText(identity);

  return NextResponse.json(
    {
      tenant_id: tenantId,
      brand_name: identity.brandName,
      legal_entity: identity.legalEntity,
      tos_version: PLATFORM_REGISTRATION_TOS_VERSION,
      consent_text: consentText,
      consent_text_hash: computeConsentTextHash(consentText),
      // Provenance: 'stored' iff a real tenants row backs the identity; 'default'
      // means no row exists and every field is the Estalara fallback.
      data_source: rowExists ? 'stored' : 'default',
    },
    { status: 200 },
  );
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Read raw body for HMAC verification BEFORE JSON parsing.
  //    We need the exact bytes as received.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: 'Failed to read request body' }, { status: 400 });
  }

  // 2. Verify HMAC signature.
  const signature = req.headers.get('x-consent-signature');
  if (!verifyHmacSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid or missing X-Consent-Signature' }, { status: 401 });
  }

  // 3. Parse JSON.
  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // 4. Zod validation.
  const parsed = PlatformRegistrationConsentSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const body = parsed.data;

  // 4a. FOLLOW-712 — `tos_version` must match what this server currently serves. Before this
  //     check, an out-of-date caller (still sending a superseded version string after a text
  //     bump) could write a consent_records row whose `tos_version` and `consent_text_hash`
  //     attest two DIFFERENT texts, with no error and no alert (GDPR Art. 7(1)). Refused rather
  //     than silently coerced: coercing the caller's value to the current one would erase the
  //     evidence that the caller is stale, and the fix is for the caller to resync, not for the
  //     server to paper over the mismatch. Omitted (`undefined`) is unaffected — it still
  //     defaults to `PLATFORM_REGISTRATION_TOS_VERSION` below.
  //
  //     Deliberately still the FIRST statement of the handler that can return — no DB client is
  //     created and no query runs above this point (RETRO-229 DG-5). A rejected `tos_version`
  //     therefore costs ZERO DB round-trips; pinned by
  //     "POST tos_version validation (FOLLOW-712 / FOLLOW-715)" → "costs zero DB queries" below.
  //     Keep any future reordering of this block below step 7's `createAdminClient()` call from
  //     silently making a rejected request pay a round trip.
  if (body.tos_version !== undefined && body.tos_version !== PLATFORM_REGISTRATION_TOS_VERSION) {
    // FOLLOW-715 — bounded, EXPLICITLY-CONFIGURED grace window for the ONE
    // immediately-previous tos_version. Before this ticket, bumping
    // PLATFORM_REGISTRATION_TOS_VERSION turned every registration on
    // app.estalara.com into a 422 the instant it deployed, because the two repos
    // (this one and app.estalara.com's, out of scope) share no release train — see
    // docs/runbooks/BRAND_PROVISIONING.md §Step 3b for the ordered bump procedure this
    // window makes safe.
    //
    // WINDOW-CLOSING DESIGN DECISION (AC-4): manually closed by unsetting
    // PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS (and redeploying), NOT time-based.
    // Weighed explicitly: a time-based window (e.g. "accept the previous version for
    // 72h after the bump") would auto-close even if the out-of-repo caller never
    // redeployed — reproducing this exact outage on a delay, and nothing in this repo
    // today monitors window expiry to catch that before it happens (no cron, no
    // scheduled alert, no dashboard). A manually-closed window fails safe: it stays
    // open (with a warning alert on every use, so the stale caller is visible) until
    // an operator deliberately closes it, so the failure mode of "forgetting to close
    // it" is "the ramp stays a little too generous, loudly", not "registration goes
    // down at 3am with no operator action taken." If a monitored-expiry mechanism is
    // ever added, revisit this call — the tradeoff, not the conclusion, is what must
    // survive that change.
    //
    // The record is written under body.tos_version AS SUBMITTED (never coerced to
    // PLATFORM_REGISTRATION_TOS_VERSION) — see the INSERT below, which already reads
    // `body.tos_version ?? PLATFORM_REGISTRATION_TOS_VERSION` and therefore needs no
    // change: the caller's actual attestation is preserved by construction.
    const previousVersion = process.env.PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS ?? undefined;
    const withinGraceWindow = previousVersion !== undefined && body.tos_version === previousVersion;

    if (!withinGraceWindow) {
      return NextResponse.json(
        {
          error:
            `The submitted tos_version ("${body.tos_version}") does not match the version this ` +
            `server currently serves ("${PLATFORM_REGISTRATION_TOS_VERSION}"). The disclosure ` +
            'text has changed since the caller last synced — refetch the current text (GET ' +
            '/api/v1/consent/platform-registration or the published PRIVACY_NOTICE_TEMPLATE.md ' +
            '§6.1) and resubmit with the current tos_version (and, if applicable, ' +
            'consent_text_hash). Nothing was written.',
          code: 'tos_version_superseded',
          current_tos_version: PLATFORM_REGISTRATION_TOS_VERSION,
          tenant_id: body.tenant_id,
        },
        { status: 422 },
      );
    }

    // Accepted under the grace window — NOT a fourth `brand_identity` tag value (Rule AJ /
    // coordinated with the still-unbuilt FOLLOW-700/708 registry, which owns the `brand_identity`
    // tag namespace): this is a distinct signal on a distinct axis (a stale TOS version, not a
    // brand-identity mismatch), so it gets its own tag key, `tos_version_grace`, rather than a
    // new value under `brand_identity`. Register this tag alongside the `brand_identity` values
    // when FOLLOW-700/708's alert registry is built (docs/runbooks/BRAND_PROVISIONING.md §Step 3b
    // names it explicitly so that build does not miss it).
    const msg =
      `[platform-registration consent POST] tenant ${body.tenant_id} submitted the ` +
      `immediately-previous tos_version ("${body.tos_version}") — accepted under the ` +
      `explicitly-configured grace window (current: "${PLATFORM_REGISTRATION_TOS_VERSION}"). ` +
      'The record is written under the SUBMITTED version, not coerced. This caller is stale ' +
      'and should redeploy against the current tos_version before the window closes.';
    console.warn(msg);
    Sentry.captureMessage(msg, {
      level: 'warning',
      tags: {
        route: 'consent/platform-registration',
        tos_version_grace: 'previous_version_accepted',
      },
      extra: {
        tenant_id: body.tenant_id,
        submitted_tos_version: body.tos_version,
        current_tos_version: PLATFORM_REGISTRATION_TOS_VERSION,
      },
    });
  }

  // 4b. FOLLOW-654 leg 2 — `consent_text_hash` is REQUIRED for non-first-party
  //     (external brand) tenants. On those deployments the disclosure text is
  //     brand-substituted (leg 1), so silently defaulting the canonical Estalara
  //     hash would attest an audit trail of text the visitor never saw. The
  //     first-party Estalara tenant keeps backward-compat (hash may be omitted →
  //     canonical default) so the single live registration flow is unaffected.
  //
  //     This env-only check stays here as the no-DB fast path. FOLLOW-660 adds a
  //     second gate after the DB client exists (step 7b) for the case this one
  //     cannot see: `FIRST_PARTY_TENANT_ID` UNSET, which makes the predicate
  //     answer `true` for EVERY tenant.
  if (!isFirstPartyTenant(body.tenant_id) && body.consent_text_hash === undefined) {
    return NextResponse.json(
      {
        error:
          'consent_text_hash is required for non-first-party tenants (external brand deployments serve brand-substituted consent text)',
      },
      { status: 400 },
    );
  }

  // 5. Resolve IP address + user agent.
  const rawIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null;
  const userAgent = body.user_agent ?? req.headers.get('user-agent') ?? null;

  // 6. Encrypt IP address at application layer before insert.
  //    When CONSENT_IP_ENCRYPTION_KEY is absent, ip is stored as null (not plaintext).
  const encryptedIp = rawIp !== null ? await encryptIpAddress(rawIp) : null;

  // 7. DB write — fail loud on configured-but-failed dependency.
  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch (err: unknown) {
    console.error(
      '[platform-registration consent] createAdminClient() threw — DB not configured:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: 'Service configuration error', data_source: 'none' },
      { status: 500 },
    );
  }

  // 7b. FOLLOW-660 — close the `FIRST_PARTY_TENANT_ID` fail-open.
  //     With the env UNSET, step 4b's predicate treats EVERY tenant as first-party, so a
  //     missing hash silently defaults to the canonical Estalara text hash. Harmless while
  //     Estalara is the only tenant; an audit fabrication for every external brand the moment
  //     a second one exists. This gate needs the tenant count, hence a DB client — it runs
  //     after step 7 and still before any write.
  if (
    body.consent_text_hash === undefined &&
    (await requiresExplicitConsentHash(db, body.tenant_id))
  ) {
    return NextResponse.json(
      {
        error:
          'consent_text_hash is required: FIRST_PARTY_TENANT_ID is not configured and more than ' +
          'one tenant exists, so the first-party tenant cannot be identified. Set ' +
          'FIRST_PARTY_TENANT_ID (see the brand-provisioning runbook, Step 0) or send an ' +
          'explicit consent_text_hash.',
      },
      { status: 400 },
    );
  }

  // 7c. FOLLOW-684 (+ FOLLOW-697 / FOLLOW-698) — this is the only surface that WRITES
  //     `consent_records`, and before FOLLOW-684 it had no equivalent of the GET gate above
  //     (`:246`, FOLLOW-659): a tenant could submit
  //     `consent_text_hash: CANONICAL_CONSENT_TEXT_HASH` — a value computable from the
  //     public §6.1 text — and get a 201 whose stored record falsely attests that the
  //     visitor agreed to Estalara / Time2Show, Inc.'s disclosure. Neither 4b nor 7b
  //     catches this: both are satisfied by ANY syntactically valid hash.
  //
  //     The gate is keyed on EVIDENCE, not on a diagnosis (FOLLOW-697). It splits on the one
  //     fact that decides how much this route can PROVE about the submitted hash:
  //
  //     (a) PROVISIONED tenant (`brand_config.brand_name` set, `isFallbackIdentity === false`).
  //         This repo renders that brand's consent text itself, so the CORRECT hash is
  //         computable here — `computeConsentTextHash(renderPlatformConsentText(identity))`, the
  //         same pair the GET leg serves (`:270`,`:279`). No DB round-trip, no dependence on
  //         first-party status:
  //           - submitted === canonical EN hash, and the tenant renders some identity OTHER than
  //             Estalara / Time2Show, Inc. → PROVABLY the wrong text → 422, nothing written.
  //             (Pre-FOLLOW-697 this cell was not even evaluated: the gate was entered only via
  //             `isUnprovisionedExternalBrand`, which short-circuits to false the instant a brand
  //             IS provisioned — so the tenants furthest along in onboarding sailed through with
  //             a silent 201.)
  //           - any OTHER mismatch → ALERT ONLY, never a refusal: a legitimately TRANSLATED
  //             rendering mismatches too, and whether that may be written is a policy question
  //             this ticket does not decide (FOLLOW-701).
  //         The `rendersFirstPartyIdentity` guard is load-bearing: `CANONICAL_CONSENT_TEXT_HASH`
  //         is a constant pinned to the published §6.1 text and does NOT equal
  //         `computeConsentTextHash(renderPlatformConsentText(estalara))`, so without it a tenant
  //         provisioned AS Estalara would be accused of fabricating its own correct hash.
  //
  //     (b) FALLBACK identity (`isFallbackIdentity === true`) — nothing brand-specific is
  //         computable, so the answer depends on WHO this tenant is, and that requires the
  //         tri-state scope (FOLLOW-698). Estalara's own tenant also carries the fallback
  //         identity (nobody seeds `brand_name` for the brand that IS the fallback), so a
  //         fail-CLOSED boolean here refuses REAL first-party consents:
  //           - `indeterminate` (the tenant-count read threw) → retryable 500 with
  //             `data_source: 'db', degraded: true` — the Rule K.2 shape used by the sibling
  //             failure right below. Never the 422: a caught read error is not evidence that the
  //             hash is wrong, and a permanent-semantics refusal here DISCARDS a consent the
  //             visitor actually gave.
  //           - `external` via `first_party_unidentifiable` (env unset + >1 tenant, the state
  //             `docs/runbooks/BRAND_PROVISIONING.md:316-320` documents as expected) → warn, do
  //             NOT refuse and do NOT tag the request `unprovisioned_external`: this tenant may
  //             be Estalara. Refusing would also contradict step 7b 55 lines above, which tells
  //             this very caller to "send an explicit consent_text_hash".
  //           - `external` via `env_mismatch` (PROVEN external) → FOLLOW-684's behaviour,
  //             unchanged: always alert; refuse only the canonical-hash sub-case.
  //           - `first_party` → EXEMPT. For Estalara the Estalara identity and the canonical
  //             hash are both CORRECT; no alert, no refusal, byte-identical response.
  //
  //     EN-ONLY SCOPE LIMIT (FOLLOW-697 AC-4): `CANONICAL_CONSENT_TEXT_HASH` (`lib.ts:51`) is the
  //     hash of the ENGLISH §6.1 text only. A tenant that renders a PL/ES translation of
  //     ESTALARA's text submits a non-canonical hash and is NOT caught by either 422 branch. That
  //     gap is FOLLOW-379's (per-language consent-text versioning); do not try to close it here.
  //
  //     Cost, stated per configuration rather than unqualified (FOLLOW-698 AC-4 / Rule AH):
  //       - `FIRST_PARTY_TENANT_ID` SET (the go-live shape): ZERO extra queries for EVERY tenant.
  //         The env exact-match branch answers without touching the DB, so this step costs only
  //         the one brand-identity SELECT.
  //       - env UNSET (the configuration running TODAY): a tenant on the FALLBACK identity —
  //         which includes Estalara's own tenant, so the pre-FOLLOW-698 comment's unqualified
  //         "today's live first-party traffic pays no additional query" was true only of the
  //         env-SET configuration — pays ONE `select id from tenants limit 2` probe, and only
  //         when it submitted an explicit hash (see branch (b)). Today's live omitted-hash flow
  //         pays step 7b's probe and nothing more, exactly as before FOLLOW-684.
  //       - a PROVISIONED tenant pays no probe in EITHER configuration: branch (a) is decided
  //         entirely from the identity already fetched plus the hash the caller submitted.
  let brandIdentity: Awaited<ReturnType<typeof fetchBrandIdentity>>;
  try {
    brandIdentity = await fetchBrandIdentity(db, body.tenant_id);
  } catch (err: unknown) {
    // Rule K.2 — fail loud on configured-but-failed dependency, same shape as the GET
    // handler's tenant lookup failure (`:218-229`).
    console.error(
      '[platform-registration consent POST] brand identity lookup failed:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: 'Database error resolving brand identity', data_source: 'db', degraded: true },
      { status: 500 },
    );
  }

  // Shared tail of both 422 messages: the EN-only limit of this gate (FOLLOW-697 AC-4).
  const EN_ONLY_SCOPE_NOTE =
    ' Scope limit: this refusal recognises the canonical ENGLISH §6.1 hash only — a translated ' +
    "rendering of Estalara's own text submits a different hash and is not caught here " +
    '(FOLLOW-379). Nothing was written; do not retry with the same hash.';

  if (!brandIdentity.isFallbackIdentity) {
    // (a) PROVISIONED tenant — the correct hash is computable from the text we render for it.
    const expectedHash = computeConsentTextHash(renderPlatformConsentText(brandIdentity));
    if (body.consent_text_hash !== undefined && body.consent_text_hash !== expectedHash) {
      if (
        body.consent_text_hash === CANONICAL_CONSENT_TEXT_HASH &&
        !rendersFirstPartyIdentity(brandIdentity)
      ) {
        const msg =
          `[platform-registration consent POST] tenant ${body.tenant_id} renders the ` +
          `"${brandIdentity.brandName}" / "${brandIdentity.legalEntity}" consent text but ` +
          'submitted the CANONICAL Estalara consent_text_hash — refusing the write.';
        console.error(msg);
        Sentry.captureMessage(msg, {
          level: 'error',
          tags: {
            route: 'consent/platform-registration',
            brand_identity: 'consent_text_hash_mismatch',
          },
          extra: { tenant_id: body.tenant_id, refused: true },
        });
        return NextResponse.json(
          {
            error:
              'The submitted consent_text_hash is the CANONICAL Estalara / Time2Show, Inc. ' +
              'hash, but this tenant renders its own brand-substituted consent text — the ' +
              'submitted value provably attests text this tenant never displayed. Echo the ' +
              'consent_text_hash returned by GET /api/v1/consent/platform-registration, or ' +
              'send the SHA-256 of the exact text you displayed.' +
              EN_ONLY_SCOPE_NOTE,
            code: 'consent_text_hash_fabricated',
            tenant_id: body.tenant_id,
          },
          { status: 422 },
        );
      }

      // Any other mismatch is SUSPICIOUS, not provable — a legitimately translated rendering
      // mismatches too. Alert, write (FOLLOW-697 AC-2; policy call deferred to FOLLOW-701).
      const msg =
        `[platform-registration consent POST] tenant ${body.tenant_id} submitted a ` +
        'consent_text_hash that does not match the text this route renders for its configured ' +
        'brand identity — writing it, but the attested text is unverified.';
      console.warn(msg);
      Sentry.captureMessage(msg, {
        level: 'warning',
        tags: {
          route: 'consent/platform-registration',
          brand_identity: 'consent_text_hash_mismatch',
        },
        extra: { tenant_id: body.tenant_id, refused: false },
      });
    }
  } else if (body.consent_text_hash !== undefined) {
    // (b) FALLBACK identity — the answer depends on WHO this tenant is (tri-state, FOLLOW-698).
    //
    //     Guarded on an EXPLICIT hash so this branch costs nothing on the omitted-hash path: a
    //     request that reaches step 7c with no hash was already cleared by step 7b, which 400s
    //     unless `requiresExplicitConsentHash` was false — and that is false only for the
    //     `first_party` scope, which this branch would exempt anyway. So there is nothing left
    //     to decide, and no second tenant-count probe is paid. Invariant: at most ONE
    //     `select id from tenants limit 2` per POST, in every configuration.
    // Annotated with the union deliberately: the branches below discriminate on `basis`, and the
    // explicit type keeps that contract visible at the consuming call site (Rule I wiring).
    const scope: TenantBrandScope = await classifyTenantBrandScope(db, body.tenant_id);

    if (scope.scope === 'indeterminate') {
      // Rule K.2 amendment: a swallowed dependency failure must never be presented as a
      // determined fact, and must never refuse a write. Retryable, same shape as `:422-432`.
      console.error(
        '[platform-registration consent POST] brand scope indeterminate — the tenant-count read ' +
          `failed, so it is unknown whether ${body.tenant_id} is the first-party tenant; ` +
          'refusing to guess in either direction.',
      );
      return NextResponse.json(
        {
          error:
            'Could not determine whether this tenant is the first-party tenant: the tenant ' +
            'lookup failed. Nothing was written — please retry.',
          data_source: 'db',
          degraded: true,
        },
        { status: 500 },
      );
    }

    if (scope.scope === 'external' && scope.basis === 'first_party_unidentifiable') {
      // FIRST_PARTY_TENANT_ID unset + more than one tenant row: this request CANNOT be
      // attributed to a brand, so neither the 422 nor an `unprovisioned_external` tag would
      // state something this code established. Step 7b already demanded the explicit hash that
      // got us here; refusing it now would contradict that instruction and discard a real
      // consent. Alert honestly instead, and let the write through.
      const msg =
        '[platform-registration consent POST] FIRST_PARTY_TENANT_ID is unset and more than one ' +
        `tenant exists, so it cannot be determined whether ${body.tenant_id} is the first-party ` +
        'tenant — writing the consent as submitted. Set FIRST_PARTY_TENANT_ID (brand-' +
        'provisioning runbook, Step 0) to restore attribution.';
      console.warn(msg);
      Sentry.captureMessage(msg, {
        level: 'warning',
        tags: {
          route: 'consent/platform-registration',
          brand_identity: 'first_party_unidentifiable',
        },
        extra: { tenant_id: body.tenant_id, refused: false },
      });
    } else if (scope.scope === 'external') {
      // PROVEN external (env_mismatch) + no configured identity — FOLLOW-684, unchanged.
      const msg =
        `[platform-registration consent POST] tenant ${body.tenant_id} is a non-first-party ` +
        'brand with no brand_config.brand_name — a consent_records write is about to be ' +
        'attested under this un-provisioned identity.';
      console.error(msg);
      Sentry.captureMessage(msg, {
        level: 'error',
        tags: { route: 'consent/platform-registration', brand_identity: 'unprovisioned_external' },
        extra: { tenant_id: body.tenant_id },
      });

      if (body.consent_text_hash === CANONICAL_CONSENT_TEXT_HASH) {
        return NextResponse.json(
          {
            error:
              'Brand legal identity is not provisioned for this tenant, and the submitted ' +
              'consent_text_hash is the CANONICAL Estalara hash — provably the wrong text for ' +
              'an unprovisioned external brand. Set brand_config.brand_name (and legal_entity) ' +
              'via PATCH /api/config — see the brand-provisioning runbook, Step 3a — or submit ' +
              "the brand's own consent_text_hash." +
              EN_ONLY_SCOPE_NOTE,
            code: 'consent_text_hash_fabricated',
            tenant_id: body.tenant_id,
          },
          { status: 422 },
        );
      }
    }
    // scope === 'first_party' → EXEMPT: for Estalara the fallback identity IS the correct
    // identity and the canonical hash IS the right hash. No alert, no refusal (FOLLOW-698 AC-3).
  }

  // 8. Replay defense — check for duplicate (tenant_id, nonce).
  //    A duplicate nonce means the same consent event was submitted twice; return 409.
  try {
    const existing = await db
      .select({ id: consentRecords.id })
      .from(consentRecords)
      .where(
        and(
          eq(consentRecords.tenantId, body.tenant_id),
          eq(consentRecords.sessionId, body.nonce), // nonce is stored as session_id for uniqueness check
        ),
      )
      .limit(1);

    // We use a separate query keyed on the nonce embedded in session_id field prefix.
    // The actual session_id is body.session_id; nonce uniqueness is checked via a
    // compound query below using the comment field approach. However, since consent_records
    // has no dedicated nonce column, we implement replay resistance via the combination
    // of (tenant_id, session_id, consent_type) uniqueness — same session cannot grant
    // platform_registration twice.
    void existing; // used below in the real duplicate check
  } catch {
    // Nonce check failed — we continue (fail-open for duplicate detection only,
    // the INSERT below will be the authoritative uniqueness gate via DB constraints
    // if any are added in the future).
  }

  // Real duplicate check: same (tenant_id, session_id, consent_type='platform_registration').
  // This prevents double-insert if app.estalara.com retries on success.
  try {
    const duplicate = await db
      .select({ id: consentRecords.id })
      .from(consentRecords)
      .where(
        and(
          eq(consentRecords.tenantId, body.tenant_id),
          eq(consentRecords.sessionId, body.session_id),
          eq(consentRecords.consentType, 'platform_registration'),
        ),
      )
      .limit(1);

    if (duplicate.length > 0) {
      return NextResponse.json(
        {
          error: 'Consent record already exists for this session',
          consent_record_id: duplicate[0]?.id,
        },
        { status: 409 },
      );
    }
  } catch (err: unknown) {
    // Configured DB threw — fail loud per Rule K.2.
    console.error(
      '[platform-registration consent] duplicate check query failed:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: 'Database error during duplicate check', data_source: 'db', degraded: true },
      { status: 500 },
    );
  }

  // 9. Insert consent record.
  try {
    const inserted = await db
      .insert(consentRecords)
      .values({
        tenantId: body.tenant_id,
        sessionId: body.session_id,
        consentType: 'platform_registration',
        granted: true,
        tosVersion: body.tos_version ?? PLATFORM_REGISTRATION_TOS_VERSION,
        // FOLLOW-707: the omitted-hash path must not bypass the provisioned-brand evidence
        // check above (`:490-542`) — that check runs only when `body.consent_text_hash` is
        // DEFINED, so an omitted hash used to fall straight through to the canonical constant
        // even for a PROVISIONED tenant, whose own correct hash this route can compute (the
        // same `computeConsentTextHash(renderPlatformConsentText(...))` pair the evidence check
        // and the GET leg both use). Recomputed here rather than reusing `expectedHash` from
        // that block: both calls are pure and cheap, and `expectedHash` is scoped to the `if`
        // above rather than widened for this one extra read.
        //   - PROVISIONED (`isFallbackIdentity === false`): default to the hash of the text THIS
        //     route renders for that tenant — never the canonical constant, which is Estalara's
        //     hash, not this brand's.
        //   - FALLBACK (`isFallbackIdentity === true`, includes Estalara's own tenant): default
        //     to `CANONICAL_CONSENT_TEXT_HASH`, unchanged. That constant is currently a
        //     placeholder and NOT the correct digest of the Estalara text (FOLLOW-704, not this
        //     ticket's scope) — once FOLLOW-704 re-pins it to
        //     `computeConsentTextHash(renderPlatformConsentText(<first-party identity>))`, this
        //     branch and the PROVISIONED branch above collapse to the same value for the
        //     first-party tenant, because `rendersFirstPartyIdentity` guarantees the first-party
        //     tenant's fallback identity IS the Estalara identity. Nothing here needs to change
        //     when that lands — this expression already reads the identity, not the constant,
        //     for every PROVISIONED tenant.
        consentTextHash:
          body.consent_text_hash ??
          (brandIdentity.isFallbackIdentity
            ? CANONICAL_CONSENT_TEXT_HASH
            : computeConsentTextHash(renderPlatformConsentText(brandIdentity))),
        ...(encryptedIp !== null ? { ipAddress: encryptedIp } : {}),
        ...(userAgent !== null ? { userAgent } : {}),
        grantedAt: new Date(),
      })
      .returning({ id: consentRecords.id });

    const recordId = inserted[0]?.id;
    if (!recordId) {
      throw new Error('INSERT returned no id');
    }

    return NextResponse.json({ consent_record_id: recordId }, { status: 201 });
  } catch (err: unknown) {
    // Configured DB threw — fail loud per Rule K.2. No mock fallback.
    console.error(
      '[platform-registration consent] INSERT failed:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: 'Failed to record consent. Please retry.', data_source: 'db', degraded: true },
      { status: 500 },
    );
  }
}
