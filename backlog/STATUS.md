# Status — 2026-06-08T12:00Z

_Rule I: a ticket is DONE only if its primary artifact has at least one non-test runtime caller._

## Active sprint: Sprint 16

**Post-retro housekeeping complete (RETRO-035/036/037/038 batch).**

All 4 PRs previously at READY_FOR_REVIEW are now DONE:

| PR   | Ticket     | Agent               | Commit  | Status |
| ---- | ---------- | ------------------- | ------- | ------ |
| #222 | FOLLOW-182 | backend-engineer    | d7b9de7 | DONE   |
| #223 | FOLLOW-218 | compliance-engineer | cf29878 | DONE   |
| #224 | FOLLOW-219 | sdk-engineer        | 569d3ce | DONE   |
| #225 | FOLLOW-190 | sdk-engineer        | 1d5829a | DONE   |

Additionally verified DONE (already merged, QUEUE not yet updated):

| PR   | Ticket     | Agent            | Commit   | Status |
| ---- | ---------- | ---------------- | -------- | ------ |
| #220 | FOLLOW-174 | backend-engineer | 31afb16  | DONE   |
| #221 | FOLLOW-220 | sdk-engineer     | 0475e452 | DONE   |

FOLLOW-222 (confirm dialog) + FOLLOW-223 (unit tests) — folded into FOLLOW-174 (PR #220), marked
DONE.

**Newly promoted to Sprint 16 (from RETRO-034/036/037 stubs):**

- FOLLOW-220 (DONE — \_initForTest seam)
- FOLLOW-227 (P1, READY — Rule R dwell gate, sdk-engineer)
- FOLLOW-229 (P1, READY — dwell wiring test via seam, sdk-engineer + qa-engineer)
- FOLLOW-230 (P1, READY — ROPA Activity-14 renumber + Privacy Notice §4, compliance-engineer)

## Currently IN_PROGRESS (2 of 3 max)

- **FOLLOW-227** (P1, Rule R dwell gate) — sdk-engineer Branch:
  `sdk-engineer/FOLLOW-227-dwell-rehydrate-gate` CI-check counter: 0/5 | Fix-iteration counter: 0/3
- **FOLLOW-230** (P1, ROPA renumber + Privacy Notice §4) — compliance-engineer Branch:
  `compliance-engineer/FOLLOW-230-ropa-renumber-privacy-notice` CI-check counter: 0/5 |
  Fix-iteration counter: 0/3

Next in queue (after first slot frees): FOLLOW-183 (data-engineer, PG harness)

## Open escalations

| ID      | Age | Description                                                          | Blocking?                           |
| ------- | --- | -------------------------------------------------------------------- | ----------------------------------- |
| ESC-009 | 17d | E2E_BEARER_TOKEN secret not provisioned                              | demo-integration CI soft-skips only |
| ESC-010 | 17d | DOPPLER_TOKEN_DEV not provisioned                                    | doppler-verify CI soft-skips only   |
| ESC-020 | 4d  | Rafal must deploy web-master HEAD + PUBLIC_ESTALARA_SDK_ENABLED=true | FOLLOW-191 final verification only  |

ESC-009/010/020 are NOT blocking any current delegation (they affect soft-skip CI jobs only).

## CI-check counters (active tickets)

| Ticket     | PR   | CI-check (n/5) | Fix-iter (n/3) | Status       |
| ---------- | ---- | -------------- | -------------- | ------------ |
| FOLLOW-182 | #222 | 1/5            | 0/3            | DONE         |
| FOLLOW-218 | #223 | 1/5            | 0/3            | DONE         |
| FOLLOW-219 | #224 | 1/5            | 0/3            | DONE         |
| FOLLOW-190 | #225 | 1/5            | 0/3            | DONE         |
| FOLLOW-174 | #220 | —              | —              | DONE         |
| FOLLOW-220 | #221 | —              | —              | DONE         |
| FOLLOW-227 | TBD  | 0/5            | 0/3            | IN_PROGRESS  |
| FOLLOW-230 | TBD  | 0/5            | 0/3            | IN_PROGRESS  |
| FOLLOW-183 | TBD  | 0/5            | 0/3            | READY (next) |

## Sprint 16 track summary (updated 2026-06-08)

- **Track A:** FOLLOW-170 DONE
- **Track B:** FOLLOW-173 DONE → FOLLOW-174 DONE → FOLLOW-175 READY (FOLLOW-174 dep satisfied)
- **Track C:** FOLLOW-176 READY, FOLLOW-182 DONE (PR #222), FOLLOW-183 READY
- **Track D:** FOLLOW-184/185 READY, FOLLOW-187 READY (sequence after FOLLOW-230), FOLLOW-218 DONE
  (PR #223)
- **Track E:** FOLLOW-190 DONE (PR #225), FOLLOW-209 Wave 2 READY
- **Track F:** FOLLOW-219 DONE (PR #224), FOLLOW-220 DONE (PR #221), FOLLOW-221 READY,
  FOLLOW-222/223 DONE (folded into #220), FOLLOW-224 READY, FOLLOW-225 READY (FOLLOW-220 dep
  satisfied)
- **Track G (new — Rule R dwell-gate RETRO-037):** FOLLOW-227 READY, FOLLOW-229 READY, FOLLOW-228 P2
- **Track H (new — compliance RETRO-036):** FOLLOW-230 READY (must precede FOLLOW-187)

## Sprint 16 summary counts

- Tickets promoted: 21 (15 original + 6 new: FOLLOW-220/222/223/227/229/230)
- DONE: 9 (FOLLOW-170/173/174/182/190/218/219/220 + FOLLOW-222/223 folded)
- READY: 10
- BLOCKED: 1 (FOLLOW-175 on FOLLOW-221; FOLLOW-187 on FOLLOW-230)
- IN_PROGRESS: 0 (delegating now)

## PRs merged (2026-06-08)

- #220 FOLLOW-174 admin label table + manual reclassification (DONE — 31afb16)
- #221 FOLLOW-220 \_initForTest seam (DONE — 0475e452)
- Confirmed already merged (from housekeeping): #222 FOLLOW-182 (d7b9de7), #223 FOLLOW-218
  (cf29878), #224 FOLLOW-219 (569d3ce), #225 FOLLOW-190 (1d5829a)

## PRs merged (2026-06-07)

- #202 FOLLOW-197 SDK listeners + lead_id derivation (DONE — a2ca89d)
- #216 FOLLOW-173 conversion-label aggregation + calibration reliability curve (DONE — 61d294d)

## Sprint 8 Rule I audit (legacy, 2026-05-17)

| Ticket      | Queue status | Rule I status                    |
| ----------- | ------------ | -------------------------------- |
| AB-001      | DONE         | PARTIAL (FOLLOW-007 resolved it) |
| REORDER-001 | DONE         | DONE                             |
| TICKET-046  | DONE         | PARTIAL (FOLLOW-007 resolved it) |
| ARCH-003    | DONE         | DONE                             |
| AGENCY-001  | DONE         | DONE                             |
| AB-004      | DONE         | DONE                             |
