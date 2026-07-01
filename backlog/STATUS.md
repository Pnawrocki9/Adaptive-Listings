# Status — 2026-07-01 (Sprint 22 ACTIVE — Audit wave promoted; ESC-035 security escalation OPEN — pipeline blocked on ESC-035 resolution)

## AUDIT 2026-07-01 — Pilot-blocking findings promoted to tickets

A staff-level end-to-end code audit (F-01..F-25, verdict YELLOW) completed this session. Five
pilot-blocking findings have been promoted:

| Audit ref | FOLLOW / ESC | Priority | Agent          | Status      | Summary                                                                                    |
| --------- | ------------ | -------- | -------------- | ----------- | ------------------------------------------------------------------------------------------ |
| F-01      | FOLLOW-439   | P0       | backend        | READY       | Lift route: delete buildMockLiftRows, fix dqsUnavailable=false, add data_source            |
| F-02      | FOLLOW-440   | P0       | backend        | READY       | Fix assigned_at→ts + phantom latency_ms in summary + inquiry-starts                        |
| F-04      | FOLLOW-329   | P0       | backend        | OPEN (stub) | Summary route: same fail-loud + data_source fix (pre-existing)                             |
| F-05      | FOLLOW-442   | P1       | backend        | READY\*     | POST adapt holdout missing logDecisionAsync (\* blocked on ESC-035)                        |
| F-06      | FOLLOW-441   | P0       | data           | READY       | Prod CH write-verification canary for logDecisionAsync                                     |
| F-09      | **ESC-035**  | **SEC**  | human decision | **OPEN**    | **SECURITY: feedback HMAC uses caller bearer as key; forgeable auth + cross-tenant write** |

FOLLOW-392 (prod archetype seed, P1 operator action) remains open.

**HARD PILOT GO-LIVE GATE:** ALL of the following DONE before ESC-020 pilot flip: ESC-035 RESOLVED +
FOLLOW-329/439/440/441/442 all DONE + FOLLOW-392 seed run.

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

