# FOLLOW-061 — Add Snapshot.1 Re-Verification to Sprint-Close Checklist

**Sprint:** 10
**Agent:** architect
**Priority:** P1
**Estimated hours:** 0.5
**Status:** IN_PROGRESS
**Source retro:** RETRO-005
**Source ticket:** process gap (not a ticket)

---

## Context

Operating Principles §Y.3 (in `docs/ops/OPERATING_PRINCIPLES.md`) and Master Design §Y.3 require
that Snapshot.1 be re-verified after every sprint completion. Sprint 9.5 violated this: rows B.4
and J went stale and had to be corrected retroactively by RETRO-005 §7 Edits M-1..M-6.

The root cause was not ignorance of the rule — §Y.3 existed — but that there was no checklist
item forcing the verification at sprint close. Without a structural hook, the verification is
optional in practice even when mandatory in policy.

This ticket closes the process gap by adding Snapshot.1 re-verification as a mandatory final step
on the PM-orchestrator sprint-close checklist.

---

## Acceptance Criteria

- [ ] Sprint-close checklist updated in `docs/AGENT_WORKFLOW.md` — Snapshot.1 re-verification added
      as the last item, with explicit reference to §Y.3 and what "re-verification" means
      (grep for key symbols, check file existence, update stale rows)
- [ ] PM-orchestrator agent prompt (`.claude/agents/pm-orchestrator.md`) amended to include
      "verify Snapshot.1 still matches reality before closing sprint" in the sprint-close procedure
- [ ] `docs/MASTER_DESIGN.md` Snapshot.1 section updated with forward reference: "Sprint 10
      Snapshot.1 re-verification will be performed at sprint close per the checklist in
      `docs/AGENT_WORKFLOW.md`"
- [ ] Master Design version bumped for the AGENT_WORKFLOW.md substantive change

---

## What NOT to do

Do not perform the actual Snapshot.1 re-verification in this ticket. That happens at Sprint 10
close. This ticket only installs the checklist item so it cannot be skipped again.

---

## Files to edit

1. `docs/AGENT_WORKFLOW.md` — add sprint-close checklist section
2. `.claude/agents/pm-orchestrator.md` — add sprint-close step after step 6
3. `docs/MASTER_DESIGN.md` — update Snapshot.1 forward reference + version bump

---

## References

- `docs/ops/OPERATING_PRINCIPLES.md` §Y.3 (pointer via Appendix B)
- `docs/MASTER_DESIGN.md` §Y.3 — Snapshot.1 freshness policy
- `backlog/RETROSPECTIVES.md` RETRO-005 §4d + §7 Edits M-1..M-6
- `backlog/FOLLOW_UPS.md` FOLLOW-061 stub
