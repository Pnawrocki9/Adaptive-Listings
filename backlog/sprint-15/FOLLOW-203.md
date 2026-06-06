# FOLLOW-203 — Remove Tier logic from description route

**Sprint:** 15 **Agent:** backend-engineer **Priority:** P1 **Estimated hours:** 4 **Status:** READY
**Source:** Audit §10.3, Master_Design §E.7 v4.0, CEO decision 2026-06-05 **Promoted:** 2026-06-05

---

## Context

Master_Design v4.0 §E.7 CEO decision (2026-06-05): **Adaptive Listings has no Tiers. Every tenant
gets the same single experience.** The Tier-gating code in the description route is legacy and must
be removed. The Redis TTL model is also eliminated: descriptions must persist permanently (no
automatic expiry) until a listing is updated or deactivated.

Current code in `apps/control-plane/src/app/api/adapt/description/route.ts`:

- `tier: z.enum(['1', '2', '3'])` in Zod request schema
- `tierNum` branching logic
- `TTL_TIER2_SECONDS = 259200` / `TTL_TIER3_SECONDS = 172800` conditional TTL selection
- Tier-1 early-return path
- `tierNum === 3 ? { priority: 'high', max_tokens: 600 } : { max_tokens: 450 }` branch

All of this must be removed. Single `max_tokens: 500` for all requests. Redis SET without EX.

This ticket removes the Tier logic. FOLLOW-204 adds the permanent Postgres description cache. These
two tickets can be worked in parallel by different agents.

## Scope

In `apps/control-plane/src/app/api/adapt/description/route.ts`:

- Remove `tier: z.enum(['1', '2', '3'])` from Zod request schema. Remove `tierNum` variable.
- Remove `TTL_TIER2_SECONDS` / `TTL_TIER3_SECONDS` conditional logic. Single path for all requests.
- Remove the Tier-1 early-return path.
- Change `max_tokens` to a single constant `500` (no tier-based branching).
- Remove all `Tier 1 / Tier 2 / Tier 3` JSDoc comments from the route.
- Remove all Tier-related JSDoc/comments from request/response types.

In `apps/control-plane/src/lib/description-cache.ts`:

- Remove `TTL_TIER2_SECONDS` and `TTL_TIER3_SECONDS` exports.
- Redis `SET` must no longer pass `EX`; keys are kept indefinitely in Redis (Redis eviction handles
  memory; Postgres in FOLLOW-204 is the durable truth).

Update tests: any test that passes `tier` in the request body must be updated to omit it.

## Acceptance criteria

- [ ] AC1: `POST /api/adapt/description` accepts requests without a `tier` parameter. A request
      including `tier` either ignores it or returns a validation error (not required to error — just
      must not be required).
- [ ] AC2: No `TTL_TIER2_SECONDS` or `TTL_TIER3_SECONDS` constants in `description-cache.ts`.
- [ ] AC3: Redis SET in the cache helper does not include `EX` parameter.
- [ ] AC4: `max_tokens: 500` is the only value used in Modal job enqueue calls (no tier-based
      branching).
- [ ] AC5: Tests updated to not require `tier` field. CI green.

## Definition of Done

- [ ] Branch `backend-engineer/FOLLOW-203-remove-tier-logic`; commits referencing [FOLLOW-203]; PR
      opened; CI green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [] · **produces:** [FOLLOW-204 (permanent Postgres cache can now be wired without
TTL confusion)]
