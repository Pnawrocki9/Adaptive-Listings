- **2026-09-22 / FOLLOW-1244** · Tested: `HARNESS_TREE_PATHSPEC`'s "every tracked path whose bytes a
  run executes, or that decides which bytes run" claim, for two files never `import()`ed by the
  harness (`scripts/dev/fixture-listing-details-server.mjs`, `scripts/dev/mock-decision-server.mjs`
  — both started as separate `node` processes by the README, so the harness's own loaded-file regex
  scan structurally cannot see them). · Where a test could have passed over a dead wire: writing a
  test that hand-lists "the files the runbook starts" and checks the array contains them would have
  passed today and drifted the moment README §3 changed without the test author noticing — the
  parity test instead PARSES README §3 itself (`node <path>` / `npx serve <path>` lines) so the set
  under test is read from the same doc an operator follows, not retyped from memory. Also guarded
  against the parser itself going quietly inert (matching nothing after a README reformat) with an
  explicit "found the known starts" assertion before the coverage assertion runs. · A guardrail I'd
  add: when a pathspec/allowlist claims completeness against a DOC ("everything §N tells you to
  run"), the parity test must parse that doc's actual text, not a hand-copied list of what it
  currently says — else the test and the pathspec can drift together and still agree.
