# 2026-08-05 / RETRO-246 (FOLLOW-813, PR #675)

_Per-ticket fragment, per Rule AG — never appended to the shared `lessons.md` tail. Intended path:
`.claude/agents/retrospective-analyst/lessons.d/RETRO-246.md`. **The retro agent was
permission-blocked from writing under `.claude/` and could not land it — this is itself an instance
of RETRO-246 §6 pattern P-30, and per that pattern's own lesson the file and its full text are named
here so a human/PM can land it in one copy.**_

**A finding I almost missed, and why.** I nearly filed this retro with §3 "Wiring Audit — clean ✅".
The PR touches no code, adds no event, no env var, no column — so both wiring checks look
inapplicable, and my template invites a clean verdict in exactly that situation. What saved it was
re-asking CHECK B in the PR's own currency: the "producer" here is a mandated instruction and the
"consumers" are the nine agent definitions that must obey it. That reframing immediately produced
two findings (4/9 consumer coverage; a surviving retired producer in `docs/CONVENTIONS_PATCH.md`
that the PM's own residual grep missed). **Lesson: when a PR's artefact is a procedure rather than a
symbol, CHECK A/B must be re-expressed in that PR's currency before "N/A" is allowed.** A docs-only
PR is where the wiring audit is most likely to be skipped and least likely to be redundant — nothing
in `ci.yml` was ever going to see any of this.

**The bigger near-miss: I almost accepted the PR's own alignment claim.** The script header at
`:49-50` says it "mirrors the shape FOLLOW-821 uses … does not contradict it". It reads as diligence
— the author _knew_ about 821 and _addressed_ it. I only caught the inversion because I opened
FOLLOW-821's stub to write the §5a cascade line, and its AC(1) forbids a count comparison in one
sentence. **A PR that names the ticket it might conflict with, and asserts it does not, is a
stronger signal to go read that ticket than a PR that says nothing.** Confident cross-ticket claims
are unverified by construction — nobody reviews the ticket you cite.

**An axis/chain I had to trace twice.** The rule adjudication. My first pass followed the PM's
closure note (`QUEUE.md` session 101: "Rule AH … Rule S … second sighting of each"), which would
have promoted against Rule AH. Reading AH's actual text stopped it: AH binds a doc author whose doc
is false at its own merge commit (doc AHEAD of code) — here the code was right and the docs LAGGED,
which is Rule AI, whose own text carries a "deliberately NOT counted" clause built to prevent this
exact double-count. And the sandbox event is not Rule S at all. **Lesson: a handoff that pre-names
the rule is an input to verify, never a conclusion to inherit** — the PM was reasoning from rule
_titles_, and the titles of AH and AI are nearly interchangeable if you don't read the Pattern
paragraph. Second trace: I had to re-derive whether an _amendment_ to an already-promoted rule is
subject to the ≥2-PRIOR gate. It is not — the precedent is the Rule S amendment at RETRO-112 — but
the honest test I settled on is narrower and worth reusing: **amend only when running the existing
rule's own Verification block verbatim against this PR would report clean.** Here it would have (its
greps cover `docs/`, `HANDOFFS.md`, `CONVENTIONS_PATCH.md`; `.claude/` appears in none). That is a
hole in a control, not a new pattern, and it kept me from minting a 44th letter for something Rule
AI already owns.

**A meta-pattern in how gaps recur across agents.** Three of the last several retros now show the
same shape from different directions: **the corpus the agents EXECUTE drifts from the corpus humans
READ, and only the human corpus gets maintained.** RETRO-160 (a wrong `lessons.md` entry actively
trusted by the next ticket, its corrective permission-blocked), RETRO-245 (the retro loop has no
self-closure check — FOLLOW-806), and now RETRO-246 (prose updated, agent definitions not). The
common cause is not carelessness; it is that `.claude/` is outside every gate, outside every rule's
verification grep, and — for subagents — outside the write permission of the one agent positioned to
notice. This very fragment could not be written for that reason. The one genuinely good delta this
merge shows: the FOLLOW-513 worker's permission-blocked correction cost a whole extra P1 ticket
(FOLLOW-516), whereas here the PM landed the blocked edit inside the same PR. That behaviour is the
actual remedy and I recorded it in P-30 so the eventual rule codifies the fix, not just the hazard.

**Note to my future self on under-counting.** I found the mode-bit class twice in one sweep (the
PR's own `100644`, plus `check-rule-i.sh` against four bare-invocation mandates in `HANDOFFS.md`)
and still held P-31 at count 1, because both live in this retro. That is the correct adjudication
under this repo's own precedent — but the second instance is a real, currently-broken worker
instruction, so I filed it as FOLLOW-831 rather than leaving it as evidence. **Holding a pattern
below threshold must never mean leaving its instances unfixed.**
