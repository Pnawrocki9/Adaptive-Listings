# FOLLOW-041 + FOLLOW-042 — SDK feedback ping + variant field (closes bandit loop)

**Sprint:** 10 **Agent:** sdk-engineer + backend-engineer **Priority:** P0 **Estimated hours:** 4+2
(combined) **Status:** IN_PROGRESS **Model:** sonnet-4.6 **Must ship in the same PR as FOLLOW-042.**
Branch: `sdk-engineer/FOLLOW-041-042-bandit-feedback-loop`

## Context

The Thompson sampling bandit (FOLLOW-007, PR #122) is wired server-side — the canonical
`POST /api/adapt` route selects a `variant` string and returns it in the response body.
`POST /api/adapt/feedback` exists and correctly increments Beta(α,β) in `ab_bandit_weights`.

Two half-wires remain (RETRO-005 §3):

1. **HALF_WIRE_P — feedback consumer.** `grep -rn "adapt/feedback" packages/sdk/src/` → 0 matches.
   The SDK never POSTs to the feedback endpoint. Thompson sampling stays at uniform Beta(1,1)
   forever.

2. **HALF_WIRE_P — variant consumer.** `AdaptResponse` in `packages/sdk/src/core/adapt.ts:33-40` has
   no `variant` field. The server sends `variant: "v1"` in the response body but the SDK interface
   does not declare it — the field is silently dropped after `fetchDirectives()`.

This ticket (FOLLOW-041 + FOLLOW-042 combined) closes both half-wires in a single PR.

**Feedback endpoint contract** (`apps/control-plane/src/app/api/adapt/feedback/route.ts`):

```
POST /api/adapt/feedback
Authorization: Bearer <token>
Body: { session_id, tenant_id, archetype, variant, converted: boolean }
→ 202 Accepted
```

## Acceptance criteria

### FOLLOW-042 — Add `variant` to AdaptResponse

1. **`AdaptResponse.variant?: string` added** at `packages/sdk/src/core/adapt.ts:33-40`. Field is
   optional (absent = holdout arm or legacy server). JSDoc: "Thompson sampling variant selected by
   the server for this session. Echo back in the feedback ping."

2. **Rule G scan documented.** Before opening PR, run:
   `grep -rn "MOCK_RESPONSE\|AdaptResponse" packages/sdk/src/ --include="*.ts"`. Update
   `MOCK_RESPONSE` at `packages/sdk/src/__tests__/adapt.test.ts:35` to include `variant: 'control'`.
   Update any other inline `AdaptResponse` mock objects found by the grep.

3. **`applyDirectives()` exposes `variant` to outcome-event callbacks.** When the adapt response
   carries a `variant`, the SDK makes it available to any registered outcome callback so it can be
   echoed in the feedback ping. Concrete: `fetchDirectives()` returns the full `AdaptResponse`
   (already does); callers can read `.variant` from it.

4. **Test.** Add a test in `adapt.test.ts` asserting that a fetch response with `variant: "v1"` in
   the JSON body is present on the returned `AdaptResponse` object.

### FOLLOW-041 — SDK feedback ping

5. **Session-level variant cache.** After `fetchDirectives()` returns a non-null `AdaptResponse`
   with a `variant` field, the SDK stores the variant in `sessionStorage`:
   - Key: `estalara_variant:{session_id}`
   - Value: the variant string (e.g. `"v1"`)
   - TTL: none (session-scoped — cleared on tab close). No-op if `sessionStorage` is unavailable
     (SSR / privacy mode).

6. **Outcome event listener.** The SDK registers a listener for outcome events on the config's
   `outcomeEvents` list (default: `['inquiry.completed']`, configurable per tenant via
   `config.feedbackEvents?: string[]`). When one fires for a session that has a cached variant:
   - Build the feedback body:
     ```json
     {
       "session_id": "<id>",
       "tenant_id": "<id>",
       "archetype": "<arch>",
       "variant": "<cached>",
       "converted": true
     }
     ```
   - POST to `config.decisionApiUrl + '/api/adapt/feedback'` (or the adapt endpoint base URL).
   - Add `Authorization: Bearer <config.apiKey>` header.
   - Fire-and-forget: do NOT await, do NOT block the outcome event.
   - On network error: log to `console.warn('[estalara] feedback ping failed:', err.message)`. Never
     throw.

7. **No-conversion path (optional, configurable).** If `config.feedbackConvertedFalse === true`, the
   SDK also posts `converted: false` on session expiry (page `visibilitychange → hidden` after ≥30 s
   dwell). Document the trade-off (increases noise, helps cold archetypes learn faster). Default:
   `false` (opt-in only).

8. **Test — variant cached.** Mock `fetchDirectives()` to return `{ variant: 'v1', ... }`. Assert
   `sessionStorage.getItem('estalara_variant:TEST_SESSION')` equals `'v1'`.

9. **Test — feedback ping on outcome event.** After caching a variant, dispatch a
   `inquiry.completed` event. Assert `fetch` was called once with the correct body:
   `{ session_id, tenant_id, archetype, variant: 'v1', converted: true }`.

10. **Test — bandit weights update (integration).** Simulate 100 sessions, each with outcome event.
    Mock the DB: assert `ab_bandit_weights.alpha` for variant `'v1'` was incremented on each call.
    (Can be a unit test on the feedback route with a mocked DB client.)

11. **CI gates.** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass.

## Files to touch

| File                                       | Action                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `packages/sdk/src/core/adapt.ts`           | Add `variant?: string` to `AdaptResponse`; add session-storage cache; add feedback ping logic   |
| `packages/sdk/src/__tests__/adapt.test.ts` | Update `MOCK_RESPONSE` (Rule G); add variant + feedback tests                                   |
| `packages/sdk/src/core/config.ts`          | Add `feedbackEvents?: string[]` and `feedbackConvertedFalse?: boolean` config fields (optional) |

## Key cross-references

- `apps/control-plane/src/app/api/adapt/feedback/route.ts` — server-side feedback endpoint (already
  shipped)
- `packages/sdk/src/core/adapt.ts:33-40` — `AdaptResponse` interface (no `variant` today)
- `packages/sdk/src/__tests__/adapt.test.ts:35` — `MOCK_RESPONSE` (must be updated per Rule G)
- RETRO-005 §3 — HALF_WIRE_P findings that this ticket closes
- FOLLOW-042 — must be in same PR (variant field on AdaptResponse is the prerequisite for caching
  it)

## Definition of done

- PR opened on branch `sdk-engineer/FOLLOW-041-042-bandit-feedback-loop`
- All local checks green (lint, typecheck, test, build)
- `gh pr checks <pr-number> --watch` returns all SUCCESS (ignore: Doppler verify, Rule I, Python
  tests)
- PM-orchestrator validates all AC items above
- PM-orchestrator comments: `PM-validated. CI green. Ready for human review.`
- QUEUE.md updated: FOLLOW-041 and FOLLOW-042 → `READY_FOR_REVIEW`
