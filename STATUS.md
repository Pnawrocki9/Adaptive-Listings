# PM Orchestrator Status

**Last updated:** 2026-07-22 (session 52). NOTE: this file's body below (up to the next `---`) is a
STALE snapshot from 2026-06-26; QUEUE.md's "START HERE" blocks are the authoritative running log.
Kept here only for historical CI-counter provenance; do not treat entries below this line as current
state — see QUEUE.md top block instead.

## CURRENT (session 157, 2026-08-28) — FOLLOW-1180 validated (2 PRs green), FOLLOW-1183+1177 dispatched to ml-engineer (Opus)

- **`main` = `96bf1554`. 3 PRs open (#883, #884, #885 — this session's bookkeeping), 0 worktrees,
  working tree clean on `main`.** Retro debt CLEAR through #880; **#883 is unretro'd** (correctly —
  it has not merged yet, retro spawns only after merge).
- **#883 (FOLLOW-1180, branch `ml-engineer/…-locale-condition-judge-budget` — the full branch name
  is elided ON PURPOSE: its 41-char tail matches the gitleaks `cloudflare-api-token` rule and reds
  the scan, do not restore it) — PM-VALIDATED.** Independently re-ran
  `scripts/gh-pr-checks-verified.sh 883` twice (once from a background poll, once fresh): **exit 0**
  both times, 112 check-runs, 102 success / 8 skipped, the only red is `Rule I` at 184 violating
  symbols, **0 new vs `main`'s own baseline (run 33174133653)**, all 55 registered checks present
  and green where required. Read the diff directly (not the PR body): `JUDGE_CALL_BUDGET_TWEAK_BAND`
  producer at `llm-gateway.ts:211` (`= 3`) and consumer at `judgeCallBudget()` (`:271-272`) and its
  call site (`:1438`) confirmed on the PR branch itself, not the local tree. Not merged — human's
  call.
- **#884 (`pm-orchestrator/FOLLOW-1180-session-156-record`) — PM-VALIDATED**, same verifier, exit 0,
  110 check-runs. Docs-only (QUEUE.md + FOLLOW_UPS.md banner). Not merged.
- **CI-check counter this session: 883 → 2/5 (both exit 0, no fix iterations needed). 884 → 2/5.**
  Fix-iteration counter: 0/3 on both — no bounce needed.
