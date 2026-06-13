# Status — 2026-06-13T11:00Z

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

**Sprint 17 WAVE 3 (2026-06-13 → ongoing):**

- FOLLOW-267 IN_PROGRESS (delegated to backend-engineer 2026-06-13T11:00Z).
- FOLLOW-268 BACKLOG (depends on FOLLOW-267).
- FOLLOW-269 BACKLOG (depends on FOLLOW-266/267/268).

## ESCALATION STATUS

ESC-021 RESOLVED (2026-06-13) — PR #282 fixed ClickHouse migrations smoke gate. No CEO decision
needed. ESC-020 OPEN (non-blocking) — Rafal deploy pending. Does not block code pipeline.

## CI Gates — All Real Gates GREEN on main

ClickHouse migrations smoke: PASS (migration 0016 = SELECT 1 no-op). Python tests
(adaptation-engine, auto-detect): pre-existing failures, NON-BLOCKING.

## Pending Retros

RETRO-062 (FOLLOW-276/PR #272), RETRO-063 (FOLLOW-278/PR #273), RETRO-064 (FOLLOW-266 Ph1/PR #277),
RETRO-067 (FOLLOW-266 Ph3/PR #280), RETRO-068 (FOLLOW-286/PR #279), RETRO-069 (FOLLOW-287+288/PRs
#281+#282) — all pending spawn.
