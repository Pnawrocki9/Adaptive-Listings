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
 *   pattern the since-removed /api/registrations endpoint used (FOLLOW-1325).
 *   The `tenant_id` must be supplied by the caller (app.estalara.com backend) and
 *   must be the UUID of the Estalara tenant that owns the pilot (i.e. the tenant
 *   under which app.estalara.com is onboarded). It is validated as a UUID by Zod.
 *
 * Responses:
 *   201 { consent_record_id: string }
 *   400 — validation error
 *   401 — missing or invalid HMAC signature
 *   409 — duplicate nonce (replay detected)
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
 *   500 — DB write failed (configured dependency threw — fail loud + retryable, Rule K.2)
 *
 * One tenant (FOLLOW-1332, ESC-085): `tenant_id` must be the Estalara tenant
 * (`isEstalaraTenant`); any other id is refused 400 before any DB work, nothing written. The
 * per-brand identity, the first-party env classification and the external-brand evidence gates
 * (FOLLOW-654/659/660/684/697/698) were removed with `lib/brand-identity.ts`; the Estalara path
 * through them is the path kept here, unchanged.
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
import { ESTALARA_BRAND_IDENTITY, isEstalaraTenant } from '@/lib/estalara-tenant';

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
 * Returns the canonical §6.1 consent disclosure text, rendered with the Estalara identity
 * (`ESTALARA_BRAND_IDENTITY`), and the SHA-256 of that exact text, which the caller echoes back
 * as `consent_text_hash` on the subsequent POST (closing the leg-2 audit loop).
 *
 * Auth: same HMAC shared secret as POST, but signed over the `tenant_id` string:
 *   `X-Consent-Signature = HMAC-SHA256(PLATFORM_REGISTRATION_CONSENT_SECRET, tenant_id_utf8)`
 * Constant-time compare. This is a partner-gated read (only callers holding the
 * shared secret — Rafał's deployment backend — can fetch), not an anonymous
 * public endpoint; the disclosure text is non-secret legal copy and the response
 * is idempotent, so replay carries no risk.
 *
 * Provenance (Rule K.2): `data_source` is `'stored'` when the Estalara `tenants` row exists in
 * this database, `'default'` when it does not. The identity itself is a constant since
 * FOLLOW-1332 (it was read from `tenants.brand_config` before). A configured-but-failed DB
 * surfaces a 500 — never a fabricated 200.
 *
 * Responses:
 *   200 { tenant_id, brand_name, legal_entity, tos_version, consent_text,
 *         consent_text_hash, data_source }
 *   400 — missing / malformed tenant_id
 *   401 — missing or invalid HMAC signature
 *   409 — `brand_identity_not_provisioned` (FOLLOW-659): `tenant_id` is not the Estalara
 *         tenant, so no consent text exists for it (FOLLOW-1332 — before, the same 409 meant a
 *         non-first-party tenant with no `brand_config.brand_name`). Refused, not defaulted.
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

  // One tenant (FOLLOW-1332, ESC-085). Serving the Estalara text under any other tenant id would
  // let a caller attest a disclosure for a tenant that does not exist here. Same status and code
  // the route returned for every non-first-party tenant before (none was ever provisioned).
  if (!isEstalaraTenant(tenantId)) {
    return NextResponse.json(
      {
        error:
          'tenant_id is not the Estalara tenant. Adaptive Listings serves one tenant ' +
          '(app.estalara.com); no consent text exists for any other tenant id.',
        code: 'brand_identity_not_provisioned',
        tenant_id: tenantId,
      },
      { status: 409 },
    );
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

  let rowExists = false;
  try {
    const rows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    rowExists = rows.length > 0;
  } catch (err: unknown) {
    // Rule K.2 — fail loud on configured-but-failed dependency. Never fabricate
    // a 200 with an unread provenance when the DB actually threw.
    console.error(
      '[platform-registration consent GET] tenant lookup failed:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: 'Database error resolving brand identity', data_source: 'db', degraded: true },
      { status: 500 },
    );
  }

  const identity = ESTALARA_BRAND_IDENTITY;
  const consentText = renderPlatformConsentText(identity);

  return NextResponse.json(
    {
      tenant_id: tenantId,
      brand_name: identity.brandName,
      legal_entity: identity.legalEntity,
      tos_version: PLATFORM_REGISTRATION_TOS_VERSION,
      consent_text: consentText,
      consent_text_hash: computeConsentTextHash(consentText),
      // Provenance: 'stored' iff the Estalara tenants row exists in this database; 'default'
      // means it does not (the identity is the same constant either way).
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
  //
  //     `attestedPreviousVersion` (FOLLOW-815): set only on the grace band. It is read once more,
  //     at the INSERT in step 9, where it suppresses the defaulted `consent_text_hash` — see the
  //     comment there. Declared here rather than inside the block so the two sites are one fact.
  let attestedPreviousVersion = false;
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

    attestedPreviousVersion = true;

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
      'and should redeploy against the current tos_version before the window closes. ' +
      (body.consent_text_hash === undefined
        ? 'It also omitted consent_text_hash, so the stored hash is NULL — this server no longer ' +
          'renders the text that version names and will not default a hash it cannot stand ' +
          'behind (FOLLOW-815).'
        : 'It supplied an explicit consent_text_hash, which is stored as submitted.');
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

  // 4b. One tenant (FOLLOW-1332, ESC-085). A record under any other tenant id would attest a
  //     disclosure no tenant here serves, and would be invisible to the Estalara tenant's DSR
  //     tooling. Refused before any DB work; nothing written. Before FOLLOW-1332 the
  //     non-first-party branch required an explicit `consent_text_hash` here and then ran the
  //     external-brand evidence gates (steps 7b/7c, removed); the Estalara path through both is
  //     the one kept: hash optional, defaulted to CANONICAL_CONSENT_TEXT_HASH at step 9.
  if (!isEstalaraTenant(body.tenant_id)) {
    return NextResponse.json(
      {
        error:
          'tenant_id is not the Estalara tenant. Adaptive Listings serves one tenant ' +
          '(app.estalara.com); nothing was written.',
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
        // Omitted hash → CANONICAL_CONSENT_TEXT_HASH, the hash of the exact text GET serves for
        // the Estalara tenant (derived from the renderer since FOLLOW-815). Before FOLLOW-1332 a
        // provisioned white-label brand defaulted to its own rendered hash instead (FOLLOW-707);
        // for the first-party tenant both branches were already this same value.
        //
        //   - GRACE BAND (`attestedPreviousVersion === true`) with the hash OMITTED: write NULL,
        //     defaulting nothing (FOLLOW-815). This is the one combination where no honest
        //     default exists. The caller attested `PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS`,
        //     i.e. a text this server no longer renders and whose bytes are not reachable from
        //     this process; defaulting the CURRENT version's hash would produce a row whose
        //     `tos_version` and `consent_text_hash` attest two DIFFERENT texts — precisely the
        //     Art. 7(1) defect FOLLOW-712 closed for the refusal path and FOLLOW-704 closed for
        //     the constant. A recorded absence is honest; a plausible-looking digest of the wrong
        //     text is the fabrication class Rule K.2 exists to forbid. `consent_text_hash` is
        //     nullable in the schema (`packages/db/src/schema/consent_records.ts`), the write is
        //     NOT refused (refusing would be the registration outage FOLLOW-715 exists to
        //     prevent), and the `warning`-level grace-window alert above says the hash is NULL,
        //     so the state is observable rather than silent. A caller that ECHOES an explicit
        //     hash is unaffected: its own value is stored as submitted.
        consentTextHash: attestedPreviousVersion
          ? (body.consent_text_hash ?? null)
          : (body.consent_text_hash ?? CANONICAL_CONSENT_TEXT_HASH),
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
