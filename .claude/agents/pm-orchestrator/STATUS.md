# PM Orchestrator — Session Status

**Date:** 2026-06-14 **Session:** Loop 5 (promote FOLLOW-269 from BLOCKED to IN_PROGRESS, close
FOLLOW-308 DONE, delegate FOLLOW-269 to backend-engineer)

---

## Open Escalations (ages)

| ESC     | Title                                                               | Filed      | Age | Blocker?                                                                 |
| ------- | ------------------------------------------------------------------- | ---------- | --- | ------------------------------------------------------------------------ |
| ESC-020 | Estalara-app DOM hooks not deployed to prod                         | 2026-06-06 | 8d  | Rafal action; pipeline unblocked per CEO 2026-06-10                      |
| ESC-022 | Prod 14-migration drift — item (2) standing mechanism decision OPEN | 2026-06-14 | 0d  | Blocks FOLLOW-308 AC3 only; FOLLOW-308 AC1+AC2 DONE (PR #297)            |
| ESC-023 | DOPPLER_TOKEN_STG + DOPPLER_TOKEN_PRD secrets must be provisioned   | 2026-06-14 | 0d  | Operator action (Piotr); blocks db-migrate.yml activation, not code work |

ESC-021 RESOLVED 2026-06-13. ESC-022 item (1) RESOLVED 2026-06-14 (CEO sign-off). FOLLOW-308 DONE
(Option A auto-apply PR #297 merged 2026-06-14T12:40Z).

---

## Tickets Updated This Session (2026-06-14)

| Ticket     | Was     | Now         | PR   | Notes                                                 |
| ---------- | ------- | ----------- | ---- | ----------------------------------------------------- |
| FOLLOW-269 | BLOCKED | IN_PROGRESS | —    | All depends_on DONE; delegated to backend-engineer    |
| FOLLOW-308 | BACKLOG | DONE        | #297 | Option A merged 2026-06-14T12:40Z (64ac12c); AC3 open |

---

## Current In-Flight

1 ticket IN_PROGRESS: FOLLOW-269 (K.3.6 frontend UI, backend-engineer).

**IN_PROGRESS count: 1 / 3 max.**

---

## CI Check Counter (FOLLOW-269 — active ticket)

- CI checks run: 0/5
- Fix iterations: 0/3

---

## Pending Retros (6 retros queued for spawning)

| Retro     | For ticket                  | PR        | Status        |
| --------- | --------------------------- | --------- | ------------- |
| RETRO-062 | FOLLOW-276 (stale docs)     | #272      | Pending spawn |
| RETRO-063 | FOLLOW-278 (consent locale) | #273      | Pending spawn |
| RETRO-064 | FOLLOW-266 Phase 1 (CH DDL) | #277      | Pending spawn |
| RETRO-067 | FOLLOW-266 Phase 3 (SDK)    | #280      | Pending spawn |
| RETRO-068 | FOLLOW-286 (ingest fix)     | #279      | Pending spawn |
| RETRO-069 | FOLLOW-287+288 (CH fix)     | #281+#282 | Pending spawn |

Spawn order (recommend): RETRO-064 first (ClickHouse DDL — may surface P0/P1 schema defects that
affect FOLLOW-269 replay design), then RETRO-067/068/069 (SDK + ingest), then RETRO-062/063 (docs).

---

## Next Ticket (after FOLLOW-269 completes)

FOLLOW-293 (P2, qa-engineer) — live-network D-1 smoke test. Blocked on FOLLOW-269 completing.
FOLLOW-303 (P2, backend-engineer) — tracer enum drift + test gaps. Ready now (no blocker).
FOLLOW-295 (P2, backend-engineer) — tracer session tenant-scoping. Ready now (no blocker).
