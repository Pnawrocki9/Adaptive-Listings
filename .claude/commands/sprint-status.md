---
description: Show current sprint progress, in-flight tickets, blockers, and next suggested action
---

You are checking sprint health. Do exactly this:

1. Read `backlog/QUEUE.md`
2. Read `backlog/STATUS.md`
3. Read `backlog/ESCALATIONS.md` and count OPEN entries
4. Run `gh pr list --state open` if `gh` is available
5. Run `git log --oneline -10`

Then produce a single concise report (max 25 lines):

```
ESTALARA SPRINT STATUS — <timestamp>

Sprint <N> — Day <X> of 14
Tickets: <done>/<total> done | <in_progress> in flight | <blocked> blocked

In flight:
- TICKET-XXX (agent, age, status)
- ...

Awaiting human review:
- PR #N — TICKET-XXX
- ...

Blockers:
- TICKET-YYY blocked on <reason>
- ...

Open escalations: <count>
- <one-line summary each>

Recent commits: <count last 24h>

NEXT: <single concrete action>
```

Do not delegate. Just read and report.
