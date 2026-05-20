# Estalara Operating Principles

**Status:** Fundamental rules — applies to all sessions, all tasks, all roles (Piotr, Claude,
pm-orchestrator, subagents, AI Council) **Established:** 2026-05-20 **Owner:** Piotr Nawrocki (CEO,
Time2Show Inc.) **Version:** 1.1 **Last updated:** 2026-05-20

---

## Why these rules exist

These principles emerged from a specific failure pattern observed across multiple sessions:

- Decisions made on assumptions about repo state instead of verification
- Master_Design treated as reference document instead of single source of truth
- Important tickets implemented without AI Council review, leading to scope drift
- Quick reactions instead of deliberate thinking, leading to bug compounding
- Reliance on memory/Handoff documents which proved incomplete
- **Stale references in supporting documents (e.g. CLAUDE.md pointing to Master_Design v1.1 while
  repo had v1.9) silently misleading every new session that booted from them**

**Concrete example (2026-05-20):** A 6-hour session was spent building a standalone JavaScript POC
(`estalara-demo-v0.3.0` through `v0.3.4`) that duplicated functionality already shipped in
`packages/sdk/src/auto-detect/techniques/` (4,329 lines, 11 techniques + AI Vision + corpus CI gate
at 100/100 precision). The duplication happened because Master_Design v1.9 §Snapshot.1 was not
consulted before starting — and `CLAUDE.md` in repo root referenced "Master Design v1.1 update
(2026-04-26)" while the actual Master_Design was v1.9 from 2026-05-17, more than a month newer. The
session booted from a stale mental model and never recovered. The POC iteration produced 6 versions,
each fixing a bug the previous version introduced — ultimately solving problems that were already
solved in the repo.

The rules below are the corrective response to that failure mode.

---

## The Five Rules

### Rule 1 — Master_Design is the single source of truth

Master_Design is **not** a reference document. It is **the** authoritative description of project
state, architecture, and roadmap.

**Operational meaning:**

- Before any task, read the relevant Master_Design sections — specifically §Snapshot.1 for current
  implementation status
- Do NOT rely on memory (yours, Claude's, or any subagent's) for what is built, what is BLOCKED, or
  what is shipped
- Do NOT rely on Handoff documents alone — they capture session context, not full project state
- Do NOT rely on `CLAUDE.md` for version-specific Master_Design facts — `CLAUDE.md` is intentionally
  version-agnostic (see Rule 2)
- When Master_Design contradicts memory or Handoff, Master_Design wins
- When Master_Design contradicts repo reality (e.g. "10 techniques" while repo has 11), the rule
  below applies (Rule 5 + Rule 2)

**Why this matters:** Without a single source of truth, every session starts from a different mental
model. Decisions compound from different assumptions. The same bug gets fixed three times in three
sessions. The same feature gets built twice.

---

### Rule 2 — Master_Design and all referencing documents require continuous synchronization

Master_Design must reflect reality at all times. Updates are part of definition-of-done, not
optional. **Additionally, every document that references Master_Design state must stay in sync** —
stale references in supporting documents are a class of bug, not a documentation hygiene issue.

**Operational meaning:**

- After every important finding (architectural drift, new ticket, completed sprint, audit result):
  update Master_Design
- Update means: edit relevant sections + bump version + add changelog entry
- Updates happen **before** moving to the next task, not "later"
- A ticket is not DONE until Master_Design reflects its outcome
- Version bumps follow semver: minor changes = patch (v1.9.1), section additions = minor (v1.10),
  structural overhauls = major (v2.0)
- **After every Master_Design update, review the propagation checklist** (Master_Design §Y.2 —
  canonical) and update any document whose content references the changed sections
- **Version metadata lives in content, not filenames.** The file is `docs/MASTER_DESIGN.md` —
  always. Version is on line 3 in `**Wersja:** X.Y` format. Filenames containing version numbers
  (e.g. `MASTER_DESIGN_v1_4.md`) are historical snapshots, NOT references — never link to them from
  active documents.
- **`CLAUDE.md` and other referencing documents do NOT contain Master_Design version numbers.** They
  link to the file, never to a specific version. This eliminates the entire class of "stale version
  reference" bugs at the structural level.

**Why this matters:** A document that is 90% accurate is worse than no document at all — because the
10% drift teaches readers to distrust it. A supporting document (`CLAUDE.md`) that points to a stale
version of Master_Design is worse than no supporting document — because it silently misleads every
session that boots from it. Continuous updates plus structural version-agnosticism in supporting
documents keeps trust at 100%.

