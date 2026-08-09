# FOLLOW-918 — devops lesson (2026-08-09)

- **Date / ticket:** 2026-08-09 / FOLLOW-918 (RETRO-263 — the merge gate is green over checks that
  are merely ABSENT).
- **What I decided:** Added a named required-check register (`.github/required-checks.txt`) as a
  third axis in `scripts/gh-pr-checks-verified.sh`. The gate already read STABILITY (two identical
  settled snapshots) and SIZE (a completeness floor from peer PRs); it never read IDENTITY, so both
  could be satisfied while the checks that matter were `SKIPPED` — which the failure regex counts as
  success — or simply absent. A registered name absent or non-`SUCCESS` is exit 3, never 0.
- **Why exit 3 and not exit 1:** "a required gate did not run" is not a red verdict on the PR's
  content. Exit 1 would send the ticket back to a worker and increment `fix_iteration_counter` for
  something no worker on that ticket can fix — an untriggered workflow. Same class as the
  truncated-rollup refusal (FOLLOW-865): a gate that could not look renders no verdict.
- **Where I nearly shipped the defect inside the fix:** my first derivation rule was "present and
  green in the last twelve merged PRs". That silently EXCLUDED
  `Modal local-source gate (FOLLOW-900)` — one of the six gates RETRO-263 actually flipped to
  `SKIPPED` — purely because PR #698 had introduced it six merges earlier. A long window
  under-registers exactly the gates most likely to be mis-wired: the new ones. Switched to a five-PR
  window plus explicit by-inspection additions, and wrote the lag into the register header as an
  obligation (the PR that adds a required gate adds its name).
- **A guardrail I'd add:** when a control is seeded from observed history, state the window and what
  the window structurally cannot see, IN the artefact. A derived allow/require list reads as
  complete to every later reader; only the header can tell them it is a snapshot with a known blind
  edge. Related to Rule AS (the silent direction is never reported) — here the silent direction was
  "a gate too young to appear in the sample".
