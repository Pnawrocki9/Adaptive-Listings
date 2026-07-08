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

## Model-fit decision (before every delegation)

Mandatory step, established 2026-07-08: before launching any piece of work or spawning any subagent,
the launcher (human session, PM, or hook-driven flow) decides which Claude model fits the task best
— **Sonnet**, **Opus**, or **Fable** — and sets it explicitly instead of silently inheriting the
agent definition's default. The decision and a one-line justification go into the delegation brief
(or the session log for inline work), so retrospectives can evaluate routing quality.

Routing rubric (canonical copy lives in `CLAUDE.md` §Model-fit rule):

- **Sonnet** — routine implementation inside a defined ticket scope, tests, bookkeeping, mechanical
  refactors, CI fixes.
- **Opus** — complex single-domain reasoning: cross-module debugging, retrospectives, ambiguous
  acceptance criteria, security-sensitive changes, non-trivial design.
- **Fable** — highest-stakes or highest-ambiguity work: architecture audits, Master_Design
  revisions, forensic multi-system debugging, sprint planning, recovery of stranded or conflicting
  work.

Escalate one tier after a failed attempt at the lower tier; never downgrade a P0 on cost grounds.

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
| `backlog/RETROSPECTIVES.md`      | retrospective-analyst (append); pm + workers (read)   | Per-ticket learning log (RETRO-NNN entries)       |
| `backlog/FOLLOW_UPS.md`          | retrospective-analyst (append); pm (promote)          | Stub tickets from retro findings                  |
| `CONVENTIONS_PATCH.md`           | retrospective-analyst (append when ≥2 retros agree)   | Permanent rules growing from learnings            |
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

## Branch-first worker discipline (mandatory — FOLLOW-448 / RETRO-146)

A worker's **FIRST action on any ticket, before touching a single file**, is:

```
git checkout -b <agent>/<ticket-id>-<kebab-summary>
```

Not "edit, then branch before committing." Not "branch once the diff looks done." **First**, before
any `Edit`/`Write` tool call. A worktree that is already on the ticket branch cannot strand work on
`main` no matter when the worker stalls, crashes, or is interrupted — the diagram's "worker agent"
box above starts with this step implicitly on every ticket.

**Why this is codified as a rule and not left as a convention:** on FOLLOW-442 (RETRO-146 §4e) the
implementing `backend-engineer` subagent stalled (600s, no progress) after producing a correct
implementation but **before ever running `git checkout -b`** — the edits sat uncommitted directly in
the `main` working tree. The main session recovered it that time (see "Recovered-work
re-verification" below), but the near-miss is real: uncommitted edits stranded on `main` are
invisible to the next `git checkout -b <newbranch>` — the _next_ ticket that branches from `main`
**silently absorbs the stranded diff into an unrelated branch**, or a routine `git checkout main` /
`git stash drop` **discards the work entirely**. Neither failure mode announces itself.

A mechanical guard backs up this rule: `.claude/hooks/pre-edit-branch-guard.sh` fires on every
`Edit`/`Write`/`MultiEdit` tool call and, when `HEAD == main` (or `master`), surfaces a warning via
the `PreToolUse` `additionalContext` channel so Claude itself sees it mid-session — not just a human
reading a debug log. It is **non-blocking by design** (see the script's header comment for the
rationale: the pm-orchestrator legitimately edits `backlog/QUEUE.md` and its sibling state files
directly on `main`, and a hard block on every `main`-branch edit would break that sanctioned
workflow). Treat the warning as a hard stop anyway: if you see it fire on a ticket file, branch
immediately before continuing.

## Recovered-work re-verification (mandatory when the orchestrator recovers a stalled/handed-off worker)

If a worker stalls, crashes, or is otherwise interrupted mid-ticket, and the pm-orchestrator (or the
human) picks up its output to finish the job, the recovering party MUST, before committing or
opening a PR:

1. **Confirm the branch.** `git status --branch` / `git rev-parse --abbrev-ref HEAD` — the work must
   land on `<agent>/<ticket-id>-<slug>`, never `main`. If it's sitting uncommitted on `main`, move
   it (`git stash` → `git checkout -b <agent>/<ticket-id>-<slug>` → `git stash pop`) before anything
   else.
2. **Confirm nothing else is stranded.** `git status --short` on `main` after the move — it must be
   clean. A second, unrelated stranded diff would otherwise get silently swept into this ticket's
   branch.
3. **Independently re-run verification — never trust a stalled agent's claimed "tests pass."**
   Re-run typecheck + lint + the ticket's test suite yourself (aggregated root commands per the
   tool-call budget rules, not per-package). A worker that stalled did not necessarily finish its
   own verification pass; a worker that crashed produced zero verification. Only the recovering
   party's own run counts as evidence.
