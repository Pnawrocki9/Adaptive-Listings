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
 *   - Budget cap (FOLLOW-1297, ADR-0023 §6 G-06): every listing is
 *     embedded in a bounded-concurrency batch (SEED_HOP_CONCURRENCY) under a wall-clock budget
 *     (SEED_HOP_BUDGET_MS); the not-yet-processed remainder is the checkpoint and is requeued
 *     to `POST /api/internal/listings/embed-seed`, which runs the same hop in its own after()
 *     (`runEmbedSeedHop`). A listing that failed is retried once on the next hop, then
 *     reported with its id. Depth is bounded at MAX_REQUEUE_DEPTH.
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
import type { ListingEmbeddingSeedRequestedEvent } from '@estalara/shared';

// ─── Budget cap ───────────────────────────────────────────────────────────────

/** G-06: listings embedded concurrently on one hop. */
const SEED_HOP_CONCURRENCY = 4;
/** G-06: wall-clock budget of one hop; what has not STARTED by then is the checkpoint. */
const SEED_HOP_BUDGET_MS = 10_000;
/** G-06: hops after which the remainder is reported instead of requeued (= the schema's max). */
const MAX_REQUEUE_DEPTH = 20;

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
  /**
   * The database the server reported writing to (FOLLOW-1193) — host/port/name,
   * never credentials. Absent when the server predates the field.
   */
  database?: SeedDatabaseTarget;
}

/** Credential-free database identity reported by `POST /api/listings/embed`. */
export interface SeedDatabaseTarget {
  host: string;
  port: string;
  name: string;
}

/** Aggregate result of a seeding run. */
export interface SeedListingsResult {
  tenant_id: string;
  attempted: number;
  succeeded: number;
  failed: number;
  /** Number of listings handed to the next hop (the checkpoint plus first-time failures). */
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

