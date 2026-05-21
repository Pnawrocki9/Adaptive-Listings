# FOLLOW-019 — Replace deterministicScore djb2 hash with real archetype-listing affinity

**Sprint:** 9.5 **Agent:** ml-engineer **Priority:** P0 **Estimated hours:** 4 **Status:** READY
**Depends on:** — **Unblocks:** — **Model:** opus-4.7-xhigh

## Context

Listing reorder directives are currently scored by `deterministicScore(archetype, listingId)` in
`apps/decision-api/src/lib/reorder.ts:223`. This is a multiplicative hash (djb2-style) that produces
a deterministic but **arbitrary** ordering — it has no relationship to how well a listing matches an
archetype. The demo narrative claims "listing cards reorder by real archetype affinity", which is
false today.

**The existing infrastructure to build on:**

- `archetype_embeddings` table (`packages/db/src/schema/archetype_embeddings.ts`): 1024-dim OpenAI
  `text-embedding-3-small` vectors, one per archetype. Currently seeded with 3 archetypes
  (`investor`, `family`, `neutral`) but will expand to 18.
- `pgvector` extension is installed (used by `archetype_embeddings`, `session_embeddings`,
  `packages/db/src/schema/_pgvector.ts`).
- `session_embeddings` table (`packages/db/src/schema/session_embeddings.ts`): per-session 1024-dim
  behavioral embedding.

**What does NOT yet exist:**

- A `listing_embeddings` table (per-tenant, per-listing embedding vectors)
- A mechanism to compute and store listing embeddings

This ticket creates the listing embeddings infrastructure and replaces the djb2 hash with cosine
similarity. The djb2 fallback must be preserved for listings without embeddings (graceful
degradation).

**The `deterministicScore` function lives in two places** (documented in the existing code):

1. Canonical: `apps/decision-api/src/lib/reorder.ts:223`
2. Copy (acknowledged duplicate): `apps/control-plane/src/app/api/adapt/route.ts` (the
   ReorderDirective helpers section, around line 240)

Both must be updated. The canonical implementation drives the priority — the control-plane copy must
stay in sync per the existing comment.

**References:**

- `apps/decision-api/src/lib/reorder.ts` — `deterministicScore()`, `buildReorderDirective()`
- `apps/control-plane/src/app/api/adapt/route.ts` — duplicated reorder helpers
- `packages/db/src/schema/archetype_embeddings.ts` — archetype vectors
- `packages/db/src/schema/_pgvector.ts` — `vector()` Drizzle column helper
- `docs/MASTER_DESIGN.md` §F (data network effect), §E.1 (listing reorder in adapt path)

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **New `listing_embeddings` table.** A Drizzle migration creates the table:

   ```
   id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
   tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
   listing_id    text NOT NULL
   embedding     vector(1024)   -- pgvector, nullable (null = not yet computed)
   created_at    timestamptz    NOT NULL DEFAULT now()
   updated_at    timestamptz    NOT NULL DEFAULT now()
   UNIQUE (tenant_id, listing_id)
   INDEX on (tenant_id)
   ```

   RLS policy: `tenant can read/write only its own rows` (follow the pattern in
   `packages/db/src/schema/rls-policies.sql`).

2. **Drizzle schema file.** `packages/db/src/schema/listing_embeddings.ts` mirrors the migration.
   Exported from `packages/db/src/schema/index.ts`.

3. **`computeCosineSimilarity(a: number[], b: number[]): number`.** New pure function in
   `packages/shared/src/embeddings.ts` (or a new file in the same package). Computes cosine
   similarity between two vectors of equal length. Returns a float in [0, 1]. Throws `RangeError` if
   vectors have different lengths or zero magnitude.

4. **Affinity scoring in `buildReorderDirective`.** Update `deterministicScore` (or replace the call
   site in `buildReorderDirective`) to: a. Accept optional `archetypeEmbedding: number[] | null` and
   `listingEmbedding: number[] | null` parameters. b. If both are non-null and same length, return
   `computeCosineSimilarity(archetypeEmbedding,    listingEmbedding)`. c. If either is null, fall
   back to the existing djb2 hash and log at debug level:
   `[reorder] embedding missing for (archetype, listing_id) — falling back to djb2`.

   Update **both** locations: `apps/decision-api/src/lib/reorder.ts` and the control-plane copy.

