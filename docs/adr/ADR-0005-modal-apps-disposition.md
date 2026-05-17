# ADR-0005: Modal Apps Disposition

## Status

Accepted — 2026-05-17

## Context

The repository contains six Modal Python apps under apps/. Four of them are 13–27 line placeholders
returning {"status": "placeholder"} with zero non-test importers (verified by
scripts/check-rule-i.sh at HEAD c0adf6d):

- apps/intent-engine — 27 lines, placeholder
- apps/archetype-pipeline — 22 lines, placeholder
- apps/adaptation-engine — 22 lines, placeholder
- apps/auto-detect — 13 lines, placeholder

Two are real and contain production-grade code:

- apps/llm-gateway — 668-line Sonnet job with anti-hallucination WHITELIST and audit trail
- apps/stream-consumer — real Redpanda consumer

MASTER_DESIGN §A.1 positioned the four placeholder apps as the home of the intelligence layer. The
Codex audit (2026-05-16) found that the real intelligence lives in:

- packages/sdk/src/core/intent.ts (~600 LOC Bayesian classifier, in-browser)
- apps/control-plane/src/app/api/adapt/route.ts (18-archetype playbook + LLM + RAG, see ADR-0004)
- apps/decision-api (edge holdout gate, see ADR-0004)

This is a documented architectural pivot from "Modal-hosted ML" to "TypeScript-edge +
Modal-async-jobs", not a backlog gap.

## Decision

### apps/intent-engine — BUILD

Keep and build into a real Modal service. Rationale:

- Server-side intent persistence is a genuine product gap: the in-browser Bayesian classifier loses
  state on tab close. A Modal service can persist intent across tabs and sessions via Supabase.
- Chat NLP home: when chat.message.sent events are produced, intent-engine is the natural consumer
  (Haiku 4.5 call, emit chat.intent.detected).
- No circular dependency risk: intent-engine will import from packages/intent-ontology (see
  CLEANUP-002), not from the browser SDK.

Implementation tracked separately. Not in Faza 1 scope.

### apps/archetype-pipeline — DELETE

Rationale:

- 22 lines, returns {"status": "placeholder"}.
- Zero non-test importers (Rule I verified).
- The archetype matching logic it was meant to contain lives canonically in
  packages/sdk/src/core/intent.ts and apps/control-plane/src/app/api/adapt/route.ts.
- Deletion removes a misleading directory name from ls apps/ output without removing any runtime
  behavior.

### apps/adaptation-engine — DELETE

Rationale:

- 22 lines, returns {"status": "placeholder"}.
- Zero non-test importers (Rule I verified).
- The adaptation logic it was meant to contain lives canonically in
  apps/control-plane/src/app/api/adapt/ route.ts (see ADR-0004).
- Deletion removes a misleading directory name without removing any runtime behavior.

### apps/auto-detect — DELETE

Rationale:

- 13 lines, returns {"status": "placeholder"}.
- Zero non-test importers (Rule I verified).
- Auto-detection runs in packages/sdk/src/auto-detect/ (10 deterministic techniques) and
  apps/control-plane/src/app/api/detect/route.ts (AI Vision fallback via Claude Sonnet 4.6).
- Deletion removes a misleading directory name without removing any runtime behavior.

### apps/llm-gateway — KEEP

Real 668-line Modal job. Production-grade. No changes.

### apps/stream-consumer — KEEP

Real Redpanda consumer. Production-grade. No changes.

## Investor Framing

The following paragraph MUST appear in ADR updates, investor materials, and technical due diligence
responses when asked about the Modal service reduction:

> "We consolidated the synchronous adaptive intelligence path into the TypeScript edge runtime
> (control-plane + Worker + SDK) where the production logic lives. Modal is reserved for genuinely
> asynchronous workloads: LLM gateway, stream consumption, and the upcoming intent-engine for
> cross-tab session continuity and chat NLP. Placeholder services that contained no production logic
> were removed to reduce diligence confusion and align ls apps/ with runtime reality."

## Pre-Deletion Gate

Before deleting the three apps, re-run scripts/check-rule-i.sh and confirm zero non-test importers
for each app at deletion time (not at audit time). Update CLAUDE.md and MASTER_DESIGN §A.1 in the
same PR as the deletion.

## Consequences

### Positive

- ls apps/ output reflects runtime reality.
- Rule I violation baseline drops (~10-15 fewer violations from deleted files).
- Investor diligence: no more "opened a file and saw 22 lines returning a placeholder" risk.
- MASTER_DESIGN §A.1 and codebase are aligned.
- Frees cognitive load for agents reading the repo.

### Negative

- Losing the placeholder apps removes scaffolding that could have been built into real services.
  Mitigation: intent-engine is kept; the other two functions (archetype matching, adaptation
  orchestration) are better served by the existing TypeScript-edge runtime.
- Git history will show deletion; must be paired with ADR reference in commit message so reviewers
  understand the rationale.

## Alternatives Considered

1. Keep as README-only stubs with clear documentation — rejected. README stubs still appear in ls
   apps/ and still mislead diligence reviewers. The stub pattern is exactly what created the audit
   finding.

2. Build all four into real Modal services — rejected. Estimated 3-5 sprints with no product value
   for seed demo. TypeScript-edge runtime already handles synchronous adaptation correctly.

3. Delete all four including intent-engine — rejected. intent-engine addresses a real product gap
   (cross-tab session persistence + chat NLP) that TypeScript-edge cannot solve without a
   server-side component.

## Related

- ADR-0004: Canonical /api/adapt endpoint
- CLEANUP-002: packages/intent-ontology (provides types for intent-engine without circular SDK dep)
- FOLLOW-007: Thompson sampling variant selection (separate from Modal disposition)
