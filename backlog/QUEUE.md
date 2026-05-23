# Backlog Queue

**Updated 2026-05-22T00:00Z by pm-orchestrator.** Sprint 9.5 COMPLETE as of 2026-05-22 (6 PRs
merged: #121, #122, #123, #124, #125, #126). Sprint 10 (Close the bandit loop + real embeddings +
e2e test) defined and OPEN. Sprint 9 COMPLETE as of 2026-05-15: GDPR-001 (PR #111), GDPR-002 (PR
#118), GDPR-003 (PR #116), GDPR-004 (PR #117), DESC-001 (PR #112+#114), VAL-001 (PR #110) — all 6
DONE. DESC-PIVOT-001 (PR #115) merged. Sprint 7.5 COMPLETE. Sprint 7 COMPLETE. Sprint 8 COMPLETE.
Sprint 8.5 COMPLETE. Sprint 2.5 SUPERSEDED — TICKET-030 + TICKET-033 promoted to Sprint 9.5,
TICKET-032 superseded by Sprint 7.5 auto-detect, TICKET-034/036 deferred (Q5 decision 2026-05-21),
TICKET-035 already CANCELLED. P0 follow-ups: FOLLOW-039 (ClickHouse DSR erase) deferred to Sprint 11
(Q7 decision 2026-05-21 — no EU traffic in 4-6 weeks); FOLLOW-040 (Doppler CI) parallel pre-flight
for Sprint 9.5. Krok A document governance reset merged (PR #119, Master_Design v2.0,
docs/ops/OPERATING_PRINCIPLES.md v1.1) — Operating Principles now active for all sessions.
ANTHROPIC_API_KEY activated in Doppler dev/stg/prd 2026-05-21 (Krok B) — AI Vision fully
operational.

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
| 9      | 11    | DPIA + ROPA + DSR + consent propagation + description pipeline       | 6       | 6    | 0       | 0     | 0       |
| 9.5    | 11.5  | MVP Demo Readiness (onboarding activation + bandit + scoring)        | 6       | 6    | 0       | 0     | 0       |
| 10     | 12    | Close the bandit loop + real embeddings + e2e test                   | 9       | 2    | 2       | 1     | 0       |
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

## Sprint 10 — Close the bandit loop + real embeddings + e2e test (OPEN)

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
  status: READY_FOR_REVIEW
  priority: P0
  estimated_hours: 4
  depends_on: [FOLLOW-042]
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-041.md
  pr: '#127'
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
  status: READY_FOR_REVIEW
  priority: P0
  estimated_hours: 2
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-042.md
  pr: '#127'
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
  status: READY_FOR_REVIEW
  priority: P0
  estimated_hours: 5
  depends_on: []
  model: sonnet-4.6
  pr: '#130'
  spec: backlog/sprint-10/FOLLOW-055.md
  pr: '#130'
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
  status: READY_FOR_REVIEW
  priority: P1
  estimated_hours: 1
  depends_on: []
  model: sonnet-4.6
  pr: '#129'
  spec: backlog/sprint-10/FOLLOW-047.md
  pr: '#129'
  notes: |
    Both apps/control-plane/src/app/api/detect/route.ts:214 and
    apps/control-plane/src/app/api/schema/activate/route.ts:97 fall back to 'estalara_staff'
    string sentinel when claims.tenant_id is null → uuid parse error → 500. Replace with
    explicit 403 STAFF_TENANT_CONTEXT_MISSING.

- id: FOLLOW-051
  title: Replace presence-only Bearer on POST /api/adapt/feedback with proper tenant-scoped auth
  agent: compliance-engineer + backend-engineer
  status: IN_PROGRESS
  priority: P1
  estimated_hours: 3
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-051.md
  notes: |
    When ADAPT_API_KEY is unset, feedback endpoint accepts any non-empty Bearer token and mutates
    ab_bandit_weights directly → adversarial bandit poisoning possible. Replace with tenant-scoped
    HMAC signature. Document threat model in Master Design §V.

- id: FOLLOW-052
  title: Mirror-code byte-identity CI check — scripts/check-mirror-files.sh (Rule J enforcement)
  agent: devops-engineer
  status: READY_FOR_REVIEW
  priority: P1
  estimated_hours: 1.5
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-052.md
  pr: '#128'
  notes: |
    Two mirrored file pairs: apps/decision-api/src/lib/bandit.ts (mirror of packages/shared/src/bandit.ts)
    and apps/decision-api/src/lib/reorder.ts. PR descriptions say byte-identical but no CI enforces
    this. Add check-mirror-files.sh + JSON manifest + GitHub Actions job rule-j + lefthook pre-push.
    Promotes Rule J pattern enforcement (CONVENTIONS_PATCH.md).
    Bandit drift fixed: sampleGamma now export function in mirror to match canonical.

- id: FOLLOW-061
  title: Add Snapshot.1 re-verification to sprint-close checklist in AGENT_WORKFLOW.md
  agent: architect
  status: IN_PROGRESS
  priority: P1
  estimated_hours: 0.5
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-061.md
  notes: |
    OP §Y.3 requires Snapshot.1 re-verification at sprint close. Sprint 9.5 violated this —
    rows B.4 and J went stale. Add re-verification as the last step on PM-orchestrator
    sprint-close checklist. Codify in docs/AGENT_WORKFLOW.md. RETRO-005 §7 Edits M-1..M-6
    satisfy the obligation for Sprint 9.5 retroactively.
```

## Currently in flight

(none)

## Awaiting human review

- PR #127 — FOLLOW-041 + FOLLOW-042: SDK variant field + feedback ping (sdk-engineer, CI green)
- PR #128 — FOLLOW-052: Mirror-code byte-identity CI check — Rule J (devops-engineer, CI green)
- PR #129 — FOLLOW-047: Reject null tenant_id with 403 (backend-engineer, CI green)
- PR #130 — FOLLOW-055: E2E integration test detect→activate→adapt→SDK (qa-engineer, CI green)
- PR #131 — FOLLOW-043: Archetype embedding vectors seed script (ml-engineer, CI green)

## Recent merges

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
