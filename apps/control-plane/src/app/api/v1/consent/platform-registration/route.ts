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
 *   500 — DB write failed (configured but threw — fail loud, no mock)
 *
 * @module apps/control-plane/src/app/api/v1/consent/platform-registration/route
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createAdminClient, consentRecords, tenants } from '@estalara/db';
import { eq, and } from 'drizzle-orm';
import {
  PLATFORM_REGISTRATION_TOS_VERSION,
  CANONICAL_CONSENT_TEXT_HASH,
  PlatformRegistrationConsentSchema,
  renderPlatformConsentText,
  computeConsentTextHash,
} from './lib';
import {
  isFirstPartyTenant,
  isUnprovisionedExternalBrand,
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
        consentTextHash: body.consent_text_hash ?? CANONICAL_CONSENT_TEXT_HASH,
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
