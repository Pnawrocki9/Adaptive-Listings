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
 * All four ADR-0011 core response fields are always present — no field is `null`.
 *
 * ADR-0019 (FOLLOW-623): the response is now the SUPERSET `PresentationConfigResponse`. It
 * carries an OPTIONAL `brand` slice read from `tenants.brand_config` (`primary_color`,
 * `logo_url`, `white_label`) — the same jsonb column written by `/api/config` PATCH
 * (PR #616 / FOLLOW-627). The slice is OMITTED when the tenant configured no brand (the
 * column defaults to `{}`), so an unconfigured tenant is byte-identical to pre-ADR-0019 and
 * the SDK falls back to hardcoded widget defaults (ADR-0019 D4). `brand.logo_url` is
 * `string | null` on the wire, never `undefined` (ADR-0019 D-nullability). The `brand` slice
 * rides the same `data_source` provenance (Rule K.2): a `fallback` response carries no brand.
 *
 * ADR-0019 (FOLLOW-639): the response ALSO carries an OPTIONAL `quiz_definition` slice — the
 * tenant's ACTIVE row from the dedicated `quiz_definitions` table (D2), re-validated with
 * `QuizDefinitionSchema` on read. Omitted when the tenant has no active/valid definition, so an
 * unconfigured tenant is byte-identical to pre-ADR-0019 and the SDK walks its built-in default
 * tree (D4/D5). Like `brand`, it rides `data_source` (a `fallback` response carries no definition).
 *
 * @module apps/control-plane/src/app/api/quiz/public-config/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';

import { createAdminClient, quizDefinitions, tenants } from '@estalara/db';
import type {
  BrandConfig,
  PresentationConfigResponse,
  QuizDefinition,
  QuizPublicConfigResponse,
} from '@estalara/shared';
import {
  BrandConfigSchema,
  PresentationConfigResponseSchema,
  QUIZ_DEFAULT_CONFIG,
  QuizDefinitionSchema,
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

// ─── Brand slice (ADR-0019 / FOLLOW-623) ──────────────────────────────────────

/**
 * Parse the `tenants.brand_config` jsonb blob into the public wire `brand` slice.
 *
 * Returns `undefined` when the tenant has NOT configured a brand — the column defaults to
 * `{}` (`packages/db/src/schema/tenants.ts`), so an object with no `primary_color` string
 * means "unconfigured": we omit the slice and the SDK falls back to hardcoded widget defaults
 * (ADR-0019 D4, byte-identical to pre-ADR-0019). `logo_url` is coerced to `string | null`,
 * never `undefined` (ADR-0019 D-nullability), mirroring the `/api/config` write path's
 * `parseStoredBrandConfig`. A blob that fails `BrandConfigSchema` (e.g. a malformed stored
 * color) is dropped rather than allowed to break the whole quiz-config response.
 */
function parsePublicBrandConfig(raw: unknown): BrandConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  // Unconfigured tenant (empty `{}` default) → omit the slice (D4 byte-identical).
  if (typeof obj.primary_color !== 'string') return undefined;
  const candidate = {
    primary_color: obj.primary_color,
    logo_url: typeof obj.logo_url === 'string' ? obj.logo_url : null,
    white_label: typeof obj.white_label === 'boolean' ? obj.white_label : false,
  };
  const result = BrandConfigSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
}

// ─── Quiz-definition slice (ADR-0019 / FOLLOW-639) ─────────────────────────────

/**
 * Parse the stored `quiz_definitions.definition` JSONB into the public wire slice.
 *
 * The definition is re-validated with `QuizDefinitionSchema` on read (belt-and-suspenders —
 * it was already validated on write). A stored blob that fails validation (e.g. an archetype
 * later renamed out of `CANONICAL_ARCHETYPE_IDS`) is DROPPED rather than allowed to break the
 * whole quiz-config response: the SDK then falls back to its built-in default tree (D4/D5),
 * which is the correct fail-safe for a read-only buyer-facing endpoint. Returns `undefined`
 * when there is no active definition or it fails validation, so the slice is omitted and an
 * unconfigured tenant is byte-identical to pre-ADR-0019.
 */
function parseActiveQuizDefinition(raw: unknown): QuizDefinition | undefined {
  const result = QuizDefinitionSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}

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
      .select({
        quizConfig: tenants.quizConfig,
        quizEnabled: tenants.quizEnabled,
        // ADR-0019 (FOLLOW-623): the brand slice rides this same tenant fetch.
        brandConfig: tenants.brandConfig,
      })
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

    // ADR-0019 (FOLLOW-623): optional brand slice from `tenants.brand_config`.
    const brand = parsePublicBrandConfig(tenantRow.brandConfig);

    // ADR-0019 (FOLLOW-639): optional quiz-definition slice — the tenant's ACTIVE editable
    // tree, if any. A separate fenced read on the dedicated `quiz_definitions` table (D2).
    const activeDefRows = await db
      .select({ definition: quizDefinitions.definition })
      .from(quizDefinitions)
      // invariant 5: the tenant fence on this service-role client.
      .where(and(eq(quizDefinitions.tenantId, tenantId), eq(quizDefinitions.isActive, true)))
      .limit(1);
    const quizDefinition = activeDefRows[0]
      ? parseActiveQuizDefinition(activeDefRows[0].definition)
      : undefined;

    const payload: PresentationConfigResponse = {
      quiz_enabled: quizEnabled,
      micro_polls_enabled: merged.micro_polls_enabled,
      language: merged.language,
      accent_color: merged.accent_color,
      // FOLLOW-277 (Rule K.2): provenance flag — live DB read.
      data_source: 'db',
      // Conditional spread (exactOptionalPropertyTypes): omit the key when unconfigured
      // rather than assign `undefined`, so an unbranded tenant is byte-identical (D4).
      ...(brand ? { brand } : {}),
      // Omit the key when the tenant has no active/valid definition → SDK built-in default (D4/D5).
      ...(quizDefinition ? { quiz_definition: quizDefinition } : {}),
    };

    // Validate outbound shape with the canonical superset schema (belt-and-suspenders).
    // MUST be the presentation schema, not the ADR-0011 subset — the subset would STRIP
    // the `brand` slice on parse (Zod drops unknown keys).
    const validated = PresentationConfigResponseSchema.parse(payload);

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
