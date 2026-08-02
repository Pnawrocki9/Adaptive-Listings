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
# string-literal stripping pass (`_clean_python_source`) so the two halves
# cannot drift apart again.
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
# this annotation comment itself is never stripped by `_clean_python_source`.
#
# Every run of the real check (not just violations) prints an ALLOWLIST
# INVENTORY — a count plus file:line of every `sentry-init-guard: allowlisted`
# occurrence under the scanned tree — so a growing suppression set is visible
# in CI output, not only discoverable by grepping the source (FOLLOW-757 AC5,
# same shape as Rule Q applied to suppressions instead of skips).
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
#   None of 5/6/7 is fixed here (out of this ticket's AC); a future ticket
#   should pick these up if the scan ever needs to widen, filenames change,
#   or an aliased/`from`-import capture site is introduced.
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
# before/after transcript. All exit-code assertions check the SPECIFIC
# expected code (1 for a detected violation/unparseable finding), not merely
# non-zero (FOLLOW-760 AC3).
#
# EXIT CODES
# ──────────
#   0 = pass (every capture-containing file also has an init_sentry( call, or
#       is explicitly allow-listed, AND every scanned file tokenized cleanly)
#   1 = violation — EITHER a capture call with no init_sentry( in the same
#       file and not allow-listed, OR a file whose capture/init shape could
#       not be verified because python3 could not tokenize it (FOLLOW-760:
#       a gate that cannot evaluate a file must not report it clean, so this
#       is a hard failure by default, printed under its own distinct
#       "UNPARSEABLE" heading so it is never confused with an ordinary
#       capture-without-init violation)
#   2 = self-test failure (the guard itself is broken)

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Strips whole-line comments, trailing comments, AND string literals/docstrings
# from a Python file, replacing each stripped token with same-width whitespace
# so line numbers (and everything else's column offsets) are preserved. This
# is what makes both the capture-detection and init-clearance regexes see only
# real code (FOLLOW-757 AC1).
#
# FOLLOW-760 CB-1: on a tokenizer failure (unterminated string, inconsistent
# dedent, rejected encoding, ...) this function writes NOTHING to stdout and
# exits non-zero (3). It must NOT fall back to writing the raw, uncleaned
# file — that would silently revert BOTH the detection and clearance regexes
# to matching raw text, so a docstring/comment mention of `init_sentry(`
# would clear a real, unserved capture call again (the exact false-GREEN
# FOLLOW-757 removed). The caller (`_check_file`) distinguishes "cannot
# evaluate this file" (exit 3 here) from "evaluated, no violation" (exit 0,
# real cleaned content on stdout) and reports the former as its own LOUD,
# counted "UNPARSEABLE" finding rather than silently clearing it. This still
# does not crash the gate itself — the tokenizer error is caught here, not
# left to propagate as an uncaught Python traceback or an unguarded shell
# failure (see `_check_file` for how the non-zero exit is captured safely
# under `set -e`).
_clean_python_source() {
  local file="$1"
  python3 - "$file" <<'PYEOF'
import sys
import tokenize

path = sys.argv[1]

try:
    with open(path, "rb") as f:
        raw = f.read()
    lines = raw.decode("utf-8", errors="replace").splitlines(keepends=True)

    with open(path, "rb") as f:
        tokens = list(tokenize.tokenize(f.readline))

    for tok in tokens:
        if tok.type not in (tokenize.COMMENT, tokenize.STRING):
            continue
        start_row, start_col = tok.start
        end_row, end_col = tok.end

        def _blank(line, from_col, to_col):
            body = line
            newline = ""
            if body.endswith("\r\n"):
                newline = "\r\n"
                body = body[:-2]
            elif body.endswith("\n"):
                newline = "\n"
                body = body[:-1]
            to_col = min(to_col, len(body))
            return body[:from_col] + (" " * (to_col - from_col)) + body[to_col:] + newline

        if start_row == end_row:
            lines[start_row - 1] = _blank(lines[start_row - 1], start_col, end_col)
        else:
            lines[start_row - 1] = _blank(lines[start_row - 1], start_col, len(lines[start_row - 1]))
            for r in range(start_row, end_row - 1):
                lines[r] = _blank(lines[r], 0, len(lines[r]))
            lines[end_row - 1] = _blank(lines[end_row - 1], 0, end_col)

    sys.stdout.write("".join(lines))
except Exception as exc:
    # FOLLOW-760 CB-1: a file this tokenizer cannot process must NOT be
    # silently treated as clean. Write nothing to stdout (no raw-content
    # fallback) and exit non-zero so the shell caller treats this file as an
    # "cannot evaluate" finding, distinct from a real cleared/violating file.
    print(f"tokenize error on {path}: {exc}", file=sys.stderr)
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

  # `_clean_python_source` exits non-zero (no stdout) when python3 cannot
  # tokenize the file. Capture that via `||` (not a bare assignment) so a
  # non-zero exit does not trip `set -e` — this is "cannot evaluate", not a
  # crash, and must be reported as its own finding, not swallowed.
  cleaned=$(_clean_python_source "$file") || clean_rc=$?

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

  if ! SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1; then
    echo "SELF-TEST FAIL: an explicitly allow-listed capture was incorrectly flagged."
    exit 2
  fi
  echo "OK: self-test PASSED — explicitly allow-listed capture was correctly ignored."
  rm -f "$tmp_dir/app-a/src/jobs/allowlisted_capture.py"

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
else
  SCAN_DIRS=()
  for d in "$ROOT"/apps/*/src; do
    [[ -d "$d" ]] && SCAN_DIRS+=("$d")
  done
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

# ── Allowlist inventory (FOLLOW-757 AC5) — always printed, pass or fail ──────
ALLOWLIST_HITS=$(
  grep -rn "sentry-init-guard: allowlisted" "${SCAN_DIRS[@]}" 2>/dev/null || true
)
if [[ -n "$ALLOWLIST_HITS" ]]; then
  ALLOWLIST_COUNT=$(echo "$ALLOWLIST_HITS" | grep -c "sentry-init-guard: allowlisted")
else
  ALLOWLIST_COUNT=0
fi
echo "Allowlist inventory (sentry-init-guard: allowlisted): $ALLOWLIST_COUNT occurrence(s)"
if [[ "$ALLOWLIST_COUNT" -gt 0 ]]; then
  echo "$ALLOWLIST_HITS" | sed 's/^/  /'
fi
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

if [[ "$VIOLATION_COUNT" -eq 0 && "$UNPARSEABLE_COUNT" -eq 0 ]]; then
  echo "PASS: every capture_exception(/capture_message( call site has an"
  echo "init_sentry( call in the same file (or is explicitly allow-listed), and"
  echo "every scanned file tokenized cleanly."
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
  echo "each path (printed to stderr by _clean_python_source)."
  echo ""
  echo "FIX: make the file tokenizable (fix the syntax/encoding error), or if it is"
  echo "intentionally non-standard Python, allowlist its capture call(s) inline:"
  echo "  # sentry-init-guard: allowlisted — <reason>"
  echo ""
fi

echo "See FOLLOW-743 / FOLLOW-760 / scripts/check-sentry-capture-has-init.sh header for full context."
exit 1
