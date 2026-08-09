/**
 * POST /api/quiz/completion — persist a quiz completion row to quiz_completions.
 *
 * Called fire-and-forget by the SDK (packages/sdk/src/index.ts) after the FOLLOW-199
 * quiz widget reaches a leaf node and resolves an archetype. Each row is a durable
 * MOAT training datum linking:
 *   session signals → quiz path → resolved archetype → adaptation → conversion
 *
 * Auth: HMAC-SHA256 tenant-scoped signature (same pattern as POST /api/adapt/feedback,
 * FOLLOW-051 threat model). The SDK sends:
 *   Authorization: Bearer {rawApiKey}
 *   X-Estalara-Signature: {hmacSha256(apiKey, bodyText)}
 *
 * The tenant_id is derived from the authenticated API key (SHA-256 DB lookup) — never
 * from the request body (compliance condition: tenant cannot impersonate another tenant).
 *
 * Ops/test fallback: ADAPT_API_KEY env var set → accept matching Bearer without HMAC;
 * ADAPT_TENANT_ID provides the tenant_id. Both vars are for integration testing ONLY.
 *
 * Fail-loud contract (Rule K.2):
 *   - DB configured but throws → 500 + Sentry capture. Never return fabricated 2xx.
 *   - Invalid body → 400 with Zod validation details.
 *   - Missing/invalid auth → 401.
 *   - Success → 201 { id, created_at }.
 *
 * RLS: the admin client sets app.current_tenant_id (SET LOCAL inside a transaction) so the
 * quiz_completions_tenant_isolation policy fires at the DB layer in addition to the
 * application-layer tenant_id pin.
 *
 * @module apps/control-plane/src/app/api/quiz/completion/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sql, and, eq, isNull, or, gt } from 'drizzle-orm';

import { createAdminClient, quizCompletions, apiKeys } from '@estalara/db';
import type { Database } from '@estalara/db';
import { errorBody, ErrorCode, QuizLanguageSchema } from '@estalara/shared';
import { sha256Hex, constantTimeEqual } from '@/lib/api-key-auth';

// ─── Request body schema ──────────────────────────────────────────────────────

const QuizCompletionBodySchema = z.object({
  session_id: z.string().min(1).max(512),
  resolved_archetype: z.string().min(1).max(128),
  branch: z.string().nullable().optional(),
  q1_answer: z.number().int().min(0).max(3).optional(),
  q2_answer: z.number().int().min(0).max(3).nullable().optional(),
  q3_answer: z.number().int().min(0).max(3).nullable().optional(),
  // FOLLOW-931 — derived, not restated. This IS the quiz-widget language, and
  // `QUIZ_LANGUAGE_VALUES` requires every API surface to reference the constant. The identical
  // literal one directory away drifted to `['en', 'pl']` and silently dropped Spanish visitors'
  // consent decisions; correct-today is what that site was too.
  language: QuizLanguageSchema.default('en'),
});

type QuizCompletionBody = z.infer<typeof QuizCompletionBodySchema>;

// ─── Response type ────────────────────────────────────────────────────────────

interface QuizCompletionResponse {
  id: string;
  created_at: string;
}

// ─── HMAC helpers ─────────────────────────────────────────────────────────────

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

// sha256Hex and constantTimeEqual are imported from @/lib/api-key-auth (ADR-0015 / Rule K.1).

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
 * Verify HMAC-SHA256 signature and resolve tenant_id from the authenticated API key.
 * The tenant_id is ALWAYS sourced from the DB lookup — never from the request body.
 *
 * Resolution order:
 *   1. Ops/test fallback: ADAPT_API_KEY env var set AND Bearer matches → tenant_id from ADAPT_TENANT_ID.
 *   2. HMAC path (production): verify X-Estalara-Signature, then SHA-256(Bearer) → api_keys lookup.
 *
 * @internal
 */
