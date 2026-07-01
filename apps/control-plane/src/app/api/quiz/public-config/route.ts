/**
 * GET /api/quiz/public-config — public SDK runtime fetch endpoint for quiz/widget config.
 *
 * FOLLOW-275 (ADR-0011, path ii — separate public endpoint). The SDK fetches this route at
 * init time to read `{ quiz_enabled, micro_polls_enabled, language, accent_color }`. Because
 * the SDK runs in an anonymous buyer context (no tenant JWT), this route authenticates via
 * the tenant's API key from the embed snippet (`data-api-key`) instead of Supabase Auth.
 *
 * Auth model (ADR-0011 §Implementation Notes, path ii):
 *   - Header: `Authorization: Bearer <tenant-api-key>` (the SDK's `data-api-key` value).
 *   - Lookup: SHA-256(bearerToken) is compared against `api_keys.hashed_key` (constant-time).
 *   - No JWT required — this is a read-only endpoint with no PII in the response.
 *   - Replay resistance: API keys are long-lived bearer tokens; replay risk is accepted for
 *     a read-only, non-PII endpoint (same risk model as the existing ingest SDK key path).
 *     Mutations use HMAC-SHA256 replay resistance (feedback/crm routes). This route is GET only.
 *
 * Rule H auth sign-off (read-only, no mutation):
 *   - Constant-time compare: `constantTimeEqual()` on SHA-256 hash strings.
 *   - Tenant-scoped: `tenant_id` is resolved from the authenticated key, not the request body.
 *   - Cryptographic: SHA-256 hash lookup against `api_keys.hashed_key`.
 *   - Replay-resistant: read-only endpoint; no state mutation, no replay-exploitable surface.
 *     The API key itself is long-lived; replay only reads the same public config already cached
 *     at `Cache-Control: max-age=300`. This is the same risk profile as all SDK ingest calls.
 *
 * CORS: `Access-Control-Allow-Origin: *` — buyer-facing sites (no credentials, no PII).
 * Cache-Control: `max-age=300, stale-while-revalidate=60` — 5-minute TTL reduces DB load.
 *
 * Fail-loud contract (Rule K.2):
 *   - DB configured but throws during auth lookup → 503 `{ error: "Service temporarily
 *     unavailable" }` (FOLLOW-277 fix — previously hard 500, inconsistent with the
 *     tenant-fetch catch which falls soft to 200+fallback; auth failures cannot be
 *     silently served as fallback because we do not know the tenant_id yet, so a 503
 *     is the correct contract: the request is structurally valid but the dependency is
 *     unavailable). Sentry capture still emitted.
 *   - DB configured but throws during tenant fetch → 200 with fallback defaults +
 *     `data_source: 'fallback'` (read-only endpoint; hard 500 would block quiz display
 *     for all buyers if DB hiccups). Sentry capture still emitted.
 *   - Invalid/missing Bearer → 401 `{ error: "Invalid API key" }`.
 *   - Tenant not found (key lookup returns no rows) → 404 `{ error: "Tenant not found" }`.
 *   - Unconfigured DB (dev/CI) → 200 with fallback defaults + `data_source: 'fallback'`.
 *   - Happy path → 200 with `data_source: 'db'` (provenance flag, Rule K.2 / FOLLOW-277).
 *
 * All four response fields are always present — no field is `null`.
 *
 * @module apps/control-plane/src/app/api/quiz/public-config/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';

import { createAdminClient, tenants } from '@estalara/db';
import type { QuizPublicConfigResponse } from '@estalara/shared';
import {
  QUIZ_DEFAULT_CONFIG,
  QuizPublicConfigResponseSchema,
  parseStoredQuizConfig,
} from '@estalara/shared';
import { resolveApiKey } from '@/lib/api-key-auth';

// ─── CORS headers ─────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'max-age=300, stale-while-revalidate=60',
} as const;

// ─── Fallback defaults ────────────────────────────────────────────────────────

/**
 * Fallback returned when the DB is unconfigured (dev/CI) or unavailable.
 * All four fields present and non-nullable (ADR-0011 wire contract).
 */
