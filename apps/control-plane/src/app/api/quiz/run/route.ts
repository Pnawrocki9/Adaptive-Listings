/**
 * POST /api/quiz/run — record one quiz-run lifecycle ping into `quiz_runs` (FOLLOW-1358, plan Faza Q
 * package Q3, ESC-086 item 2, MASTER_DESIGN §E.4.8 v3.0).
 *
 * The SDK quiz widget (FOLLOW-1357 / Q2) sends one ping per lifecycle step, fire-and-forget:
 * `shown` on render, `dismissed` on Skip / ×, `completed` at the leaf, then `confirmed` /
 * `corrected` / `unconfirmed` on the confirmation screen. `lib/quiz-runs.ts` folds the pings into
 * one row per run with a forward-only state machine; this route is its only writer.
 *
 * Auth — the same as `POST /api/quiz/completion` (FOLLOW-051 threat model):
 *   Authorization: Bearer {rawApiKey}
 *   X-Estalara-Signature: {hmacSha256(apiKey, bodyText)}   (constant-time compare)
 * The tenant comes from the SHA-256 api_keys lookup, never from the body. The body's `tenant_id`
 * must EQUAL it (403 otherwise) and is not what is written. The browser-origin gate (FOLLOW-941 /
 * FOLLOW-1333) refuses an unlisted `Origin` with 403 BEFORE any write. Ops/test fallback:
 * `ADAPT_API_KEY` + `ADAPT_TENANT_ID`, exactly as the completion route. Replay: an identical ping is
 * a no-op by construction — the state machine only moves forward, so a replayed ping answers 200
 * `applied: false` and changes nothing.
 *
 * Privacy gates, both answering 204 with nothing written:
 *   - §H.9 opt-out: `?profiling_opt_out=1` (the completion route's defence-in-depth gate; checked
 *     after auth so an opted-out request still needs a valid key);
 *   - consent: `consent_state` is REQUIRED and must be `consented` (the SDK banner consent,
 *     `public/consent-text.json`). Absent, `legitimate-interest` or anything else → 204 and nothing
 *     written: no LIA covers quiz-accuracy measurement (compliance review of FOLLOW-1358,
 *     2026-10-20, conditions C3/C5). The SDK sends no ping without consent in the first place.
 *
 * Responses:
 *   200 { applied }               — the ping was folded (`applied: false` = replay / illegal step).
 *   204                           — opted out or no profiling consent; nothing written.
 *   400 VALIDATION_ERROR          — malformed JSON or a body `QuizRunPingSchema` rejects.
 *   401 AUTH_REQUIRED | FORBIDDEN — missing bearer, bad HMAC, unknown/revoked key.
 *   403 FORBIDDEN                 — unlisted browser origin, or body `tenant_id` ≠ the key's tenant.
 *   503 quiz_runs_table_missing   — H002 not applied yet (CTO_HANDOVER §4); Sentry capture.
 *   500 INTERNAL_ERROR            — any other database failure; Sentry capture (Rule K.2).
 * Sentry captures are registered with `afterResponse` (`after()`, FOLLOW-433) so they flush on
 * Vercel without delaying the answer. Neither Sentry nor the log ever receives the driver error:
 * drizzle's `DrizzleQueryError` message carries the failed query AND its params (session_id,
 * answer_path, traits), and Sentry serialises the `cause` chain. Both sinks get a fresh `Error`
 * naming only the wire code and the SQLSTATE, with no `cause` (condition C1, FOLLOW-1353 pattern).
 *
 * CORS: listed origins via `middleware.ts` (`SDK_CORS_PREFIXES`), like the completion route.
 *
 * @module apps/control-plane/src/app/api/quiz/run/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { and, eq, isNull, or, gt } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';

import { createAdminClient, apiKeys } from '@estalara/db';
import { errorBody, ErrorCode, QuizRunPingSchema } from '@estalara/shared';
import { afterResponse } from '@/lib/after-response';
import { sha256Hex, constantTimeEqual } from '@/lib/api-key-auth';
import { resolveOriginDecision } from '@/lib/origin-policy';
import {
  QUIZ_RUNS_TABLE_MISSING,
  QuizRunsTableMissingError,
  recordQuizRunEvent,
} from '@/lib/quiz-runs';

/** The only consent state under which a run is written (banner consent; no LIA covers it). */
const WRITE_ALLOWED_CONSENT_STATE = 'consented';