    const database = await readDatabaseTarget(res);
    return database
      ? { listing_id: listing.listing_id, ok: true, database }
      : { listing_id: listing.listing_id, ok: true };
  } catch (err) {
    return {
      listing_id: listing.listing_id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Read the `database` field of a 200 embed response. Tolerant by design: the
 * upsert already succeeded, so an unreadable or older-shape body must never turn
 * the result into a failure — it just yields no database.
 */
async function readDatabaseTarget(res: Response): Promise<SeedDatabaseTarget | undefined> {
  try {
    const body = (await res.json()) as { database?: Partial<SeedDatabaseTarget> };
    const db = body.database;
    if (
      db &&
      typeof db.host === 'string' &&
      typeof db.port === 'string' &&
      typeof db.name === 'string'
    )
      return { host: db.host, port: db.port, name: db.name };
  } catch {
    // Non-JSON / empty body — no database reported.
  }
  return undefined;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/**
 * True when a LOOPBACK control plane reported a NON-loopback database — the
 * split-brain FOLLOW-1193 exists for. The operator started a local plane, so the
 * archetype half they seeded is local, but this plane was started with a hosted
 * `DATABASE_URL_ADMIN` (e.g. a bare `doppler run -c dev`), so the listing half is
 * landing in the shared hosted project instead. A hosted plane reporting a hosted
 * database is the intended hosted path and is not flagged.
 *
 * Consumed by scripts/seed-estalara-listings.ts, which stops on it.
 */
export function isSplitSeedTarget(baseUrl: string, database: SeedDatabaseTarget): boolean {
  let planeHost: string;
  try {
    planeHost = new URL(baseUrl).hostname;
  } catch {
    return false;
  }
  return LOOPBACK_HOSTS.has(planeHost) && !LOOPBACK_HOSTS.has(database.host);
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
 * (100+ listings) to be seeded, one budgeted hop at a time (`runEmbedSeedHop`).
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
 * @param schema   - The TenantSiteSchema that was activated, or `null` when the tenant has no
 *                   stored schema (the operator issuance script, FOLLOW-1327 — the demo-manifest
 *                   fallback below still applies).
 * @returns A summary result (for logging/telemetry; callers usually void this).
 */
export async function seedListingEmbeddingsForActivation(
  tenantId: string,
  schema: TenantSiteSchema | null,
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
    let listings: ListingTextContent[] = schema ? extractListingIdsFromSchema(schema) : [];

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

    // ── One hop, checkpoint, internal requeue (FOLLOW-1297 G-06) ──────────────
    const hop = await runEmbedSeedHop({
      tenantId,
      listings,
      retryIds: new Set(),
      requeueDepth: 0,
    });
    result.attempted = listings.length - hop.remaining;
    result.succeeded = hop.succeeded;
    result.failed = hop.failed.length;
    result.overflow_count = hop.remaining;
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

// ─── G-06: bounded-concurrency batch, checkpoint and requeue (FOLLOW-1297, ADR-0023 §6) ────

interface EmbedBatchOutcome {
  succeeded: string[];
  failed: string[];
  /** Listings that had not STARTED when the budget ran out — the checkpoint. */
  remaining: ListingTextContent[];
}

/**
 * Embed `listings` with `concurrency` workers pulling from one queue until the wall-clock budget
 * elapses. A listing that started always finishes; what did not start is `remaining`.
 */
async function embedBatch(
  baseUrl: string,
  secret: string,
  tenantId: string,
  listings: readonly ListingTextContent[],
  opts: { concurrency: number; budgetMs: number },
): Promise<EmbedBatchOutcome> {
  const succeeded: string[] = [];
  const failed: string[] = [];
  const startedAt = Date.now();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < listings.length && Date.now() - startedAt < opts.budgetMs) {
      const listing = listings[next];
      if (listing === undefined) break;
      next += 1;
      const embedResult = await embedOneListing(baseUrl, secret, tenantId, listing);
      if (embedResult.ok) {
        succeeded.push(listing.listing_id);
        console.log(
          `[seed-listing-embeddings] tenant=${tenantId} listing=${listing.listing_id} → embedded`,
        );
      } else {
        failed.push(listing.listing_id);
        console.error(
          `[seed-listing-embeddings] tenant=${tenantId} listing=${listing.listing_id} → FAILED: ${embedResult.error ?? 'unknown'}`,
        );
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency, listings.length) }, () => worker()),
  );
  return { succeeded, failed, remaining: listings.slice(next) };
}

/** What one hop did; the route logs it, the activation path folds it into its result. */
interface EmbedSeedHopResult {
  succeeded: number;
  /** Listings that failed on their RETRY — reported, not requeued again. */
  failed: string[];
  /** Listings handed to the next hop (checkpoint + first-time failures). */
  remaining: number;
  /** Whether the remainder was accepted by the requeue route (`false` also when `remaining` is 0). */
  requeued: boolean;
}

/**
 * One embed-seed hop (G-06): embed what fits the budget with bounded concurrency, retry a
 * first-time failure on the next hop, report a second failure, and requeue the remainder to
 * `POST /api/internal/listings/embed-seed` with `requeue_depth + 1` — up to MAX_REQUEUE_DEPTH,
 * after which the remainder is reported (Sentry `kind: 'requeue_depth_exhausted'`) instead.
 * Never throws.
 */
export async function runEmbedSeedHop(input: {
  tenantId: string;
  listings: readonly ListingTextContent[];
  retryIds: ReadonlySet<string>;
  requeueDepth: number;
}): Promise<EmbedSeedHopResult> {
  const { tenantId, listings, retryIds, requeueDepth } = input;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.warn('[seed-listing-embeddings] INTERNAL_API_SECRET not set. Embed-seed hop skipped.');
    return { succeeded: 0, failed: [], remaining: listings.length, requeued: false };
  }
  const baseUrl = resolveBaseUrl();
  const batch = await embedBatch(baseUrl, secret, tenantId, listings, {
    concurrency: SEED_HOP_CONCURRENCY,
    budgetMs: SEED_HOP_BUDGET_MS,
  });
  const retryNow = batch.failed.filter((id) => !retryIds.has(id));
  const reported = batch.failed.filter((id) => retryIds.has(id));
  if (reported.length > 0) {
    const msg =
      `[seed-listing-embeddings] tenant=${tenantId} ${String(reported.length)} listing(s) failed ` +
      `on their retry: ${JSON.stringify(reported)}`;
    console.error(msg);
    Sentry.captureMessage(msg, {
      level: 'warning',
      tags: { area: 'onboarding', sink: 'seed-listing-embeddings', kind: 'embed_retry_failed' },
      extra: { tenant_id: tenantId, listing_ids: reported, requeue_depth: requeueDepth },
    });
  }
  const nextIds = [...batch.remaining.map((l) => l.listing_id), ...retryNow];
  let requeued = false;
  if (nextIds.length > 0) {
    if (requeueDepth >= MAX_REQUEUE_DEPTH) {
      const msg =
        `[seed-listing-embeddings] tenant=${tenantId} requeue depth ${String(requeueDepth)} ` +
        `exhausted with ${String(nextIds.length)} listing(s) unprocessed: ${JSON.stringify(nextIds)}`;
      console.error(msg);
      Sentry.captureMessage(msg, {
        level: 'warning',
        tags: {
          area: 'onboarding',
          sink: 'seed-listing-embeddings',
          kind: 'requeue_depth_exhausted',
        },
        extra: { tenant_id: tenantId, listing_ids: nextIds, requeue_depth: requeueDepth },
      });
    } else {
      const payload: ListingEmbeddingSeedRequestedEvent = {
        tenant_id: tenantId,
        listing_ids: nextIds,
        requeue_depth: requeueDepth + 1,
        ...(retryNow.length > 0 ? { retry_listing_ids: retryNow } : {}),
      };
      try {
        const res = await fetch(`${baseUrl}/api/internal/listings/embed-seed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify(payload),
        });
        requeued = res.ok;
        if (!res.ok) throw new Error(`requeue rejected: HTTP ${String(res.status)}`);
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        console.error(`[seed-listing-embeddings] tenant=${tenantId} requeue failed: ${e.message}`);
        Sentry.captureException(e, {
          tags: { area: 'onboarding', sink: 'seed-listing-embeddings', kind: 'requeue_failed' },
          extra: {
            tenant_id: tenantId,
            listing_count: nextIds.length,
            requeue_depth: requeueDepth,
          },
        });
      }
    }
  }
  console.log(
    `[seed-listing-embeddings] hop done tenant=${tenantId} depth=${String(requeueDepth)} ` +
      `succeeded=${String(batch.succeeded.length)} failed=${String(reported.length)} ` +
      `remaining=${String(nextIds.length)} requeued=${String(requeued)}`,
  );
  return {
    succeeded: batch.succeeded.length,
    failed: reported,
    remaining: nextIds.length,
    requeued,
  };
}
