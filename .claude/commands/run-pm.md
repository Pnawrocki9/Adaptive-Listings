---
description: Invoke the PM Orchestrator to drive the backlog forward — pick next ticket, delegate, validate
---

Invoke the `pm-orchestrator` subagent now. Tell it:

> Drive the backlog forward. Read state, pick the next ready ticket per priority rules, delegate to the right worker, or validate any open PRs. If everything is blocked, surface escalations. End with a NEXT: line.

Wait for the PM to finish. The SubagentStop hook will then surface the next action.
