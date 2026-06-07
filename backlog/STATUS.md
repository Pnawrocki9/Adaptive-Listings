# Status — 2026-06-07T00:00Z

_Rule I: a ticket is DONE only if its primary artifact has at least one non-test runtime caller._

## Active sprint: Sprint 15

Track A: 2/4 DONE (FOLLOW-192, FOLLOW-193), 1 READY_FOR_REVIEW (FOLLOW-191 awaiting Rafal deploy), 1
DONE (FOLLOW-194) Track B: 2/8 DONE (FOLLOW-195, FOLLOW-196), 1 IN_PROGRESS (FOLLOW-197), 5 READY
(FOLLOW-198–202) Track C: 0/2 DONE, both READY (FOLLOW-203, FOLLOW-204) Track D: 0/2 DONE, both
READY (FOLLOW-205, FOLLOW-206) Track E: 0/5 DONE, all READY (FOLLOW-207–211)

## Currently IN_PROGRESS (1 of 3 max)

- FOLLOW-197 (CHAT-003 — SDK listeners for chat/live events) — sdk-engineer Branch:
  sdk-engineer/FOLLOW-197-chat003-sdk-listeners CI-check counter: 0/5 | Fix-iteration counter: 0/3

## Open escalations

| ID      | Age | Description                                                          | Blocking?                                  |
| ------- | --- | -------------------------------------------------------------------- | ------------------------------------------ |
| ESC-009 | 14d | E2E_BEARER_TOKEN secret not provisioned                              | demo-integration CI soft-skips only        |
| ESC-010 | 14d | DOPPLER_TOKEN_DEV not provisioned                                    | doppler-verify CI soft-skips only          |
| ESC-020 | 1d  | Rafal must deploy web-master HEAD + PUBLIC_ESTALARA_SDK_ENABLED=true | FOLLOW-197 E2E only; code wiring unblocked |

## PRs merged today (2026-06-06/07)

- #197 FOLLOW-191 audit (READY_FOR_REVIEW, awaiting Rafal deploy action)
- #198 FOLLOW-195 LiveSignupEventSchema (DONE)
- #199 FOLLOW-196 CustomEvent hooks Estalara-app (DONE)
- #200 FOLLOW-193 DSR cron + engagement_scores erasure (DONE)
- #201 FOLLOW-194 SDK quick fixes batch (DONE)

## FOLLOW-212/213 status

Filed by retrospective-analyst (RETRO-033) for the window→document event target bug in live.signup
feedback loop. Per session context the fix was applied locally in Estalara-app
(LiveSessions.svelte + ChatBot.svelte) but folded into FOLLOW-196 PR #199. FOLLOW-212/213 stubs
exist in FOLLOW_UPS.md but have no QUEUE.md entries — not yet promoted to sprint tickets. PM to
assess at next sprint planning whether promotion is needed or if FOLLOW-196 closure covers them.

## Sprint 8 Rule I audit (legacy, 2026-05-17)

| Ticket      | Queue status | Rule I status                    |
| ----------- | ------------ | -------------------------------- |
| AB-001      | DONE         | PARTIAL (FOLLOW-007 resolved it) |
| REORDER-001 | DONE         | DONE                             |
| TICKET-046  | DONE         | PARTIAL (FOLLOW-007 resolved it) |
| ARCH-003    | DONE         | DONE                             |
| AGENCY-001  | DONE         | DONE                             |
| AB-004      | DONE         | DONE                             |
