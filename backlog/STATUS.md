# Status — 2026-06-28 (Sprint 22 ACTIVE — ESC-031 loop fully closed, FOLLOW-406/411/425/422 all DONE, 3 retros pending: PR #373/#374/#375)

## ESC-031 RESOLVED — prod incident closed

Migration 0019 applied 2026-06-26T~12:00Z via ClickHouse Cloud SQL console. Column
`page_context_source` exists with correct type and default. All `/api/adapt` writes now succeeding.
FOLLOW-394 remaining code ACs (contract test + runbook) delegated to data-engineer. See
backlog/ESCALATIONS.md ESC-031.

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
| FOLLOW-396     | 1/5            | 0/3                 | DONE — PR #362 merged 2026-06-26T14:17Z. RETRO-123 → FOLLOW-406/407.    |
| FOLLOW-403     | 1/5            | 0/3                 | DONE — PR #363 merged 2026-06-26T14:32Z. RETRO-124 complete.            |
| FOLLOW-407     | 1/5            | 0/3                 | DONE — PR #364 merged 2026-06-26T14:48Z. RETRO-125 DONE.                |
| FOLLOW-398     | 1/5            | 0/3                 | DONE — PR #365 merged 2026-06-26T14:52Z. RETRO-126 in progress.         |
| FOLLOW-410     | 1/5            | 0/3                 | DONE — PR #366 merged 2026-06-26T15:13Z. RETRO-127 in progress.         |
| FOLLOW-409     | 1/5            | 0/3                 | READY_FOR_REVIEW — PR #367 PM-validated 2026-06-26T23:30Z.              |
| FOLLOW-402     | 1/5            | 0/3                 | READY_FOR_REVIEW — PR #368 PM-validated 2026-06-26. All ACs verified.   |
| FOLLOW-414     | 1/5            | 0/3                 | DONE — PR #369 merged 2026-06-26T16:46Z. RETRO-130 → FOLLOW-416.        |
| FOLLOW-415     | 0/5            | 0/3                 | DONE — PR #370 merged 2026-06-26T17:12Z. Retrospective pending.         |
| FOLLOW-405     | 1/5            | 0/3                 | DONE — PR #371 merged 2026-06-26. RETRO-132 pending.                    |
| FOLLOW-404     | 0/5            | 0/3                 | DONE — PR #372 being merged 2026-06-26. Pre-existing fails only.        |
| FOLLOW-406/411 | 0/5            | 0/3                 | DONE — PR #373 merged 2026-06-26. RETRO-134 pending.                    |
| FOLLOW-425     | 0/5            | 0/3                 | DONE — PR #374 merged 2026-06-26. RETRO-135 pending.                    |
| FOLLOW-422     | 0/5            | 0/3                 | DONE — PR #375 merged 2026-06-28. RETRO-136 pending.                    |

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

## Open escalations

| ESC     | Age | Summary                                                                      | Blocking?                |
| ------- | --- | ---------------------------------------------------------------------------- | ------------------------ |
| ESC-020 | 22d | Estalara-app DOM hooks not deployed to prod                                  | No (per note)            |
| ESC-028 | 5d  | Upstash secrets for Redis smoke CI                                           | No (soft-skip)           |
| ESC-032 | 0d  | ingest_worker grant breadth: prod default.\* vs MASTER_DESIGN default.events | No (P2, decision needed) |

---

## Active sprint: Sprint 22 (OPEN)

Next free FOLLOW stub number: 427.

**IN_PROGRESS (0/3 max):**

- None.

**READY_FOR_REVIEW (awaiting human merge):**

- None — FOLLOW-409 (PR #367) and FOLLOW-402 (PR #368) confirmed merged (in git log).

**DONE (Sprint 22 — cumulative):**

- FOLLOW-422 (P1) — PR #375 merged 2026-06-28. RETRO-136 pending. Confirms writes flowing
  post-ESC-031 fix.
- FOLLOW-425 (P1) — PR #374 merged 2026-06-26. RETRO-135 DONE → FOLLOW-426 (harden 2 Redpanda
  fire-and-forget sinks sharing the same res.ok-blind gap) + Rule K.2 fire-and-forget amendment
  promoted. Fail-loud on CH INSERT rejection.
