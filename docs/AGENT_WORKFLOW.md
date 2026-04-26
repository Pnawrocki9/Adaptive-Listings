# Agent Workflow

How the 9 Claude Code agents coordinate to build Estalara Adaptive Listings.

## The model

This repo runs an **agent-orchestrated** development workflow. Most code is written by specialized
Claude Code subagents under the supervision of a PM agent. Humans (Piotr, Rafał, Krystian) review
PRs and resolve escalations.

Critical constraint from Claude Code: **subagents cannot talk to each other directly**. They only
communicate through files in this repo. The orchestration is built around that constraint.

## The 9 agents

| Agent                 | Domain                                                   |
| --------------------- | -------------------------------------------------------- |
| `pm-orchestrator`     | Reads backlog, delegates, validates, updates queue       |
| `architect`           | Interfaces between modules, ADRs, dependency decisions   |
| `sdk-engineer`        | `@estalara/sdk` (Preact + Shadow DOM, vanilla TS)        |
| `backend-engineer`    | Cloudflare Workers, Next.js, Postgres + RLS              |
| `data-engineer`       | ClickHouse, Redpanda, ETL, archetype pipeline            |
| `ml-engineer`         | Intent engine, embeddings, adaptation logic, LLM gateway |
| `devops-engineer`     | Terraform, CI/CD, multi-region, observability            |
| `qa-engineer`         | E2E, integration, load tests, canaries                   |
| `compliance-engineer` | DPIA, ROPA, GDPR/CCPA/PDPL, fair-housing                 |

Each lives in `.claude/agents/<n>.md`.

## The state files

These files are the single source of truth. Agents read and write them; humans read and occasionally
edit.

| File                             | Owner                                                 | Purpose                                           |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| `backlog/QUEUE.md`               | pm-orchestrator (write); all (read)                   | Master ticket list with statuses                  |
| `backlog/STATUS.md`              | pm-orchestrator                                       | Snapshot of current sprint progress               |
| `backlog/ESCALATIONS.md`         | any agent (append); human (resolve)                   | Issues that need human decisions                  |
| `backlog/HANDOFFS.md`            | producing agent (append); pm + consuming agent (read) | Notes when one ticket's output is another's input |
| `backlog/sprint-N/TICKET-XXX.md` | architect (create); pm + workers (update)             | Individual ticket spec                            |
| `docs/INTERFACES.md`             | architect                                             | Index of cross-module contracts                   |
| `docs/adr/NNNN-*.md`             | architect                                             | Architecture Decision Records                     |

## The control loop

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  HUMAN (Piotr) starts session                                   │
│         │                                                       │
│         │ /run-pm                                               │
│         ▼                                                       │
│  ┌──────────────────┐                                           │
│  │ pm-orchestrator  │                                           │
│  │ reads QUEUE.md   │                                           │
│  │ picks ticket     │                                           │
│  └────────┬─────────┘                                           │
│           │ "Use the <agent> subagent on TICKET-XXX"            │
│           ▼                                                     │
│  ┌──────────────────┐                                           │
│  │ worker agent     │                                           │
│  │ reads ticket     │                                           │
│  │ writes code      │                                           │
│  │ opens PR         │                                           │
│  └────────┬─────────┘                                           │
│           │ SubagentStop hook fires                             │
│           ▼                                                     │
│  ┌──────────────────┐                                           │
│  │ pm-orchestrator  │  (re-invoked automatically)               │
│  │ validates PR     │                                           │
│  │ runs tests       │                                           │
│  │ checks AC        │                                           │
│  └────────┬─────────┘                                           │
│           │                                                     │
│           ├─── pass → mark READY_FOR_REVIEW                     │
│           │           (human reviews + merges)                  │
│           │                                                     │
│           └─── fail → re-delegate (max 3 retries)               │
│                       or escalate                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## The autonomy boundary

### Worker agents can act without asking

- Implement a ticket within its acceptance criteria
- Refactor inside their own module
- Write tests
- Update docs that don't change architectural decisions
- Patch bumps on dependencies they own
- Fix flaky CI within their module

### Worker agents must escalate (write to `ESCALATIONS.md`)

- Acceptance criteria are ambiguous
- Ticket conflicts with another module's contract
- Need to change a public API
- Need to add a new vendor / new third party service
- About to add >€100/mo to recurring costs
- Detected security issue
- Discovered the ticket needs to split into multiple tickets