4. **Only then** commit, push, and open the PR — with a note in the PR description that the work was
   recovered from a stalled/handed-off subagent and independently re-verified.

This mirrors OPERATING_PRINCIPLE 5 (verify-not-guess) applied to intra-session handoff. Source:
RETRO-146 §4e / FOLLOW-448.

## The retrospective loop (learning loop)

After every PR is merged, the PM spawns a second subagent that runs in parallel with the next
ticket. This is the self-improving learning loop:

```
  PR merged (human)
       │
       ▼
  pm-orchestrator:
  ticket → DONE
       │
       ├──── pick next ticket (continues normal flow above)
       │
       └──── spawn retrospective-analyst (Opus 4.7)
                    │
                    ├── reads last 5 RETROSPECTIVES.md entries
                    ├── diffs merged PR (gh pr diff N | head -1000)
                    ├── greps all changed symbols in codebase
                    ├── checks QUEUE.md for adjacent ticket impacts
                    ├── checks MASTER_DESIGN.md alignment
                    │
                    ▼
             writes RETRO-NNN → backlog/RETROSPECTIVES.md
             writes FOLLOW-NNN stubs → backlog/FOLLOW_UPS.md
             writes Rule X → CONVENTIONS_PATCH.md (only if same
               pattern appeared in ≥2 prior retros)
                    │
                    ▼
             pm-orchestrator reads retro summary:
             - if cascading impact on IN_PROGRESS ticket:
               → comment on that PR, coordinate with worker
             - at next sprint planning:
               → promote FOLLOW_UPS stubs to real tickets
```

**Why this matters:** Each retro reads the prior 5 retros before analyzing. Over time the agent
recognizes recurring patterns (naming inconsistencies, missing test contracts, incomplete type
wiring) and codifies them as permanent Rules. By Sprint 10, workers receive a Rule list that catches
the most common mistake categories before they're made — not after PR review.

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

## Sprint-close checklist

When the PM orchestrator determines a sprint is complete (all tickets DONE or explicitly deferred),
execute the following steps in order before marking the sprint closed:

1. **Verify all DONE tickets have retrospectives.** Every merged PR must have a RETRO-NNN entry in
   `backlog/RETROSPECTIVES.md`. If any are missing, spawn the retrospective-analyst before
   proceeding.

2. **Promote FOLLOW_UPS stubs.** Read `backlog/FOLLOW_UPS.md`. Promote all P0 and P1 stubs that are
   not yet `promoted_to_queue: true` to the next sprint's backlog. Create ticket files and add
   QUEUE.md entries.

3. **Update sprint progress in QUEUE.md.** Mark the sprint section with final DONE/DEFERRED counts.
   Set `completed_at` on the sprint block.

4. **Re-verify Snapshot.1 (MANDATORY — process violation to skip).** For every row in
   `docs/MASTER_DESIGN.md §Snapshot.1`, spot-check the verdict against current `HEAD`:
   - Grep for key symbols cited in the row (function names, file paths, table names)
   - Check that cited files still exist at the claimed line counts
   - Verify status claims (`Shipped`, `Mostly Shipped`, `Partial`, `Design-Only`, `Blocked`) match
     current codebase reality
   - Update any stale rows inline (same PR is fine; open a dedicated reconciliation PR if large)
   - Bump Master Design version and add a changelog entry for any row that changed
   - This obligation comes from Master Design §Y.3 and Operating Principles Rule 2 (continuous
     synchronization). Skipping it is a process violation that caused Sprint 9.5 rows B.4 and J to
     go stale (retroactively fixed by RETRO-005 §7 Edits M-1..M-6).

After all four steps pass, the sprint is closed.

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
