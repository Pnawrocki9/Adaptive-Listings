/**
 * Listing embedding seeder — fire-and-forget helper for the activation path.
 *
 * Called by POST /api/schema/activate after a tenant's schema is persisted.
 * The activate route wraps the call via `afterResponse(() => seedListingEmbeddingsForActivation(…))`
 * so activation latency is unaffected even when seeding 100+ listings.
 * Enumerates the listings known for the tenant (from the activated schema or,
 * for the canonical demo tenant, from the 000-app-estalara fixture manifest),
 * then calls POST /api/listings/embed for each listing.
 *
 * Design choices:
 *   - afterResponse() wrapped: the activate route registers this function via
 *     afterResponse() (→ next/server after()), NOT via `void fn()`, so Vercel
 *     keeps the instance alive while the loop runs.
 *   - Budget cap (MAX_INLINE_SEED = 50): the Vercel Hobby after() budget is 15s.
 *     At ~200ms per embed call, 50 listings ≈ 10s inline — leaving ~5s headroom.
 *     Listings beyond MAX_INLINE_SEED are NOT silently dropped; overflow is
 *     captured via Sentry + console.warn with the full listing_ids list so an
 *     operator can manually retry or trigger a Modal seed job.
 *     See: TODO FOLLOW-434 — replace overflow stub with Modal job when ready.
 *   - Internal service-to-service auth: uses INTERNAL_API_SECRET header, so
 *     this helper works without a tenant JWT (the tenant JWT belongs to the human
 *     user completing onboarding, not to a background job).
 *   - Idempotent: the embed endpoint uses upsert semantics; re-running is safe.
 *   - Fail-open: per-listing errors are logged and skipped. Activation is never
 *     rolled back because of an embedding failure.
 *
 * Listing discovery order:
 *   1. schema.listing_ids (if the TenantSiteSchema carries pre-enumerated IDs)
 *   2. DEMO_LISTING_MANIFEST — hardcoded for the 000-app-estalara demo tenant
 *      (DEMO_TENANT_ID env var); always safe to seed because listings are stable.
 *   3. No-op — if neither source yields IDs, we log and return.
 *
 * The listing text is derived from the schema's field mappings where available,
 * or from the hardcoded fixture manifest for the demo tenant.
 *
 * @module apps/control-plane/src/lib/seed-listing-embeddings
 */

import * as Sentry from '@sentry/nextjs';
import type { TenantSiteSchema } from '@estalara/shared';
import { publishListingEmbeddingSeed } from './listing-embed-seed-publisher';

// ─── Budget cap ───────────────────────────────────────────────────────────────

/**
 * Maximum number of listings embedded inline within a single after() invocation.
 *
 * Budget reasoning (Vercel Hobby plan):
 *   - after() (next/server) keeps the instance alive for up to 15s on Hobby.
 *   - Each embedOneListing call is ~200ms (OpenAI embedding API round-trip).
 *   - 50 × 200ms = 10s inline, leaving ~5s headroom before the budget expires.
 *   - Any listings beyond this limit are NOT silently dropped — they are reported
 *     to Sentry + console.warn so an operator can retry or a Modal job can pick
 *     them up (TODO: FOLLOW-434 — replace with Modal job when seed-modal-job exists).
 *
 * Raise this value only after verifying the Vercel plan budget or migrating to
 * a durable background job for overflow.
 */
export const MAX_INLINE_SEED = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal text content for a listing to be embedded. */
export interface ListingTextContent {
  listing_id: string;
  title?: string;
  description?: string;
  price?: string;
  location?: string;
}

/** Result of a single listing embed call. */
export interface ListingEmbedResult {
  listing_id: string;
  ok: boolean;
  error?: string;
}

/** Aggregate result of a seeding run. */
export interface SeedListingsResult {
  tenant_id: string;
  attempted: number;
  succeeded: number;
  failed: number;
  /** Number of listings beyond MAX_INLINE_SEED that were deferred (logged + Sentry-captured). */
  overflow_count: number;
  skipped_reason?: string;
}

// ─── Demo tenant manifest ─────────────────────────────────────────────────────

