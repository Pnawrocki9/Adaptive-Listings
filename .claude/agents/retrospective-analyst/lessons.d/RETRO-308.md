# RETRO-308 — 2026-08-24 — FOLLOW-1081 (#840)

**Date / RETRO:** 2026-08-24 — RETRO-308 (#840, FOLLOW-1081)

- **A finding I almost missed, and why.** I nearly accepted "the estate never deletes branches" as a
  neutral fact. It is the whole finding: the detector's join key is a ref NAME, and 234 never-pruned
  remote refs turn its silence into a guarantee rather than a verdict. I only caught it because I
  ran `git config --get fetch.prune` after noticing `git branch -r | wc -l` was three digits — i.e.
  a property of the _environment_, not of the diff, decided whether the diff worked. **Standing
  instruction to myself: for any detector, ask what happens to its join key over time, and measure
  the population of that key in the real repo before judging the predicate.**
- **An axis/chain I had to trace twice.** The founding incident. First pass I read RETRO-303/QUEUE's
  "worktree gone, zero commits" and moved on; second pass I read `HANDOFFS.md:5767-5791` and found
  (a) the record contradicts itself — the handoff says the worktree _sits at_ `e24788a9` — and (b)
  the brief instructs `git checkout -b qa-engineer/FOLLOW-819-execute-harness`, a name the
  _successful_ re-dispatch later took, which is what proves the new control would have gone silent
  on its own founding case. The second read changed the verdict from "sound control, weak
  compliance" to "the predicate is wrong". **Never judge a control against a paraphrase of the
  incident; read the incident's own artefact.**
- **A meta-pattern in how gaps recur across agents.** Three retros running (298, 304, 308): a
  newly-authored control violates a rule this estate had already written for controls, because
  nothing re-reads a new control against `CONVENTIONS_PATCH.md`. The rule register grew to 51 rules
  and became a thing agents are told to _carry into_ delegation prompts rather than _check output
  against_. That is the promotion recommended in §6 — and it is the first time I have promoted a
  rule about the rule register itself.
- **My own blind spot this run, and it was a defect in my output, not a judgement call.** I first
  classified HW-1 P0 by the CHECK B rule and filed its remediation P1, then surfaced the gap for the
  PM. That is not "surfacing a tension" — it is shipping a register that says two numbers for one
  finding, and the next session would have read the stub (P1) and the P0 would have been carried by
  nobody. The PM caught it. **The judgement was right and the bookkeeping was wrong**: the fix was
  not to change my mind but to state the deviation _inside_ the finding, so §3, §7 and the stub all
  read P1 and the departure from the default is auditable. **Standing instruction: a classification
  default I decline MUST be argued at the finding and reflected in every number I emit — never left
  as a discrepancy for a reader to reconcile. A retro that emits two priorities for one gap has
  filed neither.**
