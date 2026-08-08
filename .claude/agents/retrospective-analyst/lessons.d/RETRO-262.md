# RETRO-262 — FOLLOW-900 (PR #698) — 2026-08-08

## A finding I almost missed, and why

**The window arithmetic.** The brief asked me to work out whether a 24h/03:00 detector would also
have caught this, and my first instinct was to do exactly that comparison — which would have been a
correct answer to the wrong question. Both windows alarm in steady state (`H > W − 22`). The reason
this catch happened is that `cron_heartbeats` held **zero rows**, so the detector took its
never-recorded branch, which no window touches. **I almost validated a header's self-description
instead of the behaviour.** Generalisation for next time: when a control's own comment says a
parameter is "load-bearing", check which BRANCH of the control fired before crediting the parameter.
A control's account of why it works is itself a claim, and it can be wrong in the harmless
direction.

## An axis / chain I had to trace twice

**The guard's blind spots.** First pass I read `check-modal-local-imports.py` end to end — it is
unusually well written, its docstring discloses its own limits, and I nearly recorded "one disclosed
residual, honest". Second pass I imported it and ran it against synthetic trees, and found three
more shapes, one of which (a bare sibling import from a nested entrypoint) re-creates FOLLOW-900 in
the same file the gate was written for, with the gate returning exit 0. **A thorough docstring is a
strong signal of care and zero evidence of coverage.** The probe cost about eight minutes. Standing
rule for myself: when a merge ships a mechanical guard, do not review it — EXECUTE it against inputs
its author did not choose. Rule AE says this about the guard's author; it applies to me too.

Second trace: `_declared_local_sources` root-wide harvest looked like a synthetic-only concern until
I checked which file actually carries `llm-gateway`'s declaration. It is in `jobs/_app.py`, not the
entrypoint — **the "hypothetical" shape is already load-bearing in production.** I would have graded
it P2 on the first read and it is P1.

## A meta-pattern in how gaps recur across agents

**Negatives travel further than positives, and no agent role is immune.** This session: the PM
asserted an absence about intent-engine's imports (wrong, safe direction); FOLLOW-901's premise
understated a failure count by 16×; and the PR's own residual-gaps disclosure asserted a complete
list of blind spots (one, actual: four). Three roles — PM, PM, worker — same shape. What saved the
first was a sentence in a dispatch brief (`re-verify, do not inherit`), i.e. a human instruction
doing a control's job, which is exactly the condition Rule AG was promoted under. Promoted as **Rule
AR**, scoped to decision-gating negatives only.

**And the second-order version, which is about me.** RETRO-261 and RETRO-262 are back-to-back retros
where a control was written, executed and validated within hours, and in BOTH I found the validation
narrower than the celebration. That is now a pattern in this estate — good at building controls
fast, weak at bounding what they cover — and it is also a pattern in what retros are FOR. If
RETRO-263 studies a third fast-built control, the question to ask first is not "does it work" but
"what is the shape adjacent to the one it was built for", because that is where both answers have
been.

## Blind spot of my own, recorded

I initially reached for a Rule AF amendment on the unwatched-scheduled-workflow finding and had the
evidence lined up before I thought to **run Rule AF's own Verification block**. It surfaced
`e2e-smoke.yml` immediately. I would have amended an adequate rule and made it longer without making
it more effective. **Before proposing any rule amendment: execute the existing rule's Verification
block verbatim and paste the output.** If it produces the finding, the failure is compliance and the
remedy is mechanisation, not text. Same test applied to Rule AA on the "deployed" vocabulary
question and it also came back adequate — the fault was in a document's schema, not a rule.
