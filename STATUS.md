# PM Orchestrator Status

**Last updated:** 2026-06-26T23:59Z

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
- `Archetype embeddings not-NULL check`: soft-skips in prod (seeds pending FOLLOW-392).
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
