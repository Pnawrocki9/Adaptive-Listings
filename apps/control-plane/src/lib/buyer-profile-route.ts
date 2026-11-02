/**
 * The shared body of the self-service profile routes (FOLLOW-1316, design review R30, R34):
 * `POST /api/profile/erase`, `/access` and `/portability`. The buyer has no account and no way to
 * know a session id; holding the xid is the proof, so these work with no OTP and in any consent
 * state, including after withdrawal. The flag (R8) does not gate them: a right must outlive the
 * feature being switched off.
 *
 * Auth, the same gate as `POST /api/quiz/run`:
 *   Authorization: Bearer {rawApiKey}
 *   X-Estalara-Signature: {hmacSha256(apiKey, bodyText)}   (constant-time compare)
 * The tenant comes from the SHA-256 api_keys lookup; the body's `tenant_id` must equal it. A listed
 * browser `Origin` is required when one is present (403 before the store is touched). There is no ops
 * fallback here: nothing but the SDK has a reason to call these.
 *
 * Replay: the erase is idempotent (a replay finds nothing and renews a tombstone for an id the browser
 * has already dropped; a later grant mints a new xid), and the reads change nothing. The xid is the
 * bearer credential either way, so it travels in the POST body only.
 *
 * Responses:
 *   200 — see each route; `data_source` is `redis`, or `not_configured` when no store exists at all.
 *   400 VALIDATION_ERROR — malformed JSON or body; unknown keys are refused; never echoes the xid.
 *   401 AUTH_REQUIRED | FORBIDDEN — missing bearer, bad HMAC, unknown or revoked key.
 *   403 FORBIDDEN — unlisted browser origin, or body `tenant_id` differs from the key's tenant.
 *   429 RATE_LIMITED — the per-client quota is spent.
 *   503 profile_store_failed — the store failed. The SDK keeps the local xid and retries (R25).
 *   500 INTERNAL_ERROR — the api_keys lookup failed.
 *
 * `dsr_audit_log` gets the action and its result, and no xid or hash of it (R34).
 *
 * @module apps/control-plane/src/lib/buyer-profile-route
 */

import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createAdminClient, apiKeys } from '@estalara/db';
import { errorBody, ErrorCode } from '@estalara/shared';
import { DSR_AUDIT_ACTIONS, writeDsrAuditLog } from '@/app/api/dsr/_clickhouse';
import { afterResponse } from '@/lib/after-response';
import { constantTimeEqual, sha256Hex } from '@/lib/api-key-auth';
import {
  deleteBuyerProfile,
  isStrictXid,
  readBuyerProfileForSubject,
  reportBuyerProfileFailure,
  takeProfileRouteQuota,
} from '@/lib/buyer-profile-store';
import { resolveOriginDecision } from '@/lib/origin-policy';

const PORTABILITY_FORMAT = 'estalara.buyer_profile';
const PORTABILITY_FORMAT_VERSION = 1;
const STORE_FAILED = 'profile_store_failed';

const ProfileRequestSchema = z
  .object({
    tenant_id: z.string().min(1).max(64),
    xid: z.string().refine(isStrictXid),
  })
  .strict();

type ProfileAction = 'erase' | 'access' | 'portability';

/** HMAC-SHA256(key=secret, data=message) as lower-case hex. */
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The tenant for a signed request, or the refusal to answer with. */
async function resolveTenant(
  req: NextRequest,
  bearerToken: string,
  rawBody: string,
  requestId: string,
): Promise<{ ok: true; tenantId: string } | { ok: false; response: NextResponse }> {
  const refuse = (status: 401 | 403, message: string): { ok: false; response: NextResponse } => ({
    ok: false,
    response: NextResponse.json(errorBody({ code: ErrorCode.FORBIDDEN, message, requestId }), {
      status,
    }),
  });

  const provided = (req.headers.get('X-Estalara-Signature') ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return refuse(401, 'Invalid or missing HMAC signature');
  if (!constantTimeEqual(provided, await hmacSha256Hex(bearerToken, rawBody))) {
    return refuse(401, 'Invalid or missing HMAC signature');
  }
  if (!(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT)) {
    return refuse(401, 'API key lookup unavailable: database not configured');
  }
  const keyHash = await sha256Hex(bearerToken);
  const rows = await createAdminClient()
    .select({ tenantId: apiKeys.tenantId })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.hashedKey, keyHash),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return refuse(401, 'API key not found or revoked');

  const decision = resolveOriginDecision(req.headers.get('Origin'));
  if (decision.verdict !== 'allow') return refuse(403, decision.reason);
  return { ok: true, tenantId: row.tenantId };
}

