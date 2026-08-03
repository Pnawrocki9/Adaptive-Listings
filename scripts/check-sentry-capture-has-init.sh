#!/usr/bin/env bash
# Sentry capture-has-init guard — the INVERSE invariant (FOLLOW-743).
#
# WHY THIS GUARD EXISTS
# ─────────────────────
# scripts/check-sentry-init-singleton.sh asserts "zero bare sentry_sdk.init(
# call sites outside observability.py" — it protects the SHAPE of an init that
# already exists. It is structurally blind to a module that never had an init
# at all: a file with zero `sentry_sdk.init(` occurrences trivially satisfies
# "zero bare init sites" while its own `capture_message`/`capture_exception`
# call is a permanent no-op (no bound Sentry client in that process).
#
# FOLLOW-743 found exactly this: `apps/llm-gateway/src/jobs/generate_description.py`
# called `sentry_sdk.capture_message(...)` on the daily LLM spend-cap alarm
# with no `init_sentry(` (and no `sentry_sdk.init(` either) anywhere in the
# module — invisible to check-sentry-init-singleton.sh by construction. This
# script is the sibling gate that closes that blind spot: it asserts the
# INVERSE — every module that CAPTURES must also INITIALISE.
#
# WHAT IS DETECTED
# ────────────────
# Python files under apps/*/src (excluding real test-file-convention names —
# `test_*.py`, `*_test.py`, `conftest.py` — matched by anchored pattern, not
# substring, so a production module like `latest_pricing.py` or `contest.py`
# is still scanned; FOLLOW-757 AC2):
#   A file containing a real `sentry_sdk.capture_exception(` or
#   `sentry_sdk.capture_message(` call must also contain a real
#   `init_sentry(` call somewhere in the SAME file.
#
# "Real" (FOLLOW-757 AC1) means: appears in actual code, not inside a
# whole-line comment, a trailing comment, or a string literal/docstring. A
# docstring that merely *mentions* `init_sentry("SENTRY_DSN")` as documentation
# must NOT clear a real, unserved capture call, and neither must a trailing
# comment (`# TODO: restore the init_sentry( call`) — both were measured false
# negatives (RETRO-237 §4b CB-1 / §4c TG-2, the latter inherited from
# check-sentry-init-singleton.sh's own comment-filter bug, inverted here to
# fail SILENTLY instead of loudly). Both the detection (capture) side and the
# clearance (init_sentry) side are put through the SAME comment/docstring/
# string-literal stripping pass (`clean_python_source` — shared via
# scripts/lib/clean-python-source.sh with check-sentry-init-singleton.sh since
# FOLLOW-746 item 8) so the two halves cannot drift apart again.
#
# There is no `observability.py` basename exclusion (FOLLOW-757 AC3 removed
# it): the three registered helper mirrors (scripts/mirror-files.json —
# apps/intent-engine/src/observability.py and its two Rule-J mirrors) contain
# zero `sentry_sdk.capture_exception(`/`capture_message(` call sites — verified
# empirically, not assumed — so scanning them costs nothing, and a basename
# exclusion previously would have silently skipped ANY file named
# observability.py, registered or not (a 4th, unregistered copy).
#
# EXPECTED COUNT: exactly 0 violations AND 0 unparseable files.
#   Every file with a capture call must also carry an init_sentry(...) call
#   in that same file (the init may be a no-op at runtime if SENTRY_DSN is
#   unset — that is fine; this guard only checks the CALL SHAPE is present,
#   the DSN-gating behaviour itself is covered by init_sentry()'s own tests).
#   A file `python3 tokenize` cannot process counts as its own finding (see
#   "UNPARSEABLE FILES" below, FOLLOW-760) — it is never silently treated as
#   clean.
#
# ALLOWLIST
# ─────────
# If a capture call is deliberately served by an init in a DIFFERENT process
# entry point (rare — document why), suppress it with an inline comment on
# the same line as the capture call:
#
#   sentry_sdk.capture_message(...)  # sentry-init-guard: allowlisted — <reason>
#
# The comment MUST contain the literal string "sentry-init-guard: allowlisted",
# and it MUST be a real Python comment (FOLLOW-768 AC1). The annotation is
# located by scanning the file's `tokenize.COMMENT` tokens — NOT by matching the
# original, uncleaned line, which is what the pre-FOLLOW-768 script did. The
# requirement that made raw matching tempting is real (a CLEANED line can never
# contain the annotation, because the cleaner blanks comments), but "anywhere on
# the raw line" is strictly wider than "in a comment", and the difference was a
# silent false GREEN: the token inside a STRING LITERAL on a capture line
# cleared a real, unserved capture. See `_allowlist_comment_lines` below.
#
# ALLOWLIST INVENTORY — AND ITS CONSUMER (FOLLOW-759)
# ───────────────────────────────────────────────────
# Every run of the real check (not just violations) prints an ALLOWLIST
# INVENTORY: one line per SCANNED file carrying at least one
# `sentry-init-guard: allowlisted` annotation, with that file's occurrence
# count. FOLLOW-757 AC5 shipped this as a bare printed number and NOTHING read
# it — no baseline, no annotation, no threshold — so it landed in the log of a
# GREEN job, and nobody opens a green job's log. The gap had moved one hop
# ("invisible unless you grep the source" → "invisible unless you open a
# passing job's log") rather than closed: a HALF_WIRE_P under Rule AJ.
#
# The consumer is now a COMMITTED BASELINE,
# scripts/baselines/sentry-capture-allowlist.baseline (override:
# SENTRY_CAPTURE_ALLOWLIST_BASELINE), compared by the shared helper
# scripts/lib/suppression-baseline.sh — the SAME helper
# check-sentry-init-singleton.sh uses for its own (whole-file) suppression set,
# because the two inventories differ only in what an entry is. A baseline is the
# right consumer because it converts silent growth into a RED gate: adding an
# allowlist annotation fails CI until the baseline is updated in the same PR,
# where a human reads the added line and its reason. The weaker option (a
# `::notice::` annotation) was rejected: it still leaves the signal unread on a
# green run, which is the defect being fixed.
#
# Entries are per-FILE counts, not `file:line` — line numbers churn on every
# unrelated edit above an annotation, and a gate that reddens on changes that
# alter no suppression trains people to route around it.
#
# REGION (Rule AL, FOLLOW-759 AC3). The inventory is built by iterating exactly
# the `$FILES` list the gate scans, NOT by re-globbing the scan dirs. The
# original `grep -rn ... "${SCAN_DIRS[@]}"` had no `--include=*.py` and no
# test-file exclusion, so it over-counted (annotations in `test_*.py`, `.md`,
# fixtures — files this gate never honours) and under-counted (nothing outside
# `apps/*/src`) simultaneously. Sharing the one `$FILES` list makes the two
# regions structurally incapable of drifting apart — the same drift-proofing
# FOLLOW-757 applied to the detection/clearance pair.
#
# DEFINITION, not just region (Rule AL, FOLLOW-768 AC6). Sharing the file list
# is half of it; the two must also agree on what an ENTRY is. FOLLOW-759 counted
# raw per-file occurrences and the clearance predicate matched raw lines, so
# they agreed by accident. Moving clearance onto comment tokens (AC1) and
# leaving the inventory on `grep -c` would have split them: a token inside a
# string literal would be COUNTED into the reviewed baseline while SUPPRESSING
# NOTHING. Both halves now call the one function, `_allowlist_comment_lines`.
# The real-tree count is unchanged by the move (0 occurrences before and after),
# so scripts/baselines/sentry-capture-allowlist.baseline is untouched.
#
# SCAN DIR
# ────────
# Parameterised via SENTRY_CAPTURE_INIT_TARGET (default: apps/*/src in repo
# root). The --self-test mode points this env var at a temp directory so the
# detector can be verified without touching the real source tree.
#
# KNOWN, DELIBERATELY UNGUARDED GAPS — Rule AP RESIDUAL REGISTER (executed)
# ─────────────────────────────────────────────────────────────────────────────
# This section is NOT prose. Every entry below is a row of the
# RESIDUAL_REGISTER array further down, and the gate EXECUTES every entry's
# latency proof on every run, printing one status line per entry. Per entry:
#
#   EVERY pipe stage exits 0 or 1,
#     EMPTY stdout                    → LATENT   (documented, still not real)
#   EVERY pipe stage exits 0 or 1,
#     stdout output                   → GONE LIVE → gate FAILS with exit 3,
#                                       naming the entry id — a diagnosis
#                                       DISTINCT from an ordinary finding (1)
#   ANY pipe stage exits >= 2, or the
#     proof cannot run at all         → gate FAILS with exit 2. A residual
#                                       whose proof cannot be evaluated is
#                                       never "assumed still latent"
#                                       (the FOLLOW-760 contract, applied to
#                                       the register itself)
#
# PER-STAGE PROOF STATUS — why `pipefail` alone is NOT enough
# ─────────────────────────────────────────────────────────────────────────────
# Proofs run under `bash -o pipefail -c`, so a failing producer inside a pipe
# cannot silently yield status 0. That is necessary but NOT sufficient, and
# FOLLOW-770's first cut of this mechanism got it wrong: `pipefail` reports the
# status of the RIGHTMOST command that exited non-zero — not the first, and not
# the worst. Entries A/D/E/F/H chain a producer into a SECOND `grep`, and `grep`
# exits 1 ("no match") on the now-empty input a dead producer leaves behind, so
# the pipeline reports 1, a `>= 2` test does not fire, and a genuinely dead
# producer is classified `latent` — the reassuring direction Rule AP clause 2
# exists to forbid, reproduced inside clause 2's own enforcement mechanism.
# The runner below therefore records ${PIPESTATUS[@]} — every stage's OWN exit
# status — for each proof, and treats ANY stage exiting >= 2 as UNEVALUABLE
# regardless of what later stages did. It is COPIED VERBATIM from
# scripts/check-mirror-files.sh (FOLLOW-770 fix-iteration 1), variable names
# included, so the two diff to zero; see that file for the full writeup.
# Each proof is evaluated over the SAME region as the control it describes
# (Rule AL); the region is named in the entry. Retiring an entry requires the
# fix that closes it in the same PR (Rule AP clause 5).
#
# CONTROLS (predicates) in this gate → the entries that bound each. Rule AE
# is re-answered here against the THREE-predicate framing (FOLLOW-768 AC4):
# detection, init-clearance and allowlist-clearance are three separate
# predicates, and until FOLLOW-768 only the first two ran against cleaned
# source. All three now do.
#   P1 capture detection        (cleaned source)      → A, B, C
#   P2 init clearance           (cleaned source)      → F
#   P3 allowlist clearance      (COMMENT tokens)      → D
#   P4 allowlist inventory + baseline (COMMENT tokens)→ D, E
#   P5 unparseable-file finding (FOLLOW-760)          → see P5 note below
#   P6 shared-helper availability guards              → G
#   P7 this register's own runner                     → H
# Rule AP clause 3: a PR that adds a predicate to this gate MUST add that
# predicate's OWN entry here — its region, its scan root, and what it does when
# its input is unavailable. It may not lean on an entry written about another
# predicate.
#
# IS THE CLASS FULLY ENUMERATED (Rule AE-as-amended)? For P3 — the predicate
# this ticket fixed — YES: clearance now accepts the token from exactly one
# region (a COMMENT token), and the two shapes that region excludes (string
# literal, ordinary code) are both fixtured red-first. For P1 the answer is
# still NO and entry C names why (the aliased/`from`-import shape, FOLLOW-760
# CB-3, deliberately deferred: distinguishing a real bare `capture_exception(`
# call from an unrelated same-named function is a second axis of work). The
# honest summary is therefore "P3 enumerated-and-guarded; P1 partially
# enumerated, and entry C is the named remainder".
#
#   A. [P1] SCAN_DIRS is only "$ROOT"/apps/*/src — a capture site under
#      packages/, scripts/, tests/integration/ or apps/*/tests/ is unscanned.
#      Region: the COMPLEMENT of the scan region — tracked `*.py` files at
#      $ROOT that are not under `apps/*/src` (in a
#      SENTRY_CAPTURE_INIT_TARGET run the complement is empty BY CONSTRUCTION,
#      because SCAN_DIRS is the whole scan root, and the proof reads
#      /dev/null). Scan root: $ROOT.
#      UNAVAILABLE INPUT: if `git ls-files` cannot be read the gate exits 2
#      before the register runs ("REGISTER SOURCE UNAVAILABLE") rather than
#      evaluating this proof over an empty — i.e. reassuring — region. That is
#      the FOLLOW-770 lesson applied here pre-emptively.
#   B. [P1] `for f in $FILES` is unquoted word splitting — a filename
#      containing IFS whitespace would break the scan loop AND every proof
#      below that word-splits the same list.
#      Region: $FILES itself, i.e. exactly the list the loop iterates.
#   C. [P1] (FOLLOW-760 CB-3, DEFERRED.) The detection regex requires the
#      literal `sentry_sdk.` prefix. A module using
#      `from sentry_sdk import capture_exception` (or `import sentry_sdk as
#      <alias>`) and calling the bare name is INVISIBLE — false GREEN if it
#      also lacks init_sentry(. Same residual as
#      check-sentry-init-singleton.sh's entry B; fixing it belongs in ONE
#      ticket covering both gates.
#      Region: $FILES (import lines in the scanned set).
#   D. [P3 + P4 — ONE definition since FOLLOW-768 AC6] The annotation is
#      honoured only on the capture call's OWN line, while the inventory counts
#      it anywhere in a scanned file. So an annotation comment on a non-capture
#      line is COUNTED into the reviewed baseline and clears nothing; that
#      includes a continuation line of a multi-line capture call, where the
#      effect is a false RED (loud) rather than a false GREEN.
#      Region: $FILES, both halves. Scan root: $SCAN_ROOT.
#      UNAVAILABLE INPUT: a file python3 cannot tokenize contributes no
#      inventory entry and no clearance; it cannot hide a green run, because the
#      violation loop iterates the SAME $FILES and reports that identical file
#      as an UNPARSEABLE finding (exit 1). Both halves of P3/P4 fail closed.
#   E. [P4] The baseline records per-file occurrence COUNTS and paths — not
#      line numbers and not the `— <reason>` text. Moving an annotation within
#      a file, or rewriting its reason, does not trip the baseline; adding,
#      removing or relocating one across files does. The proof goes live on an
#      annotation whose reason is missing or under 20 characters, which is the
#      observable form of "the reason is not reviewed by the mechanism".
#      Region: $FILES.
#   F. [P2] Init clearance is a textual, FILE-scoped `init_sentry\(` match on
#      cleaned source. A `def init_sentry(` DEFINITION — or an unrelated call
#      of a same-named local function — clears every capture in that file.
#      Region: $FILES, minus the three registered hardened-helper mirrors
#      (basename `observability.py`), which legitimately define it.
#   G. [P6] The two shared-helper guards check PRESENCE and `declare -F`, never
#      BEHAVIOUR. A helper that loaded, defined the name and returned raw
#      source would pass both. Semantics are guarded separately and twice, by
#      each gate's own untokenizable fixture; the proof here watches the
#      helper's exit-3 contract, whose removal is what a raw-source fallback
#      would look like. Region: scripts/lib/clean-python-source.sh.
#      (FOLLOW-759 item 11 — "neither hard-fail has a fixture" — is CLOSED by
#      FOLLOW-769 in this same PR: four fixtures, two helpers x two shapes.
#      Retired as a diff, not a deletion, per Rule AP clause 5.)
#   H. [P7] Register entries are hand-written: a failure accumulator added to
#      this gate without a matching entry is invisible to the register. The
#      proof counts this script's `*_COUNT=0` / `*_MISMATCH=0` accumulators and
#      goes live when the number differs from the 3 this register was written
#      against. Region: this script.
#   P5 note (unparseable-file finding): P5 has no entry of its own by design —
#      it is not a residual but the FAIL-CLOSED behaviour that bounds P1/P2/P3/
#      P4's unavailable-input case, and it is stated inside entry D. A file it
#      fires on always fails the gate (exit 1), so there is no latent-vs-live
#      question to prove.
#   Retired in this PR (Rule AP clause 5 — with the fix, not silently):
#      FOLLOW-759 item 9 ("the inventory greps RAW file text … FOLLOW-768 owns
#      moving clearance onto cleaned text; when it does, this inventory must
#      move with it in the same PR") — done, both halves now share
#      `_allowlist_comment_lines`, and the real-tree count is unchanged at 0.
#      FOLLOW-759 item 11 (unfixtured helper hard-fail) — done, see G.
#   Not fixed here (out of this PR's AC): A, B, C, D, E, F, G, H remain open by
#   design and are now MACHINE-CHECKED rather than asserted in prose.
#
# SELF-TEST
# ─────────
# bash scripts/check-sentry-capture-has-init.sh --self-test
#
# Includes a NEGATIVE CONTROL fixture (a capture-without-init module) that
# reproduces the exact shape FOLLOW-743 found, PLUS one fixture per FOLLOW-757
# false-negative shape (docstring-clear, trailing-comment-clear, substring
# test-name skip, unregistered observability.py) — each asserts the FIXED
# script now correctly flags the violation. Run against the PRE-FOLLOW-757
# script, all four new fixtures instead PASS (clear) — see the PR body for
# the pasted before/after transcript. PLUS one fixture for FOLLOW-760 CB-1 (a
# file that FAILS TO TOKENIZE, containing a docstring-only `init_sentry(`
# mention and a real capture call) — asserts the FIXED script reports it as a
# LOUD, distinctly-tagged "UNPARSEABLE" finding rather than silently clearing
# it via the raw-text fallback. Run against the PRE-FOLLOW-760 script, this
# fixture instead PASSES (clear) — see the PR body for the pasted
# before/after transcript. PLUS four fixtures for FOLLOW-759: (a) a scanned
# file with ONE allowlisted capture is inventoried as exactly 1 occurrence;
# (b) that same tree against a zero-entry baseline is a LOUD, distinctly
# diagnosed failure (against the pre-FOLLOW-759 script it exits 0 — the silent
# growth this ticket closes); (c) a MISSING baseline fails the gate rather than
# soft-passing; (d) an allowlist annotation inside an EXCLUDED file
# (`test_*.py`, `.md`) is NOT counted — against the pre-FOLLOW-759 script the
# raw `grep -rn` counted both. Every self-test run is pointed at a TEMP
# baseline, never the repo's committed one. All exit-code assertions check the
# SPECIFIC expected code (1 for a detected violation/unparseable/baseline
# finding), not merely non-zero (FOLLOW-760 AC3).
#
# PLUS, in this PR: one fixture for FOLLOW-768 CB-1 (the allowlist token inside
# a STRING LITERAL on a capture line, in a file with no init_sentry() — asserts
# it is now an ordinary VIOLATION and, per AC6, is NOT counted into the
# allowlist inventory either. Against the pre-FOLLOW-768 script it exits 0, a
# silent false GREEN. PLUS four fixtures for FOLLOW-769 AC1/AC2: each of the two
# shared helpers under scripts/lib/, in each of its two failure shapes (file
# missing / file present but defining nothing), asserted to exit 2 with the
# specific diagnosis — run against a COPY of this gate placed in a temp
# directory, so SCRIPT_DIR resolves to a tree whose lib/ we control. Against the
# pre-FOLLOW-769 script the guards exist but nothing exercises them; the
# fixtures fail closed if a future edit "simplifies" either guard away. PLUS one
# Rule AP fixture: an annotation with a one-character reason makes entry [E]'s
# latency proof return a hit, and the gate must exit 3 with a GONE LIVE
# diagnosis naming [E] while every ordinary check stays clean (baseline matched
# on purpose, so the exit code can only come from the register). Against the
# pre-register script that fixture exits 0.
#
# PROOF OF EXECUTION (Rule Q). `--self-test` is not decorative here: it is its
# own step in the `sentry-init-singleton` / `sentry-capture-has-init` jobs of
# .github/workflows/ci.yml, run immediately before the real check on every push
# and PR. Every fixture above therefore executes in CI on this PR — see the
# green run linked in the PR body, not merely a local transcript.
#
# EXIT CODES
# ──────────
#   0 = pass (every capture-containing file also has an init_sentry( call, or
#       is explicitly allow-listed, AND every scanned file tokenized cleanly,
#       AND the allowlist inventory matches its committed baseline)
#   1 = violation — ANY of: a capture call with no init_sentry( in the same
#       file and not allow-listed; a file whose capture/init shape could
#       not be verified because python3 could not tokenize it (FOLLOW-760:
#       a gate that cannot evaluate a file must not report it clean, so this
#       is a hard failure by default, printed under its own distinct
#       "UNPARSEABLE" heading so it is never confused with an ordinary
#       capture-without-init violation); or the allowlist inventory differs
#       from scripts/baselines/sentry-capture-allowlist.baseline in either
#       direction (FOLLOW-759 — an unreviewed suppression change), also under
#       its own heading
#   2 = the gate itself is broken: a self-test failure, a shared helper under
#       scripts/lib/ missing or defining nothing, a Rule AP register latency
#       proof that could not be evaluated (ANY pipe stage exiting >= 2), or the
#       register's own region source being unreadable. Never a verdict on the
#       tree.
#   3 = a Rule AP REGISTER ENTRY HAS GONE LIVE — a gap this script's register
#       says is latent is now real. Distinct from 1 on purpose: the gate
#       worked, and what changed is the documented residual, not the scanned
#       code.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Shared helper: comment/docstring/string stripper ─────────────────────────
# `clean_python_source()` strips whole-line comments, trailing comments AND
# string literals/docstrings from a Python file, replacing each stripped token
# with same-width whitespace so line numbers (and column offsets) are
# preserved. This is what makes both the capture-detection and init-clearance
# regexes see only real code (FOLLOW-757 AC1).
#
# FOLLOW-746 item 8: this function used to be a ~50-line `python3 tokenize`
# heredoc embedded HERE. FOLLOW-746 needed the same pass in
# check-sentry-init-singleton.sh, so rather than create a third unregistered
# duplicate of shared logic in the Rule J / K.1 gap, it was extracted to
# scripts/lib/clean-python-source.sh and is now SOURCED by both gates — one
# definition, drift structurally impossible. The full decision record (and why
# a mirror-files.json pair was rejected) is in that file's header.
#
# FOLLOW-760 CB-1 behaviour is UNCHANGED and preserved in the shared copy: on a
# tokenizer failure the helper writes NOTHING to stdout and exits 3; it must
# NOT fall back to the raw, uncleaned file (that would silently revert BOTH
# regexes to raw-text matching, so a docstring/comment mention of
# `init_sentry(` would clear a real, unserved capture again). `_check_file`
# below distinguishes "cannot evaluate this file" (exit 3) from "evaluated, no
# violation" (exit 0 with cleaned content) and reports the former as its own
# LOUD, counted "UNPARSEABLE" finding.
#
# A missing helper fails this gate with exit 2 — it never degrades to raw-text
# matching.
CLEAN_LIB="$SCRIPT_DIR/lib/clean-python-source.sh"
if [[ ! -f "$CLEAN_LIB" ]]; then
  echo "FAIL: shared helper not found: $CLEAN_LIB"
  echo "This gate cannot evaluate Python sources without it, and must NOT fall"
  echo "back to raw-text matching (FOLLOW-746 item 8 / FOLLOW-760)."
  exit 2
