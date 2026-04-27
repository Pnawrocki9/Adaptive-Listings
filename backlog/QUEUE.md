# Backlog Queue

**Updated 2026-04-27 with Paczka 2 contents.** This file replaces `backlog/QUEUE.md` from Paczka 1.

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

| Sprint | Weeks | Theme                                                                | Tickets | DONE | IN_PROG | READY | BLOCKED |
| ------ | ----- | -------------------------------------------------------------------- | ------- | ---- | ------- | ----- | ------- |
| 0      | 1     | Foundation (repo, monorepo, CI, scaffolding, secrets, observability) | 9       | 2    | 0       | 7     | 0       |
| 1      | 2     | Ingest baseline + event schema                                       | 10      | 0    | 0       | 0     | 10      |
| 2      | 3     | Postgres + tenant auth + dashboard skeleton                          | 10      | 0    | 0       | 0     | 10      |
| 2.5    | 4     | Auto-Onboarding pipeline (NEW v1.1)                                  | 6       | 0    | 0       | 0     | 6       |
| 3      | 5     | SDK Tier 1 Observer + Magic Link UI                                  | 10      | 0    | 0       | 0     | 10      |
| 4      | 6     | Intent ontology v1 + Modal scaffolding                               | tbd     | —    | —       | —     | tbd     |
| 5      | 7     | LLM gateway + intent extraction from chat                            | tbd     | —    | —       | —     | tbd     |
| 6      | 8     | Embeddings + archetype matching + decision API                       | tbd     | —    | —       | —     | tbd     |
| 7      | 9     | SDK Tier 2 Augment + adaptation directives                           | tbd     | —    | —       | —     | tbd     |
| 8      | 10    | A/B holdout framework + analytics dashboard                          | tbd     | —    | —       | —     | tbd     |
| 9      | 11    | DPIA + ROPA + DSR + fair-housing + continuous validation             | tbd     | —    | —       | —     | tbd     |
| 10     | 12    | Multi-region deploy + observability + load tests                     | tbd     | —    | —       | —     | tbd     |
| 11     | 13    | Pilot onboarding + docs + launch checklist                           | tbd     | —    | —       | —     | tbd     |

**Sprint 2.5 is new — added in Paczka 2 based on Master Design v1.1 sections B.4-B.7
(auto-onboarding).**

Detailed tickets for Sprints 0–3 in Paczka 2 (this delivery). Sprints 4–11 ship in Paczka 3.

## Active sprint: Sprint 0 — Foundation

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
  status: READY_FOR_REVIEW
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-001]
  assigned_to: devops-engineer
  started_at: '2026-04-27T14:40:00Z'
  completed_at: '2026-04-27T19:20:00Z'
  pr: '#7'
  spec: backlog/sprint-0/TICKET-003.md

- id: TICKET-004
  title: Pre-commit security hooks (Lefthook + git-secrets + commit lint)
  agent: devops-engineer
  status: READY
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-001]
  spec: backlog/sprint-0/TICKET-004.md

- id: TICKET-005
  title: Add apps/auto-detect Python placeholder app (NEW v1.1)
  agent: devops-engineer
  status: READY
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-001]
  spec: backlog/sprint-0/TICKET-005.md

- id: TICKET-006
  title: Add packages/platform-templates TS placeholder (NEW v1.1)
  agent: devops-engineer
  status: READY
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-001]
  spec: backlog/sprint-0/TICKET-006.md

- id: TICKET-007
  title: Update README + CLAUDE.md to reflect 10 apps / 10 packages
  agent: architect
  status: BLOCKED
  priority: P2
  estimated_hours: 1
  depends_on: [TICKET-005, TICKET-006]
  spec: backlog/sprint-0/TICKET-007.md

- id: TICKET-008
  title: Cloudflare account setup + Wrangler Terraform module
  agent: devops-engineer
  status: READY
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-001, TICKET-002]
  spec: backlog/sprint-0/TICKET-008.md

- id: TICKET-009
  title:
    Vendor account stubs (Supabase + ClickHouse + Modal + Redpanda + Upstash) Terraform skeleton
  agent: devops-engineer
  status: READY_FOR_REVIEW
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-001, TICKET-002]
  assigned_to: devops-engineer
  started_at: '2026-04-27T08:00:00Z'
  completed_at: '2026-04-27T14:15:00Z'
  pr: '#6'
  spec: backlog/sprint-0/TICKET-009.md
```

## Sprint 1 — Ingest baseline + event schema (BLOCKED on Sprint 0)

```yaml
- id: TICKET-010
  title: ADR-0003 Event schema design and versioning strategy (already drafted)
  agent: architect
  status: BLOCKED
  priority: P0
  estimated_hours: 2
  depends_on: [TICKET-009]
  spec: backlog/sprint-1/TICKET-010.md