/** Run one action against the store and shape its answer. */
async function runAction(
  action: ProfileAction,
  tenantId: string,
  xid: string,
  requestId: string,
): Promise<{ response: NextResponse; failed: boolean }> {
  const storeFailed = (): { response: NextResponse; failed: boolean } => ({
    failed: true,
    response: NextResponse.json(
      {
        error: { code: STORE_FAILED, message: 'The profile store failed', request_id: requestId },
        result: 'failed',
      },
      { status: 503 },
    ),
  });

  if (action === 'erase') {
    const result = await deleteBuyerProfile(tenantId, xid, 'browser');
    if (result === 'failed') return storeFailed();
    return {
      failed: false,
      response: NextResponse.json({
        result: result === 'deleted' ? 'deleted' : 'not_found',
        data_source: result === 'not_configured' ? 'not_configured' : 'redis',
      }),
    };
  }

  const read = await readBuyerProfileForSubject(tenantId, xid);
  if (read.result === 'failed') return storeFailed();
  const found = read.result === 'found';
  const held = {
    profile: found ? read.profile : null,
    expires_at: found ? read.expiresAt : null,
    data_source: read.result === 'not_configured' ? 'not_configured' : 'redis',
  };
  return {
    failed: false,
    response: NextResponse.json(
      action === 'access'
        ? { result: found ? 'found' : 'not_found', ...held }
        : {
            format: PORTABILITY_FORMAT,
            format_version: PORTABILITY_FORMAT_VERSION,
            exported_at: new Date().toISOString(),
            ...held,
          },
    ),
  };
}

/**
 * Handle one self-service profile request; see the module doc for the auth and every response.
 *
 * @param req - The SDK's POST: `{ tenant_id, xid }`, signed.
 * @param action - Which right is being exercised.
 */
export async function handleProfileRequest(
  req: NextRequest,
  action: ProfileAction,
): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  const auth = req.headers.get('Authorization');
  const bearerToken = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!bearerToken) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.AUTH_REQUIRED,
        message: 'Authorization: Bearer <apiKey> header is required',
        requestId,
      }),
      { status: 401 },
    );
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return validationFailure(requestId);
  }

  let tenant: Awaited<ReturnType<typeof resolveTenant>>;
  try {
    tenant = await resolveTenant(req, bearerToken, rawBody, requestId);
  } catch {
    reportBuyerProfileFailure('api_key_lookup_failed');
    return NextResponse.json(
      errorBody({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'API key lookup failed',
        requestId,
      }),
      { status: 500 },
    );
  }
  if (!tenant.ok) return tenant.response;
  const { tenantId } = tenant;

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return validationFailure(requestId);
  }
  // The Zod issues are not forwarded: a refused xid is still someone's credential.
  const parsed = ProfileRequestSchema.safeParse(json);
  if (!parsed.success) return validationFailure(requestId);

  if (parsed.data.tenant_id.toLowerCase() !== tenantId.toLowerCase()) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.FORBIDDEN,
        message: 'tenant_id does not match the API key',
        requestId,
      }),
      { status: 403 },
    );
  }

  const client = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!(await takeProfileRouteQuota(tenantId, client))) {
    return NextResponse.json(
      errorBody({ code: ErrorCode.RATE_LIMITED, message: 'Too many requests', requestId }),
      { status: 429 },
    );
  }

  const { response, failed } = await runAction(action, tenantId, parsed.data.xid, requestId);

  const at = new Date();
  afterResponse(() =>
    writeDsrAuditLog({
      tenant_id: tenantId,
      session_id: '',
      dsr_type: `buyer_profile_${action}`,
      action: failed ? DSR_AUDIT_ACTIONS.failed : DSR_AUDIT_ACTIONS.completed,
      email: '',
      requested_at: at,
      completed_at: at,
    }),
  );
  return response;
}

function validationFailure(requestId: string): NextResponse {
  return NextResponse.json(
    errorBody({ code: ErrorCode.VALIDATION_ERROR, message: 'Invalid request body', requestId }),
    { status: 400 },
  );
}