const FALLBACK_CONFIG: QuizPublicConfigResponse = {
  quiz_enabled: true,
  micro_polls_enabled: QUIZ_DEFAULT_CONFIG.micro_polls_enabled,
  language: QUIZ_DEFAULT_CONFIG.language,
  accent_color: QUIZ_DEFAULT_CONFIG.accent_color,
};

// ─── Route handlers ───────────────────────────────────────────────────────────

/** Handle CORS preflight. */
export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * GET /api/quiz/public-config
 *
 * Returns `{ quiz_enabled, micro_polls_enabled, language, accent_color }` for the
 * authenticated tenant. All fields are always present and non-nullable.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;

  // Unconfigured DB (dev/CI): return fallback immediately without attempting auth.
  if (!adminUrl) {
    const body: QuizPublicConfigResponse & { data_source: 'fallback' } = {
      ...FALLBACK_CONFIG,
      data_source: 'fallback',
    };
    return NextResponse.json(body, {
      status: 200,
      headers: CORS_HEADERS,
    });
  }

  let auth: Awaited<ReturnType<typeof resolveApiKey>>;
  try {
    auth = await resolveApiKey(req);
  } catch (err) {
    // DB threw during auth lookup (FOLLOW-277 fix — was 500, now 503).
    // We cannot fall back to the fallback config here because we have no tenant_id yet —
    // serving fallback to an unauthenticated caller would bypass auth entirely.
    // 503 is correct: the request is structurally valid but the dependency is unavailable.
    // ADR-0011 §Consequences: "on error/timeout, fall back to defaults" applies to the
    // tenant-fetch leg (we know who the tenant is); for the auth leg, 503 is cleaner.
    console.error('[quiz/public-config] auth DB error', err);
    try {
      const { captureException } = await import('@sentry/nextjs');
      captureException(err);
    } catch {
      // Sentry not configured in this env
    }
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: CORS_HEADERS });
  }

  const { tenantId } = auth;

  // ── Fetch tenant quiz config ──────────────────────────────────────────────
  try {
    const db = createAdminClient();
    const rows = await db
      .select({ quizConfig: tenants.quizConfig, quizEnabled: tenants.quizEnabled })
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
      .limit(1);

    const tenantRow = rows[0];
    if (!tenantRow) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    // FOLLOW-271: parseStoredQuizConfig strips any legacy `enabled` / `sticky_widget` keys.
    const stored = parseStoredQuizConfig(tenantRow.quizConfig ?? {});
    const merged = { ...QUIZ_DEFAULT_CONFIG, ...stored };
    const quizEnabled: boolean = tenantRow.quizEnabled;

    const payload: QuizPublicConfigResponse = {
      quiz_enabled: quizEnabled,
      micro_polls_enabled: merged.micro_polls_enabled,
      language: merged.language,
      accent_color: merged.accent_color,
      // FOLLOW-277 (Rule K.2): provenance flag — live DB read.
      data_source: 'db',
    };

    // Validate outbound shape with the canonical schema (belt-and-suspenders).
    const validated = QuizPublicConfigResponseSchema.parse(payload);

    return NextResponse.json(validated, {
      status: 200,
      headers: CORS_HEADERS,
    });
  } catch (err) {
    // DB configured but threw — fail loud per Rule K.2.
    console.error('[quiz/public-config] DB error fetching quiz config', err);
    try {
      const { captureException } = await import('@sentry/nextjs');
      captureException(err);
    } catch {
      // Sentry not configured
    }

    // For this read-only SDK-facing endpoint: return fallback + observable data_source flag
    // rather than a hard 500 (which would block quiz display for all buyers on DB hiccup).
    // The data_source:'fallback' field makes the degraded state observable on the wire (K.2).
    const body: QuizPublicConfigResponse & { data_source: 'fallback' } = {
      ...FALLBACK_CONFIG,
      data_source: 'fallback',
    };
    return NextResponse.json(body, {
      status: 200,
      headers: CORS_HEADERS,
    });
  }
}
