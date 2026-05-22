# FOLLOW-052 — Mirror-code byte-identity CI check (Rule J enforcement)

**Sprint:** 10 **Agent:** devops-engineer **Priority:** P1 **Estimated hours:** 1.5 **Status:**
IN_PROGRESS **Model:** sonnet-4.6 **Branch:** `devops-engineer/FOLLOW-052-mirror-code-ci`

## Context

Two pairs of deliberately-mirrored files exist in the repo:

| Canonical                                                                                                                 | Mirror                                             | Why mirrored                                              |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| `packages/shared/src/bandit.ts` (166 lines)                                                                               | `apps/decision-api/src/lib/bandit.ts` (168 lines)  | Worker bundle cannot import workspace packages at runtime |
| `apps/control-plane/src/app/api/adapt/route.ts` (helpers: `affinityScore`, `deterministicScore`, `buildReorderDirective`) | `apps/decision-api/src/lib/reorder.ts` (368 lines) | Same constraint                                           |

PR descriptions for both Sprint 9.5 PRs (#122, #123) describe these files as "byte-identical" or
"sync requirement documented." However:

1. **No CI gate enforces byte-identity.** The description is aspirational; anyone patching the
   canonical file and forgetting the mirror will silently break production behaviour if the Worker
   route is ever activated.
2. **The files are already NOT byte-identical** — `bandit.ts` canonical is 166 lines, mirror is 168
   lines (2-line difference). The gap is likely JSDoc/comment drift from Sprint 9.5.

This ticket: build a shell script that compares declared mirror pairs and fails CI on drift,
promoting Rule J from CONVENTIONS_PATCH.md into a hard gate.

## Acceptance criteria

1. **`scripts/check-mirror-files.sh`** — executable shell script that:
   - Reads a JSON manifest `scripts/mirror-files.json` listing declared pairs:
     ```json
     [
       {
         "canonical": "packages/shared/src/bandit.ts",
         "mirror": "apps/decision-api/src/lib/bandit.ts",
         "strip_comments": true
       },
       {
         "canonical": "apps/control-plane/src/app/api/adapt/route.ts",
         "mirror": "apps/decision-api/src/lib/reorder.ts",
         "strip_comments": false,
         "note": "Mirror covers helpers only — full byte comparison is not required; function-signature comparison instead"
       }
     ]
     ```
   - For pairs with `strip_comments: true`: strip JSDoc and `//` line comments from both files
     (using `sed` or `node -e`), then compare the normalized content. Diff → exit 1.
   - For pairs with `strip_comments: false` (or where the mirror is a subset): compare only the
     exported function signatures (first line of each `export function`). Any canonical export
     missing from the mirror → exit 1.
   - On success: print `✓ all mirror pairs in sync`.
   - On failure: print the diff and the instruction to update the mirror.

2. **`scripts/mirror-files.json`** — manifest file listing the two declared pairs above.

3. **`.github/workflows/ci.yml`** — add a new job `rule-j`:

   ```yaml
   rule-j:
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
       - name: Check mirror-file byte identity
         run: bash scripts/check-mirror-files.sh
   ```

   Place it after the `rule-h` job.

4. **`lefthook.yml`** — add `check-mirror-files.sh` to the `pre-push` hook alongside
   `check-rule-h.sh`:

   ```yaml
   pre-push:
     commands:
       rule-h:
         run: bash scripts/check-rule-h.sh
       rule-j:
         run: bash scripts/check-mirror-files.sh
   ```

5. **`CONVENTIONS_PATCH.md` Rule J** — update the "Verification" line from the candidate text to
   reference `scripts/check-mirror-files.sh` (mirroring how Rule H references
   `scripts/check-rule-h.sh`).

6. **Fix the existing drift** — after writing the script, run it. If `bandit.ts` canonical vs mirror
   diffs, bring them into sync in this PR (add/remove the differing lines). Prefer keeping the
   canonical's content.

7. **Tests (optional but preferred):** Add a simple bats or bash test that creates two temp files,
   introduces a drift, runs the script, and asserts exit 1.

8. **`pnpm typecheck`, `pnpm lint`, `pnpm build` unaffected** (this is a shell/CI change only).

## Files to touch

| File                                  | Action                               |
| ------------------------------------- | ------------------------------------ |
| `scripts/check-mirror-files.sh`       | New — the comparison script          |
| `scripts/mirror-files.json`           | New — mirror pair manifest           |
| `.github/workflows/ci.yml`            | Add `rule-j` job                     |
| `lefthook.yml`                        | Add `rule-j` pre-push hook           |
| `CONVENTIONS_PATCH.md`                | Update Rule J verification reference |
| `apps/decision-api/src/lib/bandit.ts` | Fix any drift vs canonical           |

## Key files to read before starting

- `apps/decision-api/src/lib/bandit.ts` — the mirror (168 lines, verify diff vs canonical)
- `packages/shared/src/bandit.ts` — the canonical (166 lines)
- `apps/decision-api/src/lib/reorder.ts` — reorder mirror (368 lines)
- `.github/workflows/ci.yml` — find existing `rule-h` job to model `rule-j` after
- `lefthook.yml` — find `pre-push` section to add the hook
- `CONVENTIONS_PATCH.md` — find Rule J candidate entry

## Definition of done

- PR opened on `devops-engineer/FOLLOW-052-mirror-code-ci`
- `rule-j` CI job passes on the PR (no drift after fix)
- `gh pr checks <pr-number> --watch` all SUCCESS (ignore: Doppler, Rule I, Python tests)
- PM-orchestrator validates AC items and comments: `PM-validated. CI green. Ready for human review.`
- QUEUE.md: FOLLOW-052 → `READY_FOR_REVIEW`
