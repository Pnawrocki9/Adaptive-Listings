# PM Orchestrator Status

**Last updated:** 2026-06-14T10:00Z

## OPERATIONAL RECORD — Prod Supabase 14-migration drift catch-up (2026-06-14)

**HEADLINE:** On 2026-06-14, prod Supabase (project yhmivuqeqkmzpxpyrsvc, eu-west-3) was found to be
**14 migrations behind** — `drizzle.__drizzle_migrations` had only 17 entries (last applied
2026-05-28, migration ~0016), while the repo was at migration 0030. Migrations 0017 through 0030 had
**NEVER been applied to prod**, including:

- Compliance: 0019/0020 (conversion_labels), 0024 (dsr_durable_lead_id / DSR erasure tracking)
- Product: 0021 (engagement_scores), 0022 (quiz_completions), 0025 (tenants_quiz_enabled), 0026/0027
  (quiz_config strips)
- K.3.6: 0028 (intent_sessions), 0029 (intent_weight_configs), 0030 (seed)

**STATUS: RESOLVED (apply).** All 14 migrations applied cleanly via
`doppler run --config prd -- pnpm db:migrate` on 2026-06-14T09:26:45Z. Prod
`drizzle.__drizzle_migrations` now = 31 (full repo count). Seed row verified:
`intent_weight_configs` id=3ecd053e-3d2e-4eed-a900-0a42ff8c3f9e, tenant_id=NULL, is_active=true,
weights={}, created_at=2026-06-14T09:26:45Z. `GET /api/intent/config` now returns
`data_source:'live'` for override-less tenants. Note: prod was AUTO-PAUSED (Supabase idle pause) and
had to be resumed — confirms pre-pilot phase.

**ROOT CAUSE:** No auto-apply mechanism for Postgres migrations (RETRO-076 OG-1). Only ClickHouse
has auto-apply (ci.yml:315). Drizzle `pnpm db:migrate` is operator-driven only.

**PREVENTION:** FOLLOW-308 (P1 devops) tracks the standing-mechanism decision. ESC-022 (OPEN)
requires human sign-off on compliance migration gap + mechanism choice.

---

## Current sprints

- **Sprint 17 OPEN** — K.3.6 D-1 PRODUCTION-LIVE as of 2026-06-14 (FOLLOW-307 DONE). 19 DONE, 0
  READY, 2 BLOCKED (FOLLOW-269/FOLLOW-293), backlog: FOLLOW-295/296/298/300/303/304/306/308
  - pre-existing FOLLOW-282/290/291/292.
- **Sprint 16 COMPLETE** — 16/17 DONE; FOLLOW-191 READY_FOR_REVIEW (ESC-020 pending Rafal deploy,
  non-blocking per CEO 2026-06-10).
- **Sprint 15 COMPLETE** — 21/21 DONE.

## IN_PROGRESS tickets (0/3 max)

None active.

## ADR-0012 D-1 chain — complete dependency tree (as of 2026-06-14T10:00Z)

| Ticket                      | Label          | Status      | PR / commit    | Notes                                                               |
| --------------------------- | -------------- | ----------- | -------------- | ------------------------------------------------------------------- |
| FOLLOW-266                  | Foundation     | DONE        | #277/278/280   | DB schema + SDK emission (3 phases)                                 |
| FOLLOW-286                  | Prereq         | DONE        | #279           | on_conflict / event_type / join-key fixes                           |
| FOLLOW-287/288              | CH smoke       | DONE        | #281/282       | migration 0016 no-op; ESC-021 RESOLVED                              |
| FOLLOW-267                  | Ticket —       | DONE        | #283           | 8 tracer routes + /api/intent/config                                |
| FOLLOW-294 (Ticket A)       | Auth + schema  | DONE        | #284 (4e45e3a) | cross-tenant enum gap closed; IntentWeightsSchema                   |
| FOLLOW-268-write (Ticket B) | Write API      | DONE        | #285 (2998a93) | POST/PUT; write-side validation satisfied                           |
| FOLLOW-297 (Ticket D)       | Tests          | DONE        | #286 (8cdf94f) | 111 tests; DG-1 docstring fixed                                     |
| FOLLOW-299 (enum prereq)    | Enum prereq    | DONE        | #287 (c387103) | data_source widened to include 'error'                              |
| FOLLOW-301                  | Invariant      | DONE        | #289 (a14c907) | one-active invariant + ORDER BY + real POST→GET test                |
| FOLLOW-268 (Ticket C)       | SDK init       | DONE        | #290 (ea2089b) | resolveIntentOverrides + fetchIntentWeights                         |
| FOLLOW-305                  | URL fix        | DONE        | #291 (3d9e8f0) | buildEndpoint; fixed double-/api on 4 SDK endpoints                 |
| FOLLOW-266 Ph2 seed         | Seed           | DONE        | #293 (6381499) | migration 0030 merged; global-default row in repo                   |
| **FOLLOW-307**              | **Prod apply** | **DONE**    | operator apply | All 14 pending migrations applied 2026-06-14; seed verified in prod |
| **FOLLOW-308**              | **Auto-apply** | **PR-OPEN** | PR (inert)     | db-migrate.yml implemented; inert until ESC-023 secrets provisioned |
| FOLLOW-269                  | Frontend UI    | BLOCKED     | —              | Blocked on FOLLOW-268 (Ticket C — now DONE); ready to delegate      |
| FOLLOW-293                  | Closure gate   | BLOCKED     | —              | FOLLOW-307 done → now blocked only on FOLLOW-269; live smoke needed |

