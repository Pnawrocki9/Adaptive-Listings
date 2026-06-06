# FOLLOW-205 — F-19: Demo auth hardening

**Sprint:** 15 **Agent:** backend-engineer **Priority:** P2 **Estimated hours:** 3 **Status:** READY
**Source:** Audit F-19 **Promoted:** 2026-06-05

---

## Context

`apps/control-plane/src/app/api/adapt/route.ts:696–710` accepts any non-empty Bearer token in demo
mode: `if (!token) { return 401 }`. The token value is never cryptographically verified. Any
external party can POST arbitrary values and trigger LLM generation — unbounded billable cost
exposure. The daily cap is the only current protection.

`DEMO_MODE_JWT_SECRET` already exists in Vercel environment (added in v3.7 changelog). The fix
simply replaces the presence-only check with actual JWT verification.

This is a Track D (background) security fix. Not a pilot blocker but should complete before the demo
is widely shared externally.

## Scope

In `apps/control-plane/src/app/api/adapt/route.ts:696–710`:

- Replace `if (!token) { return new Response(null, { status: 401 }) }` with actual JWT verification.
- Use `DEMO_MODE_JWT_SECRET` to verify the Bearer token is a validly-signed JWT.
- On invalid/expired token: return 401 with a JSON body `{ error: 'invalid_demo_token' }`.
- On valid token: proceed normally.
- Use a standard JWT verification library already in the dependency tree (e.g., `jose` or whatever
  is already used elsewhere in the control-plane for JWT verification — do not introduce a new
  dependency without escalating per CLAUDE.md).

## Acceptance criteria

- [ ] AC1: POST `/api/adapt` with an arbitrary non-empty Bearer string (not a valid JWT) →
      returns 401.
- [ ] AC2: POST `/api/adapt` with a valid JWT signed by `DEMO_MODE_JWT_SECRET` → proceeds to
      decision tree normally.
- [ ] AC3: POST `/api/adapt` with an expired JWT → returns 401.
- [ ] AC4: No new third-party dependency introduced. If one is needed, escalate via ESCALATIONS.md.
- [ ] AC5: Unit test covers all three scenarios (invalid, valid, expired). CI green.

## Definition of Done

- [ ] Branch `backend-engineer/FOLLOW-205-demo-auth-hardening`; commits referencing [FOLLOW-205]; PR
      opened; CI green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [] · **produces:** [cost-safe demo mode, no arbitrary LLM generation by external
parties]