/**
 * Canonical listings for the 000-app-estalara demo fixture, plus the FOLLOW-819
 * differentiator harness's single fixture listing.
 *
 * `listing-001` … `listing-012` are the 12 listings `index-ground-truth.json`
 * expects and match the `data-estalara-listing-id` attributes in
 * `packages/sdk/e2e/fixtures/index.html` (the SDK's own e2e reorder fixture,
 * which declares a subset of them) and the `app.estalara.com` demo pages. They
 * do NOT match `tests/e2e/follow-819/fixture-listing.html` — that harness
 * fixture is a single-listing detail page with its own fixed UUID.
 *
 * The 13th entry, `839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c`, matches that UUID
 * exactly (FOLLOW-1192 / RETRO-324 §4a LG-1: without it, a browser-driven
 * request against the FOLLOW-819 fixture sends a listing id this manifest
 * never seeded, `fetchListingEmbeddings()` finds no row, and the ranker falls
 * back to djb2 even when the archetype side is populated; since FOLLOW-1202 the
 * reorder is withheld instead). Its text content is
 * copied from the fixture's own headline/description so the embedding input
 * matches the page it stands in for.
 *
 * Do not change any listing_id here without updating the HTML fixture that
 * declares the matching attribute.
 */
export const DEMO_LISTING_MANIFEST: ListingTextContent[] = [
  {
    listing_id: 'listing-001',
    title: 'Marbella Villa',
    description:
      'Stunning beachfront villa with private pool and panoramic sea views. 4 bedrooms, 3 bathrooms, 380 sqm of luxury living space.',
    price: '€1,250,000',
    location: 'Marbella, Costa del Sol',
  },
  {
    listing_id: 'listing-002',
    title: 'Algarve Apartment',
    description:
      'Modern 2-bedroom apartment in the heart of Albufeira. Close to beaches, restaurants and golf courses. 95 sqm.',
    price: '€320,000',
    location: 'Albufeira, Algarve, Portugal',
  },
  {
    listing_id: 'listing-003',
    title: 'Tuscany Farmhouse',
    description:
      'Rustic 5-bedroom farmhouse surrounded by vineyards and olive groves. Restored with authentic materials, 450 sqm with private garden.',
    price: '€850,000',
    location: 'Siena, Tuscany, Italy',
  },
  {
    listing_id: 'listing-004',
    title: 'Lisbon City Centre Penthouse',
    description:
      'Luxury penthouse with rooftop terrace and Tagus River views. 3 bedrooms, 2 bathrooms, 210 sqm. Doorman building.',
    price: '€980,000',
    location: 'Chiado, Lisbon, Portugal',
  },
  {
    listing_id: 'listing-005',
    title: 'Barcelona Gothic Quarter Studio',
    description:
      'Charming 1-bedroom studio in historic building. 45 sqm, fully renovated, ideal as a rental investment. 6.1% yield.',
    price: '€245,000',
    location: 'Barri Gòtic, Barcelona, Spain',
  },
  {
    listing_id: 'listing-006',
    title: 'Ibiza Countryside Finca',
    description:
      'Secluded 4-bedroom finca with infinity pool and sea glimpses. 320 sqm on 2 hectares of land. Rental licence included.',
    price: '€2,100,000',
    location: 'San Rafael, Ibiza, Spain',
  },
  {
    listing_id: 'listing-007',
    title: "Côte d'Azur Studio Apartment",
    description:
      'Compact studio 200m from the sea. 32 sqm, south-facing balcony, underground parking. Strong rental yield in high season.',
    price: '€195,000',
    location: "Nice, Côte d'Azur, France",
  },
  {
    listing_id: 'listing-008',
    title: 'Costa Blanca Family Villa',
    description:
      'Spacious 5-bedroom detached villa with private pool and landscaped garden. 430 sqm, quiet urbanisation, garage for 2 cars.',
    price: '€590,000',
    location: 'Jávea, Costa Blanca, Spain',
  },
  {
    listing_id: 'listing-009',
    title: 'Dubai Marina High-Rise Apartment',
    description:
      'Contemporary 2-bedroom apartment in iconic tower. 118 sqm, full marina views, gym and concierge. Freehold for international buyers.',
    price: '€750,000',
    location: 'Dubai Marina, Dubai, UAE',
  },
  {
    listing_id: 'listing-010',
    title: 'Tenerife Oceanfront Duplex',
    description:
      'Oceanfront duplex with direct beach access. 3 bedrooms, 2 bathrooms, 185 sqm. Communal pools, tennis courts and SPA.',
    price: '€680,000',
    location: 'El Médano, Tenerife, Spain',
  },
  {
    listing_id: 'listing-011',
    title: 'Montenegro Kotor Bay Villa',
    description:
      'Newly built 4-bedroom villa with pool overlooking Kotor Bay. 280 sqm, boat mooring available, high-speed internet.',
    price: '€890,000',
    location: 'Kotor, Montenegro',
  },
  {
    listing_id: 'listing-012',
    title: 'Madeira Ocean View Cottage',
    description:
      'Quaint 2-bedroom cottage with wrap-around terrace and Atlantic Ocean views. 110 sqm, tropical garden, 5 min to village.',
    price: '€285,000',
    location: 'Ponta do Sol, Madeira, Portugal',
  },
  {
    // FOLLOW-1192 — matches tests/e2e/follow-819/fixture-listing.html's
    // data-estalara-listing-id exactly. Title/description copied from that
    // fixture's headline and description slots (not invented here).
    listing_id: '839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c',
    title: '9 Blackberry Pl, Palm Coast, FL 32137 — 3 bed, 2 bath',
    description:
      'A three-bedroom, two-bathroom single-family home on a quiet residential street. Open-plan living area, attached two-car garage, screened lanai and a mature garden. Close to schools, the intracoastal waterway and local amenities.',
    location: 'Palm Coast, FL',
  },
];