---

### Rule 3 — AI Council review before important tickets

Important tickets get reviewed by AI Council before implementation begins.

**Operational meaning:**

- "Important ticket" means: anything affecting architecture, anything spending credits/resources,
  anything Piotr would call "decision point" rather than "execution"
- Council review happens with current Master_Design and current repo state — both must be fresh
- After Council: summarize findings → set next steps → update Master_Design with Council decisions
- Council guardrails (e.g. APPROVED_TO_IMPLEMENT, scope limits, blocking questions) become
  Master_Design constraints
- If Claude is uncertain about ticket scope, technical feasibility, or strategic fit — request
  Council review instead of guessing

**Why this matters:** Single-perspective decisions on architectural matters compound risk. Council
provides multiple-model adversarial review that catches blind spots one model alone misses.

---

### Rule 4 — Reflexive thinking — minimum 2x before decisions

Every decision is thought through at least twice before committed.

**Operational meaning:**

- First pass: what is my initial response/plan?
- Second pass: what am I assuming that I haven't verified? What could be wrong about the first pass?
- For decisions affecting architecture, scope, or resource allocation: explicit reflexive check in
  the response itself
- When second pass surfaces meaningful uncertainty: pause, verify (Rule 5), or request Council
  (Rule 3)
- Reflexive thinking is documented in the response, not just internal — Piotr should see the
  reasoning trace
- Speed is not a virtue when correctness matters

**Why this matters:** The first answer is usually pattern-matched to similar past situations. The
second pass catches where pattern-match failed. Most production bugs are first-pass decisions that
nobody questioned.

---

### Rule 5 — Never guess, never assume — verify

Facts are verified through repo reads, audit commands, or Master_Design consultation. Assumptions
without verification are treated as unknown.

**Operational meaning:**

- Before claiming "X exists" or "X is BLOCKED" or "X is shipped": verify by reading the repo
- Before referencing past project state: read Master_Design §Snapshot.1 or run an audit command
- When verification is impossible in the current session: explicitly state "I do not know — needs
  verification" rather than asserting
- When tools (web_search, repo_search, file_view, GitHub MCP, bash) are available and relevant:
  **use them, and verify they exist before asking the user to do something they could do
  themselves**
- "I think" or "probably" or "should be" are red flags — they mean a verification step was skipped

**Sub-rule (added 2026-05-20):** Before assuming you lack access to a tool, check your tool
inventory. In the session that motivated these rules, Claude (web) had a GitHub MCP connector
available and didn't check it through 4 audit rounds, instead asking Piotr to paste files via `cat`.
Tool inventory at the start of every non-trivial session.

**Why this matters:** Verified facts compound into reliable systems. Assumptions compound into bugs.
The cost of verification is always less than the cost of the bug it prevents.

---

## Operational checklist

Before starting any non-trivial task:

- [ ] Have I read the relevant Master_Design §Snapshot.1 sections?
- [ ] Is Master_Design current as of the latest commit / sprint outcome?
- [ ] Does this task qualify as "important" — should it go through AI Council first?
- [ ] What am I assuming? Have I verified those assumptions?
- [ ] Have I thought through the approach at least twice?
- [ ] Have I checked my available tools before asking the user for input I could fetch myself?

If any answer is "no" — pause and resolve before proceeding.

---

## When these rules apply

These rules apply to:

- **All Claude sessions** with Piotr (this conversational interface)
- **All Claude Code sessions** (terminal coding sessions with subagents)
- **All pm-orchestrator decisions** before enqueuing tickets in QUEUE.md
- **All subagent work** (sdk-engineer, ml-engineer, backend-engineer, data-engineer,
  devops-engineer, qa-engineer, compliance-engineer, retrospective-analyst)
- **All Council reviews** (the rules apply to interpreting Council output, not to Council itself)

These rules do **not** apply to:

- Conversational small-talk (greetings, status questions, "co teraz robimy")
- Pure information retrieval (what does Master_Design say about X?)
- Trivial tasks (formatting, typo fixes, copy adjustments) — though Rule 5 still applies if facts
  are stated

When in doubt about applicability, default to **applying the rules** rather than skipping them.

---

## Failure modes these rules prevent

