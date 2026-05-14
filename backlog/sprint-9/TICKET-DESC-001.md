# TICKET-DESC-001 — Long-form Description Pipeline (Tier 1/2/3)

**Sprint:** 9 **Agent:** backend-engineer (4h) + ml-engineer (4h) **Priority:** P1 **Estimated
hours:** 8 total **Status:** BACKLOG **Depends on:** TICKET-AGENCY-001 (merged — `listingContext`
field in `LlmGatewayInput` required for Sonnet prompt seeding), TICKET-046 (merged PR #92 —
`copy_template.en` exists in all 17 non-neutral archetype playbooks) **Unblocks:** (none —
description is a leaf feature; downstream consumers read from the endpoint)

## Context

Master Design section E.7 specifies a long-form listing description pipeline. Buyers want a property
narrative tailored to their archetype — not a generic 200-word MLS blurb. This endpoint computes (or
serves cached) AI-written descriptions adapted to the detected buyer archetype, gated by the
tenant's integration tier.

The pipeline has three paths depending on tier:

- **Tier 1 Observer** — no DOM slot for a full description in the read-only sidebar widget; returns
  the static `PlaybookEntry.copy_template.en` immediately. Zero AI cost, <50ms p95.
- **Tier 2 Augment** — Redis cache lookup; on hit, returns the AI-generated description (source:
  `ai_cached`). On miss, returns the copy_template fallback immediately and enqueues a Modal async
  job. TTL 72 hours.
- **Tier 3 Native** — same as Tier 2 but TTL 48 hours, higher-priority Modal job, and up to 600
  tokens (vs 450 for Tier 2). Richer prompt with full ROI/lifestyle metrics.

The Redis cache key is: `desc:{tenant_id}:{listing_id}:{archetype}:{locale}`.

When the `listing.updated` event arrives in Redpanda (emitted by the ingest worker when a tenant's
listing data changes), a consumer in `apps/stream-consumer` (or `apps/control-plane`) must
invalidate the relevant cache entries via wildcard Redis DEL so the next request triggers a
regeneration.

This ticket is split across two agents: backend-engineer owns the HTTP endpoint, Redis client,
Redpanda consumer, and Zod schema; ml-engineer owns the Modal job code, the Sonnet prompt template,
and the fallback logic within the job.

**References:**

- `docs/MASTER_DESIGN.md` section E.7 — full spec (Tier gating, endpoint contract, flow, cost)
- `docs/MASTER_DESIGN.md` section E.6 — placeholder resolution (Level 6 = long-form description)
- `apps/control-plane/src/lib/llm-gateway.ts` — existing Anthropic client and circuit breaker (the
  Modal job must use its own Anthropic SDK call, NOT call `callLlmGateway()` — see impl notes)
- `packages/sdk/src/core/playbooks/types.ts` — `PlaybookEntry.copy_template` field definition
- `backlog/sprint-8/TICKET-AGENCY-001.md` — `listingContext` field shape added to `LlmGatewayInput`
- Upstash Redis client: check `apps/control-plane/src/lib/redis.ts` for the existing client

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **`GET /api/adapt/description` endpoint exists and returns correct shape.** Query parameters:
   - `listing_id` (required) — the tenant's listing identifier
   - `archetype` (required) — one of the 18 archetype IDs
   - `tier` (required) — `'1' | '2' | '3'`
   - `locale` (optional, default `'en'`) Auth: Bearer JWT (same as `/api/adapt`). Returns:

   ```json
   {
     "description": "string",
     "source": "template_fallback" | "ai_cached" | "ai_generated",
     "locale": "en",
     "generated_at": "ISO 8601"
   }
   ```

   `generated_at` is the timestamp of the most recent generation. For `template_fallback` it is
   `now()` (the response time). For `ai_cached` it is the Redis entry's creation timestamp (store as
   a TTL-relative offset or embed in the Redis value as JSON).

2. **Tier 1 path returns `template_fallback` with zero I/O beyond playbook lookup.** When
   `tier = '1'`, the handler immediately returns `copy_template.en` from the playbook registry
   without any Redis read and without enqueuing a Modal job. Latency p95 must be <50ms (no I/O).
   Verify in tests by asserting the Redis client is never called when `tier = '1'`.

3. **Tier 2 path — cache hit returns `ai_cached`.** When `tier = '2'` and Redis key
   `desc:{tenant_id}:{listing_id}:{archetype}:{locale}` exists, return `source: 'ai_cached'` with
   the cached description. No Modal job is enqueued. Latency p95 on cache hit must be <100ms.

