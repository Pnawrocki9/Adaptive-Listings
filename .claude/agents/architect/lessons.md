# Architect lessons log

## 2026-06-11 / FOLLOW-275

**What I decided:** Adopted option (b) — SDK runtime GET for post-activation-mutable quiz config —
over option (a) snippet-threading + dashboard re-emission surface. New PROPOSED route
`GET /api/quiz/public-config` (API-key auth, CORS-open, 5-min TTL). Snippet retains only immutable
tenant binding fields. Retired `data-quiz-enabled` and `data-micro-polls-enabled` snippet attributes
as config transport.

**Where a spec risked describing behavior with no owner:** The ADR documents an auth sub-decision
(path (i) vs path (ii)) that is explicitly delegated to the backend-engineer. Without a dated FOLLOW
stub for that sub-decision, there is a risk the sub-ADR requirement gets missed. Mitigated by
writing the choice explicitly into both the ADR Risks section and the backend-engineer handoff note,
making the sub-decision owner visible in two surfaces.

**A guardrail I'd add:** When an ADR delegates an auth-model sub-decision to an implementing agent,
the ADR MUST name the implementing agent AND require that agent to document their choice in the PR
description (not just in code). The risk otherwise: the sub-decision gets made silently in code
without review visibility.

## 2026-06-14 / FOLLOW-309 + FOLLOW-310 (ADR-0013)

**What I decided:** (1) SSE admin auth via existing `sb-access-token` cookie —
`verifyTracerAdminAuth` already calls `getAuthClaims` which reads the cookie; the only fix is
removing the erroneous `?token=` query param from the page. (2) New `GET /api/admin/intent/config`
returning row `id` so the Weight Editor can PUT-update rather than POST-create.
`AdminIntentConfigResponseSchema` added to `packages/shared`; SDK-facing
`IntentConfigResponseSchema` unchanged. (3) Test-integrity constraint: fix-ticket tests must drive
the real route handler or derive fixtures from the typed schema — no hand-authored response shapes.

**Where a spec risked describing behavior with no owner:** The CEO/CPO decision on per-tenant weight
editing scope (global-only vs per-tenant in Sprint 17) was left open in the ADR as an explicit flag
rather than silently choosing one. If this decision is not answered before FOLLOW-309 starts, the
implementor will either scope-creep or under-deliver. The ADR names this explicitly.

**A guardrail I'd add:** Before writing an admin GET contract, always check whether the admin UI
pages use cookie-based or header-based auth. If the middleware gates the page route on cookie-based
JWT, the API routes under `/api/admin/` are served to the same browser session and the cookie is
automatically present. A consumer-side test that mocks `global.fetch` with a hand-authored shape
CANNOT detect a route-method mismatch (405), a missing field, or a wrong content-type. The rule
should be: admin UI page tests must import and call the real route handler, not mock the fetch
boundary.