fi
# shellcheck source=lib/clean-python-source.sh
source "$CLEAN_LIB"
if ! declare -F clean_python_source > /dev/null 2>&1; then
  echo "FAIL: $CLEAN_LIB did not define clean_python_source()."
  exit 2
fi

# ── Shared helper: suppression-baseline comparator (FOLLOW-759 / FOLLOW-765) ──
# Gives the allowlist inventory a CONSUMER. Shared with
# check-sentry-init-singleton.sh (which baselines its registered-mirror
# exclusion set with the same function) so the two gates cannot grow two
# divergent notions of "a suppression set changed" — the full rationale is in
# that helper's header. Missing helper = exit 2; this gate must never skip the
# comparison and report a green.
BASELINE_LIB="$SCRIPT_DIR/lib/suppression-baseline.sh"
if [[ ! -f "$BASELINE_LIB" ]]; then
  echo "FAIL: shared helper not found: $BASELINE_LIB"
  echo "This gate cannot verify its allowlist inventory against the committed"
  echo "baseline without it, and must NOT skip the comparison (FOLLOW-759)."
  exit 2
fi
# shellcheck source=lib/suppression-baseline.sh
source "$BASELINE_LIB"
if ! declare -F compare_suppression_baseline > /dev/null 2>&1; then
  echo "FAIL: $BASELINE_LIB did not define compare_suppression_baseline()."
  exit 2
