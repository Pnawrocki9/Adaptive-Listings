# Takeover Audit — 2026-10-05/06 (session 176)

**Executed by:** Cline (acting as pm-orchestrator + sdk-engineer/backend-engineer roles), on the
operator's instruction after the Claude Code session of 2026-10-05 ended mid-wave. **Audited at:**
`main` @ `b34ed27d` (#964) — then advanced to `c04c2a8d` (#966) by this session. **Purpose:** every
fact, action, decision and open thread below is written down so the NEXT agent session (Claude Code
or otherwise) can resume with zero rediscovery. Companion records: `backlog/QUEUE.md` session-176
banner, `backlog/HANDOFFS.md` takeover handoff, README §5.20, PR #967.

---

## 1. Method

Read-only audit first: repo structure, `git log --graph --all`, `gh pr list`/`gh run list`, the
backlog (`QUEUE.md`, `FOLLOW_UPS.md`, `FOLLOW_UPS_OPEN.md`, `ESCALATIONS.md`), agent `lessons.md`
files, worktree states (`git worktree list` + per-worktree `status`), CI history, and the follow-819
harness README. No file was edited before the operator approved the plan.

## 2. State found (2026-10-05, before any action)

### 2.1 Git / PRs

- `main` = `b34ed27d` (#964, FOLLOW-1289), clean, = origin/main. `6e8bae54` (#965, FOLLOW-1288) is
  its PARENT — #965 merged before #964 despite the higher PR number.
- One open PR: **#966** (pm bookkeeping: close 1288/1289 in FOLLOW_UPS, file FOLLOW-1303, mark
  1290/1301 in progress). Its only red check was Rule I — see §2.4.
- Worktrees (`.claude/worktrees/`):
  - `agent-aa50abdb2e92ca8ad` → `sdk-engineer/FOLLOW-1301-chat-refresh` @ `dd2e729c` (clean, local
    only, no PR). FOLLOW-1301 implemented + committed, evidence NOT run.
  - `agent-ad2c48cd962f9048f` → `backend-engineer/FOLLOW-1290-spend-counter` @ `6e8bae54` (behind
    main by 1) with **~1,300 lines of UNCOMMITTED WIP** (the whole FOLLOW-1290 implementation).
  - `agent-aee158283d210f339` → stale Sep-21 qa branch `32f0841c` (already on origin; only untracked
    `.runs-819/`). Cleanup candidate only.

### 2.2 Tickets FOLLOW-1286…1303 (verified against main + QUEUE)

| Ticket                                   | State found                                                                                                                                                                                                                           | Evidence                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1286, 1287, 1288, 1289, 1298, 1299, 1300 | DONE, merged                                                                                                                                                                                                                          | #957/#960/#965/#964/#959/#956/#961                               |
| 1288, 1289 caveat                        | merged but their ×3 series was NEVER run (RAM-guard stall, see backend-engineer lessons 2599-2624)                                                                                                                                    | lessons.md                                                       |
| 1290                                     | OPEN on main; WIP uncommitted in worktree (Upstash `llm-spend-counter.ts` + tests written; `getRolling24hSpend` deleted from llm-gateway; `checkPilotFrozenAsync` + `lib/adapt-segment-timing.ts` removed from route; docs re-synced) | worktree diff                                                    |
| 1301                                     | implemented, committed `dd2e729c`, no PR, no evidence (×3 series, bundle delta, red-first all owed)                                                                                                                                   | artefact 08:44 run = 6/7 RED, AC(8) brokenHop=3 shim unreachable |
| 1302                                     | filed (CEO ruling 2026-10-05), depends on 1301                                                                                                                                                                                        | FOLLOW_UPS stub                                                  |
| 1303                                     | filed ONLY inside PR #966 (+28 lines to FOLLOW_UPS): rollup lift SQL lacks the holdout-contamination predicate + tenant filter; feeds `rollup.ctaLift` = AC(5)'s number                                                               | PR #966 diff                                                     |

### 2.3 Bookkeeping drift (main)

`QUEUE.md` session-175 banner still read "FOLLOW-1288, FOLLOW-1289 — IN_PROGRESS # both STALLED"
(they were merged); the banner's NEXT line pre-dated the CEO chat-arm rulings. PR #966 was the
in-flight correction. K1-series recording debt: "three GREEN at `1f5bc1ed`" had no README §5 record.

### 2.4 CI reality (important for every future session)

- `ci.yml` on main has been RED since **2026-05-16** — the "Rule I — wired-or-dead check" job (151
  exported symbols with zero non-test importers, legacy debt).
- This is a **documented, tolerated pre-existing-red**: `scripts/gh-pr-checks-verified.sh` (the real
  merge gate) classifies a PR's Rule I red as non-blocking iff the PR's violating-symbol set is a
  subset of main's baseline (ratchet). Verified live: #966 → exit 0, "Safe to mark
  READY_FOR_REVIEW".
- Consequence: bare `gh run list` red on main is NOT news; the verifier is the arbiter. A NEW symbol
  in the set IS news and blocks.

---

## 3. Addendum — continuation session (2026-10-06)

Written by the session that resumed after this audit was drafted. Actions taken since §2 was
recorded:

- **PR #967 / FOLLOW-1301 unblocked.** The evidence commit `952ea26d` pasted its three `[FRESH]`
  lines with the FULL 40-character `harnessSha`, tripping gitleaks' `cloudflare-api-token` rule
  (entropy 3.68 ≥ 3.0; three findings, `tests/e2e/follow-819/README.md` lines 2528–2530) — the
  verifier read `UNDETERMINED` with the required Gitleaks check red. Fixed per the README's own
  §5.18 caveat convention (truncate to `baec7ff6…` and state the abbreviation in prose) by amending
  the evidence commit → `7aee8d98`, force-pushed with lease; lefthook format/commitlint and the
  rule-h / rule-j pre-push hooks all green. §2.2's "no evidence" row for 1301 is superseded: §5.20
  now records the ×3 GREEN series, the red-first and the bundle delta. The verifier then read exit 0
  (Gitleaks green; Rule I ratcheted, 0 new) and **#967 was squash-merged as `334082c1` on
  2026-10-06** — FOLLOW-1301 DONE.
- **This bookkeeping PR.** Committed the audit doc (previously untracked), added the session-176
  QUEUE banner + this addendum, appended the HANDOFFS.md takeover handoff, regenerated
  `backlog/FOLLOW_UPS_OPEN.md` (stale since #963/#966 — it was missing FOLLOW-1301/1302/1303 and
  still showed FOLLOW-1251 as P2), and landed the session-136-A stash (STATUS.md + pm-orchestrator
  lessons entries; conflict-resolved in chronological order, 136-A before 146).
- **FOLLOW-1290 unchanged:** still parked at `7bbd544b`, local only, no PR.
