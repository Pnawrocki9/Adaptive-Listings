# DevOps Engineer — Lessons

---

## 2026-08-24 / FOLLOW-1070

**What I shipped:** `scripts/lib/extract-fn-signature.cjs` (TS-parser-based signature extraction,
replacing a `grep | head -1` that only ever read one physical line) + FAIL-not-WARN on a real
mismatch + a red-first fixture test (8/8 assertions, wired into CI with `if: always()` so it proves
itself independent of Rule J's own result) + `fetch-depth: 0` on the `rule-j` job (needed once the
fixture reads a historical commit) + `pnpm install` added to a job that previously ran with zero
deps despite `require('typescript')` now being load-bearing. PR #836.

**Where a green badge could have hidden a broken run path:** the ticket itself. `Rule J` printed
`OK: signatures match` on a required gate for TWO different helper functions across an entire sprint
(PR #825, merged 2026-08-22, unnoticed until RETRO-298 read it by hand). The extraction looked
specific ("compares signatures") and was actually comparing the literal string `function fn(` on
both sides for any multi-line declaration — the exact shape Rule AU names: a control asserting a
name's presence where it means a behavioural claim.

**A guardrail I'd add:** when a gate's own local test run is GREEN but its CI job never installed
the dependency the gate's own code requires (`require('typescript')` with zero `pnpm install` in the
job), that's a second, silent gap of the same shape — the gate "existing" was never proven to run
with its real dependency present in the actual CI environment, only on a dev machine that happens to
have `node_modules` two directories up. I found this only because I ran the check against a script
exercising the new dependency; a gate that merely imports something already on the author's PATH
would ship the same hole undetected. Worth a repo-wide sweep: does every `scripts/check-*.cjs` that
`require()`s a non-builtin module have a `pnpm install` step in its owning CI job?

Also: my own red-first fixture test broke in CI (not locally) because `actions/checkout@v4` defaults
to `fetch-depth: 1` and the fixture reads a historical commit via `git show`. Caught it by reading
the actual CI job log, not by trusting the local pass — exactly the "local tests passing ≠ CI
passing" rule, applied to a fixture I wrote myself in the same PR that's supposed to prevent this
class of gap in someone else's gate.

---

## 2026-08-01 / FOLLOW-757

