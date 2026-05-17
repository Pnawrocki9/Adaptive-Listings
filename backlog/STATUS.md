# Status — 2026-05-17T00:00Z

_Rule I: a ticket is DONE only if its primary artifact has at least one non-test runtime caller._

## Active

(none — all sprints through 9 complete)

## Ready (next up)

- TICKET-038 (sdk-engineer) — SDK tsup build + bundle size gate
- TICKET-030 (backend-engineer) — Magic Link onboarding wizard UI (Sprint 2.5 unblocked)

## Ready for human review

(none)

## Blocked / Deferred

- TICKET-NATIVE-001 — deferred to MVP launch; requires CTO/CPO scheduling on SvelteKit side
- TICKET-CAUSAL-001 — P2; must not start until AB-001 has 2+ weeks of real holdout data
- TICKET-039, TICKET-040, TICKET-042, TICKET-043, TICKET-044, TICKET-045 — Sprint 3 blocked chain

## Cancelled

- TICKET-FAIR-001 — not required at this stage; archetype space is purely behavioral (Piotr
  2026-05-13)
- TICKET-035 — duplicate scope with TICKET-VAL-001 (Sprint 9); canonical impl there

## Sprint 7 progress — COMPLETE

- 5/5 tickets DONE (ADP-001, ADP-003, ADP-004, ADP-002, DQS-001)

## Sprint 7.5 progress — COMPLETE

- 7/7 tickets DONE (AUTO-001 through AUTO-007)
- Corpus CI gate: 100% precision / 100% recall on 24-platform corpus

## Sprint 8 progress — Rule I audit (2026-05-17)

QUEUE.md reports 6/6 core tickets DONE. Rule I wiring check finds 4 truly DONE and 2 PARTIAL.

| Ticket      | Queue status | Rule I status | Evidence                                                                                                                                                                                                                                                                 |
| ----------- | ------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AB-001      | DONE         | **PARTIAL**   | `assignHoldout()` called in both adapt routes (holdout wired). `thompsonSample()` has zero non-test callers — deferred as FOLLOW-007. Variant selection NOT live.                                                                                                        |
| REORDER-001 | DONE         | **DONE**      | `buildReorderDirective()` called in decision-api adapt route:426 and control-plane adapt route:595. `reorderDirectives` returned in response.                                                                                                                            |
| TICKET-046  | DONE         | **PARTIAL**   | `getPlaybook()` called at control-plane adapt route:127; `s.en` (variant[0]) consumed. `copy_template.en` consumed in `generate_description.py`. But `s.variants[1/2]` never accessed — bandit selection is FOLLOW-007. Data exists; multi-variant picking is not wired. |
| ARCH-003    | DONE         | **DONE**      | Retrospective-analyst agent operational; PM invokes after each merge; RETRO entries written since. Process tooling — not an HTTP runtime service.                                                                                                                        |
| AGENCY-001  | DONE         | **DONE**      | `retrieveListingContext()` called in control-plane POST /api/adapt:575. Dashboard page at `/dashboard/listings/[id]/answers/page.tsx` exists with full CRUD.                                                                                                             |
| AB-004      | DONE         | **DONE**      | Analytics page fetches `/api/dashboard/analytics/summary` and `/api/dashboard/analytics/lift`. Both routes query real ClickHouse `adaptation_decisions` table (fallback to mock when CLICKHOUSE_URL unset). Table is populated fire-and-forget by both adapt routes.     |

**Sprint 8 Rule I summary: 4/6 DONE, 2/6 PARTIAL**

Open gaps (both tracked as FOLLOW-UP items):

- **FOLLOW-007** — Wire Thompson sampling (`thompsonSample` in `decision-api/src/lib/bandit.ts`)
  into adapt routes so the bandit selects among variant[0/1/2] per slot instead of always using
  `s.en`. Prerequisite: real holdout data flowing (AB-001 holdout is live, so data accumulates now).
- **FOLLOW-007 (TICKET-046 side)** — Same gap: `s.variants[1]` and `s.variants[2]` in playbooks
  never consumed by any runtime caller. Will be resolved when FOLLOW-007 bandit wiring lands.

## Sprint 8.5 progress — COMPLETE

- 5/5 tickets DONE (AB-005 through AB-011) — A/B wiring sprint across PR #106, #107, #108, #109

## Sprint 9 progress — COMPLETE

- 6/6 tickets DONE (GDPR-001, GDPR-002, GDPR-003, GDPR-004, DESC-001, VAL-001)

## Open P0 follow-ups before EU pilot

- **FOLLOW-039** — ClickHouse hard deletion not yet wired (RODO Art. 17); must fix before EU pilot
- **FOLLOW-040** — Doppler CI secret injection; must confirm before EU pilot
- **FOLLOW-007** — Thompson sampling variant selection (see Sprint 8 gaps above)

## Next escalation candidate

FOLLOW-039 and FOLLOW-040 are EU-pilot blockers. Escalate if not resolved before Sprint 10 kickoff.
