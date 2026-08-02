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
# The comment MUST contain the literal string "sentry-init-guard: allowlisted".
# The allowlist check is run against the file's ORIGINAL (uncleaned) line, so
# this annotation comment itself is never stripped by `clean_python_source`.
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
# SCAN DIR
# ────────
# Parameterised via SENTRY_CAPTURE_INIT_TARGET (default: apps/*/src in repo
# root). The --self-test mode points this env var at a temp directory so the
# detector can be verified without touching the real source tree.
#
# KNOWN, DELIBERATELY UNGUARDED GAPS (FOLLOW-757 items 5 and 6, FOLLOW-760
# item 7 — verified not live, recorded so they are not silently reintroduced
# as surprises):
#   5. SCAN_DIRS is only "$ROOT"/apps/*/src — a capture site under packages/,
#      scripts/, tests/integration/, or apps/*/tests/ is unscanned. A repo-wide
#      grep for `sentry_sdk\.(capture_exception|capture_message)\(` outside
#      apps/*/src returns zero hits today.
#   6. `for f in $FILES` (in the real-check loop below) is unquoted word
#      splitting — a filename containing IFS whitespace would break it. No
#      such filename exists in the repo today.
#   7. (FOLLOW-760 CB-3, DEFERRED — NOT fixed in this ticket, judged and
#      recorded rather than left unmentioned.) The detection regex (below,
#      "sentry_sdk\.(capture_exception|capture_message)\(") requires the
#      literal `sentry_sdk.` prefix. A module using
#      `from sentry_sdk import capture_exception` (or `import sentry_sdk as
#      <alias>`) and then calling the bare name is INVISIBLE to this gate —
#      false GREEN if such a module also lacks init_sentry(. Verified zero
#      such imports repo-wide today:
#        grep -rn "from sentry_sdk import\|import sentry_sdk as" --include=*.py .
#      returns no hits. This class is therefore NOT fully enumerated-and-
#      guarded (Rule AE-as-amended) — it is documented-and-open, same status
#      shapes 3/4 had before FOLLOW-757 closed them. Deferred because fixing
#      it correctly (distinguishing a real bare `capture_exception(` call
#      from an unrelated same-named function, and resolving the aliased-
#      import case) is a second axis of work from CB-1's fallback-safety fix
#      and deserves its own red-first fixture rather than riding along here.
#   8. (FOLLOW-759, NEW — introduced by the inventory's region alignment.) The
#      inventory counts the annotation token on ANY line of a scanned file,
#      while the gate only HONOURS one that sits on a capture line. An
#      annotation on a non-capture line is therefore COUNTED but INERT. This
#      over-counts in the safe direction — it makes a useless suppression
#      visible in the baseline diff, and it cannot hide a violation — so it is
#      recorded rather than fixed.
#   9. (FOLLOW-759, NEW.) The inventory greps RAW file text, not the cleaned
#      source, so the literal token inside a string literal or docstring is
#      counted. This is DELIBERATE and matches the consumer: the allowlist
#      CLEARANCE check below is also raw-text (see `_check_file`), and Rule AL
#      requires the assertion's region to equal its consumer's. FOLLOW-768 owns
#      moving clearance onto cleaned text; when it does, this inventory must
#      move with it in the same PR or the two regions diverge again.
#  10. (FOLLOW-759, NEW.) The baseline records per-file occurrence COUNTS and
#      paths — not line numbers and not the `— <reason>` text. Moving an
#      annotation within a file, or rewriting its reason, does not trip the
#      baseline. Adding, removing, or relocating one across files does.
#  11. (FOLLOW-759, NEW.) This gate now depends on TWO shared helpers under
#      scripts/lib/ (clean-python-source.sh, suppression-baseline.sh); a missing
#      one exits 2 rather than degrading, but neither hard-fail has a fixture.
#      FOLLOW-769 owns that gap and its scope is now two helpers x two gates.
#   None of 5/6/7/8/9/10/11 is fixed here (out of this ticket's AC); a future
#   ticket should pick these up if the scan ever needs to widen, filenames
#   change, or an aliased/`from`-import capture site is introduced.
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
#   2 = self-test failure, or a shared helper under scripts/lib/ is missing
#       (the guard itself is broken)

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

  # Re-attach each match to its ORIGINAL (uncleaned) line so an inline
  # allowlist comment on that line stays visible for the check below.
  local capture_lines=""
  local ln orig_line
  while IFS= read -r ln; do
    orig_line=$(sed -n "${ln}p" "$file")
    capture_lines="${capture_lines}${ln}:${orig_line}"$'\n'
  done <<< "$capture_line_nums"

  # Drop any capture line explicitly allow-listed inline.
  local unallowlisted
  unallowlisted=$(echo "$capture_lines" | grep -v "sentry-init-guard: allowlisted" || true)
  [[ -z "$unallowlisted" ]] && return 0

  # A real (non-comment, non-string) init_sentry( call anywhere in the same
  # file clears it.
  if echo "$cleaned" | grep -nE "init_sentry\(" | grep -q .; then
    return 0
  fi

  echo "VIOLATION"
  echo "$file"
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
ALLOWLIST_OBSERVED=$(mktemp)
for f in $FILES; do
  hits=$(grep -c "sentry-init-guard: allowlisted" "$f" 2>/dev/null || true)
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
  echo "$UNPARSEABLE" | sed 's/^/  /'
fi
echo ""

if [[ "$VIOLATION_COUNT" -eq 0 && "$UNPARSEABLE_COUNT" -eq 0 && "$BASELINE_MISMATCH" -eq 0 ]]; then
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

echo "See FOLLOW-743 / FOLLOW-759 / FOLLOW-760 / scripts/check-sentry-capture-has-init.sh header for full context."
exit 1
