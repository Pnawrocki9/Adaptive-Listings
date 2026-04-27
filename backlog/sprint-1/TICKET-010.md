---
id: TICKET-010
title: ADR-0003 Event schema design and versioning strategy (already drafted)
sprint: 1
priority: P0
agent: architect
status: BLOCKED
estimated_hours: 2
depends_on: [TICKET-009]
produces: [TICKET-011]
affects_files:
  - "docs/adr/0003-event-schema-and-versioning.md"
  - "docs/adr/README.md"
  - "docs/CONVENTIONS.md"
context_files:
  - docs/MASTER_DESIGN.md (sections C.1, C.2)
  - docs/adr/0003-event-schema-and-versioning.md (delivered with Paczka 2)
labels: [sprint-1, p0, architecture, adr]
---

# TICKET-010: Integrate ADR-0003 (Event schema design)

## Summary

ADR-0003 (Event schema design and versioning strategy) is delivered as a draft with Paczka 2 in `docs/adr/0003-event-schema-and-versioning.md`. This ticket is the "review and accept" step: the architect agent reads the ADR, validates it against MASTER_DESIGN.md sections C.1/C.2, makes any needed adjustments, marks it ACCEPTED, and ensures it's discoverable from `docs/adr/README.md` and linked from `docs/CONVENTIONS.md`. Once accepted, it becomes the contract that TICKET-011 implements in code.

## Context

The ADR has already been drafted thoroughly (see file). The architect's job:
1. Read it carefully against Master Design
2. Identify any contradictions or gaps
3. Either propose minor edits (small PR) or call for major rework (escalate)
4. Once finalized, set status to ACCEPTED and link from index

If the architect finds the ADR materially inconsistent with Master Design or with a vendor decision (e.g., "we should use Avro because Redpanda has a registry"), they can propose changes — but a major rewrite is itself an architectural decision that may need a new ADR or escalation.

## Scope

### In scope
- Read `docs/adr/0003-event-schema-and-versioning.md` thoroughly
- Cross-reference against `docs/MASTER_DESIGN.md` sections C.1, C.2, I (tech stack)
- Make any minor edits (typo fixes, cross-references, examples) directly in the ADR
- Update `docs/adr/README.md` to list ADR-0003 with one-line summary
- Add reference to ADR-0003 from `docs/CONVENTIONS.md` in the relevant section (likely the "Event handling" section if it exists, or create one)
- Confirm ADR status remains ACCEPTED

### Out of scope
- Implementing the schemas (that's TICKET-011)
- Major rewrites without escalation
- Adding new ADRs

## Acceptance criteria

- [ ] AC1: ADR-0003 is read fully and cross-referenced against Master Design
- [ ] AC2: Status field reads `ACCEPTED` with date matching today
- [ ] AC3: `docs/adr/README.md` (creates if missing) has an entry: `0003 — Event schema design and versioning (ACCEPTED, 2026-04-27)` with link
- [ ] AC4: `docs/CONVENTIONS.md` references ADR-0003 in the section on event handling / data contracts
- [ ] AC5: If any inconsistencies with Master Design are found, EITHER they're fixed in the ADR with a note, OR an escalation is filed
- [ ] AC6: Lint/format/build all pass
- [ ] AC7: PR title `docs(arch): ratify ADR-0003 event schema [TICKET-010]`

## Implementation guidance

The ADR is delivered drafted. You're not writing from scratch. Most of this ticket is reading and verifying. Real edits should be light touch.

If you find something major (e.g., "Master Design says we use protobuf for ingest but ADR says JSON" — there is no such conflict, this is just an example), STOP, file an escalation explaining the conflict, and let the human decide.

## Test plan

- Format check passes
- Markdown links validate (`pnpm exec markdownlint docs/adr/*.md`)
- ADR is visible in `docs/adr/README.md` index

## Definition of Done

- [ ] Branch `architect/TICKET-010-adr-event-schema-ratified`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] HANDOFF: TICKET-010 → TICKET-011 (now schemas can be implemented)

## Notes

- Quick ticket, <2h. The hard work is already done in the ADR draft.
- If you find yourself wanting to add a major new section, that's an indicator you should escalate.
