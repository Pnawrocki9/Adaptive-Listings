# FOLLOW-042 — Add `variant` field to SDK AdaptResponse + thread through applyDirectives

**Sprint:** 10 **Agent:** sdk-engineer **Priority:** P0 **Estimated hours:** 2 **Status:**
IN_PROGRESS **Model:** sonnet-4.6 **Must ship in the same PR as FOLLOW-041.** Branch:
`sdk-engineer/FOLLOW-041-042-bandit-feedback-loop`

## Context

See `backlog/sprint-10/FOLLOW-041.md` for full context. This ticket spec covers the
`AdaptResponse.variant` field addition specifically. Both tickets are implemented together in one PR
— the spec is split for acceptance-criteria tracking only.

**The gap:** The server (PR #122) sets `variant: "v1"` on the adapt response body. The SDK interface
`AdaptResponse` at `packages/sdk/src/core/adapt.ts:33-40` has no `variant` field — so TypeScript
silently drops it after `fetchDirectives()`. The SDK feedback ping (FOLLOW-041) needs to echo this
variant back, which is impossible without it being on the interface.

## Acceptance criteria

1. `AdaptResponse.variant?: string` added to `packages/sdk/src/core/adapt.ts` (optional field).
2. All inline `AdaptResponse` mocks updated (Rule G compliance):
   - `MOCK_RESPONSE` at `packages/sdk/src/__tests__/adapt.test.ts:35` — add `variant: 'control'`
   - Run `grep -rn "AdaptResponse\|MOCK_RESPONSE" packages/sdk/src/ --include="*.ts"` and update
     every inline object that constructs an `AdaptResponse`.
3. `applyDirectives()` signature unchanged — `variant` is read from the response object, not passed
   as a new parameter.
4. Test: fetch response JSON `{ ..., variant: "v2" }` → `fetchDirectives()` returns an object where
   `.variant === "v2"`.

## Definition of done

Combined with FOLLOW-041 — see that spec.