fi

# ── Allowlist annotation locator (FOLLOW-768 AC1/AC6) ────────────────────────
# THE ONE DEFINITION of "an allowlist entry", shared by the clearance predicate
# (_check_file, below) and the inventory that feeds the committed baseline. It
# emits the 1-based line numbers on which the allowlist token appears INSIDE A
# REAL PYTHON COMMENT — i.e. inside a `tokenize.COMMENT` token — one per line.
#
# WHY NOT RAW TEXT (the FOLLOW-768 CB-1 defect). Both halves used to match the
# file's raw, uncleaned text. The requirement behind that choice is real — the
# cleaner blanks comments, so a CLEANED line can never contain the annotation,
# and the clearance test has to see the annotation — but "raw text" is a strictly
# wider region than "in a comment", and the difference is a false GREEN:
#
#   sentry_sdk.capture_exception(RuntimeError("sentry-init-guard: allowlisted — x"))
#
# in a file with no `init_sentry(` was silently CLEARED. That is the FOLLOW-757
# defect class verbatim (a raw-text mention clearing a real, unserved capture)
# surviving in the one predicate FOLLOW-757 and FOLLOW-760 left uncleaned.
#
# The fix is a narrower REGION, not a wider regex (FOLLOW-768 AC1): the token is
# accepted only from a span `clean_python_source` blanks AS A COMMENT. A
# COMMENT-token scan expresses exactly that and, unlike diffing cleaned-vs-
# original columns, cannot confuse a comment with a string literal — the cleaner
# blanks BOTH, so a column diff would have re-admitted the string-literal case
# this ticket exists to close.
#
# Exit 3 (no stdout) when python3 cannot tokenize the file — the same contract
# clean_python_source uses, so a file that cannot be evaluated is never reported
# as "no annotations".
ALLOWLIST_TOKEN="sentry-init-guard: allowlisted"