// ─── Core seeding logic ───────────────────────────────────────────────────────

/**
 * Resolve the base URL for internal API calls.
 * Falls back to localhost:3000 in development when NEXT_PUBLIC_APP_URL is unset.
 */
function resolveBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * POST a single listing's text to /api/listings/embed using INTERNAL_API_SECRET auth.
 *
 * @param baseUrl - The control-plane base URL.
 * @param secret  - The INTERNAL_API_SECRET value.
 * @param tenantId - Tenant UUID.
 * @param listing  - Listing text content.
 * @returns Result indicating success or failure.
 */
export async function embedOneListing(
  baseUrl: string,
  secret: string,
  tenantId: string,
  listing: ListingTextContent,
): Promise<ListingEmbedResult> {
  try {
    const res = await fetch(`${baseUrl}/api/listings/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-secret': secret,
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        listing_id: listing.listing_id,
        text_fields: {
          title: listing.title,
          description: listing.description,
          price: listing.price,
          location: listing.location,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '(unreadable)');
      return {
        listing_id: listing.listing_id,
        ok: false,
        error: `HTTP ${String(res.status)}: ${errText}`,
      };
    }

    return { listing_id: listing.listing_id, ok: true };
  } catch (err) {
    return {
      listing_id: listing.listing_id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Derive listing IDs from a TenantSiteSchema if the schema carries an explicit
 * listing_ids array. Returns an empty array when the schema does not provide IDs.
 *
 * This is a best-effort extraction. Schemas produced by the current detection
 * engine do not enumerate listing IDs — that enumeration would require a live
 * crawl. When no IDs are found we fall back to the demo manifest (if the
 * tenant matches) or return an empty array.
 *
 * Forward-compat: if the schema object carries a `listing_ids: string[]` field
 * (not yet in the canonical TenantSiteSchema type but anticipated — see JSDoc
 * above), those IDs are extracted here and used as the listing source for
 * real-tenant catalogs. This is the mechanism that enables large catalogs
 * (100+ listings) to be seeded, subject to the MAX_INLINE_SEED cap.
 */
export function extractListingIdsFromSchema(schema: TenantSiteSchema): ListingTextContent[] {
  // Safe forward-compat read: schema.listing_ids is not yet in the canonical type
  // but will be added when real-tenant listing enumeration is wired up.
  const raw = schema as unknown as Record<string, unknown>;
  const ids = raw.listing_ids;
  if (!Array.isArray(ids) || ids.length === 0) return [];
  return ids
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map((id) => ({ listing_id: id }));
}

/**
 * Seed listing embeddings for a tenant after schema activation.
 *
 * This is the fire-and-forget function called by POST /api/schema/activate.
 * It must never throw — all errors are caught and logged.
 *
 * Listing discovery:
 *   1. extractListingIdsFromSchema(schema) — schema-embedded IDs (future)
 *   2. DEMO_LISTING_MANIFEST when tenantId === DEMO_TENANT_ID
 *   3. No-op otherwise (logs a warning)
 *
 * @param tenantId - The tenant UUID that just activated.
 * @param schema   - The TenantSiteSchema that was activated.
 * @returns A summary result (for logging/telemetry; callers usually void this).
 */
export async function seedListingEmbeddingsForActivation(
  tenantId: string,
  schema: TenantSiteSchema,
): Promise<SeedListingsResult> {
  const result: SeedListingsResult = {
    tenant_id: tenantId,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    overflow_count: 0,
  };

  try {
    const internalSecret = process.env.INTERNAL_API_SECRET;
    if (!internalSecret) {
      result.skipped_reason = 'INTERNAL_API_SECRET not configured — skipping embedding seed';
      console.warn(
        '[seed-listing-embeddings] INTERNAL_API_SECRET not set. Embedding seed skipped.',
      );
      return result;
    }

    // ── 1. Try schema-embedded listing IDs (future-proof hook) ────────────────
    let listings: ListingTextContent[] = extractListingIdsFromSchema(schema);

    // ── 2. Demo tenant fallback ───────────────────────────────────────────────
    const demoTenantId = process.env.DEMO_TENANT_ID;
    if (listings.length === 0 && demoTenantId && tenantId === demoTenantId) {
      listings = DEMO_LISTING_MANIFEST;
      console.log(
        `[seed-listing-embeddings] Demo tenant detected — seeding ${String(listings.length)} fixture listings.`,
      );
    }

    // ── 3. No listings discoverable ───────────────────────────────────────────
    if (listings.length === 0) {
      result.skipped_reason =
        'No listing IDs discoverable from schema and tenant is not the demo tenant';
      console.log(
        `[seed-listing-embeddings] tenant=${tenantId}: no listings to seed (schema does not embed listing IDs; not demo tenant).`,
      );
      return result;
    }

    const baseUrl = resolveBaseUrl();

    // ── Cap inline work to MAX_INLINE_SEED (Vercel after() budget guard) ──────
    // Vercel Hobby: 15s budget. At ~200ms/call, 50 × 200ms ≈ 10s (5s headroom).
    // Overflow listings are NOT silently dropped — they are enqueued to the
    // `estalara.listing-embeddings` Redpanda topic so the Modal background job
    // (ml-engineer, FOLLOW-435 LEG 2) can embed them durably without manual retry.
    // A Sentry breadcrumb is also emitted for observability.
    const inline = listings.slice(0, MAX_INLINE_SEED);
    const overflow = listings.slice(MAX_INLINE_SEED);

    result.attempted = inline.length;
    result.overflow_count = overflow.length;

    if (overflow.length > 0) {
      const overflowIds = overflow.map((l) => l.listing_id);
      const msg =
        `[seed-listing-embeddings] OVERFLOW: tenant=${tenantId} has ${String(overflow.length)} ` +
        `listings beyond MAX_INLINE_SEED=${String(MAX_INLINE_SEED)}. ` +
        `Enqueueing to estalara.listing-embeddings for Modal processing (FOLLOW-435). ` +
        `overflow_listing_ids=${JSON.stringify(overflowIds)}`;
      console.warn(msg);
      Sentry.captureMessage(msg, {
        level: 'warning',
        tags: {
          area: 'onboarding',
          sink: 'seed-listing-embeddings',
          kind: 'overflow',
        },
        extra: {
          tenant_id: tenantId,
          overflow_count: overflow.length,
          overflow_listing_ids: overflowIds,
          max_inline_seed: MAX_INLINE_SEED,
        },
      });
      // Enqueue overflow listing_ids to the durable Modal seed job.
      // publishListingEmbeddingSeed never throws — failures are captured to Sentry
      // internally (Rule K.2). This function already runs inside afterResponse() so
      // awaiting here is safe and does NOT add a bare void (FOLLOW-433 FF-guard).
      await publishListingEmbeddingSeed({ tenant_id: tenantId, listing_ids: overflowIds });
    }

    // Sequential to avoid overwhelming OpenAI quota; each call is ~200ms.
    for (const listing of inline) {
      const embedResult = await embedOneListing(baseUrl, internalSecret, tenantId, listing);
      if (embedResult.ok) {
        result.succeeded += 1;
        console.log(
          `[seed-listing-embeddings] tenant=${tenantId} listing=${listing.listing_id} → embedded`,
        );
      } else {
        result.failed += 1;
        console.error(
          `[seed-listing-embeddings] tenant=${tenantId} listing=${listing.listing_id} → FAILED: ${embedResult.error ?? 'unknown'}`,
        );
      }
    }
  } catch (err) {
    // Outer catch: should not happen, but fail-open always.
    console.error(
      '[seed-listing-embeddings] Unexpected error during seeding:',
      err instanceof Error ? err.message : err,
    );
  }

  console.log(
    `[seed-listing-embeddings] done. tenant=${tenantId} attempted=${String(result.attempted)} succeeded=${String(result.succeeded)} failed=${String(result.failed)}`,
  );
  return result;
}
