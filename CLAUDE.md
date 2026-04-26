# Estalara Adaptive Listings — Claude Code Project Context

## ⚠️ Master Design v1.1 update (2026-04-26)

Master Design został zaktualizowany do v1.1 — dodane sekcje B.4 do B.7 dotyczące Auto-Onboarding (Magic Link, AI Vision Auto-Detect, Schema Discovery, Continuous Validation, Pre-Built Platform Templates).

Implikacje dla aktualnej pracy:
- Sprint 0 dostaje 1 dodatkowy app (apps/auto-detect/) i 1 dodatkowy package (packages/platform-templates/) ponad to co zbuduje TICKET-001
- Sprint 1-2 musi uwzględnić Auto-Detection Service, Schema Discovery Pipeline, Magic Link UI flow w dashboardzie
- Sprint 5-6 dostaje Continuous Schema Validation + drift detection
- Każdy ticket dotykający TenantConfig MUSI uwzględnić nowe pole `auto_detected_schema`

Pełen changelog na początku docs/MASTER_DESIGN.md.

---

This file is loaded automatically into every Claude Code session in this repo. Read it first.

## What we're building

**Estalara Adaptive Listings** is an embeddable AI layer + standalone SaaS that lets any real estate
website serve listings adapted in real time to each anonymous buyer based on chat, behavior,
questions, and cross-listing journey.

Three integration tiers:

- **Tier 1 Observer** — read-only sidebar widget, no DOM mutation
- **Tier 2 Augment** — declarative DOM slots, light mutation (headline, photo order, features)
- **Tier 3 Native** — full `<EstalaraListing/>` component owned by us

Founders: Piotr Nawrocki (CEO), Rafał Palak PhD (CTO), Krystian Wojtkiewicz PhD (CPO).

The full architectural and business design is in `docs/MASTER_DESIGN.md`. **Read that file before
making any architectural decision.**

## How this repo is run

This is an agent-orchestrated codebase. Most code is written by specialized Claude Code subagents
coordinated by a PM agent. Humans review PRs and make architectural calls.

Read these in order before doing anything:

1. `docs/AGENT_WORKFLOW.md` — how the PM agent coordinates worker agents
2. `docs/CONVENTIONS.md` — coding style, commit conventions, branch naming
3. `docs/TICKET_FORMAT.md` — how tickets are structured
4. `backlog/QUEUE.md` — current state of work, who's doing what

## How agents communicate

**Important:** Claude Code subagents do NOT talk to each other directly. They communicate through:

1. **`backlog/QUEUE.md`** — single source of truth for ticket status. Every agent writes status
   changes here.
2. **`backlog/sprint-N/TICKET-XXX.md`** files — each ticket has acceptance criteria, context, and
   agent assignment.
3. **PR descriptions** — when a worker finishes, they open a PR. The PM agent reads PRs and runs
   validation.
4. **`backlog/HANDOFFS.md`** — when one worker's output is input to another, handoff notes go here.

The `.claude/hooks/` scripts (notably `SubagentStop`) read the queue after each subagent finishes
and surface the next command to the human or PM agent.

## The 9 agents

| Agent                 | Role                                                                             | Model  |
| --------------------- | -------------------------------------------------------------------------------- | ------ |
| `pm-orchestrator`     | Reads backlog, delegates to workers, validates output, updates queue             | sonnet |
| `architect`           | Designs interfaces between modules, writes ADRs, resolves cross-cutting concerns | sonnet |
| `sdk-engineer`        | Builds `@estalara/sdk` (Preact + Shadow DOM, vanilla TS)                         | sonnet |
| `backend-engineer`    | Cloudflare Workers ingest, Next.js control plane, Postgres/Supabase              | sonnet |
| `data-engineer`       | ClickHouse schemas, Redpanda pipelines, ETL jobs                                 | sonnet |
| `ml-engineer`         | Intent engine, embeddings, archetype space, Modal serverless ML                  | sonnet |
| `devops-engineer`     | Terraform, CI/CD, multi-region deploy, observability                             | sonnet |
| `qa-engineer`         | E2E tests, integration tests, load tests, accessibility                          | sonnet |
| `compliance-engineer` | DPIA, ROPA, privacy policy, GDPR/CCPA/UAE PDPL implementation                    | sonnet |

