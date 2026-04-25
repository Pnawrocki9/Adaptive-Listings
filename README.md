# Estalara Adaptive Listings

Embeddable AI layer + standalone SaaS that lets any real estate website serve listings adapted in real time to each anonymous buyer based on chat, behavior, questions, and cross-listing journey.

This repository is run by an **agent-orchestrated workflow**: most code is written by specialized Claude Code subagents under the supervision of a PM agent, with humans reviewing PRs and resolving escalations.

## Status

**Pre-MVP / Sprint 0 / Repository scaffolding phase.**

| Sprint | Theme | State |
|---|---|---|
| 0 | Foundation | Not started |
| 1–11 | Per `docs/AGENT_WORKFLOW.md` | Pending |

## Quick start (humans)

If you are Piotr, Rafał, or Krystian, your day looks like this:

```bash
# Morning
claude /sprint-status        # what's the state of the world
gh pr list --state open      # what needs my review
# ...review and merge PRs...
claude /run-pm               # kick the PM into the next loop iteration

# Afternoon — same loop

# Evening — same loop, plus add escalations for anything you noticed
claude /escalate             # surface a concern
```

The PM agent picks tickets, delegates them to worker agents, validates the resulting PRs against acceptance criteria, and either marks them ready for your review or escalates if something is off.

You stay in the loop on:

- **Merging PRs** (you do this; agents never merge)
- **Resolving escalations** (`backlog/ESCALATIONS.md`)
- **Architectural decisions** (ADRs in `docs/adr/`)
- **Approving production deploys** (tagged releases, gated)

## Quick start (Claude Code agents)

Read `CLAUDE.md` first. It tells you who you are, what to do, and where the rules live.

Then read the file that names your role: `.claude/agents/<your-name>.md`.

Then check `backlog/QUEUE.md` for the next ticket assigned to you, and find its full spec at `backlog/sprint-N/TICKET-XXX.md`.

## Repository structure

See `docs/CONVENTIONS.md` for the canonical layout. Key roots:

- `apps/` — deployable services (Cloudflare Workers, Next.js, Modal Python)
- `packages/` — shared TypeScript libraries
- `infra/` — Terraform, ClickHouse DDL, observability config
- `tests/` — E2E, integration, load tests, fixtures
- `docs/` — design docs, ADRs, runbooks, compliance docs
- `backlog/` — ticket queue, sprint specs, status, escalations
- `.claude/` — agent definitions, hooks, slash commands, settings

## The agent team

Nine specialized Claude Code subagents, each with its own scope, tools, and quality bars:

1. **`pm-orchestrator`** — drives the backlog
2. **`architect`** — interfaces and ADRs
3. **`sdk-engineer`** — `@estalara/sdk` (Preact + Shadow DOM)
4. **`backend-engineer`** — Cloudflare Workers + Next.js + Postgres
5. **`data-engineer`** — ClickHouse + Redpanda + ETL
6. **`ml-engineer`** — intent engine + adaptation + LLM gateway
7. **`devops-engineer`** — Terraform + CI/CD + observability
8. **`qa-engineer`** — E2E + integration + load tests
9. **`compliance-engineer`** — DPIA, GDPR/CCPA/PDPL, fair-housing

Read the full coordination protocol in `docs/AGENT_WORKFLOW.md`.

## Tech stack (decided)

- **Monorepo:** Turborepo + pnpm
- **SDK:** TypeScript 5, Preact 10, tsup, Shadow DOM, <40KB gzip
- **Edge ingest:** Cloudflare Workers + Durable Objects
- **Control plane:** Next.js 15 App Router on Vercel
- **ML services:** Modal (Python)
- **Event bus:** Redpanda Cloud
- **Postgres:** Supabase (multi-region)
- **Event store:** ClickHouse Cloud
- **Vector store:** pgvector → Qdrant (Y2)
- **Cache:** Upstash Redis
- **LLM:** Claude Haiku 4.5 (workhorse) + Sonnet 4.6 (complex), via LiteLLM
- **Embeddings:** OpenAI text-embedding-3-small (MVP) → BGE-M3 (Y2)
- **Observability:** Sentry + OpenTelemetry + Grafana Cloud
- **Secrets:** Doppler

If you want to change a stack decision, write an ADR in `docs/adr/PROPOSED-XXX.md` and escalate. Do not silently swap.

## Multi-region scope

Live regions from MVP:

- **EU** (Frankfurt) — primary, GDPR
- **US** (Virginia) — CCPA/CPRA
- **UK** (London) — UK GDPR
- **UAE** (Dubai) — PDPL + DIFC

## License

Private and proprietary. Estalara Inc. All rights reserved.

## Contact

- Piotr Nawrocki — CEO — `piotr@estalara.io`
- Rafał Palak PhD — CTO — `rafal@estalara.io`
- Krystian Wojtkiewicz PhD — CPO — `krystian@estalara.io`

For agents: do not contact humans except via `backlog/ESCALATIONS.md`.
