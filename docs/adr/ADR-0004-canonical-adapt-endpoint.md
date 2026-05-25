# ADR-0004: Canonical /api/adapt Endpoint

## Status

Accepted — 2026-05-17

> **Runtime enforcement:** see **ADR-0006** (Canonical /api/adapt Enforcement, ACCEPTED 2026-05-25),
> the enforcing follow-on to this ADR. ADR-0006 implements the SDK-targeting guarantee, the Worker
> `410 Gone` retirement, the CI regression gate, and the live-wins contract reconciliation that this
> ADR deferred. This ADR remains in force; ADR-0006 does not supersede it.

## Context

The repository currently contains two parallel `/api/adapt` endpoints with significantly different
capabilities, creating a divergence that confuses SDK configuration, complicates testing, and
surfaced as a finding in the investor-readiness audit (MASTER_DESIGN v1.8 reconciliation).

**Endpoint A — `apps/decision-api` (Cloudflare Worker):**

- Edge-deployed for low latency.
- Archetype selection via `detectArchetype()`, a stub that buckets users into 3 hardcoded archetypes
  using keyword matching.
- No LLM, no RAG, no playbook lookup, no A/B holdout assignment.
- Returns a minimal decision payload.

**Endpoint B — `apps/control-plane/src/app/api/adapt/route.ts` (Next.js 15 App Router):**

- Deployed on Vercel (existing Estalara stack).
- Full 18-archetype playbook with deterministic adaptation logic.
- LLM-assisted adaptation (Claude Haiku 4.5 workhorse, Sonnet 4.6 escalation) via LiteLLM router.
- RAG retrieval against pgvector for contextual content selection.
- A/B holdout assignment with deterministic variant selection.
- Returns `ReorderDirective[]` plus full slot copy and explainability metadata.

The two endpoints implement fundamentally different products. Tenants today have no reliable signal
about which one their SDK should call. Investor diligence flagged "which `/api/adapt` is real?" as
an immediate red flag.

## Decision

1. **`apps/control-plane/src/app/api/adapt/route.ts` is THE canonical adapt endpoint** for all
   production tenants.
2. **`apps/decision-api` is scoped to "edge holdout gate + telemetry relay only."** Its
   `detectArchetype()` function (3 keyword buckets) is intentionally a stub and MUST NOT be called
   for archetype selection in production. Any production code path that reaches it is a bug.
3. **SDK configuration:** all tenants must point to the control-plane URL. Tenant config field:
   `adapt_endpoint = "https://app.estalara.com/api/adapt"`.
4. **Deprecation:** `apps/decision-api` will be retained for 30 days as the edge holdout gate. After
   30 days, a scope review will decide whether to keep it as holdout-only or remove it entirely.

## Latency SLA (Bifurcated by Path)

CRITICAL: do NOT claim a single blended p95 < 100ms for the canonical path. The Adapt API has four
distinct execution paths with different latency budgets:

| Path                                                     | p95 Target | Notes                                 |
| -------------------------------------------------------- | ---------- | ------------------------------------- |
| Edge holdout gate (Worker, cached decision)              | <100ms     | Worker scope only                     |
| Deterministic adapt (playbook + reorder, no LLM, no RAG) | <300ms     | Hot path on control-plane             |
| RAG-enriched adapt (vector retrieval, no LLM)            | <800ms     | Includes Supabase pgvector query      |
| LLM-assisted adapt (Haiku 4.5 or Sonnet 4.6)             | <2000ms    | Async-eligible for non-critical slots |

Performance tests must report p95 per path, not blended.

## Stable API Contract

To preserve future migration optionality (e.g. moving hot-path logic back to Cloudflare Worker if
Vercel cold starts become problematic), the Adapt API response contract MUST be stable and
edge-compatible:

- Response shape MUST NOT include Next.js-specific features (no React server components, no
  Vercel-specific headers).
- Response shape MUST be representable in plain JSON.
- All decision logic MUST be expressible as pure functions taking request + state, returning
  response. No reliance on Next.js middleware chain order.
- SDK MUST treat response as opaque JSON, parsing only the documented fields.

### Canonical response contract

> Updated 2026-05-25 (FOLLOW-105 substep 1b) to reflect live implementation per ADR-0006 §Decision 5
> (live wins). Original draft contract preserved in §Historical Note for git history reference.

