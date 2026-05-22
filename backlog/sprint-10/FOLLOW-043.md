# FOLLOW-043 — Compute archetype embedding vectors (unblock FOLLOW-019 cosine path)

**Sprint:** 10 **Agent:** ml-engineer **Priority:** P0 **Estimated hours:** 3 **Status:**
IN_PROGRESS **Model:** opus-4.7-xhigh (ML/algo rule) **Branch:**
`ml-engineer/FOLLOW-043-archetype-embeddings`

## Context

`packages/db/migrations/0005_seed_archetype_embeddings.sql` inserts 18 archetype rows with
`embedding = NULL`. The seed comment (line 2) says:

> "embedding is NULL — the 1024-dim vector is filled in by the Modal daily job"

**No such job exists.** `grep -rn "archetype_embedding" apps/*-pipeline/` returns 0 results outside
placeholder files.

As a result:

- `apps/control-plane/src/lib/embedding-lookup.ts:fetchArchetypeEmbedding()` returns `null` for
  every archetype
- `affinityScore()` in `apps/control-plane/src/app/api/adapt/route.ts:291` falls back to
  `deterministicScore()` (djb2 hash) for every listing
- FOLLOW-019 (PR #123) headline claim "real archetype-listing affinity replaces djb2" is
  **functionally a no-op in production today**

This ticket builds the one-shot seeding script and documents the refresh cadence.

**Archetype descriptions are already in the DB** — the SQL file inserts the `description` column for
all 18 archetypes (e.g. yield_hunter: "Investor focused on maximizing rental yield..."). The script
only needs to READ those descriptions and call OpenAI embeddings.

**Embedding model:** `text-embedding-3-small` at **1024 dims** (matches `listing_embeddings` table —
see `packages/db/migrations/0013_listing_embeddings.sql` for the pgvector dimension).

## Acceptance criteria

1. **Script at `scripts/seed-archetype-embeddings.ts`** — runnable via:

   ```
   pnpm tsx scripts/seed-archetype-embeddings.ts
   ```

   or added as a `pnpm` script in `package.json` under `"scripts": { "seed:archetypes": "..." }`.

2. **Script logic:**
   - SELECT all rows from `archetype_embeddings` WHERE `embedding IS NULL`
   - For each archetype, call OpenAI `text-embedding-3-small` with `dimensions: 1024` using the
     `description` column as input
   - UPDATE `archetype_embeddings SET embedding = $vector WHERE archetype_name = $name`
   - Log progress: `[seed] archetype_name → vector[0..3] ...` (first 4 dims for visual sanity)
   - On error per archetype: log and continue (don't abort the whole batch)
   - Reads `OPENAI_API_KEY` and `DATABASE_URL_DIRECT` from env (or `.env.local`)

3. **Idempotent.** If run again with all rows already populated, the script no-ops (skips rows WHERE
   `embedding IS NOT NULL`).

4. **Integration test.** Add a test at `scripts/__tests__/seed-archetype-embeddings.test.ts` (or
   `apps/control-plane/src/lib/__tests__/embedding-lookup.test.ts`) that:
   - Seeds a single archetype row with a known 1024-dim vector into a test DB (or mocks the DB)
   - Calls `fetchArchetypeEmbedding('family_buyer')` (from
     `apps/control-plane/src/lib/embedding-lookup.ts`)
   - Asserts the returned vector is a `Float32Array` or `number[]` with length 1024 and non-null

5. **After running the script in dev/staging:**

   ```sql
   SELECT COUNT(*) FROM archetype_embeddings WHERE embedding IS NOT NULL;
   -- must return 18
   ```

   Document this verification command in the script's `--help` / README comment.

6. **Refresh cadence documented.** Add a comment block at the top of the script:

   ```
   // Refresh cadence:
   //   MVP: one-shot manual run after any archetype description change
   //   Post-MVP: daily Modal cron (apps/archetype-pipeline, future FOLLOW-NNN)
   ```

7. **`pnpm typecheck` passes** (no `any` without explanation in the script).

8. **PR description includes** a before/after query:
   - Before: `SELECT archetype_name, embedding IS NULL as missing FROM archetype_embeddings;` → 18
     rows, all missing=true
   - After: → 18 rows, all missing=false

## Key files to read

- `packages/db/migrations/0005_seed_archetype_embeddings.sql` — existing seed (18 rows, NULL
  embeddings)
- `packages/db/src/schema/archetype_embeddings.ts` — Drizzle schema for the table
- `apps/control-plane/src/lib/embedding-lookup.ts` — `fetchArchetypeEmbedding()` consumer
- `apps/control-plane/src/app/api/adapt/route.ts:288-316` — `affinityScore()` + fallback logic
- `packages/db/migrations/0013_listing_embeddings.sql` — listing embeddings table (same dim=1024)

## Definition of done

- Script at `scripts/seed-archetype-embeddings.ts` committed
- Integration test passes in CI
- `gh pr checks <pr-number> --watch` all SUCCESS (ignore: Doppler, Rule I, Python tests)
- PM-orchestrator validates AC items above and comments:
  `PM-validated. CI green. Ready for human review.`
- QUEUE.md: FOLLOW-043 → `READY_FOR_REVIEW`
- Note in PR description: "After merge, run `pnpm seed:archetypes` against dev/staging DB to unblock
  cosine affinity path."