**What I shipped:** Fixed four measured false-negative shapes in
`scripts/check-sentry-capture-has-init.sh` (PR #648): (1) a docstring mentioning `init_sentry(`
cleared the whole file, (2) a trailing comment did the same (inherited from the sibling singleton
gate's own bug, inverted to fail silently instead of loudly), (3) `! -name "*test*.py"` was a
substring glob that skipped production files like `latest_pricing.py`, (4)
`! -name "observability.py"` blanket-excluded any file with that basename though its stated
rationale (capture calls live there "in comments only") was empirically false — verified with a
direct grep against all three registered mirrors before removing it, per AC3's instruction not to
take the ticket's word for it. Fix: a `python3 tokenize`-based `_clean_python_source()` blanks
COMMENT/STRING tokens to same-width whitespace (preserving line numbers) before EITHER the
capture-detection or the init-clearance regex runs, so the two halves can't drift apart again; the
allowlist-comment check still reads the ORIGINAL line so that legitimate annotation isn't itself
stripped. Added one red-first self-test fixture per shape (shown false-PASS on the pre-fix script,
correct-FAIL on the fixed one — pasted transcript in the PR) plus an allowlist inventory line
(count + file:line) printed on every run.

**Where a green badge could have hidden a broken run path:** the gate reported PASS against the real
tree both before and after this fix — none of the four holes were live. The only thing that would
have hidden the regression risk permanently is exactly what this ticket fixed: a self-test that
never exercised these four shapes, so a future PR could reintroduce any of them (e.g. someone adds a
docstring like "this module's captures are served by init_sentry() in main.py") and the mechanical
gate would silently clear it forever, with nobody able to tell from the CI badge alone.

**A guardrail I'd add:** none new for this gate — the four fixtures are now permanently wired into
`--self-test`, which is the first step of the hard CI job, so they can't silently stop running.
Residual, explicitly deferred per the ticket (not silently dropped): SCAN_DIRS is `apps/*/src` only
(a capture site under `packages/`/`scripts/`/`tests/` would be unscanned — verified zero such sites
exist today) and the real-check `for f in $FILES` loop is unquoted word-splitting (no filename with
IFS whitespace exists today). Both recorded in the script header so a future engineer doesn't
rediscover them from scratch.

## 2026-07-24 / FOLLOW-625

**What I shipped:** A CI hard-gate (`scripts/check-k2-consumer-swallow.cjs` + `.sh` wrapper +
`.github/workflows/ci.yml` job) mechanising Rule K.2's consumer-side clause — an AST walk that FAILS
when a client component under `apps/control-plane/src/{app,components}/**` GETs editable config on a
`fetch(...)` chain, populates form state, and swallows a failed load. Scope deliberately covers
`src/components/**`, not just `src/app/**` (RETRO-206 §4a LG-2), because FOLLOW-624's narrowed grep
missed the shared `generation-model-settings.tsx` twin. Red-first fixture proof covers both
directions incl. a `src/components` negative control.

**Where a green badge could have hidden a broken run path:** (1) A guard whose real-repo run is
green because it detects _nothing_ vs green because everything is fixed — I added a
`K2_GUARD_NO_ALLOWLIST=1` bypass so the fixture proof asserts the 4 read-only analytics swallows ARE
detected-then-allow-listed, proving the allow-list is load-bearing. (2) Scoping the guard to
`src/app/**` (the ticket's ORIGINAL AC) would have shipped green while the components twin still
swallowed — the exact escape the amendment widened to close. The negative control lives under
`scripts/__fixtures__` (outside the real scan roots), so a committed "failing" fixture can't redden
the branch.

**A guardrail I'd add:** none new — this ticket IS the guardrail. Residual (documented, not silent):
the block-form `try { await fetch } catch {}` shape is not yet covered; add coverage if an instance
ever appears.

## 2026-06-26 / FOLLOW-406 + FOLLOW-411

**What I shipped:** Negative-control attestation proving gitleaks `cloudflare-api-token` detection
is RESTORED on `route.ts` (adapt) and `consent/platform-registration/lib.ts` after file-wide `paths`
exemptions were deleted in PRs #362/#364. Disambiguated the `regexes` entry for
`CANONICAL_CONSENT_TEXT_HASH`: CB-1 proved the inline `// gitleaks:allow` on lib.ts:46 is sufficient
(scan GREEN without the entry) → deleted the entry (cleaner). Added bidirectional maintenance
comments linking `.gitleaks.toml` and `lib.ts:45-49` so hash-rotation is unambiguous.

**Where a green badge could have hidden a broken run path:** PRs #362 and #364 deleted the file-wide
`paths` exemptions and reported green CI — but "no FP" proves the config change, not that
real-secret detection works. Without a dummy-token negative control, a future committed real CF API
token on `route.ts` would only be caught at the CI gitleaks-action step, not locally. The gap was
the absence of a proof-of-detection test, not the CI gate itself.

**A guardrail I'd add:** After any allowlist narrowing or deletion in `.gitleaks.toml`, the PR MUST
include a negative-control run log (dummy token → RED → removed) as required evidence in the PR
description, automated via a local `scripts/gitleaks-negative-control.sh <file> <rule-id>` helper so
any engineer can reproduce it without manually editing source files.

---

## 2026-06-30 / FOLLOW-436

**What I shipped:** Operator go-live runbook (`docs/runbooks/modal-embed-seed-consumer-golive.md`)
and escalation entry (ESC-034) for the FOLLOW-435 embed-seed Modal consumer. Added missing
`REDPANDA_TOPIC_LISTING_EMBEDDINGS` to `.env.example`.

**Where a green badge could have hidden a broken run path:** FOLLOW-435 merged CI-green with the
consumer code-complete, but wiring verification uncovered two structural bugs: (1) `main.py` is a
placeholder that deploys nothing when `modal deploy apps/llm-gateway/src/main.py` is run, and (2)
both `generate_description.py` and `consume_embed_seed_requests.py` independently define
`modal.App("estalara-description-generator")` — deploying either file alone REPLACES the other's
functions in the live Modal app. A passing CI badge does not verify that `modal deploy` actually
registers the new cron, only that the Python file parses and tests pass. The consumer is an orphan
from the deploy path.

**A guardrail I'd add:** For every new Modal `@app.function()` added to an existing app, CI must
include a `modal app list` or `modal deploy --dry-run` step (or equivalent Modal SDK introspection)
that proves the function name appears in the deployment manifest. Without this, "CI green" only
means the code compiles, not that `modal deploy` would register the cron.

---

## 2026-06-30 / FOLLOW-438

**What I shipped:** `scripts/check-modal-app-singleton.sh` + hard-gate `modal-app-singleton-guard`
CI job. Guards against BUG 2 (ESC-034) recurrence: asserts exactly one `modal.App()` assignment in
`apps/llm-gateway/src`, excluding comment lines, docstrings, test files, and `conftest.py` mocks.
Mirrors `check-fire-and-forget-sinks.sh` structure (--self-test negative + positive control, env-var
scan target, exit-code semantics 0/1/2).

**Where a green badge could have hidden a broken run path:** The FOLLOW-437 structural fix (shared
`_app.py`) has no runtime verification in CI — `modal deploy` is not in CI. A developer adding a
second consumer by copy-paste from an old version of the file would re-introduce the modal.App
declaration and get a green CI badge (Python tests pass, the mock stubs both calls). The collision
would only surface at deploy time when one consumer's functions vanish from the live app. Without
this guard, BUG 2 is invisible to CI.

**A guardrail I'd add:** None beyond what is now shipped. The pattern (grep-based assignment guard +
self-test that validates the detector) is the same durable approach that closed the fire-and-forget
sweep gap. The key principle: when a "structural" fix (shared module, afterResponse wrapper) is the
durable solution, a mechanical CI gate enforcing the structure is always the required companion —
prose ACs and human grep checks fail under copy-paste pressure.

---

## 2026-07-01 / FOLLOW-448

**What I shipped:** Branch-first worker discipline codified in `docs/AGENT_WORKFLOW.md` + all 8
worker agent definitions (`git checkout -b` as the FIRST action, before any edit), a non-blocking
`PreToolUse` hook (`.claude/hooks/pre-edit-branch-guard.sh`) that warns via `additionalContext` when
`Edit`/`Write`/`MultiEdit` fires while `HEAD == main`, and a PM "recovered-work re-verification"
checklist (confirm branch → confirm nothing else stranded → independently re-run
typecheck/lint/tests → only then commit). Root cause: FOLLOW-442's `backend-engineer` subagent
stalled 600s before ever running `git checkout -b`, leaving correct work uncommitted directly on
`main` (RETRO-146 §4e).

**Where a green badge could have hidden a broken run path:** the guard itself is not CI — it only
fires inside a live Claude Code session, so there is no CI job whose green status could ever prove
it ran against a real stall. The evidence I could produce (a `git worktree` self-test exercising 5
cases against the script directly) proves the _script's logic_ is correct, but does NOT prove Claude
Code's `PreToolUse` machinery actually invokes it with the JSON shape I assumed
(`tool_input.file_path`, `additionalContext` respected) — that's asserted from the hooks doc, not
observed end-to-end inside a real agent turn. If the hook's `tool_input` field name is wrong for a
given tool version, the guard would silently never fire while `.claude/settings.json` still shows it
"registered" — a config-exists badge masking a dead wire, the exact shape this codebase's Rule Q
warns about.

**A guardrail I'd add:** a lightweight repo self-test (e.g. `scripts/check-hook-registration.sh`,
run in CI) that parses `.claude/settings.json`, confirms every hook `command` path exists and is
executable, and — where feasible — asserts the hook script's expected JSON input/output shape
against a fixture, so a hook silently going dead (wrong field name, moved file, JSON schema drift)
fails CI instead of only being caught the next time a human happens to `cat` a debug log.

---

## 2026-08-02 / FOLLOW-760

**What I shipped:** Fixed the tokenizer fallback in `scripts/check-sentry-capture-has-init.sh`'s
`_clean_python_source()` (RETRO-238 CB-1): on a `python3 tokenize` failure it used to write the RAW,
uncleaned file to stdout, silently reverting both the detection and clearance regexes to matching
raw text — reintroducing the exact docstring/comment false-clear FOLLOW-757 had just closed,
invisibly (no warning, no counter, no exit-code change). Now it writes nothing and exits non-zero;
`_check_file` captures that via `||` (not a bare assignment, so `set -e` isn't tripped) and reports
the file as its own distinctly-tagged `UNPARSEABLE` finding — a separate accumulator/heading from
ordinary `VIOLATION` findings, and a hard failure by default (exit 1) rather than a soft pass.
Tightened all five existing violation self-test assertions to check the specific exit code (1), not
merely non-zero, and added a red-first fixture (unterminated triple-quoted string + docstring-only
`init_sentry(` mention + a real `sentry_sdk.capture_exception()` call) that PASSES against the
pre-fix script (proved) and is correctly caught, under the distinct `UNPARSEABLE` tag, against the
fixed one. CB-3 (detection regex requires the literal `sentry_sdk.` prefix, so
`from sentry_sdk import capture_exception` is invisible) is judged and DEFERRED — documented in the
header with the repo-wide grep that proves it is not live today, explicitly marked
"documented-and-open" rather than left unmentioned, per the ticket's own instruction that this is a
second axis of work from CB-1's fallback-safety fix.

**Where a green badge could have hidden a broken run path:** this is the second instance of the
exact same shape in the exact same file — a "fix" for a silent-pass gate itself shipping a silent
pass, because the fixture that would have proven it (a file that fails to tokenize) was never
written. FOLLOW-757's own self-test suite was green and its header even listed two OTHER residual
gaps (items 5/6) but not this one, because nothing in the four new fixtures ever exercised the
`except Exception` branch. A fixture set that never reaches every branch of the function it is
testing proves nothing about that branch, no matter how many other cases it covers.

**A guardrail I'd add:** when a self-test suite for a gate is added or extended, require (as a
review question, not yet a mechanical check) "does at least one fixture exercise every
`except`/fallback branch in the functions under test?" — branch coverage as a checklist item for
hand-written shell self-tests, since there is no `nyc`/coverage tool for bash+embedded-Python
heredocs here to enforce it mechanically.

---

**2026-08-02 · FOLLOW-746** (holes in `scripts/check-sentry-init-singleton.sh`, with FOLLOW-764's
three corrections folded in)

**What I shipped:** Four holes closed in the singleton guard, red-first: (1) the basename exclusion
`--exclude="observability.py"` replaced by an exclusion list READ FROM `scripts/mirror-files.json`,
so a 4th unregistered copy is scanned; (2) `--exclude="*test*.py"` replaced by anchored `test_*.py`
/ `*_test.py` / `conftest.py` — the same substring-glob shape FOLLOW-757 fixed in the sibling gate,
and on this axis it fails SILENTLY here too (`latest_pricing.py` with a bare init was unseen); (3)
the whole-line-only comment filter replaced by the tokenizer pass, so trailing comments and
docstrings stop producing false REDs; (4) an unparseable file is now a distinct, loud `UNPARSEABLE`
finding. Plus AC1 basename discovery in `check-mirror-files.sh` (opt-in per pair, because `route.ts`
matches 80 unrelated Next.js files — the opt-outs are PRINTED, not silent), and AC4's path-neutral
docstring in all three `observability.py` copies.

**The decision the ticket said to make before writing code (item 8):** the tokenizer pass already
existed as a ~50-line heredoc in the sibling gate. I extracted it to
`scripts/lib/clean-python-source.sh` and sourced it from both gates rather than registering the two
copies as a Rule J pair. Reasoning: Rule J exists for duplication that CANNOT be removed (each Modal
app builds its own container image, so `observability.py` cannot be an import); `scripts/` has no
such boundary, both gates run from the same checkout in the same runner, so a `source` is free.
Registering the copies would have meant inventing a NEW comparison strategy in
`check-mirror-files.sh` for a bash/python hybrid — more shared-logic surface added in order to
police a duplicate that need not exist. Extraction makes drift impossible instead of merely
detectable.

**Where a green badge could have hidden a broken run path:** the AC1 self-test.
`check-mirror-files.sh` had no `--self-test` at all, and its only automated invocations (ci.yml
`rule-j`, lefthook pre-push) call it with NO arguments — so adding a `--self-test` flag alone would
have shipped a fixture suite that nothing ever runs, the exact "operator-runnable script nobody
invokes" failure. I could not add a CI step (out of scope), so the self-test also runs INLINE at the
start of every normal run (one summary line, full output only on failure, recursion-guarded by an
env var). It is now proven to run on every push and every PR, by the job that already existed.

**A guardrail I'd add:** when a gate acquires a `--self-test`, the same PR must show the automated
path that invokes it — a CI step, or an inline pre-run self-check. "The self-test exists" and "the
self-test runs" are different claims, and only the second one is worth a green badge.

- **2026-08-03 / FOLLOW-770 (fix-iteration 1)** · Fixed the Rule AP residual register's runner: it
  decided UNEVALUABLE from `pipefail`'s status, which is the RIGHTMOST non-zero — so a dead producer
  (git 128, grep 2) piped into a further `grep` was reported as that grep's ordinary "no match" 1
  and classified `latent`. Now decides on `${PIPESTATUS[@]}` (any stage >= 2 ⇒ UNEVALUABLE), plus
  "epilogue never reached ⇒ UNEVALUABLE". Two red-first fixtures: `core.excludesFile` pointed at a
  directory (availability guard still passes, so entries A/B are exercised on their own merits
  instead of being short-circuited), and the gate sourced under a non-existent `$0` (entry F's
  `$MF_SELF` unreadable). · **Where a green badge could have hidden a broken run path:** the gate
  was correct only BY EXECUTION ORDER — an earlier guard exited 2 before the broken entries ran.
  Green badge, three entries that would silently misreport in any gate that copied them without that
  guard. · **Guardrail I'd add:** for any "this check fails loud when its input is missing" claim,
  test the check with its dependency broken _while every other guard passes_ — if the only fixture
  that exercises it also trips an earlier guard, the check itself is unproven. And:
  `set -o pipefail` is never sufficient evidence that a pipeline's failure is observable; assert on
  `PIPESTATUS`.
- **2026-08-03 / FOLLOW-768 + FOLLOW-769 + FOLLOW-771** · Shipped: allowlist clearance in
  `check-sentry-capture-has-init.sh` moved off raw text onto `tokenize.COMMENT` spans (and the
  inventory that feeds its committed baseline moved with it, same function, same PR — otherwise the
  two halves would have disagreed about what an allowlist entry is); FOLLOW-765's exclusion
  inventory and hardened-marker check in `check-sentry-init-singleton.sh` moved off `$FILES` onto
  the manifest-derived `$REGISTERED` set, with a stale registered path now a loud finding; Rule AP
  residual registers (8 and 10 executed entries) added to both gates using `check-mirror-files.sh`'s
  corrected `PIPESTATUS` runner copied verbatim; 8 shared-helper hard-fail fixtures (2 helpers x 2
  shapes x 2 gates); a scoped `shellcheck -x -P SCRIPTDIR` CI job.
- **Where a green badge could have hidden a broken run path:** three places. (1) The capture gate
  was exiting 0 on a real, unserved `capture_exception(` because the allowlist token happened to sit
  inside a string literal on that line — and the raw-counting inventory would have COUNTED that same
  token, so the false GREEN came with a reviewed-looking baseline entry vouching for it. (2) The
  singleton gate printed `3 entry/entries → matches the committed baseline` while a registered pair
  outside `apps/*/src` was in neither of the two controls that baseline exists to bound. (3) Writing
  the two new registers naively would have reproduced FOLLOW-770's own defect: five of my eighteen
  entries chain a producer into a second `grep`, and under bare `pipefail` a dead producer is
  reported as the trailing grep's ordinary "no match" 1 — classified `latent`, the reassuring
  direction. Copying the corrected runner verbatim (including the `MF_PS_FILE` name, so the two
  files diff to zero) was the whole defence; re-deriving it would have re-introduced the bug.
- **A guardrail I'd add:** a register entry whose latency proof would go live on LEGITIMATE usage is
  worse than no entry — I wrote one (test-convention files holding a real `sentry_sdk.init(`, which
  every test fixture does) and it turned three passing self-tests red before I caught it. Rule AP
  should say explicitly: if a residual has no proof that can be latent in normal operation, record
  it as a proof-less bound inside a neighbouring entry and say so, rather than shipping a
  permanently- live entry that trains readers to ignore the register.

## 2026-08-05 · FOLLOW-827 + FOLLOW-830 (PR #680)

- **What I shipped:** `scripts/gh-pr-checks-verified.sh` — the repo's mandated merge gate — now
  classifies `Rule I` by SYMBOL SET (parsed from each run's own `WARN: '<sym>' in <file>` lines)
  instead of by violation COUNT, preflights its own hard dependencies (bash >= 4, PCRE grep, `gh`,
  `gh auth status`) with exit 3, prints the ratcheting baseline's run id/head/timestamp, names `gh`
  fetch failures distinctly from parse failures, and carries an 11-fixture hermetic `--self-test`
  wired into `ci.yml` as the hard gate `pr-checks-gate-self-test`.
- **Where a green badge could have hidden a broken run path:** in the gate itself, twice over, and
  that is the whole lesson. `grep -oP` under `set -uo pipefail` WITHOUT `-e` does not fail — it
  returns an EMPTY array, which this script then printed as `failing: 0` → "all checks green" → exit
  0 over a FAILURE check. Every PR validated on a non-PCRE host would have been waved through by a
  gate reporting success. The count comparison was the same shape one level up: a true statement
  (`192 <= 192`) standing in for the statement anyone actually cared about (no NEW dead export).
  Both were invisible because nothing exercised the script — it had zero tests while being the thing
  four agent definitions and CLAUDE.md point at.
- **A guardrail I'd add:** a script that is _the_ gate for a class of work must be red-first tested
  before it is adopted as the gate, not after — and the specific mechanical rule is: any
  `grep -oP`/`mapfile` whose EMPTY result would be interpreted as "nothing wrong" needs either
  `set -e`, an explicit emptiness check, or a preflight. "Empty means clean" is the default reading
  of every collection in shell, and it is the reading that turns a tool failure into a green badge.
  Corollary worth codifying: when a fix and a self-test land together, commit the RED state
  separately, so the assertion is provably measuring the defect and not its own assumptions.

## 2026-08-06 · FOLLOW-846 (PR #683)

**What I shipped.** Fixed the merge gate `scripts/gh-pr-checks-verified.sh`: the Rule I baseline is
now a bounded newest-first walk over `main`'s runs (rejecting cancelled/skipped runs, cancelled Rule
I jobs, and unparseable logs, printing every skip with its reason) instead of
`--status completed -L 1 | .[0]`; tooling failures exit 3 in tooling vocabulary instead of exit 1 as
"GENUINE FAILURES"; the fixture seam now requires `GH_PR_CHECKS_SELF_TEST=1` + a `self-test.marker`
file and banners every RESULT line when active; a 404 is classified from the job's own `conclusion`
rather than always blamed on 90-day log expiry; the failing list is de-duplicated by name with Rule
I symbol sets UNIONED across the push/pull_request duplicates. 5 new fixtures, 16 total.

**Where a green badge could have hidden a broken run path.** Two, both live on `main`. (1)
`GH_PR_CHECKS_FIXTURE_DIR` was honoured in production mode, so the gate printed "all checks green.
Safe to mark READY*FOR_REVIEW" and exit 0 for a real PR number after **zero network reads** — a
fail-open in the gate whose only job is not to do that. A seam that exists for tests must be
\_enforced* as test-only; a comment saying "never set by a caller" enforces nothing, and the comment
was false. (2) The inverse, which is the subtler one: the gate reported a _tooling_ failure using
the _PR's_ vocabulary ("GENUINE FAILURES — do NOT mark READY_FOR_REVIEW"), and the documented
response to that is to send the ticket back to its worker. A gate that can't distinguish "this PR is
broken" from "I couldn't look" trains readers to re-run until green, which is the same corrosion as
a false green arriving from the other direction.

**A guardrail I'd add.** Any script with a test-only seam must have a fixture asserting the seam is
_refused_ on the production path — the seam's own existence is what needs pinning, not just the
behaviour it enables. Second: every exit code a script documents needs a consumer-facing meaning in
the docs that route on it; I found `docs/AGENT_WORKFLOW.md` and `CONVENTIONS_PATCH.md` both
enumerating 0/1/2 with no 3, so an exit 3 had no documented response at all.

---

**2026-08-06 · FOLLOW-842** — Closed the PCRE fail-open in `scripts/check-rule-i.sh`: a dependency
preflight that probes the exact `grep -oP ... \K ...` construct the extractor uses (not merely "does
-P exist"), a guarded repo-root resolution, three separately-named "nothing to check" guards
(discovered nothing / scanned nothing / parsed nothing), the `100644 -> 100755` mode bit, and a
9-fixture hermetic `--self-test` wired to a new green CI job.

**Where a green badge could have hidden a broken run path.** Everywhere, and in series. Pre-fix, the
gate printed `Violations found : 0` + `Rule I passed` + exit 0 in five distinct degraded states —
including with a non-PCRE `grep` over a repo whose only export was an orphan. Worse than the local
false green: `gh-pr-checks-verified.sh` now parses these very lines to build the baseline it
compares every PR against, so a degraded matcher here empties that baseline silently. The fix that
mattered most was the smallest: in the no-verdict states, print **no** `Violations found` line at
all, so the downstream consumer meets an unparseable log (named tooling failure) instead of a clean
zero it would happily accept.

**A guardrail I'd add.** When a script's stdout becomes another script's input, that is an API — put
a reciprocal named comment on BOTH sides in the same PR (producer names consumer, consumer names
producer). I also stopped writing "must not contain X" fixture assertions against bare substrings:
my first four fixtures failed because the guard's own diagnostic text quotes the forbidden line.
Assert the literal formatted line, padding included — that is the contract anyway.

---

**2026-08-06 · FOLLOW-854 / FOLLOW-855 / FOLLOW-856 (PR #685)** — Three RETRO-252 findings against
`scripts/gh-pr-checks-verified.sh`, together because they are one loop. 856: the failing-check list
was one PCRE against an exact serialization with nothing checking it against the four independent
counts printed beside it — a shape mismatch gave `failing: 0` and exit 0 over FAILURE check-runs.
Added the arithmetic guard (exit 3) and derived the parser from the jq projection. 855: the PR side
was the union of two commits and the baseline was one older `main` run, so a dead export another PR
merged became "New on this PR", exit 1, against a worker who could not fix it. Split the union by
provenance, read Rule I check-runs at every state (not just failing ones), added the "PR edits the
extractor" case, and gave both a new exit 4 that must not increment `fix_iteration_counter`. 854:
`pm-orchestrator.md` still said "3 = usage/gh error" beside the retry cap — replaced with the full
table, plus `scripts/check-gate-exit-codes.sh` as a hard CI gate so the contract cannot drift from
the corpus again.

**Where a green badge could have hidden a broken run path.** Two places, and the second is the one I
nearly walked past. (1) The obvious one: 856 is a gate that says "all checks green" over red checks
— a green badge that IS the hiding mechanism. (2) The one I nearly shipped: my first instinct was to
fix 855 by comparing only the PR's failing Rule I check-runs. That works for the fixture the ticket
asked for and silently fails the real case where the branch head is GREEN and only the merge ref is
red — one failing check-run, no intersection, false red survives, and the fixture suite would have
been all-green while the defect stood. I only found it by asking what the fix does when one of the
two runs is not in the failing list at all. F20 exists because of that question.

**A guardrail I'd add.** When a check's verdict depends on comparing two producers, the gate must
name the producers and refuse to compare when they differ — different commits, different extractors,
different serializations are all the same defect wearing three hats, and I found all three in one
file. Concretely: never compare a set built from N sources against a set built from M sources
without either making N == M or classifying the difference into its own verdict. Second, smaller: a
fixture COUNT assertion must count the assertions that RAN, not the assertions that PASSED — folding
in a check that is legitimately unavailable in some environments (here, the git-index mode check
outside a checkout) is exactly what made the previous 16→15 degradation invisible.

---

**2026-08-06 · FOLLOW-857** — Repaired `scripts/check-rule-h.sh` Pattern 2, which **could not fail
for 84 days**: the consumer count ended `| wc -l || echo 0`, so under `set -euo pipefail` a symbol
with ZERO importers — the exact condition the gate exists to catch — made the trailing `grep -v`
exit 1, pipefail carried that past `wc -l`'s own `0`, and `|| echo 0` appended a second `0`.
`[[ "0\n0" -lt 1 ]]` is an arithmetic syntax error, which inside an `if` reads false, so the hard
gate printed `OK:` over genuine orphan exports. Fixed the VALUE (a count that cannot be produced is
neither 0 nor 1 — it is `UNDETERMINED` and exit 3), closed the third instance of the FOLLOW-830 /
FOLLOW-842 PCRE fail-open, and added `scripts/lib/wired-or-dead-common.sh`: one preflight, one
repo-root guard, and ONE orphan/wired fixture pair now asserted against BOTH gates, because the pair
diverged precisely because nothing compared them.

**Where a green badge could have hidden a broken run path.** The `rule-h` job itself, and it still
would have without the self-test. Rule H is diff-scoped — it only inspects files the PR ADDS — so on
this very PR it evaluated zero symbols and was green in 12s. A green `rule-h` was never evidence the
gate worked, before or after the fix; only the new `rule-h-gate-self-test` job is. The same property
booby-traps the backlog measurement: running the repaired gate against `main` returns a clean 0, and
the honest number only appears when the base is the commit the gate landed at (24 violations, 46 lib
files). A "measure it on main" instruction would have produced a confidently wrong zero.

**A guardrail I'd add.** Any diff-scoped CI gate must ship a self-test job in the SAME PR, because
its ordinary green proves nothing about the PR introducing it. Second, and this one generalises: a
gate's own diagnostic prose must never contain the literal string its downstream parser extracts.
Rule I's preflight message printed `'Violations found: 0'` inside an error paragraph, which the
merge gate's own regex would have read as a real count of zero from a run that rendered no verdict —
a fail-open built entirely out of a sentence. Third: verify the causal story you were handed.
RETRO-253 and the ticket both said Rule I "already has the fix" (`$(( count + 0 ))`); reverting Rule
I's guards left every fixture green, because Rule I never had `|| echo 0` and runs without `set -e`.
Copying the normalisation would NOT have fixed Rule H.

## 2026-08-07 · FOLLOW-865 — the merge gate settled on a truncated rollup and called it green

**Shipped.** A completeness floor in `scripts/gh-pr-checks-verified.sh`'s settle loop: derived (40%
of the second-highest of the twelve most recent PR rollups, one `gh pr list` read) rather than
hardcoded, plus a refusal to settle below the largest rollup already seen in the same run, plus a
`--accept-cardinality <n>` waiver that requires the exact observed count and rides every RESULT
line. Below the floor: exit 3, UNDETERMINED, naming observed vs expected. Also made the fixture seam
serve a snapshot SEQUENCE, which is what let any of it be proven red-first (FOLLOW-848 AC(1)).

**Where a green badge hid a broken run path.** In the gate that exists to stop exactly that. Two
consecutive identical snapshots prove the check set stopped CHANGING; nobody had ever asked whether
it was COMPLETE, so five all-green check-runs in a 77-check repo printed "Safe to mark
READY*FOR_REVIEW" and exited 0 — live, twice. The compensating control was a number a human
remembered. Note the shape: every previous generation of this gate closed a \_state* hole and left
the _cardinality_ hole open, because the fixture format could not express a set that changes between
polls. A test format can be a blind spot with the same authority as missing code.

**Guardrail I'd add.** A perturbation that reddens NO fixture is a finding, not a pass. I nearly
shipped two vacuous ones: my first settle-loop fixture passed against a build with the
two-consecutive-snapshot condition deleted (the surviving `-n "$prev_snapshot"` guard already forced
a second poll, so only the read AFTER a change discriminates), and the shrink layer had no fixture
of its own until I built a partial collapse that stays above the derived floor. Run the matrix per
layer, not per feature, and require each layer to own a fixture that reddens for it alone.

## 2026-08-07 · FOLLOW-817 — Modal deploy jobs for intent-engine + data-quality

**Shipped.** Two new `modal-deploy.yml` jobs mirroring `deploy-llm-gateway`'s hard-fail contract;
`paths:` extended to both apps **and to the workflow file itself**; a hard pre-deploy secret-key
gate (`scripts/check-modal-secret-keys.py`); `image=` for the data-quality cron (it had none);
`MODAL_CHAT_NLP_URL` in the local ingest env; §Snapshot.1 B.6 → `CODE_COMPLETE_OPERATOR_PENDING` and
the `stream-consumer` never-deploying decision recorded; ESC-053 filed; FOLLOW-874 filed.

**Where a green badge could have hidden a broken run path — three, all in one ticket.**

1. **The `paths:` filter would have made my own change inert.** Adding a deploy job touches no
   `apps/**` path, so the job would have merged green and never fired until someone happened to edit
   the app it deploys. A workflow whose trigger cannot be fired by the change that adds it is the
   branch-trigger trap (ESC-011) wearing a different hat. Fixed by listing the workflow file in
   `paths:`.
2. **`modal deploy` succeeding says nothing about the deployed app working.** It only registers
   functions. `estalara-secrets` is missing `UPSTASH_REDIS_REST_URL`/`_REST_TOKEN` and
   `DATABASE_URL`, so both apps would have deployed green and then died on every invocation —
   intent-engine inside a `.spawn()` **after** the endpoint returned 202, i.e. with no Sentry event
   and a 200 ingest ACK. I measured that silence on localhost before asserting it.
3. **The data-quality cron declared no `image=`.** Default Modal image, six module-level imports —
   the first scheduled run would have died at container import at 02:00 UTC nightly, into nobody's
   inbox.

**Guardrail I'd add.** _Deploying a service is not a deploy step, it is a deploy step plus a proof
that the runtime dependencies the service READS are present._ Concretely: any CI job that deploys to
a platform with an out-of-band secret store must assert the key inventory of that store against the
non-defaulting `os.environ[...]` / `process.env.X!` reads in the code being deployed, and hard-fail
on a gap — the assert is cheap, and it is the only thing standing between "deploy succeeded" and
"the thing works". Generalises past Modal: same shape as `wrangler secret` vs Worker env, and Vercel
env vs `process.env`.

**Also worth carrying.** `pkill -f <pattern>` inside a Bash tool call matches the invoking shell's
own command line (the pattern text is in it) and kills the call — exit 144, no output, looks like a
hang. Cost me two calls. Use `pgrep | xargs kill` from a script FILE, or split the pattern.

## 2026-08-07 · FOLLOW-893 — absence-of-signal detector for the first-ever `validate_schemas` cron run

**What I shipped.** `cron_heartbeats` (migration 0037) + an unconditional-on-success heartbeat
UPSERT at the end of `validate_schemas`; `scripts/check-cron-heartbeat.sh` asserting the row is
younger than 26h; `.github/workflows/cron-heartbeat.yml` running that assertion daily at 05:00 UTC
against prod and running the script against a throwaway Postgres in five states on every push.
Runbook `docs/runbooks/SCHEMA_VALIDATION_CRON.md` naming the first-run owner and date.

**Where a green badge could have hidden a broken run path.** Two places, both real. (1) Deriving
liveness from `schema_validation_history` would have been the obvious cheap design and it is
silently wrong: `_run_validation()` returns early writing ZERO rows when no active tenant has a site
schema, so a healthy no-op and a job that never started are the same observation. (2) The window
arithmetic — a 26h threshold checked at 03:30 UTC would pass on a missed 02:00 run (25.5h old). The
alarm would have looked identical, run daily, and never fired. Check time and window are one design,
not two settings.

**A guardrail I'd add.** For any dead-man's switch, the PR must state the check time, the schedule
period and the window, and show the arithmetic for the single-miss case. "26h" alone is not a
specification — it is only correct relative to when you look.

**Also.** The negative control ran locally against a docker Postgres before it ever ran in CI; that
caught nothing this time but cost one tool call, versus a push-and-wait loop per case.

## 2026-08-07 · FOLLOW-878 + FOLLOW-891 (staging-plane sweep + §Snapshot.1 deploy-state reconciliation)

**What I shipped.** Corrected 21 artefacts asserting a staging environment that ESC-052 proved does
not exist (Master_Design §V.6.1/§V.6.3, both `wrangler.toml` `[env.staging]` blocks, four workflows,
ten runbook/ops docs, four durable stubs), exempted five with a filed number (FOLLOW-896), and built
`scripts/check-no-staging-plane.sh` — a register-based hard CI gate that fails on a NEW
staging-plane reference **and** on a registered one that vanishes. Separately corrected §Snapshot.1
rows A.1/B.6/D against a freshly executed `modal app list --json` and a read-only
`modal.Function.from_name(...).hydrate()` registration probe.

**Where a green badge could have hidden a broken run path.** Three places, and only one of them was
in the stub. (1) `load-test.yml` offered `staging` as its **default** dispatch target, resolving to
an unprovisioned `INGEST_STAGING_URL`; a run either exported an empty URL or aimed k6 at the
`*.estalara.com` wildcard's Traefik default host — never at Estalara's ingest, and green either way
if you only read the workflow name. (2) `docs/runbooks/secrets.md` instructed every operator to
`doppler secrets set … --config staging`; since `stg` is byte-identical to `prd`, that documented
step writes to **production** while reading as the safe one. (3) The gate I built would have gone
green forever as a zero-count check — the honest shape was a register, because the interesting
failure is not "someone added staging" but "FOLLOW-873 removed the last real one and nobody noticed
the gate had nothing left to assert".

**A guardrail I'd add.** When a sweep's output is a CI gate, the gate must fail on **disappearance**
as well as on addition. A zero-count gate is a badge that gets greener the less it is doing; a
register-diff gate goes red the moment its own subject matter changes, which is exactly when a human
should look. Second, cheaper one: a `find`-based gate that does one `grep` per file per pattern took
80s locally and would have been the slowest job in CI — batch the greps (one process per pattern
over the whole file list) and prune `node_modules`/`.next`/`dist` explicitly, or the gate becomes
the thing people want to delete.

**Verified, not assumed.** `modal app list --json` returns **three** deployed apps, not one; the
deployed `estalara-intent-engine` registers `chat_nlp_endpoint` + `process_chat_message` only, and
`batch_enrich_conversations` raises `NotFoundError` — so §C.3's Sonnet batch tier is not in
production, and the Master_Design row claiming it was the **inverse** of the usual drift: the
executed corpus (`modal-deploy.yml`'s own comment) was right and the source of truth was wrong.

## 2026-08-08 · FOLLOW-900 — the nightly `validate_schemas` cron was dead in prod behind a green deploy

**What I shipped.** `.add_local_python_source(...)` on all three deployed Modal app images
(`apps/data-quality` — the actual defect; `apps/intent-engine` — the same defect, latent, one step
further from view; `apps/llm-gateway` — healthy but only by accident of file layout, now explicit),
`scripts/check-modal-local-imports.py` as a hard CI gate with a self-test, a step in every
`modal-deploy.yml` deploy job, runbook §6, and §Snapshot.1 row B.6 corrected without flipping it.

**Where a green badge hid a broken run path.** Everywhere at once. `modal deploy` only _registers_
functions — it never starts a container, so the deploy job structurally cannot fail on an image that
cannot be imported. `modal app list` said `deployed`, the schedule was registered, the runtime-key
gate passed, and every container died at `from crons.observability import ...` — which is the Sentry
init, so the failure had no channel at all. Modal 1.0 removed automounting; whether an app survives
that removal depends on whether its `@app.function` module has a truthy `__package__`, i.e. on an
invisible property of how the entrypoint happens to be loaded. `apps/llm-gateway` passed for years
on the lucky branch of that coin flip. The one thing that told the truth was an outside observer
(the FOLLOW-893 heartbeat detector) on its first-ever scheduled run.

**A guardrail I'd add.** Beyond the gate shipped here: for any deploy job whose tool only
_registers_ rather than _runs_, the ticket is not done until an automated path has INVOKED the
artefact and read its sink. "Deploy is green" is a claim about a registration API, not about a
process. I also caught myself about to accept `modal run` output alone as AC(3) — the row read from
prod Postgres is the evidence; the run's stdout is just a story about it.

---

## 2026-08-08 · FOLLOW-903 + FOLLOW-904 — hardening a description-axis gate, and adding the axis it can never be on

**What I shipped.** (903) `scripts/check-modal-local-imports.py` rewritten: SHAPE A (a bare sibling
import from a nested entrypoint — `apps/data-quality`'s own layout — which the old gate called
third-party and passed) now fails; declarations are harvested from the entrypoint's REACHABLE file
set instead of an rglob of the whole root, so a throwaway image in an unrelated module or a
`test_*.py` no longer satisfies the gate; `add_local_dir` / `add_local_file(.py)` now SATISFY a
declaration instead of producing a false red with an inverted diagnosis; REGISTRY roots are asserted
against `modal-deploy.yml`'s own `PYTHONPATH`; and `WHAT IS NOT ASSERTED` became a `RESIDUALS`
register the gate prints and the self-test enforces (each residual must name a self-test case that
executed, or an artefact that exists). 21 self-test cases, up from 5. (904)
`scripts/check-modal-container-effect.py` invokes the two deployed Modal apps and asserts an effect
only their own executing code can produce, wired into `cron-heartbeat.yml` (daily) AND
`modal-deploy.yml` (post-deploy), with a 12-case negative control that runs on every push.

**Where a green badge could have hidden a broken run path.** It already was. Four green controls
over the Modal estate and every one of them read the artefact's DESCRIPTION. The sharpest instance:
had I shipped only FOLLOW-903, I would have added a FIFTH description-axis control and closed a
ticket whose whole premise is that the description axis is saturated. The intent-engine probe's
first run was also the first time that app's consumer half has EVER executed in production — its
FOLLOW-900 fix had been "verified" for a day by a green deploy of a function nobody had called.

**A guardrail I'd add.** When a ticket's remedy is "another check", ask what AXIS the existing
checks sit on before writing it. If the new check answers the same question as the old ones (inputs
exist / registration succeeded / source text looks right), it is a fifth opinion, not a second axis.
And `--attempts`-style retries on a post-deploy probe need their own negative-control case: a retry
loop is the cheapest possible way to convert a real outage into a slow green.

---

## 2026-08-08 · FOLLOW-849 (FOLLOW-909 merged in) — the worktree-blind branch guard

**What I shipped.** Two lines of real fix in `.claude/hooks/pre-edit-branch-guard.sh`: HEAD is now
resolved with `git -C <dir-of-the-edited-file>` (walking up to the nearest existing ancestor, so a
`Write` into a not-yet-created directory still resolves) instead of a bare
`git rev-parse --show-toplevel`, which ran in the session's cwd — the main checkout — and reported
`HEAD == 'main'` to every agent working inside `.claude/worktrees/*`. Six independent workers hit it
across four sessions. The deliverable is the other file:
`scripts/__tests__/pre-edit-branch-guard.test.sh`, 20 assertions, red-first (8 failures against the
pre-fix script, 0 after), wired into the existing `shellcheck (Sentry gate family)` CI job so it is
executed on every push, not merely present.

**Where a green badge could have hidden a broken run path.** In the fix itself, twice. (1) The
cheapest way to "fix" this guard is to make it quiet — anything from "if the path contains
`.claude/worktrees`, allow" upward passes a fixture set drawn from the reported bug's own shape and
guts the control. The case that catches it is a worktree whose own HEAD is `master`: the guard must
still fire there, and a path-shortcut fix cannot. (2) The walk-up-to-an-existing-ancestor step is
itself a silent hole if it lands on the wrong tree — a new-file `Write` on `main` would go
unguarded, and no fixture drawn from the bug report would have noticed, because the bug report was
about existing files. Both cases are in the harness. Separately: the pre-fix guard was ALSO wrong in
the inverse direction, silently — cwd inside a worktree, edit landing on `main` produced no warning
at all, which is a false negative on the exact stranded-work failure the guard exists to catch. Six
people reported the noisy half; nobody reported the silent half, because nobody sees a warning that
does not appear.

**A guardrail I'd add.** A non-blocking guard whose false positives land only on actors who cannot
change it has no repair path — the cost is paid by everyone and the fix is owned by no one. When a
warning is advisory, route it to someone with commit rights over the guard (or count it), otherwise
"agents learned to ignore it" is the design, not the accident. Second: a hook is a shell control
like any other, and until this ticket no automated path linted or executed a single file in
`.claude/hooks/`. Anything that runs on every tool call deserves the same lint-and-fixture treatment
as `scripts/check-*.sh`.

- **2026-08-21 · FOLLOW-817 (third dispatch)** · **What I shipped:** nothing executable — all seven
  ACs were already true at HEAD; PR #691 shipped them on 2026-08-07 and FOLLOW-891/892/893/900/904
  hardened them five times since. I re-verified each AC by execution and recorded the result in
  HANDOFFS so it isn't dispatched a fourth time. · **Where a green badge could have hidden a broken
  run path:** two places, and one of them was mine. (a) `cron-heartbeat.yml`'s prod job sits behind
  a `DOPPLER_TOKEN_PRD` skip gate, so six days of green `schedule` runs were compatible with the
  check never having run — resolved only by reading the _step_ conclusion (`success`, not
  `skipped`), never the job's. (b) I misread `check-cron-heartbeat.sh` as exit 0 while it printed
  `ALARM`, because I piped it into `tail` and captured the pipe's status; the script was correct and
  I was wrong. · **A guardrail I'd add:** when a brief's named reading anchors don't exist at HEAD
  (here: a CLAUDE.md section and a HANDOFFS heading, both absent), treat that as a stale-brief
  signal and re-verify the ACs BEFORE writing anything — re-implementing this ticket would have
  reverted the FOLLOW-900 local-source gate that exists precisely because the original deploy
  shipped green over an unimportable image.

## 2026-08-24 · FOLLOW-1087 + FOLLOW-1088 (+ FOLLOW-1083 folded in)

**Shipped.** Made `Rule J`'s signature arm fail CLOSED. `extract-fn-signature.cjs` now exits **3**
for "function not found" — 1 belongs to node's own bootstrap failures, and the collision was the
whole bug. The gate resolves the extractor from `$(dirname "$SELF")/lib/`, preflights it (file
present + `typescript` resolvable) before the pair loop when a subject exists, and treats any exit
outside `0/2/3` as `SIGNATURE EXTRACTOR UNAVAILABLE` → exit 2. Helper names moved from a file-level
constant to a per-pair `helpers: []` field; no list, or a declared name absent from the canonical,
is now a FAIL. Added a P2 subject/comparison count line, register entries C4/G/H, re-scoped C3,
re-derived entry F's tripwire (9 → 11 sites), and 7 new self-test steps (13 → 20 assertions).

**Where a green badge could have hidden a broken run path.** It already did, for two PRs: with a
real divergence registered, deleting the extractor or removing `node_modules` produced a
MODULE_NOT_FOUND stack trace, three `INFO: … not found in canonical — skipping.` lines,
`OK: all required helper functions present in mirror, signatures match.` and **exit 0**. The trace
was printed and ignored — loud, not silent, and still green. Second shape: after PR #839 emptied the
subject set, the gate's output lost all three signature lines and its verdict did not change, so a
green required check could not be distinguished from one that compared nothing.

**Guardrail I'd add.** When a helper script and its caller communicate by exit code, the helper must
never use **1** for a semantic outcome — 1 is the interpreter's. And a control whose subject set can
reach zero must print the subject COUNT on every run; "no output" is not a verdict. Corollary
learned the hard way twice this ticket: a self-test that greps for a phrase will match the gate's
own remediation prose — assert on the exact success line, with `grep -F`.

- **2026-09-14 / FOLLOW-1132** · Shipped: `turbo.json` env declarations under strict envMode (`dev`
  passThroughEnv `*`, `test` hashed gate env, control-plane `build` Sentry env), runbook §3.5.1. ·
  Green badge hiding a broken run path: through Turbo, `REQUIRE_*=1` was stripped and the live
  smokes reported `skipped`, exit 0; the same command without Turbo exits 1. CI was immune only
  because every env-gated CI step already bypasses Turbo. Root `pnpm dev` also dies on a wrangler
  inspector-port `:9229` collision. · Guardrail I would add: a CI step that runs
  `REQUIRE_REDIS_SMOKE=1 pnpm turbo run test --filter=@estalara/integration-smoke` without
  credentials and asserts a NON-zero exit, so a future turbo.json edit cannot silently re-strip the
  gates.
