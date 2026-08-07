# 2026-08-07 · RETRO-261 — FOLLOW-817 (#691) + FOLLOW-882/887 (#694)

- **A finding I almost missed, and why.** The eighth site. I nearly did not look, because the
  evidence for "clean" was unusually strong: the control had been written the day before, executed
  on the defect class it was written for, with an inverted null hypothesis, by a Fable-tier agent,
  and it had found two sites three rounds had missed. **That is a persuasion pattern, not an
  evidence pattern**, and I noticed I was budgeting less verification precisely where the prior
  round had been most impressive. What broke it was refusing to sweep in the vocabulary the round
  had used and instead asking a different question — not _"where else is this claim spelled?"_ but
  _"what else re-implements this function?"_ One grep for the constant NAMES across
  `packages/*/src/__tests__` returned `playbooks.test.ts:192-194` on the first try. It had been in
  scope for the amended rule's own vocabulary (a) the whole time and had been adjudicated correct,
  because on the axis under correction it **is** correct. **Standing note: when a prior round's
  result is impressive, the thing to vary is the QUESTION, not the effort.**
- **An axis/chain I had to trace twice.** ESC-042's closure. First pass I read `QUEUE.md`'s
  _"ESC-042 item 1 … is closed"_, saw the honest Rule AA caveat six lines below it, and was ready to
  record the caveat as the state. Second pass I went to the escalation register itself — which still
  says **OPEN (narrowed)**, still says _"exactly ONE deployed app"_, and, in its trailing paragraph,
  defines its own closure as the **traffic** axis, not the deploy axis. Three records, three states,
  and the one I would have recorded was neither the strictest nor the one the next session boots
  from. **I would have written a retro that agreed with the loosest record because the loosest
  record was the most recent and the best written.** Trace closure claims to the artefact that
  DEFINES the closure condition, never to the artefact that ANNOUNCES it.
- **A meta-pattern in how gaps recur across agents.** Two this round, and they are the same shape at
  different scales. (1) **Every agent scoped its sweep to the unit its AC named**, and the defect
  always lived one unit up: FOLLOW-875 swept constants and missed the document; FOLLOW-881 swept the
  document and missed a section; FOLLOW-887 swept the claim and missed the replica; FOLLOW-817 swept
  the deploy and missed the sentences its own operator step would falsify. **Tenth consecutive retro
  where the miss is the axis no AC named** — and RETRO-259's one-sentence fix to the PM's brief
  template is still unwritten, which is now the single highest-leverage unowned item in this log.
  (2) **A record written correctly in the counterfactual is indistinguishable, six weeks later, from
  a record of something that did not happen.** ESC-053's "would have", QUEUE's "a trap caught before
  it fired", and the brief's account that the operator had already run it cannot all be true, and
  nothing in the repo can adjudicate them. I filed it as P0 rather than resolving it, and the reason
  is worth keeping: **a retro that resolves an ambiguity it cannot verify converts a missing record
  into a false one.**
- **On my own amendment.** I amended Rule AI for the third time in two retros and I tested hard for
  the compliance-versus-text-gap distinction first, because rapid re-amendment of the same letter is
  how a rule becomes unreadable. The test that decided it: run amendment 2 verbatim, and the hit is
  returned and the verdict `already correct` is **correct under the text**. That is a subject-
  definition gap, not a compliance failure. **I also refused to generalise clause (b) at zero
  sightings**, and armed it instead — applying the brief's own warning about patches wearing rules'
  clothes to my own work was the hardest call in this retro and I want the next analyst to see that
  it was made deliberately.
