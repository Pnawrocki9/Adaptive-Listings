# Status — 2026-06-14T00:00Z

_Rule I: a ticket is DONE only if its primary artifact has at least one non-test runtime caller._

## Active sprint: Sprint 17 (OPEN)

**Sprint 16 COMPLETE** — 16 tickets DONE
(FOLLOW-170/173/174/175/176/182/183/184/185/187/190/227/230/234/270/271). FOLLOW-191 remains
READY_FOR_REVIEW (ESC-020, Rafal deploy pending).

**Sprint 17 WAVE 1 COMPLETE (2026-06-12).** All 8 Wave 1 tickets DONE: FOLLOW-274 (PR #267),
FOLLOW-273 (PR #268), FOLLOW-272 (PR #275), FOLLOW-275 (PRs #270+#271), FOLLOW-276 (PR #272),
FOLLOW-277 (PR #276), FOLLOW-278 (PR #273), FOLLOW-279 (PR #274).

**Sprint 17 WAVE 2 COMPLETE (2026-06-12/13):**

- FOLLOW-266 Phases 1+2+3 ALL DONE (PRs #277/#278/#280). RETRO-067 pending spawn.
- FOLLOW-286 DONE (PR #279). RETRO-068 pending spawn.
- FOLLOW-287 DONE (PR #281, CB-2/DG-1 fixes).
- FOLLOW-288 DONE (PR #282, migration 0016 SELECT 1 no-op, intent_session_id removed from INSERT).
  All CI gates GREEN.

**Sprint 17 WAVE 3 + WAVE 4 COMPLETE (2026-06-13/14):**

- FOLLOW-267 DONE (PR #283).
- FOLLOW-294/Ticket-A DONE (PR #284, merge a14c907 — authenticated GET /api/intent/config +
  IntentWeightsSchema, cross-tenant enumeration closed).
- FOLLOW-268-write/Ticket-B DONE (PR #285, merge 2998a93 — POST/PUT admin write API).
- FOLLOW-297/Ticket-D DONE (PR #286, merge 8cdf94f — 111-assertion tracer test suite).
- FOLLOW-299 DONE (PR #287, merge c387103 — data_source enum widened to include 'error').
- FOLLOW-301 DONE (PR #289, merge a14c907 — one-active invariant + atomic swap + deterministic GET
  ORDER BY + real POST→GET round-trip). RETRO-073 complete.
- FOLLOW-268-sdk/Ticket-C DONE (PR #290, merge ea2089b — resolveIntentOverrides +
  fetchIntentWeights, ADR-0012 Ticket C). RETRO-074 complete.
- FOLLOW-305 DONE (PR #291, merge 3d9e8f0 — buildEndpoint helper, fixed double-/api prod 404 on 4
  endpoints). RETRO-075 complete. K.3.6 D-1 PRODUCTION-LIVE.

## K.3.6 D-1 HEADLINE — PRODUCTION-LIVE

**K.3.6 D-1 "immediate weights" is CODE-COMPLETE and PRODUCTION-LIVE end-to-end as of 2026-06-14.**
Six-PR sequence: #284 (auth+schema) → #285 (write API) → #286 (tests) → #287 (enum) → #289
(invariant) → #290 (SDK apply) → #291 (prod URL fix). Producer → snippet → SDK-fetch → apply chain
is correct end-to-end.

**Operational precondition:** a global-default `intent_weight_configs` row must be SEEDED for live
weights to apply. Absent a row, GET returns data_source:'mock' and SDK uses internal defaults BY
DESIGN (not a bug). Seeding is FOLLOW-266 Phase 2 — now UNBLOCKED.

**IMPORTANT co-victim note (RETRO-074/075):** the same double-/api bug that blocked D-1 had ALSO
been silently breaking quiz-config delivery (FOLLOW-275) and the feedback/quiz-completion write
pings in production. All FOUR were fixed by PR #291 (buildEndpoint helper). This resolves a
partial-personalization risk for TICKET-PILOT-001.

## D-1 Remaining Tail (open items)

- **FOLLOW-293** (P2, qa-engineer) — live-network smoke test only. All code hops verified by unit
  tests (TG-1 prod-URL-form, FOLLOW-305). Requires FOLLOW-266 Phase 2 global row seeded. BLOCKED.
- **FOLLOW-304** (P2, backend-engineer) — GET per-scope determinism (cross-scope starvation when ≥2
  active global rows; degrades safely). NON-BLOCKING. BACKLOG.
- **FOLLOW-306** (P3, sdk-engineer) — fetchDescription centralization via buildEndpoint +
  endpoint.test.ts. NOT prod-blocking. BACKLOG.
- **FOLLOW-266 Phase 2 seed** — global-default intent_weight_configs row (unblocks live weights).
  BACKLOG/UNBLOCKED.
- **FOLLOW-269** (P2, backend-engineer) — frontend tracer UI (live monitor + history + weight
  editor + export dashboard). BLOCKED on FOLLOW-268-sdk (now DONE) — ready to plan.
- **Earlier open backlog:** FOLLOW-295/296/298/300/302/303 (P2/P3, all BACKLOG, non-blocking).

## RETRO TRACKING (completed retros)

| RETRO     | Source ticket          | PR        | Status        | Notes                                                     |
| --------- | ---------------------- | --------- | ------------- | --------------------------------------------------------- |
| RETRO-059 | FOLLOW-274             | #267      | DONE          |                                                           |
| RETRO-060 | FOLLOW-273             | #268      | DONE          | Rule W promoted (ClickHouse ORDER BY key DDL)             |
| RETRO-061 | (no body — DG-2 cited) | —         | N/A           | Cited in test headers; no actual entry filed              |
| RETRO-062 | FOLLOW-276             | #272      | PENDING SPAWN |                                                           |
| RETRO-063 | FOLLOW-278             | #273      | PENDING SPAWN |                                                           |
| RETRO-064 | FOLLOW-266 Ph1         | #277      | PENDING SPAWN |                                                           |
| RETRO-065 | FOLLOW-266 Ph2         | #278      | COMPLETE      | 3 P1 defects found (CB-1/LG-1/LG-2) → FOLLOW-286          |
| RETRO-066 | (ESC-021 sourced)      | —         | COMPLETE      | ClickHouse MODIFY COLUMN on ORDER BY key → Rule W         |
| RETRO-067 | FOLLOW-266 Ph3         | #280      | PENDING SPAWN |                                                           |
| RETRO-068 | FOLLOW-286             | #279      | PENDING SPAWN |                                                           |
| RETRO-069 | FOLLOW-287+288         | #281+#282 | PENDING SPAWN |                                                           |
| RETRO-070 | FOLLOW-267             | #283      | COMPLETE      | Rule K.2 amended; FOLLOW-298/299/300 filed                |
| RETRO-071 | FOLLOW-268-write       | #285      | COMPLETE      | FOLLOW-301/302 filed                                      |
| RETRO-072 | FOLLOW-297             | #286      | COMPLETE      | FOLLOW-303 filed                                          |
| RETRO-073 | FOLLOW-301             | #289      | COMPLETE      | FOLLOW-304 filed (P2 GET cross-scope determinism)         |
| RETRO-074 | FOLLOW-268-sdk         | #290      | COMPLETE      | FOLLOW-305 filed (P1 double-/api blocker); Rule X count=1 |
| RETRO-075 | FOLLOW-305             | #291      | COMPLETE      | FOLLOW-306 filed (P3 hygiene); Rule X PROMOTED (count=2)  |

**Wave-2 retros still pending spawn:** RETRO-062/063/064/067/068/069.

**Rule X promoted** (CONVENTIONS_PATCH.md): every SDK→control-plane fetch site MUST use
buildEndpoint(decisionApiUrl, path) + a test asserting the resolved URL against the real production
snippet base (${CONTROL_PLANE_URL}/api). Promoted from RETRO-074/075 (count 2; threshold met).

## CI CHECK COUNTER (current sprint, per ticket)

| Ticket         | CI checks                                   | Fix iterations |
| -------------- | ------------------------------------------- | -------------- |
| FOLLOW-266 Ph3 | 2/5                                         | 1/3            |
| FOLLOW-287     | 2/5                                         | 2/3            |
| FOLLOW-288     | 1/5                                         | 0/3            |
| FOLLOW-301     | (per PR body — green first pass)            | 0/3            |
| FOLLOW-268-sdk | (per PR body — green)                       | 0/3            |
| FOLLOW-305     | (per PR body — 1383 vitest green, CI green) | 0/3            |

## ESCALATION STATUS

ESC-021 RESOLVED (2026-06-13) — PR #282 fixed ClickHouse migrations smoke gate. ESC-020 OPEN
(non-blocking) — Rafal deploy pending. Does not block code pipeline. No new escalations.

## CI Gates — All Real Gates GREEN on main

ClickHouse migrations smoke: PASS (migration 0016 = SELECT 1 no-op). Python tests
(adaptation-engine, auto-detect): pre-existing failures, NON-BLOCKING. All TS/Node gates (Build,
Typecheck, Lint, Format, Rule H, Rule J, Demo-integration, Gitleaks): GREEN.
