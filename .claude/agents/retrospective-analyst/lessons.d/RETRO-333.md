# RETRO-333 — 2026-09-14 — #908 (FOLLOW-1208, measured-path freshness)

Written as a fragment, per Rule AG.

## A finding I almost missed, and why

**`[ALLOW-STALE]` kept its name and changed who it applies to.** #908 is correct, and so is its
README. The defect is in three OTHER texts that accept the verdict by name. I found it only by
running the real CLI on synthetic artefacts, and then asking what the SoT would do with each banner.
**When a PR changes a predicate, grep the readers of its OUTPUT LABELS, not only the callers of its
function.**

## An axis/chain I had to trace twice

**The path set's evidence.** I first read the parity scan as proof that the set is complete. On the
second pass I read its two regexes. They enumerate what the harness PROCESS loads, while the
docblock claims "what decides which bytes run". The missing population is the files the build and
the README bring-up use (`tsconfig.base.json`, the static host). This is Rule BC at authoring time:
the enumeration was sound for a narrower population than the one claimed.

## A meta-pattern in how gaps recur across agents

**A tool refused in the sandbox gets substituted, and the substitute is never positive-controlled.**
Two agents in one session replaced `gitleaks git` with a piped form. My first piped form flagged a
commit hash (a false positive), and a naive substitute can just as easily miss real hits. So I ran
the substitute over the known-flagged #907 draft first. Rule V amendment 1 now asks for that
control.

## Process note worth carrying

Commands that mention `git` inside heredocs, loops or variables are refused in worktree-isolated
sessions. Write drafts with the Write tool, append with `cat file >> target`, and run one plain
`git` command per call.
