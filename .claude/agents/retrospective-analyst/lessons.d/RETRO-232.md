# RETRO-232 — FOLLOW-723 (#640) — 2026-07-29

- **A finding I almost missed and why.** I almost accepted the PR's inline audit at face value. It
  was conscientious, its counts were all correct (I re-ran both `grep -c` and got 1 and 1), and it
  used the right vocabulary ("SAFE TODAY, NOT STRUCTURALLY"). **A well-written wrong verdict is the
  hardest thing in a diff to catch, because it presents as the work already having been done.** What
  saved it was refusing to grade the audit on its counts and instead re-deriving each verdict from
  the region the consumer reads. Two of five verdicts collapsed: (1) "no narrower region exists to
  scope to" for `libSrc` — false, `extractRendererTemplate` returns the template literal, a strictly
  narrower region the gate itself computes; (2) "a second literal match across GET/POST" — the real
  trigger is a match anywhere earlier in the file, which includes the module-level region RETRO-230
  already proved the gate blind to. Both fell in under 10 minutes of sandbox once I stopped reading
  the comment and started reading the extractor. **New personal rule: when an AC says "audit X and
  record the verdict", the deliverable I must grade is the verdict's REASONING, not its existence —
  and the fastest way to grade it is to try to falsify it in a sandbox.**
- **An axis/chain I had to trace twice.** Three, all productive. (1) The `libSrc` justification: on
  first read "the extractor is itself whole-file-first-match" sounded correct and I moved on. On
  second read I noticed it conflates **what the extractor searches** with **what the extractor
  returns** — and that the same conflation is the root of the normalization hop I then filed as LG-3
  (`runCheck` compares `normalizeDocBlock(block)`, not `block`). One sentence, two findings, one
  root: _extracted ≠ compared._ (2) The FOLLOW-717 interaction: I first copied the PR's framing ("if
  717 narrows the region") into my draft, then read FOLLOW-717's actual stub and found it
  **broadens** — which flips the consequence from "717 triggers this" to "717 **masks** this",
  materially changing the sequencing advice. I had inherited a prior artifact's framing instead of
  re-deriving it, which is the exact failure I criticise elsewhere in this retro. (3) FOLLOW-725's
  premise ("FOLLOW-723 will diverge the copies"): I nearly wrote "confirmed, now diverged". md5 of
  the AST slices says **still byte-identical** — the PR added new helpers rather than editing the
  shared triplet. The ticket is still right, its stated reason is now wrong, and only the md5 caught
  it. **Predicted consequences in prior tickets must be re-measured, not re-asserted.**
- **A meta-pattern in how gaps recur across agents.** The consent-gate chain has now displaced five
  times (prose → tuple gate → fixture anchor → fixture-anchor region (doc) → fixture-anchor region
  (renderer + route)), and this hop revealed the mechanism cleanly: **each remediation fixes the
  INSTANCE it was shown and then writes a comment certifying the neighbours, because certifying is
  cheap and fixing is not.** The comment is where the next gap lives. Corollary for my own process,
  now proven twice in one retro: **in any remediation PR, the highest-yield place to look is the
  code the PR did NOT change but DID annotate.** Unchanged-but-newly-commented is the least reviewed
  artifact a PR can ship — reviewers read diffs for changed logic, and a comment reads as
  documentation, not as an untested assertion. Second meta-note: this is the third consecutive retro
  where the finding came from _leaving the ticket's own scenario_ (RETRO-230 §4a DG-1, RETRO-231 §4a
  LG-1, both LG-1/LG-2 here). That is no longer an observation; I have promoted it into Rule AL
  clause 5 and Rule AM clause 3 so it stops depending on a retro noticing.
- **On my own promotion discipline.** I promoted TWO rules in one retro (AL, AM), which I was wary
  of as rule-inflation. I checked the arithmetic separately for each against the ≥2-PRIOR bar
  (RETRO-230 + RETRO-231 for both), re-derived it rather than inheriting RETRO-231's
  pre-authorisations, and verified the two are genuinely disjoint (AL = the region an assertion is
  evaluated over, applies to prose greps too; AM = where a fixture comes from, applies only to
  self-testing gates). The tie-breaker for promoting rather than holding:
  `CONVENTIONS_PATCH.md:2605` already points future gate authors at these exact two scripts as "the
  reference shape", so leaving the invariants in tickets guarantees the next gate inherits the
  defect. **Rules are for the code that does not exist yet; tickets are for the code that does.**
