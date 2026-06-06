# FOLLOW-204 — description_cache_persistent: permanent Postgres description table

**Sprint:** 15 **Agent:** data-engineer + backend-engineer + ml-engineer **Priority:** P1
**Estimated hours:** 8 **Status:** READY **Source:** Audit §10.3, Master_Design §E.7.3 v4.0
**Promoted:** 2026-06-05

---

## Context

Master_Design v4.0 §E.7 CEO decision (2026-06-05): descriptions generated for a
`listing × archetype × locale` combination must persist permanently — no TTL expiry. The current
system uses Redis with TTL (72h / 48h by tier), meaning descriptions expire and are regenerated.
After the first warm-up pass, Modal call rate should drop to near-zero for active listings.

The new lookup order per §E.7.2:

1. `description_cache_persistent` (Postgres) → if found and not invalidated → return immediately
2. Upstash Redis (hot-path fast cache) → if found → return + async backfill to Postgres
3. `template_fallback` immediately + fire-and-forget Modal job enqueue

The `listing.updated` webhook must invalidate the Postgres cache row (set `invalidated_at = NOW()`).

This is a co-assigned ticket (data-engineer: migration, backend-engineer: route + webhook,
ml-engineer: Modal write). Step 5d integration check required before READY_FOR_REVIEW.

## Scope

1. **New Postgres migration** (data-engineer):

   ```sql
   CREATE TABLE description_cache_persistent (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id     text NOT NULL,
     listing_id    text NOT NULL,
     archetype     text NOT NULL,
     locale        text NOT NULL DEFAULT 'pl',
     description   text NOT NULL,
     headline      text,
     model         text NOT NULL,
     generated_at  timestamptz NOT NULL DEFAULT now(),
     invalidated_at timestamptz,
     UNIQUE (tenant_id, listing_id, archetype, locale)
   );
   ```

   RLS: `tenant_id` isolation. Migration journal timestamp monotonicity enforced (Rule O).

2. **`apps/llm-gateway/src/jobs/generate_description.py`** (ml-engineer):
   - After generating description + headline: write row to `description_cache_persistent` via
     psycopg2/asyncpg in addition to the existing Redis write.
   - No TTL parameter passed to Redis SET (TTL removed per FOLLOW-203).

3. **`apps/control-plane/src/app/api/adapt/description/route.ts`** (backend-engineer):
   - Implement the 3-step lookup order above.
   - Step 1:
     `SELECT FROM description_cache_persistent WHERE tenant_id=$1 AND listing_id=$2 AND archetype=$3 AND locale=$4 AND invalidated_at IS NULL`.
   - Step 2: Check Upstash Redis. If found → return + async backfill `description_cache_persistent`.
   - Step 3: Return `{ source: 'template_fallback' }` immediately + enqueue Modal job.

4. **`apps/control-plane/src/app/api/webhooks/listing-updated/route.ts`** (backend-engineer):
   - Add:
     `UPDATE description_cache_persistent SET invalidated_at = NOW() WHERE listing_id = $1 AND tenant_id = $2`.
   - Existing Redis SCAN+DEL stays as hot-cache invalidation.

5. **Admin UI** (backend-engineer):
   - Extend `/dashboard/listings/[id]` page to show a table:
     `archetype | locale | description | headline | generated_at | [Regenerate]`.
   - "Regenerate" button sets `invalidated_at = NOW()` on the row and enqueues a new Modal job.

## Acceptance criteria

- [ ] AC1: Migration creates `description_cache_persistent` with all columns, RLS, and UNIQUE
      constraint. Journal timestamp monotonic (Rule O).
- [ ] AC2: First Modal generation writes to both Redis and `description_cache_persistent`.
- [ ] AC3: Subsequent requests (even after Redis eviction) are served from
      `description_cache_persistent` without triggering a new Modal job.
- [ ] AC4: `listing.updated` webhook sets `invalidated_at = NOW()` on the matching rows. Next
      request triggers fresh generation.
- [ ] AC5: Admin can see descriptions per `listing × archetype` at `/dashboard/listings/[id]`.
- [ ] AC6: Co-assigned integration check (step 5d): grep confirms Modal Python write (producer)
      connects to route lookup (consumer) in non-test code.
- [ ] AC7: Tests green. CI green.

## Definition of Done

- [ ] Branch `backend-engineer/FOLLOW-204-description-cache-persistent`; commits referencing
      [FOLLOW-204]; PR opened; CI green.
- [ ] PM validates step 5d (producer→consumer wire across agents) before READY_FOR_REVIEW.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [FOLLOW-203 (Tier logic removed from description route)] · **produces:** [near-zero
Modal call rate after warm-up, permanent grounded descriptions, MOAT description×archetype data]