- **#885 (`pm-orchestrator/session-157-dispatch-follow1183-1177`) — this session's own
  bookkeeping**, opened, not yet CI-verified by this session (docs-only, low risk, independent of
  #883/#884).
- **IN_PROGRESS (1/3 max): FOLLOW-1183 (P1) + FOLLOW-1177 (P2), executed together in ONE PR per
  FOLLOW-1183's own text — ml-engineer (Opus), expected branch
  `ml-engineer/FOLLOW-1183-judge-skip-counters`, based on `main` `96bf1554`.** Dispatch-intent line
  appended to `backlog/HANDOFFS.md` and pushed (PR #885) BEFORE this delegation, per FOLLOW-1081.
  Reconciled the stale `FOLLOW-1178` dispatch-intent line (`status=OPEN` despite #880 merged —
  reconciliation debt) to `RECONCILED:completed` in the same commit.
- **Delegation-table row cited:** _"intent/adapt logic, embeddings, LLM gateway, auto-detect,
  ontology, platform-templates"_ → ml-engineer. Both tickets' `scope:` is entirely
  `apps/control-plane/src/lib/llm-gateway.ts` + `docs/ops/MEASURED_PREMISES.md`.
- **Escalations:** none newly opened this session. Prior OPEN escalations (ESC-020, ESC-042,
  ESC-046, ESC-056, ESC-057, ESC-058, ESC-069 and others) remain self-annotated **non-blocking for
  dispatch** — verified by re-reading each `Status:` line, none gate FOLLOW-1183/1177's scope.
- **Localhost-critical-path check (re-derived, not inherited):** FOLLOW-815 is DONE
  (operator-residue only), FOLLOW-819 is 6/6, FOLLOW-820 is a CEO go/no-go with no
  agent-dispatchable work left on it directly. FOLLOW-1183/1177 sit on the judge/fact-check
  subsystem the FOLLOW-819 harness's Haiku band drives (confirmed by FOLLOW-1180's own red-first),
  so this dispatch is judged to move FOLLOW-820 closer in the same sense the FOLLOW-1178 arc has all
  session — it is not itself one of the five named gate-condition tickets.

## Previous (session 154, 2026-08-28) — FOLLOW-1178 dispatched to ml-engineer (Opus)

- **`main` = `453f5560`. 0 PRs open, 0 worktrees, working tree clean. Retro debt CLEAR through
  #878** (RETRO-319 and RETRO-320 both filed and merged).
- **IN_PROGRESS (1/3 max):** FOLLOW-1178 — ml-engineer (Opus), branch
  `ml-engineer/FOLLOW-1178-sonnet-band-judge-budget`. **CI-check counter: 0/5. Fix-iteration
  counter: 0/3.** No PR yet.
- **Delegation-table row cited:** _"intent/adapt logic, embeddings, LLM gateway, auto-detect,
  ontology, platform-templates"_ → ml-engineer. Deliberately overrides the ticket's
  `recommended_agent: backend-engineer`; scope is entirely `llm-gateway.ts` and the sibling ticket
  that may fold in (FOLLOW-1174) is also ml-engineer.
- **Escalations OPEN (7, ages as of 2026-08-28, none blocking the localhost path):** ESC-020 (83d),
  ESC-042 traffic axis (35d), ESC-046 (28d), ESC-056 (19d), ESC-057 (19d), ESC-058 (~19d), ESC-069
  (4d). All are production-axis, credential-gated, process, or convention-ruling items. **ESC-020,
  ESC-057 and ESC-058 become go-live gate items the moment FOLLOW-820 approaches GO** and three of
  them need credentials only the human holds. ESC-020 at 83 days is the oldest.
- **Sequencing re-derived, not inherited (RETRO-320 asked for this explicitly).** Order CONFIRMED,
  on a stronger basis: the SDK always sends `similarity` as the raw archetype probability
  (`packages/sdk/src/core/adapt.ts:1247`), which for behaviour-only sessions runs well below the
  `0.6` Sonnet boundary — so the Sonnet band is where real buyers land, not a malformed-request edge
  case. FOLLOW-819's harness runs at `similarity: 0.85` (Haiku) and therefore certifies a band the
  pilot's non-quiz arm does not use.
- **Stale-evidence flag:** the FOLLOW-819 harness has not been re-run since `eec25c48`. Its 6/6 is
  four merges old and is not cited as evidence for anything sequenced this session.
- **FOLLOW-1165 re-scoped, not deferred a fifth time.** `depends_on` now
  `[FOLLOW-1162, FOLLOW-1178, FOLLOW-1177]`, with an explicit close condition written into
  FOLLOW_UPS.md: FOLLOW-1178 direction (c) subsumes it and closes it as a duplicate; any other
  direction leaves it alive with its subject narrowed to the Sonnet band.
- **QUEUE.md ownership restored to the PM.** The session-152/153 banners were written by
  `retrospective-analyst` at the PM's request; that agent objected both times, correctly, that the
  file is PM-owned per §Y.2. The session-154 banner is PM-authored and the practice stops.
- **Ledger hygiene:** the `status=OPEN` dispatch-intent line for FOLLOW-1138 was stale (merged as
  #855 in session 146, branch since cleaned up) and had been tripping the `SessionStart` guard every
  boot. Reconciled in place to `RECONCILED:completed`.
- **No code written by the PM this session.** Changes are `backlog/QUEUE.md`, `backlog/HANDOFFS.md`,
  `backlog/FOLLOW_UPS.md`, `STATUS.md` only.

---

## CURRENT (session 135, 2026-08-23) — PR #828 (FOLLOW-819) triaged, not merged

- **Escalations OPEN (unchanged, none blocking):** ESC-020, ESC-042 item 1 (traffic axis), ESC-056,
  ESC-057, ESC-058. ESC-066 DECIDED, ESC-046 RESOLVED. No new escalation filed.
- **IN_PROGRESS (1/3 max):** FOLLOW-819 — qa-engineer (Opus) primary. PR #828 open, branch
  `qa-engineer/FOLLOW-819-differentiator-e2e`. **CI-check counter: 1/5 (this session's
  `gh-pr-checks-verified.sh 828` run, exit 0 — GREEN, not a fix-iteration since nothing was
  bounced). Fix-iteration counter: 0/3.**
- **CI evidence (independently re-run, not the worker's self-report):** `VERIFIER_EXIT=0`. 109
  checks, 99 success, 8 skipped, 2 failing — both `Rule I` check-runs, 187 violating symbols on the
  PR vs 187 on `main`'s newest baseline (`32658338283`), 0 new. RESULT line: "all failing checks are
  documented, dynamically-verified pre-existing-red. Safe to mark READY_FOR_REVIEW."
- **Runtime-wiring (5c):** vacuous pass — PR is test/docs-only (`tests/e2e/follow-819/**` +
  `backlog/HANDOFFS.md`), zero product-code files touched, zero new exported symbols.
- **Ticket status decision:** FOLLOW-819 stays **IN_PROGRESS**. PR #828 is safe to mark
  READY_FOR_REVIEW for human merge (harmless, honest, CI-green infrastructure), but that merge does
  NOT close the ticket — the harness was never executed (worker sandbox had no docker/no network).
  AC(6) RED, AC(1)-(5) UNMEASURED. FOLLOW-820 condition 1 remains unsatisfied.
- **Correction made to backlog bookkeeping (not code):** `backlog/FOLLOW_UPS.md` FOLLOW-819 stub —
  fixed AC(3)'s stale column name (`score_function` → shipped `scoring_path`) and corrected the
  AC(5) blocker citation from FOLLOW-822 (drift _detection_, wrong ticket) to FOLLOW-853 (the actual
  Code-27 timestamp-format defect, already exists, currently FROZEN under the session-95 CEO
  P2-freeze rule). This is the second time this exact FOLLOW-822/853 mislabeling has occurred
  (RETRO-259 §4d DG-5 caught the first); flagged for the next retrospective-analyst run rather than
  self-promoted to a Rule.
- **New operational finding, not acted on:** this orchestrator session's sandbox has working
  `docker run` and outbound network in the same worktree the worker's session (which had neither)
  used. Did not attempt the full E2E bring-up myself — that is qa-engineer's/backend-engineer's job
  per the delegation table, not the PM's. Recorded in QUEUE.md session-135 banner so the next
  dispatch tests its own sandbox rather than assuming either way.

---

## CURRENT (session 110, 2026-08-09)

- **Escalations OPEN (4), none blocking this dispatch — ages from filing date:** ESC-020
  (Estalara-app DOM hooks committed but not deployed, ~29d — held non-blocking-for-dispatch by the
  FOLLOW-820 gate: the stage is localhost-first testing, and three audits have now wrongly re-filed
  it as overdue), ESC-042 item 1 traffic axis (`MODAL_CHAT_NLP_URL` unset in the prod ingest Worker,
  ~19d — one variable, both sides built), ESC-046 (unbidden merge of #646, ~14d, process/forensic),
  **ESC-056 (NEW, filed this session, 0d)**.
- **ESC-056 filed this session.** FOLLOW-931's AC(4) cannot close from inside the repo:
  `ingest_worker` holds `INSERT, ALTER DELETE` on `default.events` and **no `SELECT`**, so the
  question "how many `es` consent decisions did production drop before `31cab8b4`?" is unmeasurable.
  **The trap that makes it an escalation rather than a note: the access-denied query returns an
  EMPTY body indistinguishable from "zero rows", so the failure direction is a false all-clear.**
  Per Rule AT the remediation premise is UNVERIFIED, not zero. Recommendation: read-only grant, then
  run the count with an `en` positive control in the same statement.
- **IN_PROGRESS (1/3 max):** FOLLOW-932 — sdk-engineer/**Sonnet**, branch
  `sdk-engineer/FOLLOW-932-headroom-records`. **CI-check counter 0/5, fix-iteration counter 0/3.**
- **Open PRs:** none (`gh pr list --state open` empty at session start).
- **Why FOLLOW-932 (P2) went before FOLLOW-913 (P1):** priority rule (a) — it is the only ready
  ticket declaring `blocks:`, and both blocked tickets are the P1s. Its AC(6) (make
  `check-bundle-size.js` print bytes and headroom) is the instrument FOLLOW-913's AC(5) has to read,
  and dispatching two bundle-touching SDK tickets against a 1,356-byte budget concurrently is how a
  budget race is born. Three of six ACs are already discharged by session 109 — the worker is
  briefed to verify, not redo.
- **P0 status:** zero open P0. FOLLOW-929 (the P0 CORS defect RETRO-264 found in what session 109
  had just merged) is DONE, merged as `da99e220`.
- **Retro loop:** RETRO-264 filed over #704-#709. **A retro is owed for #710 and #711** once the
  current ticket clears — do not let it slide to a four-PR backlog again.
- **Numbers not to re-derive:** SDK headroom **1,356 B** (`zlib.gzipSync`, the compressor the gate
  enforces — CLI `gzip -9` reads 1,520 B and `gzip -c` reads 1,433 B and BOTH overstate it).
  `Rule I` pre-existing-red at **192**, unmoved for many sessions.

---

## CURRENT (session 105, 2026-08-08)

- **Escalations OPEN (7), none blocking this dispatch — ages from filing date:** ESC-041 (`Release`
  workflow E403, ~44d), ESC-042 narrowed (~14d; item 1 deploy axis closed, **traffic axis genuinely
  unproven** — FOLLOW-892 owns the three-record disagreement), ESC-044 (consent canonical hash,
  ~26d; items 1/2/3/5/6 resolved by the FOLLOW-814 CEO+DPO ruling), ESC-045 (local chat-NLP shim
  fails green, ~10d, narrowed to items 1-3), ESC-046 (unbidden merge of #646, ~9d), ESC-051 (SDK
  bundle budget exhausted 41.99KB/42KB, ~1d), **ESC-054 (CEO/CPO — should LLM long-form copy ride
  the `signal_count >= 2` escape hatch, ~1d)**. **ESC-054 must be ruled together with FOLLOW-889** —
  both move the same gating ladder and deciding either blind to the other is how the ladder reached
  three documents' worth of disagreement.
- **No escalation filed this session.** One was drafted and then withdrawn on evidence: I expected
  the newly-red `Cron Heartbeat` prod job to make `gh-pr-checks-verified.sh` return exit 1 on every
  PR (it classifies only `Rule I` as pre-existing-red). Reading `cron-heartbeat.yml` showed the job
  is gated `if: schedule || workflow_dispatch || (push && ref == main)` and never runs on
  `pull_request`. The workflow's author had already closed the hole. Verify-not-guess.
- **IN_PROGRESS (1/3 max):** FOLLOW-900 — devops-engineer/**Opus**, branch
  `devops-engineer/FOLLOW-900-modal-image-local-source`. Not yet started; no PR opened. **CI-check
  counter 0/5, fix-iteration counter 0/3.**
- **Open PRs:** none (`gh pr list --state open` empty at session start and unchanged).
- **P0 status:** zero open P0. FOLLOW-895 CLOSED with risk accepted by CEO (2026-08-07) — recorded
  as accepted, not dropped; **do not re-file it** (the ESC-020 pattern).
- **Live finding this session (FOLLOW-900, P1):** the FOLLOW-893 absence-of-signal detector fired on
  its first-ever scheduled run and caught a real dead prod cron. `estalara-schema-validation` is
  `deployed` with its schedule registered, and every container dies at import on
  `ModuleNotFoundError: No module named 'crons'` — so `schema_validation_history` has **0 rows** and
  `cron_heartbeats` has never recorded `validate_schemas`. Neither of the two outcomes the
  session-104 record documented as correct occurred. Root cause: the image is
  `debian_slim().pip_install(...)` with no local source under Modal 1.4.2, where automounting was
  removed in 1.0; the `PYTHONPATH` in `modal-deploy.yml:244` fixes only the runner-side import.
- **Also filed:** FOLLOW-901 (P2, FROZEN) — `E2E Smoke Test` red on every scheduled run for six days
  with zero backlog record; second instance of ESC-041's class.
- **Next in queue after FOLLOW-900:** FOLLOW-898 (P1, routing pre-decided: sdk-engineer/Opus),
  FOLLOW-874 (P1, re-priced), FOLLOW-885, FOLLOW-876, FOLLOW-892, FOLLOW-873. **FOLLOW-819 remains
  NOT startable** — `adaptation_decisions` has no writer in the local substrate (a missing
  component, not config), plus `depends_on` 818/560 open.
- **Retro loop:** RETRO-259/260/261 landed. **No retro is owed** — session 104 closed its own.

---

## (superseded) session 52, 2026-07-22

- **Escalations:** none OPEN. ESC-020/028/034 remain non-blocking OPEN per project memory
  (`project_wave0_golive_2026_07_13`); ages: ESC-020 ~46d (2026-06-06), ESC-028 ~29d (2026-06-23,
  believed superseded by later Upstash smoke-test resolution per memory but not re-closed in this
  file), ESC-034 resolved per memory (RESOLVED, stale row here). All other ESCALATIONS.md entries
  RESOLVED. None block this session's dispatch.
- **IN_PROGRESS (1/3 max):** FOLLOW-615 — backend-engineer/Sonnet, branch
  `backend-engineer/FOLLOW-615-config-write-rank-gate`, started 2026-07-22. No PR opened yet — CI
  check counter 0/5, fix-iteration counter 0/3.
- **Open PRs:** none (`gh pr list --state open` empty at session start).
- **Retro loop:** RETRO-202 filed for FOLLOW-614/PR#603 (spawned + committed prior to this session
  by retrospective-analyst, commit `be1f3fe`). Findings: spoofable-header class fully closed
  repo-wide; produced FOLLOW-615 (this session's dispatch) and amended FOLLOW-600's AC.
- **Next in queue after FOLLOW-615:** FOLLOW-600 (blocked on FOLLOW-615), FOLLOW-613, FOLLOW-604,
  FOLLOW-611.

---

## OPERATIONAL RECORD — ESC-031 Prod ClickHouse data-loss (2026-06-26)

**STATUS: RESOLVED.** Migration 0019 (page_context_source column) applied manually to prod CH via
SQL console. FOLLOW-394 DONE (PR #360). FOLLOW-402 now IN_PROGRESS to generalize the contract test
so any future column addition fails CI automatically.

---

## Current sprint

- **Sprint 22 Wave 2+ IN_PROGRESS** — Multiple FOLLOW tickets in progress post-audit.
- **Sprint 22 Wave 1 COMPLETE** — FOLLOW-383/369/371/368 all DONE.
- **Sprint 21 COMPLETE** — FOLLOW-372/373/374/375/376 all DONE (PRs #337–#341).

---

## READY_FOR_REVIEW tickets (see QUEUE.md)

PR #371 (FOLLOW-405): backend-engineer. CI green (real gates). Awaiting human merge. Also check PRs
#367 (FOLLOW-409), #369 (FOLLOW-414), #365 (FOLLOW-398) for merge status.

---

## IN_PROGRESS tickets (2/3 max)

| Ticket           | Agent           | Started           | Notes                                                                                      |
| ---------------- | --------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| TICKET-PILOT-001 | sdk-engineer    | 2026-05-29        | Lane A shadow mode; ESC-020 (Rafal deploy) blocks production activation                    |
| FOLLOW-404       | devops-engineer | 2026-06-26T23:59Z | Prod CH attestation: DESCRIBE TABLE + SELECT DISTINCT + DDL grant. Co-agent data-engineer. |

---

## OPEN escalations

| ESC     | Title                                                                        | Filed      | Age | Status                                                                                                |
| ------- | ---------------------------------------------------------------------------- | ---------- | --- | ----------------------------------------------------------------------------------------------------- |
| ESC-020 | Estalara-app DOM hooks not deployed to production [FOLLOW-191]               | 2026-06-06 | 20d | Non-blocking per CEO 2026-06-10; Rafal action deferred until local test                               |
| ESC-028 | GitHub Actions secrets required for FOLLOW-368 Redis shadow round-trip smoke | 2026-06-23 | 3d  | OPEN — 4 secrets: UPSTASH_REDIS_REST_URL/TOKEN + UPSTASH_REDIS_URL/TOKEN. Piotr/Rafal must provision. |

Neither ESC blocks the PM pipeline for other tickets.

---

## Pre-existing-red CI checks (non-blocking)

- `Rule I — wired-or-dead check`: pre-existing red, 107+ violations (FOLLOW-090 tracking).
- `Archetype embeddings not-NULL check`: soft-skips in CI due to missing Doppler creds — NOT because
  prod is NULL. Prod `archetype_embeddings` verified SEEDED 18/18 (1024-dim, distinct) on
  2026-07-01; FOLLOW-392's goal is met. (Cosine ordering is still djb2 in prod because
  `listing_embeddings` is empty for the pilot tenant — the real cosine blocker, tied to ESC-020, not
  FOLLOW-392.)
- Both appear on every PR as 2x fail each (run from push + PR event). Baseline = 4 non-success.

---

## CI check counter (session 2026-06-26)

- PR #367 (FOLLOW-409): 1/5 checks, 0/3 fix iterations. DONE.
- PR #369 (FOLLOW-414): 1/5 checks, 0/3 fix iterations. DONE.
- PR #371 (FOLLOW-405): 1/5 checks, 0/3 fix iterations. CI validated 2026-06-26. PR merged.
- PR TBD (FOLLOW-404): 0/5 checks, 0/3 fix iterations. IN_PROGRESS.

---

## §H.9 opt-out epic — STATUS

| Ticket     | Status           | Description                                                      |
| ---------- | ---------------- | ---------------------------------------------------------------- |
| FOLLOW-383 | DONE (PR #342)   | SDK→server profiling_opt_out=1 query param                       |
| FOLLOW-384 | DONE             | redis_writer.py chat-prior skip for opted-out sessions           |
| FOLLOW-385 | DONE             | Quiz/favorites/micro-poll opt-out enforcement                    |
| FOLLOW-386 | N/A              | (cancelled / merged into 385)                                    |
| FOLLOW-387 | DONE             | profiling_opt_out field on ChatMessageSentPayloadSchema          |
| FOLLOW-388 | READY (P2)       | Batch axis; depends_on FOLLOW-101                                |
| FOLLOW-389 | DONE (PR #355)   | Real-handler tests; INCOMPLETE leg covered by FOLLOW-409 pending |
| FOLLOW-409 | READY_FOR_REVIEW | Micro-poll onAnswer real-handler test (PR #367)                  |

§H.9 is functionally complete for live traffic. FOLLOW-388 (batch, blocked on FOLLOW-101) remains.

---

## Next READY P2 tickets (in priority order)

1. **FOLLOW-404** (P2, devops+data-engineer co-assigned, 1h) — IN_PROGRESS as of 2026-06-26T23:59Z
2. **FOLLOW-411** (P2, devops+backend, 1.5h) — consent gitleaks negative-control attestation (NOT
   yet in QUEUE; needs promotion from FOLLOW_UPS.md)
3. **FOLLOW-417** (P2, data-engineer, 2.5h) — RENAME/MODIFY verb gap + schema-derived floor (NOT yet
   in QUEUE; needs promotion from FOLLOW_UPS.md)

Next P3 (when P2 clear):

- **FOLLOW-416** (P3, sdk-engineer, 2h) — third-hop "reachable by real SDK traffic" + modeled test
  retirement + 5001 dedup (NOT yet in QUEUE)
- **FOLLOW-412** (P3, sdk-engineer, 0.5h) — §E.7 line-728 imprecisions (NOT yet in QUEUE)
- **FOLLOW-413** (P3, backend-engineer, 1h) — bare-ordinal migration citation style (NOT yet in
  QUEUE)
- **FOLLOW-406** (P3, devops-engineer, 1h) — route.ts gitleaks negative-control (READY in QUEUE)
- **FOLLOW-408** (P3, data-engineer, 1h) — CH migrations runbook two intra-doc residuals (NOT yet in
  QUEUE)
- **FOLLOW-399** (P3, sdk-engineer, 2h) — signal_count OR-branch test; BLOCKED on FOLLOW-355 (READY
  but not DONE)
