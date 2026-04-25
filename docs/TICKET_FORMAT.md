# Ticket Format

Every ticket lives in `backlog/sprint-N/TICKET-XXX.md` and follows this structure exactly. PM agent uses these fields to decide who works on what and what "done" means.

## Template

````markdown
---
id: TICKET-042
title: Implement event ingestion endpoint
sprint: 0
priority: P0
agent: backend-engineer
status: READY
estimated_hours: 6
depends_on: [TICKET-008, TICKET-015]
produces: [TICKET-051, TICKET-073]
affects_files:
  - apps/ingest/src/**
  - packages/shared/src/schemas/event.ts
context_files:
  - docs/MASTER_DESIGN.md#section-A
  - docs/adr/0003-event-schema.md
labels: [ingest, api, p0]
---

# TICKET-042: Implement event ingestion endpoint

## Summary

One paragraph: what we're building and why. The reader should understand the goal in 30 seconds.

## Context

Background information the agent needs. Reference design docs, ADRs, related tickets. Include any relevant excerpts inline if they're short.

## Scope

### In scope
- Bullet list of what this ticket includes
- Be specific about endpoints, schemas, modules

### Out of scope
- Explicitly call out what is NOT being done
- Reference other tickets for those parts

## Acceptance criteria

The ticket is DONE when ALL of these are true:

- [ ] AC1: Specific, verifiable claim. Use action verbs.
- [ ] AC2: Tests cover the new code at ≥80%
- [ ] AC3: Lint, typecheck, build pass in CI
- [ ] AC4: Performance budget met (specify metric)
- [ ] AC5: Documentation updated (which file)

The PM agent will literally check each box. If it can't verify automatically, it will say so in the PR comment and the human verifies.

## Implementation guidance

Optional. If the architect or another senior agent has specific guidance on HOW to do this, put it here.

```typescript
// example code patterns or pseudocode if helpful
```

## Test plan

- Unit tests: <list>
- Integration tests: <list>
- E2E tests: <list>
- Load test impact: <yes/no, what changes>

## Definition of Done (universal — applies to every ticket)

- [ ] Branch named `<agent>/TICKET-XXX-<slug>`
- [ ] Conventional commit messages, each referencing TICKET-XXX
- [ ] PR opened with TICKET-XXX in title
- [ ] All ACs above verified
- [ ] CI green (typecheck, lint, test, build)
- [ ] Coverage gates met
- [ ] No new TODO/FIXME without ticket number
- [ ] No new dependencies without architect approval
- [ ] Docs updated for any public surface change
- [ ] HANDOFF written if this ticket produces input for another

## Notes

Any other context, gotchas, alternatives considered, links.
````

## Field semantics

### `id`
Format: `TICKET-NNN` zero-padded to 3 digits (TICKET-001 through TICKET-999). Globally unique.

### `title`
One line, imperative voice, <80 chars.

### `sprint`
Integer, 0–11 for the 12-week MVP.

### `priority`
- **P0** — must ship this sprint
- **P1** — should ship this sprint
- **P2** — nice to have, slip-able
- **P3** — backlog, may slip multiple sprints

### `agent`
Exactly one of: `architect`, `sdk-engineer`, `backend-engineer`, `data-engineer`, `ml-engineer`, `devops-engineer`, `qa-engineer`, `compliance-engineer`. Never `pm-orchestrator` (PM doesn't write code).

### `status`
- **BACKLOG** — not yet planned for a sprint
- **READY** — can be worked on now (deps satisfied)
- **BLOCKED** — depends on unfinished tickets
- **IN_PROGRESS** — actively being worked
- **READY_FOR_REVIEW** — PR open, PM-validated, awaiting human merge
- **DONE** — merged
- **STUCK** — agent failed 3+ times, needs escalation
- **CANCELLED** — won't do, with reason in Notes

### `estimated_hours`
Realistic agent-hours. Most tickets should be 2–8 hours. If >12, split it.

### `depends_on`
Array of ticket IDs that must be `DONE` before this can start. Empty if independent.

### `produces`
Array of ticket IDs that depend on this one's output. Helps PM order work and triggers HANDOFFS.

### `affects_files`
Glob patterns of files this ticket may touch. Used to detect parallel-edit conflicts. Be honest — this is the conflict-detection mechanism.

### `context_files`
Files the agent must read before starting. Always include relevant MASTER_DESIGN sections and ADRs.

### `labels`
Free-form tags for filtering and reporting.

## Sizing guidance

| Estimated hours | What it looks like |
|---|---|
| 1–2h | Single function, single file, minimal tests |
| 2–4h | Single feature, multiple files in one module |
| 4–8h | Cross-cutting feature, integration tests required |
| 8–12h | Probably should be split |
| >12h | Definitely split — write 2-4 smaller tickets |

If you have a 16-hour ticket, the architect splits it before the PM picks it up.

## Worked example

See `backlog/sprint-0/TICKET-001.md` for a concrete example following this format exactly.
