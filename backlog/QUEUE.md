# Backlog Queue

Single source of truth for ticket status. Updated by `pm-orchestrator`. Read by everyone.

## How to read this

Each ticket has a one-line entry in the appropriate sprint section. Statuses:

- `BACKLOG` — not yet sprint-planned
- `READY` — can start now
- `BLOCKED` — waiting on dependency
- `IN_PROGRESS` — actively being worked
- `READY_FOR_REVIEW` — PR open, PM-validated, awaiting human merge
- `DONE` — merged
- `STUCK` — escalation needed
- `CANCELLED` — won't do

Status changes are atomic: PM reads the file, modifies one entry, writes it back. Never partial
updates.

## Sprint progress

| Sprint | Weeks | Theme                                            | Tickets | DONE | IN_PROGRESS | READY | BLOCKED |
| ------ | ----- | ------------------------------------------------ | ------- | ---- | ----------- | ----- | ------- |
| 0      | 1     | Foundation (repo, monorepo, CI, scaffolding)     | 15      | 1    | 0           | 14    | 0       |
| 1      | 2     | Ingest baseline + event schema                   | tbd     | 0    | 0           | 0     | tbd     |
| 2      | 3     | Postgres + tenant auth + dashboard skeleton      | tbd     | 0    | 0           | 0     | tbd     |
| 3      | 4     | SDK Tier 1 Observer + Cloudflare deploy          | tbd     | 0    | 0           | 0     | tbd     |
| 4      | 5     | Intent ontology v1 + Modal scaffolding           | tbd     | 0    | 0           | 0     | tbd     |
| 5      | 6     | LLM gateway + intent extraction from chat        | tbd     | 0    | 0           | 0     | tbd     |
| 6      | 7     | Embeddings + archetype matching + decision API   | tbd     | 0    | 0           | 0     | tbd     |
| 7      | 8     | SDK Tier 2 Augment + adaptation directives       | tbd     | 0    | 0           | 0     | tbd     |
| 8      | 9     | A/B holdout framework + analytics dashboard      | tbd     | 0    | 0           | 0     | tbd     |
| 9      | 10    | DPIA + ROPA + DSR + fair-housing linter          | tbd     | 0    | 0           | 0     | tbd     |
| 10     | 11    | Multi-region deploy + observability + load tests | tbd     | 0    | 0           | 0     | tbd     |
| 11     | 12    | Pilot onboarding + docs + launch checklist       | tbd     | 0    | 0           | 0     | tbd     |

Detailed tickets for sprints 0–3 in Pakiet 2. Sprints 4–11 in Pakiet 3.

## Active sprint: Sprint 0

```yaml
- id: TICKET-001
  title: Bootstrap monorepo (Turborepo + pnpm + tooling)
  agent: devops-engineer
  status: DONE
  completed_at: 2026-04-26T18:15:00Z
  pr: '#2'
  priority: P0
  estimated_hours: 4
  depends_on: []
  affects_files:
    - 'package.json'
    - 'pnpm-workspace.yaml'
    - 'turbo.json'
    - 'tsconfig.json'
    - '.github/workflows/ci.yml'
    - '.eslintrc.json'
    - '.prettierrc'
  spec: backlog/sprint-0/TICKET-001.md
```

The remaining 14 Sprint 0 tickets ship in Pakiet 2. All 14 are now READY (unblocked by TICKET-001).

## Currently in flight

None.

## Awaiting human review

None.

## Recent merges

- **2026-04-26T18:15Z** — TICKET-001 (PR #2): Bootstrap monorepo (Turborepo + pnpm + tooling) by
  devops-engineer
  - Monorepo foundation with all 9 packages + 9 apps
  - CI/CD with GitHub Actions (lint, typecheck, test, build)
  - Fixed pnpm version conflict, Python build backend, formatting
  - Documented CodeQL deferral in ADR-0002
