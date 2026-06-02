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
import { getAuthClaims } from '@estalara/auth';
import { getDemoOverride } from '@/lib/demo-override-store';

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

  // ── DEMO MODE: check per-tenant override (AC5 / DEMO-001) ────────────────
  // When DEMO MODE is active, the SDK already requests the correct archetype
  // (returned in the adapt response). We additionally key the Redis cache by
  // model so switching model busts the cache — mirroring mock-server behaviour
  // (genCache cleared on model switch). Fail-open: demo override read failure
  // falls back to normal (no demo suffix), which is safe.
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
      '[description] demo override DB read failed — using standard cache key:',
      err instanceof Error ? err.message : err,
    );
  }

  // ── Playbook lookup (all tiers) ───────────────────────────────────────────
  const playbook = getPlaybook(archetypeId);
  const templateText =
    localeCode === 'pl'
      ? playbook.copy_template.pl
      : localeCode === 'es'
        ? playbook.copy_template.es
        : playbook.copy_template.en;

  // ── Tier 1: return template immediately, no Redis, no Modal ──────────────
  if (tier === '1') {
    const response: DescriptionResponse = {
      description: templateText,
      source: 'template_fallback',
      locale: localeCode,
      generated_at: null,
    };
    return NextResponse.json(response, { status: 200 });
  }

  // ── Tier 2 / Tier 3: Redis cache lookup ───────────────────────────────────
  // When DEMO MODE is active, the cache key includes the model so switching
  // model busts the cache (demoActive=true, demoOverrideModel non-null).
  const baseCacheKey = descriptionKey(tenantId, listing_id, archetypeId, localeCode);
  const cacheKey =
    demoActive && demoOverrideModel ? `${baseCacheKey}:demo:${demoOverrideModel}` : baseCacheKey;
  const cached = await getCachedDescription(cacheKey);

  if (cached !== null) {
    // Cache HIT — return AI-generated description from Redis.
    const response: DescriptionResponse = {
      description: cached.text,
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
  const listingContext = await retrieveListingContext(tenantId, listing_id, null);

  const event: DescriptionRequestedEvent = {
    tenant_id: tenantId,
    listing_id,
    archetype: archetypeId,
    locale: localeCode,
    tier: tierNum,
    copy_template: templateText,
    listing_context: listingContext,
    cache_key: cacheKey,
    ttl_seconds: ttlSeconds,
    ...(tierNum === 3 ? { priority: 'high' as const, max_tokens: 600 } : { max_tokens: 450 }),
    // AC5 / DEMO-001: pass override_model to Modal job so it generates with the
    // chosen model. Modal job consumer is FOLLOW-166 (ml-engineer).
    ...(demoActive && demoOverrideModel ? { override_model: demoOverrideModel } : {}),
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
  const response: DescriptionResponse = {
    description: templateText,
    source: 'template_fallback',
    locale: localeCode,
    generated_at: null,
  };
  return NextResponse.json(response, { status: 200 });
}