_allowlist_comment_lines() {
  python3 - "$1" "$ALLOWLIST_TOKEN" <<'PYEOF'
import io
import sys
import tokenize

path, token = sys.argv[1], sys.argv[2]

try:
    with open(path, "rb") as f:
        raw = f.read()
    found = []
    for tok in tokenize.tokenize(io.BytesIO(raw).readline):
        if tok.type == tokenize.COMMENT and token in tok.string:
            found.append(tok.start[0])
    sys.stdout.write("".join(f"{n}\n" for n in found))
except Exception as exc:
    print(f"allowlist tokenize error on {path}: {exc}", file=sys.stderr)
    sys.exit(3)
PYEOF
}

# Scans a single file and echoes a two-part report if it needs one, else
# nothing. First line of any output is a tag ("VIOLATION" or "UNPARSEABLE",
# FOLLOW-760) that the caller uses to sort the finding into the right
# section of the report — the two are never merged into one undifferentiated
# blob, so an unparseable-file finding cannot be misread as an ordinary
# capture-without-init violation or vice versa.
#
#   VIOLATION   — a real capture_exception(/capture_message( call with no
#                 init_sentry( call anywhere in the file, and the capture
#                 line(s) are not all allow-listed.
#   UNPARSEABLE — `python3 tokenize` could not process this file, so its
#                 capture/init shape could NOT be verified at all (FOLLOW-760
#                 CB-1). Treated as its own finding rather than silently
#                 cleared or silently passed.
_check_file() {
  local file="$1"
  local cleaned
  local clean_rc=0

  # `clean_python_source` exits non-zero (no stdout) when python3 cannot
  # tokenize the file. Capture that via `||` (not a bare assignment) so a
  # non-zero exit does not trip `set -e` — this is "cannot evaluate", not a
  # crash, and must be reported as its own finding, not swallowed.
  cleaned=$(clean_python_source "$file") || clean_rc=$?

  if [[ "$clean_rc" -ne 0 ]]; then
    echo "UNPARSEABLE"
    echo "$file"
    echo "  python3 could not tokenize this file (exit $clean_rc) — its"
    echo "  capture/init call shape could NOT be verified. Treated as a"
    echo "  finding, not silently cleared (see stderr above for the tokenizer"
    echo "  error, and FOLLOW-760 for why this is not a soft-pass)."
    return 0
  fi

  # Line numbers of REAL (non-comment, non-string) capture call sites.
  local capture_line_nums
  capture_line_nums=$(
    echo "$cleaned" | grep -nE "sentry_sdk\.(capture_exception|capture_message)\(" | cut -d: -f1
  )
  [[ -z "$capture_line_nums" ]] && return 0

  # Line numbers carrying the allowlist token inside a REAL COMMENT
  # (FOLLOW-768 AC1) — never inside a string literal, a docstring, or ordinary
  # code. `clean_python_source` already succeeded above, so a tokenize failure
  # here is anomalous; it is reported as UNPARSEABLE rather than treated as
  # "this file has no annotations" (which would silently re-open the very hole
  # this predicate closes).
  local allow_lines=""
  local allow_rc=0
  allow_lines=$(_allowlist_comment_lines "$file") || allow_rc=$?
  if [[ "$allow_rc" -ne 0 ]]; then
    echo "UNPARSEABLE"
    echo "$file"
    echo "  python3 could not tokenize this file for allowlist annotations"
    echo "  (exit $allow_rc) — its allowlist clearance could NOT be verified."
    echo "  Treated as a finding, not silently cleared (FOLLOW-768 AC1 applies"
    echo "  the FOLLOW-760 contract to the clearance predicate too)."
    return 0
  fi

  # Drop any capture line explicitly allow-listed by a COMMENT on that line,
  # then re-attach the survivors to their ORIGINAL (uncleaned) line for display.
  local unallowlisted=""
  local ln orig_line
  while IFS= read -r ln; do
    [[ -z "$ln" ]] && continue
    if [[ -n "$allow_lines" ]] && printf '%s\n' "$allow_lines" | grep -qx -- "$ln"; then
      continue
    fi
    orig_line=$(sed -n "${ln}p" "$file")
    unallowlisted="${unallowlisted}${ln}:${orig_line}"$'\n'
  done <<< "$capture_line_nums"
  [[ -z "$unallowlisted" ]] && return 0

  # A real (non-comment, non-string) init_sentry( call anywhere in the same
  # file clears it.
  if echo "$cleaned" | grep -nE "init_sentry\(" | grep -q .; then
    return 0
  fi

  echo "VIOLATION"
  echo "$file"
  # shellcheck disable=SC2001  # prefixing every line of a multi-line string;
  # a parameter-expansion replacement cannot anchor to line starts here.
  echo "$unallowlisted" | sed 's/^/  /'
}

# ── Self-test mode ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--self-test" ]]; then
  echo "=== Self-test mode ==="
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT

  mkdir -p "$tmp_dir/app-a/src/jobs"

  # Every fixture run below is pointed at a TEMP allowlist baseline, so the
  # self-test never compares a fixture tree against the repo's real committed
  # baseline (FOLLOW-759). Exported once: `bash "$0"` inherits it.
  st_baseline="$tmp_dir/allowlist.baseline"
  export SENTRY_CAPTURE_ALLOWLIST_BASELINE="$st_baseline"

  # _st_write_baseline <count> [entry ...]
  _st_write_baseline() {
    local n="$1"
    shift
    {
      echo "# self-test temp baseline"
      echo "count: $n"
      local e
      for e in "$@"; do echo "$e"; done
    } > "$st_baseline"
  }
  _st_write_baseline 0

  # ── Negative control: capture-without-init (the exact FOLLOW-743 shape) ──
  cat > "$tmp_dir/app-a/src/jobs/rogue_capture.py" <<'PYEOF'
import sentry_sdk

def _spend_cap_exceeded():
    try:
        sentry_sdk.capture_message("daily spend cap reached", level="warning")
    except Exception:
        pass
PYEOF

  rc=0
  SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1 || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "SELF-TEST FAIL: a capture-without-init module was NOT detected."
    echo "  The guard is broken — check the grep patterns in this script."
    exit 2
  elif [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL: expected the violation exit code (1), got $rc (FOLLOW-760 AC3)."
    exit 2
  fi
  echo "OK: self-test PASSED — capture-without-init was correctly detected (red-first fixture)."
  rm -f "$tmp_dir/app-a/src/jobs/rogue_capture.py"

  # ── Positive control: capture served by init_sentry( in the same file ────
  cat > "$tmp_dir/app-a/src/jobs/clean_capture.py" <<'PYEOF'
import sentry_sdk
from jobs.observability import init_sentry

def _spend_cap_exceeded():
    try:
        init_sentry("SENTRY_DSN")
        sentry_sdk.capture_message("daily spend cap reached", level="warning")
    except Exception:
        pass
PYEOF

  if ! SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1; then
    echo "SELF-TEST FAIL: a capture correctly served by init_sentry( in-file was incorrectly flagged."
    exit 2
  fi
  echo "OK: self-test PASSED — capture served by an in-file init_sentry( was correctly allowed."
  rm -f "$tmp_dir/app-a/src/jobs/clean_capture.py"

  # ── Allowlist control: capture with no init, but inline-allowlisted ──────
  cat > "$tmp_dir/app-a/src/jobs/allowlisted_capture.py" <<'PYEOF'
import sentry_sdk

def _rare_case():
    try:
        sentry_sdk.capture_message("served by a different process")  # sentry-init-guard: allowlisted — served by main.py's entry init
    except Exception:
        pass
PYEOF

  allowlist_out="$tmp_dir/.allowlist_self_test_output"
  _st_write_baseline 1 "app-a/src/jobs/allowlisted_capture.py (1 occurrence(s))"
  if ! SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > "$allowlist_out" 2>&1; then
    echo "SELF-TEST FAIL: an explicitly allow-listed capture was incorrectly flagged."
    echo "--- gate output ---"
    cat "$allowlist_out"
    exit 2
  fi
  echo "OK: self-test PASSED — explicitly allow-listed capture was correctly ignored."

  # ── FOLLOW-759 AC4 (a): a SCANNED allowlisted capture is counted as 1 ─────
  if ! grep -q "app-a/src/jobs/allowlisted_capture.py (1 occurrence(s))" "$allowlist_out"; then
    echo "SELF-TEST FAIL (FOLLOW-759 AC4): a scanned file with ONE allowlisted capture was"
    echo "  not reported as exactly one occurrence in the allowlist inventory."
    echo "--- gate output ---"
    cat "$allowlist_out"
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-759 AC4) — a scanned allowlisted capture is inventoried"
  echo "  as exactly 1 occurrence and matched against the baseline."

  # ── FOLLOW-759 AC1: an UNREVIEWED allowlist change fails the gate ─────────
  # Same tree, baseline still says zero suppressions: the gate must go RED.
  # Against the PRE-FOLLOW-759 script this exits 0 (the inventory had no
  # consumer at all) — that is the silent growth this ticket closes.
  _st_write_baseline 0
  rc=0
  SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > "$allowlist_out" 2>&1 || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-759 AC1): an allowlist annotation absent from the committed"
    echo "  baseline did NOT fail the gate — the inventory still has no consumer."
    exit 2
  elif [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-759 AC1): expected the violation exit code (1), got $rc."
    exit 2
  fi
  if ! grep -q "does not match its committed baseline" "$allowlist_out"; then
    echo "SELF-TEST FAIL (FOLLOW-759 AC1): the gate failed, but not under the distinct"
    echo "  baseline-mismatch diagnosis."
    echo "--- gate output ---"
    cat "$allowlist_out"
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-759 AC1) — an allowlist entry missing from the committed"
  echo "  baseline is a LOUD, distinctly-diagnosed failure."

  # ── FOLLOW-759 AC1: a MISSING baseline must fail, never soft-pass ─────────
  rm -f "$st_baseline"
  rc=0
  SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > "$allowlist_out" 2>&1 || rc=$?
  if [[ "$rc" -ne 1 ]] || ! grep -q "committed baseline not found" "$allowlist_out"; then
    echo "SELF-TEST FAIL (FOLLOW-759): a MISSING baseline must fail the gate (exit 1) with a"
    echo "  'committed baseline not found' diagnosis — it must never degrade to"
    echo "  'assume the current suppression set is fine'. Got exit $rc."
    echo "--- gate output ---"
    cat "$allowlist_out"
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-759) — a missing baseline fails the gate loudly."
  _st_write_baseline 0
  rm -f "$tmp_dir/app-a/src/jobs/allowlisted_capture.py" "$allowlist_out"

  # ── FOLLOW-759 AC3/AC4 (b): an annotation in an EXCLUDED file is NOT ──────
  # counted. The old inventory was a raw `grep -rn` over the scan dirs with no
  # --include and no test-file exclusion, so a `test_*.py` (or a .md) carrying
  # the token inflated the count for a file this gate never honours (Rule AL).
  # The inventory now iterates the same $FILES the scan does.
  cat > "$tmp_dir/app-a/src/test_excluded.py" <<'PYEOF'