| Anti-pattern                               | What it looks like                                                              | Which rule prevents it |
| ------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------- |
| Duplicate work                             | Building something that already exists in repo                                  | Rule 1, Rule 5         |
| Scope drift                                | Sprint expanding mid-implementation beyond approved scope                       | Rule 3                 |
| Brittle fixes                              | Bug fix introduces new bug, which gets fixed introducing third bug              | Rule 4                 |
| Stale documentation (Master_Design itself) | Master_Design references state from 3 sprints ago                               | Rule 2                 |
| Stale supporting documents                 | `CLAUDE.md` references Master_Design v1.1 while MD is at v1.9                   | Rule 2 (extended)      |
| Confident hallucination                    | Claude states something as fact that turns out to be wrong                      | Rule 5                 |
| Architectural surprise                     | Major design choice made in implementation without prior review                 | Rule 3                 |
| Memory drift                               | Different sessions operate from different mental models of project              | Rule 1, Rule 2         |
| Tool blindness                             | Claude asks user for file content while having `gh` / MCP / file_view available | Rule 5 sub-rule        |

---

## Enforcement

These rules are enforced through:

1. **Self-enforcement** — Claude applies the rules to its own responses and outputs, including
   explicit reflexive checks visible in responses
2. **Piotr's review** — Piotr can invoke any rule when noticing it being violated ("did you check
   Master_Design first?")
3. **AI Council review** — Council prompts can reference these rules when evaluating proposals
4. **Master_Design integration** — these rules are referenced in Master_Design §Snapshot.1
   introduction and codified in Master_Design §Y "Document Governance Policy", making them part of
   the single source of truth itself
5. **Structural enforcement** — version-agnostic referencing in `CLAUDE.md` (Rule 2) makes the
   "stale version" class of bug structurally impossible, not just policy-prevented

There are no penalties for invoking a rule. There are no rewards for skipping one. The rules exist
to protect project quality, not to score performance.

---

## Evolution of these rules

These rules are **not** frozen. They can be updated when:

- A new failure mode emerges that the current rules don't address
- Operational experience suggests a rule is too restrictive or too loose
- AI Council recommends modification
- Piotr decides on adjustment

**Update process:**

1. Propose change in conversation
2. AI Council review of proposed change (Rule 3 applies recursively)
3. Update this document
4. Bump version + add changelog entry
5. Update Master_Design reference (Rule 2 — propagation checklist applies)

---

## Appendix A — Operational examples

**Example 1 — Starting a non-trivial task (Rule 1 + Rule 5)**

❌ Wrong: "Let me build a POC for AI Vision auto-detection. I'll start coding."

✅ Right: "Before I start, I'll read Master_Design §Snapshot.1 to verify what's already shipped.
[reads]. §B.5 shows the Auto-Detection Engine is Mostly Shipped — 11 techniques on main, AI Vision
wired. The block is `ANTHROPIC_API_KEY` empty in Doppler, not missing code. I should not duplicate.
Recommended next step: activate the key (10 min) instead of building a POC (6 hours)."

**Example 2 — Architectural decision (Rule 3 + Rule 4)**

❌ Wrong: "We should switch from Cloudflare Workers to Vercel Edge Functions. I'll start the
migration."

✅ Right: "This is a stack-level decision affecting cost, latency, and vendor risk — Rule 3 applies.
First pass: Vercel Edge looks simpler. Second pass: what am I assuming? I'm assuming latency is
comparable (unverified), I'm assuming cost is comparable (unverified), I'm assuming team has Vercel
expertise (true), I'm assuming this is reversible (false — it's not). Recommendation: AI Council
review before any code change."

**Example 3 — Information request (Rule 5 sub-rule)**

❌ Wrong (session 2026-05-20): "Piotr, can you paste the content of `CLAUDE.md` so I can review it?"

✅ Right: "Let me check my tool inventory first. I have GitHub MCP connector — let me try
`gh api /repos/Pnawrocki9/Adaptive-Listings/contents/CLAUDE.md`. [tries]. Returns 404 — repo is
private and MCP doesn't have access. Now I can ask Piotr to paste it, with reasoning visible."

**Example 4 — Updating Master_Design (Rule 2 propagation)**

❌ Wrong: "I updated §B.5 in Master_Design to reflect the 11 auto-detect techniques. Done."

