# Backlog Queue

**Updated 2026-05-11T00:00Z by pm-orchestrator.** Sprint 7 Phase 1 initiated — ADP-001 and ADP-003
queued. Sprint 6 prerequisites (ARCH-001, EMB-001, DB-001) confirmed DONE on main.

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
| 0      | 1     | Foundation (repo, monorepo, CI, scaffolding, secrets, observability) | 9       | 9    | 0       | 0     | 0       |
| 1      | 2     | Ingest baseline + event schema                                       | 10      | 10   | 0       | 0     | 0       |
| 2      | 3     | Postgres + tenant auth + dashboard skeleton                          | 10      | 10   | 0       | 0     | 0       |
| 2.5    | 4     | Auto-Onboarding pipeline (NEW v1.1)                                  | 6       | 0    | 0       | 0     | 6       |
| 3      | 5     | SDK Tier 1 Observer + Magic Link UI                                  | 10      | 1    | 0       | 0     | 9       |
| 4      | 6     | Intent ontology v1 + Modal scaffolding                               | tbd     | —    | —       | —     | tbd     |
| 5      | 7     | LLM gateway + intent extraction from chat                            | tbd     | —    | —       | —     | tbd     |
| 6      | 8     | Embeddings + archetype matching + decision API                       | 3       | 3    | 0       | 0     | 0       |
| 7      | 9     | Decision API real logic + adaptation playbooks                       | 2       | 1    | 1       | 0     | 0       |
| 8      | 10    | A/B holdout framework + analytics dashboard                          | tbd     | —    | —       | —     | tbd     |
| 9      | 11    | DPIA + ROPA + DSR + fair-housing + continuous validation             | tbd     | —    | —       | —     | tbd     |
| 10     | 12    | Multi-region deploy + observability + load tests                     | tbd     | —    | —       | —     | tbd     |
| 11     | 13    | Pilot onboarding + docs + launch checklist                           | tbd     | —    | —       | —     | tbd     |

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
  status: BLOCKED
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
  title: Continuous schema validation cron (drift detection per tenant)
  agent: data-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-034]
  spec: backlog/sprint-2.5/TICKET-035.md

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
  status: BLOCKED
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-031]
  spec: backlog/sprint-3/TICKET-037.md

- id: TICKET-038
  title: SDK tsup build + bundle size gate (<40KB gzip)
  agent: sdk-engineer
  status: BLOCKED
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
  status: BLOCKED
  priority: P1
  estimated_hours: 6
  depends_on: [TICKET-037]
  spec: backlog/sprint-3/TICKET-041.md

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

## Sprint 7 — Decision API real logic + adaptation playbooks (ACTIVE)

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
  status: IN_PROGRESS
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-ADP-001]
  assigned_to: sdk-engineer
  started_at: '2026-05-11T20:36:18Z'
  spec: backlog/sprint-7/TICKET-ADP-003.md
```

## Currently in flight

- TICKET-ADP-003 (sdk-engineer, IN_PROGRESS, started 2026-05-11T20:36:18Z)

## Awaiting human review

(none)

## Recent merges

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