| Ticket         | CI checks used | Fix iterations used | Status                                                                  |
| -------------- | -------------- | ------------------- | ----------------------------------------------------------------------- |
| FOLLOW-342     | 0/5            | 0/3                 | DONE (PR #327 + #353 merged 2026-06-25/26)                              |
| FOLLOW-357     | 2/5            | 1/3                 | DONE (PR #334 + #354 d8d5cb8, 2026-06-25)                               |
| FOLLOW-356     | —              | —                   | DONE (absorbed into FOLLOW-357 PR #354)                                 |
| FOLLOW-363     | 1/5            | 0/3                 | DONE (PR #351 merged 2026-06-25)                                        |
| FOLLOW-389     | —              | —                   | DONE (PR #355 merged 0e1b9eb, 2026-06-26)                               |
| FOLLOW-361     | 1/5            | 0/3                 | DONE (PR #356 merged 4eb24af4, 2026-06-26T10:08Z). RETRO-117 DONE.      |
| FOLLOW-358     | 3/5            | 2/3                 | DONE (PR #357 merged a8eacb4a, 2026-06-26T10:40Z). RETRO-118 DONE.      |
| FOLLOW-354     | 1/5            | 0/3                 | DONE (PR #358 merged 701aa4efb9, 2026-06-26T11:23Z). RETRO-119 DONE.    |
| FOLLOW-362     | 1/5            | 0/3                 | DONE (PR #359 merged dfe8a9cd71, 2026-06-26T11:31Z). RETRO-120 DONE.    |
| FOLLOW-394     | 3/5            | 2/3                 | DONE — PR #360 merged 5898739afaf6 (2026-06-26T13:24Z). RETRO-121 DONE. |
| FOLLOW-397     | 1/5            | 0/3                 | DONE — PR #361 merged 7962b4e9c22e (2026-06-26T14:01Z). RETRO-122 DONE. |
| FOLLOW-396     | 1/5            | 0/3                 | DONE — PR #362 merged 2026-06-26T14:17Z. RETRO-123 DONE.                |
| FOLLOW-403     | 1/5            | 0/3                 | DONE — PR #363 merged 2026-06-26T14:32Z. RETRO-124 DONE.                |
| FOLLOW-407     | 1/5            | 0/3                 | DONE — PR #364 merged 2026-06-26T14:48Z. RETRO-125 DONE.                |
| FOLLOW-398     | 1/5            | 0/3                 | DONE — PR #365 merged 2026-06-26T14:52Z. RETRO-126 DONE.                |
| FOLLOW-410     | 1/5            | 0/3                 | DONE — PR #366 merged 2026-06-26T15:13Z. RETRO-127 DONE.                |
| FOLLOW-409     | 1/5            | 0/3                 | DONE — PR #367 merged 2026-06-26. RETRO-128 DONE.                       |
| FOLLOW-402     | 1/5            | 0/3                 | DONE — PR #368 merged 2026-06-26. RETRO-129 DONE.                       |
| FOLLOW-414     | 1/5            | 0/3                 | DONE — PR #369 merged 2026-06-26T16:46Z. RETRO-130 DONE.                |
| FOLLOW-415     | 0/5            | 0/3                 | DONE — PR #370 merged 2026-06-26T17:12Z. RETRO-131 DONE.                |
| FOLLOW-405     | 1/5            | 0/3                 | DONE — PR #371 merged 2026-06-26. RETRO-132 DONE.                       |
| FOLLOW-404     | 0/5            | 0/3                 | DONE — PR #372 merged 2026-06-26. RETRO-133 DONE.                       |
| FOLLOW-406/411 | 0/5            | 0/3                 | DONE — PR #373 merged 2026-06-26. RETRO-134 PENDING.                    |
| FOLLOW-425     | 0/5            | 0/3                 | DONE — PR #374 merged 2026-06-26. RETRO-135 DONE.                       |
| FOLLOW-422     | 0/5            | 0/3                 | DONE — PR #375 merged 2026-06-28. RETRO-136 PENDING.                    |
| FOLLOW-427/428 | 0/5            | 0/3                 | DONE — PR #377 merged. RETRO-137 DONE.                                  |
| FOLLOW-429/430 | 0/5            | 0/3                 | DONE (fire-and-forget sweep chain).                                     |
| FOLLOW-431     | 0/5            | 0/3                 | DONE — PR #379 merged. RETRO-138 DONE.                                  |
| FOLLOW-432     | 0/5            | 0/3                 | DONE — PR #381 merged. RETRO-139 DONE.                                  |
| FOLLOW-433     | 0/5            | 0/3                 | DONE — PRs #382+#384 merged. RETRO-140 DONE.                            |
| FOLLOW-434     | 0/5            | 0/3                 | DONE — PR #385 merged. RETRO-141 DONE.                                  |
| FOLLOW-435     | 0/5            | 0/3                 | DONE — PRs #389+#390 merged. RETRO-142 DONE.                            |
| FOLLOW-436     | 0/5            | 0/3                 | OPEN — ESC-034 operator go-live pending.                                |
| FOLLOW-437     | 0/5            | 0/3                 | DONE — PR #393 merged 2026-06-30. RETRO-143 DONE.                       |
| FOLLOW-438     | 0/5            | 0/3                 | DONE — PR #395 merged 2026-06-30. RETRO-144 DONE.                       |
| FOLLOW-439     | 0/5            | 0/3                 | READY (promoted 2026-07-01 — not delegated; ESC-035 blocks)             |
| FOLLOW-440     | 0/5            | 0/3                 | READY (promoted 2026-07-01 — not delegated; ESC-035 blocks)             |
| FOLLOW-441     | 0/5            | 0/3                 | READY (promoted 2026-07-01 — not delegated; ESC-035 blocks)             |
| FOLLOW-442     | 0/5            | 0/3                 | READY (promoted 2026-07-01 — not delegated; ESC-035 blocks)             |

---

## Open escalations

| ESC         | Age    | Summary                                                         | Blocking pipeline?                           |
| ----------- | ------ | --------------------------------------------------------------- | -------------------------------------------- |
| ESC-020     | 25d    | Estalara-app DOM hooks not deployed to prod                     | No (operator action)                         |
| ESC-028     | 8d     | Upstash Redis secrets for smoke CI                              | No (soft-skip)                               |
| ESC-034     | 1d     | Modal embed-seed consumer operator go-live                      | No (operator action, code ready)             |
| **ESC-035** | **0d** | **SECURITY: feedback HMAC forgeable auth + cross-tenant write** | **YES — blocks all pilot ticket delegation** |

---

## Active sprint: Sprint 22 (OPEN)

Next free FOLLOW stub number: **443**.

**IN_PROGRESS (0/3 max):**

- None. (ESC-035 blocks new delegations.)

**READY (pilot-blocking P0/P1 — pending ESC-035 resolution):**

- FOLLOW-329 (P0, backend-engineer) — Summary route fail-loud + data_source. Pre-existing stub.
- FOLLOW-439 (P0, backend-engineer) — Lift route buildMockLiftRows fix (AUD-01/F-01). ~2h.
- FOLLOW-440 (P0, backend-engineer) — assigned_at→ts phantom column fix (AUD-02/F-02). ~2h.
- FOLLOW-441 (P0, data-engineer) — Prod CH write-verification canary (AUD-03/F-06). ~3h.
- FOLLOW-442 (P1, backend-engineer) — POST adapt holdout logDecisionAsync (AUD-04/F-05). ~1h.

**READY (P2/P3 next up — NOT blocked by ESC-035):**

- FOLLOW-417 (P2, data-engineer) — CH contract test RENAME/MODIFY blind spot. 2.5h.
- FOLLOW-418 (P2, qa-engineer) — SEED_VARIANTS parity gate content + negative-control. 2h.
- FOLLOW-420 (P2, backend-engineer) — stray-arm served vs logged reward contract. 2h.
- FOLLOW-421 (P2, devops-engineer) — src-vs-dist freshness guard. 3h.
- FOLLOW-355 (P3, sdk-engineer) — cold-start signal_count invariant. 2h.
- FOLLOW-401 (P3, backend-engineer) — bandit locale-scope decision. 3h.
- FOLLOW-408 (P3, data-engineer) — CH runbook residual. 1h.
- FOLLOW-412 (P3, sdk-engineer) — §E.7 line-728 imprecisions. 0.5h.
- FOLLOW-413 (P3, backend-engineer) — bare-ordinal migration citation. 1h.
- FOLLOW-416 (P3, sdk-engineer) — §H.9 SDK doc/test residuals. 2h.
- FOLLOW-399 (P3, sdk-engineer) — BLOCKED on FOLLOW-355.
- FOLLOW-400 (P2, backend-engineer) — BLOCKED on FOLLOW-031.

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
journal monotonicity, Modal singleton guard (FOLLOW-438, PR #395).

Pre-existing FAILURE / NON-BLOCKING: Rule I (~175 violations, FOLLOW-090 baseline), Archetype
embeddings not-NULL (soft-skip until FOLLOW-392 prod seed applied).

---

## ESCALATION STATUS

| ESC     | Status   | Summary                                                                           |
| ------- | -------- | --------------------------------------------------------------------------------- |
| ESC-035 | **OPEN** | **SECURITY: feedback HMAC forgeable auth — blocks pilot delegation (2026-07-01)** |
| ESC-034 | OPEN     | Modal embed-seed operator go-live pending (non-blocking; code ready)              |
| ESC-028 | OPEN     | Upstash Redis secrets not provisioned (non-blocking, soft-skip)                   |
| ESC-020 | OPEN     | Estalara-app DOM hooks not deployed to prod (non-blocking)                        |
| ESC-032 | RESOLVED | ingest_worker grant breadth security posture — signed off                         |
| ESC-031 | RESOLVED | P1: adaptation_decisions writes silently failing — migration 0019 applied         |
| ESC-033 | RESOLVED | Fire-and-forget sinks lack after() — fixed by FOLLOW-431..433                     |
| ESC-030 | RESOLVED | CEO Option A; FOLLOW-341 DONE PR #352                                             |
| ESC-029 | RESOLVED | CEO approved ChatMessageSentPayloadSchema extension 2026-06-24                    |
| ESC-027 | RESOLVED | CEO: page_context; FOLLOW-357+356 DONE PR #354                                    |
| ESC-026 | RESOLVED | FOLLOW-360 merged 2836adc                                                         |
| ESC-025 | RESOLVED | FOLLOW-366 merged eaf31a9                                                         |
