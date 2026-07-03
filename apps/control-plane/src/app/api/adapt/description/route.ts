/**
 * GET /api/adapt/description
 *
 * Long-form listing description pipeline.
 *
 * Per Master Design E.7, TICKET-DESC-001, and CEO decision 2026-06-05 (FOLLOW-203):
 * Tier logic has been removed. All tenants receive the same generation path.
 *
 * Cache hit:
 *   Returns the AI-generated description from Upstash Redis.
 *   No Modal job enqueued. Latency target <100ms p95.
 *
 * Cache miss:
 *   Returns copy_template.en immediately (template_fallback).
 *   Enqueues Modal async job (fire-and-forget) to generate + cache the AI description.
 *   Latency target <150ms p95.
 *
 * Auth:
 *   Bearer JWT (same pattern as GET /api/adapt). When ADAPT_API_KEY env var is set,
 *   the token is validated against it. When unset, any non-empty token is accepted
 *   (backward compat with dev/test environments).
 *
 * Lookup order per Master Design §E.7.2 (FOLLOW-204):
 *   1. description_cache_persistent (Postgres) — if found and not invalidated → return
 *   2. Upstash Redis (hot-path fast cache) — if found → return + async backfill Postgres
 *   3. template_fallback immediately + fire-and-forget Modal enqueue
 *
 * Source values in response:
 *   - `template_fallback` — returned from PlaybookEntry.copy_template (no Redis involved)
 *   - `ai_cached`         — returned from Upstash Redis or Postgres (Modal job completed earlier)
 *
 * Note: `ai_generated` is NOT a valid source value from this endpoint. The endpoint never
 * waits for AI generation — it always returns immediately. The `ai_cached` source is used
 * once Redis is populated, regardless of whether the caller is the first or Nth after generation.
 *
 * @module apps/control-plane/src/app/api/adapt/description/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { afterResponse } from '@/lib/after-response';
import * as Sentry from '@sentry/nextjs';
import { errorBody, ErrorCode } from '@estalara/shared';
import type { DescriptionResponse, DescriptionRequestedEvent } from '@estalara/shared';
import { getPlaybook } from '@estalara/sdk/playbooks';
import { descriptionKey, getCachedDescription } from '@/lib/description-cache';
import { retrieveListingContext } from '@/lib/rag-retrieval';
import { fetchListingOriginalDescription } from '@/lib/listing-details';
import { getAuthClaims } from '@estalara/auth';
import { getDemoOverride } from '@/lib/demo-override-store';
import { getGlobalGenerationModel } from '@/lib/global-config-store';
import { getPgCachedDescription, insertPgCachedDescription } from '@/lib/description-pg-cache';

// ─── Query parameter schema ───────────────────────────────────────────────────

const QueryParamsSchema = z.object({
  listing_id: z.string().min(1).max(256),
  archetype: z.enum([
    'yield_hunter',
    'vacation_rental_investor',
    'flip_investor',
    'portfolio_builder',
    'golden_visa_buyer',
    'commercial_investor',
    'family_buyer',
    'first_time_buyer',
    'upsizer',
    'downsizer',
    'luxury_buyer',
    'remote_worker',
    'lifestyle_expat',
    'retiree_relocator',
    'diaspora_buyer',
    'second_home_buyer',
    'student_parent',
    'neutral',
  ]),
  locale: z.enum(['en', 'pl', 'es']).default('en'),
});

// ─── Modal direct-invocation publisher (ADR-0016 / FOLLOW-485) ────────────────

/**
 * Dispatch a `description.requested` event directly to the Modal HTTPS web endpoint.
 *
 * ADR-0016: the prod Redpanda cluster is Serverless, whose HTTP Proxy is BYOC/
 * Dedicated-only (out of pilot budget), so the description pipeline no longer
 * publishes to Redpanda. Instead this POSTs the same event JSON straight to the
 * Modal function's authenticated web endpoint (`MODAL_DESCRIPTION_URL`), which
 * validates the payload and calls `generate_description.spawn(event)`.
 *
 * Fire-and-forget — this function returns immediately and never throws. The HTTP
 * request runs in the background; both a non-2xx response and a network failure
 * are captured to Sentry with `kind: 'dispatch_failed'` so dashboards can group
 * them (FOLLOW-426 / Rule K.2 fire-and-forget amendment, carried over to Modal).
 *
 * @param event - The event payload to dispatch.
 */
