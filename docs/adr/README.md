# Architecture Decision Records (ADRs)

This directory contains all architectural decisions for Estalara Adaptive Listings. Every
non-obvious decision that affects multiple modules, public APIs, or cross-cutting concerns is
documented here.

## Index

| ADR                                                                             | Status   | Date       | Summary                                                                                     |
| ------------------------------------------------------------------------------- | -------- | ---------- | ------------------------------------------------------------------------------------------- |
| [0003-event-schema-and-versioning](0003-event-schema-and-versioning.md)         | ACCEPTED | 2026-04-29 | Event envelope, per-type schemas, versioning strategy (additive-only within major version). |
| [ADR-0004-canonical-adapt-endpoint](ADR-0004-canonical-adapt-endpoint.md)       | ACCEPTED | 2026-05-17 | control-plane `/api/adapt` is canonical; Worker is edge holdout gate only.                  |
| [ADR-0005-modal-apps-disposition](ADR-0005-modal-apps-disposition.md)           | ACCEPTED | —          | Modal placeholder apps disposition; intelligence lives in TS edge + async jobs.             |
| [ADR-0006-canonical-adapt-enforcement](ADR-0006-canonical-adapt-enforcement.md) | PROPOSED | 2026-05-25 | Runtime enforcement of ADR-0004: SDK targeting, Worker disposition, CI guard (FOLLOW-105).  |

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
