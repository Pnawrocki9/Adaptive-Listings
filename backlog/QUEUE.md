# Backlog Queue

**Updated 2026-05-14T20:50Z by pm-orchestrator.** Sprint 7.5 COMPLETE. Sprint 7 COMPLETE. Sprint 8
COMPLETE. Sprint 8.5 Wave 1 COMPLETE: AB-005 (PR #106), AB-006+007 (PR #107). Sprint 3 TICKET-037
DONE (PR #98), TICKET-038 READY. Sprint 8.5 Wave 2 IN_PROGRESS: AB-008 (FOLLOW-014)

- AB-009 (FOLLOW-015) delegated to backend-engineer (równolegle).

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
| 2.5    | 4     | Auto-Onboarding pipeline (NEW v1.1)                                  | 6       | 0    | 0       | 1     | 4       |
| 3      | 5     | SDK Tier 1 Observer + Magic Link UI                                  | 10      | 2    | 0       | 1     | 7       |
| 4      | 6     | Intent ontology v1 + Modal scaffolding                               | tbd     | —    | —       | —     | tbd     |
| 5      | 7     | LLM gateway + intent extraction from chat                            | tbd     | —    | —       | —     | tbd     |
| 6      | 8     | Embeddings + archetype matching + decision API                       | 3       | 3    | 0       | 0     | 0       |
| 7      | 9     | Decision API real logic + adaptation playbooks                       | 5       | 5    | 0       | 0     | 0       |
| 7.5    | 9.5   | Auto-Detection Engine                                                | 7       | 7    | 0       | 0     | 0       |
| 8      | 10    | A/B holdout + re-ranking + agency answers + variants + retro loop    | 16      | 13   | 0       | 0     | 0       |
| 9      | 11    | DPIA + ROPA + DSR + consent propagation + description pipeline       | 6       | 0    | 0       | 0     | 6       |
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
  depends_on: [TICKET-REORDER-001]
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

## Sprint 8.5 — A/B wiring sprint — Wave 1 COMPLETE (PR #106 + #107), Wave 2 READY_FOR_REVIEW (PR #108)

**Status:** Wave 1 COMPLETE as of 2026-05-14. Wave 2 (AB-008 + AB-009) READY_FOR_REVIEW as of
2026-05-14.

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
  title: Replace mock /api/ab/weights with real Drizzle SELECT
  agent: backend-engineer
  status: READY_FOR_REVIEW
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-AB-006, TICKET-AB-007]
  pr: '#108'
  spec: backlog/sprint-9/TICKET-AB-008.md
  promoted_from: FOLLOW-014

- id: TICKET-AB-009
  title: Wire ReorderDirective into production decision-api Worker
  agent: backend-engineer
  status: READY_FOR_REVIEW
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-REORDER-001, TICKET-AB-001]
  pr: '#108'
  spec: backlog/sprint-9/TICKET-AB-009.md
  promoted_from: FOLLOW-015
```

## Sprint 9 — DPIA + DSR + consent + description pipeline (BACKLOG)

**Status:** BACKLOG as of 2026-05-14. Spec files written by architect into `backlog/sprint-9/`.
Sprint 9 is the MVP compliance gate: GDPR-001 (DPIA/ROPA), GDPR-002 (DSR endpoints), GDPR-004
(consent propagation) are P0 and must land before any EU pilot tenant signup. DESC-001 (long-form
description pipeline per Master Design E.7) and VAL-001 (schema validation cron) are P1.

**Cross-reference TICKET-VAL-001 ↔ TICKET-035 (Sprint 2.5):** Both tickets implement identical
continuous schema validation cron scope per Master Design B.6. **Canonical implementation lives in
TICKET-VAL-001 (Sprint 9)** — it depends only on TICKET-AUTO-006 (DONE) and is unblocked
immediately. TICKET-035 in Sprint 2.5 is a duplicate stub; when Sprint 2.5 starts, TICKET-035 should
be marked CANCELLED with a pointer to TICKET-VAL-001 (decision: Piotr 2026-05-14, prefer
TICKET-VAL-001 because Sprint 9 dependency chain is shorter and unblocked sooner).

**Open questions captured during spec authoring (resolve at sprint start, see ESCALATIONS.md if not
resolved):**

1. GDPR-004 `consent_state` column on ClickHouse `events` table — verify TICKET-014 DDL for whether
   the column already exists; if not, engineer writes a migration.
2. DESC-001 `source: 'ai_generated'` value — Master Design E.7.2 lists this as a possible response
   source, but the E.7.3 flow shows the endpoint always returns either `template_fallback` (cache
   miss) or `ai_cached` (cache hit). Spec uses only those two values. Confirm Master Design
   interpretation before implementation.
3. GDPR-004 tenant region storage — `tenants.brand_config` JSONB vs explicit `region` column.
   Engineer must verify before writing the `consent_required` default-by-region logic.
4. VAL-001 `sample_listing_url` in `tenant_site_schemas.schema` JSONB — verify TICKET-AUTO-006 PR
   diff for exact JSONB structure.
5. GDPR-003 agent split — docs portion (`lia-template.md`) stays with compliance-engineer; CRUD +
   Drizzle table portion reassign to backend-engineer.

```yaml
- id: TICKET-GDPR-001
  title: DPIA + ROPA documents (EU/UK/CA/UAE)
  agent: compliance-engineer
  status: BACKLOG
  priority: P0
  estimated_hours: 8
  depends_on: []
  spec: backlog/sprint-9/TICKET-GDPR-001.md
  notes: |
    docs/compliance/dpia.md + ropa.md covering all 4 jurisdictions.
    Unblocks GDPR-002/003/004 (defines retention scope, lawful basis, consent strategy).
    Requires Piotr sign-off before merge.