4. **Tier 2 path — cache miss returns `template_fallback` and enqueues Modal job.** When the Redis
   key is absent, return `copy_template.en` as `source: 'template_fallback'` immediately. Then,
   async (fire-and-forget, do not `await`), enqueue the Modal job
   `apps/llm-gateway/src/jobs/generate_description.py` via Modal's Python client or HTTP trigger
   with payload: `{ tenant_id, listing_id, archetype, locale, tier: 2, listing_context }`.
   `listing_context` is populated from `answers` table (reuse the RAG retrieval from
   TICKET-AGENCY-001's `listingContext` population in
   `apps/control-plane/src/app/api/adapt/route.ts`).

5. **Tier 3 path — same as Tier 2 but TTL 48h and `priority: 'high'`.** When `tier = '3'`, the Redis
   TTL is 48 hours (not 72h). The Modal job payload includes
   `{ tier: 3, priority: 'high', max_tokens: 600 }`.

6. **Modal job `apps/llm-gateway/src/jobs/generate_description.py` exists and functions.** The job
   (ml-engineer scope):
   - Accepts the payload from AC item 4.
   - Builds a Sonnet 4.6 prompt using `copy_template.en` as seed text + `listingContext` key-value
     pairs + archetype description + signals. Tier 2 prompt targets ~100 words; Tier 3 targets ~150
     words.
   - Calls Anthropic Sonnet 4.6 (`claude-sonnet-4-6`) directly via the `anthropic` Python library
     (NOT through `llm-gateway.ts` — the Modal job runs in Python, independently).
   - On success: writes the generated description to Redis
     `SET desc:{tenant_id}:{listing_id}: {archetype}:{locale}` as a JSON string
     `{ "text": "...", "generated_at": "ISO" }` with TTL per tier (72h for tier 2, 48h for tier 3).
   - On failure (Sonnet returns null, empty string, or raises): does NOT write to Redis. The next
     request will trigger another attempt.
   - The job is idempotent: if called twice for the same key, it overwrites Redis (last-write-wins).

7. **`listing.updated` Redpanda consumer invalidates Redis cache.** A consumer in
   `apps/stream-consumer` (or in `apps/control-plane` if that service already has a Redpanda
   consumer — check existing code before adding a new one) subscribes to the `listing.updated`
   event. On receipt, it runs a Redis wildcard delete:

   ```
   SCAN 0 MATCH desc:{tenant_id}:{listing_id}:* → DEL all matched keys
   ```

   This ensures stale descriptions do not persist after a listing update. The consumer must be
   idempotent (running twice for the same event is safe — DEL on a non-existent key is a no-op).

8. **All three `source` values are verifiable via curl.** The PR description must include three
   example curl commands demonstrating:
   - `source: template_fallback` (tier=1 or tier=2 cold cache)
   - `source: ai_cached` (tier=2 or tier=3 after Modal job completes)
   - `source: ai_generated` is NOT a valid source value — the endpoint never returns this. The three
     valid values are `template_fallback`, `ai_cached`. (Note: Master Design E.7.2 also lists
     `ai_generated` as if it were a separate value, but the flow shows `ai_cached` is the correct
     term once Redis is populated. Use `ai_cached` for both warm-cache and just-generated. Clarify
     this in a code comment.)

9. **`DescriptionResponseSchema` Zod schema in `packages/shared`.** A new file
   `packages/shared/src/schemas/description.ts` exports the response schema, used by the endpoint
   handler and by the SDK TypeScript client.

10. **Test coverage ≥70% for endpoint; ≥80% for Zod schema in `packages/shared`.** Python job tests:
    at minimum 3 test cases (happy path, Sonnet returns empty, Redis write called with correct TTL).

11. **No TypeScript `any` without inline `// eslint-disable` + reason.**

12. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass locally.**

## Files to touch

