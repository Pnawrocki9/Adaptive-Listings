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
 *   No generation started. Latency target <100ms p95.
 *
 * Cache miss:
 *   Returns copy_template.en immediately (template_fallback).
 *   Starts the in-process generation in `after()` to generate + cache the AI description.
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
 *   3. template_fallback immediately + generation in `after()`
 *
 * Source values in response:
 *   - `template_fallback` — returned from PlaybookEntry.copy_template (no Redis involved)
 *   - `ai_cached`         — returned from Upstash Redis or Postgres (a generation completed earlier)
 *
 * Note: `ai_generated` is NOT a valid source value from this endpoint. The endpoint never
 * waits for AI generation — it always returns immediately. The `ai_cached` source is used
 * once Redis is populated, regardless of whether the caller is the first or Nth after generation.
 *
 * FOLLOW-465 (negative-cache NEUTRAL verdicts): a cache hit (Postgres or Redis) whose
 * `verdict` is `'NEUTRAL'` (ADR-0010 archetype-fit gate declined to adapt) is served as
 * `template_fallback` — the SAME shape a cold-start cache miss returns — and does NOT
 * start another generation. This is an internal cache-shape distinction only: the
 * wire contract never gains a new `source` value, and the SDK sees no change. Without
 * this short-circuit a NEUTRAL verdict was indistinguishable on the wire from "nothing
 * cached yet", so every repeat request re-triggered a fresh (uncapped) Sonnet 4.6 call.
 *
 * FOLLOW-1305 (legacy admission, FOLLOW-820 condition 1c): a FIT hit (Postgres or Redis) is
 * served only when it carries the current `CLAIMS_VALIDATION_VERSION` — proof its text passed
 * the unsupported-claim check before the generator wrote it. A FIT hit without it was written
 * before the check existed; it is treated as a MISS (fall through to the next layer, then the
 * cache-miss path, which regenerates it once under the check). It is not re-checked on read:
 * that needs the listing's text, i.e. a backend fetch on every hit of this <100ms path, while a
 * miss costs one regeneration per legacy row, once. The warm/backfill writers below copy the
 * stamp, so neither can launder a legacy entry into a trusted one.
 *
 * FOLLOW-1291 (revision fence, Codex F-03/F-17): every layer is fenced by the listing's revision
 * (`listing_revisions`, advanced by the listing.updated webhook — a LOCAL revision, see
 * `lib/description-pg-cache.ts` for its source and the upstream-lag limit) and keyed on the model:
 *   - Postgres serves a row only at a revision >= the current one;
 *   - the Redis key ends in `:r{revision}`, so an entry written for an older revision is never
 *     read again once the listing moves on (the key itself is the fence — no compare needed);
 *   - the revision is read BEFORE the grounding source is fetched and travels on the
 *     description.requested event, so a job that straddles a listing.updated publishes nothing;
 *   - every Postgres write (the generator, the Redis backfill below) is one atomic,
 *     revision-fenced UPSERT (`publishPgCachedDescription`).
 * If the revision cannot be read from a configured DB, the request fails CLOSED: template_fallback,
 * no Redis read, no generation.
 *
 * FOLLOW-1291 (CEO ruling D10): the Redis layer stays — see MASTER_DESIGN §E.7.3.
 *
 * FOLLOW-1297 (ADR-0023): on a cache miss the generation runs in this process, in `after()`:
 * `generateDescription()` from `lib/description-generator.ts`. The Modal app that did it before
 * (`apps/llm-gateway`) is deleted.
 *
 * @module apps/control-plane/src/app/api/adapt/description/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { afterResponse } from '@/lib/after-response';
import * as Sentry from '@sentry/nextjs';
import { errorBody, ErrorCode, ArchetypeIdSchema } from '@estalara/shared';
import type { DescriptionResponse, DescriptionRequestedEvent } from '@estalara/shared';
import { getPlaybook } from '@estalara/shared/playbooks';
import { descriptionKey, getCachedDescription } from '@/lib/description-cache';
import { retrieveListingContext } from '@/lib/rag-retrieval';
import { fetchDescriptionGrounding } from '@/lib/listing-facts-context';
import { resolveAdaptGetAuth, type AdaptGetAuthResult } from '@/lib/adapt-get-auth';
import { getDemoOverride } from '@/lib/demo-override-store';
import { getGlobalGenerationModel } from '@/lib/global-config-store';
import {
  getListingRevision,
  getPgCachedDescription,
  insertPgCachedDescription,
} from '@/lib/description-pg-cache';
import { isTrustedDescriptionHit } from '@/lib/claim-containment';
import { generateDescription } from '@/lib/description-generator';