### PM agent escalates

- Two workers disagree on an interface
- Ticket blocked >24h
- Sprint velocity <50% of plan
- Test coverage drops below thresholds
- More than 3 retries on the same ticket

### Humans always do (never delegated)

- Merge PRs
- Resolve escalations
- Approve production deploys
- Sign off on compliance/legal questions
- Approve pricing or vendor changes
- Tag releases

## A typical sprint day (your 2 hours)

**Morning (45 min):**

1. Run `/sprint-status` — get the snapshot
2. Resolve any open escalations
3. Review and merge PRs marked `READY_FOR_REVIEW`
4. Run `/run-pm` to kick off the loop

**Afternoon (45 min):**

1. Run `/sprint-status` again
2. Review and merge any new PRs
3. Spot-check 1-2 in-flight tickets if anything looks off
4. Add escalations for anything you noticed

**Evening (30 min):**

1. Final `/sprint-status`
2. Last round of merges
3. Note anything for tomorrow in `backlog/ESCALATIONS.md`

The PM agent runs autonomously between your sessions, picking up tickets and validating PRs. When
you return, you primarily process its output (review + merge + escalations) rather than writing
prompts.

## Failure modes and recovery

### "An agent is stuck in a loop"

Check `git log` and CI history. If you see >3 commits on the same ticket attempting the same fix:

- Mark ticket `STUCK` in QUEUE.md
- Add escalation
- Re-read the ticket spec — it's probably ambiguous

### "Two PRs conflict on the same files"

Two agents shouldn't have been picking those tickets. PM should have detected the conflict via
`produces`/`affects` lists in tickets. If it didn't:

- Close the later PR
- Move that ticket back to `READY`
- Add escalation about ticket dependency graph correctness

### "An agent wrote code I didn't expect"

PR review is the safety valve. If a PR diverges from the ticket spec:

- Comment with what's wrong
- Push `READY_FOR_REVIEW` → `IN_PROGRESS` in QUEUE.md
- Tell PM: "Re-delegate TICKET-XXX with this clarification: ..."

### "CI is broken and nothing can merge"

Page devops-engineer. Add escalation. Often this is a flaky test or a vendor outage.

### "I disagree with an architectural choice an agent made"

Don't fight in PR comments. Either:

- Write an ADR proposal yourself in `docs/adr/`
- Add escalation with the architectural concern
- Have the architect agent write the rebuttal/alternative

## Adding a new ticket mid-sprint

Sometimes you'll discover work that wasn't in the original sprint plan. Process:

1. Open `backlog/sprint-N/` and create `TICKET-XXX.md` using the template
2. Add it to `backlog/QUEUE.md` with status `READY` (or `BLOCKED` if dependencies)
3. Done. PM will pick it up on the next loop.

If the ticket is large (>1 day of work), use the architect to split it first:

> Use the architect subagent to split this rough idea into 3-5 well-scoped tickets: <description>

## Adding a new agent

Generally don't. The 9 we have cover MVP scope. If a recurring need appears that doesn't fit any
agent:

1. Document the need in an ADR
2. Define the new agent in `.claude/agents/<n>.md`
3. Update this doc and `CLAUDE.md`
4. Re-test the team's coordination

## What this is not

- Not autonomous AGI building your product. You stay in the loop on architecture, merges, and
  escalations.
- Not a replacement for code review. PM validates AC; humans validate quality and judgment.
- Not magic. Agents fail. Loops break. Have backups (git, Doppler) and don't push agents to
  production directly.
- Not zero-cost. LLM tokens add up. Watch the Anthropic + OpenAI bills.

## Quick reference

| What                     | Command                                      |
| ------------------------ | -------------------------------------------- |
| Start the day            | `/sprint-status`                             |
| Drive the queue          | `/run-pm`                                    |
| Add a human escalation   | `/escalate`                                  |
| See open PRs             | `gh pr list --state open`                    |
| See last 20 commits      | `git log --oneline -20`                      |
| See current branch state | `git status`                                 |
| Force PM to re-pick      | edit QUEUE.md status to READY, run `/run-pm` |

When in doubt: read `CLAUDE.md`. When still in doubt: escalate.
