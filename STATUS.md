# PM Orchestrator Status

**Last updated:** 2026-06-23T18:30Z

## OPERATIONAL RECORD — Prod Supabase 14-migration drift catch-up (2026-06-14)

**STATUS: RESOLVED (apply). COMPLIANCE GAP SIGNED OFF 2026-06-14 (Piotr/CEO).** All 14 migrations
applied cleanly. FOLLOW-308 (auto-apply mechanism) DONE (PR #297/#306). ESC-022+ESC-023 RESOLVED.

---

## Current sprint

- **Sprint 21 COMPLETE** — FOLLOW-372/373/374/375/376 all merged (PRs #337–#341).
  RETRO-102/103/104/105/106 written and committed in FOLLOW-383 housekeeping commit (commit 4f5f27b
  chore batch on backend-engineer/FOLLOW-383-consent-gate-doc branch, will land on main with PR
  #342).
- **Sprint 20 COMPLETE** — FOLLOW-354/356/357/358/359/360/361/362/363/364/366/367/368 DONE.
- **Sprint 19 COMPLETE** — FOLLOW-340/341/342/343/344/345/346/346-dpia/347 DONE.
- **Sprint 16 COMPLETE** — FOLLOW-191 ESC-020 non-blocking per CEO 2026-06-10.

---

## IN_PROGRESS tickets (1/3 max)

- **FOLLOW-383** — backend-engineer — P0 opt-out server wiring — PR #342 OPEN — CI check counter:
  2/5, fix iterations: 1/3. AC-1/2/3 code committed and pushed (commit 4f5f27b). TYPECHECK FAILING:
  5 TS errors in `packages/sdk/src/__tests__/follow-383.test.ts`:
  - 4x TS2352 (lines 89, 111, 126, 141): `mockFetch.mock.lastCall as [string, RequestInit]` must be
    `mockFetch.mock.lastCall as unknown as [string, RequestInit]` (double-cast through unknown).
  - 1x TS2532 (line 185): `queue[0].type` — queue[0] possibly undefined; use `queue[0]!.type` or
    check after the `toHaveLength(1)` assertion on the previous line. Delegating fix to
    backend-engineer (fix iteration 1/3).

---

## OPEN escalations

| ESC     | Title                                                          | Filed      | Age | Status                                                                  |
| ------- | -------------------------------------------------------------- | ---------- | --- | ----------------------------------------------------------------------- |
| ESC-020 | Estalara-app DOM hooks not deployed to production [FOLLOW-191] | 2026-06-06 | 17d | Non-blocking per CEO 2026-06-10; Rafal action deferred until local test |

All ESC-001 through ESC-028 RESOLVED (ESC-028 = SDK bundle budget raised to 42KB for FOLLOW-372/373
consent disclosures). ESC-020 remains OPEN but non-blocking.

---

## Pre-existing-red CI checks (non-blocking)

- `Rule I — wired-or-dead check`: 107+ violations at baseline (FOLLOW-090 tracking). Confirmed
  pre-existing on PR #341 (merged) and PR #342 (open). NOT a merge blocker.
- `Test (Python) (3.12, *)`: modal app tests (pre-existing post FOLLOW-376 cleanup; only
  data-quality/intent-engine/llm-gateway/stream-consumer pass now).
- `Format check`: was pre-existing-red on backend-engineer/lessons.md; may be resolved on current
  branch — verify before merging PR #342.

---

## CI check counter (current session — 2026-06-23)

- PR #342 (FOLLOW-383): 2/5 checks run. 1/3 fix iterations consumed. Real gate failures: 1
  (Typecheck — 5 TS errors introduced by follow-383.test.ts; NOT pre-existing). Fix delegated to
  backend-engineer. Rule I pre-existing-red (confirmed on both CI run 28047541089 and prior PR
  #341).

---

## FOLLOW-383 P0 gate tracking

| AC   | Description                                       | Status             | Where                                     |
| ---- | ------------------------------------------------- | ------------------ | ----------------------------------------- |
| AC-1 | SDK sends profiling_opt_out=1 to server           | Done (uncommitted) | packages/sdk/src/core/adapt.ts diff       |
| AC-2 | consentGate.profilingOptOut documented (decision) | Done (PR #342)     | apps/decision-api/src/lib/consent-gate.ts |
| AC-3 | Opted-out events dropped before eventQueue.push   | Done (uncommitted) | packages/sdk/src/index.ts diff            |
| AC-4 | redis_writer.py skips chat-prior for opted-out    | STUB → FOLLOW-384  | ml-engineer scope; promoted to own ticket |
| AC-5 | (optional) DOM revert on toggle-off               | Deferred           | post-P0                                   |

POST path gate (route.ts POST handler) also done (uncommitted) — defense-in-depth companion to AC-1.

---

## P0 gate note

FOLLOW-383 (opt-out server wiring) must ship before FOLLOW-369 and all other P1/P2 downstream
tickets. The server-side gate was dead-on-arrival (SDK never sent profiling_opt_out=1). AC-1+AC-3
code is done but uncommitted. Delegating to backend-engineer to commit+push.

---

## Next READY tickets (after FOLLOW-383 unblocks)

Priority order after FOLLOW-383 merged:

1. FOLLOW-369 (P1, backend-engineer) — GET-path consent-skip parity
2. FOLLOW-371 (P1, data-engineer) — ClickHouse holdout remediation
3. FOLLOW-368 (P1, devops-engineer) — Upstash Redis env-var parity
4. FOLLOW-356 (P1, sdk-engineer) — directive_scope consumer/behavioral tests
5. FOLLOW-363 (P1, sdk-engineer) — hysteresis wiring in dwell/listing-view

---

## Pending retros (as of 2026-06-23)

RETRO-102 through RETRO-106 written but uncommitted (on FOLLOW-383 branch). RETRO-107+ to spawn
after FOLLOW-383 merges. Next free RETRO number: 107.

---

## Notes (2026-06-23)

- Branch `backend-engineer/FOLLOW-383-consent-gate-doc` has AC-1+AC-3 code done but not committed.
  Backend-engineer must commit code changes + test files + all modified queue/status/retro files,
  then push to PR #342. PM will re-validate CI after push.
- AC-4 (redis_writer.py opt-out skip) delegated to ml-engineer in parallel — does not block AC-1/2/3
  merge.
- RETRO-102–106 uncommitted changes include QUEUE.md, FOLLOW_UPS.md, RETROSPECTIVES.md updates —
  backend-engineer to commit those as housekeeping commits on the branch.
- supabase/snippets/ directory is untracked but empty — no action needed.
- .claude/agents/qa-engineer/lessons.md is untracked — backend-engineer to commit this too.