/**
 * FOLLOW-1297 (ADR-0023 §6 G-03): the in-process generation runs in `after()`, whose work counts
 * against the function's duration. 120 s = the budget the retired Modal job had; the two Anthropic deadlines
 * (75 s + 20 s) and the cache writes fit under it.
 */
export const maxDuration = 120;

// ─── Query parameter schema ───────────────────────────────────────────────────

const QueryParamsSchema = z.object({
  listing_id: z.string().min(1).max(256),
  // Canonical archetype ID set (FOLLOW-586) — imported from @estalara/shared instead of
  // a hand-maintained inline copy; see packages/shared/src/archetypes.ts.
  archetype: ArchetypeIdSchema,
  locale: z.enum(['en', 'pl', 'es']).default('en'),
});

type Locale = z.infer<typeof QueryParamsSchema>['locale'];

/**
 * Build the `template_fallback` response shape (FOLLOW-465).
 *
 * Used both for a genuine cache miss AND for a NEUTRAL negative-cache hit
 * (ADR-0010 archetype-fit gate) — from the wire's perspective the two cases are
 * identical: the caller gets the agent's static copy and no headline.
 */
function templateFallbackResponse(templateText: string, localeCode: Locale): DescriptionResponse {
  return {
    description: templateText,
    headline: null,
    source: 'template_fallback',
    locale: localeCode,
    generated_at: null,
  };
}

/**
 * The Redis key of one cache entry (FOLLOW-1291): the base key, the model segment (`{model}` or
 * `demo:{model}`) and the listing revision the entry was grounded at. One builder for the read
 * key, the warm-up key and the job's key, so the three cannot drift.
 */
function revisionedCacheKey(baseKey: string, modelSegment: string, revision: number): string {
  return `${baseKey}:${modelSegment}:r${String(revision)}`;
}

// ─── In-process generation (ADR-0023) ─────────────────────────────────────────

/**
 * Generate the description in this process (FOLLOW-1297, ADR-0023). Never rejects:
 * `generateDescription` never throws and captures its own failures.
 */
