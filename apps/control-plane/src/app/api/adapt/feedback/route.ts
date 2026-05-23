/**
 * POST /api/adapt/feedback — Thompson sampling bandit feedback loop.
 *
 * FOLLOW-007. Fire-and-forget conversion signal endpoint. The SDK calls this
 * route when an outcome event (inquiry / click-through / configurable goal)
 * is observed for a previously-served `(tenant_id, archetype, variant)`
 * triple. The server:
 *
 *   1. Reads the matching row from `ab_bandit_weights` via the composite
 *      index `ab_bandit_weights_tenant_archetype_idx`.
 *   2. Computes new Beta parameters with `updateBanditArm(alpha, beta, converted)`:
 *        converted=true  → alpha += 1
 *        converted=false → beta  += 1
 *   3. Upserts the updated row (insert with `onConflictDoUpdate`).
 *   4. Returns `202 Accepted` immediately — the DB write is fire-and-forget
 *      so the SDK's outcome ping never blocks the user-visible adapt flow.
 *
 * Auth: HMAC-SHA256 tenant-scoped signature (FOLLOW-051).
 *
 * The SDK sends:
 *   Authorization: Bearer {rawApiKey}
 *   X-Estalara-Signature: {hmacHex}
 *
 * The server:
 *   1. Extracts the raw Bearer token (= tenant's public API key).
 *   2. Reads the raw request body as text.
 *   3. Computes HMAC-SHA256(key=rawApiKey, data=rawBodyText).
 *   4. Constant-time compares against the X-Estalara-Signature header value.
 *
 * Fallback: when `ADAPT_API_KEY` env var is set (ops / integration testing), a
 * matching Bearer token is accepted directly without HMAC verification.
 *
 * Threat model (FOLLOW-051):
 *   - Protects against external adversaries who do not know the tenant's API key.
 *   - Does NOT protect against a malicious tenant manipulating their own bandit
 *     weights — that is an acceptable risk because tenant_id is already scoped.
 *   - Prevents cross-tenant poisoning (attacker must know the specific tenant
 *     key to produce a valid signature for that tenant's weights).
 *
 * @module apps/control-plane/src/app/api/adapt/feedback/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { errorBody, ErrorCode, updateBanditArm } from '@estalara/shared';
import { createAdminClient, abBanditWeights } from '@estalara/db';

// ─── Body schema ──────────────────────────────────────────────────────────────

const FeedbackBodySchema = z.object({
  session_id: z.string().min(1).max(256),
  tenant_id: z.string().min(1).max(256),
  archetype: z.string().min(1).max(128),
  variant: z.string().min(1).max(128),
  converted: z.boolean(),
});

// ─── HMAC helpers ─────────────────────────────────────────────────────────────

/**
 * Compute HMAC-SHA256(key=secret, data=message) and return the lower-case hex digest.
 * Uses the Web Crypto API available in the Next.js runtime.
 *
 * @internal
 */
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

/**
 * Constant-time hex string comparison. Returns true iff `a === b` without
 * short-circuiting (prevents timing side-channels).
 *
 * Both inputs must be lower-case hex of equal length; if lengths differ the
 * function returns false immediately (length itself is not secret).
 *
 * @internal
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify the HMAC-SHA256 signature on a feedback request.
 *
 * Returns true when:
 *   (a) ADAPT_API_KEY is set and the Bearer token matches it (ops fallback), or
 *   (b) X-Estalara-Signature header is present and valid for the given Bearer
 *       token (raw API key) + raw body.
 *
 * Returns false in all other cases (missing signature, wrong key, etc.).
 *
 * @internal
 */
async function verifyFeedbackAuth(
  bearerToken: string,
  signatureHeader: string | null,
  rawBody: string,
): Promise<boolean> {
  // Ops / integration-test fallback: ADAPT_API_KEY present → accept direct key match.
  const adaptApiKey = process.env.ADAPT_API_KEY;
  if (adaptApiKey && bearerToken === adaptApiKey) {
    return true;
  }

  // HMAC path: require X-Estalara-Signature header.
  if (!signatureHeader) return false;

  const providedHex = signatureHeader.trim().toLowerCase();
  // Reject obviously-malformed values (non-hex chars, wrong length for SHA-256).
  if (!/^[0-9a-f]{64}$/.test(providedHex)) return false;

  const expectedHex = await hmacSha256Hex(bearerToken, rawBody);
  return constantTimeEqual(providedHex, expectedHex);
}

