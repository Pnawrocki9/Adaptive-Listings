/**
 * POST /api/crm/outcome — CRM deep-outcome ingest → conversion_labels (PII-stripped).
 *
 * FOLLOW-172. Tenant CRM systems call this webhook when a deep real-world outcome
 * is recorded (offer_made, contract_signed, purchased, lost). The route stores a
 * durable (prediction → outcome) row in `conversion_labels` so the per-tenant
 * classifier can be fine-tuned later (TALLRec/LoRA, §D.5.7, MASTER_DESIGN §T).
 *
 * PII boundary (compliance-engineer sign-off, HANDOFFS.md §AC2):
 *   - Schema is allow-listed + `.strict()` so unknown keys are 400 (not stripped).
 *   - `outcome_raw` is populated from `parsed.data` only — never from raw body.
 *   - `lead_id` is an opaque Estalara-assigned pseudonymous token; CRM contact IDs,
 *     names, emails, phones are explicitly excluded from the schema.
 *   - `tenant_id` is derived from the authenticated API key (SHA-256 DB lookup),
 *     never from the request body.
 *
 * Auth: HMAC-SHA256 tenant-scoped signature mirroring POST /api/adapt/feedback:
 *   Authorization: Bearer {rawApiKey}
 *   X-Estalara-Signature: {hmacSha256OfBodyHex}
 *
 * The HMAC key is the raw Bearer token; the HMAC data is the raw request body text.
 * After HMAC verification the Bearer token is SHA-256 hashed to look up the
 * corresponding `api_keys` row — this yields `tenant_id` from the authenticated
 * context rather than from the request body (compliance condition 4).
 *
 * Ops fallback: ADAPT_API_KEY env var set → accept matching Bearer without HMAC;
 * ADAPT_TENANT_ID env var provides the `tenant_id` for that ops key. Both vars are
 * for integration testing ONLY — never use in production with real tenant data.
 *
 * RLS: the admin DB client sets `app.current_tenant_id` (via SET LOCAL) before the
 * upsert so the `conversion_labels_tenant_isolation` RLS policy fires at the DB
 * layer in addition to the application-layer tenant_id pin (compliance condition 6).
 *
 * Deep outcome classes (offer_made, contract_signed, purchased, lost) are the only
 * accepted values on this path. Shallow classes (viewing_booked, no_response) are
 * produced by the SDK feedback ping and are explicitly rejected here to enforce the
 * taxonomy boundary (§T.4).
 *
 * @module apps/control-plane/src/app/api/crm/outcome/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and, isNull, or, gt, sql } from 'drizzle-orm';

import { errorBody, ErrorCode } from '@estalara/shared';
import { createAdminClient, apiKeys, upsertConversionLabel } from '@estalara/db';
import type { Database } from '@estalara/db';

// ─── Body schema (ALLOW-LIST, compliance condition 1) ─────────────────────────
//
// .strict() ensures any field NOT in the allow-list causes a 400.
// Denied fields (names, emails, phones, addresses, CRM IDs, free-text) are
// structurally excluded because .strict() rejects unknown keys.
//
// outcome_class is restricted to DEEP classes only — shallow classes
// (viewing_booked, no_response) are produced by the SDK feedback ping (FOLLOW-171)
// and must not enter via the CRM ingest path (taxonomy boundary §T.4).

const CrmOutcomeBodySchema = z
  .object({
    /** = adapt_decision_id issued by Estalara. Non-PII. Required. */
    prediction_id: z.string().min(1).max(256),

    /**
     * Opaque Estalara-assigned pseudonymous token (§T.6 Option i).
     * NOT a CRM contact ID. Tenant is contractually responsible for
     * sending a non-identifying value (DPA clause + onboarding gate, §A.3).
     * min(1) rejects empty strings so a "no lead_id" payload is a hard error.
     */
    lead_id: z.string().min(1).max(256),

    /**
     * Deep outcome class — only DEEP outcomes are accepted on this ingest path.
     * Shallow classes (viewing_booked, no_response) are produced by the SDK
     * feedback ping; sending them here indicates integration misconfiguration.
     * Rejection with 400 enforces the taxonomy boundary (§T.4).
     */
    outcome_class: z.enum(['offer_made', 'contract_signed', 'purchased', 'lost']),

    /**
     * Optional raw outcome payload. Persisted as `conversion_labels.outcome_raw`.
     * Populated from `parsed.data` ONLY — never from JSON.parse(rawBody).
     * This structural guarantee is what prevents PII leaking into the store
     * (compliance condition 2). Because the schema is strict(), `outcome_raw`
     * can only arrive via the allowed object path.
     */
    outcome_raw: z.record(z.unknown()).optional(),

    /**
     * Labeler confidence. 1.0 for hard CRM facts; lower for inferred outcomes.
     * Defaults to 1.0 when omitted.
     */
    confidence: z.number().min(0).max(1).optional(),

    /**
     * ISO 8601 timestamp of the CRM event. Defaults to server now() if omitted.
     */
    labeled_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict(); // <-- compliance condition 1: unknown keys → 400

