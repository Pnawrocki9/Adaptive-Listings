---
description: Manually invoke retrospective-analyst for a specific ticket — useful for retroactive
  audit of previously merged tickets (e.g. PRs #80–#90 that landed before the learning loop was set up)
---

Invoke the `retrospective-analyst` subagent now for the ticket ID given as the argument to this
command. If no argument is provided, ask the user which ticket to analyze and stop.

Tell the agent:

> Use the `retrospective-analyst` subagent for $ARGUMENTS.
>
> 1. Look up the corresponding PR number: search `gh pr list --state merged --search "$ARGUMENTS"`
>    and pick the PR whose title contains the ticket ID. If multiple match, ask the user which one.
> 2. Read `backlog/sprint-N/$ARGUMENTS.md` (locate via `find backlog -name "$ARGUMENTS.md"`).
> 3. Run `gh pr diff <N> | head -1000` and
>    `gh pr view <N> --json files,additions,deletions,mergeCommit`.
> 4. Read the latest 5 entries from `backlog/RETROSPECTIVES.md` to detect cross-retro patterns.
> 5. Produce one RETRO-NNN entry following the 7-section template in your agent definition.
> 6. Generate FOLLOW-UPS stubs in `backlog/FOLLOW_UPS.md` for any gap that needs a new ticket.
> 7. Codify a new Rule in `CONVENTIONS_PATCH.md` ONLY if the same finding pattern appeared in ≥2
>    prior retros (RULE_PROMOTION_THRESHOLD = 2).
> 8. Print the summary line `RETRO-NNN complete.` at the end of your run.

This bypasses the normal PM Step 7 trigger and is intended for:

- Retroactive audit of merged PRs that predated the learning loop (e.g. PR #80–#90)
- Re-running an analysis after the agent definition is updated
- One-off deep-dive on a specific ticket that the human flagged as suspect

The retrospective runs ASYNC — it does not modify QUEUE.md and does not pause any IN_PROGRESS
tickets. If the retro finds a critical gap, it surfaces it in RETROSPECTIVES.md section 4 (Cascading
impact) with severity, and the human / PM decides whether to write an entry to
`backlog/ESCALATIONS.md`.
