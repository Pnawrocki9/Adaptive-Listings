# PM Orchestrator Status

**Last updated:** 2026-07-22 (session 52). NOTE: this file's body below (up to the next `---`) is a
STALE snapshot from 2026-06-26; QUEUE.md's "START HERE" blocks are the authoritative running log.
Kept here only for historical CI-counter provenance; do not treat entries below this line as current
state — see QUEUE.md top block instead.

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
