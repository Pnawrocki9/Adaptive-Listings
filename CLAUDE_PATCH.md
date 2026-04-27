# CLAUDE.md Update Patch (Paczka 2)

**This file documents the changes that should be applied to your existing `CLAUDE.md`.** You can
either:

A) Apply manually by hand (cleanest), or  
B) Copy this entire file as `CLAUDE_PATCH.md` to the repo, agents will read both.

## Why update

Paczka 1 testing revealed three issues to harden in CLAUDE.md:

1. The agent counts ("9 packages, 9 apps") are now stale — Master Design v1.1 added
   `apps/auto-detect/` and `packages/platform-templates/`. Sprint 0 in Paczka 2 will create them.
2. The "When agents must escalate" rules need additions for the failure modes we found (CI not
   green, repo-config dependencies).
3. Three new rules from Paczka 1 lessons need to be visible at the top of every Claude Code session.

## Apply these specific changes to `CLAUDE.md`

### Change 1 — Replace the "What we're building" tier counts

**Find this paragraph:**

```
This is an agent-orchestrated codebase. Most code is written by specialized Claude Code subagents coordinated by a PM agent. Humans review PRs and make architectural calls.
```

**Add after it:**

```
The full architectural and business design is in docs/MASTER_DESIGN.md (currently v1.1 — read the changelog at top for what's new in this version).

Repository scale (current target):
- 10 apps (apps/ingest, apps/control-plane, apps/decision-api, plus 7 Modal Python apps)
- 10 packages (packages/sdk through packages/platform-templates)

Three integration tiers (Observer / Augment / Native), four regions (EU/US/UK/UAE), 12-week MVP timeline.
```

### Change 2 — Update "How agents communicate" rule on validation

**Find this section:**

```
3. PR descriptions — when a worker finishes, they open a PR. The PM agent reads PRs and runs validation.
```

**Replace with:**

```
3. PR descriptions — when a worker finishes, they open a PR. The PM agent reads PRs, runs validation, AND VERIFIES CI IS GREEN (gh pr checks <pr-number> --watch) before marking READY_FOR_REVIEW. CI green is non-negotiable.
```

### Change 3 — Add new section "Lessons learned"

Insert this section between "How agents communicate" and "The 9 agents":

```markdown
## Lessons from Paczka 1 (apply to all work)

These are codified in CONVENTIONS_PATCH.md. Highlights:

1. **Always verify CI green before READY_FOR_REVIEW.** PM-orchestrator MUST run
   `gh pr checks <pr-number> --watch` and wait for completion before marking any ticket ready. Local
   tests passing ≠ CI passing.

2. **Run prettier on every file you edit, every time.** Even if you ran prettier earlier in the
   session, re-run on every file you touch. CI format check is strict.

3. **Check repo-config dependencies BEFORE PR.** If your workflow needs Code Scanning, secrets, or
   branch protection rules, verify they exist or escalate via backlog/ESCALATIONS.md before opening
   the PR.

4. **Python packaging gotchas:**
   - `pyproject.toml` build-backend MUST be `setuptools.build_meta` (NOT
     `setuptools.backends.legacy` — that does not exist)
   - Every Python app needs `__init__.py` in src/ (even if empty)

5. **pnpm version is in `package.json`, not in CI.** Don't put `version:` in `pnpm/action-setup@v4`
   step.
```

### Change 4 — Update "The 9 agents" → "The 9 agents"

(The count stays 9 — we're not adding a new agent, just expanding scope of existing ones.)

The table doesn't need numerical updates, but the descriptions of these three should expand:

**backend-engineer description (current):**

> Builds Cloudflare Workers ingest service, the Next.js control plane (dashboard + API), Postgres
> schemas with RLS

**backend-engineer description (new):**

> Builds Cloudflare Workers ingest service, the Next.js control plane (dashboard + API including
> Magic Link onboarding wizard), Postgres schemas with RLS, and the Auto-Onboarding HTTP API layer

**ml-engineer description (current):**

> Owns the intent engine (NLP + behavioral signal fusion), embeddings strategy, archetype space,
> adaptation engine

**ml-engineer description (new):**

> Owns the intent engine, embeddings strategy, archetype space, adaptation engine, the auto-detect
> Vision pipeline (apps/auto-detect, Claude Sonnet 4.6 Vision), and the platform templates library
> (packages/platform-templates)

**data-engineer description (current):**

> Owns ClickHouse schemas, Redpanda Kafka topics and consumers, ETL jobs

**data-engineer description (new):**

> Owns ClickHouse schemas, Redpanda Kafka topics and consumers, ETL jobs, and the daily continuous
> schema validation cron (drift detection per tenant, per Master Design B.6)

### Change 5 — Update escalation rules

**Find this list:**

```
Agents MUST escalate to human (write to backlog/ESCALATIONS.md) when:
- A ticket's acceptance criteria are ambiguous → block ticket, ask
...
```

**Add these two new bullet points to the list:**

```
- A workflow they're adding requires repo configuration that doesn't exist (Code Scanning, Secrets, Branch protection) — escalate BEFORE opening PR, not after CI fails
- They notice the agent count or repository structure documented in CLAUDE.md is stale relative to current state (e.g., "we have 11 apps now but CLAUDE says 10")
```

**Find this list:**

```
The PM agent escalates to human when:
- Two workers disagree on an interface
- A ticket has been blocked >24h
...
```

**Add this new bullet point:**

```
- A worker has signaled "ready" but CI isn't green after 3 retry attempts — the worker is stuck on something they can't fix alone
```
