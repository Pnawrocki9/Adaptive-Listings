# Status — 2026-05-13T12:00Z

## Active

- TICKET-AB-001 (backend-engineer, IN_PROGRESS, started 2026-05-13T12:00Z) — A/B holdout framework

## Ready (next up)

- TICKET-REORDER-001 (sdk-engineer) — unblocked 2026-05-13; ready to start in parallel

## Ready for human review

(none)

## Blocked / Deferred

- TICKET-NATIVE-001 — deferred to MVP launch; requires CTO/CPO scheduling on SvelteKit side
- TICKET-AB-004 — depends on TICKET-AB-001 (not yet done)
- TICKET-AGENCY-001 — BACKLOG, no blocking dep issues; waiting for AB-001 slot
- TICKET-CAUSAL-001 — P2; must not start until AB-001 has 2+ weeks of real holdout data

## Cancelled

- TICKET-FAIR-001 — not required at this stage; archetype space is purely behavioral (Piotr
  2026-05-13)

## Sprint 7 progress — COMPLETE

- 5/5 tickets DONE (ADP-001, ADP-003, ADP-004, ADP-002, DQS-001)

## Sprint 7.5 progress — COMPLETE

- 7/7 tickets DONE (AUTO-001 through AUTO-007)
- Corpus CI gate: 100% precision / 100% recall on 24-platform corpus

## Sprint 8 progress — ACTIVE

- 6 tickets total (FAIR-001 cancelled)
- 1 IN_PROGRESS (AB-001)
- 1 READY (REORDER-001)
- 1 BLOCKED/DEFERRED (NATIVE-001)
- 3 BACKLOG (AGENCY-001, AB-004, CAUSAL-001)
- 0 DONE
- Status: On track

## Next escalation candidate

TICKET-AB-001 — if CI is not green after 3 fix attempts, escalate per standard protocol.