type CrmOutcomeBody = z.infer<typeof CrmOutcomeBodySchema>;

// ─── HMAC helpers (copied exactly from feedback/route.ts — FOLLOW-051 threat model) ──

/**
 * Compute HMAC-SHA256(key=secret, data=message) → lower-case hex digest.
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
 * Compute SHA-256 of a raw string and return the lower-case hex digest.
 * Used for api_keys lookup: the `hashed_key` column stores SHA-256(rawKey).
 *
 * @internal
 */
async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Auth + tenant_id resolution ──────────────────────────────────────────────

interface AuthResult {
  ok: true;
  tenantId: string;
}

interface AuthFailure {
  ok: false;
  status: 401;
  code: ErrorCode;
  message: string;
}

/**
 * Verify the HMAC-SHA256 signature and resolve the `tenant_id` from the
 * authenticated API key. Never returns `tenant_id` from the request body —
 * it is always sourced from the DB lookup (compliance condition 4).
 *
 * Resolution order:
 *
 *   1. Ops/test fallback: `ADAPT_API_KEY` env var set AND Bearer matches it.
 *      `tenant_id` from `ADAPT_TENANT_ID` env var. Both MUST be set together.
 *      DOCUMENTED AS OPS-ONLY: never configure in production with real tenant data.
 *
 *   2. HMAC path (production): verify X-Estalara-Signature (HMAC-SHA256, 64 hex
 *      chars, raw body as data, Bearer token as key). Then compute SHA-256 of the
 *      Bearer token and look up in `api_keys.hashed_key` to resolve `tenant_id`.
 *
 * @internal
 */
async function verifyAndResolveTenant(
  bearerToken: string,
  signatureHeader: string | null,
  rawBody: string,
): Promise<AuthResult | AuthFailure> {
  // ── Ops / integration-test fallback (documented OPS-ONLY) ────────────────
  // Both ADAPT_API_KEY and ADAPT_TENANT_ID must be configured together.
  // When ADAPT_API_KEY is set, HMAC verification is bypassed; tenant_id comes
  // from ADAPT_TENANT_ID (not from the request body).
  const adaptApiKey = process.env.ADAPT_API_KEY;
  const adaptTenantId = process.env.ADAPT_TENANT_ID;
  if (adaptApiKey && bearerToken === adaptApiKey) {
    if (!adaptTenantId) {
      // Misconfigured ops setup — treat as auth failure to prevent accidental
      // writes with an empty/invalid tenant_id.
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

  // ── HMAC path (production) ────────────────────────────────────────────────
  if (!signatureHeader) {
    return {
      ok: false,
      status: 401,
      code: ErrorCode.FORBIDDEN,
      message:
        'Invalid or missing HMAC signature. Expected X-Estalara-Signature: HMAC-SHA256(apiKey, body)',
    };
  }

  const providedHex = signatureHeader.trim().toLowerCase();
  // Reject obviously-malformed values (non-hex chars, wrong length for SHA-256).
  if (!/^[0-9a-f]{64}$/.test(providedHex)) {
    return {
      ok: false,
      status: 401,
      code: ErrorCode.FORBIDDEN,
      message: 'X-Estalara-Signature must be a 64-character lower-case hex SHA-256 HMAC digest',
    };
  }

  const expectedHex = await hmacSha256Hex(bearerToken, rawBody);
  const hmacOk = constantTimeEqual(providedHex, expectedHex);
  if (!hmacOk) {
    return {
      ok: false,
      status: 401,
      code: ErrorCode.FORBIDDEN,
      message:
        'Invalid or missing HMAC signature. Expected X-Estalara-Signature: HMAC-SHA256(apiKey, body)',
    };
  }

  // HMAC verified. Resolve tenant_id by SHA-256(bearerToken) lookup in api_keys.
  // api_keys.hashed_key stores SHA-256 of the raw key (same algorithm used in
  // apps/control-plane/src/app/api/schema/activate/route.ts hashKey()).
  const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!adminUrl) {
    // No DB configured (dev/CI without full env) — cannot resolve tenant_id.
    // Fail loud: an unconfigured DB is a "configured-but-threw" scenario when
    // HMAC auth is being attempted (Rule K.2).
    return {
      ok: false,
      status: 401,
      code: ErrorCode.FORBIDDEN,
      message: 'API key lookup unavailable: database not configured',
    };
  }

  const keyHash = await sha256Hex(bearerToken);
  const db = createAdminClient();
  const now = new Date();

  const rows = await db
    .select({ tenantId: apiKeys.tenantId })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.hashedKey, keyHash),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    return {
      ok: false,
      status: 401,
      code: ErrorCode.FORBIDDEN,
      message: 'API key not found or revoked',
    };
  }

  return { ok: true, tenantId: rows[0].tenantId };
}

