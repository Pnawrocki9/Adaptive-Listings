# qa-engineer lesson fragments (Rule AG)

Created 2026-09-21 by FOLLOW-1243 (RETRO-338 §4d DG-2: #916 and #922 both appended to the shared
`lessons.md` tail from worktrees, and this agent had no fragment directory).

**Rule AG (`CONVENTIONS_PATCH.md`):** an agent running in a worktree MUST NOT append to a shared
append-only log while other agents may be running. Write your lesson to a per-ticket fragment file,
`.claude/agents/qa-engineer/lessons.d/<TICKET>.md` (for example `FOLLOW-1240.md`), never to the
shared `lessons.md` tail. Two writers that both target end-of-file collide by construction, whatever
their content. A periodic or serial job may concatenate fragments into `lessons.md`.

Fragment shape (same four fields as `lessons.md`):

- **Date / ticket** · **What I tested** · **Where a test could have passed over a dead wire** · **A
  guardrail I'd add** (or "none").

If the write under `.claude/` is refused by the permission system, follow the Rule AG amendment
(2026-08-05): put the intended path and the full text verbatim in the PR body and the final report;
do not work around the block; the PM lands it in the same session.

A dated correction to an EXISTING `lessons.md` entry is an in-place edit of that entry, not an
append, and is allowed when it is the minimal localized change (precedent: the 2026-09-21 correction
to the 2026-09-20 / FOLLOW-1185 entry).
