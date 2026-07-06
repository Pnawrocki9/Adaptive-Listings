/**
 * POST /api/adapt/feedback — Thompson sampling bandit feedback loop.
 *
 * FOLLOW-007. Fire-and-forget conversion signal endpoint. The SDK calls this
 * route when an outcome event (inquiry / click-through / configurable goal)
 * is observed for a previously-served `(tenant_id, archetype, variant)`
 * triple.
 *
 * Auth: ADR-0015 (FOLLOW-443, closes ESC-035/F-09).
 *
 * Verification algorithm (ADR-0015 §Verification Algorithm):
 *
 *   Step 1 — Guard: FEEDBACK_ENDPOINT_ENABLED === 'true' (pilot launch toggle).
 *   Step 2 — Ops bypass (ADAPT_API_KEY env var):
 *              if bearerToken === ADAPT_API_KEY:
 *                if OPS_TENANT_ID not set → 500 (server misconfiguration)
 *                resolvedTenantId = OPS_TENANT_ID
 *                goto Step 6 (skip SHA-256 lookup + HMAC check)
 *   Step 3 — resolveApiKey(req): SHA-256(bearerToken) → api_keys lookup.
 *              Constant-time belt-and-suspenders compare.
 *              Failure → 401 (404 normalized to 401 — no key-existence leak).
 *   Step 4 — resolvedTenantId = row.tenantId.
 *   Step 5 — HMAC body signature (defense-in-depth):
 *              X-Estalara-Signature = HMAC-SHA256(bearerToken, rawBody).
 *              Missing / malformed / mismatch → 401.
 *   Step 5b — Replay protection (FOLLOW-466 / audit F-21, HMAC path only):
 *              Redis `SET nonce:feedback:{providedHex} 1 NX EX 600`. NX failure
 *              (signature already seen within the TTL) → this ping is a
 *              replay/duplicate — skip Steps 6-8 entirely and return 200
 *              `{ ok: true, deduplicated: true }` (idempotent ack, no
 *              double-counted bandit/label write). Fail-open on Redis
 *              unavailability (see @/lib/feedback-nonce). Does not apply to
 *              the ops-key path (Step 2), which has no signature.
 *   Step 6 — Parse body JSON (Zod).  Failure → 400.
 *   Step 7 — Cross-tenant enforcement:
 *              body.tenant_id !== resolvedTenantId → 403.
 *   Step 8 — Fire-and-forget writes (afterResponse) using resolvedTenantId.
 *              Returns 202 Accepted.
 *
 * SDK wire contract (unchanged — no SDK re-deployment required):
 *   Authorization: Bearer {rawApiKey}
 *   X-Estalara-Signature: HMAC_SHA256(rawApiKey, rawBodyText)
 *   Body: { session_id, tenant_id, archetype, variant, converted,
 *           [prediction_id], [lead_id] }
 *
 * FOLLOW-466 (audit F-21) note: replay protection (Step 5b) is enforced
 * SERVER-SIDE via a Redis nonce cache keyed on the verified signature — the
 * signed message and wire contract above are UNCHANGED. A timestamp/nonce in
 * the signed payload was considered and explicitly deferred (would require an
 * SDK re-deploy); see @/lib/feedback-nonce for the full rationale.
 *
 * FEEDBACK_ENDPOINT_ENABLED gate: The 503 block (Step 1) is NOT removed in
 * this PR. Ops sets FEEDBACK_ENDPOINT_ENABLED=true at pilot go-live only after
 * this PR merges and CI is green (per ADR-0015 §Lifting the interim 503).
 *
 * @module apps/control-plane/src/app/api/adapt/feedback/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { afterResponse } from '@/lib/after-response';
import { resolveApiKey, constantTimeEqual, type ApiKeyAuthResult } from '@/lib/api-key-auth';
import { checkAndRecordFeedbackNonce } from '@/lib/feedback-nonce';

import { errorBody, ErrorCode, updateBanditArm, outcomeClassFromConverted } from '@estalara/shared';
import { createAdminClient, abBanditWeights, upsertConversionLabel } from '@estalara/db';

// ─── Body schema ──────────────────────────────────────────────────────────────

const FeedbackBodySchema = z.object({
  session_id: z.string().min(1).max(256),
  tenant_id: z.string().min(1).max(256),
  archetype: z.string().min(1).max(128),
  variant: z.string().min(1).max(128),
  converted: z.boolean(),
  /**
   * Conversion Label Loop (FOLLOW-171, §T): the stable per-decision UUID returned to the SDK
   * on `/api/adapt` (`adapt_decision_id`). When present, the feedback ping is persisted as a
   * durable `conversion_labels` row joined to its prediction. Optional for backward-compat —
   * older SDKs that don't send it still drive the bandit; they just produce no durable label.
   */
  prediction_id: z.string().min(1).max(256).optional(),
  /** Optional durable pseudonymous lead key (§T.6); stored on the label when provided. */
  lead_id: z.string().max(256).optional(),
});

