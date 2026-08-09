## 2026-08-09 / FOLLOW-932

**What I built:** Doc/gate-hygiene only — no runtime code. Renamed the misleading `ci.yml` step name
(`<40KB` → `<42KB gzip, ESC-028`, confirmed the required-checks register holds the job name `Build`,
not this step, so no register edit needed). Added a `Budget note` to FOLLOW-913 and FOLLOW-898's own
bodies in `FOLLOW_UPS.md` (their PM-side blocking note already had 1,356 B; their own AC text
didn't). Appended (not rewrote) three annotations to ADR-0021 marking its `~5.5KB` estimate as a
measured 4.1x miss (1.31KB actual), including the two "standalone module size" sightings a
symbol-only grep would miss (Rule AI's three-vocabulary sweep). Extended `check-bundle-size.js` to
print raw bytes and signed headroom alongside the existing KB line.

**What was uncertain:** A clean rebuild (`pnpm --filter @estalara/shared build` after deleting
`dist/`) at branch base `942bce4b` measured **41,641 B / 1,367 B headroom** — 11 bytes better than
the ticket's canonical 41,652/1,356, because `31cab8b4` (FOLLOW-931, #711) touched
`packages/shared/src` between the retro's baseline commit (`25cff8bc`) and mine. I used the corpus's
established 1,356 B in the doc edits (consistency with `docs/INTERFACES.md`, already-DONE and out of
my scope) rather than my own fresher 1,367 B, to avoid introducing a new three-way inconsistency —
and disclosed the drift explicitly in the PR body instead of silently picking one. Also hit a
`tsc --project` composite-build footgun: `rm -rf dist` without also deleting the sibling
`tsconfig.build.tsbuildinfo` (written outside `dist/`, so `clean` doesn't touch it) makes `tsc`
believe the build is already up to date and emit nothing, with zero errors — the false-negative
silently produced a broken `@estalara/shared` for the next `pnpm --filter @estalara/sdk build`.

**A guardrail I'd add:** A byte figure that survives more than one commit needs an expiry, not just
an instrument citation — the next merge that touches a dependency the bundle imports will move it
again, silently, by single-digit bytes. Consider a CI step that fails loudly (not just green-with-a-
different-number) when the gate's measured headroom drifts from the last number written into
`docs/INTERFACES.md` by more than a token amount, so drift is caught at merge time instead of at the
next audit.