// ─── Fire-and-forget bandit arm update ───────────────────────────────────────

/**
 * Updates the matching `(tenant_id, archetype, variant)` row in
 * `ab_bandit_weights` based on the conversion signal. Never throws —
 * errors are logged and swallowed so the feedback ping cannot impact
 * downstream callers.
 *
 * @internal
 */
async function updateArmAsync(args: {
  tenantId: string;
  archetype: string;
  variant: string;
  converted: boolean;
}): Promise<void> {
  const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!adminUrl) {
    // No admin DB configured — no-op (dev/test environment).
    return;
  }

  try {
    const db = createAdminClient();

    const rows = await db
      .select({ alpha: abBanditWeights.alpha, beta: abBanditWeights.beta })
      .from(abBanditWeights)
      .where(
        and(
          eq(abBanditWeights.tenantId, args.tenantId),
          eq(abBanditWeights.archetype, args.archetype),
          eq(abBanditWeights.variant, args.variant),
        ),
      )
      .limit(1);

    // Treat missing row as Beta(1, 1) so first-observed feedback still records.
    const current = rows[0] ?? { alpha: 1.0, beta: 1.0 };
    const next = updateBanditArm(current.alpha, current.beta, args.converted);

    await db
      .insert(abBanditWeights)
      .values({
        tenantId: args.tenantId,
        archetype: args.archetype,
        variant: args.variant,
        alpha: next.alpha,
        beta: next.beta,
        paused: false,
      })
      .onConflictDoUpdate({
        target: [abBanditWeights.tenantId, abBanditWeights.archetype, abBanditWeights.variant],
        set: {
          alpha: next.alpha,
          beta: next.beta,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.error('[adapt/feedback] DB upsert failed:', err instanceof Error ? err.message : err);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * POST /api/adapt/feedback
 *
 * Body:
 *   session_id  — string (required)
 *   tenant_id   — string (required)
 *   archetype   — string (required)
 *   variant     — string (required)
 *   converted   — boolean (required)
 *
 * Auth: HMAC-SHA256 tenant-scoped signature (FOLLOW-051).
 *   Authorization: Bearer {rawApiKey}
 *   X-Estalara-Signature: {hmacSha256OfBodyHex}
 *
 * Fallback: when `ADAPT_API_KEY` env var is set, a matching Bearer token is
 * accepted directly (ops/integration-test convenience).
 *
 * Responses:
 *   202 Accepted  — feedback acknowledged; DB update happens asynchronously.
 *   400 VALIDATION_ERROR — invalid body.
 *   401 AUTH_REQUIRED / FORBIDDEN — missing or invalid auth.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  // ── Auth gate ─────────────────────────────────────────────────────────────
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const bearerToken = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!bearerToken) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.AUTH_REQUIRED,
        message: 'Authorization: Bearer <token> header is required',
        requestId,
      }),
      { status: 401 },
    );
  }

  // Read raw body text once — used for both JSON parsing and HMAC verification.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid JSON body',
        requestId,
      }),
      { status: 400 },
    );
  }

  const signatureHeader = req.headers.get('X-Estalara-Signature');
  const authOk = await verifyFeedbackAuth(bearerToken, signatureHeader, rawBody);
  if (!authOk) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.FORBIDDEN,
        message:
          'Invalid or missing HMAC signature. Expected X-Estalara-Signature: HMAC-SHA256(apiKey, body)',
        requestId,
      }),
      { status: 401 },
    );
  }

  // ── Parse + validate body ─────────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid JSON body',
        requestId,
      }),
      { status: 400 },
    );
  }

  const parsed = FeedbackBodySchema.safeParse(raw);
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

  // ── Fire-and-forget bandit update ─────────────────────────────────────────
  // We intentionally do NOT await the DB write here — the SDK's outcome ping
  // must never block. The microtask returns a resolved promise immediately,
  // and the DB upsert progresses in the background.
  void updateArmAsync({
    tenantId: parsed.data.tenant_id,
    archetype: parsed.data.archetype,
    variant: parsed.data.variant,
    converted: parsed.data.converted,
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