- id: TICKET-GDPR-002
  title: DSR endpoints (access / erase / portability)
  agent: backend-engineer
  status: BACKLOG
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-GDPR-001]
  spec: backlog/sprint-9/TICKET-GDPR-002.md
  notes: |
    POST /api/dsr/access, /api/dsr/erase, /api/dsr/portability.
    Token-validated, cascades delete across Postgres + ClickHouse + Redis.
    24h delay window for revocation (dsr_tokens table).

- id: TICKET-GDPR-003
  title: Cookie-less behavioral fingerprinting LIA template + tenant_compliance_records
  agent: compliance-engineer + backend-engineer
  status: BACKLOG
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-GDPR-001]
  spec: backlog/sprint-9/TICKET-GDPR-003.md
  notes: |
    Split: docs (lia-template.md) → compliance-engineer; CRUD API + Drizzle table →
    backend-engineer. Open question 5 above.

- id: TICKET-GDPR-004
  title: Consent state propagation (SDK → ingest → ClickHouse → Decision API gate)
  agent: backend-engineer
  status: BACKLOG
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-GDPR-001, TICKET-041]
  spec: backlog/sprint-9/TICKET-GDPR-004.md
  notes: |
    Extends TICKET-AB-001 consent-aware skip pattern to full personalization gate.
    Adds consent_required boolean to tenants table (default true for EU regions).
    Decision API returns default directives if consent_state !== 'granted'.

- id: TICKET-DESC-001
  title: Long-form description pipeline (Tier 2/3, Redis-cached, Sonnet 4.6 async)
  agent: backend-engineer + ml-engineer
  status: BACKLOG
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-AGENCY-001, TICKET-046]
  spec: backlog/sprint-9/TICKET-DESC-001.md
  notes: |
    Promoted from FOLLOW-002 (RETRO-001). Per Master Design E.7.
    Tier 1 → copy_template.en static. Tier 2 → 72h TTL Redis cache, max_tokens 450.
    Tier 3 → 48h TTL, max_tokens 600, priority high.
    Modal job apps/llm-gateway/src/jobs/generate_description.py.
    listing.updated → Redis DEL desc:{tenant_id}:{listing_id}:*

- id: TICKET-VAL-001
  title: Continuous schema validation cron (drift detection per tenant)
  agent: data-engineer
  status: BACKLOG
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-AUTO-006]
  spec: backlog/sprint-9/TICKET-VAL-001.md
  notes: |
    CANONICAL implementation. Supersedes Sprint 2.5 TICKET-035 (mark that CANCELLED).
    Daily Modal cron at apps/data-quality/src/crons/schema_validation.py.
    Re-runs deterministic detection against live tenant pages, diffs vs stored schema,
    emits schema_drift_detected event + Sentry alert if drift detected.
    Writes schema_validation_history Postgres table row per run.
```

## Currently in flight

(none — Sprint 8 COMPLETE)

## Awaiting human review

- TICKET-AB-005 (PR #106) — emit ab.assignment event from decision-api adapt route

## Recent merges

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
