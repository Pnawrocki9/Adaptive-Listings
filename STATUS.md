# PM Orchestrator Status

**Last updated:** 2026-06-18T10:30Z

## OPERATIONAL RECORD — Prod Supabase 14-migration drift catch-up (2026-06-14)

**HEADLINE:** On 2026-06-14, prod Supabase (project yhmivuqeqkmzpxpyrsvc, eu-west-3) was found to be
**14 migrations behind** — `drizzle.__drizzle_migrations` had only 17 entries (last applied
2026-05-28, migration ~0016), while the repo was at migration 0030. Migrations 0017 through 0030 had
**NEVER been applied to prod**, including:

- Compliance: 0019/0020 (conversion_labels), 0024 (dsr_durable_lead_id / DSR erasure tracking)
- Product: 0021 (engagement_scores), 0022 (quiz_completions), 0025 (tenants_quiz_enabled), 0026/0027
  (quiz_config strips)
- K.3.6: 0028 (intent_sessions), 0029 (intent_weight_configs), 0030 (seed)

**STATUS: RESOLVED (apply). COMPLIANCE GAP SIGNED OFF 2026-06-14 (Piotr/CEO).** All 14 migrations
applied cleanly via `doppler run --config prd -- pnpm db:migrate` on 2026-06-14T09:26:45Z. Prod
`drizzle.__drizzle_migrations` now = 31 (full repo count). Seed row verified:
`intent_weight_configs` id=3ecd053e-3d2e-4eed-a900-0a42ff8c3f9e, tenant_id=NULL, is_active=true,
weights={}, created_at=2026-06-14T09:26:45Z. `GET /api/intent/config` now returns
`data_source:'live'` for override-less tenants. Note: prod was AUTO-PAUSED (Supabase idle pause) and
had to be resumed — confirms pre-pilot phase.

**COMPLIANCE INTEGRITY VERDICT (ESC-022 item 1, signed off 2026-06-14):** NO data-integrity issue.
Gap was benign. The three compliance migrations (0019/0020/0024) were purely additive; prod data
state was verified EMPTY (conversion_labels=0, dsr_verifications=0, intent_sessions=0,
quiz_completions=0, engagement_scores=0). Both DSR and conversion-label risks required real traffic
that never arrived (prod was auto-paused, pre-pilot). All 14 migrations applied cleanly, including
the UNIQUE constraint (0020) — positive proof of no conflicting rows.

**ROOT CAUSE:** No auto-apply mechanism for Postgres migrations (RETRO-076 OG-1). Only ClickHouse
has auto-apply (ci.yml:315). Drizzle `pnpm db:migrate` is operator-driven only.

**PREVENTION:** FOLLOW-308 (P1 devops) tracks the standing-mechanism decision. ESC-022 item (2)
remains OPEN — Piotr must choose Option A (auto-apply on deploy) or Option B (CI divergence gate) to
unblock FOLLOW-308 implementation.

---

## Current sprints