- FOLLOW-406/411 (P3/P2) — PR #373 merged 2026-06-26. RETRO-134 pending. Gitleaks attestation.
- FOLLOW-404 (P2) — PR #372 merged 2026-06-26. RETRO-133 DONE.
- FOLLOW-405 (P2) — PR #371 merged 2026-06-26. RETRO-132 DONE.
- FOLLOW-415 (P2) — PR #370 merged 2026-06-26. RETRO-131 DONE.
- FOLLOW-414 (P2) — PR #369 merged 2026-06-26. RETRO-130 DONE.
- FOLLOW-409 (P2) — PR #367 merged 2026-06-26. RETRO-128 DONE.
- FOLLOW-402 (P2) — PR #368 merged 2026-06-26. RETRO-129 DONE.
- FOLLOW-398 (P2) — PR #365 merged 2026-06-26. RETRO-126 DONE.
- FOLLOW-410 (P2) — PR #366 merged 2026-06-26. RETRO-127 DONE.
- FOLLOW-394 (P1) — PR #360 merged 2026-06-26. RETRO-121 DONE.
- FOLLOW-397 (P2) — PR #361 merged 2026-06-26. RETRO-122 DONE.
- FOLLOW-396 (P2) — PR #362 merged 2026-06-26. RETRO-123 DONE. Rule V promoted.
- FOLLOW-403 (P2) — PR #363 merged 2026-06-26. RETRO-124 DONE.
- FOLLOW-407 (P2) — PR #364 merged 2026-06-26. RETRO-125 DONE.

**READY (P2/P3 next up — not yet delegated):**

- FOLLOW-417 (P2, data-engineer) — CH contract test RENAME/MODIFY blind spot. 2.5h. NOT in QUEUE
  yet.
- FOLLOW-418 (P2, qa-engineer) — SEED_VARIANTS parity gate content check + negative-control. 2h. NOT
  in QUEUE.
- FOLLOW-420 (P2, backend-engineer) — stray-arm served vs logged reward contract. 2h. NOT in QUEUE.
- FOLLOW-421 (P2, devops-engineer) — src-vs-dist freshness guard for parity gate. 3h. NOT in QUEUE.
- FOLLOW-355 (P3, sdk-engineer) — pin cold-start signal_count invariant. 2h, no deps.
- FOLLOW-401 (P3, backend-engineer) — bandit locale-scope decision. 3h, no deps.
- FOLLOW-408 (P3, data-engineer) — CH runbook intro-sentence residual. 1h, no deps.
- FOLLOW-412 (P3, sdk-engineer) — §E.7 line-728 imprecisions. 0.5h. NOT in QUEUE yet.
- FOLLOW-413 (P3, backend-engineer) — bare-ordinal migration citation style fix. 1h. NOT in QUEUE
  yet.
- FOLLOW-416 (P3, sdk-engineer) — §H.9 SDK doc/test residuals. 2h. NOT in QUEUE yet.
- FOLLOW-399 (P3, sdk-engineer) — BLOCKED on FOLLOW-355.
- FOLLOW-400 (P2, backend-engineer) — BLOCKED on FOLLOW-031 (not promoted).

