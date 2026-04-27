---
id: TICKET-007
title: Update README + CLAUDE.md to reflect 10 apps / 10 packages
sprint: 0
priority: P2
agent: architect
status: BLOCKED
estimated_hours: 1
depends_on: [TICKET-005, TICKET-006]
produces: []
affects_files:
  - "README.md"
  - "CLAUDE.md"
  - "docs/CONVENTIONS.md"
context_files:
  - docs/MASTER_DESIGN.md (full)
  - CLAUDE_PATCH.md (read instructions there)
  - apps/*/README.md (verify counts)
  - packages/*/README.md
labels: [foundation, p2, docs]
---

# TICKET-007: Update README + CLAUDE.md to reflect 10 apps / 10 packages

## Summary

After TICKET-005 (auto-detect placeholder) and TICKET-006 (platform-templates placeholder) merge, the repo has 10 apps and 10 packages. But `README.md` and `CLAUDE.md` still say "9 apps, 9 packages" from TICKET-001. Update them. Also apply the changes documented in `CLAUDE_PATCH.md` (delivered in Paczka 2 root) — those add three Paczka 1 lessons-learned rules to CLAUDE.md.

This is a small docs-only ticket but high value: it ensures every future Claude Code session boots with accurate context.

## Context

- `CLAUDE.md` mentions "9 packages" and "9 apps" hardcoded
- `README.md` repeats the count
- `CLAUDE_PATCH.md` (in repo root, delivered with Paczka 2) describes the changes to make
- Auto-onboarding mention should appear in CLAUDE.md so agents know it's an architectural concern

## Scope

### In scope
- Apply all 5 changes documented in `CLAUDE_PATCH.md` to `CLAUDE.md`
- Update `README.md` count from 9+9 to 10+10
- Add a note to `README.md` "Tech stack (decided)" section mentioning Auto-Detect (Modal Python + Vision)
- Add a note to `docs/CONVENTIONS.md` "Repository structure" section showing `apps/auto-detect` and `packages/platform-templates`
- After applying CLAUDE_PATCH.md, **delete the patch file** (no longer needed in repo) — commit deletion

### Out of scope
- Adding tickets to QUEUE.md (already in Paczka 2 QUEUE.md)
- Changing agent definitions in `.claude/agents/` (those go in their own ticket if needed)

## Acceptance criteria

- [ ] AC1: `CLAUDE.md` references "10 apps, 10 packages" everywhere it previously said 9
- [ ] AC2: `CLAUDE.md` includes the new "Lessons from Paczka 1" section per CLAUDE_PATCH.md change 3
- [ ] AC3: `CLAUDE.md` agent descriptions for backend-engineer, ml-engineer, data-engineer expanded per CLAUDE_PATCH.md change 4
- [ ] AC4: `CLAUDE.md` escalation rules updated with two new bullets per CLAUDE_PATCH.md change 5
- [ ] AC5: `README.md` reflects 10+10 count and mentions Auto-Detect in tech stack
- [ ] AC6: `docs/CONVENTIONS.md` repository structure section updated to show 10+10 layout
- [ ] AC7: `CLAUDE_PATCH.md` deleted from repo root (committed)
- [ ] AC8: PR title `docs: update agent context to reflect 10 apps + 10 packages [TICKET-007]`

## Implementation guidance

The architect agent owns this ticket because it requires careful interpretation of the patch instructions and judgment about how to merge them cleanly into existing prose. It's a docs ticket, not a code ticket.

Process:
1. Read `CLAUDE_PATCH.md` carefully end-to-end
2. Open `CLAUDE.md` in repo, locate each section mentioned in the patch
3. Apply each of the 5 changes carefully — preserve existing structure, only modify what the patch specifies
4. Open `README.md`, find every occurrence of "9 packages" or "9 apps" or similar phrasing, update
5. Open `docs/CONVENTIONS.md`, find the "Repository structure" section, update the apps/ and packages/ trees
6. Run `pnpm exec prettier --write CLAUDE.md README.md docs/CONVENTIONS.md`
7. Delete `CLAUDE_PATCH.md`
8. Commit with conventional commit message

## Test plan

- Manual review: human reviewer can verify the patch was applied faithfully (PM agent should call this out in PR comment)
- No automated test for prose changes
- Lint, typecheck, build still pass
- `pnpm exec prettier --check .` clean

## Definition of Done

- [ ] Branch `architect/TICKET-007-update-counts-and-context`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] No code changes (this is docs-only); if you find yourself touching .ts files, stop — that belongs in a different ticket

## Notes

- This ticket is BLOCKED until TICKET-005 and TICKET-006 merge. Once they merge, agents creating those new placeholder apps/packages have already added basic READMEs. You're not creating new content here — you're updating the master context docs.
- If `CLAUDE_PATCH.md` and `CLAUDE.md` conflict in non-obvious ways, escalate to human.
