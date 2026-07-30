# Architecture Decision Records (ADRs)

This directory contains all architectural decisions for Estalara Adaptive Listings. Every
non-obvious decision that affects multiple modules, public APIs, or cross-cutting concerns is
documented here.

## Index

| ADR                                                                                                                   | Status   | Date       | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0003-event-schema-and-versioning](0003-event-schema-and-versioning.md)                                               | ACCEPTED | 2026-04-29 | Event envelope, per-type schemas, versioning strategy (additive-only within major version).                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [ADR-0004-canonical-adapt-endpoint](ADR-0004-canonical-adapt-endpoint.md)                                             | ACCEPTED | 2026-05-17 | control-plane `/api/adapt` is canonical; Worker is edge holdout gate only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| [ADR-0005-modal-apps-disposition](ADR-0005-modal-apps-disposition.md)                                                 | ACCEPTED | —          | Modal placeholder apps disposition; intelligence lives in TS edge + async jobs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [ADR-0006-canonical-adapt-enforcement](ADR-0006-canonical-adapt-enforcement.md)                                       | ACCEPTED | 2026-05-25 | Runtime enforcement of ADR-0004: SDK targeting, Worker 410, CI guard (FOLLOW-105).                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [0007-canonical-adapt-endpoint](0007-canonical-adapt-endpoint.md)                                                     | PROPOSED | 2026-05-30 | Post-retirement settled state: loader contract, redirect strategy, Rule H gate 3 (FIX-032).                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [0008-detection-to-adaptation-bridge](0008-detection-to-adaptation-bridge.md)                                         | PROPOSED | 2026-06-01 | Runtime applicator self-annotates detected slot_selectors (no-code); `/adapt` carries slot_selectors (B1); Plan A curated schema, Plan B screenshot AI Vision (FOLLOW-159/160).                                                                                                                                                                                                                                                                                                                                                                |
| [ADR-0013-tracer-admin-sse-auth-and-config-read-contract](ADR-0013-tracer-admin-sse-auth-and-config-read-contract.md) | ACCEPTED | 2026-06-14 | Admin SSE auth via `sb-access-token` cookie (no query-param token); `GET /api/admin/intent/config` returning row `id`; `AdminIntentConfigResponseSchema`; test-integrity constraint on FOLLOW-309/310.                                                                                                                                                                                                                                                                                                                                         |
| [ADR-0014-cross-listing-adaptation-and-sot-archetype](ADR-0014-cross-listing-adaptation-and-sot-archetype.md)         | ACCEPTED | 2026-06-22 | SPA cross-listing detection via in-place `data-estalara-listing-id` MutationObserver; source-of-truth archetype in sessionStorage seeded by quiz, updated by chat/behavioral non-neutral drift, restored on neutral-decay; quiz-disabled parity. Production reqs in `runbooks/SDK_PRODUCTION_INTEGRATION.md`.                                                                                                                                                                                                                                  |
| [ADR-0015-feedback-endpoint-authentication](ADR-0015-feedback-endpoint-authentication.md)                             | ACCEPTED | 2026-07-01 | Permanent fix for ESC-035/F-09: extract existing `resolveApiKey()` (SHA-256 indexed lookup on `api_keys.hashed_key`) to shared `lib/api-key-auth.ts`; use it in feedback route to derive `tenantId` server-side; reject `body.tenant_id` mismatches 403; retain HMAC body sig as defense-in-depth; ops bypass scoped to `OPS_TENANT_ID`. No schema change. No SDK change.                                                                                                                                                                      |
| [ADR-0019-per-tenant-presentation-config](ADR-0019-per-tenant-presentation-config.md)                                 | ACCEPTED | 2026-07-24 | Per-tenant presentation & content config (white-label per-brand epic): one superset `GET /api/quiz/public-config` fetch (tenant from api_key, domain-independent); brand→`tenants.brand_config`, placement→`quiz_config.placement`, opt-out→new column, quiz definition→versioned `quiz_definitions` table; shared Zod module extending ADR-0011; hard-error integrity guardrails (unknown archetype/dangling/cycle) + non-blocking unreachable-archetype warning; unconfigured tenant byte-identical; consuming order FOLLOW-623→639→640→641. |
| [ADR-0020-shadow-intent-write-admission](ADR-0020-shadow-intent-write-admission.md)                                   | PROPOSED | 2026-07-30 | Shadow chat-intent key write-admission: an extraction carrying no usable dimensions (degraded OR neutral-success) is written with `SET … NX` and therefore never clobbers, and never TTL-refreshes, an accumulated prior; keyed on content not `data_source`; no read-back, so `payload.model_dump()` stays the only write path; no merged record, so provenance markers always describe the dims beside them. Implementation: FOLLOW-736.                                                                                                     |

## How to use ADRs

### Reading

- Start with the **Status** section to see if this ADR is current
- Read **Context** to understand the problem space
- Jump to **Decision** for the actual choice and implementation details
- Check **Consequences** to understand trade-offs
- Review **Alternatives considered** to see what was rejected and why

### Writing

1. Copy the template from `.claude/agents/architect.md`
2. Number it sequentially (next available NNNN)
3. Start with status `PROPOSED`
4. Fill all sections with concrete details
5. Get review from relevant agents via escalation
6. Update status to `ACCEPTED` when ratified
7. Add to this index

### Superseding

ADRs are immutable once accepted. To change a decision:

1. Write a new ADR
2. Mark old ADR status as `SUPERSEDED-BY-NNNN`
3. Link bidirectionally between old and new
4. Update this index to show both

### Status meanings

- **PROPOSED** — draft, under review, not yet binding
- **ACCEPTED** — ratified, binding on all agents and implementations
- **DEPRECATED** — no longer recommended but not formally replaced
- **SUPERSEDED-BY-NNNN** — replaced by ADR-NNNN, follow new one

## Cross-references

All ADRs should reference:

- Relevant sections of `docs/MASTER_DESIGN.md`
- Related ADRs (dependencies, alternatives, supersessions)
- Implementation files (schemas, modules, services)
- External sources (vendor docs, research papers, blog posts)

## Governance

- **Owner:** architect agent
- **Review:** PM validates that ADR is needed, architect writes it
- **Approval:** Human founders for Tier-1 decisions, PM + architect for Tier-2
- **Enforcement:** CI checks schema versions, PM checks during ticket validation

## Questions

If you're unsure whether something needs an ADR, ask:

1. Does this decision affect more than one module?
2. Will changing this decision later require >1 week of work?
3. Could another engineer make a different choice without context?

If yes to any, write an ADR.