import sentry_sdk

def test_documents_the_annotation():
    # sentry-init-guard: allowlisted — documentation inside a TEST file
    assert True
PYEOF
  cat > "$tmp_dir/app-a/src/notes.md" <<'MDEOF'
Suppression vocabulary reference: `# sentry-init-guard: allowlisted — <reason>`
MDEOF

  region_out="$tmp_dir/.region_self_test_output"
  rc=0
  SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > "$region_out" 2>&1 || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-759 AC3): an allowlist annotation inside an EXCLUDED file"
    echo "  (test_excluded.py / notes.md) was counted, so the inventory disagreed with the"
    echo "  zero-entry baseline. The inventory region must equal the scan region."
    echo "--- gate output ---"
    cat "$region_out"
    exit 2
  fi
  if grep -q "test_excluded.py\|notes.md" "$region_out"; then
    echo "SELF-TEST FAIL (FOLLOW-759 AC3): an EXCLUDED file appeared in the allowlist"
    echo "  inventory output."
    echo "--- gate output ---"
    cat "$region_out"
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-759 AC3) — an allowlist annotation in a file the gate"
  echo "  does not scan (test_*.py, .md) is not counted; inventory region == scan region."
  rm -f "$tmp_dir/app-a/src/test_excluded.py" "$tmp_dir/app-a/src/notes.md" "$region_out"

  # ── FOLLOW-757 CB-1: a DOCSTRING mention of init_sentry( must not clear ──
  cat > "$tmp_dir/app-a/src/jobs/docstring_capture.py" <<'PYEOF'
"""
This module's capture is served by an init_sentry("SENTRY_DSN") call,
documented here for readers -- but no such call actually exists below.
"""
import sentry_sdk

def _rogue():
    try:
        sentry_sdk.capture_message("docstring-masked capture", level="warning")
    except Exception:
        pass
PYEOF

  rc=0
  SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1 || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-757 CB-1): a capture cleared only by a DOCSTRING mention of"
    echo "  init_sentry( was NOT detected."
    exit 2
  elif [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-757 CB-1): expected the violation exit code (1), got $rc."
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-757 CB-1) — a docstring mention of init_sentry( no longer"
  echo "  clears a real, unserved capture."
  rm -f "$tmp_dir/app-a/src/jobs/docstring_capture.py"

  # ── FOLLOW-757 TG-2: a TRAILING COMMENT mention must not clear ───────────
  cat > "$tmp_dir/app-a/src/jobs/trailing_comment_capture.py" <<'PYEOF'
import sentry_sdk

_todo = 1  # TODO: restore the init_sentry( call here

def _rogue():
    try:
        sentry_sdk.capture_message("trailing-comment-masked capture", level="warning")
    except Exception:
        pass
PYEOF

  rc=0
  SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1 || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-757 TG-2): a capture cleared only by a TRAILING COMMENT mention"
    echo "  of init_sentry( was NOT detected."
    exit 2
  elif [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-757 TG-2): expected the violation exit code (1), got $rc."
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-757 TG-2) — a trailing-comment mention of init_sentry( no"
  echo "  longer clears a real, unserved capture."
  rm -f "$tmp_dir/app-a/src/jobs/trailing_comment_capture.py"

  # ── FOLLOW-757 AC2: a basename merely CONTAINING "test" must be scanned ──
  cat > "$tmp_dir/app-a/src/jobs/latest_pricing.py" <<'PYEOF'
import sentry_sdk

def _rogue():
    try:
        sentry_sdk.capture_message("substring-name-masked capture", level="warning")
    except Exception:
        pass
PYEOF

  rc=0
  SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1 || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-757 AC2): a production file whose basename merely CONTAINS"
    echo "  'test' (latest_pricing.py) was skipped instead of scanned."
    exit 2
  elif [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-757 AC2): expected the violation exit code (1), got $rc."
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-757 AC2) — a basename containing 'test' as a substring"
  echo "  (latest_pricing.py) is now scanned."
  rm -f "$tmp_dir/app-a/src/jobs/latest_pricing.py"

  # ── FOLLOW-757 AC3: an unregistered observability.py must be scanned ─────
  mkdir -p "$tmp_dir/app-a/src/rogue_helper"
  cat > "$tmp_dir/app-a/src/rogue_helper/observability.py" <<'PYEOF'
import sentry_sdk

def _rogue():
    try:
        sentry_sdk.capture_message("unregistered observability.py capture", level="warning")
    except Exception:
        pass
PYEOF

  rc=0
  SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1 || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-757 AC3): a capture inside a file literally named"
    echo "  observability.py (not one of the registered mirrors) was skipped."
    exit 2
  elif [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-757 AC3): expected the violation exit code (1), got $rc."
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-757 AC3) — a bare basename match on observability.py no"
  echo "  longer blanket-excludes the file."
  rm -rf "$tmp_dir/app-a/src/rogue_helper"

  # ── FOLLOW-760 CB-1: a file that FAILS TO TOKENIZE must not silently ─────
  # clear its own real capture call via a docstring mention of init_sentry(.
  # Against the PRE-FOLLOW-760 script this fixture PASSES (silent false
  # green — the exact bug this ticket fixes); see the PR body for the pasted
  # before/after transcript.
  cat > "$tmp_dir/app-a/src/jobs/unparseable_capture.py" <<'PYEOF'
"""
This module's capture is served by an init_sentry("SENTRY_DSN") call, per
this docstring -- but no such call actually exists below, and this file is
deliberately malformed so python3 tokenize cannot process it at all.
"""
import sentry_sdk


def _rogue():
    try:
        raise RuntimeError("boom")
    except Exception:
        sentry_sdk.capture_exception()