// ─── HMAC helper (defense-in-depth body signature) ───────────────────────────

/**
 * Compute HMAC-SHA256(key=secret, data=message) and return the lower-case hex digest.
 * Uses the Web Crypto API available in the Next.js runtime.
 *
 * Used only for Step 5 (body signature defense-in-depth). The auth key (Step 3)
 * is resolved via SHA-256 DB lookup in resolveApiKey() from @/lib/api-key-auth.
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

// ─── Fire-and-forget conversion-label persistence (FOLLOW-171 + FOLLOW-179, §T) ──

/**
 * Persists a durable `conversion_labels` row pairing the prediction (`prediction_id` =
 * `adapt_decision_id`) with the lead's outcome, so the (prediction, outcome) tuple survives
 * for later per-tenant fine-tuning (TALLRec/LoRA, §D.5.7) instead of being collapsed into the
 * bandit Beta counters and discarded.
 *
 * Uses `upsertConversionLabel` (FOLLOW-179) instead of a plain INSERT to enforce the
 * one-row-per-(tenant_id, prediction_id) invariant (§T.2). On duplicate `prediction_id`
 * the upsert applies the class-precedence policy: a later system ping only overwrites an
 * existing label when its rank is higher (e.g. `viewing_booked` > `no_response`). This
 * prevents a re-fired feedback ping from corrupting an already-recorded deeper outcome.
 *
 * `label_source` is always `'system'` here (auto-mapped from the ping). The coarse `converted`
 * boolean maps to the shallowest outcome class via `outcomeClassFromConverted`; deeper classes
 * (offer/contract/purchase/lost) arrive via CRM ingest (FOLLOW-172). The full parsed ping body
 * is retained in `outcome_raw` for source fidelity.
 *
 * `confidence` is always set to 1.0 for system-source labels: they represent observed events
 * (hard facts), not probabilistic inferences. This closes RETRO-029 CB-2 (system rows were
 * writing NULL, inconsistent with CRM rows that write 1.0).
 *
 * Never throws — errors are logged and swallowed so the feedback ping cannot impact callers.
 * No-op when DATABASE_URL_ADMIN is unset (dev/test) or no `prediction_id` was supplied.
 *
 * @internal
 */