- **Sprint 18 OPEN** — FOLLOW-331 READY_FOR_REVIEW (PR #317, PM-validated 2026-06-18T10:30Z, CI
  green on all real gates). FOLLOW-332 IN_PROGRESS (qa-engineer, delegated 2026-06-18T10:30Z).
  FOLLOW-335 READY (sdk-engineer). FOLLOW-336 DONE (PR #316, merged 2026-06-18).
- **Sprint 17 OPEN** — K.3.6 D-1 PRODUCTION-LIVE as of 2026-06-14 (FOLLOW-307 DONE). 21 DONE.
- **Sprint 16 COMPLETE** — 16/17 DONE; FOLLOW-191 READY_FOR_REVIEW (ESC-020 pending Rafal deploy,
  non-blocking per CEO 2026-06-10).
- **Sprint 15 COMPLETE** — 21/21 DONE.

## IN_PROGRESS tickets (1/3 max)

- FOLLOW-332 — qa-engineer — Add admin/layout.test.tsx + admin/page.test.tsx — started
  2026-06-18T10:30Z — CI check counter: 0/5, fix iterations 0/3
- FOLLOW-331 — sdk-engineer — READY_FOR_REVIEW (PR #317) — CI check counter: 1/5, fix iterations 0/3

## OPEN escalations

- ESC-020 — Estalara-app DOM hooks not deployed to production — filed 2026-06-06 — NON-BLOCKING per
  CEO 2026-06-10, pipeline unblocked — age: 12 days

## Pre-existing-red CI checks (non-blocking)

- `Format check`: fails on `.claude/agents/backend-engineer/lessons.md` — pre-existing on main since
  at least commit 1626013 (FOLLOW-336 merge, 2026-06-18). Confirmed NOT introduced by FOLLOW-336 or
  FOLLOW-331.
- `Rule I — wired-or-dead check`: 107+ violations at baseline (FOLLOW-090 tracking).
- `Test (Python) (3.12, *)`: all Python modal app tests fail at dependency install (pre-existing).

## ADR-0012 D-1 chain — complete dependency tree (as of 2026-06-14T10:00Z)

| Ticket                      | Label          | Status    | PR / commit    | Notes                                                               |
| --------------------------- | -------------- | --------- | -------------- | ------------------------------------------------------------------- |
| FOLLOW-266                  | Foundation     | DONE      | #277/278/280   | DB schema + SDK emission (3 phases)                                 |
| FOLLOW-286                  | Prereq         | DONE      | #279           | on_conflict / event_type / join-key fixes                           |
| FOLLOW-287/288              | CH smoke       | DONE      | #281/282       | migration 0016 no-op; ESC-021 RESOLVED                              |
| FOLLOW-267                  | Ticket —       | DONE      | #283           | 8 tracer routes + /api/intent/config                                |
| FOLLOW-294 (Ticket A)       | Auth + schema  | DONE      | #284 (4e45e3a) | cross-tenant enum gap closed; IntentWeightsSchema                   |
| FOLLOW-268-write (Ticket B) | Write API      | DONE      | #285 (2998a93) | POST/PUT; write-side validation satisfied                           |
| FOLLOW-297 (Ticket D)       | Tests          | DONE      | #286 (8cdf94f) | 111 tests; DG-1 docstring fixed                                     |
| FOLLOW-299 (enum prereq)    | Enum prereq    | DONE      | #287 (c387103) | data_source widened to include 'error'                              |
| FOLLOW-301                  | Invariant      | DONE      | #289 (a14c907) | one-active invariant + ORDER BY + real POST→GET test                |
| FOLLOW-268 (Ticket C)       | SDK init       | DONE      | #290 (ea2089b) | resolveIntentOverrides + fetchIntentWeights                         |
| FOLLOW-305                  | URL fix        | DONE      | #291 (3d9e8f0) | buildEndpoint; fixed double-/api on 4 SDK endpoints                 |
| FOLLOW-266 Ph2 seed         | Seed           | DONE      | #293 (6381499) | migration 0030 merged; global-default row in repo                   |
| **FOLLOW-307**              | **Prod apply** | **DONE**  | operator apply | All 14 pending migrations applied 2026-06-14; seed verified in prod |
| **FOLLOW-308**              | **Auto-apply** | **DONE**  | PR #297/#306   | db-migrate.yml LIVE end-to-end; ESC-022+ESC-023 RESOLVED 2026-06-15 |
| FOLLOW-269                  | Frontend UI    | DONE      | #298           | Merged 2026-06-14; RETRO-077 complete; FOLLOW-309-312 generated     |
| FOLLOW-309/310/311/312      | UI bug fixes   | DONE      | #299           | Merged 2026-06-14; retro pending spawn                              |
| FOLLOW-293                  | Closure gate   | UNBLOCKED | —              | All deps DONE; ready to delegate to qa-engineer                     |

## READY tickets (next up)

- FOLLOW-293 (P2 qa-engineer) — live-network smoke; all deps DONE; delegate NOW
- FOLLOW-317 (P2 data-engineer) — alias-shadow audit; stub needs Sprint 18 promotion
- FOLLOW-318 (P2 qa-engineer) — AC2 assertion tighten; stub needs Sprint 18 promotion

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

- RETRO-064 — FOLLOW-266 Phase 1 (PR #277, data-engineer) — PENDING SPAWN
- RETRO-067 — FOLLOW-266 Phase 3 (PR #280, sdk-engineer) — PENDING SPAWN
- RETRO-068 — FOLLOW-286 (PR #279, backend-engineer) — PENDING SPAWN
- RETRO for PR #299 (FOLLOW-309/310/311/312 tracer UI bug fixes, backend-engineer) — PENDING SPAWN

Next free RETRO number: 080 (RETRO-079 = FOLLOW-316 / PR #305, complete). Spawn order: RETRO-064
first (oldest; foundation for K.3.6 data plane).

## Open escalations (age in days as of 2026-06-15)

| ESC     | Title                                                           | Filed      | Age | Status                                                                  |
| ------- | --------------------------------------------------------------- | ---------- | --- | ----------------------------------------------------------------------- |
| ESC-020 | Estalara-app DOM hooks committed but not deployed to production | 2026-06-06 | 9d  | Non-blocking per CEO 2026-06-10; Rafal action deferred until local test |

All ESC-001 through ESC-023 RESOLVED (ESC-022+ESC-023 resolved 2026-06-15; ESC-021 resolved
2026-06-12 via FOLLOW-288 / PR #282).

## CI check counter (current session)

State-correction pass (FOLLOW-269 → DONE, STATUS.md + QUEUE.md updated). No PRs validated. CI check
counter: 0/5. Fix iteration counter: 0/3.

## Notes

- K.3.6 D-1 is PRODUCTION-LIVE as of 2026-06-14. The full chain (snippet → SDK init →
  fetchIntentWeights → GET /api/intent/config → weights applied to processSignal()) is wired and the
  seed row exists in prod. FOLLOW-293 (live-network smoke) is the final verification step.
- ESC-022 + ESC-023 FULLY RESOLVED 2026-06-15. FOLLOW-308 DONE (db-migrate.yml LIVE). ESC-020
  remains OPEN but is non-blocking per CEO (2026-06-10).
- FOLLOW-269 DONE — PR #298 merged 2026-06-14. RETRO-077 complete (3 wiring bugs found).
  FOLLOW-309/310/311/312 DONE — PR #299 merged 2026-06-14.
- FOLLOW-293 (closure gate / live smoke) now UNBLOCKED. All dependencies DONE. Ready to delegate to
  qa-engineer immediately.
- FOLLOW-303 (data_source round-trip test + MAX_POLLS pin): still pending delegation.
- FOLLOW-295 / FOLLOW-296 are independent and can be scheduled in parallel with FOLLOW-303.
- RETRO-064/067/068 pending spawn since 2026-06-12 (3 days). Plus retro for PR #299 pending. PM
  spawning RETRO-064 first (FOLLOW-266 Phase 1, PR #277, data-engineer, oldest).
- FOLLOW-317 (data-engineer, alias-shadow audit, P2) and FOLLOW-318 (qa-engineer, assertion tighten,
  P2) need Sprint 18 promotion and ticket files.
