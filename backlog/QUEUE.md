# Backlog Queue

**Updated 2026-06-07 by pm-orchestrator.** **Sprint 13a-hardening-v3 OPEN — FOLLOW-149 (P0 infra
hardening) READY_FOR_REVIEW at PR #166 (https://github.com/Pnawrocki9/Adaptive-Listings/pull/166).**
Triggered by a 2026-05-28 diagnostic that proved the previous "Migration 0015: prd ✅ applied"
bookkeeping was false — drizzle-kit silently generated 2025 timestamps for entries 15/16 (1-year
year-drift, second occurrence after `c92da81`), Drizzle's migrator silently skipped them, and
`migrate.ts` falsely printed "Migrations applied successfully." with zero applied. FOLLOW-149 lands:
(A) journal `when`-values for entries 15/16 repaired to commit-timestamp-aligned 2026 values; (B)
new CI gate `Migration journal monotonicity check` (passing, 7s) — fails on non-monotonic OR >7d
commit-date drift; (C) `migrate.ts` now reports before/after/applied/pending counts AND exits
non-zero with a loud warning when 0 applied but pending>0 (trap-killer); (D) migration 0015 applied
to prd via isolated apply (see ESC-012) — `tenants.pilot_frozen` column verified present
(boolean/default false), `drizzle.__drizzle_migrations` row id=17 hash matches. Migration 0016
INTENTIONALLY NOT applied — its DO $ assertion requires the pilot tenant to exist, and Drizzle's
single-transaction migrator would roll back 0015 alongside it. **ESC-012 OPEN**: `pnpm db:migrate`
is no longer safe in tenant-less envs until TICKET-PILOT-001 either seeds the pilot tenant before
migrate OR migration 0016's RAISE EXCEPTION is softened to NOTICE — data/backend engineers decide
during TICKET-PILOT-001 planning. Rule O added to CONVENTIONS_PATCH.md. RETRO-025 (FOLLOW-143/144
inline fixes) + RETRO-026 (FOLLOW-149) deferred until PR #166 merges. **Sprint 13a-hardening-v2
COMPLETE — 2/2 P0 EU go-live blockers DONE (PR #164 FOLLOW-139 at e4e37ac, PR #165 FOLLOW-141 at
19d11d2; both merged to main). FOLLOW-143 (wire getOrCreateCrossSessionId into init) + FOLLOW-144
(reconcile "rotates monthly" to 90-day cadence across 5 disclosure surfaces) fixed inline in PR
#164. RETRO-025 pending post-FOLLOW-149-merge. FOLLOW-140/142 deferred Sprint 14.** Sprint
13a-hardening COMPLETE — pre-pilot gate CLOSED (4 PRs merged, main at `29c97ab`). The pre-pilot
hardening wave landed its 4 P0/P1 tickets: FOLLOW-127 (P0, PR #161 `6a27841`) detection engine now
populates `inquiry_submit_selector`; FOLLOW-128 (P0, PR #160 `256b469`) DPIA §13.1/§13.2 mandated
consent-banner disclosures shipped in the SDK; FOLLOW-129 (P0, PR #159 `10ae1e7`) tenant Privacy
Notice template + DPO sign-off + consent-withdrawal erasure QA; FOLLOW-122 (P1, PR #162 `29c97ab`)
`/dashboard/pilot` consumes `data_source` provenance + surfaces the fail-loud 500 state. **Net
effect: inquiry tracking is production-ready, EU GDPR compliance is complete, and the pilot
dashboard renders honestly — Sprint 13a Lane B (TICKET-PILOT-001 onboarding) is now READY (gate
closed).** retrospective-analyst to run on PR #159–#162 (RETRO-019→022). **Prior wave — Sprint 13a
Lane A — Wave 3 MERGED + YELLOW audit Sprint 1 MERGED (massive merge wave, main now at `6827305`).**
Wave 3's 5 PRs all on main: FOLLOW-094 (PR #153, `9f32aa8`), FOLLOW-093 (PR #154, `a7d9c03`),
FOLLOW-098 (PR #155, `4ce6e37`), FOLLOW-117 (PR #156, `38a8393`), FOLLOW-114 (PR #157, `f882dae`).
**All of Sprint 13a Lane A is now DONE (8/8); only Lane B remains (BLOCKED → now
unblocked-on-Lane-A, pending CEO spawn go-ahead).** Separately, a **parallel YELLOW audit track**
(F-NN ticket system, NOT in the FOLLOW-NNN sprint plan) landed its Sprint 1 as PR #158 (`6827305`):
F-02 cold-start prior wire, F-09 locale-correct slot copy, F-10 LLM cost attribution, F-13/F-14 GDPR
LIA in DPIA — tracked here as FOLLOW-118/119/120/121 (all DONE). retrospective-analyst to be spawned
on PR #153–#158 (6 retros). **Pilot launch gate now needs BOTH Lane B (TICKET-PILOT-001/002 +
FOLLOW-092) AND YELLOW audit Sprint 2–4.** **Phase 2 Wave 1 MERGED** — FOLLOW-105 (PR #150,
`bf0585d`) DONE: canonical `/api/adapt` enforced, ADR-0006 ACCEPTED, Worker 410 Gone, §Snapshot.7
risk #1 RESOLVED. **Wave 2 (FOLLOW-097 + FOLLOW-106) MERGED** — FOLLOW-097 PR #151 (`3cf05ee`) and
FOLLOW-106 PR #152 (`b83e6c0`) both on main 2026-05-26, all real CI gates were green. **Wave 3
DONE** — spawned 2026-05-26 (CEO go-ahead), merged 2026-05-27, 5 parallel: FOLLOW-094/098/093 +
FOLLOW-114 (P0, RETRO-011) + FOLLOW-117 (RETRO-012). retrospective-analyst spawned on PR #150, #151,
#152. **Sprint 13 OPEN** — three-track structure: Lane A (correctness fixes from RETRO-008/009) →
Lane B (pilot launch on app.estalara.com, blocked until Lane A) → Lane C (Adaptive Listings v1.0
intent build, parallel with Lane B during shadow window). See the Sprint 13 section below. **Sprint
12 COMPLETE as of 2026-05-25** — Lane A hardening (FOLLOW-081/075/078) + Lane C ROI instrumentation
(PILOT-003/004) merged across PRs #142–#146; Lane B (TICKET-PILOT-001/002 pilot onboarding) DEFERRED
to Sprint 13 because RETRO-008/009 surfaced P1 dashboard-correctness blockers that gate go-live;
FOLLOW-079 CANCELLED (split into FOLLOW-088/089/090). RETRO-SPRINT-12 written; Master Design bumped
to v2.8. Sprint 11 COMPLETE as of 2026-05-24 (5 P1 pilot-blockers merged: #135 FOLLOW-063, #136
FOLLOW-069, #137 FOLLOW-068, #138 FOLLOW-040, #139 FOLLOW-039). RETRO-007 written; Master Design
bumped to v2.5; AI Council Checkpoint 2026-05-24 approved Sprint 12 as "controlled pilot launch on
app.estalara.com". Sprint 12 COMPLETE — Lane A hardening + Lane C ROI instrumentation merged; Lane B
pilot onboarding deferred to Sprint 13. Sprint 10 COMPLETE as of 2026-05-23 (8 PRs merged: #127,
#128, #129, #130, #131, #132, #133, #134). RETRO-006 written; Master Design bumped to v2.3; Rule H
amendment applied (CONVENTIONS_PATCH.md). Sprint 9.5 COMPLETE (2026-05-22, 6 PRs: #121, #122, #123,
#124, #125, #126). Sprint 9 COMPLETE as of 2026-05-15: GDPR-001 (PR #111), GDPR-002 (PR #118),
GDPR-003 (PR #116), GDPR-004 (PR #117), DESC-001 (PR #112+#114), VAL-001 (PR #110) — all 6 DONE.
DESC-PIVOT-001 (PR #115) merged. Sprint 7.5 COMPLETE. Sprint 7 COMPLETE. Sprint 8 COMPLETE. Sprint
8.5 COMPLETE. Sprint 2.5 SUPERSEDED — TICKET-030 + TICKET-033 promoted to Sprint 9.5, TICKET-032
superseded by Sprint 7.5 auto-detect, TICKET-034/036 deferred (Q5 decision 2026-05-21), TICKET-035
already CANCELLED. **Sprint 11 P1 pilot-blockers DONE:** FOLLOW-063 (archetype-embedding auto-seed
CI, PR #135), FOLLOW-068 (demo-integration CI, PR #137), FOLLOW-069 (HMAC compat test, PR #136),
FOLLOW-039 (ClickHouse DSR hard-delete — EU pilot gate cleared, PR #139), FOLLOW-040 (Doppler CI
hygiene, PR #138). **Sprint 12 pilot target:** app.estalara.com, EU region, free pilot, primary
metric CTA lift. Krok A document governance reset merged (PR #119, Master_Design v2.0,
docs/ops/OPERATING_PRINCIPLES.md v1.1) — Operating Principles now active for all sessions.
ANTHROPIC_API_KEY activated in Doppler dev/stg/prd 2026-05-21 (Krok B) — AI Vision fully
operational.

**Sprint 15 OPEN — 2026-06-05. Master_Design bumped to v4.0. Based on full codebase audit
(docs/AUDIT-2026-06-04.md). Four tracks + signal enrichment:**

- **Track A (Pilot unblock, Week 1):** FOLLOW-191/192/193/194 — must complete before any real
  traffic
- **Track B (Signal bridges + Quiz v2.0, Week 2–3):** FOLLOW-195/196/197/198/199/200/201/202
- **Track C (Description cache redesign + MOAT, Week 3–4):** FOLLOW-203/204 + Sprint 14 carry-overs
  (FOLLOW-170…176, 190)
- **Track D (Background, Week 4–5):** FOLLOW-205/206, FOLLOW-087, FOLLOW-099
- **Track E (Signal enrichment, Week 2–3, P1/P2, low effort):** FOLLOW-207/208/209/210/211 — Track E
  tickets are low-effort, high-ROI signal enrichments identified in the 2026-06-05 audit gap
  analysis. FOLLOW-210 and FOLLOW-211 are P1 because they unlock categorical discrimination that
  behavioral signals cannot provide without payload context.

Single source of truth for ticket status. Updated by `pm-orchestrator`. Read by everyone.

## How to read this

Each ticket has a one-line entry in the appropriate sprint section. Statuses:

- `BACKLOG` — not yet sprint-planned
- `READY` — can start now
- `BLOCKED` — waiting on dependency
- `IN_PROGRESS` — actively being worked
- `READY_FOR_REVIEW` — PR open, PM-validated, CI green, awaiting human merge
- `DONE` — merged
- `STUCK` — escalation needed
- `CANCELLED` — won't do

Status changes are atomic: PM reads the file, modifies one entry, writes it back. Never partial
updates.

## Sprint progress

| Sprint | Weeks | Theme                                                                                                                               | Tickets | DONE | IN_PROG | READY | BLOCKED |
| ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- | ------- | ----- | ------- |
| 0      | 1     | Foundation (repo, monorepo, CI, scaffolding, secrets, observability)                                                                | 9       | 9    | 0       | 0     | 0       |
| 1      | 2     | Ingest baseline + event schema                                                                                                      | 10      | 10   | 0       | 0     | 0       |
| 2      | 3     | Postgres + tenant auth + dashboard skeleton                                                                                         | 10      | 10   | 0       | 0     | 0       |
| 2.5    | 4     | Auto-Onboarding pipeline (NEW v1.1)                                                                                                 | 6       | 0    | 0       | 1     | 4       |
| 3      | 5     | SDK Tier 1 Observer + Magic Link UI                                                                                                 | 10      | 2    | 0       | 1     | 7       |
| 4      | 6     | Intent ontology v1 + Modal scaffolding                                                                                              | tbd     | —    | —       | —     | tbd     |
| 5      | 7     | LLM gateway + intent extraction from chat (Haiku 4.5 real-time + Sonnet 4.6 batch — decyzja 2026-05-25, patrz FOLLOW-087)           | tbd     | —    | —       | —     | tbd     |
| 6      | 8     | Embeddings + archetype matching + decision API                                                                                      | 3       | 3    | 0       | 0     | 0       |
| 7      | 9     | Decision API real logic + adaptation playbooks                                                                                      | 5       | 5    | 0       | 0     | 0       |
| 7.5    | 9.5   | Auto-Detection Engine                                                                                                               | 7       | 7    | 0       | 0     | 0       |
| 8      | 10    | A/B holdout + re-ranking + agency answers + variants + retro loop                                                                   | 16      | 13   | 0       | 0     | 0       |
| 9      | 11    | DPIA + ROPA + DSR + consent propagation + description pipeline                                                                      | 6       | 6    | 0       | 0     | 0       |
| 9.5    | 11.5  | MVP Demo Readiness (onboarding activation + bandit + scoring)                                                                       | 6       | 6    | 0       | 0     | 0       |
| 10     | 12    | Close the bandit loop + real embeddings + e2e test                                                                                  | 9       | 9    | 0       | 0     | 0       |
| 11     | 13    | Pilot readiness (seed CI, demo CI, HMAC compat, GDPR ClickHouse)                                                                    | 9       | 5    | 0       | 4     | 0       |
| 12     | 14    | Pilot launch on app.estalara.com — COMPLETE (Lane A + Lane C; Lane B → Sprint 13)                                                   | 7       | 5    | 0       | 2     | 0       |
| 13a    | 15    | Correctness + pilot launch (Lane A correctness gate + Lane B pilot launch) — Lane A 8/8 DONE; Lane B READY (gate closed)            | 11      | 8    | 0       | 1     | 2       |
| 13a-h  | 15    | Pre-pilot hardening — inquiry producer (FOLLOW-127), GDPR consent disclosures (FOLLOW-128/129), honest pilot dashboard (FOLLOW-122) | 4       | 4    | 0       | 0     | 0       |
| 13a-h2 | 15    | Pre-pilot hardening v2 — §13.2 localStorage xid erasure (FOLLOW-139), pilot inquiry selector seed (FOLLOW-141)                      | 2       | 2    | 0       | 0     | 0       |
| 13b    | 16    | Adaptive Listings v1.0 intent build (Lane C; parallel under hard isolation per freeze rule)                                         | 6       | 0    | 0       | 3     | 3       |
| Y-S1   | —     | YELLOW audit Sprint 1 (parallel track) — F-02 cold-start, F-09 locale copy, F-10 LLM attribution, F-13/F-14 GDPR LIA (PR #158)      | 4       | 4    | 0       | 0     | 0       |
| 15     | 17    | Pilot unblock + signal bridges + quiz v2.0 + description cache redesign + signal enrichment (audit 2026-06-04, MD v4.0)             | 21      | 8    | 0       | 13    | 0       |

**Sprint 2.5 is new — added in Paczka 2 based on Master Design v1.1 sections B.4-B.7
(auto-onboarding).**

Detailed tickets for Sprints 0–3 in Paczka 2 (this delivery). Sprints 4–11 ship in Paczka 3.

## Active sprint: Sprint 0 — Foundation (COMPLETE)

```yaml
- id: TICKET-001
  title: Bootstrap monorepo (Turborepo + pnpm + tooling)
  agent: devops-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  completed_at: 2026-04-26T18:15:00Z
  pr: '#2'
  spec: backlog/sprint-0/TICKET-001.md

- id: TICKET-002
  title: Doppler integration + secrets management baseline
  agent: devops-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-001]
  assigned_to: devops-engineer
  started_at: '2026-04-27T00:00:00Z'
  pr: '#4'
  completed_at: '2026-04-27T07:30:00Z'
  spec: backlog/sprint-0/TICKET-002.md

- id: TICKET-003
  title: Sentry + OpenTelemetry baseline instrumentation
  agent: devops-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-001]
  assigned_to: devops-engineer
  started_at: '2026-04-27T14:40:00Z'
  completed_at: '2026-04-27T19:30:00Z'
  pr: '#7'
  spec: backlog/sprint-0/TICKET-003.md

- id: TICKET-004
  title: Pre-commit security hooks (Lefthook + git-secrets + commit lint)
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-001]
  assigned_to: devops-engineer
  started_at: '2026-04-29T00:00:00Z'
  completed_at: '2026-04-29T14:18:07Z'
  pr: 'devops-engineer/TICKET-004-precommit-security'
  spec: backlog/sprint-0/TICKET-004.md

- id: TICKET-005
  title: Add apps/auto-detect Python placeholder app (NEW v1.1)
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-001]
  assigned_to: devops-engineer
  started_at: '2026-04-29T14:20:00Z'
  completed_at: '2026-04-29T16:45:00Z'
  pr: '#10'
  spec: backlog/sprint-0/TICKET-005.md

- id: TICKET-006
  title: Add packages/platform-templates TS placeholder (NEW v1.1)
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-001]
  assigned_to: devops-engineer
  started_at: '2026-04-29T16:50:00Z'
  completed_at: '2026-04-29T17:15:00Z'
  pr: '#11'
  spec: backlog/sprint-0/TICKET-006.md

- id: TICKET-007
  title: Update README + CLAUDE.md to reflect 10 apps / 10 packages
  agent: architect
  status: DONE
  priority: P2
  estimated_hours: 1
  depends_on: [TICKET-005, TICKET-006]
  assigned_to: architect
  started_at: '2026-04-29T17:30:00Z'
  completed_at: '2026-04-29T17:50:00Z'
  pr: '#12'
  spec: backlog/sprint-0/TICKET-007.md

- id: TICKET-008
  title: Cloudflare account setup + Wrangler Terraform module
  agent: devops-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-001, TICKET-002]
  assigned_to: devops-engineer
  started_at: '2026-04-29T18:00:00Z'
  completed_at: '2026-04-29T16:29:05Z'
  pr: '#14'
  spec: backlog/sprint-0/TICKET-008.md

- id: TICKET-009
  title:
    Vendor account stubs (Supabase + ClickHouse + Modal + Redpanda + Upstash) Terraform skeleton
  agent: devops-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-001, TICKET-002]
  assigned_to: devops-engineer
  started_at: '2026-04-27T08:00:00Z'
  completed_at: '2026-04-27T19:30:00Z'
  pr: '#6'
  spec: backlog/sprint-0/TICKET-009.md
```

## Sprint 1 — Ingest baseline + event schema (COMPLETE)

```yaml
- id: TICKET-010
  title: ADR-0003 Event schema design and versioning strategy (already drafted)
  agent: architect
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: [TICKET-009]
  started_at: '2026-04-29T19:00:00Z'
  completed_at: '2026-04-30T21:12:50Z'
  pr: '#16'
  spec: backlog/sprint-1/TICKET-010.md

- id: TICKET-011
  title: Zod schemas in packages/shared for all event types (envelope + 30 type schemas)
  agent: architect
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-010]
  started_at: '2026-04-30T21:30:00Z'
  completed_at: '2026-04-30T21:45:29Z'
  pr: '#17'
  spec: backlog/sprint-1/TICKET-011.md

- id: TICKET-012
  title: Cloudflare Worker ingest MVP (validate + auth + push to Redpanda)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-011]
  started_at: '2026-04-30T23:30:00Z'
  completed_at: '2026-05-01T00:30:00Z'
  pr: '#18'
  spec: backlog/sprint-1/TICKET-012.md

- id: TICKET-013
  title: Durable Object rate limiting per tenant per minute
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-012]
  started_at: '2026-05-01T00:30:00Z'
  completed_at: '2026-04-30T22:39:52Z'
  pr: '#19'
  spec: backlog/sprint-1/TICKET-013.md

- id: TICKET-014
  title: ClickHouse table DDL + first migration (events table partitioned)
  agent: data-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-009, TICKET-011]
  started_at: '2026-05-03T00:00:00Z'
  completed_at: '2026-05-03T15:21:11Z'
  pr: '#27'
  spec: backlog/sprint-1/TICKET-014.md

- id: TICKET-015
  title: Stream consumer Modal scaffold (Redpanda subscribe → ClickHouse insert)
  agent: data-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-014, TICKET-012]
  started_at: '2026-05-03T00:00:00Z'
  completed_at: '2026-05-03T20:58:07Z'
  pr: '#29'
  spec: backlog/sprint-1/TICKET-015.md

- id: TICKET-016
  title: End-to-end smoke test (curl ingest → ClickHouse query)
  agent: qa-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-015]
  started_at: '2026-05-03T00:00:00Z'
  completed_at: '2026-05-03T13:55:37Z'
  pr: '#26'
  spec: backlog/sprint-1/TICKET-016.md

- id: TICKET-017
  title: Ingest load test 10K req/s (k6 scripts)
  agent: qa-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-016]
  completed_at: '2026-05-04T00:00:00Z'
  pr: '#37'
  spec: backlog/sprint-1/TICKET-017.md

- id: TICKET-018
  title: Ingest observability (OTel traces + Sentry + structured logs)
  agent: devops-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-012, TICKET-003]
  completed_at: '2026-05-03T10:51:21Z'
  pr: '#22, #24, #25'
  spec: backlog/sprint-1/TICKET-018.md

- id: TICKET-019
  title: HTTP error handling + idempotency contract (event_id deduplication)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-012]
  completed_at: '2026-05-01T21:37:20Z'
  pr: '#24'
  spec: backlog/sprint-1/TICKET-019.md
```

## Sprint 2 — Postgres + tenant auth + dashboard skeleton (COMPLETE)

```yaml
- id: TICKET-020
  title: Drizzle ORM setup + migrations folder structure + tooling
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-009]
  completed_at: '2026-05-04T12:00:00Z'
  pr: '#36'
  spec: backlog/sprint-2/TICKET-020.md

- id: TICKET-021
  title: tenants table schema + RLS policies + auto-onboarding fields (v1.1)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 5
  depends_on: [TICKET-020]
  completed_at: '2026-05-04T14:00:00Z'
  pr: '#38'
  spec: backlog/sprint-2/TICKET-021.md

- id: TICKET-022
  title: users table + tenant membership + Supabase Auth sync
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-021]
  completed_at: '2026-05-04T16:00:00Z'
  pr: '#39'
  spec: backlog/sprint-2/TICKET-022.md

- id: TICKET-023
  title: API key model (public + secret keys, HMAC-SHA256, rotation)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 5
  depends_on: [TICKET-021]
  completed_at: '2026-05-04T18:00:00Z'
  pr: '#40'
  spec: backlog/sprint-2/TICKET-023.md

- id: TICKET-024
  title: JWT signing + tenant scoping middleware (Hono + Next.js)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 5
  depends_on: [TICKET-022, TICKET-023]
  completed_at: '2026-05-04T20:00:00Z'
  pr: '#42'
  spec: backlog/sprint-2/TICKET-024.md

- id: TICKET-025
  title: apps/control-plane Next.js skeleton + Tailwind + shadcn/ui setup
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-001, TICKET-002]
  started_at: '2026-05-01T00:00:00Z'
  completed_at: '2026-05-01T10:46:13Z'
  pr: '#20'
  spec: backlog/sprint-2/TICKET-025.md

- id: TICKET-026
  title: Tenant signup flow (skeleton — wizard frame, no auto-detect yet)
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 6
  depends_on: [TICKET-024, TICKET-025]
  completed_at: '2026-05-04T22:00:00Z'
  pr: '#43'
  spec: backlog/sprint-2/TICKET-026.md

- id: TICKET-027
  title: Dashboard authenticated layout (sidebar + header + route guards)
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-024, TICKET-025]
  completed_at: '2026-05-05T00:00:00Z'
  pr: '#44'
  spec: backlog/sprint-2/TICKET-027.md

- id: TICKET-028
  title: Tenant overview page (empty state, placeholder for live metrics)
  agent: backend-engineer
  status: DONE
  priority: P2
  estimated_hours: 3
  depends_on: [TICKET-027]
  completed_at: '2026-05-05T00:00:00Z'
  pr: '#44'
  spec: backlog/sprint-2/TICKET-028.md

- id: TICKET-029
  title: Stripe billing webhook stub + usage_metering table
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-021]
  completed_at: '2026-05-04T21:00:00Z'
  pr: '#41'
  spec: backlog/sprint-2/TICKET-029.md
```

## Sprint 2.5 — Auto-Onboarding pipeline (NEW v1.1) (BLOCKED)

```yaml
- id: TICKET-030
  title: Magic Link onboarding wizard UI (NEW v1.1)
  agent: backend-engineer
  status: READY
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-024, TICKET-025]
  spec: backlog/sprint-2.5/TICKET-030.md

- id: TICKET-032
  title: AI Vision Auto-Detect pipeline (Claude Sonnet 4.6 Vision)
  agent: ml-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 10
  depends_on: [TICKET-030]
  spec: backlog/sprint-2.5/TICKET-032.md

- id: TICKET-033
  title: Schema Discovery API endpoint (POST /api/tenants/:id/schema-discover)
  agent: backend-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-032]
  spec: backlog/sprint-2.5/TICKET-033.md

- id: TICKET-034
  title: Platform templates library (packages/platform-templates)
  agent: ml-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 6
  depends_on: [TICKET-033]
  spec: backlog/sprint-2.5/TICKET-034.md

- id: TICKET-035
  title: Continuous schema validation cron (SUPERSEDED by TICKET-VAL-001)
  agent: data-engineer
  status: CANCELLED
  priority: P1
  estimated_hours: 0
  depends_on: [TICKET-034]
  spec: backlog/sprint-2.5/TICKET-035.md
  notes: |
    Duplicate scope with TICKET-VAL-001 (Sprint 9). Canonical implementation lives there
    because its dependency chain (TICKET-AUTO-006 only, DONE) is shorter and unblocked
    sooner than the Sprint 2.5 chain (030 → 032 → 033 → 034 → 035, ~30h prerequisite).
    Decision: Piotr 2026-05-14. Spec file retained for reference but ticket = CANCELLED.

- id: TICKET-036
  title: Pre-built platform templates (MLS, Zillow-style, custom)
  agent: ml-engineer
  status: BLOCKED
  priority: P2
  estimated_hours: 6
  depends_on: [TICKET-034]
  spec: backlog/sprint-2.5/TICKET-036.md
```

## Sprint 3 — SDK Tier 1 Observer + Magic Link UI (IN PROGRESS)

```yaml
- id: TICKET-031
  title: SDK Tier 1 core — config, session, events, observer
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-011]
  completed_at: '2026-05-05T01:25:00Z'
  pr: '#50'
  spec: backlog/sprint-3/TICKET-031.md

- id: TICKET-037
  title: SDK Shadow DOM mount + Tier 1 sidebar widget
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-031]
  spec: backlog/sprint-3/TICKET-037.md
  pr: '#98'
  merged_at: '2026-05-14'

- id: TICKET-038
  title: SDK tsup build + bundle size gate (<40KB gzip)
  agent: sdk-engineer
  status: READY
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-031]
  spec: backlog/sprint-3/TICKET-038.md

- id: TICKET-039
  title: SDK integration tests (Playwright + host page fixture)
  agent: qa-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-037, TICKET-038]
  spec: backlog/sprint-3/TICKET-039.md

- id: TICKET-040
  title: Magic Link onboarding wizard UI (Sprint 3 phase)
  agent: backend-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-030]
  spec: backlog/sprint-3/TICKET-040.md

- id: TICKET-041
  title: Consent banner component (GDPR/CCPA)
  agent: sdk-engineer
  status: DONE
  priority: P1
  estimated_hours: 6
  depends_on: [TICKET-037]
  spec: backlog/sprint-3/TICKET-041.md
  pr: '#113'
  completed_at: '2026-05-15T09:08:41Z'

- id: TICKET-042
  title: Decision API integration in SDK (fetch adapt directives)
  agent: sdk-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-037, TICKET-024]
  spec: backlog/sprint-3/TICKET-042.md

- id: TICKET-043
  title: SDK npm publish pipeline (GitHub Actions + changesets)
  agent: devops-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-038]
  spec: backlog/sprint-3/TICKET-043.md

- id: TICKET-044
  title: SDK demo integration (embed on demo listing page)
  agent: sdk-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-037, TICKET-DEMO-002]
  spec: backlog/sprint-3/TICKET-044.md

- id: TICKET-045
  title: E2E test — full observer flow (page.view → scroll → cta.clicked)
  agent: qa-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-039]
  spec: backlog/sprint-3/TICKET-045.md
```

## Sprint 6 — Embeddings + archetype matching + decision API (DONE)

```yaml
- id: TICKET-ARCH-001
  title: Expand archetype ontology — 3 → 18 archetypes
  agent: ml-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  completed_at: '2026-05-11T00:00:00Z'
  commit: f0aca06
  spec: (inline — merged directly to main)

- id: TICKET-EMB-001
  title: Embeddings pipeline — pgvector + fingerprint matching
  agent: ml-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-ARCH-001]
  completed_at: '2026-05-11T00:00:00Z'
  commit: be4e366
  spec: (inline — merged directly to main)

- id: TICKET-DB-001
  title: Replace API stubs with real Drizzle DB queries in control-plane
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-EMB-001]
  completed_at: '2026-05-11T00:00:00Z'
  commit: c69ee9c
  spec: (inline — merged directly to main)
```

## Sprint 7 — Decision API real logic + adaptation playbooks (COMPLETE)

```yaml
- id: TICKET-ADP-001
  title: Decision API real logic — replace GET /api/adapt stub with full decision tree
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 10
  depends_on: [TICKET-ARCH-001, TICKET-EMB-001, TICKET-DB-001]
  assigned_to: backend-engineer
  started_at: '2026-05-11T00:00:00Z'
  completed_at: '2026-05-11T20:36:18Z'
  pr: '#67'
  spec: backlog/sprint-7/TICKET-ADP-001.md

- id: TICKET-ADP-003
  title: Adaptation playbooks — pre-computed directives for all 18 archetypes
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-ADP-001]
  assigned_to: sdk-engineer
  started_at: '2026-05-11T20:36:18Z'
  completed_at: '2026-05-11T22:00:00Z'
  pr: '#68'
  commit: ecf5d4b
  spec: backlog/sprint-7/TICKET-ADP-003.md

- id: TICKET-ADP-004
  title: SDK Tier 1 DOM mutations — full applyDirectives() implementation
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 10
  depends_on: [TICKET-ADP-003]
  assigned_to: sdk-engineer
  started_at: '2026-05-12T06:00:00Z'
  completed_at: '2026-05-12T21:33:43Z'
  pr: '#69'
  commit: 82f0e42
  spec: backlog/sprint-7/TICKET-ADP-004.md

- id: TICKET-ADP-002
  title: LiteLLM gateway — Haiku/Sonnet routing for Decision API
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-ADP-004]
  assigned_to: backend-engineer
  started_at: '2026-05-12T08:30:00Z'
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#70'
  commit: e9ccde4
  spec: backlog/sprint-7/TICKET-ADP-002.md

- id: TICKET-DQS-001
  title: Convergence metrics — DqsTracker + session.quality.snapshot + ClickHouse DDL
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-ADP-004]
  assigned_to: data-engineer
  started_at: '2026-05-12T08:30:00Z'
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#71'
  commit: 7678aa3
  spec: backlog/sprint-7/TICKET-DQS-001.md
```

## Sprint 7.5 — Auto-Detection Engine (COMPLETE)

```yaml
- id: TICKET-AUTO-001
  title: Auto-detection corpus — 24 platform fixtures + CI gate skeleton
  agent: qa-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#72'
  commit: 7400d63
  spec: docs/specs/SPRINT_7_5_SPEC.md

- id: TICKET-AUTO-002
  title: TenantSiteSchema types + detection pipeline skeleton
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-AUTO-001]
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#73'
  commit: 76c2c88
  spec: docs/specs/SPRINT_7_5_SPEC.md

- id: TICKET-AUTO-003
  title: Auto-detection techniques 1–6 (deterministic pipeline)
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-AUTO-002]
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#74'
  commit: f6f4e15
  spec: docs/specs/SPRINT_7_5_SPEC.md

- id: TICKET-AUTO-004
  title: Auto-detection techniques 7–11 + price parser + Detection Preview API + UI skeleton
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 10
  depends_on: [TICKET-AUTO-003]
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#77'
  commit: eb463ab
  spec: docs/specs/SPRINT_7_5_SPEC.md
  note: AUTO-006 backend + UI skeleton bundled into this PR per Piotr approval (2026-05-13)

- id: TICKET-AUTO-005
  title: Corpus CI gate — precision/recall validation (100%/100% on own corpus)
  agent: qa-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-AUTO-004]
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#79'
  commit: cfecf50
  spec: docs/specs/SPRINT_7_5_SPEC.md

- id: TICKET-AUTO-006
  title: Detection Preview UI + tenant_site_schemas table
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 6
  depends_on: [TICKET-AUTO-002]
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#77'
  commit: eb463ab
  spec: docs/specs/SPRINT_7_5_SPEC.md
  note: |
    Bundled into AUTO-004 PR (#77) per Piotr approval.
    Three carve-outs deferred to TICKET-AUTO-006-POLISH (P2, BACKLOG):
    - Screenshot capture + colored-box overlay
    - Manual inline selector editing
    - Explicit "Save & activate" button (server-side auto-upsert already works)

- id: TICKET-AUTO-007
  title: Archetype hints from site structure — Bayesian prior seeding
  agent: ml-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-AUTO-003]
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#76'
  commit: 5c36aaf
  spec: docs/specs/SPRINT_7_5_SPEC.md
```

## Polish / Carve-out tickets (BACKLOG)

```yaml
- id: TICKET-AUTO-006-POLISH
  title:
    Detection Preview UI — screenshot overlay + manual selector editing + Save & activate button
  agent: backend-engineer
  status: BACKLOG
  priority: P2
  estimated_hours: 4
  depends_on: [TICKET-AUTO-006]
  notes: |
    Three carve-outs from AUTO-006 that were deferred at Piotr's approval (2026-05-13):
    1. Screenshot capture + colored-box overlay (page.tsx:387 comment "visual overlay available
       after AUTO-004" — that condition is now met, just needs wiring).
    2. Manual inline selector editing (currently alert() at page.tsx:346).
    3. Explicit "Save & activate" button (currently alert() at page.tsx:356).
       Note: server-side auto-upsert already persists schemas (route.ts:222-247), so
       only the explicit user-action UX is missing.
    Non-blocking for Sprint 8. Schedule after Sprint 8 or as filler if a Sprint 8 slot opens.
```

## Sprint 8 — A/B holdout + re-ranking + agency answers + variants + retro loop (COMPLETE)

**Status:** COMPLETE as of 2026-05-14. 6/6 core tickets DONE + 7 FIX tickets DONE (PR #85-90).
AB-001 (PR #80), REORDER-001 (PR #91), TICKET-046 (PR #92), AGENCY-001 (PR #97), AB-004 (PR #99),
ARCH-003 (PR #95). FAIR-001 CANCELLED. NATIVE-001 deferred to MVP launch. CAUSAL-001 BACKLOG.

**Sprint 8 entry condition:** Sprint 7 DONE + Sprint 7.5 DONE. Both satisfied as of 2026-05-13.

```yaml
- id: TICKET-AB-001
  title: A/B holdout framework — consent-aware 10% holdout + Thompson sampling bandit
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-05-13T12:00:00Z'
  completed_at: '2026-05-14T00:00:00Z'
  priority: P0
  estimated_hours: 10
  depends_on: [TICKET-DQS-001, TICKET-ADP-002]
  pr: '#80'
  commit: 0e5cc0c
  spec: backlog/sprint-8/TICKET-AB-001.md
  notes: |
    Implements Master Design E.3 + E.3.1 + E.3.2.
    Core: assign sessions to treatment/holdout (default 10%) at Decision API layer.
    Consent-aware: holdout assignment must respect existing consent_state field on events.
    Fair-housing constraint: holdout assignment MUST NOT segment by protected characteristics
    (race, national origin, family status per FHA). Assignment is purely random, keyed on
    session_id hash. TICKET-FAIR-001 is CANCELLED — not required at this stage.
    Produces: holdout_group boolean on adaptation_decisions ClickHouse table.
    Thompson sampling bandit: select best adaptation variant per archetype based on
    rolling conversion lift (multi-armed bandit, Thompson sampling per Master Design E.3).
    Regression detection: if archetype X has stat-significant drop over 7 days → auto-pause
    + Sentry alert.

- id: TICKET-REORDER-001
  title: ReorderDirective implementation — listing grid re-ranking per archetype
  agent: sdk-engineer
  status: DONE
  completed_at: '2026-05-14T00:00:00Z'
  pr: '#91'
  commit: 40650aa
  priority: P0
  estimated_hours: 10
  depends_on: [TICKET-AUTO-002, TICKET-ADP-004]
  notes: |
    Unblocked 2026-05-13 — archetypes are behavioral, not demographic; no FAIR-001 needed at this stage.
    Implements Master Design B.9.2 + E.2 (feature highlight order).
    ReorderDirective stub is already in packages/shared/src/directives.ts (Sprint 7.5 hook).
    container_selector + data_extractors_per_card + reorder_capable are in TenantSiteSchema.
    SDK applyDirectives() must handle ReorderDirective: read container_selector, query
    child nodes, sort by archetype-specific score (passed in the directive), re-inject into DOM.
    similar_listings_selector (DetailSchema) enables "Properties you might also like" injection
    on detail pages — include as a stretch goal in this ticket or split to REORDER-002.
    Requires: corpus CI gate stays green after DOM reorder changes (rerun pnpm test:corpus).

- id: TICKET-046
  title: Playbook variants — 3 copy variants + copy_template for all 18 archetypes
  agent: sdk-engineer
  status: DONE
  completed_at: '2026-05-14T00:00:00Z'
  pr: '#92'
  commit: b6368b6
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-ADP-003]
  notes: |
    Adds SlotDirective.variants (3 copy alternatives per slot for A/B) and
    PlaybookEntry.copy_template (static ~150-word description fallback per archetype).
    Fixes feature-section → feature slot name in yield-hunter + llm-gateway.ts prompt.
    18 archetypes × 3 variants + copy_template.en. All 17 non-neutral archetypes complete.

- id: TICKET-AGENCY-001
  title: Agency answers — per-listing FAQ with RAG-powered suggested replies
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-ADP-001]
  pr: '#97'
  merged_at: '2026-05-14'
  notes: |
    Implements Master Design E.2 chat.suggested_reply row: "Claude Haiku 4.5 + RAG over
    tenant FAQ + listing data + intent context".
    Backend: POST /api/tenants/:id/answers — CRUD for per-listing Q&A pairs stored in Postgres.
    RAG pipeline: at adapt time, retrieve top-3 FAQ answers (pgvector cosine similarity on
    question embedding vs intent vector), inject into Haiku 4.5 prompt as context.
    Dashboard UI: /dashboard/listings/:id/answers — agency staff adds/edits FAQ entries.
    Placeholder resolution: answers feed Level 2 in the E.6 placeholder resolution order
    (already typed in MASTER_DESIGN_PATCH_v1_5.md as "Agency-provided answers per listing").
    Produces: answers table schema migration + /api/answers route + dashboard page.
    Completed 2026-05-14: all AC items done, 213/213 tests passing, lint/typecheck/build green.

- id: TICKET-FAIR-001
  title: Fair-housing linter MVP — gate for Profile Mode activation (U.11.6)
  agent: compliance-engineer
  status: CANCELLED
  priority: P1
  estimated_hours: 6
  depends_on: [TICKET-AB-001]
  cancelled_at: '2026-05-13'
  cancelled_by: Piotr Nawrocki
  cancel_reason: |
    Not required at this stage — archetype space is purely behavioral, no protected-class signals
    collected. Re-open if demographic or proxy-demographic signals are ever proposed for the
    archetype space. See ESCALATIONS.md resolution for full rationale and the binding caveat.
  notes: |
    Required by Master Design U.11.6 and E.3.2 (brand_safety_score in multi-objective
    optimization). Must be live before first Profile Mode activation (Sprint 12+).
    Linter validates adaptation directives against fair-housing rules:
    - US: FHA protected classes (race, color, religion, national origin, sex, disability,
      familial status) — no steering, no discriminatory framing in headlines/features.
    - UK: Equality Act 2010 protected characteristics.
    - EU: anti-discrimination directives.
    Implementation: rule-based keyword + semantic classifier on generated text directives.
    Output: brand_safety_score (0.0–1.0) fed into multi-objective optimization (E.3.2).
    CI gate: adaptation playbook tests must pass fair-housing lint before merge.
    IMPORTANT: compliance-engineer must escalate if linter rules conflict with any existing
    playbook content — do not silently modify playbooks.

- id: TICKET-AB-004
  title: Analytics dashboard — conversion lift + archetype breakdown + holdout comparison
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-AB-001, TICKET-DQS-001]
  pr: '#99'
  merged_at: '2026-05-14'
  notes: |
    Implements the dashboard mockup in Master Design Q.3 (Idealista Week 1 view).
    Data source: ClickHouse adaptation_decisions table (from TICKET-ADP-001 migration) +
    DQS session snapshots (from TICKET-DQS-001).
    Required panels:
    - Traffic summary (tracked sessions, adapted impressions, holdout impressions, p95 latency)
    - Buyer archetype breakdown (top 10 of N detected, % of traffic)
    - Conversion lift vs holdout (photo engagement, time-on-listing, inquiry started,
      inquiry completed, tour requested)
    - Top-performing adaptation types
    - Anomaly feed (auto-paused archetypes with regression detected)
    Route: /dashboard/analytics (new page in control-plane).
    Uses DQS data already shipped in TICKET-DQS-001 — no new ClickHouse DDL needed.
    Implementation: 9 files added/modified. 125 tests pass (net +44 vs baseline).
    vitest.config.ts source aliases fixed 7 pre-existing test failures.
    gh CLI not available in environment — PR must be opened by PM via git push.

- id: TICKET-NATIVE-001
  title: app.estalara.com Adaptive Listings native integration (Tier 3 data-estalara-* attributes)
  agent: sdk-engineer
  status: BLOCKED
  block_reason: |
    Deferred to MVP launch — requires CTO/CPO scheduling on the SvelteKit side. Will be scheduled
    separately. Decision by Piotr Nawrocki 2026-05-13.
  priority: P1
  estimated_hours: 6
  depends_on: [TICKET-REORDER-001, TICKET-AB-011]
  notes: |
    Implements Master Design B.9 + B.9.3.
    Rafał (CTO) adds data-estalara-* attributes to SvelteKit components (ListingCard.svelte,
    detail page). This ticket wires the SDK init in +layout.svelte and validates the full
    Tier 3 Native flow against the corpus CI gate (000-app-estalara fixture).
    Key edge case: H1 = price on detail pages (B.9.1) — SDK must handle tagline slot above H1.
    AI Topics reordering (B.9.2): ReorderDirective drives tag reorder per archetype
    (yield_hunter → Rental/ROI/Transport first; family_buyer → Schools/Parks first).
    Live Session CTA per archetype: archetype-specific CTA text injected via TextDirective.
    NOTE: CTO/CPO approval required on slot mapping before implementation starts. Flag in
    ticket spec when authored.

- id: TICKET-ARCH-003
  title: Per-ticket retrospective learning loop + /retro slash command
  agent: architect
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: []
  pr: '#95'
  completed_at: '2026-05-14T14:21:36Z'
  spec: backlog/sprint-8/TICKET-RETRO-001.md
  notes: |
    Creates retrospective-analyst agent (Opus 4.7), backlog/RETROSPECTIVES.md,
    backlog/FOLLOW_UPS.md, CONVENTIONS_PATCH.md. PM Step 7 auto-spawns analyst after each
    ticket DONE. /retro slash command for manual retroactive invocation. Seeds RETRO-001
    (TICKET-046 analysis).

- id: TICKET-FIX-013
  title: JWT signature verification — HMAC-SHA-256 verify before trusting payload
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  pr: '#86'
  completed_at: '2026-05-14T00:00:00Z'
  spec: backlog/sprint-8/TICKET-FIX-013.md

- id: TICKET-FIX-014
  title: Tenant header spoofing — derive tenant_id from verified JWT, not x-tenant-id header
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  pr: '#87'
  completed_at: '2026-05-14T00:00:00Z'
  spec: backlog/sprint-8/TICKET-FIX-014.md

- id: TICKET-FIX-015
  title: SDK ↔ decision-api contract — AdaptRequestSchema accepts confidence/similarity
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 2
  pr: '#85'
  completed_at: '2026-05-14T00:00:00Z'
  spec: backlog/sprint-8/TICKET-FIX-015.md

- id: TICKET-FIX-016
  title: Demo mockup page non-functional — fix POST /api/adapt demo endpoint
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  pr: '#87'
  completed_at: '2026-05-14T00:00:00Z'
  spec: backlog/sprint-8/TICKET-FIX-016.md

- id: TICKET-FIX-017
  title: Auth gate on GET /api/adapt — require API key before serving directives
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  pr: '#90'
  completed_at: '2026-05-14T00:00:00Z'
  spec: backlog/sprint-8/TICKET-FIX-017.md

- id: TICKET-FIX-018
  title: Wire RLS JWT token in createTenantClient — enforce row-level security
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  pr: '#89'
  completed_at: '2026-05-14T00:00:00Z'
  spec: backlog/sprint-8/TICKET-FIX-018.md

- id: TICKET-FIX-019
  title: Idempotency cache key must include tenant_id — scope dedup per tenant
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  pr: '#88'
  completed_at: '2026-05-14T00:00:00Z'
  spec: backlog/sprint-8/TICKET-FIX-019.md

- id: TICKET-CAUSAL-001
  title: Causal inference framework — CATE estimation + HTE per archetype (R.2 patent angle)
  agent: ml-engineer
  status: BACKLOG
  priority: P2
  estimated_hours: 12
  depends_on: [TICKET-AB-001]
  notes: |
    Implements Master Design E.3.1 + R.2.
    T-Learner / X-Learner (EconML) + causal forests (DoWhy) for CATE estimation.
    Auto-pause archetypes where CATE_CTR ~= 0% after 1000+ sessions (saves 20-30% LLM cost).
    Sequential hypothesis testing (Wald SPRT) for early stopping.
    Tech stack: EconML (Microsoft), DoWhy, PyMC for long-tail archetypes.
    Modal Python app — runs as offline daily batch job.
    P2 priority: do not start until AB-001 has real holdout data (minimum 2 weeks in production).
    Feeds D.5 confirmation rate dashboard.
```

## Sprint 8.5 — A/B wiring sprint — COMPLETE (5/5 DONE across PR #106 + #107 + #108)

**Status:** COMPLETE as of 2026-05-14. All 5 tickets DONE across 3 PRs.

```yaml
- id: TICKET-AB-005
  title: Emit ab.assignment event from decision-api on every non-skipped assignment
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-AB-001]
  pr: '#106'
  completed_at: '2026-05-14T20:45:17Z'
  commit: 6d78af72fc
  spec: backlog/sprint-9/TICKET-AB-005.md
  promoted_from: FOLLOW-006

- id: TICKET-AB-006
  title: Seed ab_bandit_weights — 18 archetype rows × variant='default' per tenant
  agent: data-engineer
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: [TICKET-AB-001]
  pr: '#107'
  completed_at: '2026-05-14T20:37:06Z'
  commit: 1d21f7d354
  spec: backlog/sprint-9/TICKET-AB-006.md
  promoted_from: FOLLOW-008

- id: TICKET-AB-007
  title: Wire holdout_group into ClickHouse adaptation_decisions insert path
  agent: data-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-AB-006]
  pr: '#107'
  completed_at: '2026-05-14T20:37:06Z'
  commit: 1d21f7d354
  spec: backlog/sprint-9/TICKET-AB-007.md
  promoted_from: FOLLOW-010

- id: TICKET-AB-008
  title: Replace mock /api/ab/weights with real Drizzle reads
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-AB-006]
  pr: '#108'
  completed_at: '2026-05-14T21:16:31Z'
  commit: 08d46d94d3
  spec: backlog/sprint-9/TICKET-AB-008.md
  promoted_from: FOLLOW-014

- id: TICKET-AB-009
  title: Wire ReorderDirective into production decision-api Worker route
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: []
  pr: '#108'
  completed_at: '2026-05-14T21:16:31Z'
  commit: 08d46d94d3
  spec: backlog/sprint-9/TICKET-AB-009.md
  promoted_from: FOLLOW-015

- id: TICKET-AB-010
  title: holdout gating + consent skip on control-plane POST /api/adapt
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: [TICKET-AB-005, TICKET-AB-009]
  pr: '#109'
  completed_at: '2026-05-14T21:53:13Z'
  commit: ea76cdb480
  spec: backlog/sprint-9/TICKET-AB-010.md
  promoted_from: FOLLOW-017

- id: TICKET-AB-011
  title: getTenantSchema() real DB lookup + Redis cache (replace est_demo_tenant hardcode)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-AB-010]
  pr: '#109'
  completed_at: '2026-05-14T21:53:13Z'
  commit: ea76cdb480
  spec: backlog/sprint-9/TICKET-AB-011.md
  promoted_from: FOLLOW-018
```

## Sprint 9 — DPIA + DSR + consent + description pipeline (COMPLETE)

**Status:** COMPLETE as of 2026-05-15. All 6 tickets DONE. Wave A: GDPR-001 (PR #111), VAL-001 (PR
#110), TICKET-041 (PR #113), DESC-001 (PR #112+#114). Wave B: GDPR-002 (PR #118), GDPR-003 (PR
#116), GDPR-004 (PR #117). DESC-PIVOT-001 v1.7.1 (PR #115) also merged in Sprint 9 cycle.

```yaml
- id: TICKET-GDPR-001
  title: DPIA + ROPA documents (EU/UK/CA/UAE)
  agent: compliance-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: []
  pr: '#111'
  completed_at: '2026-05-15'
  spec: backlog/sprint-9/TICKET-GDPR-001.md

- id: TICKET-GDPR-002
  title: DSR endpoints (access / erase / portability)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-GDPR-001]
  pr: '#118'
  completed_at: '2026-05-15'
  spec: backlog/sprint-9/TICKET-GDPR-002.md
  notes: |
    OTP flow (6-digit, SHA-256 hash, 15min TTL), Resend email provider (noreply@contact.estalara.com).
    dsr_verifications Drizzle table + migration 0011. ClickHouse dsr_audit_log migration 0009.
    ⚠️ FOLLOW-039: ClickHouse hard deletion not yet wired — must fix before EU pilot (RODO Art. 17).

- id: TICKET-GDPR-003
  title: Cookie-less behavioral fingerprinting LIA template + tenant_compliance_records
  agent: compliance-engineer + backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-GDPR-001]
  pr: '#116'
  completed_at: '2026-05-15'
  spec: backlog/sprint-9/TICKET-GDPR-003.md

- id: TICKET-GDPR-004
  title: Consent state propagation (SDK → ingest → ClickHouse → Decision API gate)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-GDPR-001, TICKET-041]
  pr: '#117'
  completed_at: '2026-05-15'
  spec: backlog/sprint-9/TICKET-GDPR-004.md
  notes: |
    consent_required boolean on tenants table (migration 0010). consent-gate.ts pure function.
    SDK fetchDirectives() now sends consent_state in body (fix commit in same PR).
    z.enum(['granted','denied','unknown']).default('unknown') on AdaptRequestSchema.

- id: TICKET-DESC-001
  title: Long-form description pipeline (Tier 2/3, Redis-cached, Sonnet 4.6 async)
  agent: backend-engineer + ml-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-AGENCY-001, TICKET-046]
  pr: '#112 (ml) + #114 (backend)'
  completed_at: '2026-05-15T08:46:30Z'
  spec: backlog/sprint-9/TICKET-DESC-001.md

- id: TICKET-VAL-001
  title: Continuous schema validation cron (drift detection per tenant)
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-AUTO-006]
  pr: '#110'
  completed_at: '2026-05-15T08:04:23Z'
  spec: backlog/sprint-9/TICKET-VAL-001.md
```

## Sprint 9.5 — MVP Demo Readiness (onboarding activation + bandit + scoring) (COMPLETE)

**Status:** COMPLETE as of 2026-05-22. 6/6 tickets DONE across 6 PRs (#121, #122, #123, #124, #125,
#126). Auto-Onboarding UI end-to-end demoable. Bandit variant selection wired into canonical adapt
route. Cosine archetype-listing affinity wired with djb2 fallback. Open gaps tracked in RETRO-005 →
Sprint 10: FOLLOW-041/042 (SDK feedback ping + variant consumer), FOLLOW-043 (archetype embeddings
NULL → cosine unreachable), FOLLOW-046 (listing embedding auto-seed), FOLLOW-055 (e2e test).

**Sprint goal:** Make the zero-config onboarding promise demoable end-to-end on `app.estalara.com`
(Tier 3 Native, locked 2026-05-12), then on any new tenant via Magic Link. Complete the bandit
optimization wire-up and replace the placeholder archetype-affinity hash so the demo narrative
includes honest live optimization. Output: investor demo where (a) admin pastes URL → auto-detects
schema (Sprint 7.5 engine, AI Vision active per Krok B) → previews → activates → snippet generated,
(b) embedded site receives adaptive directives via canonical adapt endpoint (ADR-0004), (c) bandit
selects variants per (tenant, archetype) using Thompson sampling, (d) listing cards reorder by real
archetype-listing affinity (not djb2 hash).

**Scope decisions (Piotr 2026-05-21, post AI Council Checkpoint):**

- Q4: Demo target = `app.estalara.com` (Tier 3 Native + Magic Link first; falls back to manual attrs
  only if Magic Link fails). `000-app-estalara` fixture confirmed in corpus
  (`packages/sdk/src/auto-detect/__fixtures__/000-app-estalara/`), detection_source=`data_estalara`,
  technique already in 11-technique cascade. Magic Link will hit Level 1 detection with confidence
  ≥0.99, zero AI Vision cost.
- Q5: TICKET-032 stays BLOCKED in Sprint 2.5 (cleanup deferred). Not blocking demo.
- Q6: Full narrative — bandit + real scoring included. FOLLOW-007 + FOLLOW-019 in scope.
- Q7: EU pilot not in 4-6 weeks. FOLLOW-039 (ClickHouse DSR hard-delete) deferred to Sprint 11.

**Adapt endpoint:** Per ADR-0004 (2026-05-17), canonical =
`apps/control-plane/src/app/api/adapt/route.ts`. All Sprint 9.5 work targets this endpoint, not
`apps/decision-api` Worker.

**Schema persistence:** Per Sprint 7.5 + AUTO-003/004, canonical = `tenant_site_schemas` table
(`packages/db/src/schema/tenant_site_schemas.ts`). `tenants.auto_detected_schema` field referenced
in Master_Design §J.3 does NOT exist in current schema — that section is stale (cleanup follow-up).

```yaml
- id: TICKET-033
  title: Schema Discovery API endpoint (POST /api/detect tenant-scoped wrapper)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-9.5/TICKET-033.md
  pr: '#121'
  completed_at: '2026-05-21'
  notes: |
    Wraps existing Sprint 7.5 auto-detection engine (apps/control-plane/src/app/api/detect/route.ts:175
    + packages/sdk/src/auto-detect/techniques/*). Adds tenant-scoping via JWT, SSRF protection,
    idempotency, persistence to tenant_site_schemas (Postgres), structured response for wizard UI.
    NOT a rebuild of detection — only a tenant-aware HTTP API in front of it.
    PR #121 open. Node.js CI all green (Test, Typecheck, Lint, Format, Build, Vercel, Rule H).
    Pre-existing failures: Rule I (96 violations pre-date this PR), Test (Python) (infra issue),
    Doppler verify (optional).

- id: TICKET-030
  title: Magic Link onboarding wizard UI (paste URL → detect → preview → snippet)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 5
  depends_on: [TICKET-033]
  model: sonnet-4.6
  spec: backlog/sprint-9.5/TICKET-030.md
  pr: '#124'
  completed_at: '2026-05-21'
  notes: |
    Originally Sprint 2.5 READY, promoted to Sprint 9.5. UI calls TICKET-033 API. States:
    idle, analyzing, detected, needs_review, failed. No mocks — real API wiring. Wired to
    real tenant_site_schemas write via TICKET-033. DetectionPreview stub included (real impl
    is TICKET-AUTO-006-POLISH). Page at /dashboard/onboarding/detect (protected by dashboard
    auth middleware). 11 tests (all 6 AC + 5 edge cases). All JS/TS CI green: Test Node 22,
    Typecheck, Lint, Format, Build (control-plane), Vercel, Rule H, SDK E2E. Pre-existing
    failures not caused by this PR: Rule I (93 violations pre-date this PR), Test (Python)
    (infra scaffolding), Doppler verify (optional).

- id: TICKET-AUTO-006-POLISH
  title: Detection Preview + Save & Activate (trust moment for demo)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-030]
  model: sonnet-4.6
  spec: backlog/sprint-9.5/TICKET-AUTO-006-POLISH.md
  pr: '#125'
  completed_at: '2026-05-22'
  notes: |
    Preview UI shows detected fields with selectors + confidence + sample values. "Save & Activate"
    button writes to tenant_site_schemas (canonical store), updates tenant status to active, generates
    SDK snippet. Manual selector editing OUT OF SCOPE (no visual editor).
    PR #125 opened. All 474 local tests pass. 0 ESLint errors in new files (with built packages).
    Pre-commit hooks pass. CI blocked by GitHub Actions billing issue (all jobs fail with
    'spending limit' error) — pre-existing infrastructure issue, not caused by this PR.
    ESCALATION: GitHub Actions billing needs to be resolved for CI to run.

- id: FOLLOW-018
  title: Replace est_demo_tenant hardcode with real tenant schema lookup in adapt route
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-033, TICKET-AUTO-006-POLISH]
  model: sonnet-4.6
  spec: backlog/sprint-9.5/FOLLOW-018.md
  pr: '#126'
  completed_at: '2026-05-22'
  notes: |
    apps/control-plane/src/app/api/adapt/route.ts currently reads schema for est_demo_tenant only.
    Replace with tenant_site_schemas lookup keyed on authenticated tenant_id. Add Redis cache
    with bounded TTL + invalidation on schema activation. Without this, newly onboarded tenants
    cannot drive adapt path → demo breaks after snippet generation.
    PR #126 opened. All 481 tests pass (7 new). CI: Test (Node 22), Typecheck, Lint, Format check,
    Build, Build (control-plane), Vercel all green. Baseline failures (Doppler, Rule I, Python tests)
    are pre-existing infrastructure issues unrelated to this change.

- id: FOLLOW-007
  title: Wire Thompson sampling bandit into live adapt path per (tenant, archetype, variant)
  agent: ml-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: []
  model: opus-4.7-xhigh
  spec: backlog/sprint-9.5/FOLLOW-007.md
  pr: '#122'
  completed_at: '2026-05-21'
  notes: |
    thompsonSample() implemented (packages/sdk + ab_bandit_weights table) but has zero
    non-test callers per Rule I check. Wire into canonical adapt route variant selection
    per Master_Design §E.3.0 Phase 2. Read Beta(α,β) from ab_bandit_weights, sample, select
    variant_index, log to ClickHouse adaptation_decisions. Async feedback loop on inquiry.completed
    updates Beta distribution. Opus 4.7 xhigh per memory edit ML/algo rule.

    PR #122 — Implementation complete:
      - packages/shared/src/bandit.ts (canonical) + apps/decision-api/src/lib/bandit.ts
        (byte-identical Worker-bundle copy, sync requirement documented).
      - apps/control-plane/src/lib/bandit-query.ts: getBanditArms() + auto-seed (control/v1/v2,
        Beta(1,1)) via onConflictDoNothing.
      - apps/control-plane/src/app/api/adapt/route.ts (POST): thompsonSample()-driven variant
        selection, response.variant field, ClickHouse logDecisionAsync carries variant.
      - apps/control-plane/src/app/api/adapt/feedback/route.ts: POST /api/adapt/feedback,
        202 fire-and-forget, updateBanditArm via onConflictDoUpdate.
      - infra/clickhouse/migrations/0010_adaptation_decisions_variant.sql: ALTER TABLE adds
        variant LowCardinality(String) DEFAULT 'control'.
      - Tests: 12 + 21 + 9 = 42 new control-plane tests. decision-api bandit.test.ts (16 tests)
        REMAIN GREEN — public surface unchanged.
      - JS/TS CI: all green (Test Node 22, Typecheck, Lint, Build, Format, Gitleaks, SDK E2E,
        ClickHouse migrations smoke, Auto-Detection corpus gate, Vercel, Rule H).
      - Pre-existing CI baseline failures NOT caused by this PR:
          - Rule I — wired-or-dead check: 92 dead symbols (was 96 on main; this PR reduced
            count by 4 — my new bandit/getBanditArms/etc. are all wired).
          - 7× Test (Python) failures: missing apps/{auto-detect,archetype-pipeline,...}
            directories (scaffolding TBD).
          - Doppler verify: missing token (marked optional in workflow).

- id: FOLLOW-019
  title: Replace deterministicScore djb2 hash with real archetype-listing affinity
  agent: ml-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: []
  model: opus-4.7-xhigh
  spec: backlog/sprint-9.5/FOLLOW-019.md
  pr: '#123'
  completed_at: '2026-05-21'
  notes: |
    Cosine similarity now drives archetype-listing affinity in both
    apps/decision-api/src/lib/reorder.ts (canonical) and the duplicate helpers
    in apps/control-plane/src/app/api/adapt/route.ts. djb2 fallback preserved
    per-listing for graceful degradation (null embedding, dim mismatch, lookup
    error, or >50 listing batch latency guard). New `listing_embeddings` table
    (1024-dim pgvector, RLS-isolated) + migration 0013 + POST /api/listings/embed
    seeding endpoint (1024-dim OpenAI text-embedding-3-small upsert). Tests:
    11 cosine math + 9 affinity-scoring + 13 embed-route + existing reorder
    tests all green. Lint, typecheck, build, prettier check all clean.
    Opus 4.7 xhigh per memory edit ML/algo rule.
```

**Parallel pre-flight (devops-engineer, no main lane):**

- FOLLOW-040 — Doppler CI hygiene (DOPPLER_TOKEN in GitHub Actions secrets, ~30 min, Sonnet 4.6).
  Must complete before Sprint 9.5 demo staging.

**Deferred to Sprint 11 (per Q7 2026-05-21):**

- FOLLOW-039 (ClickHouse DSR hard-delete) — non-negotiable BEFORE any EU pilot traffic but no EU
  traffic in 4-6 weeks per Piotr's call.

## Sprint 10 — Close the bandit loop + real embeddings + e2e test (COMPLETE)

**Sprint goal:** "Close the bandit loop, make cosine affinity real end-to-end (archetype + listing
vectors both seeded), and verify the demo end-to-end in CI."

**Entry condition:** Sprint 9.5 COMPLETE ✓ (2026-05-22).

**Dependency note:** FOLLOW-046 must ship after FOLLOW-043 (archetype embedding vectors needed first
before listing embedding seeding makes cosine affinity real). Consider combining into one PR if the
same agent handles both.

```yaml
- id: FOLLOW-041
  title: SDK feedback ping on outcome events (closes bandit feedback loop)
  agent: sdk-engineer + backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [FOLLOW-042]
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-041.md
  pr: '#127'
  completed_at: '2026-05-22'
  notes: |
    Must ship in same PR as FOLLOW-042. POST /api/adapt/feedback exists server-side but
    no SDK consumer fires the ping on outcome events. Without this, ab_bandit_weights never
    updates from real traffic and Thompson sampling stays at uniform Beta(1,1) prior forever.
    SDK must cache the served variant in sessionStorage and POST on inquiry.completed.
    Implemented: sessionStorage cache, registerFeedbackListener, postFeedbackPing,
    feedbackEvents/feedbackUrl/feedbackConvertedFalse config fields. 11 new tests.

- id: FOLLOW-042
  title: Add variant field to SDK AdaptResponse + thread through applyDirectives
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-042.md
  pr: '#127'
  completed_at: '2026-05-22'
  notes: |
    Must ship in same PR as FOLLOW-041. Adds variant?: string to packages/sdk/src/core/adapt.ts
    AdaptResponse interface. Rule G mock-scan obligation applies — grep MOCK_RESPONSE in
    packages/sdk/src/__tests__/adapt.test.ts before PR.
    Implemented: variant?: string on AdaptResponse with JSDoc, MOCK_RESPONSE updated with
    variant:'control'. Rule G scan found only 1 mock object — updated. 3 new variant tests.

- id: FOLLOW-043
  title: Compute archetype embedding vectors (Modal job or one-shot Node script)
  agent: ml-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: []
  model: opus-4.7-xhigh
  spec: backlog/sprint-10/FOLLOW-043.md
  pr: '#131'
  completed_at: '2026-05-22'
  notes: |
    0005_seed_archetype_embeddings.sql inserts 18 rows with embedding=NULL. No Modal job exists.
    fetchArchetypeEmbedding() returns null for all archetypes → cosine path unreachable → djb2
    always wins. Script: scripts/seed-archetype-embeddings.ts calling OpenAI
    text-embedding-3-small at 1024 dims, then UPDATEs each row. Opus 4.7 xhigh per ML/algo rule.
    PR #131: script + pnpm seed:archetypes + integration test (8/8 pass) +
    apps/control-plane/src/lib/__tests__/embedding-lookup.test.ts.
    After merge: run `pnpm seed:archetypes` against dev/staging DB to unblock cosine path.

- id: FOLLOW-055
  title: End-to-end integration test detect→activate→adapt→SDK
  agent: qa-engineer
  status: DONE
  priority: P0
  estimated_hours: 5
  depends_on: []
  model: sonnet-4.6
  pr: '#130'
  spec: backlog/sprint-10/FOLLOW-055.md
  completed_at: '2026-05-22'
  notes: |
    Vitest integration spec at tests/e2e/sprint-9-5-demo.spec.ts. 5 static contract
    tests always run in CI (fixture schema, ReorderDirective sort, TextDirective DOM
    mutation, score descending invariant, grid builder). 5 E2E steps (detect, activate,
    adapt, DOM mutation, feedback ping) guarded by NEXT_PUBLIC_TEST_E2E=true — call
    real Next.js handlers when server is up. Decision: vitest not Playwright because
    tests/e2e workspace has no Next.js dep; DOM mutation tested via JSDOM per escalation
    path in FOLLOW-055 spec. CI green (Format, Lint, Typecheck, Test Node 22, SDK E2E,
    Rule H, ClickHouse, Gitleaks all pass). Ignoring: Doppler, Rule I, Python tests.

- id: FOLLOW-046
  title: Automate listing embedding seeding (tenant activation trigger + 000-app-estalara backfill)
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-043]
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-046.md
  pr: '#132'
  completed_at: '2026-05-23'
  notes: |
    Promoted from P2 to P1 — without listing embeddings, cosine affinity stays no-op even after
    FOLLOW-043 seeds archetype vectors. Wire listing.updated consumer OR daily backfill cron
    that calls POST /api/listings/embed per listing. Backfill the 000-app-estalara fixture.
    MUST ship after FOLLOW-043. Consider combining into one PR if same agent handles both.
    DONE: fire-and-forget trigger wired in POST /api/schema/activate; DEMO_LISTING_MANIFEST
    (12 listings) seeds on demo tenant activation; pnpm seed:listings backfill script added.
    506 tests pass. CI green (Lint, Typecheck, Build, Test Node 22, Rule H/J all pass).

- id: FOLLOW-047
  title: Reject null tenant_id with 403 (STAFF_TENANT_CONTEXT_MISSING) from detect + activate
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 1
  depends_on: []
  model: sonnet-4.6
  pr: '#129'
  spec: backlog/sprint-10/FOLLOW-047.md
  completed_at: '2026-05-22'
  notes: |
    Both apps/control-plane/src/app/api/detect/route.ts:214 and
    apps/control-plane/src/app/api/schema/activate/route.ts:97 fall back to 'estalara_staff'
    string sentinel when claims.tenant_id is null → uuid parse error → 500. Replace with
    explicit 403 STAFF_TENANT_CONTEXT_MISSING.

- id: FOLLOW-051
  title: Replace presence-only Bearer on POST /api/adapt/feedback with proper tenant-scoped auth
  agent: compliance-engineer + backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-051.md
  pr: '#133'
  completed_at: '2026-05-23'
  notes: |
    When ADAPT_API_KEY is unset, feedback endpoint accepts any non-empty Bearer token and mutates
    ab_bandit_weights directly → adversarial bandit poisoning possible. Replaced with tenant-scoped
    HMAC-SHA256 signature. SDK sends X-Estalara-Signature: HMAC-SHA256(apiKey, body) hex.
    Server uses Bearer token (raw API key) as HMAC key, constant-time compares.
    ADAPT_API_KEY env var retained as ops/test fallback.
    Threat model documented in docs/MASTER_DESIGN.md §V.3.2.
    31 server tests (all pass) + 4 new SDK HMAC-aware tests (all pass, 569/569 SDK tests green).
    CI: Lint/Typecheck/Test Node 22/SDK E2E/Build/Rule H/Rule J/Format/Gitleaks all green.
    Pre-existing SDK failures (dqs-integration, mismatch, event-contract) — @estalara/shared
    resolution issue in worktree, not our code. Push-workflow Lint failure is git auth issue,
    not code-related (pull_request workflow Lint passes).

- id: FOLLOW-052
  title: Mirror-code byte-identity CI check — scripts/check-mirror-files.sh (Rule J enforcement)
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 1.5
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-052.md
  pr: '#128'
  completed_at: '2026-05-22'
  notes: |
    Two mirrored file pairs: apps/decision-api/src/lib/bandit.ts (mirror of packages/shared/src/bandit.ts)
    and apps/decision-api/src/lib/reorder.ts. PR descriptions say byte-identical but no CI enforces
    this. Add check-mirror-files.sh + JSON manifest + GitHub Actions job rule-j + lefthook pre-push.
    Promotes Rule J pattern enforcement (CONVENTIONS_PATCH.md).
    Bandit drift fixed: sampleGamma now export function in mirror to match canonical.

- id: FOLLOW-061
  title: Add Snapshot.1 re-verification to sprint-close checklist in AGENT_WORKFLOW.md
  agent: architect
  status: DONE
  pr: '#134'
  priority: P1
  estimated_hours: 0.5
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-061.md
  completed_at: '2026-05-23'
  notes: |
    OP §Y.3 requires Snapshot.1 re-verification at sprint close. Sprint 9.5 violated this —
    rows B.4 and J went stale. Add re-verification as the last step on PM-orchestrator
    sprint-close checklist. Codify in docs/AGENT_WORKFLOW.md. RETRO-005 §7 Edits M-1..M-6
    satisfy the obligation for Sprint 9.5 retroactively.
```

## Sprint 11 — Pilot readiness (seed CI, demo CI, HMAC compat, GDPR ClickHouse) (COMPLETE)

**Sprint goal:** "Close all pilot-blockers: seed CI gate, demo CI verification, HMAC security
closure, ClickHouse GDPR erasure, Doppler CI hygiene."

**Entry condition:** Sprint 10 COMPLETE ✓ (2026-05-23).

**Status:** COMPLETE as of 2026-05-24. 5 P1 pilot-blockers DONE (PRs #135, #136, #137, #138, #139).
4 P2 quality items carry forward (FOLLOW-065/071 READY; FOLLOW-073/074 promoted to Sprint 12 P2
carry-over).

**Pilot-blocker subset (P1, must close before any pilot tenant onboard):** FOLLOW-063 ✅, FOLLOW-068
✅, FOLLOW-069 ✅. **EU pilot gate (P1, non-negotiable before EU traffic):** FOLLOW-039 ✅. **P1 ops
hygiene:** FOLLOW-040 ✅.

```yaml
- id: FOLLOW-063
  title: archetype_embeddings auto-seed in CI (NOT NULL invariant)
  agent: devops-engineer + ml-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: []
  assigned_to: devops-engineer
  started_at: '2026-05-23T12:00:00Z'
  completed_at: '2026-05-24'
  branch: devops-engineer/FOLLOW-063-seed-ci
  pr: '#135'
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-063.md
  notes: |
    PILOT-BLOCKING. `pnpm seed:archetypes` (FOLLOW-043 PR #131) is a one-shot script — no CI
    step or on-merge automation runs it. Result: fresh DB pull → `archetype_embeddings.embedding`
    NULL → cosine path falls back to djb2 silently. Add CI precheck (fail build if any
    archetype_embeddings row has NULL embedding on staging/prod) + post-migration seed step +
    README "Local development setup" pointer. Bundle with FOLLOW-074 (architect README).
    Files: .github/workflows/ci.yml (archetype-embeddings-not-null job),
    .github/workflows/post-migrate-seed.yml (new), README.md (Local dev setup section).
    Both new jobs soft-skip when DOPPLER_TOKEN_DEV not yet provisioned (FOLLOW-040).

- id: FOLLOW-068
  title: demo-integration CI job — NEXT_PUBLIC_TEST_E2E=true + demo DB fixtures
  agent: qa-engineer + devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: []
  assigned_to: qa-engineer
  started_at: '2026-05-23T12:00:00Z'
  completed_at: '2026-05-24'
  branch: qa-engineer/FOLLOW-068-demo-ci
  pr: '#137'
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-068.md
  notes: |
    PILOT-BLOCKING. PR #130 (FOLLOW-055) shipped the E2E spec guarded behind
    NEXT_PUBLIC_TEST_E2E=true, but CI never sets the flag. The detect→activate→adapt→SDK chain
    has never run unattended. Provision a `demo-integration` CI job that brings up Next.js +
    seeded demo DB and runs the E2E spec end-to-end. Decision gate: this is what makes the
    investor-demo path CI-verified vs human-driven.
    PR #137: workflow added + test:e2e script + E2E_BEARER_TOKEN beforeAll() precheck +
    soft-skip when DOPPLER_TOKEN or DB creds missing. ESC-009 filed for E2E_BEARER_TOKEN
    GitHub Actions secret. Critical CI green (Rule-I/Python pre-existing ignored per Sprint 11
    policy). Demo-integration job passes (soft-skip with exit 0 — full activation after
    FOLLOW-040 + ESC-009).

- id: FOLLOW-069
  title: HMAC compat test SDK↔server + Bearer-only rejection regression test
  agent: qa-engineer + backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  depends_on: []
  assigned_to: qa-engineer
  started_at: '2026-05-23T12:00:00Z'
  completed_at: '2026-05-24'
  branch: qa-engineer/FOLLOW-069-hmac-compat
  pr: '#136'
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-069.md
  notes: |
    Closes RETRO-006 LG-3. PR #133 hardened POST /api/adapt/feedback to HMAC-SHA256 — but no
    cross-runtime test confirms SDK Web Crypto HMAC and server Node Crypto HMAC produce
    identical signatures for the same key+body. Adds (a) shared fixture suite that asserts
    byte-identical hex digests across N (key, body) pairs, and (b) a regression test that posts
    a presence-only Bearer token (no signature) and asserts 401 — guards against accidental
    reintroduction of the 2026-05-22 → 2026-05-23 vulnerability window.

- id: FOLLOW-039
  title: ClickHouse DSR hard-delete — Art.17 erasure on adaptation_decisions + events tables
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 5
  depends_on: []
  assigned_to: data-engineer
  started_at: '2026-05-23T12:00:00Z'
  completed_at: '2026-05-24'
  branch: data-engineer/FOLLOW-039-clickhouse-dsr
  pr: '#139'
  model: opus-4.7-xhigh
  spec: backlog/sprint-11/FOLLOW-039.md
  notes: |
    EU PILOT GATE — non-negotiable before any EU tenant onboard. Today `dsr_erase()` writes an
    audit log but does NOT issue DELETE / ALTER TABLE ... DELETE WHERE on ClickHouse
    `adaptation_decisions` or the events store. RODO Art. 17 erasure right is therefore
    non-compliant for any EU tenant. Implement ALTER TABLE ... DELETE WHERE session_id IN (...)
    on both tables with mutation status tracked + retry-on-failure + DSR audit row updated only
    after ClickHouse mutation acknowledges. Opus 4.7 xhigh — compliance edge cases require
    careful reasoning about idempotency, partial failure, and async mutation semantics.
    READY_FOR_REVIEW 2026-05-24 (PR #139): erasure flow shipped against the 4-table inventory
    (events, adaptation_decisions, llm_calls, session_quality), with Vercel-Cron poller, 3-retry
    exponential backoff, Sentry alerting on permanent failure, Drizzle migration 0014 for the
    operational state table, ClickHouse migration 0011 for audit-log columns, and Master Design
    §H.1/§H.1.1/§W.7.3/§Snapshot.1 + DPIA §8 updated (versions 2.4 / 2.1). 21 unit + 4
    integration tests added; 541/541 control-plane tests pass. Critical CI green; ignored
    Doppler/Rule-I/Python per Sprint 11 policy.

- id: FOLLOW-040
  title: Doppler CI hygiene — DOPPLER_TOKEN in GitHub Actions
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 1
  depends_on: []
  assigned_to: devops-engineer
  started_at: '2026-05-23T12:00:00Z'
  completed_at: '2026-05-24'
  branch: devops-engineer/FOLLOW-040-doppler-ci
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-040.md
  pr: '#138'
  notes: |
    Originally P0 parallel pre-flight for Sprint 9.5; still incomplete. Surfaced 6 fix-commits
    for FOLLOW-043 (PR #131) — env plumbing breaks operator workflows. Add DOPPLER_TOKEN as
    GitHub Actions secret + `doppler run -- pnpm <cmd>` wrapper in CI workflows. Coordinate with
    FOLLOW-063 (which needs Doppler-injected DB creds in the seed CI step).
    ESCALATION: DOPPLER_TOKEN_DEV must be provisioned by Piotr — see backlog/ESCALATIONS.md.
    Workflow files are ready; token activates on secret landing.

- id: FOLLOW-065
  title: Emit events.feedback.send_failed on SDK ping 4xx/5xx + dashboard panel
  agent: sdk-engineer + backend-engineer
  status: READY
  priority: P2
  estimated_hours: 2
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-065.md
  notes: |
    From RETRO-006 §4. Today SDK feedback ping failures (HMAC mismatch, 401, 5xx) are silent.
    Add synthetic event emission on non-2xx response + Grafana panel surfacing rate. Closes
    one of the "demo passes but bandit not updating" silent-failure modes.

- id: FOLLOW-071
  title: Document SDK feedback config options in Master Design §B.1
  agent: architect
  status: READY
  priority: P2
  estimated_hours: 1
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-071.md
  notes: |
    From RETRO-006 §6. SDK config fields `feedbackEvents`, `feedbackUrl`, `feedbackConvertedFalse`
    introduced by PR #127 are not in Master Design §B.1 surface table. Fold with FOLLOW-060.

- id: FOLLOW-073
  title: Master Design §V.3.3 threat model for INTERNAL_API_SECRET + key rotation runbook
  agent: compliance-engineer
  status: READY
  priority: P2
  estimated_hours: 1
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-073.md
  notes: |
    From RETRO-006 §4. INTERNAL_API_SECRET (used for service-to-service auth, e.g. ingest →
    decision-api) has no documented threat model or rotation procedure. §V.3.2 covers
    `POST /api/adapt/feedback` HMAC; §V.3.3 should cover INTERNAL_API_SECRET symmetrically.

- id: FOLLOW-074
  title: README "Local development setup" section with required Doppler keys + seed scripts
  agent: architect
  status: READY
  priority: P2
  estimated_hours: 1
  depends_on: [FOLLOW-040, FOLLOW-063]
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-074.md
  notes: |
    From RETRO-006 §6. Fresh repo pull today gives a broken cosine path with no diagnostic
    output. Add one-shot README section listing required `doppler login`, env keys, and
    `pnpm seed:archetypes` + `pnpm seed:listings`. Bundle with FOLLOW-063 (which will make the
    seed step CI-enforced) and FOLLOW-040 (Doppler hygiene).
```

## Sprint 12 — Pilot launch on app.estalara.com (Lane A hardening + Lane B onboarding + Lane C ROI) (COMPLETE)

**Sprint goal:** "Controlled pilot launch on app.estalara.com. Lane A hardening completes
pilot-critical infrastructure (ClickHouse DSR integration test, cron auth, DSR alerting). Lane B
onboards app.estalara.com via Magic Link + shadow mode. Lane C measures CTA lift + inquiry starts vs
holdout. Note: demo-integration fail-loud (FOLLOW-079) cancelled 2026-05-25 — split into
FOLLOW-088/089/090 (Sprint 13 P2 candidates; blocked on ESC-010 for demo-integration component)."

**Entry condition:** Sprint 11 COMPLETE ✓ (2026-05-24). AI Council Checkpoint ✓ (2026-05-24).

**Sprint sequencing:** Lane A is gated — must complete before Lane B activates real-tenant
adaptation. Lane C can run in parallel with Lane B during shadow period.

**Pilot decisions (Piotr 2026-05-24):** Target = app.estalara.com (own domain). Free pilot (no
billing infra needed). EU region (FOLLOW-081 infrastructure test; full compliance already verified).
Incident owner = Piotr Nawrocki. Primary metric = CTA lift. Secondary metric = inquiry starts.
VERCEL_CRON_SECRET provisioned in Vercel + Doppler.

```yaml
# LANE A — Pilot-critical hardening (P1, must complete before Lane B activation)

- id: FOLLOW-081
  title: ClickHouse mutation-poll integration test against system.mutations
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-039]
  assigned_to: data-engineer
  started_at: '2026-05-24T12:00:00Z'
  completed_at: '2026-05-25'
  pr: '#143'
  branch: data-engineer/FOLLOW-081-clickhouse-integration-test
  model: opus-4.7-xhigh
  spec: backlog/sprint-12/FOLLOW-081.md
  notes: |
    From RETRO-007. The Vercel-Cron /api/dsr/mutation-poll handler (shipped by FOLLOW-039)
    polls ClickHouse system.mutations to detect erasure completion and update Postgres state.
    No integration test verifies this contract against a real ClickHouse instance — only unit
    mocks of the poll function. Add an integration test that spins up a ClickHouse container,
    issues an ALTER TABLE ... DELETE WHERE, then asserts the poller detects completion within SLA.
    Blocks EU pilot confidence in the erasure flow. Opus 4.7 xhigh — async ClickHouse mutation
    semantics require careful reasoning about system.mutations schema + timing.

- id: FOLLOW-079
  title:
    Tighten demo-integration.yml — flip soft-skips to fail-loud, add to required branch protection
  agent: devops-engineer
  status: CANCELLED
  priority: P1
  estimated_hours: 1
  depends_on: [FOLLOW-040]
  assigned_to: devops-engineer
  started_at: '2026-05-24T12:00:00Z'
  cancelled_at: '2026-05-25'
  replaced_by: [FOLLOW-088, FOLLOW-089, FOLLOW-090]
  pr: '#141'
  branch: devops-engineer/FOLLOW-079-demo-ci-failloud
  model: sonnet-4.6
  spec: backlog/sprint-12/FOLLOW-079.md
  notes: |
    CANCELLED 2026-05-25 by pm-orchestrator — ticket triggered 3 independent enforcement
    mechanisms (Rule I 105 violations, Python CI matrix directory bug, demo-integration ESC-010
    blocked) that are not all ready to merge simultaneously. PR #141 closed; branch preserved.
    Replaced by: FOLLOW-088 (prettier format fix, P2), FOLLOW-089 (Python CI matrix fix, P2),
    FOLLOW-090 (Rule I unblock + demo-integration fail-loud after ESC-010, P2) — Sprint 13.
    Original scope: After ESC-009 + FOLLOW-040 secrets provisioned, remove demo-integration
    soft-skip guard, make fail-loud, add to required status checks in branch protection.

- id: FOLLOW-075
  title: Require VERCEL_CRON_SECRET on /api/dsr/mutation-poll endpoint
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 1
  depends_on: []
  assigned_to: backend-engineer
  started_at: '2026-05-24T12:00:00Z'
  completed_at: '2026-05-25'
  pr: '#142'
  branch: backend-engineer/FOLLOW-075-cron-secret
  model: sonnet-4.6
  spec: backlog/sprint-12/FOLLOW-075.md
  notes: |
    From RETRO-007. The /api/dsr/mutation-poll Vercel Cron endpoint (FOLLOW-039 PR #139) does not
    yet validate the VERCEL_CRON_SECRET header. Any unauthenticated caller can trigger a poll cycle,
    wasting ClickHouse queries and potentially masking real mutation state. Add Authorization header
    check using VERCEL_CRON_SECRET (provisioned 2026-05-24 in Vercel + Doppler). Compliance joint
    ownership — DSR endpoint hardening is also a compliance concern.

- id: FOLLOW-078
  title: DSR failure alerting — PagerDuty or Sentry alert on stuck/failed mutations
  agent: compliance-engineer
  status: DONE
  priority: P1
  estimated_hours: 1.5
  depends_on: [FOLLOW-039]
  assigned_to: compliance-engineer
  started_at: '2026-05-24T12:00:00Z'
  completed_at: '2026-05-25'
  pr: '#145'
  branch: compliance-engineer/FOLLOW-078-dsr-alerting
  model: sonnet-4.6
  spec: backlog/sprint-12/FOLLOW-078.md
  notes: |
    From RETRO-007. FOLLOW-039 implements retry-with-backoff (3 retries max) but on permanent failure
    silently leaves the dsr_clickhouse_mutations row in `failed` state. A regulator reviewing our DSR
    process would expect an alert. Wire Sentry alert (or PagerDuty if available) on permanent failure
    after max retries. DevOps joint ownership for alert routing.

# LANE B — Pilot onboarding on app.estalara.com — MOVED TO SPRINT 13 (Phase 2)
# TICKET-PILOT-001 + TICKET-PILOT-002 deferred to Sprint 13 Lane B on 2026-05-25 (pm-orchestrator).
# Reason: RETRO-008/009 surfaced P1 dashboard-correctness blockers (FOLLOW-092/093/094/097) in the
# Lane C instrumentation that must land before shadow-mode go-live, or the pilot's go/no-go metrics
# could display fabricated success. Pilot launch is now the headline of Sprint 13, gated behind
# Sprint 13 Lane A (correctness). Specs remain at backlog/sprint-12/TICKET-PILOT-001.md +
# TICKET-PILOT-002.md; re-pointed under Sprint 13 below. TICKET-PILOT-001 depends_on updated to drop
# the CANCELLED FOLLOW-079.

# LANE C — Pilot ROI instrumentation (P1, can start in parallel with Lane B)

- id: TICKET-PILOT-003
  title: CTA lift dashboard — baseline vs adapted, holdout comparison, conversion funnel
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: []
  assigned_to: data-engineer
  started_at: '2026-05-24T12:00:00Z'
  completed_at: '2026-05-25'
  pr: '#146'
  branch: data-engineer/TICKET-PILOT-003-cta-lift-dashboard
  model: opus-4.7-xhigh
  spec: backlog/sprint-12/TICKET-PILOT-003.md
  notes: |
    Primary pilot metric. Build dashboard panel in /dashboard/analytics showing: (1) CTA click
    rate — adapted sessions vs holdout sessions (10% holdout already wired via TICKET-AB-001).
    (2) Time-on-listing comparison. (3) Inquiry started rate. (4) Conversion funnel (page.view →
    listing.viewed → cta.clicked → inquiry.started → inquiry.completed). Data source: ClickHouse
    adaptation_decisions table (holdout_group boolean) + events table (cta.clicked, inquiry.*).
    Requires: both adapted and holdout sessions emitting cta.clicked events with same schema.
    Opus 4.7 xhigh — statistical correctness of lift calculation requires careful reasoning.

- id: TICKET-PILOT-004
  title: Inquiry starts tracking — event mapping from app.estalara.com forms, dashboard panel
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-PILOT-001]
  assigned_to: backend-engineer
  started_at: '2026-05-24T12:00:00Z'
  completed_at: '2026-05-25'
  pr: '#144'
  branch: backend-engineer/TICKET-PILOT-004-inquiry-tracking
  model: sonnet-4.6
  spec: backlog/sprint-12/TICKET-PILOT-004.md
  notes: |
    Secondary pilot metric. Map app.estalara.com inquiry form submission to inquiry.started SDK
    event. Verify event flows through ingest → ClickHouse. Add "Inquiry starts" panel to CTA
    dashboard (alongside TICKET-PILOT-003). Requires: identifying the inquiry form selector in
    the 000-app-estalara site schema (or adding it to the fixture if missing).

# P2 carry-over from Sprint 11

- id: FOLLOW-073
  title: Master Design §V.3.3 threat model for INTERNAL_API_SECRET + key rotation runbook
  agent: compliance-engineer
  status: READY
  priority: P2
  estimated_hours: 1
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-073.md
  notes: |
    Carry-over from Sprint 11. INTERNAL_API_SECRET (used for service-to-service auth, e.g. ingest →
    decision-api) has no documented threat model or rotation procedure. §V.3.2 covers
    `POST /api/adapt/feedback` HMAC; §V.3.3 should cover INTERNAL_API_SECRET symmetrically.

- id: FOLLOW-074
  title: README "Local development setup" section with required Doppler keys + seed scripts
  agent: architect
  status: READY
  priority: P2
  estimated_hours: 1
  depends_on: [FOLLOW-040, FOLLOW-063]
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-074.md
  notes: |
    Carry-over from Sprint 11. Fresh repo pull today gives a broken cosine path with no diagnostic
    output. Add one-shot README section listing required `doppler login`, env keys, and
    `pnpm seed:archetypes` + `pnpm seed:listings`. FOLLOW-040 (Doppler) and FOLLOW-063 (seed CI)
    are now DONE so this can be written with concrete runbook steps.
```

## Sprint 13a — Correctness + pilot launch (OPEN)

**Sprint goal:** "Launch the controlled pilot on app.estalara.com for real. Lane A makes the pilot
dashboards honest (no fabricated metrics, real producer→consumer paths) and enforces one canonical
adapt path. Lane B onboards app.estalara.com and runs shadow mode, blocked until Lane A is green."

**Entry condition:** Sprint 12 COMPLETE ✓ (2026-05-25). AI Council (session `20260525_143939`)
ratified Track 1 first with changes; **CEO Piotr Nawrocki ratified all `DECISION NEEDED` markers
2026-05-25 → `APPROVED_TO_IMPLEMENT=true`.** Blocking questions B1–B8 closed. Phase-0 spec artifacts
RATIFIED: `docs/specs/PILOT_CTA_LIFT_METRIC_v1.md`, `docs/ops/PILOT_FREEZE_RULE.md`,
`docs/ops/PILOT_RUNBOOK.md` (measurement-quality gates),
`docs/adr/ADR-0006-canonical-adapt-enforcement.md` (PROPOSED, CEO-ratified — flips to ACCEPTED on
FOLLOW-105 substep 1b). **Lane A ready to spawn.**

**Sprint sequencing:** Lane A first (correctness + canonical-route enforcement gate the pilot). Lane
B blocked until Lane A DONE. FOLLOW-105's runtime route verification and several Lane A CI gates
require ESC-010 (`DOPPLER_TOKEN_DEV`) + ESC-009 (`E2E_BEARER_TOKEN`) secrets to be provisioned (~20
min Piotr action).

```yaml
# LANE A — Dashboard correctness + canonical-route enforcement (P0/P1, from RETRO-008/009 + AI
# Council Ticket 4; must complete before Lane B go-live)

- id: FOLLOW-094
  title: cta-lift route must fail loud on ClickHouse error + expose data provenance (Rule K.2)
  agent: data-engineer + backend-engineer
  status: DONE # Wave 3 — PR #153 merged to main 2026-05-27 (9f32aa8); CI green
  started_at: '2026-05-26T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#153' # merged 9f32aa8
  priority: P1
  estimated_hours: 3
  depends_on: []
  model: sonnet-4.6
  branch: data-engineer/FOLLOW-094-cta-lift-fail-loud
  spec: backlog/sprint-13/FOLLOW-094.md
  notes: |
    RETRO-008 CB-1. Separate "CLICKHOUSE_URL unset → legitimate dev/CI mock" from "CLICKHOUSE_URL
    set but query failed → must surface error + Sentry, never fabricate significant lift". Expose
    data_source: 'mock' | 'clickhouse' on the response. Bundle with FOLLOW-093 (same cta-lift route
    — sequence together to avoid merge conflicts) and pair with FOLLOW-098 (inquiry-starts sibling).

- id: FOLLOW-098
  title: inquiry-starts route must fail loud on ClickHouse error + expose data provenance (Rule K.2)
  agent: backend-engineer
  status: DONE # Wave 3 — PR #155 merged to main 2026-05-27 (4ce6e37); CI green
  started_at: '2026-05-26T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#155' # merged 4ce6e37
  priority: P2
  estimated_hours: 1.5
  depends_on: []
  model: sonnet-4.6
  branch: backend-engineer/FOLLOW-098-inquiry-starts-fail-loud
  spec: backlog/sprint-13/FOLLOW-098.md
  notes: |
    RETRO-009. Same Rule K.2 treatment as FOLLOW-094, applied to /api/pilot/inquiry-starts. Sequence
    alongside FOLLOW-094 so both pilot routes get identical fail-loud + provenance behavior.

- id: FOLLOW-093
  title: Reconcile the two CTA-lift query paths onto one schema vocabulary
  agent: data-engineer
  status: DONE # Wave 3 — PR #154 merged to main 2026-05-27 (a7d9c03); CI green
  started_at: '2026-05-26T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#154' # merged a7d9c03
  priority: P1
  estimated_hours: 4
  depends_on: []
  model: sonnet-4.6
  branch: data-engineer/FOLLOW-093-cta-lift-query-reconcile
  spec: backlog/sprint-13/FOLLOW-093.md
  notes: |
    RETRO-008. /api/pilot/cta-lift (events.cta.clicked on adaptation_decisions.ts) vs
    /api/dashboard/analytics/lift (dqs_events.cta_clicked on assigned_at) report divergent numbers.
    Verify canonical column (ts vs assigned_at) from the migration, fix the wrong route, document
    both + /dashboard/pilot in the Master Design route inventory. Touches the cta-lift route —
    sequence after FOLLOW-094.

- id: FOLLOW-097
  title: Thread detected inquiry_submit_selector into SDK setupObservers() at init
  agent: sdk-engineer + backend-engineer
  status: DONE # PR #151 merged to main 2026-05-26 (3cf05ee); all real CI gates were green
  started_at: '2026-05-25T22:00:00Z'
  completed_at: '2026-05-26T00:00:00Z'
  pr: '#151' # merged 3cf05ee
  priority: P1
  estimated_hours: 2
  depends_on: []
  model: sonnet-4.6
  spec: (to author at spawn — backlog/sprint-13/FOLLOW-097.md)
  notes: |
    RETRO-009 HALF_WIRE_P. setupObservers(config, onEvent) never passes the options object, so
    inquirySubmitSelector is always undefined → inquiry.started never fires in prod (only in unit
    tests). Plumb the selector from SDK config / activated tenant site schema into the options arg
    at init; add a test that drives the real init path. SDK-side, independent of the route fixes —
    safe to run in parallel with FOLLOW-094/093/098.

- id: FOLLOW-105
  title: Canonical /api/adapt ADR + enforce one production path (ADR-0006)
  agent: architect + backend-engineer + sdk-engineer
  status: DONE # 1a PR #148 + Wave 1 (1b/1c/1d) PR #150 both MERGED to main (bf0585d)
  priority: P0
  estimated_hours: 15-18
  depends_on: []
  model: opus-4.7-xhigh
  branch: architect/FOLLOW-105-canonical-adapt-enforcement
  pr: '#150' # merged 2026-05-25 (bf0585d); supersedes closed #149 (renamed feat/→architect/ for push-CI; ESC-011)
  completed_at: '2026-05-25T21:30:00Z'
  spec: docs/adr/ADR-0006-canonical-adapt-enforcement.md + docs/audits/FOLLOW-105-1a-sdk-audit.md
  notes: |
    Substep 1a DONE (PR #148 merged). Wave 1 NOW: substeps 1b+1c+1d as single comprehensive PR
    (Scenario D — sequential). Scope includes: buildSnippet fix (F.1), demo mockup fix (F.2),
    DECISION_API_URL deprecation (F.3), Worker 410 Gone + structured logging (F.4), SDK Zod
    validation (F.5), adapt_decision_id UUID (F.6 partial — explainability_id deferred to
    FOLLOW-108). ADR-0006 flips PROPOSED → ACCEPTED on merge. ADR-0004 contract block entirely
    replaced (live wins). Wave 2 (FOLLOW-097 + FOLLOW-106) BLOCKED until this PR merges; Wave 3
    (FOLLOW-094/098/093) BLOCKED until Wave 2 merges.
    Estimate 8-10h → 15-18h (1b expanded scope + adapt_decision_id + Zod validation; 1c Worker
    410 Gone + structured logging; 1d CI Rule H/J extension) per CEO ratification 2026-05-25
    (Decisions 4C/5A/6D). NOTE: ADR-0006 §Decision 3 hardcodes `control-plane.estalara.com` in the
    410 body, but the live constant is CONTROL_PLANE_URL=`https://admin.estalara.com` — use the
    constant, not the stale ADR literal. On done: flip Master Design §Snapshot.7 risk #1
    OPEN→RESOLVED. opus-4.7-xhigh — architectural.

- id: FOLLOW-106
  title: Add tenants.pilot_frozen runtime flag for measurement-window protection
  agent: backend-engineer
  status: DONE # PR #152 merged to main 2026-05-26 (b83e6c0); all real CI gates were green
  started_at: '2026-05-25T22:00:00Z'
  completed_at: '2026-05-26T00:00:00Z'
  pr: '#152' # merged b83e6c0
  priority: P2
  estimated_hours: 2
  depends_on: []
  model: sonnet-4.6
  spec: (to author at spawn — backlog/sprint-13/FOLLOW-106.md)
  notes: |
    CEO ratification 2026-05-25 (PILOT_FREEZE_RULE.md Decision 3). Migration: tenants.pilot_frozen
    boolean DEFAULT false; update packages/db/src/schema/tenants.ts; adapt route logs a prophylactic
    (non-blocking) warning if a Lane C feature flag is on while pilot_frozen=true; TICKET-PILOT-001
    sets pilot_frozen=true on shadow→live flip. Independent —
    parallel with FOLLOW-094/098/093/097/105.
    MIGRATION STATUS (0015_pilot_frozen.sql), 2026-05-26:
      - prd: ✅ applied successfully — this is the config that matters for the pilot.
      - dev + stg: ❌ NOT applied — DATABASE_URL_ADMIN not set in Doppler for those configs (no
        admin DB credentials). NOT a pilot blocker (pilot runs against prd). Backfill dev/stg once
        DATABASE_URL_ADMIN is provisioned in Doppler (tracks with ESC-010 admin-credential work).

- id: FOLLOW-114
  title:
    Emit data-inquiry-submit-selector in buildSnippet() so inquiry.started fires for real tenants
  agent: sdk-engineer
  status: DONE # Wave 3 — PR #157 merged to main 2026-05-27 (f882dae); CI green
  started_at: '2026-05-26T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#157' # merged f882dae
  priority: P0
  estimated_hours: 2
  depends_on: [FOLLOW-097]
  model: sonnet-4.6
  branch: sdk-engineer/FOLLOW-114-inquiry-selector-snippet
  spec: (RETRO-011 — backlog/FOLLOW_UPS.md FOLLOW-114)
  notes: |
    RETRO-011 P0 HALF_WIRE_C. FOLLOW-097 fixed the SDK-layer half-wire (config → setupObservers),
    but buildSnippet() in apps/control-plane/src/components/onboarding/DetectionPreview.tsx still
    emits only data-tenant-id + data-api-key + data-decision-url. The inquiry_submit_selector value
    comes from the activated tenant schema (same source FOLLOW-097 wired into SDK config). Without
    emitting data-inquiry-submit-selector in the production snippet, inquiry.started never fires for
    a real tenant — the exact symptom FOLLOW-097 set out to cure (masked in CI by a hand-written e2e
    fixture). Gates TICKET-PILOT-001. Add a test asserting the snippet carries the attribute when the
    activated schema has an inquiry_submit_selector. Rule L applies (verify the production install
    path produces the config a consumer reads).

- id: FOLLOW-117
  title: Fix pilot_frozen Lane C guard key mismatch (cfg.quiz_enabled vs cfg.enabled)
  agent: backend-engineer
  status: DONE # Wave 3 — PR #156 merged to main 2026-05-27 (38a8393); CI green
  started_at: '2026-05-26T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#156' # merged 38a8393
  priority: P2
  estimated_hours: 1
  depends_on: [FOLLOW-106]
  model: sonnet-4.6
  branch: backend-engineer/FOLLOW-117-pilot-frozen-guard-fix
  spec: (RETRO-012 — backlog/FOLLOW_UPS.md FOLLOW-117)
  notes: |
    RETRO-012. The pilot_frozen Lane C guard in apps/control-plane/src/app/api/adapt/route.ts reads
    cfg.quiz_enabled from tenants.quizConfig, but the sole producer (quiz/config/route.ts) writes
    cfg.enabled — so the measurement-window guard is silently inert (false reassurance at go/no-go).
    Align the consumer's flag keys with what the producer writes; add a test that drives the real
    config path. Must land before TICKET-PILOT-001 go-live.

# LANE B — Pilot onboarding on app.estalara.com (P1, BLOCKED until Lane A complete)

- id: TICKET-PILOT-001
  title:
    Onboard app.estalara.com — SDK install, schema activation via Magic Link wizard, run in shadow
    mode 3-5 days
  agent: sdk-engineer + backend-engineer
  status: IN_PROGRESS # sdk-engineer branch sdk-engineer/TICKET-PILOT-001-pilot-launch-shadow opened 2026-05-29
  priority: P1
  estimated_hours: 4
  depends_on:
    [
      FOLLOW-094,
      FOLLOW-098,
      FOLLOW-093,
      FOLLOW-097,
      FOLLOW-105,
      FOLLOW-106,
      FOLLOW-127,
      FOLLOW-122,
      FOLLOW-149,
      ESC-012,
    ]
  model: sonnet-4.6
  spec: backlog/sprint-12/TICKET-PILOT-001.md
  notes: |
    Deferred from Sprint 12 Lane B. depends_on updated 2026-05-25 — dropped CANCELLED FOLLOW-079;
    gated on the full Sprint 13a Lane A (correctness + FOLLOW-105 canonical-route enforcement +
    FOLLOW-106 pilot_frozen flag) being DONE. UNBLOCKED 2026-05-27 (evening): Sprint 13a-hardening
    closed the remaining pre-pilot gates — FOLLOW-127 (detection now produces inquiry_submit_selector
    + interim hand-set value on the 000-app-estalara schema), FOLLOW-122 (pilot dashboard surfaces
    data_source provenance + fail-loud 500), FOLLOW-128/129 (EU GDPR consent disclosures). READY to
    spawn pending CEO go-ahead.
    GO-LIVE CAVEAT (RETRO-019/021, 2026-05-27): two NEW P0 blockers surfaced AFTER the hardening
    tickets merged — FOLLOW-139 (§13.2 banner/Privacy-Notice discloses a 90-day localStorage id that
    does not exist; sessionStorage + no withdrawal erasure) and FOLLOW-141 (pilot inquiry_submit_selector
    has no committed seed on the real pilot row → inquiry tracking may be inert at runtime). Promote
    both into this ticket's deps before the shadow→live flip; FOLLOW-141 must be verified during the
    shadow window (pairs with FOLLOW-092), FOLLOW-139 must clear before EU go-live. Steps: (1) install @estalara/sdk snippet on
    app.estalara.com (Tier 3 Native path via data-estalara-* attributes; wiring in SvelteKit
    +layout.svelte). (2) Run Magic Link wizard to activate tenant schema (000-app-estalara fixture,
    detection_source=data_estalara, confidence ≥0.99). (3) Shadow mode (adaptation runs, directives
    not injected) 3-5 days for baseline. (4) Generate + verify SDK snippet for production embed.
    (5) Set tenants.pilot_frozen=true on the shadow→live flip (FOLLOW-106) — opens the measurement
    window per PILOT_FREEZE_RULE.md.
    MIGRATION SEQUENCING (ESC-012, CEO 2026-05-28 Path 1): pilot tenant row MUST exist in `tenants`
    table BEFORE operator runs `pnpm db:migrate`. Step 4b (new): verify tenant exists → run
    `pnpm db:migrate` → SELECT inquiry_submit_selector to confirm 0016 populated the column. Running
    migrate before wizard creates the tenant triggers 0016's RAISE EXCEPTION and rolls back the whole
    Drizzle txn (including any future 0017+ entries). See ESC-012 + PILOT_RUNBOOK §3.
    ACCEPTANCE ADDITION (RETRO-010 finding #3, CEO 2026-05-25 — canonical-URL safeguard for the
    MANUAL install path, which the FOLLOW-105 buildSnippet wizard fix does NOT cover):
      - [ ] The SvelteKit `+layout.svelte` SDK snippet MUST include
            `data-decision-url="${CONTROL_PLANE_URL}/api"` (absolute host; the SDK appends `/adapt` →
            `https://admin.estalara.com/api/adapt`). A bare host 404s; a relative `/api` resolves
            against the tenant origin (wrong). Never omit it (omission silently disables adaptation).
      - [ ] Smoke assertion: `GET https://admin.estalara.com/api/adapt` returns 200 (NOT 410) for the
            pilot tenant — confirms the SDK reaches the canonical control-plane route, not the
            deprecated Worker. NOTE: spec file backlog/sprint-12/TICKET-PILOT-001.md does not yet
            exist; author it at Lane B spawn and carry these two ACs forward.

- id: FOLLOW-092
  title: Verify cta.clicked producer→ClickHouse path is live for the pilot tenant
  agent: data-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-PILOT-001]
  model: sonnet-4.6
  spec: (to author at spawn — backlog/sprint-13/FOLLOW-092.md)
  notes: |
    RETRO-008 HALF_WIRE_C. Confirm SDK on app.estalara.com emits cta.clicked, ingest writes the rows
    to ClickHouse events for the pilot tenant, and adaptation_decisions has matching session_id rows
    with holdout_group set. Gates treating the cta-lift dashboard as authoritative. Run during the
    TICKET-PILOT-001 shadow window.

- id: TICKET-PILOT-002
  title: Activation runbook + go/no-go checklist + incident response procedure
  agent: architect
  status: BLOCKED
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-PILOT-001, FOLLOW-092]
  model: sonnet-4.6
  spec: backlog/sprint-12/TICKET-PILOT-002.md
  notes: |
    Deferred from Sprint 12 Lane B. Go/no-go checklist must include the RETRO-008 §5a data-provenance
    check (dashboard shows data_source: 'clickhouse', not 'mock') for the PRIMARY metric — otherwise
    the runbook could green-light a pilot whose lift number is fabricated. Lives in
    docs/ops/PILOT_RUNBOOK.md.
```

## Sprint 13a-hardening — Pre-pilot gate (COMPLETE)

**Status:** COMPLETE 2026-05-27 (evening). 4/4 DONE. **Pre-pilot gate CLOSED.** A targeted hardening
wave (surfaced by RETRO-013/017/018 during the Wave 3 + YELLOW Sprint 1 retros) that had to land
before TICKET-PILOT-001 could go live: inquiry tracking had no production producer for the selector,
the EU consent banner was missing DPIA-mandated disclosures, and the pilot dashboard swallowed the
new fail-loud/provenance signals. All four merged; Lane B (TICKET-PILOT-001) is now READY.

**RETRO follow-up alert (RETRO-019→022, written 2026-05-27):** the four retros surfaced new stubs
FOLLOW-139..142, including **two NEW P0 EU-go-live blockers that the CEO must weigh BEFORE spawning
TICKET-PILOT-001**, even though the four hardening tickets themselves are correctly DONE:

- **FOLLOW-139 (P0, RETRO-019):** the now-live FOLLOW-128 §13.2 banner string + FOLLOW-129 Privacy
  Notice promise a "90-day cross-session `localStorage` identifier deleted on Deny/Withdraw" that
  **does not exist** — the SDK fingerprint is tab-lifetime `sessionStorage` and no `removeItem` runs
  on withdrawal. The §13.2 lawful-basis disclosure is therefore factually inaccurate and the
  FOLLOW-129 AC3 staging-QA gate is unexecutable. Either build the 90-day id + erasure or correct
  the docs and re-run the §13.2 balancing test.
- **FOLLOW-141 (P0, RETRO-021):** the pilot's inquiry-conversion wire may be **silently inert at
  runtime** — FOLLOW-127's interim hand-set `inquiry_submit_selector` exists only in a test fixture,
  with no committed seed/migration setting it on the actual pilot tenant row. Commit a reproducible
  pilot seed before relying on `inquiry.started` for the pilot.
- FOLLOW-140 (P1, RETRO-020): §13.1 "7-day retention then deletion" claim has no enforcement.
- FOLLOW-142 (P1, RETRO-022): `/dashboard/analytics` sibling page still swallows the 500 (the fix
  landed only on `/dashboard/pilot`); pairs with FOLLOW-124.

PM to triage FOLLOW-139/141 at TICKET-PILOT-001 spawn (likely promote both into Lane B as go-live
gates).

```yaml
- id: FOLLOW-127
  title: Detection engine must PRODUCE inquiry_submit_selector (close the detection→schema producer)
  agent: ml-engineer + backend-engineer
  status: DONE # PR #161 merged to main 2026-05-27 (6a27841); CI green
  started_at: '2026-05-27T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#161' # merged 6a27841
  priority: P0
  estimated_hours: 4
  depends_on: [FOLLOW-114]
  model: sonnet-4.6
  spec: backlog/FOLLOW_UPS.md FOLLOW-127 (RETRO-017)
  notes: |
    RETRO-017 §3 HALF_WIRE_C / §4a LG-1. FOLLOW-114 closed the schema→snippet hop but no production
    code populated inquiry_submit_selector on a real detected schema. Detection pipeline now produces
    the field (deterministic probe + LLM fallback), /api/detect returns it and /api/schema/activate
    persists it into tenant_site_schemas.schema JSONB; interim hand-set value documented on the
    000-app-estalara pilot schema (AC4) so TICKET-PILOT-001 is unblocked.

- id: FOLLOW-128
  title: Implement DPIA §13.1/§13.2 mandated consent-banner disclosures in the SDK
  agent: compliance-engineer + sdk-engineer
  status: DONE # PR #160 merged to main 2026-05-27 (256b469); CI green
  started_at: '2026-05-27T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#160' # merged 256b469
  priority: P0
  estimated_hours: 2
  depends_on: [FOLLOW-118]
  model: sonnet-4.6
  spec: backlog/FOLLOW_UPS.md FOLLOW-128 (RETRO-018)
  notes: |
    RETRO-018 §3 documentation HALF_WIRE_C. PR #158 documented the §13.1 (consent-denial logging LIA)
    + §13.2 (90-day cross-session fingerprint LIA) but the shipped SDK banner copy disclosed neither.
    §13.2's balancing test passes ONLY if the disclosure gap is remediated. Banner copy (en/pl/es) now
    discloses both the denial-logging notice and the cross-session identifier; DPIA §13.1/§13.2 marked
    remediated. EU pilot consent gate cleared.

- id: FOLLOW-129
  title: Tenant Privacy Notice template + DPO sign-off + consent-withdrawal erasure QA
  agent: compliance-engineer
  status: DONE # PR #159 merged to main 2026-05-27 (10ae1e7); CI green
  started_at: '2026-05-27T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#159' # merged 10ae1e7
  priority: P0
  estimated_hours: 1.5
  depends_on: [FOLLOW-128]
  model: sonnet-4.6
  spec: backlog/FOLLOW_UPS.md FOLLOW-129 (RETRO-018)
  notes: |
    RETRO-018 §4d DG-2. Tenant Privacy Notice template carries both §13.1 + §13.2 disclosure
    paragraphs; DPO sign-off recorded against DPIA §13.1/§13.2 (replaces "DPO review pending"); QA
    verified "Deny"/"Withdraw" removes the cross-session localStorage fingerprint key on staging
    (§13.2 mandated verification). Includes the GREEN balancing test, privacy notice template, and EU
    pre-flight gate.

- id: FOLLOW-122
  title:
    Wire /dashboard/pilot to consume data_source provenance + surface the fail-loud 500 state
    (cta-lift + inquiry-starts)
  agent: backend-engineer
  status: DONE # PR #162 merged to main 2026-05-27 (29c97ab); CI green
  started_at: '2026-05-27T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#162' # merged 29c97ab
  priority: P1
  estimated_hours: 2
  depends_on: [FOLLOW-094, FOLLOW-098]
  model: sonnet-4.6
  spec: backlog/FOLLOW_UPS.md FOLLOW-122 (RETRO-013)
  notes: |
    RETRO-013 (+ RETRO-008 TG-2). FOLLOW-094/098 made the pilot routes fail loud (HTTP 500) and emit
    data_source provenance, but /dashboard/pilot/page.tsx kept a duplicate CtaLiftResponse interface
    (dropped data_source) and gated only on 'summary' in raw — swallowing the 500 into a silent blank
    panel. Page now imports the canonical type, renders a visible "mock data" badge when
    data_source==='mock' and an error banner on non-2xx, so the go/no-go reviewer cannot mistake mock
    for real. Closes the consumer half-wire feeding TICKET-PILOT-002's runbook provenance check.
```

## Sprint 13a-hardening-v2 — P0 EU go-live blockers (DONE)

**Status:** 2/2 DONE 2026-05-28. Both PRs merged to main. PR #164 (FOLLOW-139, e4e37ac) — real
90-day localStorage xid + erasure on withdrawal. PR #165 (FOLLOW-141, 19d11d2) — migration 0016
seeds inquiry_submit_selector on pilot tenant. FOLLOW-143 (producer wiring) + FOLLOW-144 (cadence
disclosure reconciliation) fixed inline in PR #164. RETRO-025 spawned 2026-05-28. Migration 0016
applied to prd (see notes on FOLLOW-141 ticket entry below).

**FOLLOW-140/142 deferred → Sprint 14:** §13.1 7-day consent-audit retention enforcement (P1) and
`/dashboard/analytics` Rule K.2 consumer parity (P1) are not EU go-live blockers at this stage.
Staged for Sprint 14 planning.

```yaml
- id: FOLLOW-139
  title: localStorage 90-day cross-session xid with erasure-on-withdrawal (§13.2 factual fix)
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [FOLLOW-128, FOLLOW-129]
  model: sonnet-4.6
  pr: '#164'
  commit: e4e37ac
  completed_at: '2026-05-28'
  spec: backlog/FOLLOW_UPS.md FOLLOW-139 (RETRO-019)
  notes: |
    CEO decision 2026-05-28: Option C (implement real 90-day localStorage xid, not docs-fix).
    Migrated SDK fingerprint from sessionStorage (tab-lifetime) to localStorage
    (__estalara_xid__) with 90-day TTL rotation. eraseCrossSessionId() wired to onDenied path
    in index.ts. 6 new unit tests (creation, TTL rotation mock, erasure on deny, cache clear).
    DPIA §13.2 balancing test updated from "GREEN contingent on FOLLOW-128" → unconditionally
    GREEN. 631 tests pass (10 session tests). Real CI gates green: Build, Lint, SDK E2E,
    Rule H/J, ClickHouse smoke, Doppler verify, Gitleaks, Auto-detection corpus.
    RETRO-023 inline fixes in same PR #164: FOLLOW-143 (wire getOrCreateCrossSessionId() into
    post-consent init path — key now actually created in real browser sessions) + FOLLOW-144
    (reconcile "rotates monthly" / "every 30 days" across 5 disclosure surfaces to accurate
    "every 90 days" / "every 3 months" wording; consent-banner.test.ts regex updated). Both
    DONE inline. RETRO-025 spawned to verify these inline fixes.

- id: FOLLOW-141
  title: Pilot tenant inquiry_submit_selector DB seed — committed migration 0016
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: [FOLLOW-127]
  model: sonnet-4.6
  pr: '#165'
  commit: 19d11d2
  completed_at: '2026-05-28'
  spec: backlog/FOLLOW_UPS.md FOLLOW-141 (RETRO-021)
  notes: |
    Migration 0016_pilot_inquiry_selector.sql: idempotent jsonb_set on tenant_site_schemas
    for pilot tenant (resolved by slug='000-app-estalara' at apply-time, no hardcoded UUID).
    Sets inquiry_submit_selector = '[data-estalara-slot=''inquiry-submit'']' where null/empty.
    meta/_journal.json updated. 52/52 tests pass (13 new + 39 pre-existing). Real CI gates
    green: Build, Lint, Test (Node 22), Typecheck, SDK E2E, Rule H/J, ClickHouse smoke.
    Prd migration apply: see RETRO-025 / migration-0016-prd note (pending apply result).
```

## Sprint 13b — Adaptive Listings v1.0 intent build (OPEN)

**Sprint goal:** "Build the 18-archetype intent coverage (behavioral observers + chat NLP) per §D.6.
Runs in parallel with the Lane B shadow window ONLY under hard isolation, so the pilot CTA-lift
signal is never contaminated."

**Hard-isolation rule (AI Council `20260525_143939` + `docs/ops/PILOT_FREEZE_RULE.md`):** no change
to pilot-tenant runtime behavior, event schema, dashboard semantics, or DOM during the CTA-lift
measurement window.

- **FOLLOW-099 + FOLLOW-103 touch the pilot tenant directly** (099 changes SDK event emission; 103
  _is_ app.estalara.com DOM adaptation) → **PROHIBITED mid-window**; must land before the window
  opens or after it closes, never during.
- **FOLLOW-087 / FOLLOW-100 / FOLLOW-101 = SHADOW-ONLY** — predictions to a separate namespace, no
  UX effect (enables post-pilot disagreement-rate analysis).
- **FOLLOW-102 = mergeable** — tenant-gated OFF for the pilot tenant.

**Note:** FOLLOW-087 cannot reach green CI until ESC-010 (`DOPPLER_TOKEN_DEV`) + ESC-009
(`E2E_BEARER_TOKEN`) are provisioned.

```yaml
# LANE C — Adaptive Listings v1.0 intent build (13b; parallel with Lane B shadow window ONLY under
# the hard-isolation freeze rule — see docs/ops/PILOT_FREEZE_RULE.md)

- id: FOLLOW-099
  title: SDK behavioral observers + payload schemas (5 new event types)
  agent: sdk-engineer
  status: READY
  priority: P1
  estimated_hours: 8
  depends_on: []
  model: sonnet-4.6
  spec: (to author at spawn — backlog/sprint-13/FOLLOW-099.md)
  notes: |
    photo.dwell, feature.expanded, mortgage_calc.used, filter.applied (facet+value),
    inquiry.started. Payload-aware dispatch through dispatchEvents(). Bundle delta <5KB gzip.
    Foundation for §D.6 Coverage Matrix.
    FREEZE: pilot-tenant-affecting (changes SDK event emission) → must NOT ship to the pilot tenant
    during the CTA-lift measurement window (Sprint 13b hard-isolation rule / PILOT_FREEZE_RULE.md).

- id: FOLLOW-100
  title: SIGNAL_LIKELIHOODS all 18 archetypes + CHAT_INTENT_LIKELIHOODS + applyChatIntentPrior()
  agent: sdk-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 8
  depends_on: [FOLLOW-099]
  model: opus-4.7-xhigh
  spec: (to author at spawn — backlog/sprint-13/FOLLOW-100.md)
  notes: |
    Likelihood calibration + Bayesian prior math → opus-4.7-xhigh. Per §D.1.1 + §D.6. Target:
    ≥13/18 archetypes reach 🟢 Full coverage. Payload-aware (filter.applied likelihoods differ by
    facet value). Thresholds calibrated on synthetic session fixtures (feeds §D.7).

- id: FOLLOW-087
  title: Chat NLP in apps/intent-engine (Haiku 4.5 real-time + Sonnet 4.6 batch)
  agent: ml-engineer
  status: READY
  priority: P1
  estimated_hours: 12
  depends_on: [FOLLOW-040, FOLLOW-063]
  model: opus-4.7-xhigh
  spec: (to author at spawn — backlog/sprint-13/FOLLOW-087.md)
  notes: |
    Code deps (FOLLOW-040/063) are DONE, but this CANNOT reach green CI until ESC-010
    (DOPPLER_TOKEN_DEV) + ESC-009 (E2E_BEARER_TOKEN) secrets are provisioned. Two-tier pipeline per
    §C.3 v2.6, identical 12-dim output schema, model as Doppler config (INTENT_REALTIME_MODEL /
    INTENT_BATCH_MODEL). opus-4.7-xhigh — async semantics + structured-output accuracy.

- id: FOLLOW-101
  title: chat.intent.detected → Bayesian prior bridge in SDK intent.ts
  agent: ml-engineer + sdk-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-087, FOLLOW-100]
  model: opus-4.7-xhigh
  spec: (to author at spawn — backlog/sprint-13/FOLLOW-101.md)
  notes: |
    Double-gated (needs stable chat.intent.detected schema from FOLLOW-087 + applyChatIntentPrior
    from FOLLOW-100). SDK consumes chat.intent.detected, applies strong prior, detectMismatch vs quiz
    prior → quiz.mismatch. Last item in Lane C.

- id: FOLLOW-102
  title: Quiz ON/OFF toggle (SdkConfig + Supabase tenants.quiz_enabled + dashboard)
  agent: sdk-engineer + backend-engineer
  status: READY
  priority: P2
  estimated_hours: 3
  depends_on: []
  model: sonnet-4.6
  spec: (to author at spawn — backlog/sprint-13/FOLLOW-102.md)
  notes: |
    Per §B.1. SdkConfig.quiz.enabled + trigger_after_n_listings; Supabase tenants.quiz_enabled as
    primary SoT (migration 0015); dashboard toggle; snippet generator. Independent — any slot.

- id: FOLLOW-103
  title: app.estalara.com DOM adaptation — corpus fixture + AI Vision slots + 5-slot coverage
  agent: ml-engineer + sdk-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-PILOT-001]
  model: sonnet-4.6
  spec: (to author at spawn — backlog/sprint-13/FOLLOW-103.md)
  notes: |
    Per §E.2.3. Corpus fixture 000-app-estalara; AI Vision (L5, ANTHROPIC_API_KEY in Doppler) detects
    5 TextDirective slots with zero manual markers; 18×5=90 directive coverage assertion; SDK uses
    control-plane route (full 18-archetype playbook). photos + listings-grid ReorderDirective deferred
    → FOLLOW-104.
    FREEZE: this IS the pilot tenant's DOM adaptation → must land BEFORE the measurement window opens
    (it defines "adapted") or AFTER it closes; never mid-window (Sprint 13b hard-isolation rule).
```

## Sprint 14 — pipeline hardening + Conversion Label Loop (MOAT) + archetype persistence (OPEN)

**Added 2026-06-03 (human-directed promotion, outside normal PM Step-7).** Contents:

- **FOLLOW-168/169** — RETRO-028 follow-ups (TICKET-DESC-001 / PR #182): cross-language
  event-contract parity gate + headline anti-hallucination grounding. Independent, unblocked.
- **FOLLOW-170…175** — **Conversion Label Loop** (MASTER_DESIGN §T, v3.9), committed by CEO as the
  data MOAT ("zbieranie danych to nasz istotny MOAT"). Strictly ordered; **FOLLOW-170 (T0) is
  blocking** — every adaptation decision logged without model_version/feature_snapshot/lead_id is
  permanently lost training data, so this must start first.
- **FOLLOW-176** — SDK archetype persistence (Side-task #5): resolved archetype is not persisted
  today (in-memory, cold-start each navigation); persist to sessionStorage + rehydrate in init.

**Related escalation:** **ESC-019 (CLOSED — resolved PR #196, api.estalara.com)** — verification
against the live backend revealed that the production Estalara listing-details API
(`https://app.estalara.com/api/v1/listing/details/...`) 302-redirects an unauthenticated server-side
fetch to the login page, so the helper fails open to an empty `original_description` and generation
is **ungrounded in prod** (silent). The ESC-018 data-shape fix is correct; ESC-019 is the
reachability/auth half and needs a human infra decision. FOLLOW-169 hardens the headline contract
but does NOT fix the source — ESC-019 does.

```yaml
- id: FOLLOW-168
  title:
    Cross-language event-contract parity gate for description.requested (TS Zod ⟷ Python consumer)
  agent: qa-engineer + backend-engineer
  status: READY
  priority: P1
  estimated_hours: 3
  depends_on: []
  source_retro: RETRO-028
  source_ticket: TICKET-DESC-001 (PR #182)
  spec: backlog/sprint-14/FOLLOW-168.md
  notes: |
    The verification ESC-018 lacked: a single shared contract artifact asserted by BOTH the TS
    publisher (DescriptionRequestedEventSchema) and the Python consumer required-set, so the next
    field added to one side without the other fails CI. Cross-language analogue of Rule J (TS↔TS).

- id: FOLLOW-169
  title: Bring _generate_headline to the description anti-hallucination grounding bar (ADR-0009)
  agent: ml-engineer
  status: READY
  priority: P2
  estimated_hours: 4
  depends_on: []
  source_retro: RETRO-028
  source_ticket: TICKET-DESC-001 (PR #182) / ADR-0009
  spec: backlog/sprint-14/FOLLOW-169.md
  notes: |
    Headline LLM call has only an inline "do not invent" instruction (no system prompt, no
    <verified_facts_used> audit block) on the most prominent buyer-facing string. Also: gate SDK
    headline on source === 'ai_cached' (LG-2) + fix stale cache-key docstrings missing :{model} (DG-1).

# ── Conversion Label Loop (MASTER_DESIGN §T, v3.9) — committed 2026-06-03 (CEO: data MOAT) ──
# Strictly ordered: FOLLOW-170 (T0) blocks the rest — unlogged decisions are lost training data forever.

- id: FOLLOW-170
  title: Enrich prediction row — model_version + features_snapshot + lead_id (T0, BLOCKING)
  agent: data-engineer + backend-engineer
  status: READY
  priority: P0
  estimated_hours: 6
  depends_on: []
  produces: [FOLLOW-171, FOLLOW-173, FOLLOW-174]
  source: MASTER_DESIGN §T / RETRO-028
  spec: backlog/sprint-14/FOLLOW-170.md
  notes: |
    EXTEND ClickHouse adaptation_decisions (migration 0013): +lead_id, +model_version,
    +features_snapshot (PII-free JSON), formalize demo_override; REUSE adapt_decision_id as
    prediction_id. logDecisionAsync writes them. BLOCKING — start first.

- id: FOLLOW-171
  title: Persist durable conversion_labels from the feedback route
  agent: backend-engineer + data-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [FOLLOW-170]
  produces: [FOLLOW-173, FOLLOW-174]
  source: MASTER_DESIGN §T
  spec: backlog/sprint-14/FOLLOW-171.md
  pr: '#188'
  completed_at: '2026-06-03T17:44:40Z'
  notes: |
    NEW Postgres conversion_labels (RLS, outcome_class enum) + Zod taxonomy
    packages/shared/src/schemas/conversion-label.ts. Feedback route writes a durable label row
    (today the tuple is discarded into Beta counters). Feedback body gains prediction_id (SDK HANDOFF).

- id: FOLLOW-172
  title: CRM deep-outcome ingest → conversion_labels (PII-stripped)
  agent: backend-engineer + compliance-engineer
  status: DONE
  priority: P1
  estimated_hours: 10
  depends_on: [FOLLOW-171, FOLLOW-179]
  source: MASTER_DESIGN §T
  spec: backlog/sprint-14/FOLLOW-172.md
  pr: '#191'
  completed_at: '2026-06-03T20:08:10Z'
  notes: |
    DONE: POST /api/crm/outcome — HMAC tenant-scoped auth, Zod .strict() allow-list (deep classes
    only), writes via upsertConversionLabel (label_source=system, confidence=1.0) under RLS, + DSR
    erase cascade. Compliance conditions 1-7 (code-review gates) met. RETRO-031 found LG-1: the DSR
    cascade is keyed lead_id=session_id but CRM rows use a tenant opaque token → CRM rows survive
    erasure (Art. 17 gap) = FOLLOW-184 (P1). Go-live gates 8-10 (ROPA/DPIA/TTL/onboarding) tracked
    in FOLLOW-186/187. Tenant onboarding/docs needed before the webhook has a producer (FOLLOW-186).

# ── Conversion Label Loop — post-FOLLOW-172 follow-ups (RETRO-031) — promoted 2026-06-03 ──

- id: FOLLOW-184
  title: DSR erasure must reach CRM-written conversion_labels rows (Art. 17 completeness)
  agent: backend-engineer + compliance-engineer
  status: READY
  priority: P1
  estimated_hours: 5
  depends_on: [FOLLOW-172]
  source: RETRO-031 (LG-1); relates to FOLLOW-180
  spec: backlog/FOLLOW_UPS.md (FOLLOW-184 stub)
  notes: |
    COMPLIANCE/LEGAL — GDPR Art. 17. dsr/erase deletes conversion_labels WHERE lead_id=session_id,
    but CRM rows store lead_id = a tenant opaque token in a DIFFERENT namespace → CRM deep-outcome
    rows are NOT erased today. No live exposure yet (no tenant producer; FOLLOW-186), but MUST fix
    before any CRM-integrated tenant go-live. Unify the lead_id↔erasure-subject mapping (with
    FOLLOW-180) so the cascade reaches CRM rows; keep the empty-lead_id guard.

- id: FOLLOW-185
  title: PG-harness integration test — CRM route write + DSR cascade + two-writer precedence
  agent: data-engineer
  status: READY
  priority: P1
  estimated_hours: 5
  depends_on: [FOLLOW-179, FOLLOW-172]
  source: RETRO-031 (TG-1/TG-2); consolidate with FOLLOW-181 + FOLLOW-183
  spec: backlog/FOLLOW_UPS.md (FOLLOW-185 stub)
  notes: |
    The DSR cascade mis-key (FOLLOW-184) SHIPPED because the test mocks the DB — a real-PG harness
    would have caught it. PM should consolidate FOLLOW-181 + FOLLOW-183 + FOLLOW-185 into ONE
    pgmem/Testcontainers DB-integration ticket: RLS isolation, FK cascade, UNIQUE constraint,
    upsert precedence WHERE, CRM-write + DSR-erase reachability, two-writer convergence.

- id: FOLLOW-187
  title:
    Compliance docs for CRM ingest — ROPA Activity 14 + DPIA §2.3/§2.5 + conversion_labels TTL
    (go-live gates 8-9)
  agent: compliance-engineer + data-engineer
  status: READY
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-172]
  source: RETRO-031 (DG-1); HANDOFFS FOLLOW-172 conditions 8-9
  spec: backlog/FOLLOW_UPS.md (FOLLOW-187 stub)
  notes: |
    Go-live gates (not merge gates). ROPA Activity 14 + DPIA §2.3/§2.5 for CRM deep-outcome ingest;
    13-month TTL cron for conversion_labels (the existing TTL cron does NOT cover this table —
    HANDOFFS:952). Required before tenant go-live. (Onboarding pseudonymity checkbox = FOLLOW-186, P2.)

- id: FOLLOW-173
  title: Conversion-label aggregation + score-vs-actual calibration
  agent: data-engineer
  status: READY
  priority: P1
  estimated_hours: 6
  depends_on: [FOLLOW-170, FOLLOW-171]
  source: MASTER_DESIGN §T
  spec: backlog/sprint-14/FOLLOW-173.md
  notes: |
    Aggregate (tenant, outcome_class, model_version, time); calibration reliability curve per
    model_version. Extends pilot/cta-lift JOIN pattern.

- id: FOLLOW-174
  title: admin label table + manual reclassification
  agent: backend-engineer
  status: READY
  priority: P1
  estimated_hours: 8
  depends_on: [FOLLOW-171, FOLLOW-173]
  source: MASTER_DESIGN §T
  spec: backlog/sprint-14/FOLLOW-174.md
  notes: |
    EXTEND dashboard/{analytics,pilot} + admin/*: joined prediction+outcome table (filters),
    manual reclassify (label_source=manual_admin), calibration view. RLS-respected.

- id: FOLLOW-175
  title: Label-set export for LoRA fine-tuning
  agent: backend-engineer + ml-engineer
  status: READY
  priority: P2
  estimated_hours: 4
  depends_on: [FOLLOW-174]
  source: MASTER_DESIGN §T
  spec: backlog/sprint-14/FOLLOW-175.md
  notes: |
    Per-tenant PII-free (features_snapshot, model_version, score) -> outcome_class export (CSV/JSONL);
    the Y2 fine-tune (§D.5.7) input. RLS-scoped, auditable.

# ── SDK archetype persistence (Side-task #5) — committed 2026-06-03 ──

- id: FOLLOW-176
  title: Persist resolved archetype/intent across listing navigations
  agent: sdk-engineer
  status: READY
  priority: P1
  estimated_hours: 5
  depends_on: []
  source: session investigation 2026-06-03 (Side-task #5)
  spec: backlog/sprint-14/FOLLOW-176.md
  notes: |
    currentIntentState is in-memory, recomputed each load → subsequent listings don't inherit the
    inferred archetype. Persist to sessionStorage (keyed by sessionId), rehydrate in init() before
    cold-start, consent-gated, staleness/version guard. Cross-session (localStorage+TTL) = follow-up.

# ── Dwell-time confidence lift — CEO-directed 2026-06-04 ──

- id: FOLLOW-190
  title: Dwell-time confidence lift — accumulate temporal engagement as intent signal
  agent: sdk-engineer
  status: READY
  priority: P2
  estimated_hours: 4
  depends_on: []
  source: CEO session 2026-06-04 (signal enrichment gap)
  spec: backlog/sprint-14/FOLLOW-190.md
  notes: |
    registerFeedbackListener already tracks dwell for server-side ping, but never feeds it into the
    Bayesian intent engine. Add applyDwellSignal() in intent.ts: at 30s/90s/180s thresholds boost
    confidence of the current leading archetype (local-only, no server call, signal_count unchanged).
    FOLLOW-176 recommended first (dwell-boosted state then also gets persisted), not strictly blocking.

# ── Conversion Label Loop hardening (RETRO-029) — promoted 2026-06-03 ──

- id: FOLLOW-179
  title: conversion_labels uniqueness/upsert + validated insert helper (gates FOLLOW-172/173)
  agent: backend-engineer + data-engineer
  status: DONE
  priority: P1
  estimated_hours: 6
  depends_on: [FOLLOW-171]
  blocks: [FOLLOW-172, FOLLOW-173, FOLLOW-174]
  source: RETRO-029 (LG-1/LG-3, CB-1/CB-2)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-179 stub)
  pr: '#190'
  completed_at: '2026-06-03T19:04:44Z'
  notes: |
    DONE: UNIQUE (tenant_id, prediction_id) + onConflictDoUpdate with class-precedence
    (conversionLabelRank in @estalara/shared: manual_admin > system; purchased > lost >
    contract_signed > offer_made > viewing_booked > no_response; recency tiebreak), validated
    upsertConversionLabel helper (@estalara/db), feedback route switched to the helper, confidence
    convention = 1.0 for system labels. RETRO-030 filed FOLLOW-182 (TS/SQL rank duplication) +
    FOLLOW-183 (real-PG test of the helper) — both P1, not-clean verdict.

- id: FOLLOW-182
  title: eliminate the TS-map↔SQL-CASE precedence duplication in upsertConversionLabel
  agent: backend-engineer
  status: READY
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-179]
  source: RETRO-030 (LG-1/LG-2); CONVENTIONS_PATCH Rule K.1 amendment
  spec: backlog/FOLLOW_UPS.md (FOLLOW-182 stub)
  notes: |
    OUTCOME_CLASS_RANK (TS) and the inline SQL CASE in upsert-conversion-label.ts encode the same
    ordering twice; adding a class silently mis-ranks unless both change. Derive the SQL from the TS
    map (or add a parity gate). Rule K.1 intra-runtime duplication (Rule J does NOT cover it).

- id: FOLLOW-183
  title: direct PG integration test for upsertConversionLabel (precedence WHERE + UNIQUE constraint)
  agent: data-engineer + backend-engineer
  status: READY
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-179]
  source: RETRO-030 (TG-1/TG-2)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-183 stub)
  notes: |
    The helper's SQL precedence WHERE + the UNIQUE constraint are only mock-tested — core dedup
    correctness is unverified against real Postgres. Add a pgmem/Testcontainers test exercising
    collision/upgrade/downgrade-rejection/manual-admin-override. May merge with FOLLOW-181.
```

## Sprint 15 — Pilot unblock + signal bridges + quiz v2.0 + description cache redesign (OPEN)

**Added 2026-06-05 (pm-orchestrator, based on docs/AUDIT-2026-06-04.md + Master_Design v4.0).
Updated 2026-06-06 (pm-orchestrator, Track E added from audit gap analysis).** Four tracks + signal
enrichment:

- **Track A (Pilot unblock, Week 1):** FOLLOW-191/192/193/194
- **Track B (Signal bridges + Quiz v2.0, Week 2–3):** FOLLOW-195/196/197/198/199/200/201/202
- **Track C (Description cache redesign, Week 3–4):** FOLLOW-203/204
- **Track D (Background, Week 4–5):** FOLLOW-205/206
- **Track E (Signal enrichment, Week 2–3):** FOLLOW-207/208/209/210/211 — low-effort, high-ROI
  signal enrichments from 2026-06-05 audit gap analysis. FOLLOW-210 and FOLLOW-211 are P1 because
  they unlock categorical discrimination that behavioral signals cannot provide without payload
  context.

Sprint 14 carry-overs (FOLLOW-170…176, 190) remain in their sprint-14 section and are referenced
here as active. FOLLOW-087 and FOLLOW-099 are background horizon items.

```yaml
# ── Track A: Pilot unblock (Week 1) ──

- id: FOLLOW-191
  title: Verify + deploy Estalara-app DOM hooks
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-06T00:00:00Z'
  completed_at: '2026-06-06T13:30:00Z'
  priority: P0
  estimated_hours: 4
  depends_on: []
  source: Audit F-02, §E.2.3
  spec: backlog/sprint-15/FOLLOW-191.md
  notes: |
    AUDIT COMPLETE (sdk-engineer, 2026-06-06). Slots ARE committed to Estalara-app
    git HEAD (commit 9d2df9d) but production is running an older build — curl of
    app.estalara.com/en/listing/* returns 0 data-estalara-* attributes and no SDK
    script tag. LOCAL app.html working tree points to localhost:9100 (demo override,
    must not be deployed). ACTION REQUIRED from Rafał (CTO): restore app.html, set
    PUBLIC_ESTALARA_SDK_ENABLED=true in prod env, deploy web-master HEAD. Full
    instructions in backlog/HANDOFFS.md + ESCALATIONS.md (ESC-020). PR opened on
    sdk-engineer/FOLLOW-191-verify-deploy-dom-hooks with audit evidence.

- id: FOLLOW-192
  title: ESC-019 — provision internal listing-details URL or service token
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 0
  depends_on: []
  completed_at: '2026-06-04T00:00:00Z'
  pr: '#196'
  source: Audit F-03, ESC-019 (CLOSED — resolved PR #196, api.estalara.com)
  spec: backlog/sprint-15/FOLLOW-192.md
  notes: |
    RESOLVED: PR #196 corrected ESTALARA_BACKEND_URL to api.estalara.com (Spring Boot
    backend, no auth required). Added redirect:manual guard. FOLLOW-192 CLOSED 2026-06-06.

- id: FOLLOW-193
  title: FIX-028 — restore DSR cron + engagement_scores erasure
  agent: backend-engineer + compliance-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  completed_at: 2026-06-06
  depends_on: []
  source: Audit F-10, F-11, CHK-C G-1/G-2
  spec: backlog/sprint-15/FOLLOW-193.md
  notes: |
    G-1: DSR mutation-poll cron restored in vercel.json (AC1) -- DEPLOYMENT GATED on CEO Q3
    Vercel Pro confirmation. Code committed; NOT live until Q3 answered.
    G-2: engagement_scores erasure added to Drizzle transaction (AC2) -- COMPLETE.
    AC3/AC4: Integration tests added to route.test.ts -- all 9 tests pass.
    Migration 0021_engagement_scores.sql + Drizzle schema + RLS policy committed.
    DPIA §8 line 773 compliance gap closed for engagement_scores.

- id: FOLLOW-194
  title: SDK quick fixes batch (F-01/F-08/F-13/F-15/F-16)
  agent: sdk-engineer + backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 5
  depends_on: []
  source: Audit F-01, F-08, F-13, F-15, F-16
  spec: backlog/sprint-15/FOLLOW-194.md
  pr: https://github.com/Pnawrocki9/Adaptive-Listings/pull/201
  completed_at: '2026-06-06'
  notes: |
    5 S-effort fixes shipped in single PR #201. F-01 consent_state enum mapping (mapConsentState);
    F-08 pageType URL detection + data-page-type override (detectPageType); F-13 listing_id in
    adapt body (detectListingId + fetchDirectives listingId param); F-15 previousArchetype guard
    in refreshDirectives (resetAdaptState only on change); F-16 getDemoOverride dedup in route.ts.
    17 new unit tests, 729/729 SDK tests pass, pre-push hooks green.

# ── Track B: Signal bridges + Quiz v2.0 (Week 2–3) ──

- id: FOLLOW-195
  title: SCHEMA-001 — live.signup Zod event schema
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-06T00:00:00Z'
  completed_at: '2026-06-06T00:00:00Z'
  pr: backend-engineer/FOLLOW-195-schema-001-live-signup
  priority: P0
  estimated_hours: 3
  depends_on: []
  produces: [FOLLOW-196, FOLLOW-197, FOLLOW-200]
  source: Audit F-09, Master_Design v3.7 SCHEMA-001
  spec: backlog/sprint-15/FOLLOW-195.md
  notes: |
    LiveSignupEventSchema added to packages/shared/src/schemas/events/live.ts.
    Exported from packages/shared/src/index.ts via events/index.ts.
    EVENT_TYPES updated (44→45). EventSchema discriminated union updated.
    registerFeedbackListener default updated to ['live.signup','inquiry.completed'].
    ClickHouse migration NOT needed (live.signup routes through existing events table).
    45 tests pass in events.test.ts. Handoff note in HANDOFFS.md for FOLLOW-196.

- id: FOLLOW-196
  title: CHAT-001/002 — CustomEvent hooks in Estalara-app
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [FOLLOW-195]
  produces: [FOLLOW-197]
  source: Audit F-04, F-07, CHK-D §A.4
  spec: backlog/sprint-15/FOLLOW-196.md
  pr: sdk-engineer/FOLLOW-196-chat-event-payload-extension
  notes: |
    2026-06-06 DONE. Both CustomEvent payloads extended in Estalara-app:
    1. ChatBot.svelte: userUuid tracked from authStore; user_uuid + is_agent added to
       estalara:chat:message-sent detail.
    2. LiveSessions.svelte: isAgent + userUuid tracked from authStore; event type
       corrected from 'estalara:live:signup' to 'live.signup' (SDK adapter match);
       user_uuid + is_agent added to detail.
    Changes are local to /home/asipi/Projects/Estalara-app/web-master (no GitHub access
    to that repo). PR in Adaptive-Listings documents the work + handoff to FOLLOW-197.

- id: FOLLOW-197
  title: CHAT-003 — SDK listeners for chat/live events
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-07T00:00:00Z'
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#202'
  priority: P0
  estimated_hours: 3
  depends_on: [FOLLOW-195, FOLLOW-196]
  source: Audit F-04, CHAT-003
  spec: backlog/sprint-15/FOLLOW-197.md
  notes: |
    PR #202 merged 2026-06-07 (squash, a2ca89d). deriveLeadId (SHA-256 prefix, Rule L),
    estalara:chat:message-sent and live.signup listeners in index.ts, lead_id in
    fetchDirectives POST body. 16 unit tests AC1-AC7. 728 tests green, 0 TS errors,
    0 lint errors. CI green. Retrospective: spawn retrospective-analyst on PR #202.

- id: FOLLOW-198
  title: Cross-language event contract parity gate (FOLLOW-168 completion)
  agent: qa-engineer + backend-engineer
  status: READY
  priority: P1
  estimated_hours: 3
  depends_on: []
  source: FOLLOW-168 (Sprint 14), Audit addendum
  spec: backlog/sprint-15/FOLLOW-198.md
  notes: |
    Confirm FOLLOW-168 Sprint 14 status. If not done: implement shared JSON schema
    for DescriptionRequestedEvent as CI gate. Drift between TS publisher and Python
    consumer must cause CI failure.

- id: FOLLOW-199
  title: Quiz widget v2.0 — cascading decision tree
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-07T00:00:00Z'
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#203'
  priority: P1
  estimated_hours: 12
  depends_on: []
  produces: [FOLLOW-200, FOLLOW-201]
  source: Audit §10.1, Master_Design §E.4 v4.0
  spec: backlog/sprint-15/FOLLOW-199.md
  notes: |
    Full rewrite quiz-widget.ts: Q1 gate → 3 branches (INWESTOR/WŁASNY_UŻYTEK/CROSS-BORDER),
    2-3 questions, 17 non-neutral leaf archetypes. Trigger: 30s setTimeout on any page (not
    3 listing views). Update quiz-trigger.ts + add 'es' to QuizConfig.language schema.
    Rewrite all tests. 12h estimated. Delegated 2026-06-07 by pm-orchestrator.

- id: FOLLOW-200
  title: quiz_completions MOAT table + completion endpoint
  agent: backend-engineer + data-engineer
  status: READY
  priority: P1
  estimated_hours: 5
  depends_on: [FOLLOW-199]
  source: Audit §10.1, §E.4.8, Master_Design §E.4.8 v4.0
  spec: backlog/sprint-15/FOLLOW-200.md
  notes: |
    New Postgres migration: quiz_completions table (RLS). New POST /api/quiz/completion
    endpoint. SDK dispatches quiz.completed ingest event + calls completion endpoint
    after FOLLOW-199 leaf reached. MOAT data for full CHAT→quiz→adaptation→conversion chain.

- id: FOLLOW-201
  title: applyQuizLeaf() + drift detection activation
  agent: sdk-engineer
  status: READY
  priority: P1
  estimated_hours: 5
  depends_on: [FOLLOW-199]
  source: Audit §10.1, §E.4.4/E.4.5, Master_Design §E.4.4/E.4.5 v4.0
  spec: backlog/sprint-15/FOLLOW-201.md
  notes: |
    Add applyQuizLeaf() pure function to intent.ts (direct assignment ~0.95 confidence).
    Replace applyQuizPrior() call in quiz completion callback. Add driftCandidateArchetype/
    driftCandidateCount/DRIFT_HOLD_COUNT=3 state. Override session archetype after 3
    consecutive mismatch cycles. detectMismatch() already exists at intent.ts:491.

- id: FOLLOW-202
  title: Navigator.language browser detection for quiz
  agent: sdk-engineer
  status: READY
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: Audit §10.1 multilanguage section
  spec: backlog/sprint-15/FOLLOW-202.md
  notes: |
    config.ts:89-91: fallback to navigator.language.slice(0,2) when data-language attr
    absent/unrecognized. Map to supported set (en|pl|es), fallback 'en'. Polish browser
    with no data-language attr → Polish quiz automatically.

# ── Track C: Description cache redesign (Week 3–4) ──

- id: FOLLOW-203
  title: Remove Tier logic from description route
  agent: backend-engineer
  status: READY
  priority: P1
  estimated_hours: 4
  depends_on: []
  produces: [FOLLOW-204]
  source: Audit §10.3, Master_Design §E.7 v4.0, CEO decision 2026-06-05
  spec: backlog/sprint-15/FOLLOW-203.md
  notes: |
    CEO decision 2026-06-05: no Tiers in Adaptive Listings. Remove tier param from
    description route Zod schema, remove TTL_TIER2/TTL_TIER3, remove Tier-1 early-return,
    single max_tokens:500. Remove TTL exports from description-cache.ts. Redis SET without EX.

- id: FOLLOW-204
  title: description_cache_persistent — permanent Postgres description table
  agent: data-engineer + backend-engineer + ml-engineer
  status: READY
  priority: P1
  estimated_hours: 8
  depends_on: [FOLLOW-203]
  source: Audit §10.3, Master_Design §E.7.3 v4.0
  spec: backlog/sprint-15/FOLLOW-204.md
  notes: |
    Co-assigned (3 agents). New Postgres migration: description_cache_persistent (RLS,
    UNIQUE tenant+listing+archetype+locale). Lookup order: DB → Redis → template_fallback.
    Modal Python writes to DB after generation. listing.updated webhook invalidates DB row.
    Admin UI at /dashboard/listings/[id] shows descriptions per archetype. PM must run step 5d
    integration check (producer=Modal Python write, consumer=route lookup) before READY_FOR_REVIEW.

# ── Track D: Background / Security (Week 4–5) ──

- id: FOLLOW-205
  title: F-19 — Demo auth hardening
  agent: backend-engineer
  status: READY
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: Audit F-19
  spec: backlog/sprint-15/FOLLOW-205.md
  notes: |
    route.ts:696-710 presence-only Bearer check → replace with JWT verification using
    DEMO_MODE_JWT_SECRET (env var already exists). Arbitrary Bearer → 401.
    Valid signed JWT → proceeds. Prevents unbounded LLM cost from external parties.

- id: FOLLOW-206
  title: F-05/F-21 — SQL escaping unification
  agent: backend-engineer
  status: READY
  priority: P3
  estimated_hours: 2
  depends_on: []
  source: Audit F-05, F-21
  spec: backlog/sprint-15/FOLLOW-206.md
  notes: |
    Two escaping strategies: route.ts:348 uses \\' (backslash), clickhouse-dsr.ts:99
    uses '' (ANSI SQL correct). Standardize all ClickHouse raw SQL on '' doubling.
    Grep confirms no \\' pattern remains after fix.

# ── Track E: Signal enrichment (Week 2–3) ──
# Low-effort, high-ROI signal enrichments from 2026-06-05 audit gap analysis.
# FOLLOW-210 and FOLLOW-211 are P1 — they unlock categorical discrimination
# that behavioral signals alone cannot provide without payload context.

- id: FOLLOW-207
  title: Referrer URL + device type session-init signals
  agent: sdk-engineer
  status: READY
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: Audit §3 gap analysis (2026-06-05)
  spec: backlog/sprint-15/FOLLOW-207.md
  notes: |
    Capture document.referrer + UTM params at init. Add applyReferrerHints() pure function
    to intent.ts. Add device_type (desktop|mobile) to session.started ingest event and
    SIGNAL_LIKELIHOODS. Investment-keyword referrers shift investor priors; desktop shifts
    investor archetypes; mobile shifts own-use archetypes.

- id: FOLLOW-208
  title: Listing-view RATE as portfolio_builder/flip_investor signal
  agent: sdk-engineer
  status: READY
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: Audit §3 gap analysis (2026-06-05)
  spec: backlog/sprint-15/FOLLOW-208.md
  notes: |
    Track sessionStartedAt alongside listingViewCount. Add applyListingViewRate() pure
    function to intent.ts. Rate ≥3 views/min boosts portfolio_builder/flip_investor.
    Rate ≤0.5 views/min + ≥2 views boosts family_buyer/first_time_buyer/upsizer.
    Include listing_view_rate in session.quality.snapshot ingest payload.

- id: FOLLOW-209
  title: Micro-polls — single yes/no intent prompts as quiz supplement
  agent: sdk-engineer + backend-engineer
  status: READY
  priority: P2
  estimated_hours: 6
  depends_on: [FOLLOW-199]
  source: Audit §3 alternative methods analysis (2026-06-05)
  spec: backlog/sprint-15/FOLLOW-209.md
  notes: |
    New micro-poll.ts: bottom-of-screen toast (not full overlay), 24h localStorage cooldown.
    3 default Polish questions (tenant-configurable). Trigger: quiz dismissed OR 90s elapsed
    AND quiz not completed. New QuizConfig field micro_polls_enabled (default false).
    Admin toggle at /dashboard/quiz. micro_poll.answered added to SIGNAL_LIKELIHOODS.

- id: FOLLOW-210
  title: Favorites/bookmark capture — app.estalara.com save-listing event
  agent: sdk-engineer
  status: READY
  priority: P1
  estimated_hours: 5
  depends_on: []
  source: Audit §3 (2026-06-05) — favorites = highest-value deterministic intent signal
  spec: backlog/sprint-15/FOLLOW-210.md
  notes: |
    Part 1 (Estalara-app repo): dispatch estalara:listing:favorited CustomEvent on save
    (listingId, listingType, priceRange, bedroomCount). Part 2 (this repo): SDK listener
    in index.ts → listing.bookmarked ingest event + applyBehavioralSignal. Payload-conditional
    boosts: bedroomCount≥3 → family_buyer/upsizer; listingType=commercial → commercial_investor.
    PM must run step 5d integration check before READY_FOR_REVIEW.

- id: FOLLOW-211
  title: filter.applied full facet payload schema (prerequisite for FOLLOW-099)
  agent: sdk-engineer
  status: READY
  priority: P1
  estimated_hours: 2
  depends_on: []
  source: Audit §3 — filter.applied discriminating power is in the payload, not the event type
  spec: backlog/sprint-15/FOLLOW-211.md
  notes: |
    Define FilterAppliedPayload Zod schema in packages/shared. Add facet-conditional
    SIGNAL_LIKELIHOODS logic for filter.applied: commercial→commercial_investor+0.20;
    bedrooms_min≥3→family_buyer+0.10; sort by yield/roi→yield_hunter+0.15;
    price_max<median→first_time_buyer+0.08. Prerequisite for FOLLOW-099 to be useful.
```

## YELLOW audit track (parallel) — Sprint 1 (DONE)

**What this track is:** a separate "YELLOW audit" launch-readiness plan with its own `F-NN` ticket
numbering (NOT the FOLLOW-NNN retrospective system). It landed Sprint 1 as a single bundled PR
(#158, `6827305`) on a `claude/**` branch (not an agent-prefix branch). The four F-NN items are
recorded here under reserved FOLLOW numbers 118–121 so QUEUE.md stays the single status SoT; the
canonical F-NN plan lives outside the repo
(`/root/.claude/plans/objective-you-are-a-starry-truffle.md` — root-owned, not readable from this
session). Remaining YELLOW work (Sprint 2–4): F-01, F-04, F-05, F-06, F-07, F-08, UX-01, plus a
measurement dashboard.

```yaml
- id: FOLLOW-118 # YELLOW audit F-02
  title: Wire applyArchetypeHints() cold-start Bayesian prior in SDK init()
  agent: sdk-engineer
  status: DONE # PR #158 merged to main 2026-05-27 (6827305); CI green
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#158'
  priority: P1
  estimated_hours: 0 # bundled in PR #158
  yellow_ticket: F-02
  notes: |
    YELLOW audit F-02. detectSiteSchema() → extractArchetypeHints() called in init() (try/catch
    guarded so detection failure never blocks session init), so the cold-start prior reflects site
    type before the first behavioral event. File: packages/sdk/src/index.ts (block after
    initIntentState()). NOTE: overlaps conceptually with TICKET-AUTO-007 (archetype hints) and the
    Lane C FOLLOW-100 prior math — confirm no double-application of priors when Lane C lands.

- id: FOLLOW-119 # YELLOW audit F-09
  title: Locale-correct slot copy (en/pl/es) threaded SDK config → adapt route decision tree
  agent: sdk-engineer + backend-engineer
  status: DONE # PR #158 merged to main 2026-05-27 (6827305); CI green
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#158'
  priority: P1
  estimated_hours: 0 # bundled in PR #158
  yellow_ticket: F-09
  notes: |
    YELLOW audit F-09. SdkConfig.language extended to 'en'|'pl'|'es'; locale threaded through
    fetchDirectives() POST body into runDecisionTree(), which now selects s.pl ?? s.en / s.es ?? s.en
    instead of always s.en. Spanish strings added to consent-banner, quiz-trigger, quiz-widget. Files:
    packages/sdk/src/core/config.ts, core/adapt.ts, ui/*.ts; apps/control-plane/src/app/api/adapt/route.ts.

- id: FOLLOW-120 # YELLOW audit F-10
  title: Per-tenant/session LLM cost attribution (sessionId/tenantId threading)
  agent: backend-engineer
  status: DONE # PR #158 merged to main 2026-05-27 (6827305); CI green
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#158'
  priority: P1
  estimated_hours: 0 # bundled in PR #158
  yellow_ticket: F-10
  notes: |
    YELLOW audit F-10. sessionId + tenantId added to LlmGatewayInput and threaded through
    runDecisionTree() → logLlmCallAsync(), so ClickHouse cost rows carry real identifiers instead of
    'unknown'. Files: apps/control-plane/src/lib/llm-gateway.ts, api/adapt/route.ts.

- id: FOLLOW-121 # YELLOW audit F-13/F-14
  title:
    GDPR Legitimate Interest Assessment documented in DPIA (consent.denied dispatch + fingerprint)
  agent: compliance-engineer
  status: DONE # PR #158 merged to main 2026-05-27 (6827305); CI green
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#158'
  priority: P1
  estimated_hours: 0 # bundled in PR #158
  yellow_ticket: F-13 + F-14
  notes: |
    YELLOW audit F-13/F-14. LIA documented in docs/compliance/dpia.md §13.1 (consent.denied
    server-side dispatch — audit-trail purpose) and §13.2 (stable cross-session fingerprint — session
    continuity); full three-part LIA test each + required consent-banner disclosure language. No code
    changes per the Option B decision (documentation-only).
```

## Currently in flight

**Nothing actively in flight.** Sprint 13a Lane A is 8/8 DONE (Wave 1+2+3 all merged) and **Sprint
13a-hardening is 4/4 DONE (PR #159–#162) — the pre-pilot gate is CLOSED.** YELLOW audit Sprint 1 is
DONE (PR #158). **Sprint 13a-hardening-v2 is 2/2 DONE (PR #164 FOLLOW-139 e4e37ac, PR #165
FOLLOW-141 19d11d2).** RETRO-023/024 written 2026-05-28. FOLLOW-143 (producer wiring) + FOLLOW-144
(cadence reconciliation) fixed inline in PR #164; RETRO-025 spawned 2026-05-28 to verify those
inline fixes (see Master Design v3.4 for verdict). **Next up: CEO decision on spawning Lane B
(TICKET-PILOT-001) — now conditioned on RETRO-025 verdict + migration 0016 prd apply result (see
Master Design v3.4).**

**History — Sprint 13a Lane A — Wave 1+2+3 MERGED (Scenario D Sequential, then Wave 3 parallel,
merged 2026-05-27).**

- **FOLLOW-105 — DONE (merged 2026-05-25).** Substep 1a (PR #148) + Wave 1 substeps 1b/1c/1d (PR
  #150, `bf0585d`) both on main. Canonical `/api/adapt` enforced (buildSnippet + SDK Zod), Worker
  410 Gone + structured logging, ADR-0006 ACCEPTED, ADR-0004 contract replaced (live-wins),
  adapt_decision_id + ClickHouse migration 0012, CI Rule H adapt gate. §Snapshot.7 risk #1
  OPEN→RESOLVED. retrospective-analyst spawned on PR #150. Follow-ons: FOLLOW-107 (Worker handler
  removal, Sprint 14, after 7-day zero-traffic window), FOLLOW-108 (explainability_id), FOLLOW-109
  (SDK Zod rollout).
- **Wave 2 — DONE (merged 2026-05-26).**
  - **FOLLOW-097** (sdk-engineer, sonnet-4.6) — PR #151 (`3cf05ee`). Threaded
    `inquiry_submit_selector` from tenant schema → SDK config → `setupObservers()` so
    `inquiry.started` fires in prod (RETRO-008/009). E2E + SPA race-condition tests.
  - **FOLLOW-106** (backend-engineer, sonnet-4.6) — PR #152 (`b83e6c0`). `tenants.pilot_frozen`
    migration + schema + runtime warn in the **control-plane** adapt route (NOT the 410 Worker —
    RETRO-010 finding #2). Migration 0015: prd ✅ applied; dev+stg ❌ (DATABASE_URL_ADMIN unset in
    Doppler — not a pilot blocker, prd is what matters).
  - retrospective-analyst spawned on PR #151 + #152.
- **Wave 3 — DONE (spawned 2026-05-26, merged 2026-05-27, 5 parallel workers, CEO go-ahead).** All
  on agent-prefix branches for push-CI:
  - **FOLLOW-094** (data-engineer, sonnet-4.6, P1) — PR #153 (`9f32aa8`). cta-lift route fail-loud
    on ClickHouse error + expose `data_source` provenance (RETRO-008 CB-1, Rule K.2).
  - **FOLLOW-098** (backend-engineer, sonnet-4.6, P2) — PR #155 (`4ce6e37`). Same fail-loud +
    provenance treatment on /api/pilot/inquiry-starts (RETRO-009).
  - **FOLLOW-093** (data-engineer, sonnet-4.6, P1) — PR #154 (`a7d9c03`). Reconcile the two
    divergent CTA-lift query paths onto one schema vocabulary (RETRO-008).
  - **FOLLOW-114** (sdk-engineer, sonnet-4.6, P0 — RETRO-011) — PR #157 (`f882dae`). Emit
    `data-inquiry-submit-selector` in `buildSnippet()` (DetectionPreview.tsx) so `inquiry.started`
    fires for real tenants. Gates TICKET-PILOT-001.
  - **FOLLOW-117** (backend-engineer, sonnet-4.6, P2 — RETRO-012) — PR #156 (`38a8393`). Fix the
    inert pilot_frozen Lane C guard (consumer reads `cfg.quiz_enabled`, producer writes
    `cfg.enabled`) in the adapt route.
- **YELLOW audit Sprint 1 — DONE (PR #158, `6827305`, merged 2026-05-27).** Parallel track, bundled:
  FOLLOW-118 (F-02 cold-start prior), FOLLOW-119 (F-09 locale copy), FOLLOW-120 (F-10 LLM
  attribution), FOLLOW-121 (F-13/F-14 GDPR LIA). See the YELLOW audit track section above.

CEO ratified Decision 4C (add adapt_decision_id, defer explainability_id → FOLLOW-108), Decision 5A
(SDK Zod validation in 1b), Decision 6D (sequential FOLLOW-105 → Wave 2 → Wave 3). ESC-011 (CI not
triggering) RESOLVED — branch renamed to `architect/**` for push-CI + Actions budget bumped. Note:
DOPPLER_TOKEN_DEV (ESC-010) + E2E_BEARER_TOKEN (ESC-009) still outstanding for Lane B / full E2E.

## Awaiting human review (0 PRs)

_All Wave 3 PRs (#153–#157), YELLOW audit Sprint 1 (#158), and Sprint 13a-hardening (#159–#162)
merged to main 2026-05-27. Nothing awaiting review._

## Recent merges

- 2026-05-27 (evening) — Sprint 13a-hardening (4 PRs, pre-pilot gate CLOSED): FOLLOW-127 (PR #161,
  `6a27841`) detection engine produces `inquiry_submit_selector` + interim hand-set pilot value;
  FOLLOW-128 (PR #160, `256b469`) DPIA §13.1/§13.2 consent-banner disclosures shipped in SDK
  (en/pl/es); FOLLOW-129 (PR #159, `10ae1e7`) tenant Privacy Notice template + DPO sign-off + GREEN
  balancing test + consent-withdrawal erasure QA + EU pre-flight gate; FOLLOW-122 (PR #162,
  `29c97ab`) `/dashboard/pilot` consumes `data_source` provenance + surfaces fail-loud HTTP 500.
  TICKET-PILOT-001 (Lane B) now READY. retrospective-analyst to run on #159–#162 (RETRO-019→022).
- 2026-05-27 — YELLOW audit Sprint 1 (PR #158, `6827305`): parallel-track launch-readiness bundle —
  F-02 `applyArchetypeHints()` cold-start prior wired in SDK `init()`; F-09 locale-correct slot copy
  (en/pl/es) threaded SDK config → adapt route decision tree (+ Spanish UI strings); F-10
  per-tenant/ session LLM cost attribution (no more `'unknown'` in ClickHouse cost rows); F-13/F-14
  GDPR LIA documented in `docs/compliance/dpia.md` §13.1/§13.2 (no code). Tracked as
  FOLLOW-118/119/120/121. Branch `claude/intelligent-dirac-3mBS1` (non-agent-prefix — separate
  track).
- 2026-05-27 — Wave 3 (Sprint 13a Lane A, 5 parallel PRs): FOLLOW-094 (PR #153, `9f32aa8`) cta-lift
  fail-loud + `data_source` provenance; FOLLOW-093 (PR #154, `a7d9c03`) reconcile CTA-lift query
  vocabulary onto canonical events schema; FOLLOW-098 (PR #155, `4ce6e37`) inquiry-starts
  fail-loud + provenance; FOLLOW-117 (PR #156, `38a8393`) align pilot_frozen Lane C guard to read
  `cfg.enabled`; FOLLOW-114 (PR #157, `f882dae`) emit `data-inquiry-submit-selector` in onboarding
  snippet. Sprint 13a Lane A now 8/8 DONE. retrospective-analyst to run on #153–#158.
- 2026-05-26 — Wave 2: FOLLOW-097 (PR #151, `3cf05ee`) threaded `inquiry_submit_selector` from
  tenant schema → SDK config → `setupObservers()` so `inquiry.started` fires in prod; FOLLOW-106 (PR
  #152, `b83e6c0`) added `tenants.pilot_frozen` flag + control-plane adapt-route Lane C warning,
  migration 0015 applied to prd (dev/stg deferred — DATABASE_URL_ADMIN unset). retrospective-analyst
  spawned on both. Wave 3 (FOLLOW-094/098/093) unblocked.
- 2026-05-25 — FOLLOW-105 Wave 1 (PR #150, `bf0585d`): canonical /api/adapt enforcement —
  buildSnippet emits `data-decision-url=${CONTROL_PLANE_URL}/api`, SDK Zod-validates the adapt
  response, Worker /api/adapt → 410 Gone + structured logging, adapt_decision_id in all arms +
  ClickHouse migration 0012, ADR-0004 contract replaced (live-wins) + ADR-0006 ACCEPTED, CI Rule H
  adapt drift + Worker-410 gates. §Snapshot.7 risk #1 RESOLVED. Supersedes closed #149 (branch
  renamed for push-CI; ESC-011). FOLLOW-107/108/109 follow-on stubs.
- 2026-05-25 — FOLLOW-105 substep 1a (PR #148): read-only SDK/snippet/endpoint audit — surfaced 5
  findings (3 BLOCKERS + 2 RISKS + 1 INFO); `docs/audits/FOLLOW-105-1a-sdk-audit.md`
- 2026-05-25 — TICKET-PILOT-003 (PR #146): CTA lift dashboard — /api/pilot/cta-lift + two-proportion
  z-test lib (pilot-stats.ts) + conversion funnel + by-archetype table + /dashboard/pilot unified
  page (merged with TICKET-PILOT-004 union); FOLLOW-086 stub; 26 tests
- 2026-05-25 — TICKET-PILOT-004 (PR #144): Inquiry starts tracking — SDK observer for
  inquiry.started, /api/pilot/inquiry-starts route, InquiryStartsPanel; FOLLOW-091 stub; 9 tests
- 2026-05-25 — FOLLOW-078 (PR #145): DSR failure alerting — stuck mutation detection (>1h pending)
  - Sentry captureMessage(warning) with row metadata; DSR_ALERTING.md + DPIA §8 update; commitlint
    PILOT- prefix fix; 11 tests
- 2026-05-25 — FOLLOW-075 (PR #142): CRON_SECRET auth hardened on /api/dsr/mutation-poll — returns
  401 when CRON_SECRET unset; .env.example updated; ≥3 auth unit tests
- 2026-05-25 — FOLLOW-081 (PR #143): ClickHouse mutation-poll integration test — 3 scenarios
  (pending→done, not-found, idempotent retry); soft-skip without CLICKHOUSE_URL
- 2026-05-24 — FOLLOW-039 (PR #139): ClickHouse DSR hard-delete — Art. 17 erasure on
  adaptation_decisions + events + llm_calls + session_quality; Vercel-Cron poller + 3-retry backoff;
  dsr_clickhouse_mutations Postgres operational state table; EU pilot gate cleared; Master Design
  v2.4 + §H.1.1 added
- 2026-05-24 — FOLLOW-068 (PR #137): demo-integration CI job — NEXT_PUBLIC_TEST_E2E=true; soft-skip
  until DOPPLER_TOKEN + E2E_BEARER_TOKEN provisioned (ESC-009 carry-forward); E2E_BEARER_TOKEN
  beforeAll() precheck added
- 2026-05-24 — FOLLOW-063 (PR #135): archetype-embeddings-not-null CI precheck +
  post-migrate-seed.yml idempotent auto-seed; both soft-skip until DOPPLER_TOKEN_DEV provisioned
- 2026-05-24 — FOLLOW-069 (PR #136): HMAC compat test SDK↔server (byte-identical hex digest
  assertion across N key/body pairs) + Bearer-only rejection regression test; closes RETRO-006 LG-3
- 2026-05-24 — FOLLOW-040 (PR #138): Doppler service token + doppler-run wrapper; DOPPLER_TOKEN as
  GitHub Actions secret; coordinate with FOLLOW-063 seed step
- 2026-05-23 — FOLLOW-051 (PR #133): HMAC-SHA256 tenant-scoped auth on POST /api/adapt/feedback;
  X-Estalara-Signature header; constant-time compare; ADAPT_API_KEY ops fallback; threat model
  documented in Master Design §V.3.2
- 2026-05-23 — FOLLOW-061 (PR #134): Snapshot.1 re-verification added to sprint-close checklist in
  `docs/AGENT_WORKFLOW.md` + `.claude/agents/pm-orchestrator.md` step 8; OP §Y.3 now structurally
  enforced
- 2026-05-22 — FOLLOW-046 (PR #132): Automate listing embedding seeding — fire-and-forget trigger in
  POST /api/schema/activate; DEMO_LISTING_MANIFEST seeds 12 listings on demo tenant activation
- 2026-05-22 — FOLLOW-043 (PR #131 + 6 fix-commits): Archetype embedding vectors seed script —
  scripts/seed-archetype-embeddings.ts; pnpm seed:archetypes + workflow_dispatch action; manual
  one-shot only (CI auto-seed tracked as FOLLOW-063)
- 2026-05-22 — FOLLOW-055 (PR #130): E2E integration test detect→activate→adapt→SDK; 5 static
  contract tests in CI + 5 E2E steps guarded by NEXT_PUBLIC_TEST_E2E=true (CI activation tracked as
  FOLLOW-068)
- 2026-05-22 — FOLLOW-047 (PR #129): Reject null tenant_id with 403 STAFF_TENANT_CONTEXT_MISSING on
  detect + activate routes
- 2026-05-22 — FOLLOW-052 (PR #128): Mirror-code byte-identity CI check — scripts/check-mirror-
  files.sh + JSON manifest + rule-j CI job + lefthook pre-push (Rule J live)
- 2026-05-22 — FOLLOW-041 + FOLLOW-042 (PR #127): SDK feedback ping on outcome events + variant
  field on AdaptResponse; closes bandit feedback loop
- 2026-05-22 — FOLLOW-018 (PR #126): Real tenant schema lookup + cache invalidation on activation;
  `invalidateTenantSchemaCache()` wired into activate path; Upstash Redis bounded TTL
- 2026-05-22 — TICKET-AUTO-006-POLISH (PR #125): Detection Preview + Save & Activate — schema
  activation + tenant promotion to `active` + SDK snippet generation
- 2026-05-21 — TICKET-030 (PR #124): Magic Link onboarding wizard UI —
  `idle → analyzing → detected | needs_review | failed` state machine; real API wiring (no mocks);
  11 tests
- 2026-05-21 — FOLLOW-019 (PR #123): Replace deterministicScore djb2 hash with cosine similarity;
  `listing_embeddings` pgvector table (migration 0013) + `POST /api/listings/embed` admin endpoint;
  djb2 fallback preserved per-listing
- 2026-05-21 — FOLLOW-007 (PR #122): Wire Thompson sampling bandit — canonical
  `packages/shared/src/bandit.ts`; `POST /api/adapt/feedback` fire-and-forget;
  `adaptation_decisions.variant` ClickHouse column (migration 0010); 42 new tests
- 2026-05-21 — TICKET-033 (PR #121): Schema Discovery API — JWT + SSRF + 60s cache + wizard
  response; persists to `tenant_site_schemas`; `DetectResponseSchema` in `@estalara/shared`
- 2026-05-15 — TICKET-GDPR-002 (PR #118): DSR endpoints — OTP flow + Resend email + ClickHouse audit
  log; `dsr_verifications` table + Drizzle migration 0011
- 2026-05-15 — TICKET-GDPR-003 (PR #116): LIA template v1.0 + `tenant_compliance_records` table +
  GET/POST/DELETE CRUD API; `LiaRecordSchema` in packages/shared
- 2026-05-15 — TICKET-GDPR-004 (PR #117): Consent state gate — `consentGate()` in decision-api +
  `consent_required` on tenants + SDK `fetchDirectives()` sends consent_state; ClickHouse
  `gate_reason` column (migration 0008); Drizzle migration 0010
- 2026-05-15 — TICKET-GDPR-001 (PR #111): DPIA + ROPA — EU/UK/CCPA/UAE PDPL compliance docs
- 2026-05-15 — TICKET-DESC-PIVOT-001 v1.7.1 (PR #115): 18 archetype voice patterns (EN/PL/ES) +
  WHITELIST guard-rails in Modal job + `verified_facts_used` audit trail + MASTER_DESIGN v1.7.1
- 2026-05-14T14:21:36Z — TICKET-ARCH-003 (PR #95): per-ticket retrospective learning loop + /retro
  slash command; retrospective-analyst agent (Opus 4.7); RETRO-001 seeded
- 2026-05-14T00:00:00Z — TICKET-ARCH-002 (PR #93): Master Design bumped to v1.6; architectural
  updates applied to MASTER_DESIGN.md
- 2026-05-14T00:00:00Z — TICKET-046 (PR #92, commit b6368b6): 18 archetypes × 3 variants +
  copy_template; fixes feature-section → feature slot name
- 2026-05-14T00:00:00Z — TICKET-REORDER-001 (PR #91, commit 40650aa): ReorderDirective DOM reorder +
  listing grid re-ranking per archetype
- 2026-05-14T00:00:00Z — TICKET-FIX-019 (PR #88): ingest idempotency KV key scoped to tenant
- 2026-05-14T00:00:00Z — TICKET-FIX-018 (PR #89): JWT token in createTenantClient for RLS
  enforcement
- 2026-05-14T00:00:00Z — TICKET-FIX-017 (PR #90): API key auth gate on GET /api/adapt
- 2026-05-14T00:00:00Z — TICKET-FIX-014 + FIX-016 (PR #87): JWT tenant auth + demo POST endpoint
- 2026-05-14T00:00:00Z — TICKET-FIX-013 (PR #86): JWT HMAC-SHA-256 signature verification
- 2026-05-14T00:00:00Z — TICKET-FIX-015 (PR #85): AdaptRequestSchema accepts confidence/similarity
- 2026-05-14T00:00:00Z — TICKET-FIX-010 (PRs #83, #84): IntentState wired into fetchDirectives +
  auth header alignment
- 2026-05-14T00:00:00Z — TICKET-FIX-012 (PR #82): real API key validation + per-tenant LLM daily
  spend cap
- 2026-05-14T00:00:00Z — TICKET-FIX-011 (PR #81): seed 18 archetype rows in archetype_embeddings
- 2026-05-14T00:00:00Z — TICKET-AB-001 (PR #80, commit 0e5cc0c): A/B holdout + Thompson sampling
  bandit
- 2026-05-13T00:00:00Z — TICKET-AUTO-005 (PR #79, commit cfecf50): corpus CI gate — precision/recall
  validation for 24 platforms
- 2026-05-13T00:00:00Z — TICKET-AUTO-004 + AUTO-006 (PR #77, commit eb463ab): auto-detect techniques
  7-11 + price parser + Detection Preview UI skeleton
- 2026-05-13T00:00:00Z — TICKET-AUTO-007 (PR #76, commit 5c36aaf): archetype hints from site
  structure — Bayesian prior seeding
- 2026-05-13T00:00:00Z — TICKET-AUTO-003 (PR #74, commit f6f4e15): auto-detection techniques 1–6 —
  deterministic pipeline
- 2026-05-13T00:00:00Z — TICKET-AUTO-002 (PR #73, commit 76c2c88): TenantSiteSchema types +
  detection pipeline skeleton
- 2026-05-13T00:00:00Z — TICKET-AUTO-001 (PR #72, commit 7400d63): auto-detection corpus — 24
  fixtures + CI gate skeleton
- 2026-05-13T00:00:00Z — TICKET-DQS-001 (PR #71, commit 7678aa3): convergence metrics — DQS
  per-session tracking
- 2026-05-13T00:00:00Z — TICKET-ADP-002 (PR #70, commit e9ccde4): LiteLLM gateway — Haiku/Sonnet
  routing
- 2026-05-12T21:33:43Z — TICKET-ADP-004 (PR #69, commit 82f0e42): SDK Tier 1 DOM mutations — full
  applyDirectives() implementation
- 2026-05-11T00:00Z — TICKET-ARCH-001 (commit f0aca06): Expand archetype ontology — 3 → 18
  archetypes
- 2026-05-11T00:00Z — TICKET-EMB-001 (commit be4e366): Embeddings pipeline — pgvector + fingerprint
  matching
- 2026-05-11T00:00Z — TICKET-DB-001 (commit c69ee9c): Replace API stubs with real Drizzle DB queries
- 2026-05-05T01:25Z — TICKET-031 (PR #50): SDK Tier 1 core — config, session, events, observer
  - config reader, SHA-256 session fingerprint, event dispatch, scroll/intersection/click observers.
  - Fixed .gitleaks.toml: moved false-positive paths from invalid `files` key to `paths` in global
    allowlist.
- 2026-05-05T00:00Z — TICKET-FIX-009 (PR #49): DB client tests rewritten without dynamic imports
- 2026-05-05T00:00Z — TICKET-DEMO-002 (PR #48): Demo mock-up listings page — 12 listings, filters
- 2026-05-05T00:00Z — TICKET-DEMO-001 (PR #47): Demo mode foundation — sessions API + JWT
- 2026-05-04T00:00Z — TICKET-FIX-008 (PR #46): CI workspace fix + prettierignore
- 2026-05-04T00:00Z — TICKET-FIX-006/007 (PR #45): DB test isolation + turbo outputs
- 2026-05-04T00:00Z — TICKET-027/028 (PR #44): Dashboard layout + tenant overview page
- 2026-05-04T00:00Z — TICKET-026 (PR #43): Analytics API stub — tenant dashboard data endpoint
- 2026-05-04T00:00Z — TICKET-024 (PR #42): Decision-API adapt endpoint stub
- 2026-05-04T00:00Z — TICKET-029 (PR #41): Stripe billing stub — webhook handler
- 2026-05-04T00:00Z — TICKET-023 (PR #40): Multi-tenancy context middleware
- 2026-05-04T00:00Z — TICKET-022 (PR #39): Tenant auth — JWT claims, RBAC guards
- 2026-05-04T00:00Z — TICKET-021 (PR #38): Core Postgres schema for Sprint 2
- 2026-05-04T12:00Z — TICKET-020 (PR #36): Drizzle ORM setup
- 2026-05-04T07:25Z — fix(ci) (PR #30): Exclude e2e from unit test run + fix turbo dependency graph
- 2026-05-03T20:58Z — TICKET-015 (PR #29): Modal stream consumer Redpanda→ClickHouse
- 2026-05-03T15:21Z — TICKET-014 (PR #27): ClickHouse DDL migrations
- 2026-05-03T13:55Z — TICKET-016 (PR #26): E2E smoke test ingest→ClickHouse
- 2026-05-03T10:51Z — TICKET-018/019 fix (PR #25): Missing span attributes + README paths
- 2026-05-01T21:37Z — TICKET-018+019 (PR #24): Ingest observability + error handling
- 2026-05-01T10:46Z — TICKET-025 (PR #20): control-plane Next.js + Tailwind + shadcn/ui skeleton