function dispatchDescriptionGeneration(event: DescriptionRequestedEvent): Promise<void> {
  return generateDescription(event).then((report) => {
    console.log(
      `[description] in-process generation tenant=${event.tenant_id} listing=${event.listing_id} ` +
        `archetype=${event.archetype} outcome=${JSON.stringify(report.outcome)} ` +
        `has_headline=${String(report.headline !== null)} writes=${JSON.stringify(report.writes)}`,
    );
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

  // ── Auth gate — FOLLOW-473 (RETRO-158 / FOLLOW-510): fail-closed, tenant
  // derived server-side. SAME two-step resolver as GET /api/adapt (Rule S —
  // symmetric siblings): ADAPT_API_KEY ops-bypass scoped to OPS_TENANT_ID OR
  // resolveApiKey() SHA-256 bearer → api_keys → real tenant. Replaces the prior
  // presence-only ADAPT_API_KEY check (fail-open when unset) and the spoofable
  // x-tenant-id header trust. x-tenant-id is NO LONGER a tenant authority.
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

  // FOLLOW-532: resolveAdaptGetAuth no longer throws on a configured-but-failed
  // DB lookup — it catches internally and returns a `dbError: true` disposition
  // (Sentry-captured inside the helper), so this call site no longer needs its
  // own try/catch. This pins parity with the sibling route in ../route.ts —
  // both now share the exact same fail-loud branch instead of duplicating it.
  const authResult: AdaptGetAuthResult = await resolveAdaptGetAuth(req, token, 'description');
  if (!authResult.ok) {
    return NextResponse.json(
      errorBody({
        code: authResult.status === 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.FORBIDDEN,
        message: authResult.message,
        requestId,
      }),
      { status: authResult.status },
    );
  }
  // Tenant is ALWAYS the server-derived value (ops secret → OPS_TENANT_ID, or the
  // authenticated api_keys row) — never a caller-supplied header (F-05 invariant).
  const tenantId = authResult.tenantId;

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
  // The lookup is model-scoped (F-15 / FOLLOW-464): pass effectiveModel — the SAME
  // precedence-chain value (demo override_model > global generation_model) used to
  // build the Redis Step-2 cacheKey below — so a model switch (including the DEMO
  // override_model preview) yields a miss here rather than a stale-model FIT hit or
  // a cross-model NEUTRAL negative-cache short-circuit (RETRO-162 LG-1).
  const pgHit = await getPgCachedDescription(
    tenantId,
    listing_id,
    archetypeId,
    localeCode,
    effectiveModel,
  );
  // FOLLOW-1305: an unstamped FIT row is legacy — not trusted, so it is not a hit.
  const pgTrusted =
    pgHit !== null && isTrustedDescriptionHit(pgHit.verdict, pgHit.claimsValidation);
  if (pgHit !== null && !pgTrusted) {
    console.warn(
      `[description] legacy Postgres hit without claim validation served as a miss ` +
        `tenant=${tenantId} listing=${listing_id} archetype=${archetypeId}`,
    );
  }
  if (pgHit !== null && pgTrusted) {
    // FOLLOW-465: a NEUTRAL row is a negative-cache marker (ADR-0010 archetype-fit
    // gate declined to adapt this listing/archetype pair) — short-circuit to
    // template_fallback (identical shape to a cache miss) and skip BOTH the Redis
    // warm-up (nothing useful to warm — the generator already wrote the same
    // NEUTRAL marker directly to Redis) and the regeneration below. This is the
    // fix: without it, a NEUTRAL verdict was indistinguishable from "nothing
    // cached yet" and every repeat request re-triggered a fresh Sonnet 4.6 call.
    if (pgHit.verdict === 'NEUTRAL') {
      return NextResponse.json(templateFallbackResponse(templateText, localeCode), {
        status: 200,
      });
    }

    // Postgres HIT — warm Redis with the cached value (fire-and-forget).
    // Build the Redis key the same way the generator would so the hot path is primed.
    // FOLLOW-1291: at the ROW's revision (it passed the read fence, so it is the current one) —
    // if the listing moves on before this write lands, the key is simply never read.
    const warmKey = revisionedCacheKey(
      descriptionKey(tenantId, listing_id, archetypeId, localeCode),
      demoActive && demoOverrideModel ? `demo:${demoOverrideModel}` : globalModel,
      pgHit.listingRevision,
    );
    // FOLLOW-432 / Rule K.2: wrapped in afterResponse() so the Redis warm write
    // completes after the response is sent rather than being dropped on Vercel suspension.
    afterResponse(async () => {
      try {
        const { setCachedDescription } = await import('@/lib/description-cache');
        await setCachedDescription(warmKey, {
          text: pgHit.description,
          headline: pgHit.headline ?? undefined,
          generated_at: pgHit.generatedAt,
          // FOLLOW-1305: carry the stamp — the warmed entry is exactly as trusted as the row.
          ...(pgHit.claimsValidation ? { claims_validation: pgHit.claimsValidation } : {}),
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

  // ── Revision fence (FOLLOW-1291) ──────────────────────────────────────────
  // Read the listing's revision BEFORE the Redis lookup and BEFORE the grounding fetch below: the
  // Redis key and the generation job both carry it, so a listing.updated that lands after this
  // point makes them stale rather than letting them publish pre-update facts. A configured DB that
  // cannot answer means nothing can be fenced: fail closed (the seller's copy, no generation).
  const listingRevision = await getListingRevision(tenantId, listing_id);
  if (listingRevision === null) {
    const msg =
      `[description] listing revision unreadable — serving template_fallback without Redis or ` +
      `generation tenant=${tenantId} listing=${listing_id} archetype=${archetypeId}`;
    console.error(msg);
    Sentry.captureException(new Error(msg), {
      tags: { area: 'description', kind: 'listing_revision_unavailable' },
      extra: { tenantId, listingId: listing_id, archetype: archetypeId, locale: localeCode },
    });
    return NextResponse.json(templateFallbackResponse(templateText, localeCode), { status: 200 });
  }

  // ── Step 2: Redis cache lookup ────────────────────────────────────────────
  // Cache key includes the effective model so a model switch yields a cache miss
  // instead of serving a stale-model description (AC5 / FOLLOW-161), and the listing
  // revision so an entry written before a listing.updated is never read (FOLLOW-1291).
  //
  // Key structure:
  //   - Standard path: `desc:{tenant}:{listing}:{archetype}:{locale}:{model}:r{revision}`
  //   - DEMO MODE:     `desc:{tenant}:{listing}:{archetype}:{locale}:demo:{model}:r{revision}`
  //
  // The model suffix is always included in the standard path (not just DEMO MODE)
  // so that changing the global default busts the cache correctly.
  const cacheKey = revisionedCacheKey(
    descriptionKey(tenantId, listing_id, archetypeId, localeCode),
    demoActive && demoOverrideModel ? `demo:${demoOverrideModel}` : globalModel,
    listingRevision,
  );
  const redisHit = await getCachedDescription(cacheKey);
  // FOLLOW-1305: same legacy admission as the Postgres layer.
  const cached =
    redisHit !== null && isTrustedDescriptionHit(redisHit.verdict, redisHit.claims_validation)
      ? redisHit
      : null;
  if (redisHit !== null && cached === null) {
    console.warn(
      `[description] legacy Redis hit without claim validation served as a miss ` +
        `tenant=${tenantId} listing=${listing_id} archetype=${archetypeId}`,
    );
  }

  if (cached !== null) {
    // FOLLOW-465: a NEUTRAL row is a negative-cache marker — same short-circuit as
    // the Postgres-hit branch above. Skip the Postgres backfill (the generator
    // already wrote the NEUTRAL marker directly to Postgres — FOLLOW-460 path) and
    // skip the regeneration below.
    if (cached.verdict === 'NEUTRAL') {
      return NextResponse.json(templateFallbackResponse(templateText, localeCode), {
        status: 200,
      });
    }

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
        // FOLLOW-1305: copy the stamp the trusted Redis entry carries.
        cached.claims_validation ?? null,
        // FOLLOW-1291: the revision of the key the entry was read from — the backfill goes
        // through the same atomic, revision-fenced publish as the generator's write.
        listingRevision,
      ),
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

  // ── Cache MISS — generate in after() (fire-and-forget) ─────────────────────
  // RAG retrieval of agency FAQ answers. retrieveListingContext is fail-open — returns {} on any
  // error — and returns {} here by construction: no intent_vector is available at this endpoint.
  //
  // original_description AND the listing's own structured fields (title, price, location) are the
  // factual source of truth the generator grounds both the adapted description AND the per-listing
  // headline in (ESC-018 / ADR-0009, ESC-076). There is no listings table in our Postgres, so both
  // come from ONE fetch of the Estalara backend listing-details API. FOLLOW-1314: before, only the
  // description was read and listing_context was the always-empty RAG map, so the headline check
  // never saw the place or title the listing itself carries. Agency-curated FAQ answers win on a
  // key clash, as in withListingFacts. Both calls are fail-open and run in parallel.
  const [ragContext, grounding] = await Promise.all([
    retrieveListingContext(tenantId, listing_id, null),
    fetchDescriptionGrounding(listing_id, localeCode),
  ]);
  const originalDescription = grounding.originalDescription;
  const listingContext: Record<string, string> = { ...grounding.fields, ...ragContext };

  // FOLLOW-457 AC1 (ESC-019 residual gap): fetchDescriptionGrounding fails
  // open to '' on any 302/timeout/non-2xx/malformed-JSON/missing-field outcome, and
  // an empty original leaves the generator's Sonnet call with (at best) whatever
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
      // FOLLOW-1291: read above, before the grounding fetch — the callback publishes only at a
      // revision >= the listing's current one.
      listing_revision: listingRevision,
      max_tokens: 500,
      // Precedence chain: demo override_model > global generation_model > default (in Python job).
      // - DEMO MODE: override_model carries the operator-chosen model (DEMO-001 / FOLLOW-166).
      // - Standard path: generation_model carries the global admin setting (FOLLOW-161).
      // The Python _resolve_generation_model() validates both against its allow-list.
      ...(demoActive && demoOverrideModel
        ? { override_model: demoOverrideModel }
        : { generation_model: effectiveModel }),
    };

    // FOLLOW-431 / ESC-033: registered via after() so the async dispatch or in-process generation
    // (and its fail-loud Sentry capture) completes after the response is sent before instance
    // suspension. Response is not blocked — after() runs post-response while keeping the instance
    // alive.
    afterResponse(() => dispatchDescriptionGeneration(event));
  }

  // Return template fallback immediately.
  // headline is null on cold-start — SDK keeps the playbook headline directive (ADR-0009).
  return NextResponse.json(templateFallbackResponse(templateText, localeCode), { status: 200 });
}
