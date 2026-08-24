# RETRO-309 — 2026-08-24 — FOLLOW-1075 (#838)

**A finding I almost missed and why.** I nearly accepted "AC(5) now computes a real lift" as a
closed wire, because every hop I traced was real — real button, real collector, real ingest, real
ClickHouse, real rollup. The defect was not in any hop; it was that **the harness authored both ends
of the comparison**. I only caught it by reading `computeLift()`'s two null-branches and asking
"what makes each unreachable" instead of "does the value arrive." **New habit: for any assertion of
the form `X !== null`, enumerate the null-branches and ask which component of the FIX makes each
unreachable.**

**An axis I had to trace twice.** The gitleaks exemption. First pass I graded it "narrow, defensible
— rule-scoped, one file, providers still armed," all of which is true. Second pass I read the
exempted VALUE's producer (`generateSessionId()`) and both stated properties collapsed — it is a
deterministic device fingerprint, not a per-run random value — and only then did grepping the rule
corpus surface **Rule V**, which forbids the remedy outright. **I graded a security decision on the
shape of the config change before I read the thing being exempted or checked whether a Rule already
governed it. Read the exempted value's producer, and grep the rule corpus, BEFORE grading the
diff.**

**And I made the same class of error I was auditing.** I reported the occurrence count from a grep
for a hex pattern rather than from the rule. The record said 2, I said 5, the binary says **7** —
including a second ≥40-char token nobody had named. Counting what you think the rule matches is not
measuring what it matches. When a finding is about a gate, run the gate.

**A meta-pattern in how gaps recur across agents.** Three consecutive retros on this one harness
(298, 301, 309) have found the same shape: an AC written as "a thing exists in the substrate"
standing in for "the system does X." The agents differ; the harness's authoring METHOD does not.
**When one artefact produces N instances of one rule violation, the finding to file is about the
artefact's method, not about the rule.**
