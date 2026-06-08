# Status — 2026-06-09T00:00Z

_Rule I: a ticket is DONE only if its primary artifact has at least one non-test runtime caller._

## Active sprint: Sprint 16

**12 DONE** (FOLLOW-170/173/174/176/182/183/184/187/190/227/230/234), **1 IN_PROGRESS** (FOLLOW-185
— PG-harness CRM+DSR integration test, delegated to data-engineer 2026-06-09), **1
READY_FOR_REVIEW** (FOLLOW-191 awaiting Rafal deploy ESC-020), **1 READY** (FOLLOW-175 P2 LoRA
export).

### FOLLOW-185 delegation details (IN_PROGRESS as of 2026-06-09)

**Branch:** `data-engineer/FOLLOW-185-pg-harness-crm-dsr`

**Scope:** Integration test for CRM write + DSR cascade + two-writer precedence using PGlite or
Testcontainers harness. Consolidates scope from FOLLOW-181 (RLS isolation) and the already-done
FOLLOW-183 (upsert precedence WHERE + UNIQUE). This ticket focuses on: (a) CRM route write via
`POST /api/crm/outcome` → `conversion_labels` row, (b) DSR cascade: erase by `lead_id` (Pass B from
FOLLOW-184) reaches that CRM-written row, (c) two-writer precedence: SDK feedback ping + CRM webhook
both writing the same `(tenant_id, prediction_id)` converges to expected state.

**CI-check counter:** 0/5 | **Fix-iteration counter:** 0/3

## Currently IN_PROGRESS (1 of 3 max)

- FOLLOW-185 (PG-harness CRM+DSR integration test) — data-engineer, branch:
  data-engineer/FOLLOW-185-pg-harness-crm-dsr. CI-check counter: 0/5 | Fix-iteration counter: 0/3

## Open escalations

| ID      | Age | Description                                                          | Blocking?                           |
| ------- | --- | -------------------------------------------------------------------- | ----------------------------------- |
| ESC-009 | 16d | E2E_BEARER_TOKEN secret not provisioned                              | demo-integration CI soft-skips only |
| ESC-010 | 16d | DOPPLER_TOKEN_DEV not provisioned                                    | doppler-verify CI soft-skips only   |
| ESC-020 | 4d  | Rafal must deploy web-master HEAD + PUBLIC_ESTALARA_SDK_ENABLED=true | FOLLOW-191 final verification only  |

## Sprint 16 status corrections applied 2026-06-09

The following tickets had stale statuses in QUEUE.md (Sprint 16 section). All corrected atomically:

| Ticket     | Old status   | Correct status | PR   | Commit  | Evidence                                                    |
| ---------- | ------------ | -------------- | ---- | ------- | ----------------------------------------------------------- |
| FOLLOW-183 | IN_PROGRESS  | DONE           | #228 | ff3fb8e | `test(data): pg integration test for upsertConversionLabel` |
| FOLLOW-184 | READY (dup.) | DONE           | #233 | 9c91ed8 | Already DONE in Sprint 14 carry-over section                |
| FOLLOW-187 | READY        | DONE           | #229 | e13250b | `feat(compliance): add ROPA activity 15 CRM ingest`         |

## Sprint 16 status corrections applied 2026-06-08

The following tickets were merged but QUEUE.md showed stale statuses. All corrected atomically:

| Ticket     | Old status  | Correct status | PR   | Commit  |
| ---------- | ----------- | -------------- | ---- | ------- |
| FOLLOW-176 | READY       | DONE           | #217 | ea9d59c |
| FOLLOW-182 | IN_PROGRESS | DONE           | #222 | d7b9de7 |
| FOLLOW-174 | BLOCKED     | DONE           | #220 | 31afb16 |
| FOLLOW-190 | READY       | DONE           | #225 | 1d5829a |
| FOLLOW-227 | (new)       | DONE           | #226 | 4d3f1a4 |
| FOLLOW-230 | (new)       | DONE           | #227 | b62faae |

## Sprint 8 Rule I audit (legacy, 2026-05-17)

| Ticket      | Queue status | Rule I status                    |
| ----------- | ------------ | -------------------------------- |
| AB-001      | DONE         | PARTIAL (FOLLOW-007 resolved it) |
| REORDER-001 | DONE         | DONE                             |
| TICKET-046  | DONE         | PARTIAL (FOLLOW-007 resolved it) |
| ARCH-003    | DONE         | DONE                             |
| AGENCY-001  | DONE         | DONE                             |
| AB-004      | DONE         | DONE                             |
