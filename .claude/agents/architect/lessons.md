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

## 2026-06-15 / FOLLOW-324 (PR #308 bundle-size trade-off review)

**What I decided:** Recommend Option 1 (accept the split, merge PR #308 as-is) with two required
follow-ups: (a) `buildSnippet()` must be updated to emit the `<script>` for
`estalara-detect.iife.js` when cold-start detection is desired, and (b) a tenant migration guide
must document which embed tier gets the companion script automatically vs optionally. The cold-start
archetype hints are a Bayesian warm-start, not a load-bearing primitive — the session works without
them and converges to the same archetype within 3–5 behavioral signals. Option 2 (lazy network fetch
in init) introduces CDN hosting complexity, SRI management, and a new failure mode (CDN down) that
reduces reversibility without meaningfully improving the tenant experience.

**Where a spec risked describing behavior with no owner:** The detect-bundle comment says "The
Decision API's server-side schema is used instead" when `__EStalaraDetect` is absent — but there is
no server-side path that converts the stored `tenant_site_schema` into `archetype_hints` and injects
them into the `/api/adapt` response. The `archetype_hint` field is populated solely by the SDK's
client-side Bayesian state. Without the detect script, that hint defaults to `'neutral'`. The
comment is aspirationally correct (the server COULD do this) but describes behavior no code
implements. This needs either a dated FOLLOW stub or a correction to the comment.

**A guardrail I'd add:** When a bundle-split move silences a feature (rather than just moving it),
the PR description MUST explicitly state what happens to existing tenants who don't add the second
script, and `buildSnippet()` MUST be audited to confirm whether the new artifact should appear in
the generated snippet. Failing this, the "opt-in" framing silently downgrades all existing tenants.