function publishDescriptionRequested(event: DescriptionRequestedEvent): Promise<void> {
  // Returns a promise so callers can register it via after() and guarantee
  // completion after the response is sent (FOLLOW-431 / ESC-033).
  const modalUrl = process.env.MODAL_DESCRIPTION_URL;
  if (!modalUrl) {
    const msg = '[description] MODAL_DESCRIPTION_URL not set — skipping Modal dispatch (ADR-0016)';
    console.warn(msg);
    Sentry.addBreadcrumb({
      category: 'description',
      message: msg,
      level: 'warning',
    });
    return Promise.resolve();
  }

  const internalApiSecret = process.env.INTERNAL_API_SECRET ?? '';

  // Returns the fetch promise so after() can await it for guaranteed completion
  // (FOLLOW-431 / ESC-033). Both failure paths capture to Sentry so a Modal
  // auth / validation / outage rejection is observable (FOLLOW-426 / Rule K.2
  // fire-and-forget amendment). The .catch() handler covers network-layer
  // failures; the .then() handler covers HTTP-level rejections (4xx/5xx), which
  // `fetch` resolves (not rejects) and a bare `.catch()` would be blind to.
  return fetch(modalUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${internalApiSecret}`,
    },
    body: JSON.stringify(event),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '<unreadable body>');
        const msg = `[description] Modal dispatch rejected: HTTP ${String(res.status)} — ${body.slice(0, 500)}`;
        console.error(msg);
        Sentry.captureException(new Error(msg), {
          tags: { area: 'description', sink: 'modal', kind: 'dispatch_failed' },
          extra: { status: res.status },
        });
      }
    })
    .catch((err: unknown) => {
      // Network-layer failure (DNS, connection refused, malformed URL, timeout).
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[description] Modal dispatch failed:', msg);
      Sentry.captureException(err instanceof Error ? err : new Error(msg), {
        tags: { area: 'description', sink: 'modal', kind: 'dispatch_failed' },
      });
    });
}

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/adapt/description
 *
 * Query params:
 *   listing_id — required, string (1–256 chars)
 *   archetype  — required, one of the 18 archetype IDs
 *   locale     — optional, 'en' | 'pl' | 'es' (default: 'en')
 *
 * @returns 200 DescriptionResponse JSON.
 * @returns 400 on invalid/missing params.
 * @returns 401 when Authorization header is absent or token is invalid.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  // ── Auth gate — same pattern as GET /api/adapt ────────────────────────────
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.AUTH_REQUIRED,
        message: 'Authorization: Bearer <key> header is required',
        requestId,
      }),
      { status: 401 },
    );
  }
  const adaptApiKey = process.env.ADAPT_API_KEY;
  if (adaptApiKey && token !== adaptApiKey) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.FORBIDDEN,
        message: 'Invalid API key',
        requestId,
      }),
      { status: 401 },
    );
  }
  // When ADAPT_API_KEY is unset: presence-only auth — backward compat with dev.

  // ── Extract tenant_id from JWT (best-effort) ──────────────────────────────
  const claims = await getAuthClaims(req);
  const tenantId = claims?.tenant_id ?? req.headers.get('x-tenant-id') ?? 'unknown';

  // ── Parse and validate query params ──────────────────────────────────────
  const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = QueryParamsSchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid query parameters',
        requestId,
        details: parsed.error.flatten(),
      }),
      { status: 400 },
    );
  }

  const { listing_id, archetype, locale } = parsed.data;
  const archetypeId = archetype;
  const localeCode = locale;

  // ── Playbook lookup ───────────────────────────────────────────────────────
  const playbook = getPlaybook(archetypeId);
  const templateText =
    localeCode === 'pl'
      ? playbook.copy_template.pl
      : localeCode === 'es'
        ? playbook.copy_template.es
        : playbook.copy_template.en;

  // ── DEMO MODE: check per-tenant override (DEMO-001) ─────────────────────
  // When DEMO MODE is active, the SDK already requests the correct archetype
  // (returned in the adapt response). We additionally key the Redis cache by
  // model so switching model busts the cache — mirroring mock-server behaviour
  // (genCache cleared on model switch). Fail-open: demo override read failure
  // falls back to normal path, which is safe.
  let demoActive = false;
  let demoOverrideModel: string | null = null;
  try {
    const demoState = await getDemoOverride(tenantId);
    if (demoState.enabled && demoState.overrideArchetype) {
      demoActive = true;
      demoOverrideModel = demoState.overrideModel;
    }
  } catch (err: unknown) {
    // Fail-open — demo override read failure is not fatal for the description path.
    console.error(
      '[description] demo override DB read failed — using standard path:',
      err instanceof Error ? err.message : err,
    );
  }

  // ── Global generation model (FOLLOW-161) ─────────────────────────────────
  // Read the admin-configured global default. Fail-open: getGlobalGenerationModel()
  // returns the static default when DB is not configured or returns an error.
  // This value is used ONLY when DEMO MODE is inactive (demoActive=false).
  let globalModel: string;
  try {
    globalModel = await getGlobalGenerationModel();
  } catch (err: unknown) {
    // Configured DB threw — log but use the default so the request still completes.
    console.error(
      '[description] global config DB read failed — using default model:',
      err instanceof Error ? err.message : err,
    );
    globalModel = 'claude-sonnet-4-6';
  }

  // ── Effective generation model — precedence chain (AC3 / AC5) ─────────────
  // demo override_model > global generation_model > (implicit default in Python job)
  // The Python job _resolve_generation_model() applies its own allow-list validation,
  // so both fields here are safe to forward as-is.
  const effectiveModel: string =
    demoActive && demoOverrideModel
      ? demoOverrideModel // DEMO MODE wins
      : globalModel; // global default (may equal the static default)

  // ── Step 1: Postgres permanent cache lookup (FOLLOW-204 / Master Design §E.7.2) ──
  // Postgres is the durable truth; Redis is the hot-path cache.
  // On a Postgres hit we warm Redis (fire-and-forget) and return immediately.
  // On a Postgres miss or DB error (fail-open) we fall through to Redis.
  const pgHit = await getPgCachedDescription(tenantId, listing_id, archetypeId, localeCode);
  if (pgHit !== null) {
    // Postgres HIT — warm Redis with the cached value (fire-and-forget).
    // Build the Redis key the same way the Modal job would so the hot path is primed.
    const baseCacheKeyForWarm = descriptionKey(tenantId, listing_id, archetypeId, localeCode);
    const warmKey =
      demoActive && demoOverrideModel
        ? `${baseCacheKeyForWarm}:demo:${demoOverrideModel}`
        : `${baseCacheKeyForWarm}:${globalModel}`;
    // FOLLOW-432 / Rule K.2: wrapped in afterResponse() so the Redis warm write
    // completes after the response is sent rather than being dropped on Vercel suspension.
    afterResponse(async () => {
      try {
        const { setCachedDescription } = await import('@/lib/description-cache');
        await setCachedDescription(warmKey, {
          text: pgHit.description,
          headline: pgHit.headline ?? undefined,
          generated_at: pgHit.generatedAt,
        });
      } catch (err: unknown) {
        console.error(
          '[description] Redis warm-up from Postgres hit failed (non-fatal):',
          err instanceof Error ? err.message : err,
        );
      }
    });

    const response: DescriptionResponse = {
      description: pgHit.description,
      headline: pgHit.headline ?? null,
      source: 'ai_cached',
      locale: localeCode,
      generated_at: pgHit.generatedAt,
    };
    return NextResponse.json(response, { status: 200 });
  }

  // ── Step 2: Redis cache lookup ────────────────────────────────────────────
  // Cache key includes the effective model so a model switch yields a cache miss
  // instead of serving a stale-model description (AC5 / FOLLOW-161).
  //
  // Key structure:
  //   - Standard path: `desc:{tenant}:{listing}:{archetype}:{locale}:{model}`
  //   - DEMO MODE:     `desc:{tenant}:{listing}:{archetype}:{locale}:demo:{model}`
  //
  // The model suffix is always included in the standard path (not just DEMO MODE)
  // so that changing the global default busts the cache correctly.
  const baseCacheKey = descriptionKey(tenantId, listing_id, archetypeId, localeCode);
  const cacheKey =
    demoActive && demoOverrideModel
      ? `${baseCacheKey}:demo:${demoOverrideModel}`
      : `${baseCacheKey}:${globalModel}`;
  const cached = await getCachedDescription(cacheKey);

  if (cached !== null) {
    // Redis HIT — return AI-generated description (and headline when present).
    // Async backfill to Postgres so the durable cache is populated (FOLLOW-204 §E.7.2 step 2).
    // FOLLOW-432 / Rule K.2: wrapped in afterResponse() so the Postgres write completes
    // after the response is sent rather than being dropped on Vercel suspension.
    afterResponse(() =>
      insertPgCachedDescription(
        tenantId,
        listing_id,
        archetypeId,
        localeCode,
        cached.text,
        cached.headline ?? null,
        effectiveModel,
      ).catch((err: unknown) => {
        console.error(
          '[description] Postgres backfill from Redis hit failed (non-fatal):',
          err instanceof Error ? err.message : err,
        );
      }),
    );

    // headline is optional in DescriptionCacheValue (pre-ADR-0009 entries lack it).
    // Normalise absent/undefined to null so the SDK always sees a consistent field.
    const response: DescriptionResponse = {
      description: cached.text,
      headline: cached.headline ?? null,
      source: 'ai_cached',
      locale: localeCode,
      generated_at: cached.generated_at,
    };
    return NextResponse.json(response, { status: 200 });
  }

  // ── Cache MISS — enqueue Modal job (fire-and-forget) ─────────────────────
  // RAG retrieval of listing context for prompt seeding.
  // retrieveListingContext is fail-open — returns {} on any error.
  // We do NOT pass an intent_vector here (not available at this endpoint) — the Modal job
  // will receive whatever context we have. For now this is empty without intent_vector.
  // A future follow-up can wire intent_vector through the query params if needed.
  //
  // original_description is the factual source of truth the Modal job grounds both the
  // adapted description AND the per-listing headline in (ESC-018 / ADR-0009). There is no
  // listings table in our Postgres, so we fetch it from the Estalara backend listing-details
  // API — the same source the mock decision harness uses. Both calls are fail-open and run
  // in parallel to keep the cache-miss path within its latency budget.
  const [listingContext, originalDescription] = await Promise.all([
    retrieveListingContext(tenantId, listing_id, null),
    fetchListingOriginalDescription(listing_id, localeCode),
  ]);

  // FOLLOW-457 AC1 (ESC-019 residual gap): fetchListingOriginalDescription fails
  // open to '' on any 302/timeout/non-2xx/malformed-JSON/missing-field outcome, and
  // an empty original leaves the Modal job's Sonnet call with (at best) whatever
  // thin listing_context RAG returned — near-ungrounded copy. Rather than enqueue
  // that job and hope the v1.8 thin-original exception saves it, fail loud here and
  // skip generation entirely: capture to Sentry so a genuine fetch failure is
  // observable, and do not publish the description.requested event. The response
  // below is unaffected — it is always template_fallback on a cache miss.
  if (originalDescription === '') {
    const msg =
      `[description] empty original_description — skipping AI generation (no grounding ` +
      `source) tenant=${tenantId} listing=${listing_id} archetype=${archetypeId}`;
    console.error(msg);
    Sentry.captureException(new Error(msg), {
      tags: { area: 'description', kind: 'empty_original_description' },
      extra: { tenantId, listingId: listing_id, archetype: archetypeId, locale: localeCode },
    });
  } else {
    const event: DescriptionRequestedEvent = {
      tenant_id: tenantId,
      listing_id,
      archetype: archetypeId,
      locale: localeCode,
      copy_template: templateText,
      original_description: originalDescription,
      listing_context: listingContext,
      cache_key: cacheKey,
      max_tokens: 500,
      // Precedence chain: demo override_model > global generation_model > default (in Python job).
      // - DEMO MODE: override_model carries the operator-chosen model (DEMO-001 / FOLLOW-166).
      // - Standard path: generation_model carries the global admin setting (FOLLOW-161).
      // The Python _resolve_generation_model() validates both against its allow-list.
      ...(demoActive && demoOverrideModel
        ? { override_model: demoOverrideModel }
        : { generation_model: effectiveModel }),
    };

    // FOLLOW-431 / ESC-033: registered via after() so the async Redpanda publish (and its
    // fail-loud Sentry capture) completes after the response is sent before instance suspension.
    // Response is not blocked — after() runs post-response while keeping the instance alive.
    afterResponse(() => publishDescriptionRequested(event));
  }

  // Return template fallback immediately.
  // headline is null on cold-start — SDK keeps the playbook headline directive (ADR-0009).
  const response: DescriptionResponse = {
    description: templateText,
    headline: null,
    source: 'template_fallback',
    locale: localeCode,
    generated_at: null,
  };
  return NextResponse.json(response, { status: 200 });
}