Each agent is defined in `.claude/agents/<name>.md`.

## Human review boundary (autonomy rules)

Piotr has 2h/day for review. Agents have wide autonomy within limits:

**Agents act autonomously without human review when:**

- Implementing a ticket within its defined scope
- Refactoring code they own (within their module)
- Adding tests
- Updating documentation that doesn't change architectural decisions
- Bumping minor/patch dependencies
- Fixing CI failures within their module

**Agents MUST escalate to human (write to `backlog/ESCALATIONS.md`) when:**

- A ticket's acceptance criteria are ambiguous → block ticket, ask
- They discover the ticket conflicts with another module's contract
- They need to change a public API surface (`@estalara/sdk` exports, ingest event schema, decision
  API contract)
- They need to add a new third-party service (vendor lock-in)
- They need to change pricing, billing, or compliance posture
- A test reveals a security issue
- They're about to add >€100/mo to recurring costs
- A bumped dependency has breaking changes

**The PM agent escalates to human when:**

- Two workers disagree on an interface
- A ticket has been blocked >24h
- Sprint velocity is <50% of planned
- Test coverage drops below 70% on a module

## Tech stack reference (decided, do not re-litigate)

- **Monorepo:** Turborepo + pnpm
- **SDK:** TypeScript 5, Preact 10, tsup, Shadow DOM
- **Edge ingest:** Cloudflare Workers + Durable Objects
- **Control plane:** Next.js 15 App Router on Vercel (existing Estalara stack)
- **Worker tasks (ML):** Modal (Python)
- **Event bus:** Redpanda Cloud
- **Postgres:** Supabase (multi-region projects)
- **Event store:** ClickHouse Cloud
- **Vector store:** pgvector (MVP) → Qdrant (Y2)
- **Cache/session:** Upstash Redis (multi-region)
- **LLM:** Claude Haiku 4.5 (workhorse), Sonnet 4.6 (complex), via LiteLLM router
- **Embeddings:** OpenAI text-embedding-3-small (MVP) → BGE-M3 self-hosted (Y2)
- **Observability:** Sentry + OpenTelemetry + Grafana Cloud
- **Auth:** Supabase Auth + tenant-scoped JWT

If you think a stack decision is wrong, write an ADR proposal in `docs/adr/PROPOSED-XXX.md` and
escalate. Do not silently swap.

## Commit conventions

Conventional Commits: `<type>(<scope>): <subject>`

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`

Scopes: `sdk`, `ingest`, `control-plane`, `intent`, `adapt`, `data`, `infra`, `compliance`, `qa`

Every commit must reference a ticket: `feat(ingest): add event validation [TICKET-042]`

## Branch naming

`<agent>/<ticket-id>-<kebab-summary>`

Examples:

- `backend-engineer/TICKET-042-event-validation`
- `sdk-engineer/TICKET-018-shadow-dom-mount`

## Quality bars (non-negotiable)

- Test coverage ≥80% for `packages/*` (libraries), ≥70% for `apps/*` (services)
- All public APIs documented with JSDoc/TSDoc
- All ingest events validated with Zod schemas
- All Postgres tables have RLS policies (or documented exception)
- p95 latency budget: <100ms for Decision API, <50ms for ingest ACK
- SDK bundle: <40KB gzip for Tier 1+2 combined
- Zero `any` in TypeScript without inline `// eslint-disable` + reason
- Zero secrets in code; use `.env.example` + Doppler in CI

## When in doubt

Read `docs/MASTER_DESIGN.md`. If the answer isn't there, escalate.
