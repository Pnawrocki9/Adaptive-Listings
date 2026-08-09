# FOLLOW-919 — devops lesson (2026-08-09)

- **Date / ticket:** 2026-08-09 / FOLLOW-919 (R-F1 asserted the effect probe EXISTS).
- **What I decided:** Replaced the residual register's `artifact: str` field (a path, checked with
  `.exists()`) with `external_control: ExternalControl`, a described property plus a predicate. R-F1
  now asserts the probe is invoked by all three workflow sites that claim to run it and still
  declares the `--app` selector its callers pass — parsed, never imported or executed, because the
  whole value of R-F1 is that the description-axis and effect-axis controls stay independent.
- **The measurement that mattered:** all three realistic perturbations were GREEN under `.exists()`
  — probe truncated to zero bytes, one invocation site deleted, invocation left only inside a
  comment. The control case stays green. **Deletion is the shape nobody performs; un-wiring is the
  shape that happens.**
- **Why I changed the FIELD and not just the entry:** the ticket's AC(3) asked for it and it is
  right — an `artifact`-kind residual claims "this hole is closed by another control", and a
  filename is not evidence that a control is in place. Leaving the field as a path would have let
  the next residual re-introduce the same false green, in a register whose whole purpose is that
  gaps cannot be quietly asserted away.
- **A guardrail I'd add:** any register entry that discharges an obligation onto something OUTSIDE
  the checking artefact must name a property and carry a predicate for it. "Points at a file" and
  "the file does its job" are different claims, and the register format decides which one people can
  express. Same family as FOLLOW-918 (the merge gate read size and stability, never identity) and
  FOLLOW-925 (a countersign whose gate was prose) — all three landed the same day, which is itself
  the signal: **this estate's controls keep asserting presence where they mean function.**
