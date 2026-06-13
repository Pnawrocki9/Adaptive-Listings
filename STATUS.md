# PM Orchestrator Status

**Last updated:** 2026-06-13T14:00Z

## Current sprints

- **Sprint 17 OPEN** — ADR-0012 D-1 chain wave 3 complete this session (5 PRs merged 2026-06-13). 13
  DONE, 1 READY (FOLLOW-301 P1), 3 BLOCKED (FOLLOW-268-sdk/FOLLOW-269/FOLLOW-293), backlog:
  FOLLOW-295/296/298/300/302/303 + pre-existing FOLLOW-282/290/291/292.
- **Sprint 16 COMPLETE** — 16/17 DONE; FOLLOW-191 READY_FOR_REVIEW (ESC-020 pending Rafal deploy,
  non-blocking per CEO 2026-06-10).
- **Sprint 15 COMPLETE** — 21/21 DONE.

## IN_PROGRESS tickets (0/3 max)

None active.

## ADR-0012 D-1 chain — complete dependency tree (as of 2026-06-13T14:00Z)

| Ticket                      | Label         | Status    | PR / commit    | Notes                                                                 |
| --------------------------- | ------------- | --------- | -------------- | --------------------------------------------------------------------- |
| FOLLOW-266                  | Foundation    | DONE      | #277/278/280   | DB schema + SDK emission (3 phases)                                   |
| FOLLOW-286                  | Prereq        | DONE      | #279           | on_conflict / event_type / join-key fixes                             |
| FOLLOW-287/288              | CH smoke      | DONE      | #281/282       | migration 0016 no-op; ESC-021 RESOLVED                                |
| FOLLOW-267                  | Ticket —      | DONE      | #283           | 8 tracer routes + /api/intent/config                                  |
| FOLLOW-294 (Ticket A)       | Auth + schema | DONE      | #284 (4e45e3a) | cross-tenant enum gap closed; IntentWeightsSchema                     |
| FOLLOW-268-write (Ticket B) | Write API     | DONE      | #285 (2998a93) | POST/PUT; write-side validation satisfied                             |
| FOLLOW-297 (Ticket D)       | Tests         | DONE      | #286 (8cdf94f) | 111 tests; DG-1 docstring fixed                                       |
| FOLLOW-299 (enum prereq)    | Enum prereq   | DONE      | #287 (c387103) | data_source widened to include 'error'                                |
| **FOLLOW-301**              | **P1 READY**  | **READY** | —              | one-active invariant + ORDER BY + real POST→GET test; BLOCKS Ticket C |
| FOLLOW-268 (Ticket C)       | SDK init      | BLOCKED   | —              | Blocked on FOLLOW-301 (+ FOLLOW-299, now done)                        |
| FOLLOW-269                  | Frontend UI   | BLOCKED   | —              | Blocked on FOLLOW-268 (Ticket C)                                      |
| FOLLOW-293                  | Closure gate  | BLOCKED   | —              | Blocked on FOLLOW-268 + FOLLOW-269                                    |

## READY tickets (next up)

| Ticket     | Priority | Agent            | Notes                                                                                  |
| ---------- | -------- | ---------------- | -------------------------------------------------------------------------------------- |
| FOLLOW-301 | P1       | backend-engineer | Defend one-active-row invariant + ORDER BY desc(created_at) + real POST→GET round-trip |

## ADR-0012 backlog (not yet sprint-planned)

| Ticket     | Priority | Agent            | Depends on             | Short description                                                      |
| ---------- | -------- | ---------------- | ---------------------- | ---------------------------------------------------------------------- |
| FOLLOW-293 | P2       | qa-engineer      | FOLLOW-268, FOLLOW-269 | ADR-0012 closure-verification gate (end-to-end wire)                   |
| FOLLOW-295 | P2       | backend-engineer | FOLLOW-267, FOLLOW-297 | Tracer session tenant-scoping (Ticket E)                               |
| FOLLOW-296 | P2       | backend-engineer | FOLLOW-267, FOLLOW-297 | SSE stream Zod validation (Zod half; docstring half done)              |
| FOLLOW-298 | P3       | backend-engineer | —                      | Dead EXAMPLE\_\* exports in intent-weights.ts                          |
| FOLLOW-300 | P2       | backend-engineer | FOLLOW-294             | Separate schema-parse fail from DB-error in GET route                  |
| FOLLOW-302 | P3       | backend-engineer | FOLLOW-268-write       | Stale migration 0029:12 comment (signal_weights vs signal_likelihoods) |
| FOLLOW-303 | P2       | backend-engineer | FOLLOW-297, FOLLOW-299 | Tracer data_source round-trip test + MAX_POLLS pin + doc fix           |

