# DevOps Engineer — Lessons

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
