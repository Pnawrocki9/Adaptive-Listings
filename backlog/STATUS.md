# Status — 2026-06-11T21:30Z

_Rule I: a ticket is DONE only if its primary artifact has at least one non-test runtime caller._

## Active sprint: Sprint 17 (OPEN)

**Sprint 16 COMPLETE** — 16 tickets DONE
(FOLLOW-170/173/174/175/176/182/183/184/185/187/190/227/230/234/270/271). FOLLOW-191 remains
READY_FOR_REVIEW (ESC-020, Rafal deploy pending).

**Sprint 17 started 2026-06-11.**

## ESCALATION STATUS — ESC-020 OPEN (non-blocking)

ESC-020 is OPEN but CEO confirmed 2026-06-10: does NOT block code work pipeline. Only blocks
FOLLOW-191 final verification and FOLLOW-197 (adapt.applied signal). Age: 8 days.

## Pre-existing Build failure NOTE (2026-06-11T21:30Z)

The `Build` CI job (SDK bundle size gate: 51.24KB > 40KB) has been failing on `main` since before
Sprint 17 opened. Confirmed pre-existing on commits: eff0158 (PM chore), de94873 (PR #266
post-merge), 114b9a6 (PR #265 post-merge). PRs #265 and #266 were merged under this condition. This
failure is NOT introduced by FOLLOW-274 or FOLLOW-273. It is treated as pre-existing-red alongside
Rule I and Python-test failures per project precedent. A FOLLOW ticket for SDK bundle reduction
should be filed at next sprint planning.

## Currently IN_PROGRESS

| Ticket     | Agent     | Started              | CI-check counter                   |
| ---------- | --------- | -------------------- | ---------------------------------- |
| FOLLOW-275 | architect | 2026-06-11T21:30:00Z | N/A (architectural ADR, no PR yet) |

1 of 3 max in flight.

## READY_FOR_REVIEW

| Ticket     | PR   | CI status                                                                                                                                                                                                                                 |
| ---------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FOLLOW-274 | #267 | Real gates GREEN (TypeCheck, Lint, Format, Test Node22, Rule H/J, corpus, migrations, demo, Doppler, Gitleaks, Vercel). Build (SDK bundle) + Rule I + Python tests = pre-existing-red on main, non-blocking. CI check: 1/5, fix-iter: 0/3 |
| FOLLOW-273 | #268 | Real gates GREEN (TypeCheck, Lint, Format, Test Node22, Rule H/J, corpus, migrations, demo, Doppler, Gitleaks, Vercel). Build (SDK bundle) + Rule I + Python tests = pre-existing-red on main, non-blocking. CI check: 1/5, fix-iter: 0/3 |
| FOLLOW-191 | —    | Awaiting Rafal deploy (ESC-020)                                                                                                                                                                                                           |

## READY

| Ticket     | Agent       | Priority | Notes                                    |
| ---------- | ----------- | -------- | ---------------------------------------- |
| FOLLOW-272 | ml-engineer | P3       | Headline fact-check precision tightening |

## Open escalations

| ID      | Age | Description                                                          | Blocking?                          |
| ------- | --- | -------------------------------------------------------------------- | ---------------------------------- |
| ESC-020 | 8d  | Rafal must deploy web-master HEAD + PUBLIC_ESTALARA_SDK_ENABLED=true | FOLLOW-191 final verification only |

## Sprint 17 CI-check counters

| Ticket     | CI checks run | Fix iterations |
| ---------- | ------------- | -------------- |
| FOLLOW-274 | 1/5           | 0/3            |
| FOLLOW-273 | 1/5           | 0/3            |

## Prior status corrections (2026-06-11T12:00Z)

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
