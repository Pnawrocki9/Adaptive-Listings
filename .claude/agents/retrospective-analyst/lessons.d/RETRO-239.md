# RETRO-239 — 2026-08-02 — FOLLOW-760 (#650) + FOLLOW-746 (#651), combined

**Note on provenance:** this fragment was written by the PM orchestrator on the analyst's behalf.
The dispatch brief scoped this session's write access to `backlog/RETROSPECTIVES.md`,
`backlog/FOLLOW_UPS.md`, and `CONVENTIONS_PATCH.md` only, so the attempted write to this file
(`lessons.d/RETRO-239.md`) was denied by the permission system mid-session. The substance below is
transcribed from RETRO-239 §6 rather than independently authored — treat it as a faithful summary,
not a first-person account of the write attempt itself.

**The finding worth carrying forward: a prevention written into a stub can substitute for a rule
promotion, and that substitution is itself worth recording as a process result.** RETRO-238 declined
to promote the Rule J / K.1 duplicate pattern on a _prediction_ — that FOLLOW-746 would copy
`_clean_python_source()` into a second gate — and instead wrote the prevention directly into
FOLLOW-764 item 8, reasoning explicitly that "the third sighting does not have to happen for the
lesson to be applied." PR #651 took the recommended option (shared `scripts/lib/`, not a copy) and
recorded the rejected option with its reasoning. The predicted third copy never existed. That is a
genuine negative result, not an absence of evidence: the ≥2-prior-retro threshold for codification
costs the repo the _codification_, not the _fix_, when the retro that would have supplied the third
sighting instead writes the prevention forward. Held at count 2, correctly — but worth remembering
the mechanism worked once, verifiably, and looking for it again rather than only counting sightings
of the failure.

**The meta-pattern to watch, pre-specified so the next retro can test it rather than re-derive it:**
three consecutive retros (RETRO-237 on #646/#647, RETRO-238 on #648, this one on #650/#651) have
reached the same verdict — a gate-hardening PR's own residual enumeration is one shape short, and
the fix in each case was itself correct. Two consecutive identical verdicts on "Rule AE is fine, its
_application_ isn't" is the signal I flagged forward rather than acted on: if a fourth consecutive
retro reaches it again, the right response is not a fifth AE sighting but a _mechanical_ residual
register — a machine-checkable per-gate list, which would be a promotable rule with a real mechanism
rather than a repeated prose verdict. Recorded here so the next retro tests the pre-specified bar
instead of re-deriving whether one is needed.

**A discipline that paid off directly, worth repeating deliberately:** pre-specifying the
second/third-sighting bar for a candidate pattern (P-21, P-22, P-23 in §6) BEFORE evaluating whether
the current pair meets it. P-21 and P-22 both superficially looked like clean advances this retro —
same channel-unprovisioned shape, same clearance-predicate-in-raw-text shape — and both were held at
count 2 only because the bar was already written down and had teeth (same-artefact-hop exclusion for
P-21; different-subsystem-and-introduced-by-the-remediation clauses for P-22). Without the
pre-specification, both would likely have been counted and one promoted on a sighting that was
actually a Rule AE instance in different clothes. The lesson generalises past this retro: write the
disqualifying bar down at MINT time, not at promotion time, or promotion pressure will read the bar
into existence retroactively to fit the sighting in hand.