✅ Right: "I updated §B.5 in Master*Design (now v2.0). Per Rule 2, I now run the propagation
checklist (Master_Design §Y.2): (1) `CLAUDE.md` — does it reference §B.5 by name? [checks] no, only
general reference, no update needed. (2) `docs/AGENT_WORKFLOW.md` — does process depend on §B.5
structure? [checks] no. (3)
`.claude/agents/*.md`— do subagent prompts reference §B.5? [checks] no. (4)`backlog/QUEUE.md`— does this change sprint counts? [checks] no. (5)`AUDIT\*\*.md`— does any audit cite §B.5 verdict that changed? [checks] yes,`AUDIT_REPORT_INVESTOR_READINESS.md`
cites old verdict — update needed. Patch the audit, then commit both changes together."

---

## Appendix B — Document propagation checklist

When Master_Design is updated (any version bump), review the following documents for required
synchronization. **The canonical, authoritative list lives in `docs/MASTER_DESIGN.md` §Y.2 (Document
Governance Policy → Update propagation).** This appendix is a pointer, not a duplicate — per Rule 1,
Master_Design is the single source of truth, including for its own governance metadata.

To run the propagation check:

```bash
# 1. Open Master_Design §Y.2 to see current canonical list
grep -n "Y\.2" docs/MASTER_DESIGN.md | head -5

# 2. For each item in §Y.2, audit whether the referenced document needs an update
# 3. Update documents whose content references the changed Master_Design sections
# 4. Commit propagation updates in the same PR as the Master_Design update (or as immediate follow-up)
```

**Why this appendix points instead of duplicates:** Rule 1 says Master_Design is the single source
of truth. If both this document and Master_Design listed the propagation checklist, they would drift
over time, creating exactly the "stale supporting document" failure mode Rule 2 prevents. The
structural fix is to have one canonical list — in Master_Design — and have everything else link to
it.

---

## Changelog

### v1.1 (2026-05-20) — Document governance hardening

- **Extended Rule 2** to include synchronization of all referencing documents (not just
  Master_Design itself). Codifies the lesson that stale supporting documents (e.g. `CLAUDE.md`
  pointing to Master_Design v1.1 while MD was v1.9) are as harmful as stale Master_Design.
- **Added structural rule:** Version metadata in content (line 3 `**Wersja:** X.Y`), not filenames.
  Supporting documents link to the file, never to a specific version. Eliminates the "stale version
  reference" class of bug at the structural level (Rule 2).
- **Added Rule 5 sub-rule** on tool inventory at session start. Lesson from 2026-05-20: Claude (web)
  had a GitHub MCP connector available and didn't check it through 4 audit rounds.
- **Added Appendix A** with operational examples illustrating each rule.
- **Added Appendix B** pointing to Master_Design §Y.2 (canonical propagation checklist). Does not
  duplicate the checklist — pointing maintains single-source-of-truth (Rule 1).
- **Updated "Failure modes" table** with two new anti-patterns: stale supporting documents, tool
  blindness.
- **Insight from Piotr (2026-05-20):** "Plik nazywa się MASTER_DESIGN.md, wersja jest w treści.
  CLAUDE.md powinien linkować do pliku, nie wersji." This insight became the structural rule in
  Rule 2.

### v1.0 (2026-05-20) — Initial version

- Established 5 fundamental rules
- Documented motivating failure (POC v0.3.x duplicate of existing SDK auto-detect)
- Defined operational checklist and enforcement mechanism

---

## References

- **Master_Design** — `docs/MASTER_DESIGN.md` (in repo) — single source of truth for project
  architecture and state. Version + date in first lines; read §Snapshot.1 before any non-trivial
  task.
- **Master_Design §Y** — "Document Governance Policy" — codifies how this document and Master_Design
  stay in sync; canonical propagation checklist lives there.
- **AI Council** — `~/ai-council/` (separate Python repo, `CLAUDE_MODEL=claude-opus-4-7`) —
  multi-model adversarial review for important tickets.
- **Handoff documents** — `backlog/HANDOFFS.md` and `HANDOFF_*.md` — session-to-session context
  bridge. Supplements Master_Design, does not replace it.

---

## Acknowledgement

These rules were established after the 2026-05-20 POC v0.3.x failure mode. The principle they embody
is simple:

> **Reality is the truth. Documents and memory approximate reality. When approximation diverges from
> reality, reality wins. Update the approximation — and update everything that points to the
> approximation.**

— Piotr Nawrocki, Estalara Operating Principles v1.1, 2026-05-20