The canonical response is the `AdaptationDirectives` type, defined in
`packages/shared/src/directives.ts` — the single source of truth for the `/api/adapt` response
shape. The control-plane route (`apps/control-plane/src/app/api/adapt/route.ts`) returns exactly
this shape on both the GET and POST paths. The SDK validates every response against a mirror Zod
schema (`packages/sdk/src/core/adapt-schema.ts`); CI Rule H asserts the two stay in sync (ADR-0006
§Decision 4).

| Field               | Type                                                                                                                              | Notes                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `adapt_decision_id` | string (uuid)                                                                                                                     | Stable per-decision UUID (FOLLOW-105 / ADR-0006 §Decision 4C); cross-correlates the ClickHouse row. |
| `session_id`        | string                                                                                                                            | Session identifier echoed from the request.                                                         |
| `archetype`         | `ArchetypeId \| 'neutral'`                                                                                                        | One of the 18 archetype IDs or the `'neutral'` fallback.                                            |
| `confidence`        | number (0–1)                                                                                                                      | Intent confidence.                                                                                  |
| `similarity`        | number (0–1)                                                                                                                      | Cosine similarity to the matched archetype.                                                         |
| `tier`              | `1 \| 2 \| 3`                                                                                                                     | Integration tier the caller declared.                                                               |
| `directives`        | `(TextDirective \| ClassDirective \| ReorderDirective)[]`                                                                         | Empty when `source` is `'default'` or `'llm_full'` with no output.                                  |
| `source`            | `'playbook' \| 'llm_tweaked' \| 'llm_full' \| 'default' \| 'playbook_fallback_llm_capped' \| 'playbook_fallback_llm_unavailable'` | Origin of the response.                                                                             |
| `variant`           | string (optional)                                                                                                                 | Thompson-sampling bandit variant (FOLLOW-007); echoed back in the feedback ping.                    |
| `generated_at`      | string (ISO 8601)                                                                                                                 | Server generation timestamp.                                                                        |

Holdout-arm POST responses additionally carry a `holdout_group: boolean` field (not part of the
formal `AdaptationDirectives` type; the SDK schema allows it via `.passthrough()`).

**Deferred field:** `explainability_id` (a link to a provenance audit trail) was in the original
draft contract below but is **[DEFERRED to FOLLOW-108, Sprint 14]** — it is NOT implemented and is
NOT part of the live `AdaptationDirectives` type. FOLLOW-105 substep 1b ships `adapt_decision_id`
only.

### Historical Note — original draft contract (superseded)

The draft contract documented in the original 2026-05-17 ADR is preserved here for git-history
reference. It did NOT match the shipped implementation (the FOLLOW-105 substep 1a audit found total
drift — only `archetype` matched by name; see `docs/audits/FOLLOW-105-1a-sdk-audit.md` §D). Per
ADR-0006 §Decision 5 ("live wins"), the live `AdaptationDirectives` shape above is authoritative.

- `adapt_decision_id`: string (uuid)
- `archetype`: string (one of 18 known IDs)
- `archetype_confidence`: number (0–1)
- `holdout`: boolean
- `variant_index`: number (0, 1, or 2)
- `directives`: `ReorderDirective[]`
- `slot_copy`: `Record<string, string>`
- `timing_ms`: `{ path: string, total_ms: number }`
- `explainability_id`: string (links to provenance audit)

## Consequences

### Positive

- Single source of truth for adapt logic.
- Clear SDK configuration story for tenants.
- Investor-readable architecture (no more dual-route confusion).
- Stable contract preserves future migration paths.

### Negative

- Vercel cold starts may impact p95 in low-traffic periods. Mitigation: keep-alive ping cron +
  Vercel Fluid Functions.
- Loss of edge latency for archetype selection. Mitigation: bifurcated SLA acknowledges this;
  LLM/RAG paths were never going to fit in <100ms anyway.
- Worker codebase becomes maintenance burden until deprecation review at 30 days.

## Alternatives Considered

1. **Worker as canonical** — rejected. Would require rebuilding the 18-archetype playbook, LLM
   gateway, RAG, and A/B logic in Worker runtime. 3–5 sprints of work for marginal latency gain.
2. **Hybrid (Worker frontend, Next.js backend)** — rejected. Increases architectural complexity,
   doubles surface for bugs, splits the contract.
3. **Keep both, document tenant-specific routing** — rejected. This is the current state and it's
   exactly what created the audit finding.

## Implementation Notes

- This ADR does NOT require code changes in this commit. Code migration (SDK config defaults, Worker
  deprecation) is tracked separately.
- See ADR-0005 for related Modal apps disposition decisions.