5. **Embedding lookup in the adapt path.** The adapt route must batch-fetch listing embeddings for
   all `listing_ids` in the request from the `listing_embeddings` table (one query, `IN` clause).
   Similarly fetch the archetype embedding from `archetype_embeddings` for the matched archetype.
   Pass both to `buildReorderDirective`. Listings with no embedding row fall back to djb2
   individually (not the whole batch).

6. **Latency guard.** The batch embedding lookup must complete in ≤10ms p95. If total listing count
   exceeds 50, fall back to djb2 for the whole batch and log a Sentry breadcrumb. Do not break the
   adapt path for large listing sets.

7. **`POST /api/listings/embed` ingest endpoint.** A new admin-authenticated route accepts:

   ```json
   {
     "tenant_id": "uuid",
     "listing_id": "string",
     "text_fields": { "title": "...", "description": "...", "price": "...", "location": "..." }
   }
   ```

   Concatenates the text fields, calls OpenAI `text-embedding-3-small` (1024 dims), and upserts to
   `listing_embeddings`. Requires admin JWT or `INTERNAL_API_SECRET` header. This is the seeding
   path for the demo — Piotr can POST a listing to seed its embedding before the demo.

8. **Graceful degradation is non-negotiable.** If `listing_embeddings` has zero rows for a tenant,
   all listings fall back to djb2 and the adapt response is returned normally. Never a 5xx.

9. **Test coverage ≥70%** for `computeCosineSimilarity` and the updated `buildReorderDirective`.

10. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass locally before PR is
    opened.**

## Files to touch (expected)

| File                                                          | Action                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| `packages/db/src/schema/listing_embeddings.ts`                | New Drizzle table definition                                |
| `packages/db/src/schema/index.ts`                             | Export `listingEmbeddings`                                  |
| `packages/db/migrations/`                                     | New Drizzle migration for `listing_embeddings`              |
| `packages/shared/src/embeddings.ts`                           | New file — `computeCosineSimilarity()`                      |
| `packages/shared/src/index.ts`                                | Export new function                                         |
| `apps/decision-api/src/lib/reorder.ts`                        | Update `deterministicScore` call in `buildReorderDirective` |
| `apps/control-plane/src/app/api/adapt/route.ts`               | Update reorder helpers copy + embedding fetch               |
| `apps/control-plane/src/app/api/listings/embed/route.ts`      | New embedding ingest endpoint                               |
| `apps/control-plane/src/app/api/listings/embed/route.test.ts` | Tests for embed endpoint                                    |
| `apps/decision-api/src/lib/__tests__/reorder.test.ts`         | Update tests; add cosine vs djb2 coverage                   |

## Test expectations

### Unit tests (required)

1. **`computeCosineSimilarity` — known vectors.** Call with `[1, 0, 0]` and `[1, 0, 0]`. Assert
   result `=== 1.0`. Call with `[1, 0, 0]` and `[0, 1, 0]`. Assert result `=== 0.0`.

2. **`computeCosineSimilarity` — throws on length mismatch.** Call with vectors of different
   lengths. Assert `RangeError` is thrown.

3. **`buildReorderDirective` — uses cosine when embeddings present.** Pass non-null
   `archetypeEmbedding` and `listingEmbedding`. Assert the score for the listing equals
   `computeCosineSimilarity(archetypeEmbedding, listingEmbedding)` (not a djb2 hash).

4. **`buildReorderDirective` — falls back to djb2 when embedding null.** Pass
   `listingEmbedding: null`. Assert the score equals the deterministic hash value (reproducible —
   call twice with same inputs, assert same value).

5. **Graceful degradation — zero embeddings.** Mock the DB to return empty arrays for both archetype
   and listing embeddings. Assert `buildReorderDirective` returns a `ReorderDirective` with
   non-empty `scores` and no error is thrown.

### Integration test (required)

6. **`POST /api/listings/embed` — upserts and returns 200.** POST with a valid admin credential and
   a `text_fields` body. Mock the OpenAI embedding call. Assert the `listing_embeddings` table has a
   row for the given `(tenant_id, listing_id)`.

## Out of scope

- Computing embeddings at ingest time automatically (next sprint)
- Expanding `archetype_embeddings` from 3 to 18 archetypes (separate ticket)
- Batch embedding computation for existing listings (follow-up after demo)

## Branch naming

`ml-engineer/FOLLOW-019-real-archetype-listing-affinity`

## PR title format

`feat(decision-api,control-plane,db): real archetype-listing affinity — cosine similarity replaces djb2 hash [FOLLOW-019]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
