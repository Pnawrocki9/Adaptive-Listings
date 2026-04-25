# Master Design — Estalara Adaptive Listings

**Status:** v1.0 — accepted as authoritative design baseline for MVP

This document is referenced from every agent definition (`.claude/agents/*.md`) and most ticket specs. **Read this before making any architectural decision.** When this file conflicts with a ticket, the ticket loses; escalate.

## Where the canonical text lives

The full architectural and business analysis (~7000 words across 17 sections — A through Q) is maintained as the artifact attached to the conversation that produced this repo, titled "Estalara Adaptive Listings: Architectural and Business Master Design".

**Action item before Sprint 0 starts:** Piotr or Rafał must paste the full text of that artifact into this file, replacing this placeholder. Once that's done, this file becomes the single source of truth and the conversation reference is no longer needed.

Until that happens, the table of contents below tells you what sections to expect.

## Table of contents (sections to be populated)

- **Executive summary** — top-level recommendations and the seven strategic decisions
- **A. High-level system architecture** — component diagram, multi-tenant model, multi-region deployment
- **B. Embeddable plug-in / SDK design** — integration UX, performance budget, isolation strategy
- **C. Signal ingestion & data sources** — event taxonomy, ingestion rate strategy, NLP on chat
- **D. Intent engine** — 12-dimension intent ontology, model serving architecture, embedding choices, update pipeline
- **E. Adaptation engine** — decision tree, content generation strategy, A/B and learning loop
- **F. Data network effect / MOAT** — centralized vs federated, archetype space architecture, privacy-preserving techniques, MOAT mathematics
- **G. Behavioral fingerprinting** — legal landscape 2025–2026, three-mode strategy, technical implementation
- **H. Compliance & privacy multi-region** — GDPR, AI Act, CCPA, UK GDPR, UAE PDPL, NIS2, Polish UODO
- **I. Tech stack** — concrete recommendations across frontend, backend, ML, hosting, observability, dev tooling
- **J. Multi-tenancy model** — schema strategy, API key model, tenant configuration, dashboard, standalone product
- **K. Pricing model (hybrid)** — per-tier pricing, competitive benchmarking, enterprise contracts
- **L. Business model & GTM** — phased rollout, acquisition channels, sales motion per tier
- **M. Costs & unit economics** — COGS calculation, margin targets, CAC and LTV
- **N. Risks and mitigations** — technical, legal, competitive, reputational, vendor
- **O. Roadmap & MVP priorities** — 12-week plan, what's in scope vs out
- **P. User stories & data flows** — three end-to-end scenarios
- **Q. Strategic summary & next steps**

## Quick reference (until full doc is pasted)

### Three integration tiers
1. **Tier 1 Observer** — read-only sidebar widget, no DOM mutation
2. **Tier 2 Augment** — declarative DOM slots, light mutation
3. **Tier 3 Native** — full `<EstalaraListing/>` component

### Pricing (decided, hybrid)
- Tier 1: $499/mo + $0.40/1k visits
- Tier 2: $1 999/mo + $1.20/1k adaptations
- Tier 3: $7 500/mo + $4/1k rendered listings
- Enterprise: $50k–200k+/mo custom

### Privacy mode default
- **Mode A** (session-only fingerprint, ePrivacy 5(3)(b) strictly necessary exemption) — default
- **Mode B** (consented persistence) — opt-in via tenant CMP
- **Mode C** (legitimate interest narrow scope) — fraud only

### Regions live from day 1
EU (Frankfurt) · US (Virginia) · UK (London) · UAE (Dubai)

### Critical performance budgets
- Ingest endpoint p95: <50ms
- Decision API p95 cached: <80ms
- SDK Tier 1 bundle: <25KB gzip
- SDK Tier 1+2 bundle: <40KB gzip

### Critical compliance posture
- GDPR / UK GDPR / UAE PDPL / DIFC compliant from day 1
- AI Act: defensively classify as NOT high-risk, but maintain full risk-management documentation as if we were
- Fair-housing rule packs: US-strict / UK-standard / EU-standard / custom

## Reference architecture diagram (text)

```
SDK (Tier 1/2/3)
    │
    ▼
Cloudflare Worker ingest (4 regions: fra/iad/lhr/dxb)
    │
    ├──→ ClickHouse Cloud (events, per-region partition)
    │
    ▼
Redpanda Cloud (event bus)
    │
    ├──→ Modal: stream-consumer (enrich → ClickHouse + Redis)
    ├──→ Modal: intent-engine (chat NLP via Claude Haiku 4.5)
    └──→ Modal: archetype-pipeline (daily, DP-protected)
            │
            ▼
        pgvector (per-tenant) + global archetype space
            │
            ▼
Modal: adaptation-engine
    │
    ▼
apps/decision-api (Edge Worker, Next.js)
    │
    ▼
SDK (returns adaptation directives)
    │
apps/control-plane (Next.js on Vercel)
    └ tenant dashboard, billing, config
```

## Authority

This document overrides:
- Any agent's prior assumption
- Any ticket without explicit ADR exception
- Any "we did it this way before" pattern

This document is overridden by:
- An ACCEPTED ADR that explicitly supersedes a section here
- A signed-off escalation that adjusts a target

When in doubt: escalate.
