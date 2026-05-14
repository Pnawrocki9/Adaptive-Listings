---
id: TICKET-RETRO-001
title: Set up per-ticket retrospective learning loop
sprint: 8
priority: P0
agent: architect
status: DONE
estimated_hours: 6
depends_on: []
produces: []
affects_files:
  - .claude/agents/retrospective-analyst.md
  - backlog/RETROSPECTIVES.md
  - backlog/FOLLOW_UPS.md
  - CONVENTIONS_PATCH.md
  - .claude/agents/pm-orchestrator.md
  - CLAUDE.md
  - docs/AGENT_WORKFLOW.md
  - docs/TICKET_FORMAT.md
context_files:
  - docs/MASTER_DESIGN.md
  - .claude/agents/pm-orchestrator.md
  - CLAUDE.md
  - docs/AGENT_WORKFLOW.md
retro_completed: true
labels: [learning-loop, meta, p0]
---

# TICKET-RETRO-001: Set up per-ticket retrospective learning loop

## Summary

After every ticket is merged, Claude Opus 4.7 (`retrospective-analyst`) analyzes the impact of that
implementation on the whole project — finding logic gaps, code bugs not caught in PR review,
cascading effects on future tickets, and architectural drift. The findings accumulate in a
structured log (`backlog/RETROSPECTIVES.md`) that the agent reads before each new analysis, making
the loop self-improving: each retro benefits from all prior retros. This is the mechanism that
prevents "forgot something fundamental at MVP end" surprises.

## Context

Discovered need: after PR #92 (TICKET-046, playbook variants), several cascading issues were found
only in retrospect — the `feature-section` bug had existed undetected for multiple sprints,
`MOCK_PLAYBOOK` in tests broke typecheck after a type change, and bandit variant wiring was silently
incomplete despite the DB table existing. These would have been caught earlier by a systematic
per-ticket analysis.

The PM orchestrator previously only ran a retrospective at sprint end. That's too late.

## Scope

### In scope

- New agent definition: `.claude/agents/retrospective-analyst.md` (Opus 4.7, 7-section output
  template, rule promotion at ≥2 occurrences)
- Bootstrap: `backlog/RETROSPECTIVES.md` with RETRO-001 (TICKET-046 / PR #92)
- Bootstrap: `backlog/FOLLOW_UPS.md` with 5 initial stubs from RETRO-001
- Bootstrap: `CONVENTIONS_PATCH.md` with Rules A–G (A–F from Paczka 1, G from RETRO-001)
- PM orchestrator: new Step 7 (spawn retrospective after ticket DONE)
- CLAUDE.md: "Per-ticket retrospective loop" section
- AGENT_WORKFLOW.md: retrospective flow section
- TICKET_FORMAT.md: optional `retro_completed` field

### Out of scope

- Running the retrospective-analyst agent for tickets other than the bootstrap RETRO-001 (that
  happens automatically going forward via PM Step 7)
- Sprint-level retrospective (separate concern, existing pm-orchestrator behavior unchanged)
- Automating FOLLOW_UPS promotion (PM does this manually at sprint planning)

## Acceptance criteria

- [ ] AC1: `.claude/agents/retrospective-analyst.md` exists, frontmatter has `model: opus`, tools
      include Read/Glob/Grep/Bash/Write/Edit, 7-section output template present
- [ ] AC2: `backlog/RETROSPECTIVES.md` exists with at least RETRO-001 entry covering TICKET-046
- [ ] AC3: `backlog/FOLLOW_UPS.md` exists with at least 3 stubs from RETRO-001
- [ ] AC4: `CONVENTIONS_PATCH.md` exists at repo root with Rules A–F minimum
- [ ] AC5: `.claude/agents/pm-orchestrator.md` contains `### 7. Spawn retrospective` section
- [ ] AC6: `CLAUDE.md` contains "Per-ticket retrospective loop" heading
- [ ] AC7: `docs/AGENT_WORKFLOW.md` contains retrospective flow section
- [ ] AC8: `docs/TICKET_FORMAT.md` contains `retro_completed` field documentation

## Verification

```bash
# AC1
test -f .claude/agents/retrospective-analyst.md && \
  grep -q "model: opus" .claude/agents/retrospective-analyst.md

# AC2
grep -q "^## RETRO-001" backlog/RETROSPECTIVES.md

# AC3
grep -q "source_retro: RETRO-001" backlog/FOLLOW_UPS.md

# AC4
test -f CONVENTIONS_PATCH.md && grep -q "## Rule A" CONVENTIONS_PATCH.md

# AC5
grep -q "### 7. Spawn retrospective" .claude/agents/pm-orchestrator.md

# AC6
grep -q "Per-ticket retrospective loop" CLAUDE.md

# AC7
grep -q "retrospective" docs/AGENT_WORKFLOW.md

# AC8
grep -q "retro_completed" docs/TICKET_FORMAT.md
```

## Notes

The RULE_PROMOTION_THRESHOLD is 2 — a pattern must appear in at least 2 separate retros before it
becomes a permanent Rule in CONVENTIONS_PATCH.md. Rule G was pre-emptively included (breaking type
changes → grep for inline mocks) because it's a TypeScript-universal pattern, not just a single
occurrence. Future rules follow the strict threshold.

The retrospective-analyst uses Opus 4.7 for deep reasoning across long diffs and cross-module
cascade analysis. This is intentional — Opus for retro, Sonnet for implementation workers.