| File                                                             | Action                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/control-plane/src/app/api/adapt/description/route.ts`      | NEW — GET handler                                                     |
| `apps/control-plane/src/lib/redis.ts`                            | Verify Upstash client exists; add `descriptionKey()` helper if absent |
| `apps/control-plane/src/lib/description-cache.ts`                | NEW — Redis get/set/invalidate helpers                                |
| `apps/control-plane/src/lib/__tests__/description-cache.test.ts` | NEW — unit tests                                                      |
| `packages/shared/src/schemas/description.ts`                     | NEW — `DescriptionResponseSchema`                                     |
| `packages/shared/src/schemas/index.ts`                           | Export new schema                                                     |
| `apps/llm-gateway/src/jobs/generate_description.py`              | NEW — Modal async job (ml-engineer)                                   |
| `apps/llm-gateway/src/jobs/test_generate_description.py`         | NEW — pytest test cases (ml-engineer)                                 |
| `apps/stream-consumer/src/` (or control-plane Redpanda consumer) | Add `listing.updated` handler for cache invalidation                  |

Before starting: read `apps/control-plane/src/lib/llm-gateway.ts` (understand existing Anthropic
client pattern), `packages/sdk/src/core/playbooks/types.ts` (`copy_template` field shape), and the
TICKET-AGENCY-001 RAG retrieval code in `apps/control-plane/src/app/api/adapt/route.ts`
(`listingContext` population).

## Implementation notes

**Do not call `callLlmGateway()` from the Modal job.** `callLlmGateway()` is a TypeScript function
in the Node.js control-plane. The Modal job is Python. Call Anthropic directly in Python:

```python
import anthropic
client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=max_tokens,  # 450 for tier 2, 600 for tier 3
    messages=[{"role": "user", "content": prompt}]
)
```

**Redis wildcard delete** requires SCAN + DEL, not a single KEYS call. Upstash Redis does not
support `KEYS *` in production. Use:

```typescript
let cursor = '0';
do {
  const [nextCursor, keys] = await redis.scan(cursor, {
    match: `desc:${tenantId}:${listingId}:*`,
    count: 100,
  });
  cursor = nextCursor;
  if (keys.length > 0) await redis.del(...keys);
} while (cursor !== '0');
```

**Latency budget**: Tier 1 <50ms (no I/O). Tier 2/3 cache hit <100ms (one Redis read). Tier 2/3
cache miss <150ms (one Redis read + one copy_template lookup + fire-and-forget Modal enqueue). The
Modal enqueue is async — do not block the HTTP response on it.

**`generated_at` in Redis**: Store the Redis value as a JSON string:
`{ "text": "<description>", "generated_at": "2026-05-14T12:00:00Z" }`. Parse on read to populate the
`generated_at` field in the API response.

## Test expectations

### Unit tests (required)

1. **Tier 1 returns `template_fallback` without calling Redis.** Mock Redis client. Call handler
   with `tier=1`. Assert Redis `get` is never called. Assert response
   `source === 'template_fallback'`.

2. **Tier 2 cache hit returns `ai_cached`.** Mock Redis to return a cached JSON entry. Assert
   response `source === 'ai_cached'` and `description` matches the cached text.

3. **Tier 2 cache miss returns `template_fallback` and enqueues Modal job.** Mock Redis to return
   null. Assert response `source === 'template_fallback'` and Modal enqueue was called once with
   correct payload.

4. **Tier 3 uses 48h TTL.** Mock Modal job write path. Assert the Redis SET call uses TTL of
   `48 * 3600` seconds for tier 3 vs `72 * 3600` for tier 2.

5. **`listing.updated` consumer deletes correct Redis keys.** Mock Redis SCAN to return 3 keys.
   Assert DEL is called with all 3 keys. Assert no error when SCAN returns 0 keys.

### Python tests (ml-engineer, required)

6. **Happy path — Sonnet responds, Redis written.** Mock `anthropic.messages.create()` to return a
   200-word string. Assert Redis `SET` is called with the correct key, a JSON value containing the
   text, and the correct TTL.

7. **Sonnet returns empty string — Redis not written.** Mock `anthropic.messages.create()` to return
   `""`. Assert Redis `SET` is never called.

8. **Sonnet raises an exception — Redis not written, no crash.** Mock to raise `anthropic.APIError`.
   Assert the job logs the error and exits cleanly (no uncaught exception).

## Branch naming

`backend-engineer/TICKET-DESC-001-description-pipeline`

(ml-engineer works on the same branch under `TICKET-DESC-001` scope, coordinated via PR.)

## PR title format

`feat(control-plane,llm-gateway,shared): long-form description pipeline — Tier 1/2/3 + Redis cache + Modal job [TICKET-DESC-001]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- Three curl examples demonstrating `template_fallback` and `ai_cached` sources included in PR
  description.
- PM-orchestrator validates AC items 1–12 above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