async function verifyAndResolveTenant(
  bearerToken: string,
  signatureHeader: string | null,
  rawBody: string,
): Promise<AuthResult | AuthFailure> {
  // ── Ops / integration-test fallback ──────────────────────────────────────
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
  if (!/^[0-9a-f]{64}$/.test(providedHex)) {
    return {
      ok: false,
      status: 401,
      code: ErrorCode.FORBIDDEN,
      message: 'X-Estalara-Signature must be a 64-character lower-case hex SHA-256 HMAC digest',
    };
  }

  const expectedHex = await hmacSha256Hex(bearerToken, rawBody);
  if (!constantTimeEqual(providedHex, expectedHex)) {
    return {
      ok: false,
      status: 401,
      code: ErrorCode.FORBIDDEN,
      message:
        'Invalid or missing HMAC signature. Expected X-Estalara-Signature: HMAC-SHA256(apiKey, body)',
    };
  }

  // HMAC verified. Resolve tenant_id via SHA-256(bearerToken) lookup in api_keys.
  const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!adminUrl) {
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

// ─── DB write with RLS context ────────────────────────────────────────────────

/**
 * Insert a quiz_completions row inside a transaction that first sets
 * app.current_tenant_id (SET LOCAL) so the RLS policy fires at the DB layer.
 *
 * Throws on any DB failure — callers must surface errors to Sentry (Rule K.2).
 *
 * @internal
 */
async function insertWithRlsContext(
  tenantId: string,
  data: QuizCompletionBody,
): Promise<{ id: string; createdAt: Date }> {
  const db = createAdminClient();

  // exactOptionalPropertyTypes-safe conditional spreads for nullable fields.
  const insertData = {
    tenantId,
    sessionId: data.session_id,
    resolvedArchetype: data.resolved_archetype,
    language: data.language,
    ...(data.branch != null ? { branch: data.branch } : {}),
    ...(data.q1_answer != null ? { q1Answer: data.q1_answer } : {}),
    ...(data.q2_answer != null ? { q2Answer: data.q2_answer } : {}),
    ...(data.q3_answer != null ? { q3Answer: data.q3_answer } : {}),
  };

  let id = '';
  let createdAt: Date = new Date();

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;
    // SET LOCAL scopes the setting to this transaction — safe for connection pooling.
    await txDb.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
    const rows = await txDb.insert(quizCompletions).values(insertData).returning({
      id: quizCompletions.id,
      createdAt: quizCompletions.createdAt,
    });
    const row = rows[0];
    if (!row) {
      throw new Error('INSERT into quiz_completions returned no rows');
    }
    id = row.id;
    createdAt = row.createdAt;
  });

  return { id, createdAt };
}

// ─── POST handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/quiz/completion
 *
 * Body:
 *   session_id         — string (required, min 1)
 *   resolved_archetype — string (required, min 1)
 *   branch             — string | null | undefined
 *   q1_answer          — integer 0–3 | undefined
 *   q2_answer          — integer 0–3 | null | undefined
 *   q3_answer          — integer 0–3 | null | undefined
 *   language           — 'en' | 'pl' | 'es' (default 'en')
 *
 * Auth: HMAC-SHA256 tenant-scoped (same as /api/adapt/feedback, FOLLOW-051):
 *   Authorization: Bearer {rawApiKey}
 *   X-Estalara-Signature: {hmacSha256(apiKey, bodyText)}
 *
 * Responses:
 *   201 { id, created_at }   — row persisted.
 *   400 VALIDATION_ERROR     — invalid or malformed body.
 *   401 AUTH_REQUIRED        — missing or invalid auth.
 *   500 INTERNAL_ERROR       — DB failure (fail-loud per Rule K.2).
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
        message: 'Authorization: Bearer <apiKey> header is required',
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

  // ── §H.9 opt-out defense-in-depth gate ───────────────────────────────────
  // If the SDK sends profiling_opt_out=1 as a query parameter, skip persistence
  // and return 200 { skipped: true } without writing to quiz_completions.
  // This mirrors the GET /api/adapt gate (apps/control-plane/src/app/api/adapt/route.ts:667).
  // The ingest stream is NOT suppressed here — it rides §H.8 mandatory registration
  // consent (CEO 2026-06-23/FOLLOW-384). Only the AL profiling persistence is skipped.
  const url = new URL(req.url);
  if (url.searchParams.get('profiling_opt_out') === '1') {
    return NextResponse.json({ skipped: true }, { status: 200 });
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

  const parsed = QuizCompletionBodySchema.safeParse(raw);
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

  // ── DB write with RLS context ─────────────────────────────────────────────
  // Fail-loud: configured DB throws → 500 + Sentry. Never return fabricated 2xx (Rule K.2).
  try {
    const { id, createdAt } = await insertWithRlsContext(tenantId, parsed.data);
    const response: QuizCompletionResponse = {
      id,
      created_at: createdAt.toISOString(),
    };
    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz/completion] DB write failed:', message);

    // Capture to Sentry when configured (Rule K.2: configured-but-failed stores must surface).
    if (typeof process !== 'undefined' && process.env.SENTRY_DSN_CONTROL_PLANE) {
      try {
        const Sentry = await import('@sentry/nextjs');
        Sentry.captureException(err, {
          tags: { route: 'quiz/completion', tenant_id: tenantId },
        });
      } catch {
        // Sentry failure must not mask the real error.
      }
    }

    return NextResponse.json(
      errorBody({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Failed to persist quiz completion',
        requestId,
      }),
      { status: 500 },
    );
  }
}