**KEY NOTE:** FOLLOW-389 closure confirmed — FOLLOW-409 (PR #367) is merged. RETRO-128 DONE.

---

## Retrospective Spawns

| RETRO     | Source ticket(s) | PR(s) | Status                                                                   |
| --------- | ---------------- | ----- | ------------------------------------------------------------------------ |
| RETRO-091 | FOLLOW-335       | #319  | DONE — verified in RETROSPECTIVES.md (old backfill)                      |
| RETRO-092 | FOLLOW-343       | #321  | DONE — verified in RETROSPECTIVES.md                                     |
| RETRO-108 | FOLLOW-384       | #347  | DONE — verified in RETROSPECTIVES.md                                     |
| RETRO-110 | FOLLOW-387       | #349  | DONE — verified in RETROSPECTIVES.md                                     |
| RETRO-111 | FOLLOW-359       | #350  | DONE — verified in RETROSPECTIVES.md                                     |
| RETRO-112 | FOLLOW-363       | #351  | DONE — verified in RETROSPECTIVES.md                                     |
| RETRO-113 | FOLLOW-341       | #352  | DONE — verified in RETROSPECTIVES.md                                     |
| RETRO-114 | FOLLOW-342       | #353  | DONE — backfilled 2026-06-26                                             |
| RETRO-115 | FOLLOW-357 + 356 | #354  | DONE — backfilled 2026-06-26 (generated FOLLOW-410)                      |
| RETRO-116 | FOLLOW-389       | #355  | DONE — backfilled 2026-06-26 (generated FOLLOW-409)                      |
| RETRO-117 | FOLLOW-361       | #356  | DONE — generated FOLLOW-397                                              |
| RETRO-118 | FOLLOW-358       | #357  | DONE — generated FOLLOW-394/395/396                                      |
| RETRO-119 | FOLLOW-354       | #358  | DONE — generated FOLLOW-398/399                                          |
| RETRO-120 | FOLLOW-362       | #359  | DONE — generated FOLLOW-400/401                                          |
| RETRO-121 | FOLLOW-394       | #360  | DONE — generated FOLLOW-402/403/404                                      |
| RETRO-122 | FOLLOW-397       | #361  | DONE — generated FOLLOW-405                                              |
| RETRO-123 | FOLLOW-396       | #362  | DONE — generated FOLLOW-406/407. Rule V promoted.                        |
| RETRO-124 | FOLLOW-403       | #363  | DONE — no new rule. Watch-item banked.                                   |
| RETRO-125 | FOLLOW-407       | #364  | DONE — generated FOLLOW-411                                              |
| RETRO-126 | FOLLOW-398       | #365  | DONE — verified in RETROSPECTIVES.md                                     |
| RETRO-127 | FOLLOW-410       | #366  | DONE — verified in RETROSPECTIVES.md                                     |
| RETRO-128 | FOLLOW-409       | #367  | DONE — generated FOLLOW-414                                              |
| RETRO-129 | FOLLOW-402       | #368  | DONE — generated FOLLOW-415                                              |
| RETRO-130 | FOLLOW-414       | #369  | DONE — generated FOLLOW-416                                              |
| RETRO-131 | FOLLOW-415       | #370  | DONE — verified in RETROSPECTIVES.md                                     |
| RETRO-132 | FOLLOW-405       | #371  | DONE — generated FOLLOW-418/419/420/421                                  |
| RETRO-133 | FOLLOW-404       | #372  | DONE — generated FOLLOW-422/423/424. ESC-032 filed.                      |
| RETRO-134 | FOLLOW-406/411   | #373  | PENDING — to be spawned                                                  |
| RETRO-135 | FOLLOW-425       | #374  | DONE — generated FOLLOW-426; promoted Rule K.2 fire-and-forget amendment |
| RETRO-136 | FOLLOW-422       | #375  | PENDING — to be spawned                                                  |
| RETRO-131 | FOLLOW-415       | #370  | PENDING — to be spawned                                                  |

---

## Migration status

| Migration       | Scope   | CI             | Prod apply          | Notes                                             |
| --------------- | ------- | -------------- | ------------------- | ------------------------------------------------- |
| 0019 (CH)       | CH      | CI container   | APPLIED ~12:00Z     | page_context_source — ESC-031 RESOLVED 2026-06-26 |
| 0031 (Postgres) | Drizzle | db-migrate.yml | APPLIED (confirmed) | Strip variant='default'; run 28231486742 success  |

---

## CI Gates — Real gates status (last verified 2026-06-26)

Real gates (GREEN): Build, Build (control-plane), Typecheck, Lint, Test (Node 22), SDK E2E, Rule H,
Rule J, ClickHouse migrations smoke, Corpus gate, Tracer query CI guard, Redis shadow round-trip
(soft-skip pending ESC-028), Privacy Notice SDK key-sync, Demo integration, Gitleaks, Migration
journal monotonicity.

Pre-existing FAILURE / NON-BLOCKING: Rule I (~175 violations, FOLLOW-090 baseline), Archetype
embeddings not-NULL (soft-skip until FOLLOW-392 prod seed applied).

---

## ESCALATION STATUS

| ESC     | Status   | Summary                                                                           |
| ------- | -------- | --------------------------------------------------------------------------------- |
| ESC-020 | OPEN     | Estalara-app DOM hooks not deployed to prod (non-blocking)                        |
| ESC-028 | OPEN     | Upstash Redis secrets not provisioned (non-blocking, soft-skip)                   |
| ESC-031 | RESOLVED | P1: adaptation_decisions writes silently failing — migration 0019 applied ~12:00Z |
| ESC-025 | RESOLVED | FOLLOW-366 merged eaf31a9                                                         |
| ESC-026 | RESOLVED | FOLLOW-360 merged 2836adc                                                         |
| ESC-027 | RESOLVED | CEO: page_context; FOLLOW-357+356 DONE PR #354                                    |
| ESC-029 | RESOLVED | CEO approved ChatMessageSentPayloadSchema extension 2026-06-24                    |
| ESC-030 | RESOLVED | CEO Option A; FOLLOW-341 DONE PR #352                                             |
