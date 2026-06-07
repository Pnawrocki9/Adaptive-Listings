# Status — 2026-06-07T12:00Z

_Rule I: a ticket is DONE only if its primary artifact has at least one non-test runtime caller._

## Active sprint: Sprint 15

Track A: 3/4 DONE (FOLLOW-192, FOLLOW-193, FOLLOW-194), 1 READY_FOR_REVIEW (FOLLOW-191 awaiting
Rafal deploy — ESC-020) Track B: 3/8 DONE (FOLLOW-195, FOLLOW-196, FOLLOW-197), 1 IN_PROGRESS
(FOLLOW-199), 4 READY (FOLLOW-198, FOLLOW-200–202) Track C: 0/2 DONE, FOLLOW-203 READY, FOLLOW-204
BLOCKED on FOLLOW-203 Track D: 0/2 DONE, both READY (FOLLOW-205, FOLLOW-206) Track E: 0/5 DONE, all
READY (FOLLOW-207–211)

## Currently IN_PROGRESS (1 of 3 max)

- FOLLOW-199 (Quiz widget v2.0 — cascading decision tree) — sdk-engineer Branch:
  sdk-engineer/FOLLOW-199-quiz-v2-decision-tree CI-check counter: 0/5 | Fix-iteration counter: 0/3

## Open escalations

| ID      | Age | Description                                                          | Blocking?                           |
| ------- | --- | -------------------------------------------------------------------- | ----------------------------------- |
| ESC-009 | 15d | E2E_BEARER_TOKEN secret not provisioned                              | demo-integration CI soft-skips only |
| ESC-010 | 15d | DOPPLER_TOKEN_DEV not provisioned                                    | doppler-verify CI soft-skips only   |
| ESC-020 | 2d  | Rafal must deploy web-master HEAD + PUBLIC_ESTALARA_SDK_ENABLED=true | FOLLOW-191 final verification only  |

## PRs merged (2026-06-07)

- #202 FOLLOW-197 SDK listeners + lead_id derivation (DONE — merged a2ca89d)

## PRs merged (2026-06-06)

- #197 FOLLOW-191 audit (READY_FOR_REVIEW, awaiting Rafal deploy action — ESC-020)
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
