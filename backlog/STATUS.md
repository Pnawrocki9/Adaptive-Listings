# Status — 2026-07-01 (Sprint 22 ACTIVE — Audit wave; ESC-035 RESOLVED; hard pilot go-live gate fully clear on the code side — FOLLOW-442 merged #406; PM picking up FOLLOW-448)

## AUDIT 2026-07-01 — Pilot-blocking findings promoted to tickets

A staff-level end-to-end code audit (F-01..F-25, verdict YELLOW) completed this session. Five
pilot-blocking findings were promoted; four are now DONE:

| Audit ref | FOLLOW / ESC | Priority | Agent          | Status                                   | Summary                                                                                              |
| --------- | ------------ | -------- | -------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| F-01      | FOLLOW-439   | P0       | backend        | DONE (#398)                              | Lift route: delete buildMockLiftRows, fix dqsUnavailable=false, add data_source                      |
| F-02      | FOLLOW-440   | P0       | backend        | DONE (#398)                              | Fix assigned_at→ts + phantom latency_ms in summary + inquiry-starts                                  |
| F-04      | FOLLOW-329   | P0       | backend        | DONE (#398)                              | Summary route: same fail-loud + data_source fix (resolved in same PR as 439/440)                     |
| F-05      | FOLLOW-442   | P1       | backend        | DONE (#406, merged 2026-07-01T16:29:05Z) | POST adapt holdout missing logDecisionAsync                                                          |
| F-06      | FOLLOW-441   | P0       | data           | DONE (#399)                              | Prod CH write-verification canary for logDecisionAsync                                               |
| F-09      | **ESC-035**  | **SEC**  | human decision | **RESOLVED**                             | SECURITY fix shipped: ADR-0015 ACCEPTED + FOLLOW-443 merged (#401); FOLLOW-444 interim merged (#397) |

FOLLOW-392 (prod archetype seed) DONE — verified 18/18 seeded in prod 2026-07-01 (PR #402 corrected
the stale NULL claim). CI gate hardening follow-ons FOLLOW-446 DONE (#403), FOLLOW-447 (P3, READY,
not pilot-blocking).

**HARD PILOT GO-LIVE GATE: FULLY CLEAR ON THE CODE SIDE as of 2026-07-01T19:24Z** (ESC-035
RESOLVED + FOLLOW-329/439/440/441/442 all DONE + FOLLOW-392 prod seed verified). Only the two
non-blocking operator actions remain outside the pipeline: ESC-034 (Modal embed-seed go-live) and
setting `OPS_TENANT_ID`/`ADAPT_API_KEY`/`FEEDBACK_ENDPOINT_ENABLED` in Doppler `prd` (see below).

RETRO-146 (PR #409, for FOLLOW-442) surfaced a near-miss: the backend-engineer worker stalled 600s
mid-ticket, leaving the correct fix uncommitted directly on the `main` working tree (never ran
`git checkout -b`). PM recovered it onto the proper branch, independently re-ran
typecheck+lint+11/11 holdout tests (never trusting the stalled worker's unclaimed "passing" state),
then committed/pushed/opened the PR. Generated FOLLOW-448 (P2, devops-engineer + pm-orchestrator) —
branch-first worker discipline + a mechanical `HEAD==main` guard hook + formalizing "recovered work
must be independently re-verified" in the PM handoff procedure. Promoted to QUEUE.md and delegated
this session (queue hygiene: FOLLOW-364 and FOLLOW-442 were also corrected from stale IN_PROGRESS to
DONE in QUEUE.md — both were already merged, #408 and #406 respectively).

**HARD PILOT GO-LIVE GATE:** ESC-035 RESOLVED ✓ + FOLLOW-329/439/440/441 DONE ✓ + FOLLOW-392 seed
run ✓. Only **FOLLOW-442** remains open on the code side. Separately, an **operator action** remains
(non-blocking, tracked like ESC-034): ops must set `OPS_TENANT_ID` + `ADAPT_API_KEY` in Doppler
`prd` and flip `FEEDBACK_ENDPOINT_ENABLED=true` before the feedback endpoint serves live pilot
traffic.

---

## ESC-031 RESOLVED — prod incident closed

Migration 0019 applied 2026-06-26T~12:00Z via ClickHouse Cloud SQL console. Column
`page_context_source` exists with correct type and default. All `/api/adapt` writes now succeeding.
FOLLOW-394 remaining code ACs (contract test + runbook) delegated to data-engineer. See
backlog/ESCALATIONS.md ESC-031.

---

## PROD SEED ACTION REQUIRED — §F cosine MOAT go-live (FOLLOW-341 / FOLLOW-392)

FOLLOW-341 (PR #352) merged and code-complete. Dev DB auto-populates via post-migrate-seed.yml. PROD
Supabase does NOT auto-populate.

OPERATOR ACTION:
`cd apps/control-plane && SUPABASE_SERVICE_ROLE_KEY=<prod_key> OPENAI_API_KEY=<key> pnpm seed:archetypes`
OR trigger seed-archetypes.yml workflow_dispatch with prod credentials. Until this runs,
affinityScore() falls back to djb2-fallback ordering in prod (safe degradation). Tracked as
FOLLOW-392 (devops+ml, P1, promoted).

---

## Active CI-check counters (step 5b tracking)

| Ticket         | CI checks used | Fix iterations used | Status                                                                                                                                                         |
| -------------- | -------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FOLLOW-342     | 0/5            | 0/3                 | DONE (PR #327 + #353 merged 2026-06-25/26)                                                                                                                     |
| FOLLOW-357     | 2/5            | 1/3                 | DONE (PR #334 + #354 d8d5cb8, 2026-06-25)                                                                                                                      |
| FOLLOW-356     | —              | —                   | DONE (absorbed into FOLLOW-357 PR #354)                                                                                                                        |
| FOLLOW-363     | 1/5            | 0/3                 | DONE (PR #351 merged 2026-06-25)                                                                                                                               |
| FOLLOW-389     | —              | —                   | DONE (PR #355 merged 0e1b9eb, 2026-06-26)                                                                                                                      |
| FOLLOW-361     | 1/5            | 0/3                 | DONE (PR #356 merged 4eb24af4, 2026-06-26T10:08Z). RETRO-117 DONE.                                                                                             |
| FOLLOW-358     | 3/5            | 2/3                 | DONE (PR #357 merged a8eacb4a, 2026-06-26T10:40Z). RETRO-118 DONE.                                                                                             |
| FOLLOW-354     | 1/5            | 0/3                 | DONE (PR #358 merged 701aa4efb9, 2026-06-26T11:23Z). RETRO-119 DONE.                                                                                           |
| FOLLOW-362     | 1/5            | 0/3                 | DONE (PR #359 merged dfe8a9cd71, 2026-06-26T11:31Z). RETRO-120 DONE.                                                                                           |
| FOLLOW-394     | 3/5            | 2/3                 | DONE — PR #360 merged 5898739afaf6 (2026-06-26T13:24Z). RETRO-121 DONE.                                                                                        |
| FOLLOW-397     | 1/5            | 0/3                 | DONE — PR #361 merged 7962b4e9c22e (2026-06-26T14:01Z). RETRO-122 DONE.                                                                                        |
| FOLLOW-396     | 1/5            | 0/3                 | DONE — PR #362 merged 2026-06-26T14:17Z. RETRO-123 DONE.                                                                                                       |
| FOLLOW-403     | 1/5            | 0/3                 | DONE — PR #363 merged 2026-06-26T14:32Z. RETRO-124 DONE.                                                                                                       |
| FOLLOW-407     | 1/5            | 0/3                 | DONE — PR #364 merged 2026-06-26T14:48Z. RETRO-125 DONE.                                                                                                       |
| FOLLOW-398     | 1/5            | 0/3                 | DONE — PR #365 merged 2026-06-26T14:52Z. RETRO-126 DONE.                                                                                                       |
| FOLLOW-410     | 1/5            | 0/3                 | DONE — PR #366 merged 2026-06-26T15:13Z. RETRO-127 DONE.                                                                                                       |
| FOLLOW-409     | 1/5            | 0/3                 | DONE — PR #367 merged 2026-06-26. RETRO-128 DONE.                                                                                                              |
| FOLLOW-402     | 1/5            | 0/3                 | DONE — PR #368 merged 2026-06-26. RETRO-129 DONE.                                                                                                              |
| FOLLOW-414     | 1/5            | 0/3                 | DONE — PR #369 merged 2026-06-26T16:46Z. RETRO-130 DONE.                                                                                                       |
| FOLLOW-415     | 0/5            | 0/3                 | DONE — PR #370 merged 2026-06-26T17:12Z. RETRO-131 DONE.                                                                                                       |
| FOLLOW-405     | 1/5            | 0/3                 | DONE — PR #371 merged 2026-06-26. RETRO-132 DONE.                                                                                                              |
| FOLLOW-404     | 0/5            | 0/3                 | DONE — PR #372 merged 2026-06-26. RETRO-133 DONE.                                                                                                              |
| FOLLOW-406/411 | 0/5            | 0/3                 | DONE — PR #373 merged 2026-06-26. RETRO-134 PENDING.                                                                                                           |
| FOLLOW-425     | 0/5            | 0/3                 | DONE — PR #374 merged 2026-06-26. RETRO-135 DONE.                                                                                                              |
| FOLLOW-422     | 0/5            | 0/3                 | DONE — PR #375 merged 2026-06-28. RETRO-136 PENDING.                                                                                                           |
| FOLLOW-427/428 | 0/5            | 0/3                 | DONE — PR #377 merged. RETRO-137 DONE.                                                                                                                         |
| FOLLOW-429/430 | 0/5            | 0/3                 | DONE (fire-and-forget sweep chain).                                                                                                                            |
| FOLLOW-431     | 0/5            | 0/3                 | DONE — PR #379 merged. RETRO-138 DONE.                                                                                                                         |
| FOLLOW-432     | 0/5            | 0/3                 | DONE — PR #381 merged. RETRO-139 DONE.                                                                                                                         |
| FOLLOW-433     | 0/5            | 0/3                 | DONE — PRs #382+#384 merged. RETRO-140 DONE.                                                                                                                   |
| FOLLOW-434     | 0/5            | 0/3                 | DONE — PR #385 merged. RETRO-141 DONE.                                                                                                                         |
| FOLLOW-435     | 0/5            | 0/3                 | DONE — PRs #389+#390 merged. RETRO-142 DONE.                                                                                                                   |
| FOLLOW-436     | 0/5            | 0/3                 | OPEN — ESC-034 operator go-live pending.                                                                                                                       |
| FOLLOW-437     | 0/5            | 0/3                 | DONE — PR #393 merged 2026-06-30. RETRO-143 DONE.                                                                                                              |
| FOLLOW-438     | 0/5            | 0/3                 | DONE — PR #395 merged 2026-06-30. RETRO-144 DONE.                                                                                                              |
| FOLLOW-444     | 0/5            | 0/3                 | DONE — PR #397 merged (interim 503 + scoped ops bypass).                                                                                                       |
| FOLLOW-439     | 0/5            | 0/3                 | DONE — PR #398 merged 2026-06-30 (with FOLLOW-329/440).                                                                                                        |
| FOLLOW-440     | 0/5            | 0/3                 | DONE — PR #398 merged 2026-06-30 (with FOLLOW-329/439).                                                                                                        |
| FOLLOW-329     | 0/5            | 0/3                 | DONE — PR #398 merged 2026-06-30 (with FOLLOW-439/440).                                                                                                        |
| FOLLOW-441     | 0/5            | 0/3                 | DONE — PR #399 merged (prod CH write-verification canary).                                                                                                     |
| ADR-0015       | 0/5            | 0/3                 | DONE — PR #400 merged, ACCEPTED.                                                                                                                               |
| FOLLOW-443     | 0/5            | 0/3                 | DONE — PR #401 merged (ESC-035 permanent fix). ESC-035 RESOLVED.                                                                                               |
| FOLLOW-392     | 0/5            | 0/3                 | DONE — PR #402 merged (prod seed verified 18/18, stale claim corrected).                                                                                       |
| FOLLOW-446     | 0/5            | 0/3                 | DONE — PR #403 merged (CI gate un-blinded).                                                                                                                    |
| FOLLOW-442     | 0/5            | 0/3                 | IN_PROGRESS — PR #406 open, CI running (owned by main session; PM-orchestrator instructed NOT to touch/re-validate/merge this ticket).                         |
| FOLLOW-447     | 0/5            | 0/3                 | READY — P3, not pilot-blocking. depends_on FOLLOW-446 (DONE).                                                                                                  |
| FOLLOW-364     | 0/5            | 0/3                 | IN_PROGRESS — delegated to ml-engineer 2026-07-01 (this PM pass). Docs-only §D.6 coverage-summary fix, premise re-verified against docs/MASTER_DESIGN.md:1954. |

---

## Open escalations

| ESC     | Age | Summary                                                         | Blocking pipeline?                          |
| ------- | --- | --------------------------------------------------------------- | ------------------------------------------- |
| ESC-020 | 25d | Estalara-app DOM hooks not deployed to prod                     | No (operator action)                        |
| ESC-028 | 8d  | Upstash Redis secrets for smoke CI                              | No (soft-skip)                              |
| ESC-034 | 1d  | Modal embed-seed consumer operator go-live                      | No (operator action, code ready)            |
| ESC-035 | 0d  | RESOLVED 2026-07-01 — feedback HMAC forgeable auth (code fixed) | No (only a flip-flag operator step remains) |

---

## Active sprint: Sprint 22 (OPEN)

Next free FOLLOW stub number: **448**.

**IN_PROGRESS (2/3 max, as of this pass):**

- FOLLOW-442 (P1, backend-engineer) — PR #406 open, CI running. Owned by the main session
  (human-authorized to merge on green); this PM pass does not touch it. Last remaining code item on
  the hard pilot go-live gate.
- FOLLOW-364 (P2, ml-engineer) — delegated this pass (see "DELEGATING NOW").

**DELEGATING NOW:**

- FOLLOW-364 (P2, ml-engineer) — table row: intent/adapt logic, embeddings, LLM gateway,
  auto-detect, ontology, platform-templates. Reconcile §D.6 coverage-summary counts to a clean
  18-way partition in docs/MASTER_DESIGN.md (docs-only). ~1h. Not pilot-blocking; picked because it
  is P2, fully unblocked (depends_on: []), premise-verified against the live repo today, and
  ml-engineer/sdk-engineer/data-engineer/devops-engineer were all otherwise free (backend-engineer
  is occupied by FOLLOW-442, which rules out same-agent P2/P3 backend tickets FOLLOW-367/370/400/401
  this pass).

**READY — re-surveyed 2026-07-01 (this pass; supersedes the stale FOLLOW-417/418/420/421 list
below,** **those IDs no longer exist in QUEUE.md):**

- FOLLOW-447 (P3, devops-engineer) — audit sibling CI gates for INERT-GATE failure modes. 2h. Fully
  unblocked (depends_on FOLLOW-446, DONE). Good next pick after this pass.
- FOLLOW-395 (P3, data-engineer) — realize page_context_source discriminator consumer. 2h. Fully
  unblocked (depends_on FOLLOW-394, DONE).
- FOLLOW-355 (P3, sdk-engineer) — cold-start signal_count invariant. 2h. depends_on: [].
- FOLLOW-401 (P3, backend-engineer) — bandit locale-scope decision. 3h. depends_on: []. Blocked on
  agent availability while FOLLOW-442 is IN_PROGRESS (same agent).
- FOLLOW-370 (P2, backend-engineer) — cache getBanditArms non-holdout path. 2h. depends_on: [].
  Blocked on agent availability while FOLLOW-442 is IN_PROGRESS (same agent); also touches the same
  route.ts file as FOLLOW-442 — do not run in parallel even once backend-engineer frees up without
  diffing against FOLLOW-442's merged change first.
- FOLLOW-367 (P2, backend-engineer) — implement/remove CHAT_NLP_LIVE gate. 3h. NOT actually ready
  despite depends_on:[FOLLOW-366] (DONE) — notes require "all 5 C-07 DPIA go-live items signed off"
  first; that sign-off is not confirmed done. Needs a human/compliance check before delegating.
- FOLLOW-399 (P3, sdk-engineer) — BLOCKED on FOLLOW-355 (still READY, not DONE).
- FOLLOW-400 (P2, backend-engineer) — BLOCKED on FOLLOW-031 (not promoted to QUEUE.md at all — only
  a FOLLOW_UPS.md stub; not truly ready regardless of agent availability).
- FOLLOW-388 (P2, data-engineer) — flagged NOT actionable yet in QUEUE.md notes 2026-07-01: its
  premise (surface opt-out state in `read_recent_chat_sessions`) requires a real ClickHouse batch
  query that no ticket has implemented yet (`apps/intent-engine/src/clickhouse_reader.py:4` is still
  a hardcoded `[]` stub). Do not delegate until that prerequisite exists.

---

## Pending retrospectives (RETRO-134, RETRO-136)

| RETRO     | Source ticket(s) | PR(s) | Status                  |
| --------- | ---------------- | ----- | ----------------------- |
| RETRO-134 | FOLLOW-406/411   | #373  | PENDING — to be spawned |
| RETRO-136 | FOLLOW-422       | #375  | PENDING — to be spawned |

---

## Migration status

| Migration       | Scope   | CI             | Prod apply          | Notes                                             |
| --------------- | ------- | -------------- | ------------------- | ------------------------------------------------- |
| 0019 (CH)       | CH      | CI container   | APPLIED ~12:00Z     | page_context_source — ESC-031 RESOLVED 2026-06-26 |
| 0031 (Postgres) | Drizzle | db-migrate.yml | APPLIED (confirmed) | Strip variant='default'; run 28231486742 success  |

---

## CI Gates — Real gates status (last verified 2026-06-30)

Real gates (GREEN): Build, Build (control-plane), Typecheck, Lint, Test (Node 22), SDK E2E, Rule H,
Rule J, ClickHouse migrations smoke, Corpus gate, Tracer query CI guard, Redis shadow round-trip
(soft-skip pending ESC-028), Privacy Notice SDK key-sync, Demo integration, Gitleaks, Migration
journal monotonicity, Modal singleton guard (FOLLOW-438, PR #395), Archetype embeddings not-NULL
(un-blinded 2026-07-01 by FOLLOW-446/PR #403 — now genuinely verifies prod-shaped seed data;
DOPPLER_TOKEN_DEV absence on forked PRs still soft-skips, but build/query breakage now REDs).

Pre-existing FAILURE / NON-BLOCKING: Rule I (~175 violations, FOLLOW-090 baseline; SDK-bundle
`Build` gate may also be pre-existing-red — do not treat as a merge blocker).

---

## ESCALATION STATUS

| ESC     | Status   | Summary                                                                             |
| ------- | -------- | ----------------------------------------------------------------------------------- |
| ESC-035 | RESOLVED | SECURITY: ADR-0015 ACCEPTED + FOLLOW-443 merged (#401) — operator flip-flag remains |
| ESC-034 | OPEN     | Modal embed-seed operator go-live pending (non-blocking; code ready)                |
| ESC-028 | OPEN     | Upstash Redis secrets not provisioned (non-blocking, soft-skip)                     |
| ESC-020 | OPEN     | Estalara-app DOM hooks not deployed to prod (non-blocking)                          |
| ESC-032 | RESOLVED | ingest_worker grant breadth security posture — signed off                           |
| ESC-031 | RESOLVED | P1: adaptation_decisions writes silently failing — migration 0019 applied           |
| ESC-033 | RESOLVED | Fire-and-forget sinks lack after() — fixed by FOLLOW-431..433                       |
| ESC-030 | RESOLVED | CEO Option A; FOLLOW-341 DONE PR #352                                               |
| ESC-029 | RESOLVED | CEO approved ChatMessageSentPayloadSchema extension 2026-06-24                      |
| ESC-027 | RESOLVED | CEO: page_context; FOLLOW-357+356 DONE PR #354                                      |
| ESC-026 | RESOLVED | FOLLOW-360 merged 2836adc                                                           |
| ESC-025 | RESOLVED | FOLLOW-366 merged eaf31a9                                                           |
