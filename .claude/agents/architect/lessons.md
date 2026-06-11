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