## Recent completions (2026-06-13 session)

- FOLLOW-267 DONE — PR #283 (tracer admin API, 8 routes + /api/intent/config; shipped untested —
  FOLLOW-297 back-filled coverage; RETRO-070 source)
- FOLLOW-294 DONE — PR #284 (4e45e3a) ADR-0012 Ticket A: auth + IntentWeightsSchema; RETRO-070
  complete
- FOLLOW-268-write DONE — PR #285 (2998a93) ADR-0012 Ticket B: write API; write-side validation
  satisfied; RETRO-071 complete
- FOLLOW-297 DONE — PR #286 (8cdf94f) ADR-0012 Ticket D: 111 seam-driven tests + DG-1 docstring fix;
  RETRO-072 complete
- FOLLOW-299 DONE — PR #287 (c387103) enum prereq: data_source widened to include 'error'

## Retro tracking

| RETRO     | Source ticket              | Status   | Key findings                                                                                                                    | Rule promoted                          |
| --------- | -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| RETRO-070 | FOLLOW-294 (PR #284)       | COMPLETE | data*source:'error' absent from IntentConfigResponseSchema enum (count 2); dead EXAMPLE*\* exports                              | Filed FOLLOW-298/299/300               |
| RETRO-071 | FOLLOW-268-write (PR #285) | COMPLETE | one-active-row invariant undefended; fake AC5 wiring test; stale migration comment                                              | Filed FOLLOW-301/302                   |
| RETRO-072 | FOLLOW-297 (PR #286)       | COMPLETE | data_source:'error' enum drift codified in tests without round-trip (count 3); AC3.7 tautological; RETRO-061 citations dangling | Filed FOLLOW-303; **Rule K.2 AMENDED** |

**Rule K.2 amendment (2026-06-13):** Promoted from RETRO-072 §6/§7 after 3rd sighting
(RETRO-058/FOLLOW-277, RETRO-070/FOLLOW-299, RETRO-072/FOLLOW-303). Sub-rule: a route emitting a
provenance/data_source value MUST declare that value in its shared Zod response enum, AND any test
asserting that literal MUST round-trip the response body through the schema. Codified in
CONVENTIONS_PATCH.md.

## Pending retros (carry-forward from earlier sessions)

- RETRO-064 — FOLLOW-266 Phase 1 (PR #277, data-engineer)
- RETRO-067 — FOLLOW-266 Phase 3 (PR #280, sdk-engineer)
- RETRO-068 — FOLLOW-286 (PR #279, backend-engineer)

## Open escalations (age in days as of 2026-06-13)

| ESC     | Title                                                           | Filed      | Age | Status                                                                  |
| ------- | --------------------------------------------------------------- | ---------- | --- | ----------------------------------------------------------------------- |
| ESC-020 | Estalara-app DOM hooks committed but not deployed to production | 2026-06-06 | 7d  | Non-blocking per CEO 2026-06-10; Rafal action deferred until local test |

All ESC-001 through ESC-021 RESOLVED (ESC-021 resolved 2026-06-12 via FOLLOW-288 / PR #282).

## CI check counter (current session)

Bookkeeping/status update session only — no PRs validated. CI check counter: 0/5. Fix iteration
counter: 0/3.

## Notes

- FOLLOW-301 is the critical-path item. Until it merges, FOLLOW-268-sdk (Ticket C) cannot start.
  Until FOLLOW-268-sdk merges, FOLLOW-269 and FOLLOW-293 remain blocked.
- FOLLOW-299 (PR #287 c387103) is DONE — the data_source enum widening is in main. FOLLOW-303 now
  needs to add the round-trip test, pin MAX_POLLS, and fix doc citations; coordinate timing with
  FOLLOW-303 assignment so the enum slot and its test close in one pass.
- FOLLOW-295 / FOLLOW-296 are independent of the FOLLOW-301 critical path and can be scheduled in
  parallel with FOLLOW-303 once sprint capacity permits.
- RETRO-064/067/068 remain pending spawn from earlier. PM should spawn these at next available slot.
- This bookkeeping pass (QUEUE.md + STATUS.md) reflects the docs commit being prepared by Piotr;
  RETROSPECTIVES.md (RETRO-070/071/072) and CONVENTIONS_PATCH.md (Rule K.2 amendment) are in the
  working tree and will be included in the same commit.