/** The first SQLSTATE-shaped `code` in the error's `cause` chain, or `'unknown'`. Nothing else. */
function sqlStateOf(err: unknown): string {
  let cursor: unknown = err;
  for (let depth = 0; depth < 5 && cursor !== null && typeof cursor === 'object'; depth++) {
    const code = (cursor as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return 'unknown';
}

// ─── HMAC + tenant resolution (mirrors api/quiz/completion/route.ts) ─────────

/** HMAC-SHA256(key=secret, data=message) → lower-case hex, Web Crypto. */
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type AuthOutcome =
  | { ok: true; tenantId: string }
  | { ok: false; status: 401 | 403; code: ErrorCode; message: string };

const BAD_SIGNATURE =
  'Invalid or missing HMAC signature. Expected X-Estalara-Signature: HMAC-SHA256(apiKey, body)';

/**
 * Verify the HMAC and resolve the tenant from the API key — the completion route's logic, kept
 * line-for-line equivalent so the two SDK write paths cannot drift apart on auth:
 *   1. ops/test fallback (`ADAPT_API_KEY` matches → `ADAPT_TENANT_ID`; server-side only, no Origin
 *      gate, see the completion route for why);
 *   2. HMAC over the raw body, constant-time compare, then SHA-256(key) → api_keys (not revoked,
 *      not expired), then the browser-origin gate (403 before any write).
 */
async function verifyAndResolveTenant(
  bearerToken: string,
  signatureHeader: string | null,
  rawBody: string,
  requestOrigin: string | null,
): Promise<AuthOutcome> {
  const adaptApiKey = process.env.ADAPT_API_KEY;
  const adaptTenantId = process.env.ADAPT_TENANT_ID;
  if (adaptApiKey && bearerToken === adaptApiKey) {
    if (!adaptTenantId) {
      return {
        ok: false,
        status: 401,
        code: ErrorCode.FORBIDDEN,
        message:
          'ADAPT_TENANT_ID must be set alongside ADAPT_API_KEY (ops/test fallback configuration)',
      };
    }
    return { ok: true, tenantId: adaptTenantId };
  }

  const providedHex = (signatureHeader ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(providedHex)) {
    return { ok: false, status: 401, code: ErrorCode.FORBIDDEN, message: BAD_SIGNATURE };
  }
  const expectedHex = await hmacSha256Hex(bearerToken, rawBody);
  if (!constantTimeEqual(providedHex, expectedHex)) {
    return { ok: false, status: 401, code: ErrorCode.FORBIDDEN, message: BAD_SIGNATURE };
  }

  if (!(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT)) {
    return {
      ok: false,
      status: 401,
      code: ErrorCode.FORBIDDEN,
      message: 'API key lookup unavailable: database not configured',
    };
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
  if (!row) {
    return {
      ok: false,
      status: 401,
      code: ErrorCode.FORBIDDEN,
      message: 'API key not found or revoked',
    };
  }

  // FOLLOW-941 / FOLLOW-1333: 403, not an omitted CORS header — this route WRITES.
  const decision = resolveOriginDecision(requestOrigin);
  if (decision.verdict !== 'allow') {
    return { ok: false, status: 403, code: ErrorCode.FORBIDDEN, message: decision.reason };
  }
  return { ok: true, tenantId: row.tenantId };
}

// ─── Failure answer: the single Sentry site of this route ────────────────────

/** Capture after the response (FOLLOW-433), then answer 503 (table missing) or 500. */
function fail(err: unknown, tenantId: string, requestId: string): NextResponse {
  const tableMissing = err instanceof QuizRunsTableMissingError;
  const code = tableMissing ? QUIZ_RUNS_TABLE_MISSING : 'quiz_run_write_failed';
  const sqlState = tableMissing ? '42P01' : sqlStateOf(err);
  // C1: a sanitised error — code + SQLSTATE only, no message from the driver, no `cause`.
  const safe = new Error(`quiz_run ${code} (sqlstate ${sqlState})`);
  console.error('[quiz/run] write failed:', code, `sqlstate=${sqlState}`);
  afterResponse(() => {
    Sentry.captureException(safe, {
      tags: { route: 'quiz/run', tenant_id: tenantId, error_code: code, sqlstate: sqlState },
    });
    return Promise.resolve();
  });
  if (tableMissing) {
    return NextResponse.json(
      {
        error: {
          code: QUIZ_RUNS_TABLE_MISSING,
          message:
            'quiz_runs is not created in this database yet (docs/handover/migrations/H002_quiz_runs.sql)',
          request_id: requestId,
        },
      },
      { status: 503 },
    );
  }
  return NextResponse.json(
    errorBody({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Failed to record the quiz run',
      requestId,
    }),
    { status: 500 },
  );
}

// ─── POST handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/quiz/run — see the module doc for the auth, the privacy gates and every response.
 *
 * @param req - the SDK ping; body per `QuizRunPingSchema` (`@estalara/shared`).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
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
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Failed to read request body',
        requestId,
      }),
      { status: 400 },
    );
  }

  let authResult: AuthOutcome;
  try {
    authResult = await verifyAndResolveTenant(
      bearerToken,
      req.headers.get('X-Estalara-Signature'),
      rawBody,
      req.headers.get('Origin'),
    );
  } catch (err: unknown) {
    // The api_keys lookup itself failed (configured database threw) — loud, not a 401.
    return fail(err, 'unknown', requestId);
  }
  if (!authResult.ok) {
    return NextResponse.json(
      errorBody({ code: authResult.code, message: authResult.message, requestId }),
      { status: authResult.status },
    );
  }
  const tenantId = authResult.tenantId;

  // §H.9 opt-out — after auth, before parsing: nothing is written.
  if (new URL(req.url).searchParams.get('profiling_opt_out') === '1') {
    return new NextResponse(null, { status: 204 });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json(
      errorBody({ code: ErrorCode.VALIDATION_ERROR, message: 'Invalid JSON body', requestId }),
      { status: 400 },
    );
  }
  const parsed = QuizRunPingSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        requestId,
        details: { issues: parsed.error.flatten() },
      }),
      { status: 400 },
    );
  }
  const ping = parsed.data;

  // Consent (C3/C5): required, and only `consented` writes. Absent or anything else → nothing.
  if (ping.consent_state !== WRITE_ALLOWED_CONSENT_STATE) {
    return new NextResponse(null, { status: 204 });
  }

  // Tenant fence: the body may not name a tenant other than the key's.
  if (ping.tenant_id.toLowerCase() !== tenantId.toLowerCase()) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.FORBIDDEN,
        message: 'tenant_id does not match the API key',
        requestId,
      }),
      { status: 403 },
    );
  }

  try {
    const { applied } = await recordQuizRunEvent(createAdminClient(), tenantId, ping);
    return NextResponse.json({ applied }, { status: 200 });
  } catch (err: unknown) {
    return fail(err, tenantId, requestId);
  }
}
