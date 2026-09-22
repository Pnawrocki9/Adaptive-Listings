# FOLLOW-820 — architect lesson (2026-09-22, CEO rulings on condition 1)

- **Date / ticket:** 2026-09-22 / FOLLOW-820 (CEO rulings of 2026-09-22 recorded in §P.0 item 1;
  MASTER_DESIGN 4.15; §Snapshot.0 bullets (a)/(b) restated for #926 and #927).
- **What I decided:** nothing about the gate; I transcribed three rulings in the CEO's words and put
  each one next to the thing it grades. Ruling (1) reads the `TALLY … run=GREEN` line #927 ships, so
  the rule points at a symbol (`gradeRun()`, `grade.runVerdict`) rather than at a prose notion of
  "green". Ruling (2) sits beside bullet (b), which now describes shipped behaviour, not a
  specification. Ruling (3) creates work, and that work has an owner (FOLLOW-1249) before the SoT
  says fixture-grounded runs "count only after" it. The two existing three-run series (§5.13, §5.14)
  are labelled context in the row itself, so no reader can lift "6/6 ×3" as GO evidence.
- **Where a spec risked describing behavior with no owner:** ruling (3) is a gate rule whose
  satisfaction depends on code nobody had written when it was made. Written as "fixture-grounded
  runs count once the fixture serves production's fields", it is a Rule H spec with no owner. The
  brief named FOLLOW-1249 as being filed in parallel; I cited it by number and did not write its
  stub, per the brief, which means the SoT now depends on a stub landing in another PR. That is the
  residual risk of this change, and the PM must confirm FOLLOW-1249 exists before merging.
- **A guardrail I'd add:** when a CEO ruling changes what a status row may claim, re-cut the row's
  OWN text first ("no GO-citable series exists yet") and only then the bullets under it; a row that
  still reads "green on three consecutive runs" with the ruling three paragraphs below is the
  misquote waiting to happen. And: verify every SHA a brief hands you against `.git` before citing
  it. Here `609a62ee` could be confirmed only as an object present in the store, not decoded, and
  #925's merge SHA could not be found at all, so it is cited by PR number only.