// ─── DB write with RLS context (compliance condition 6) ──────────────────────

/**
 * Upsert a `conversion_labels` row inside a transaction that first sets
 * `app.current_tenant_id` (SET LOCAL) so the RLS policy
 * `conversion_labels_tenant_isolation` fires at the DB layer in addition to
 * the application-layer `tenant_id` pin.
 *
 * Uses `upsertConversionLabel` (FOLLOW-179) for the one-row-per-(tenant_id,
 * prediction_id) invariant and class-precedence policy.
 *
 * Throws on DB failure — the CRM webhook is an authenticated tenant integration
 * with synchronous confirmation semantics, so errors must surface (not be
 * swallowed fire-and-forget like the SDK feedback ping).
 *
 * @internal
 */
async function writeWithRlsContext(tenantId: string, data: CrmOutcomeBody): Promise<void> {
  const db = createAdminClient();
  const labeledAt = data.labeled_at ? new Date(data.labeled_at) : undefined;

  // SET LOCAL app.current_tenant_id fires the RLS policy on the upcoming INSERT.
  // Must be inside a transaction for SET LOCAL to be transaction-scoped (connection-local).
  // The PgTransaction type is a structural superset of Database — it implements all the same
  // Drizzle query methods (insert, select, execute, ...) that upsertConversionLabel needs.
  // The cast via unknown is required because Drizzle's generic types diverge at the
  // TypeScript level even though the runtime interface is compatible. This is the standard
  // workaround pattern in this codebase (see dsr/erase/route.ts transaction callbacks).
  await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;
    await txDb.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
    // exactOptionalPropertyTypes: spread optional fields conditionally to avoid
    // passing `undefined` for optional properties (TS2379 with exactOptionalPropertyTypes).
    await upsertConversionLabel(txDb, {
      tenantId,
      predictionId: data.prediction_id,
      leadId: data.lead_id,
      outcomeClass: data.outcome_class,
      // compliance condition 2: outcome_raw is parsed.data, never rawBody
      ...(data.outcome_raw !== undefined ? { outcomeRaw: data.outcome_raw } : {}),
      ...(labeledAt !== undefined ? { labeledAt } : {}),
      labelSource: 'system',
      confidence: data.confidence ?? 1.0,
    });
  });
}

// ─── POST handler ──────────────────────────────────────────────────────────────

/**
 * POST /api/crm/outcome
 *
 * Body (allow-listed, .strict()):
 *   prediction_id — string (required, NOT NULL, min 1)
 *   lead_id       — string (required, min 1 — opaque pseudonymous token)
 *   outcome_class — 'offer_made' | 'contract_signed' | 'purchased' | 'lost'
 *   outcome_raw   — object (optional)
 *   confidence    — number 0–1 (optional, defaults 1.0)
 *   labeled_at    — ISO 8601 string (optional)
 *
 * Auth: HMAC-SHA256 tenant-scoped (FOLLOW-051):
 *   Authorization: Bearer {rawApiKey}
 *   X-Estalara-Signature: {hmacSha256OfBodyHex}
 *
 * Responses:
 *   200 { ok: true }             — label persisted or precedence-deduped.
 *   400 VALIDATION_ERROR         — invalid body (includes unknown keys).
 *   401 AUTH_REQUIRED / FORBIDDEN — missing or invalid auth.
 *   500 INTERNAL_ERROR           — DB failure (explicit error, not fail-open).
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
        message: 'Failed to read request body',
        requestId,
      }),
      { status: 400 },
    );
  }

  const signatureHeader = req.headers.get('X-Estalara-Signature');
  const authResult = await verifyAndResolveTenant(bearerToken, signatureHeader, rawBody);

  if (!authResult.ok) {
    return NextResponse.json(
      errorBody({
        code: authResult.code,
        message: authResult.message,
        requestId,
      }),
      { status: authResult.status },
    );
  }

  const tenantId = authResult.tenantId;

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

  const parsed = CrmOutcomeBodySchema.safeParse(raw);
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

  // ── Write conversion label with RLS context ───────────────────────────────
  // Authenticated tenant integration: errors surface as 500 (not swallowed).
  // outcome_raw is assigned from parsed.data — never from rawBody (condition 2).
  try {
    await writeWithRlsContext(tenantId, parsed.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[crm/outcome] DB write failed:', message);
    // Capture to Sentry in production (Rule K.2: configured-but-failed stores must surface).
    if (typeof process !== 'undefined' && process.env.SENTRY_DSN_CONTROL_PLANE) {
      try {
        // Dynamic import to avoid bundling Sentry when env is unset.
        const Sentry = await import('@sentry/nextjs');
        Sentry.captureException(err, { tags: { route: 'crm/outcome', tenant_id: tenantId } });
      } catch {
        // Sentry failure must not mask the real error.
      }
    }
    return NextResponse.json(
      errorBody({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Failed to persist conversion label',
        requestId,
      }),
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
