# PM Orchestrator Status

**Last updated:** 2026-06-24T00:00Z

## OPERATIONAL RECORD — Prod Supabase 14-migration drift catch-up (2026-06-14)

**STATUS: RESOLVED.** All 14 migrations applied. FOLLOW-308 DONE. ESC-022+ESC-023 RESOLVED.

---

## Current sprint

- **Sprint 22 IN_PROGRESS** — Wave 1 COMPLETE (4 tickets DONE). Wave 2 pending (FOLLOW-384/385).
- **Sprint 21 COMPLETE** — FOLLOW-372/373/374/375/376 all DONE (PRs #337–#341).
- **Sprint 20 COMPLETE** — FOLLOW-354–368 wave DONE.
- **Sprint 19 COMPLETE** — FOLLOW-340–347 wave DONE.

---

## Sprint 22 Wave 1 — ALL DONE (merged 2026-06-23/24)

| Ticket     | PR   | Merge commit | Completed  | Notes                                                               |
| ---------- | ---- | ------------ | ---------- | ------------------------------------------------------------------- |
| FOLLOW-383 | #342 | 7ed8a81      | 2026-06-23 | P0: SDK→server profiling opt-out. §H.9 core wiring. RETRO-107 done. |
| FOLLOW-369 | #343 | 84552bf      | 2026-06-24 | GET-path consent-skip parity. RETRO-108 pending (deferred).         |
| FOLLOW-371 | #344 | 029206a      | 2026-06-24 | CH holdout contamination remediation. RETRO-109 pending (deferred). |
| FOLLOW-368 | #345 | dd74026      | 2026-06-24 | Upstash env-var parity. ESC-028 open. RETRO-110 pending (deferred). |

---

## §H.9 opt-out epic — NOT DONE (two tickets still open)

| Ticket     | Agent                           | Status | Description                                                |
| ---------- | ------------------------------- | ------ | ---------------------------------------------------------- |
| FOLLOW-384 | ml-engineer                     | READY  | redis_writer.py chat-prior skip for opted-out sessions     |
| FOLLOW-385 | sdk-engineer + backend-engineer | READY  | Quiz/favorites/micro-poll opt-out enforcement (§H.9 scope) |

The §H.9 profiling opt-out epic is NOT complete until both FOLLOW-384 and FOLLOW-385 are DONE.

---

## READY_FOR_REVIEW tickets

None. All wave-1 PRs merged.

## IN_PROGRESS tickets (0/3 max)

None.

---

## OPEN escalations

| ESC     | Title                                                                        | Filed      | Age | Status                                                                                                |
| ------- | ---------------------------------------------------------------------------- | ---------- | --- | ----------------------------------------------------------------------------------------------------- |
| ESC-020 | Estalara-app DOM hooks not deployed to production [FOLLOW-191]               | 2026-06-06 | 18d | Non-blocking per CEO 2026-06-10; Rafal action deferred until local test                               |
| ESC-028 | GitHub Actions secrets required for FOLLOW-368 Redis shadow round-trip smoke | 2026-06-23 | 1d  | OPEN — 4 secrets: UPSTASH_REDIS_REST_URL/TOKEN + UPSTASH_REDIS_URL/TOKEN. Piotr/Rafal must provision. |

ESC-028 landed on main with PR #345 merge (dd74026). Smoke runs in soft-skip until resolved.

---

## Pre-existing-red CI checks (non-blocking)

- `Rule I — wired-or-dead check`: 107+ violations at baseline (FOLLOW-090 tracking).
- `Test (Python) (3.12, *)`: data-quality/intent-engine/llm-gateway/stream-consumer PASS (FOLLOW-376
  fixed matrix). Other Python app variants remain absent from matrix.

---

## CI check counter (session 2026-06-23/24)

- PR #342 (FOLLOW-383): 3/5 checks, 1/3 fix iterations. MERGED 7ed8a81.
- PR #343 (FOLLOW-369): 4/5 checks, 1/3 fix iterations (session total). MERGED 84552bf.
- PR #344 (FOLLOW-371): 5/5 checks, 2/3 fix iterations (session total). MERGED 029206a.
- PR #345 (FOLLOW-368): 4/5 checks, 1/3 fix iterations (session total). MERGED dd74026.

Session CI check counter: 5/5 (cap reached). Fix iteration counter: 2/3. Next session: fresh
counters.

---

## FOLLOW-383 DONE — final §H.9 AC tracking

| AC   | Description                                     | Status          |
| ---- | ----------------------------------------------- | --------------- |
| AC-1 | SDK sends profiling_opt_out=1 to server         | DONE (PR #342)  |
| AC-2 | consentGate.profilingOptOut documented          | DONE (PR #342)  |
| AC-3 | Opted-out events dropped before eventQueue.push | DONE (PR #342)  |
| AC-4 | redis_writer.py skips chat-prior for opted-out  | FOLLOW-384 (P1) |
| AC-5 | (optional) DOM revert on toggle-off             | Deferred        |

---

## Pending retros (deferred — human to schedule)

- **RETRO-107**: FOLLOW-383 / PR #342 (7ed8a81) — sdk + control-plane opt-out gate. DONE/merged.
- **RETRO-108**: FOLLOW-369 / PR #343 (84552bf) — control-plane GET consent-skip parity.
- **RETRO-109**: FOLLOW-371 / PR #344 (029206a) — data-engineer ClickHouse holdout remediation.
- **RETRO-110**: FOLLOW-368 / PR #345 (dd74026) — devops Upstash env-var parity + smoke workflow.

---

## Next READY tickets (Sprint 22 Wave 2)

1. **FOLLOW-384** (P1, ml-engineer, 2h) — redis_writer.py chat-prior skip [§H.9 AC-4]
2. **FOLLOW-385** (P1, sdk-engineer+backend-engineer, 4h) — §H.9 sibling opt-out enforcement
3. **FOLLOW-356** (P1, sdk-engineer, 4h) — directive_scope consumer
4. **FOLLOW-363** (P1, sdk-engineer, 4h) — hysteresis dwell/listing-view

---

## Notes (2026-06-24)

- Sprint 22 wave-1 complete. All four P1 tickets merged cleanly.
- Duplicate FOLLOW-368 entry in QUEUE.md reconciled — both set to DONE.
- RETRO-107 written and in RETROSPECTIVES.md. RETRO-108/109/110 deferred.
- FOLLOW-384/385/386 stubs confirmed present in FOLLOW_UPS.md.
- ESC-028 is now on main (merged with PR #345). Human action needed to provision Upstash secrets.
