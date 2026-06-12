# Status — 2026-06-12T19:00Z

_Rule I: a ticket is DONE only if its primary artifact has at least one non-test runtime caller._

## Active sprint: Sprint 17 (OPEN)

**Sprint 16 COMPLETE** — 16 tickets DONE
(FOLLOW-170/173/174/175/176/182/183/184/185/187/190/227/230/234/270/271). FOLLOW-191 remains
READY_FOR_REVIEW (ESC-020, Rafal deploy pending).

**Sprint 17 WAVE 1 COMPLETE (2026-06-12).** All 8 Wave 1 tickets DONE: FOLLOW-274 (PR #267),
FOLLOW-273 (PR #268), FOLLOW-272 (PR #275), FOLLOW-275 (PRs #270+#271), FOLLOW-276 (PR #272),
FOLLOW-277 (PR #276), FOLLOW-278 (PR #273), FOLLOW-279 (PR #274).

**Sprint 17 WAVE 2 started 2026-06-12.** FOLLOW-266 Phase 2 IN_PROGRESS (backend-engineer).

## ESCALATION STATUS — ESC-020 OPEN (non-blocking)

ESC-020 is OPEN but CEO confirmed 2026-06-10: does NOT block code work pipeline. Only blocks
FOLLOW-191 final verification and FOLLOW-197 (adapt.applied signal). Age: 10 days.

## Pre-existing Build failure NOTE (2026-06-12T19:00Z)

The `Build` CI job (SDK bundle size gate: 51.24KB > 40KB) has been failing on `main` since before
Sprint 17 opened. Confirmed pre-existing. Treated as pre-existing-red alongside Rule I and
Python-test failures per project precedent.

## Pending retro spawns

| Retro     | Ticket        | PR   | Merged at            | Status        |
| --------- | ------------- | ---- | -------------------- | ------------- |
| RETRO-062 | FOLLOW-276    | #272 | 2026-06-12T05:41:35Z | PENDING SPAWN |
| RETRO-063 | FOLLOW-278    | #273 | 2026-06-12T05:46:59Z | PENDING SPAWN |
| RETRO-064 | FOLLOW-266 P1 | #277 | 2026-06-12T18:23:36Z | PENDING SPAWN |

## Currently IN_PROGRESS

| Ticket     | Agent            | Started              | CI-check counter  |
| ---------- | ---------------- | -------------------- | ----------------- |
| FOLLOW-266 | backend-engineer | 2026-06-12T19:00:00Z | 0/5, fix-iter 0/3 |

1 of 3 max in flight.

## READY_FOR_REVIEW

| Ticket     | PR  | CI status                       |
| ---------- | --- | ------------------------------- |
| FOLLOW-191 | —   | Awaiting Rafal deploy (ESC-020) |

## Open escalations

| ID      | Age | Description                                                          | Blocking?                          |
| ------- | --- | -------------------------------------------------------------------- | ---------------------------------- |
| ESC-020 | 10d | Rafal must deploy web-master HEAD + PUBLIC_ESTALARA_SDK_ENABLED=true | FOLLOW-191 final verification only |

## Sprint 17 CI-check counters

| Ticket     | CI checks run | Fix iterations | Result                 |
| ---------- | ------------- | -------------- | ---------------------- |
| FOLLOW-274 | 1/5           | 0/3            | MERGED (PR #267)       |
| FOLLOW-273 | 1/5           | 0/3            | MERGED (PR #268)       |
| FOLLOW-272 | 1/5           | 0/3            | MERGED (PR #275)       |
| FOLLOW-275 | 1/5           | 0/3            | MERGED (PRs #270+#271) |
| FOLLOW-276 | 1/5           | 0/3            | MERGED (PR #272)       |
| FOLLOW-277 | 1/5           | 0/3            | MERGED (PR #276)       |
| FOLLOW-278 | 1/5           | 0/3            | MERGED (PR #273)       |
| FOLLOW-279 | 1/5           | 0/3            | MERGED (PR #274)       |
| FOLLOW-266 | 0/5           | 0/3            | IN_PROGRESS (Phase 2)  |

## Status corrections this session (2026-06-12T19:00Z)

| Ticket         | Old status  | Correct status       | PR   | Note                                                                       |
| -------------- | ----------- | -------------------- | ---- | -------------------------------------------------------------------------- |
| FOLLOW-266 Ph1 | IN_PROGRESS | DONE (Phase 1)       | #277 | PR #277 merged 2026-06-12T18:23:36Z; Phase 2 delegated to backend-engineer |
| FOLLOW-276     | DONE        | DONE (retro pending) | #272 | RETRO-062 pending spawn                                                    |
| FOLLOW-278     | DONE        | DONE (retro pending) | #273 | RETRO-063 pending spawn                                                    |

## Prior status corrections (2026-06-11T21:30Z)

| Ticket     | Old status  | Correct status | PR   | Note                                           |
| ---------- | ----------- | -------------- | ---- | ---------------------------------------------- |
| FOLLOW-271 | IN_PROGRESS | DONE           | #266 | PR #266 merged 2026-06-11; STATUS.md was stale |
| Sprint 16  | OPEN        | COMPLETE       | —    | All 16 non-READY_FOR_REVIEW tickets DONE       |

## Prior status corrections (2026-06-11T10:00Z)

| Ticket     | Old status       | Correct status | PR   | Note                                              |
| ---------- | ---------------- | -------------- | ---- | ------------------------------------------------- |
| FOLLOW-270 | READY_FOR_REVIEW | DONE           | #265 | PR #265 merged 2026-06-11; all real CI gates pass |
| FOLLOW-169 | READY_FOR_REVIEW | DONE           | #264 | PR #264 merged 2026-06-11T06:29:18Z               |

## Prior status corrections (2026-06-10)

| Ticket     | Old status       | Correct status | PR   | Merged at            |
| ---------- | ---------------- | -------------- | ---- | -------------------- |
| FOLLOW-258 | READY_FOR_REVIEW | DONE           | #249 | 2026-06-10T05:19:30Z |
| FOLLOW-259 | READY            | DONE           | #250 | 2026-06-10T05:19:56Z |
| FOLLOW-260 | READY_FOR_REVIEW | DONE           | #251 | 2026-06-10T09:28:39Z |
| FOLLOW-261 | READY_FOR_REVIEW | DONE           | #252 | 2026-06-10T09:46:34Z |
| FOLLOW-262 | READY_FOR_REVIEW | DONE           | #253 | 2026-06-10T10:05:52Z |
| FOLLOW-185 | IN_PROGRESS      | DONE           | #243 | 2026-06-08T22:51:42Z |
| FOLLOW-175 | READY            | DONE           | #245 | 2026-06-09T00:00:00Z |
| FOLLOW-099 | READY            | DONE           | #248 | 2026-06-09T20:34:41Z |
| FOLLOW-173 | IN_PROGRESS      | DONE           | #216 | 2026-06-07T00:00:00Z |

## Sprint 8 Rule I audit (legacy, 2026-05-17)

| Ticket      | Queue status | Rule I status                    |
| ----------- | ------------ | -------------------------------- |
| AB-001      | DONE         | PARTIAL (FOLLOW-007 resolved it) |
| REORDER-001 | DONE         | DONE                             |
| TICKET-046  | DONE         | PARTIAL (FOLLOW-007 resolved it) |
| ARCH-003    | DONE         | DONE                             |
| AGENCY-001  | DONE         | DONE                             |
| AB-004      | DONE         | DONE                             |