- id: TICKET-011
  title: Zod schemas in packages/shared for all event types (envelope + 30 type schemas)
  agent: architect
  status: BLOCKED
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-010]
  spec: backlog/sprint-1/TICKET-011.md

- id: TICKET-012
  title: Cloudflare Worker ingest MVP (validate + auth + push to Redpanda)
  agent: backend-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-011]
  spec: backlog/sprint-1/TICKET-012.md

- id: TICKET-013
  title: Durable Object rate limiting per tenant per minute
  agent: backend-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-012]
  spec: backlog/sprint-1/TICKET-013.md

- id: TICKET-014
  title: ClickHouse table DDL + first migration (events table partitioned)
  agent: data-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-009, TICKET-011]
  spec: backlog/sprint-1/TICKET-014.md

- id: TICKET-015
  title: Stream consumer Modal scaffold (Redpanda subscribe → ClickHouse insert)
  agent: data-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-014, TICKET-012]
  spec: backlog/sprint-1/TICKET-015.md

- id: TICKET-016
  title: End-to-end smoke test (curl ingest → ClickHouse query)
  agent: qa-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-015]
  spec: backlog/sprint-1/TICKET-016.md

- id: TICKET-017
  title: Ingest load test 10K req/s (k6 scripts)
  agent: qa-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-016]
  spec: backlog/sprint-1/TICKET-017.md

- id: TICKET-018
  title: Ingest observability (OTel traces + Sentry + structured logs)
  agent: devops-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-012, TICKET-003]
  spec: backlog/sprint-1/TICKET-018.md

- id: TICKET-019
  title: HTTP error handling + idempotency contract (event_id deduplication)
  agent: backend-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-012]
  spec: backlog/sprint-1/TICKET-019.md
```

## Sprint 2 — Postgres + tenant auth + dashboard skeleton (BLOCKED)

```yaml
- id: TICKET-020
  title: Drizzle ORM setup + migrations folder structure + tooling
  agent: backend-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-009]
  spec: backlog/sprint-2/TICKET-020.md

- id: TICKET-021
  title: tenants table schema + RLS policies + auto-onboarding fields (v1.1)
  agent: backend-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 5
  depends_on: [TICKET-020]
  spec: backlog/sprint-2/TICKET-021.md

- id: TICKET-022
  title: users table + tenant membership + Supabase Auth sync
  agent: backend-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-021]
  spec: backlog/sprint-2/TICKET-022.md

- id: TICKET-023
  title: API key model (public + secret keys, HMAC-SHA256, rotation)
  agent: backend-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 5
  depends_on: [TICKET-021]
  spec: backlog/sprint-2/TICKET-023.md

- id: TICKET-024
  title: JWT signing + tenant scoping middleware (Hono + Next.js)
  agent: backend-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 5
  depends_on: [TICKET-022, TICKET-023]
  spec: backlog/sprint-2/TICKET-024.md

- id: TICKET-025
  title: apps/control-plane Next.js skeleton + Tailwind + shadcn/ui setup
  agent: backend-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-001, TICKET-002]
  spec: backlog/sprint-2/TICKET-025.md

- id: TICKET-026
  title: Tenant signup flow (skeleton — wizard frame, no auto-detect yet)
  agent: backend-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 6
  depends_on: [TICKET-024, TICKET-025]
  spec: backlog/sprint-2/TICKET-026.md

- id: TICKET-027
  title: Dashboard authenticated layout (sidebar + header + route guards)
  agent: backend-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-024, TICKET-025]
  spec: backlog/sprint-2/TICKET-027.md

- id: TICKET-028
  title: Tenant overview page (empty state, placeholder for live metrics)
  agent: backend-engineer
  status: BLOCKED
  priority: P2
  estimated_hours: 3
  depends_on: [TICKET-027]
  spec: backlog/sprint-2/TICKET-028.md

- id: TICKET-029
  title: Stripe billing webhook stub + usage_metering table
  agent: backend-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-021]
  spec: backlog/sprint-2/TICKET-029.md
```

## Currently in flight

- TICKET-003 (devops-engineer, IN_PROGRESS, started 2026-04-27T14:40:00Z) — Sentry + OTel baseline

## Awaiting human review

- TICKET-009 (devops-engineer, PR #6, completed 2026-04-27T14:15:00Z) — Vendor account stubs
  Terraform skeleton + runbooks

## Recent merges

- 2026-04-27T07:30Z — TICKET-002 (PR #4 + PR #5): Doppler integration + secrets management baseline
  by devops-engineer
  - Secrets management via Doppler, CI integration, hard cap on CI verification loop
- 2026-04-26T18:15Z — TICKET-001 (PR #2): Bootstrap monorepo (Turborepo + pnpm + tooling) by
  devops-engineer
  - Monorepo foundation with all 9 packages + 9 apps (10+10 after Sprint 0 completes via
    TICKET-005/006)