async function upsertConversionLabelAsync(args: {
  tenantId: string;
  predictionId: string;
  leadId: string;
  converted: boolean;
  outcomeRaw: unknown;
}): Promise<void> {
  const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!adminUrl) return;

  try {
    const db = createAdminClient();
    await upsertConversionLabel(db, {
      tenantId: args.tenantId,
      predictionId: args.predictionId,
      leadId: args.leadId,
      outcomeClass: outcomeClassFromConverted(args.converted),
      outcomeRaw: args.outcomeRaw,
      labelSource: 'system',
      confidence: 1.0,
    });
  } catch (err) {
    console.error(
      '[adapt/feedback] conversion_labels upsert failed:',
      err instanceof Error ? err.message : err,
    );
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * POST /api/adapt/feedback
 *
 * Auth: ADR-0015 (FOLLOW-443). SHA-256 bearer→tenant resolution + HMAC body sig.
 *
 * Responses:
 *   202 Accepted  — feedback acknowledged; DB update happens asynchronously.
 *   200 { ok: true, deduplicated: true } — replayed/duplicate signature
 *     (FOLLOW-466); idempotent ack, no bandit/label write performed.
 *   400 VALIDATION_ERROR — invalid body.
 *   401 AUTH_REQUIRED / FORBIDDEN — missing bearer, unknown/revoked key, bad HMAC sig.
 *   403 FORBIDDEN — body.tenant_id does not match the API key's tenant.
 *   500 INTERNAL_ERROR — server misconfiguration (OPS_TENANT_ID unset with ADAPT_API_KEY).
 *   503 SERVICE_TEMPORARILY_UNAVAILABLE — endpoint disabled (FEEDBACK_ENDPOINT_ENABLED unset).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  // ── Step 1: Guard — endpoint enabled ─────────────────────────────────────
  // ESC-035: Feedback endpoint disabled by default (secure-by-default).
  // Set FEEDBACK_ENDPOINT_ENABLED=true ONLY after ADR-0015 fix ships and CI is green
  // (ADR-0015 §Lifting the interim 503). This block is NOT removed in FOLLOW-443 —
  // it stays until ops enables it at pilot go-live.
  if (process.env.FEEDBACK_ENDPOINT_ENABLED !== 'true') {
    return NextResponse.json(
      {
        error: 'SERVICE_TEMPORARILY_UNAVAILABLE',
        message: 'Feedback endpoint temporarily disabled pending security fix.',
      },
      { status: 503 },
    );
  }

  // ── Extract bearer token ──────────────────────────────────────────────────
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

  // ── Read raw body text once — needed for HMAC verification (Step 5) ──────
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

  // ── Steps 2-5: Auth resolution ────────────────────────────────────────────
  let resolvedTenantId: string;

  const adaptApiKey = process.env.ADAPT_API_KEY;
  if (adaptApiKey && bearerToken === adaptApiKey) {
    // ── Step 2: Ops bypass (ADAPT_API_KEY path) ──────────────────────────
    // ADAPT_API_KEY is a server-side Doppler secret; never in the browser.
    // Permanent disposition (CEO 2026-07-01, ADR-0015): scoped to OPS_TENANT_ID only.
    // If OPS_TENANT_ID is not configured, this is a server misconfiguration (→ 500).
    const opsTenantId = process.env.OPS_TENANT_ID;
    if (!opsTenantId) {
      return NextResponse.json(
        {
          error: 'INTERNAL_ERROR',
          message: 'OPS_TENANT_ID must be set alongside ADAPT_API_KEY (server misconfiguration).',
        },
        { status: 500 },
      );
    }
    resolvedTenantId = opsTenantId;
    // Skip Steps 3-5 (SHA-256 lookup + HMAC check) for the ops path.
  } else {
    // ── Step 3: resolveApiKey — SHA-256(bearerToken) → api_keys lookup ───
    // Failure (key not found, revoked, expired) → 401.
    // We normalize 404 → 401 to avoid leaking key-existence information
    // on this mutation endpoint.
    let keyAuth: ApiKeyAuthResult;
    try {
      keyAuth = await resolveApiKey(req);
    } catch (err) {
      // DB threw during auth lookup (configured-but-failed, Rule K.2).
      console.error('[adapt/feedback] auth DB error', err);
      try {
        const { captureException } = await import('@sentry/nextjs');
        captureException(err);
      } catch {
        // Sentry not configured in this env
      }
      return NextResponse.json(
        errorBody({
          code: ErrorCode.FORBIDDEN,
          message: 'Authentication service temporarily unavailable',
          requestId,
        }),
        { status: 401 },
      );
    }

    if (!keyAuth.ok) {
      // Normalize 404 → 401 (no key-existence oracle on mutation endpoint).
      return NextResponse.json(
        errorBody({
          code: ErrorCode.FORBIDDEN,
          message: 'Invalid or missing API key',
          requestId,
        }),
        { status: 401 },
      );
    }

    // ── Step 4: resolvedTenantId from the authenticated key row ──────────
    resolvedTenantId = keyAuth.tenantId;

    // ── Step 5: HMAC body signature (defense-in-depth) ───────────────────
    // Proves the caller knows the raw API key value by computing a keyed
    // digest over the exact body content. Prevents replay of any body by
    // a caller who only observes a valid (key, HMAC) pair but doesn't know rawKey.
    const signatureHeader = req.headers.get('X-Estalara-Signature');
    if (!signatureHeader) {
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

    const providedHex = signatureHeader.trim().toLowerCase();
    // Reject obviously-malformed values (non-hex chars, wrong length for SHA-256).
    if (!/^[0-9a-f]{64}$/.test(providedHex)) {
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

    const expectedHex = await hmacSha256Hex(bearerToken, rawBody);
    if (!constantTimeEqual(providedHex, expectedHex)) {
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

    // ── Step 5b: Replay protection (FOLLOW-466 / audit F-21) ─────────────
    // The signature is deterministic over (key, body) — no timestamp/nonce
    // in the signed payload (SDK wire contract unchanged, @/lib/feedback-nonce
    // has the full rationale). Record providedHex in Redis; a repeated POST
    // bearing the identical signature within the TTL window is a
    // replay/duplicate — no-op it (do not double-count against the bandit /
    // conversion-label store) but still ack it idempotently. HMAC-path only;
    // the ops-key path (Step 2) has no signature and is not subject to this
    // check.
    const { isReplay } = await checkAndRecordFeedbackNonce(providedHex);
    if (isReplay) {
      return NextResponse.json({ ok: true, deduplicated: true }, { status: 200 });
    }
  }

  // ── Step 6: Parse + validate body ─────────────────────────────────────────
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

  // ── Step 7: Cross-tenant enforcement ──────────────────────────────────────
  // The tenantId used for all downstream writes is ALWAYS resolvedTenantId
  // (from the authenticated key row, or from OPS_TENANT_ID for the ops path).
  // body.tenant_id is compared against it to catch misconfigured callers and
  // cross-tenant write attempts.
  if (parsed.data.tenant_id !== resolvedTenantId) {
    return NextResponse.json(
      {
        error: 'FORBIDDEN',
        message: 'tenant_id in body does not match the API key tenant',
      },
      { status: 403 },
    );
  }

  // ── Step 8: Fire-and-forget writes ────────────────────────────────────────
  // FOLLOW-433 / ESC-033: registered via afterResponse() so the DB write
  // completes after the response before Vercel instance suspension.
  // All writes use resolvedTenantId — never parsed.data.tenant_id directly.
  afterResponse(() =>
    updateArmAsync({
      tenantId: resolvedTenantId,
      archetype: parsed.data.archetype,
      variant: parsed.data.variant,
      converted: parsed.data.converted,
    }),
  );

  if (parsed.data.prediction_id) {
    // Capture the narrowed string in a local const so the closure does not need
    // a non-null assertion — TypeScript cannot narrow through the closure boundary
    // for optional properties.
    const predictionId: string = parsed.data.prediction_id;
    afterResponse(() =>
      upsertConversionLabelAsync({
        tenantId: resolvedTenantId,
        predictionId,
        leadId: parsed.data.lead_id ?? '',
        converted: parsed.data.converted,
        outcomeRaw: parsed.data,
      }),
    );
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