## READY tickets (next up)

No tickets currently READY. Immediate priorities for next sprint planning:

- FOLLOW-308 (P1 devops) — PR-OPEN (inert-pending-secret ESC-023): db-migrate.yml implemented;
  activates when DOPPLER_TOKEN_STG + DOPPLER_TOKEN_PRD provisioned; AC3 blocked on ESC-022
- FOLLOW-293 (P2 qa-engineer) — live-network smoke test; now unblocked by FOLLOW-307 DONE
- FOLLOW-269 (P2 backend-engineer) — frontend UI; now unblocked by FOLLOW-268 DONE

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

## Open escalations (age in days as of 2026-06-14)

| ESC     | Title                                                                        | Filed      | Age | Status                                                                  |
| ------- | ---------------------------------------------------------------------------- | ---------- | --- | ----------------------------------------------------------------------- |
| ESC-020 | Estalara-app DOM hooks committed but not deployed to production              | 2026-06-06 | 8d  | Non-blocking per CEO 2026-06-10; Rafal action deferred until local test |
| ESC-022 | Prod Supabase was 14 migrations behind — compliance gap + standing mechanism | 2026-06-14 | 0d  | **OPEN — requires human sign-off (Piotr/Rafal); blocks FOLLOW-308 AC3** |

All ESC-001 through ESC-021 RESOLVED (ESC-021 resolved 2026-06-12 via FOLLOW-288 / PR #282).

## CI check counter (current session)

Bookkeeping/status update session only — no PRs validated. CI check counter: 0/5. Fix iteration
counter: 0/3.

## Notes

- K.3.6 D-1 is PRODUCTION-LIVE as of 2026-06-14. The full chain (snippet → SDK init →
  fetchIntentWeights → GET /api/intent/config → weights applied to processSignal()) is wired and the
  seed row exists in prod. FOLLOW-293 (live-network smoke) is the final verification step.
- ESC-022 is the blocking human-decision item this session. Compliance gap from 14-migration drift
  must be confirmed benign (pre-pilot, no real traffic) and standing mechanism chosen (Option A or B
  per FOLLOW-308). Do not close FOLLOW-308 until ESC-022 is resolved.
- FOLLOW-293 (closure gate / live smoke) can now be delegated to qa-engineer once sprint capacity
  permits. It was previously blocked on FOLLOW-307 (now DONE).
- FOLLOW-269 (frontend UI) is now unblocked by FOLLOW-268 (Ticket C — DONE). Ready to delegate to
  backend-engineer at next sprint planning.
- FOLLOW-303 (data_source round-trip test + MAX_POLLS pin): still pending delegation.
- FOLLOW-295 / FOLLOW-296 are independent and can be scheduled in parallel with FOLLOW-303.
- RETRO-064/067/068 remain pending spawn from earlier. PM should spawn these at next available slot.
- This bookkeeping pass (QUEUE.md + STATUS.md + ESCALATIONS.md + FOLLOW_UPS.md) captures the
  2026-06-14 prod apply event and drift finding. No code was changed.