_trailing = '''this triple-quoted string is never closed, so tokenize fails
PYEOF

  unparseable_out="$tmp_dir/.follow_760_self_test_output"
  rc=0
  SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > "$unparseable_out" 2>/dev/null || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-760 CB-1): a file that fails to tokenize was NOT"
    echo "  treated as a finding — this is the silent false-GREEN this ticket fixes."
    exit 2
  elif [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-760 CB-1): expected the violation exit code (1), got $rc."
    exit 2
  fi
  if ! grep -q "UNPARSEABLE" "$unparseable_out"; then
    echo "SELF-TEST FAIL (FOLLOW-760 CB-1): the gate failed, but not under the distinct"
    echo "  UNPARSEABLE diagnosis — it must not be conflated with an ordinary"
    echo "  capture-without-init VIOLATION."
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-760 CB-1) — a file that fails to tokenize is now a"
  echo "  LOUD, distinctly-tagged finding, never silently cleared by its own docstring."
  rm -f "$tmp_dir/app-a/src/jobs/unparseable_capture.py" "$unparseable_out"

  # ── FOLLOW-768 CB-1 (RED-FIRST): the allowlist token inside a STRING ─────
  # LITERAL must NOT clear a real, unserved capture. Against the pre-FOLLOW-768
  # script this fixture PASSES (exit 0) — the clearance predicate matched the
  # raw, uncleaned line, so any occurrence of the token anywhere on that line
  # suppressed the finding. See the PR body for the before/after transcript.
  cat > "$tmp_dir/app-a/src/jobs/string_literal_allowlist.py" <<'PYEOF'
import sentry_sdk


def _rogue():
    try:
        raise RuntimeError("boom")
    except Exception:
        sentry_sdk.capture_exception(RuntimeError("sentry-init-guard: allowlisted — this token sits inside a STRING LITERAL, never a comment"))
PYEOF

  string_out="$tmp_dir/.follow_768_self_test_output"
  rc=0
  SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > "$string_out" 2>&1 || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-768 CB-1): a capture cleared only by the allowlist token"
    echo "  inside a STRING LITERAL was NOT detected — the clearance predicate is still"
    echo "  matching raw, uncleaned text."
    echo "--- gate output ---"
    cat "$string_out"
    exit 2
  elif [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-768 CB-1): expected the violation exit code (1), got $rc."
    echo "--- gate output ---"
    cat "$string_out"
    exit 2
  fi
  if ! grep -q "string_literal_allowlist.py" "$string_out" \
    || ! grep -q "FAIL: capture call site(s) found" "$string_out"; then
    echo "SELF-TEST FAIL (FOLLOW-768 CB-1): flagged, but not as an ordinary"
    echo "  capture-without-init VIOLATION naming the file."
    echo "--- gate output ---"
    cat "$string_out"
    exit 2
  fi
  # AC6: the same token must ALSO not be counted into the reviewed suppression
  # inventory. The baseline is still zero-entry here, so a counted occurrence
  # would have surfaced as a baseline mismatch as well.
  if grep -q "string_literal_allowlist.py (1 occurrence(s))" "$string_out"; then
    echo "SELF-TEST FAIL (FOLLOW-768 AC6): the string-literal token was COUNTED into the"
    echo "  allowlist inventory while suppressing nothing — the inventory and the"
    echo "  clearance predicate must share one definition of an allowlist entry."
    echo "--- gate output ---"
    cat "$string_out"
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-768 CB-1/AC6) — the allowlist token inside a string"
  echo "  literal neither clears a real capture nor enters the reviewed inventory."
  rm -f "$tmp_dir/app-a/src/jobs/string_literal_allowlist.py" "$string_out"

  # ── FOLLOW-769 AC1/AC2: the shared-helper hard-fail contract, FIXTURED ────
  # Both gates promise, in the strongest terms, that a missing or non-defining
  # helper under scripts/lib/ exits 2 and never degrades to raw-text matching.
  # Neither --self-test exercised it, while the *manifest*-missing path in the
  # sibling gate was fixtured by the same author in the same PR. Two helpers x
  # two failure shapes = four fixtures here (and four more in the sibling gate).
  helper_dir="$tmp_dir/helper-fixture"
  helper_out="$tmp_dir/.follow_769_self_test_output"
  _st_helper_case() {
    local label="$1" expect_needle="$2"
    local hrc=0
    SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$helper_dir/gate.sh" > "$helper_out" 2>&1 || hrc=$?
    if [[ "$hrc" -ne 2 ]]; then
      echo "SELF-TEST FAIL (FOLLOW-769): $label — expected the broken-guard exit code (2),"
      echo "  got $hrc. A gate that cannot load its shared helper must NOT report a"
      echo "  verdict on the tree (exit 0/1); it must say it is broken."
      echo "--- gate output ---"
      cat "$helper_out"
      exit 2
    fi
    if ! grep -q "$expect_needle" "$helper_out"; then
      echo "SELF-TEST FAIL (FOLLOW-769): $label — exited 2, but without the expected"
      echo "  diagnosis '$expect_needle'."
      echo "--- gate output ---"
      cat "$helper_out"
      exit 2
    fi
    echo "OK: self-test PASSED (FOLLOW-769) — $label"
  }

  # (a) no scripts/lib/ at all → the clean-python-source guard fires first.
  rm -rf "$helper_dir"
  mkdir -p "$helper_dir"
  cp "$0" "$helper_dir/gate.sh"
  _st_helper_case "a MISSING lib/clean-python-source.sh hard-fails the gate." \
    "shared helper not found: $helper_dir/lib/clean-python-source.sh"

  # (b) clean-python-source.sh present and loadable, suppression-baseline.sh
  #     missing → the SECOND helper's guard fires. Fixtured separately because
  #     a single fixture for "a helper" would leave whichever guard runs second
  #     unexercised (the FOLLOW-769 finding, in miniature).
  mkdir -p "$helper_dir/lib"
  cp "$CLEAN_LIB" "$helper_dir/lib/clean-python-source.sh"
  _st_helper_case "a MISSING lib/suppression-baseline.sh hard-fails the gate." \
    "shared helper not found: $helper_dir/lib/suppression-baseline.sh"

  # (c) clean-python-source.sh EXISTS but defines nothing → the declare -F
  #     branch. A file that sources cleanly and defines no function is exactly
  #     what a botched merge or a truncated checkout leaves behind.
  : > "$helper_dir/lib/clean-python-source.sh"
  cp "$BASELINE_LIB" "$helper_dir/lib/suppression-baseline.sh"
  _st_helper_case "a lib/clean-python-source.sh that defines NOTHING hard-fails the gate." \
    "did not define clean_python_source()"

  # (d) the same shape for the second helper.
  cp "$CLEAN_LIB" "$helper_dir/lib/clean-python-source.sh"
  : > "$helper_dir/lib/suppression-baseline.sh"
  _st_helper_case "a lib/suppression-baseline.sh that defines NOTHING hard-fails the gate." \
    "did not define compare_suppression_baseline()"
  rm -rf "$helper_dir" "$helper_out"

  # ── Rule AP verification (FOLLOW-768 / CONVENTIONS_PATCH Rule AP) ─────────
  # A REGISTER ENTRY GOING LIVE must fail the gate with a diagnosis DISTINCT
  # from an ordinary finding, naming the entry id. Entry [E] records that the
  # committed baseline stores per-file counts and paths but never the
  # `— <reason>` text, so a perfunctory reason is indistinguishable from a
  # reviewed one; its proof goes live on an annotation whose reason is under 20
  # characters. The baseline is set to match the fixture on purpose, so the ONLY
  # thing that can fail here is the register.
  # RED-FIRST: against the pre-register script this fixture exits 0.
  cat > "$tmp_dir/app-a/src/jobs/thin_reason_allowlist.py" <<'PYEOF'
import sentry_sdk


def _rare():
    try:
        sentry_sdk.capture_message("served elsewhere")  # sentry-init-guard: allowlisted — x
    except Exception:
        pass
PYEOF
  _st_write_baseline 1 "app-a/src/jobs/thin_reason_allowlist.py (1 occurrence(s))"
  register_out="$tmp_dir/.rule_ap_self_test_output"
  rc=0
  SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > "$register_out" 2>&1 || rc=$?
  if [[ "$rc" -ne 3 ]]; then
    echo "SELF-TEST FAIL (Rule AP): a register entry whose latency proof now returns hits"
    echo "  did not fail the gate with the distinct GONE LIVE exit code (expected 3, got"
    echo "  $rc) — this is the Rule AP clause 2 contract."
    echo "--- gate output ---"
    cat "$register_out"
    exit 2
  fi
  if ! grep -q "GONE LIVE" "$register_out" || ! grep -q "\[E\]" "$register_out"; then
    echo "SELF-TEST FAIL (Rule AP): the gone-live residual was not reported with the"
    echo "  distinct GONE LIVE diagnosis naming its entry id (E)."
    echo "--- gate output ---"
    cat "$register_out"
    exit 2
  fi
  if ! grep -q "matches the committed baseline" "$register_out"; then
    echo "SELF-TEST FAIL (Rule AP): the fixture was supposed to isolate the register —"
    echo "  the allowlist baseline should have MATCHED, so exit 3 comes only from the"
    echo "  register going live."
    echo "--- gate output ---"
    cat "$register_out"
    exit 2
  fi
  echo "OK: self-test PASSED (Rule AP) — a register entry going live fails the gate (exit 3)"
  echo "  with a distinct diagnosis naming [E], while every ordinary check is clean."
  rm -f "$tmp_dir/app-a/src/jobs/thin_reason_allowlist.py" "$register_out"
  _st_write_baseline 0

  echo ""
  echo "Self-test PASSED."
  exit 0
fi

# ── Real check ────────────────────────────────────────────────────────────────
TARGET="${SENTRY_CAPTURE_INIT_TARGET:-}"

echo "=== Sentry capture-has-init guard (FOLLOW-743) ==="

if [[ -n "$TARGET" ]]; then
  SCAN_DIRS=("$TARGET")
  SCAN_ROOT="$TARGET"
else
  SCAN_DIRS=()
  for d in "$ROOT"/apps/*/src; do
    [[ -d "$d" ]] && SCAN_DIRS+=("$d")
  done
  SCAN_ROOT="$ROOT"
fi

echo "Scanning: ${SCAN_DIRS[*]}"
echo ""

FILES=$(
  find "${SCAN_DIRS[@]}" -type f -name "*.py" \
    ! -name "test_*.py" \
    ! -name "*_test.py" \
    ! -name "conftest.py" \
    2>/dev/null || true
)

# ── Allowlist inventory + its baseline consumer (FOLLOW-757 AC5 / FOLLOW-759) ─
# Region (Rule AL): iterate the SAME $FILES the gate scans, never a fresh
# recursive grep of the scan dirs — the old form counted annotations in files
# this gate does not honour (test_*.py, .md, fixtures) and could not count one
# it does. One list, so the two cannot drift.
#
# DEFINITION (Rule AL, FOLLOW-768 AC6): an entry is counted by exactly the
# predicate that HONOURS it — `_allowlist_comment_lines`, the same function
# _check_file clears with. Before FOLLOW-768 both sides matched raw text, so
# they agreed by accident; moving clearance onto comment-blanked spans and
# leaving the inventory on `grep -c` would have made a token in a string
# literal COUNT toward the reviewed suppression baseline while SUPPRESSING
# NOTHING — the two regions disagreeing about what "an allowlist entry" is.
# The count is per-file COMMENT-token occurrences, which for Python equals the
# per-file line count `grep -c` produced (at most one comment per line), so the
# committed baseline is unchanged by this move at 0 occurrences.
#
# UNAVAILABLE INPUT: a file python3 cannot tokenize contributes NO inventory
# entry. It cannot hide a green run — the violation loop below iterates the
# SAME $FILES and reports that identical file as an UNPARSEABLE finding
# (exit 1). Register entry [D] records this bound.
ALLOWLIST_OBSERVED=$(mktemp)
for f in $FILES; do
  inv_rc=0
  inv_lines=$(_allowlist_comment_lines "$f" 2>/dev/null) || inv_rc=$?
  [[ "$inv_rc" -ne 0 ]] && continue
  hits=$(printf '%s' "$inv_lines" | grep -c . || true)
  [[ -z "$hits" || "$hits" -eq 0 ]] && continue
  printf '%s (%s occurrence(s))\n' "${f#"$SCAN_ROOT"/}" "$hits" >> "$ALLOWLIST_OBSERVED"
done

ALLOWLIST_BASELINE="${SENTRY_CAPTURE_ALLOWLIST_BASELINE:-$ROOT/scripts/baselines/sentry-capture-allowlist.baseline}"
BASELINE_MISMATCH=0
compare_suppression_baseline \
  "Allowlist (sentry-init-guard: allowlisted)" \
  "$ALLOWLIST_BASELINE" \
  "$ALLOWLIST_OBSERVED" || BASELINE_MISMATCH=1
rm -f "$ALLOWLIST_OBSERVED"
echo ""

# VIOLATIONS = capture-without-init findings; UNPARSEABLE = files python3
# could not tokenize (FOLLOW-760) — kept in separate accumulators so the two
# failure classes are never reported under the same undifferentiated heading.
VIOLATIONS=""
VIOLATION_COUNT=0
UNPARSEABLE=""
UNPARSEABLE_COUNT=0
for f in $FILES; do
  result=$(_check_file "$f")
  [[ -z "$result" ]] && continue
  kind=$(printf '%s\n' "$result" | head -n1)
  detail=$(printf '%s\n' "$result" | tail -n +2)
  case "$kind" in
    VIOLATION)
      VIOLATIONS="${VIOLATIONS}${detail}"$'\n'
      VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
      ;;
    UNPARSEABLE)
      UNPARSEABLE="${UNPARSEABLE}${detail}"$'\n'
      UNPARSEABLE_COUNT=$((UNPARSEABLE_COUNT + 1))
      ;;
    *)
      # Defensive: an unexpected _check_file output shape must still be a
      # loud finding, never silently dropped.
      VIOLATIONS="${VIOLATIONS}${result}"$'\n'
      VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
      ;;
  esac
done

echo "UNPARSEABLE FILES (python3 could not tokenize; treated as findings, not"
echo "silently cleared — FOLLOW-760): $UNPARSEABLE_COUNT"
if [[ "$UNPARSEABLE_COUNT" -gt 0 ]]; then
  # shellcheck disable=SC2001  # prefixing every line of a multi-line string;
  # a parameter-expansion replacement cannot anchor to line starts here.
  echo "$UNPARSEABLE" | sed 's/^/  /'
fi
echo ""

# ── Rule AP residual register (FOLLOW-768 / FOLLOW-769 / FOLLOW-771) ─────────
# Region sources for the entries below. Each is built HERE, in the gate, so
# every proof reads exactly the region its control reads (Rule AL) in BOTH
# modes — the real scan and a SENTRY_CAPTURE_INIT_TARGET fixture run.
if [[ -z "$FILES" ]]; then
  # grep with no file operands would read stdin and hang; /dev/null is the
  # empty region and keeps the proof's exit status meaningful (1, no output).
  SC_FILES_OPERANDS="/dev/null"
else
  SC_FILES_OPERANDS="$FILES"
fi

# Entry [A] reads the COMPLEMENT of the scan region — the .py files this gate
# never looks at.
if [[ -n "$TARGET" ]]; then
  # In TARGET mode SCAN_DIRS is the whole scan root, so the complement is empty
  # BY CONSTRUCTION — a known-empty region, not an unreadable one.
  SC_OUTSIDE_OPERANDS="/dev/null"
else
  sc_ls_rc=0
  sc_tracked_py=$(git -C "$ROOT" ls-files -- '*.py') || sc_ls_rc=$?
  if [[ "$sc_ls_rc" -ne 0 ]]; then
    echo "FAIL: REGISTER SOURCE UNAVAILABLE — \`git ls-files\` exited $sc_ls_rc at"
    echo "$ROOT, so register entry [A]'s region (the .py files OUTSIDE the scan"
    echo "region) could not be enumerated. A residual whose latency proof cannot"
    echo "be evaluated is never assumed still latent (Rule AP clause 2), so this"
    echo "is a hard failure rather than an empty — i.e. reassuring — region."
    exit 2
  fi
  SC_OUTSIDE_OPERANDS=""
  while IFS= read -r sc_p; do
    [[ -z "$sc_p" ]] && continue
    case "$sc_p" in apps/*/src/*) continue ;; esac
    # A tracked-but-deleted index entry is not a readable operand; skipping it
    # keeps the proof's exit status meaningful instead of an unrelated grep 2.
    [[ -f "$ROOT/$sc_p" ]] || continue
    SC_OUTSIDE_OPERANDS="${SC_OUTSIDE_OPERANDS}${ROOT}/${sc_p}"$'\n'
  done <<< "$sc_tracked_py"
  [[ -z "$SC_OUTSIDE_OPERANDS" ]] && SC_OUTSIDE_OPERANDS="/dev/null"
fi

SC_SELF="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
SC_CLEAN_LIB="$CLEAN_LIB"
export SC_FILES_OPERANDS SC_OUTSIDE_OPERANDS SC_SELF SC_CLEAN_LIB
export SC_FILES="$FILES"

# id | control | one-line description | latency proof
# EMPTY stdout ⇒ the residual is still latent. Output ⇒ it has GONE LIVE.
# ANY pipe stage exiting ≥ 2 — not merely the pipeline's own reported status ⇒
# the gate is broken (see PER-STAGE PROOF STATUS in the header). See the header
# for each entry's region, scan root and unavailable-input behaviour.
# shellcheck disable=SC2016  # DELIBERATE: proof strings must NOT expand here.
# They are executed later by `bash -c`, which expands them against the exported
# region variables. Expanding at array-definition time would bake one run's
# file list into the register.
RESIDUAL_REGISTER=(
  'A|P1-capture-detection|the scan region is apps/*/src only: a capture site anywhere else in the repo is never looked at|grep -HnE "sentry_sdk\.(capture_exception|capture_message)\(" $SC_OUTSIDE_OPERANDS'
  'B|P1-capture-detection|the scan loop word-splits its file list, so a scanned path containing whitespace would break it|printf "%s" "$SC_FILES" | grep -nE "[[:blank:]]"'
  'C|P1-capture-detection|detection requires the literal sentry_sdk. prefix, so a from-import or aliased import of the capture functions is invisible|grep -HnE "^[[:space:]]*(from sentry_sdk import|import sentry_sdk as)" $SC_FILES_OPERANDS'
  'D|P3-allowlist-clearance + P4-allowlist-inventory (one shared definition since FOLLOW-768 AC6)|an annotation comment that is not on a capture line is COUNTED into the reviewed baseline but clears nothing; clearance is LINE-scoped, so a continuation line of a multi-line capture call does not clear it either|grep -Hn "sentry-init-guard: allowlisted" $SC_FILES_OPERANDS | grep -vE "sentry_sdk\.(capture_exception|capture_message)\("'
  'E|P4-allowlist-inventory|the baseline records per-file counts and paths, never line numbers or the reason text, so a perfunctory reason is indistinguishable from a reviewed one|grep -Hn "sentry-init-guard: allowlisted" $SC_FILES_OPERANDS | grep -vE "sentry-init-guard: allowlisted (—|--) .{20,}"'
  'F|P2-init-clearance|clearance is a textual, FILE-scoped init_sentry( match: a DEFINITION of that name in the same file clears every capture in it|grep -HnE "^[[:space:]]*def init_sentry\(" $SC_FILES_OPERANDS | grep -v "observability\.py"'
  'G|P6-shared-helper-availability|the helper guards check presence and declare -F, never behaviour: a helper that loaded, defined the name and returned raw source would pass them|grep -L "sys.exit(3)" "$SC_CLEAN_LIB"'
  'H|P7-residual-register|entries are hand-written, so a failure accumulator added to this gate without an entry is invisible to the register|grep -cE "^[A-Z][A-Z_]*(COUNT|MISMATCH)=0$" "$SC_SELF" | grep -vx "3"'
)

echo "=== Rule AP residual register — ${#RESIDUAL_REGISTER[@]} documented gap(s), every latency proof EXECUTED ==="
REGISTER_LIVE=0
REGISTER_BROKEN=0
reg_err=$(mktemp)
reg_ps=$(mktemp)

# ── RUNNER — byte-identical to scripts/check-mirror-files.sh's (FOLLOW-770 ────
# fix-iteration 1). Copied verbatim rather than re-derived, INCLUDING the
# MF_PS_FILE variable name, so the two runners diff to zero and a future fix to
# one is a mechanical copy to the other. Do not "clean it up" per gate.
#
# Appended to EVERY proof before execution. It records each pipe stage's OWN
# exit status (bash's PIPESTATUS) to $MF_PS_FILE, then re-exits with pipefail's
# own rightmost-non-zero status so the diagnostic below can still report it.
# See PER-STAGE PROOF STATUS in the header for why the pipeline's own status is
# not sufficient. Written as an epilogue rather than baked into each proof so
# the register keeps the one `id|control|description|proof` format (Rule AP
# clause 6) and EVERY entry — including ones added later, and ones copied into
# another gate — gets this for free instead of per-author discipline.
# shellcheck disable=SC2016  # DELIBERATE: this epilogue is source text appended
# to each proof and evaluated inside the proof's own `bash -c`; expanding
# PIPESTATUS here would capture THIS shell's status, which is the bug it fixes.
REGISTER_PROOF_EPILOGUE='
__mf_ps=("${PIPESTATUS[@]}")
printf "%s\n" "${__mf_ps[@]}" >"$MF_PS_FILE"
__mf_rc=0
for __mf_s in "${__mf_ps[@]}"; do if [ "$__mf_s" -ne 0 ]; then __mf_rc="$__mf_s"; fi; done
exit "$__mf_rc"
'

for entry in "${RESIDUAL_REGISTER[@]}"; do
  # Only the first three '|' delimit; the rest of the line is the proof, which
  # contains pipes of its own.
  IFS='|' read -r r_id r_control r_desc r_proof <<< "$entry"
  r_rc=0
  : > "$reg_ps"
  # -o pipefail so a failing producer inside a pipe (e.g. git exiting 128)
  # cannot masquerade as an empty — i.e. reassuring — result, AND the epilogue
  # so a SECOND stage's ordinary "no match" 1 cannot mask that producer either.
  r_out=$(MF_PS_FILE="$reg_ps" bash -o pipefail -c "$r_proof$REGISTER_PROOF_EPILOGUE" 2>"$reg_err") || r_rc=$?

  r_stages=()
  if [[ -s "$reg_ps" ]]; then mapfile -t r_stages < "$reg_ps"; fi
  # UNEVALUABLE is decided by the WORST stage, never by the pipeline's own
  # reported status.
  r_worst=0
  if [[ "${#r_stages[@]}" -gt 0 ]]; then
    for r_st in "${r_stages[@]}"; do
      if [[ "$r_st" =~ ^[0-9]+$ ]] && [[ "$r_st" -gt "$r_worst" ]]; then r_worst="$r_st"; fi
    done
    r_stages_txt="${r_stages[*]}"
  else
    # The proof never reached the epilogue: a syntax error, a signal, or an
    # explicit exit inside the proof. Its stage statuses — and therefore its
    # latency — could NOT be established, so it is UNEVALUABLE. Never "assume
    # still latent" (Rule AP clause 2), not even when the pipeline reported 0.
    r_worst=2
    if [[ "$r_rc" -gt 2 ]]; then r_worst="$r_rc"; fi
    r_stages_txt="none recorded"
  fi

  if [[ "$r_worst" -ge 2 ]]; then
    echo "  [$r_id] UNEVALUABLE ($r_control) $r_desc"
    echo "        proof:  $r_proof"
    echo "        status: stage exit codes [$r_stages_txt] (pipeline reported $r_rc);"
    echo "                a stage exited $r_worst — the residual's latency could NOT be established."
    if [[ -s "$reg_err" ]]; then sed 's/^/        stderr: /' "$reg_err"; fi
    REGISTER_BROKEN=$((REGISTER_BROKEN + 1))
  elif [[ -n "$r_out" ]]; then
    echo "  [$r_id] GONE LIVE   ($r_control) $r_desc"
    echo "        proof:  $r_proof"
    echo "        hits:"
    printf '%s\n' "$r_out" | sed 's/^/          /'
    REGISTER_LIVE=$((REGISTER_LIVE + 1))
  else
    echo "  [$r_id] latent      ($r_control) $r_desc"
  fi
done
rm -f "$reg_err" "$reg_ps"
echo "  ${#RESIDUAL_REGISTER[@]} entry/entries checked — $REGISTER_LIVE gone live, $REGISTER_BROKEN unevaluable."
echo ""

if [[ "$VIOLATION_COUNT" -eq 0 && "$UNPARSEABLE_COUNT" -eq 0 && "$BASELINE_MISMATCH" -eq 0 \
  && "$REGISTER_LIVE" -eq 0 && "$REGISTER_BROKEN" -eq 0 ]]; then
  echo "PASS: every capture_exception(/capture_message( call site has an"
  echo "init_sentry( call in the same file (or is explicitly allow-listed),"
  echo "every scanned file tokenized cleanly, and the allowlist inventory"
  echo "matches its committed baseline."
  exit 0
fi

if [[ "$VIOLATION_COUNT" -gt 0 ]]; then
  echo "FAIL: capture call site(s) found with no init_sentry( in the same file:"
  echo ""
  echo "$VIOLATIONS"
  echo "FIX: add, before the capture call (see apps/intent-engine/src/nlp.py:314"
  echo "or apps/llm-gateway/src/jobs/consume_embed_seed_requests.py:198 for the"
  echo "pattern):"
  echo "  from jobs.observability import init_sentry   # or the app-local import path"
  echo "  init_sentry(\"SENTRY_DSN\")"
  echo ""
  echo "ALLOWLIST: if the capture is genuinely served by an init in a different"
  echo "process entry point, add this comment on the capture line:"
  echo "  # sentry-init-guard: allowlisted — <reason>"
  echo ""
fi

if [[ "$UNPARSEABLE_COUNT" -gt 0 ]]; then
  echo "FAIL: file(s) above could not be tokenized by python3 — their capture/init"
  echo "call shape could NOT be verified, so each is treated as a finding rather"
  echo "than silently cleared (FOLLOW-760: a gate that cannot evaluate a file must"
  echo "not report it clean). Check the run log above for the tokenizer error on"
  echo "each path (printed to stderr by clean_python_source)."
  echo ""
  echo "FIX: make the file tokenizable (fix the syntax/encoding error), or if it is"
  echo "intentionally non-standard Python, allowlist its capture call(s) inline:"
  echo "  # sentry-init-guard: allowlisted — <reason>"
  echo ""
fi

if [[ "$BASELINE_MISMATCH" -ne 0 ]]; then
  echo "FAIL: the allowlist suppression set does not match its committed baseline"
  echo "(details and the copy-pasteable replacement are printed above, under the"
  echo "inventory). FOLLOW-759: the inventory used to be a number in a green job's"
  echo "log with no consumer; the baseline is that consumer, so every change to"
  echo "what this gate stops seeing is a reviewed diff."
  echo ""
fi

if [[ "$REGISTER_BROKEN" -gt 0 ]]; then
  echo "Rule AP REGISTER BROKEN: $REGISTER_BROKEN entry/entries could not be evaluated."
  echo "A residual whose latency proof cannot run is NEVER assumed still latent"
  echo "(FOLLOW-760, applied to the register itself). Fix the proof or the"
  echo "environment it reads."
  echo ""
  exit 2
fi

if [[ "$REGISTER_LIVE" -gt 0 ]]; then
  echo "Rule AP REGISTER ENTRY GONE LIVE: $REGISTER_LIVE documented residual(s) are now REAL."
  echo "This is NOT an ordinary capture-has-init finding — the gate worked; a gap"
  echo "this script's register says is latent has become live, and the entry ids"
  echo "are named above. Close the gap, or re-scope the entry and say so in the"
  echo "PR. Do not delete the entry (CONVENTIONS_PATCH.md Rule AP clause 5)."
  echo ""
  exit 3
fi

echo "See FOLLOW-743 / FOLLOW-759 / FOLLOW-760 / FOLLOW-768 / FOLLOW-769 /"
echo "scripts/check-sentry-capture-has-init.sh header for full context."
exit 1
