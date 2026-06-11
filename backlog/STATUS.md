# Status — 2026-06-11T08:00Z

_Rule I: a ticket is DONE only if its primary artifact has at least one non-test runtime caller._

## Active sprint: Sprint 14 (ACTIVE — FOLLOW-169 READY_FOR_REVIEW)

**Sprint 16 COMPLETE — 14 DONE** (FOLLOW-170/173/174/175/176/182/183/184/185/187/190/227/230/234).
Wave A ALL DONE: FOLLOW-258/259/260/261/262 (all PRs merged 2026-06-10). FOLLOW-099 DONE (PR #248).
**Sprint 13b COMPLETE** — FOLLOW-257 (PR #259) + FOLLOW-263 (PR #260) + FOLLOW-264 (PR #263) +
FOLLOW-265 (PR #262). All DONE 2026-06-11. RETRO-052/053 complete: Rule U + Rule G (amendment)
promoted; FOLLOW-270/271 stubs created.

**2 READY_FOR_REVIEW** — FOLLOW-169 (PR #264, all real CI gates green) + FOLLOW-191 (awaiting Rafal
deploy ESC-020).

## ESCALATION STATUS — ESC-020 OPEN (non-blocking)

ESC-020 is OPEN but CEO confirmed 2026-06-10: does NOT block code work pipeline. Only blocks
FOLLOW-191 final verification and FOLLOW-197 (adapt.applied signal).

## Currently IN_PROGRESS

None — 0 of 3 max in flight.

## READY_FOR_REVIEW

| Ticket     | PR   | CI status                         |
| ---------- | ---- | --------------------------------- |
| FOLLOW-169 | #264 | All real gates green (2026-06-11) |
| FOLLOW-191 | —    | Awaiting Rafal deploy (ESC-020)   |

## Open escalations

| ID      | Age | Description                                                          | Blocking?                          |
| ------- | --- | -------------------------------------------------------------------- | ---------------------------------- |
| ESC-020 | 6d  | Rafal must deploy web-master HEAD + PUBLIC_ESTALARA_SDK_ENABLED=true | FOLLOW-191 final verification only |

## QUEUE.md stale corrections applied 2026-06-10T12:00Z

| Ticket     | Old status  | Correct status | PR   | Note                                         |
| ---------- | ----------- | -------------- | ---- | -------------------------------------------- |
| FOLLOW-182 | IN_PROGRESS | DONE           | #222 | Sprint 14 section stale; Sprint 16 canonical |
| FOLLOW-183 | READY       | DONE           | #228 | Sprint 14 section stale; Sprint 16 canonical |

## Open escalations

| ID      | Age | Description                                                          | Blocking?                           |
| ------- | --- | -------------------------------------------------------------------- | ----------------------------------- |
| ESC-009 | 17d | E2E_BEARER_TOKEN secret not provisioned                              | demo-integration CI soft-skips only |
| ESC-010 | 17d | DOPPLER_TOKEN_DEV not provisioned                                    | doppler-verify CI soft-skips only   |
| ESC-020 | 5d  | Rafal must deploy web-master HEAD + PUBLIC_ESTALARA_SDK_ENABLED=true | FOLLOW-191 final verification only  |

## Wave A status corrections applied 2026-06-10

All 5 Wave A tickets confirmed DONE via gh pr state checks:

| Ticket     | Old status       | Correct status | PR   | Merged at            |
| ---------- | ---------------- | -------------- | ---- | -------------------- |
| FOLLOW-258 | READY_FOR_REVIEW | DONE           | #249 | 2026-06-10T05:19:30Z |
| FOLLOW-259 | READY            | DONE           | #250 | 2026-06-10T05:19:56Z |
| FOLLOW-260 | READY_FOR_REVIEW | DONE           | #251 | 2026-06-10T09:28:39Z |
| FOLLOW-261 | READY_FOR_REVIEW | DONE           | #252 | 2026-06-10T09:46:49Z |
| FOLLOW-262 | READY_FOR_REVIEW | DONE           | #253 | 2026-06-10T10:05:56Z |

## Additional status corrections applied 2026-06-10

| Ticket     | Old status  | Correct status | PR   | Merged at            |
| ---------- | ----------- | -------------- | ---- | -------------------- |
| FOLLOW-185 | IN_PROGRESS | DONE           | #243 | 2026-06-08T22:51:42Z |
| FOLLOW-175 | READY       | DONE           | #245 | 2026-06-09T00:00:00Z |
| FOLLOW-099 | READY       | DONE           | #248 | 2026-06-09T20:34:41Z |
| FOLLOW-173 | IN_PROGRESS | DONE           | #216 | 2026-06-07T00:00:00Z |

## Sprint 16 status corrections applied 2026-06-09

The following tickets had stale statuses in QUEUE.md (Sprint 16 section). All corrected atomically:

| Ticket     | Old status   | Correct status | PR   | Commit  | Evidence                                                    |
| ---------- | ------------ | -------------- | ---- | ------- | ----------------------------------------------------------- |
| FOLLOW-183 | IN_PROGRESS  | DONE           | #228 | ff3fb8e | `test(data): pg integration test for upsertConversionLabel` |
| FOLLOW-184 | READY (dup.) | DONE           | #233 | 9c91ed8 | Already DONE in Sprint 14 carry-over section                |
| FOLLOW-187 | READY        | DONE           | #229 | e13250b | `feat(compliance): add ROPA activity 15 CRM ingest`         |

## Sprint 16 status corrections applied 2026-06-08

The following tickets were merged but QUEUE.md showed stale statuses. All corrected atomically:

| Ticket     | Old status  | Correct status | PR   | Commit  |
| ---------- | ----------- | -------------- | ---- | ------- |
| FOLLOW-176 | READY       | DONE           | #217 | ea9d59c |
| FOLLOW-182 | IN_PROGRESS | DONE           | #222 | d7b9de7 |
| FOLLOW-174 | BLOCKED     | DONE           | #220 | 31afb16 |
| FOLLOW-190 | READY       | DONE           | #225 | 1d5829a |
| FOLLOW-227 | (new)       | DONE           | #226 | 4d3f1a4 |
| FOLLOW-230 | (new)       | DONE           | #227 | b62faae |

## Sprint 8 Rule I audit (legacy, 2026-05-17)

| Ticket      | Queue status | Rule I status                    |
| ----------- | ------------ | -------------------------------- |
| AB-001      | DONE         | PARTIAL (FOLLOW-007 resolved it) |
| REORDER-001 | DONE         | DONE                             |
| TICKET-046  | DONE         | PARTIAL (FOLLOW-007 resolved it) |
| ARCH-003    | DONE         | DONE                             |
| AGENCY-001  | DONE         | DONE                             |
| AB-004      | DONE         | DONE                             |
