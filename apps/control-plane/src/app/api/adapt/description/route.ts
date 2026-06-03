/**
 * GET /api/adapt/description
 *
 * Long-form listing description pipeline — Tier 1 / 2 / 3 gated.
 *
 * Per Master Design E.7 and TICKET-DESC-001.
 *
 * Tier 1 (Observer):
 *   Returns copy_template.en from the playbook registry immediately.
 *   No Redis, no Modal job. Latency target <50ms p95.
 *
 * Tier 2 (Augment) — cache hit:
 *   Returns the AI-generated description from Upstash Redis.
 *   No Modal job enqueued. Latency target <100ms p95.
 *
 * Tier 2 (Augment) — cache miss:
 *   Returns copy_template.en immediately (template_fallback).
 *   Enqueues Modal async job (fire-and-forget) to generate + cache the AI description.
 *   Latency target <150ms p95.
 *
 * Tier 3 (Native):
 *   Same as Tier 2 but TTL is 48h (vs 72h for Tier 2) and Modal job priority is 'high'.
 *
 * Auth:
 *   Bearer JWT (same pattern as GET /api/adapt). When ADAPT_API_KEY env var is set,
 *   the token is validated against it. When unset, any non-empty token is accepted
 *   (backward compat with dev/test environments).
 *
 * Source values in response:
 *   - `template_fallback` — returned from PlaybookEntry.copy_template (no Redis involved)
 *   - `ai_cached`         — returned from Upstash Redis (Modal job completed earlier)
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
import { errorBody, ErrorCode } from '@estalara/shared';
import type { DescriptionResponse, DescriptionRequestedEvent } from '@estalara/shared';
import { getPlaybook } from '@estalara/sdk/playbooks';
import {
  descriptionKey,
  getCachedDescription,
  TTL_TIER2_SECONDS,
  TTL_TIER3_SECONDS,
} from '@/lib/description-cache';
import { retrieveListingContext } from '@/lib/rag-retrieval';
import { fetchListingOriginalDescription } from '@/lib/listing-details';
import { getAuthClaims } from '@estalara/auth';
import { getDemoOverride } from '@/lib/demo-override-store';
import { getGlobalGenerationModel } from '@/lib/global-config-store';

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
  tier: z.enum(['1', '2', '3']),
  locale: z.enum(['en', 'pl', 'es']).default('en'),
});

// ─── Redpanda publisher ────────────────────────────────────────────────────────

/**
 * Publish a `description.requested` event to the Redpanda topic `estalara.descriptions`.
 *
 * Fire-and-forget — callers must NOT await this function in the request path.
 * Errors are caught and logged; they do not propagate to callers.
 *
 * The ml-engineer's Modal job subscribes to this topic and generates the description
 * asynchronously, then writes the result to Upstash Redis.
 *
 * @param event - The event payload to publish.
 */
async function publishDescriptionRequested(event: DescriptionRequestedEvent): Promise<void> {
  const redpandaUrl = process.env.REDPANDA_REST_URL;
  if (!redpandaUrl) return;

  const topic = process.env.REDPANDA_TOPIC_DESCRIPTIONS ?? 'estalara.descriptions';
  const url = `${redpandaUrl.replace(/\/$/, '')}/topics/${topic}`;

  const username = process.env.REDPANDA_REST_USERNAME;
  const password = process.env.REDPANDA_REST_PASSWORD;

  const headers: Record<string, string> = {
    'Content-Type': 'application/vnd.kafka.json.v2+json',
    Accept: 'application/vnd.kafka.v2+json',
  };
  if (username && password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ records: [{ value: event }] }),
  });
}

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/adapt/description
 *
 * Query params:
 *   listing_id — required, string (1–256 chars)
 *   archetype  — required, one of the 18 archetype IDs
 *   tier       — required, '1' | '2' | '3'
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

  const { listing_id, archetype, tier, locale } = parsed.data;
  const archetypeId = archetype;
  const localeCode = locale;

  // ── Playbook lookup (all tiers) ───────────────────────────────────────────
  const playbook = getPlaybook(archetypeId);
  const templateText =
    localeCode === 'pl'
      ? playbook.copy_template.pl
      : localeCode === 'es'
        ? playbook.copy_template.es
        : playbook.copy_template.en;

  // ── Tier 1: return template immediately, no Redis, no Modal ──────────────
  // Short-circuit before any DB calls — Tier 1 never needs the generation model.
  // headline is always null for Tier 1 (no LLM generation; ADR-0009).
  if (tier === '1') {
    const response: DescriptionResponse = {
      description: templateText,
      headline: null,
      source: 'template_fallback',
      locale: localeCode,
      generated_at: null,
    };
    return NextResponse.json(response, { status: 200 });
  }

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

  // ── Tier 2 / Tier 3: Redis cache lookup ───────────────────────────────────
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
    // Cache HIT — return AI-generated description (and headline when present) from Redis.
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
  const tierNum = parseInt(tier, 10) as 2 | 3;
  const ttlSeconds = tierNum === 3 ? TTL_TIER3_SECONDS : TTL_TIER2_SECONDS;

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

  const event: DescriptionRequestedEvent = {
    tenant_id: tenantId,
    listing_id,
    archetype: archetypeId,
    locale: localeCode,
    tier: tierNum,
    copy_template: templateText,
    original_description: originalDescription,
    listing_context: listingContext,
    cache_key: cacheKey,
    ttl_seconds: ttlSeconds,
    ...(tierNum === 3 ? { priority: 'high' as const, max_tokens: 600 } : { max_tokens: 450 }),
    // Precedence chain: demo override_model > global generation_model > default (in Python job).
    // - DEMO MODE: override_model carries the operator-chosen model (DEMO-001 / FOLLOW-166).
    // - Standard path: generation_model carries the global admin setting (FOLLOW-161).
    // The Python _resolve_generation_model() validates both against its allow-list.
    ...(demoActive && demoOverrideModel
      ? { override_model: demoOverrideModel }
      : { generation_model: effectiveModel }),
  };

  // Fire-and-forget: do NOT await. Response must not block on Modal enqueue.
  void publishDescriptionRequested(event).catch((err: unknown) => {
    // Analytics / enqueue failures must never surface to callers.
    console.error(
      '[description] Redpanda publish failed:',
      err instanceof Error ? err.message : err,
    );
  });

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
