#!/usr/bin/env bash
# SHARED HELPER — committed-baseline consumer for gate SUPPRESSION INVENTORIES
# (FOLLOW-759 + FOLLOW-765).
#
# WHY THIS FILE EXISTS
# ────────────────────
# Two sibling gates each grew a suppression inventory that printed a count and
# then had NOTHING read it:
#
#   * scripts/check-sentry-capture-has-init.sh — "Allowlist inventory
#     (sentry-init-guard: allowlisted): N occurrence(s)" (FOLLOW-757 AC5).
#     Suppresses individual capture LINES.
#   * scripts/check-sentry-init-singleton.sh — "Registered mirror files
#     excluded from the scan: N" (FOLLOW-746 AC2). Suppresses whole FILES.
#
# In both cases the number landed in the log of a GREEN job, and nobody opens a
# green job's log. That is a HALF_WIRE_P under Rule AJ (a producer-only signal
# is not observability), applied to suppressions instead of failures: the gap
# had moved one hop — from "invisible unless you grep the source" to "invisible
# unless you open a passing job's log" — rather than closing.
#
# WHY ONE HELPER RATHER THAN TWO BESPOKE MECHANISMS (FOLLOW-765 AC4)
# ──────────────────────────────────────────────────────────────────
# The two inventories differ ONLY in what an "entry" is (a `path (N
# occurrence(s))` line vs. an excluded relative path). The consumer logic —
# parse a committed baseline, cross-check its own declared count against its own
# entry list, diff it against what this run observed, fail loudly on any
# difference, print a copy-pasteable replacement — is identical, and any drift
# between two copies of it would be exactly the "same organ reproduced in the
# sibling gate" failure RETRO-239 flagged (FOLLOW-765 was FOLLOW-759's finding
# re-shipped by the PR that had FOLLOW-759 available to it).
#
# So this helper is deliberately ENTRY-AGNOSTIC: each gate normalises its own
# inventory into opaque one-per-line entry strings and hands them over. Same
# structural choice, and same rationale, as scripts/lib/clean-python-source.sh
# (see that file's header): both gates run as `bash scripts/<gate>.sh` from one
# checkout in one runner, so there is no deployment boundary that would force a
# Rule J mirror pair — a plain `source` makes drift structurally impossible
# instead of merely detectable.
#
# THE CONSUMER CONTRACT
# ─────────────────────
# A baseline file makes every change to a suppression set a DELIBERATE, REVIEWED
# DIFF: adding an allowlist annotation or registering a fourth mirror pair turns
# the gate RED until the baseline is updated in the same PR, where a human sees
# the added line. Silent growth becomes impossible; growth-with-review stays a
# one-line change.
#
# HARD-FAIL, NEVER DEGRADE (same contract as clean-python-source.sh)
# ─────────────────────────────────────────────────────────────────
# A missing/unreadable baseline file is a FAILURE, never "assume it matches" —
# the whole point is that an absent consumer is the bug being fixed. A baseline
# with no `count:` directive, or whose declared count disagrees with its own
# entry list, is also a failure: that shape is what a truncated or
# half-conflict-resolved baseline looks like, and it must not be able to
# silently authorise anything.
# A gate that cannot SOURCE this helper must exit 2 (guard itself is broken) —
# it must not skip the comparison. Both callers assert `declare -F` after
# sourcing.
#
# BASELINE FILE FORMAT
# ────────────────────
#   # free-form comment lines and blank lines are ignored
#   count: 3
#   <entry 1>
#   <entry 2>
#   <entry 3>
#
# Entries are compared as whole lines, sorted with LC_ALL=C, so ordering in the
# file does not matter. The `count:` directive is redundant with the entry list
# ON PURPOSE — it is the cross-check that catches a truncated file.
#
# USAGE
# ─────
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   # shellcheck source=lib/suppression-baseline.sh
#   source "$SCRIPT_DIR/lib/suppression-baseline.sh"
#
#   printf '%s\n' "${entries[@]}" > "$observed"   # may be empty (zero entries)
#   compare_suppression_baseline "Allowlist" "$baseline" "$observed" || rc=$?
#   #   rc 0 → observed set == baseline set (already printed the inventory)
#   #   rc 1 → mismatch / unreadable / self-inconsistent baseline (already
#   #          printed the diff and the FIX text); caller must FAIL its gate.
#
# This file is sourced, never executed; it defines one function and does not set
# shell options (the sourcing gate owns `set -euo pipefail`).

# Prints the observed inventory, compares it against the committed baseline, and
# returns 0 (match) or 1 (mismatch — caller must fail).
#
#   $1 label         — human name for this suppression set, used in all output
#   $2 baseline_file — committed expected-state file (format above)
#   $3 observed_file — this run's entries, one per line (may be empty/absent)
compare_suppression_baseline() {
  local observed_sorted baseline_sorted rc=0
  observed_sorted=$(mktemp)
  baseline_sorted=$(mktemp)
  # Cleanup is done HERE rather than via a RETURN trap: a trap set inside a
  # function has surprising scoping interactions with `set -e` callers, and this
  # helper must be boringly predictable for the two blocking gates that source it.
  _suppression_baseline_impl "$1" "$2" "$3" "$observed_sorted" "$baseline_sorted" || rc=$?
  rm -f "$observed_sorted" "$baseline_sorted"
  return "$rc"
}

_suppression_baseline_impl() {
  local label="$1"
  local baseline_file="$2"
  local observed_file="$3"
  local observed_sorted="$4"
  local baseline_sorted="$5"

  if [[ -f "$observed_file" ]]; then
    LC_ALL=C sort "$observed_file" | grep -v '^[[:space:]]*$' > "$observed_sorted" || true
  fi
  local observed_count
  observed_count=$(wc -l < "$observed_sorted" | tr -d ' ')

  echo "$label — suppression inventory (baseline-checked): $observed_count entry/entries"
  if [[ "$observed_count" -gt 0 ]]; then
    sed 's/^/  /' "$observed_sorted"
  fi

  if [[ ! -f "$baseline_file" ]]; then
    echo ""
    echo "FAIL: $label — committed baseline not found: $baseline_file"
    echo ""
    echo "This gate compares its suppression set against a committed baseline so"
    echo "that growth is a reviewed diff instead of a line in a green job's log"
    echo "(FOLLOW-759 / FOLLOW-765, Rule AJ). A missing baseline is a hard failure:"
    echo "it must never degrade to 'assume the current set is fine'."
    echo ""
    _suppression_baseline_print_expected "$label" "$observed_sorted" "$baseline_file"
    return 1
  fi

  # Parse: `#` comments and blank lines ignored; one `count: N` directive; every
  # other line is an entry.
  local declared_count=""
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^count:[[:space:]]*([0-9]+)[[:space:]]*$ ]]; then
      declared_count="${BASH_REMATCH[1]}"
      continue
    fi
    printf '%s\n' "$line" >> "$baseline_sorted"
  done < "$baseline_file"

  LC_ALL=C sort -o "$baseline_sorted" "$baseline_sorted"
  local baseline_entry_count
  baseline_entry_count=$(wc -l < "$baseline_sorted" | tr -d ' ')

  if [[ -z "$declared_count" ]]; then
    echo ""
    echo "FAIL: $label — baseline $baseline_file has no 'count: N' directive."
    echo "A baseline without its own declared count cannot detect having been"
    echo "truncated, so it is rejected rather than trusted."
    echo ""
    _suppression_baseline_print_expected "$label" "$observed_sorted" "$baseline_file"
    return 1
  fi

  if [[ "$declared_count" -ne "$baseline_entry_count" ]]; then
    echo ""
    echo "FAIL: $label — baseline $baseline_file is self-inconsistent:"
    echo "  declared 'count: $declared_count' but lists $baseline_entry_count entry/entries."
    echo "This is what a truncated or half-resolved-conflict baseline looks like;"
    echo "it must not be able to authorise anything. Fix the file, do not delete it."
    echo ""
    _suppression_baseline_print_expected "$label" "$observed_sorted" "$baseline_file"
    return 1
  fi

  if [[ "$observed_count" -eq "$declared_count" ]] \
    && cmp -s "$observed_sorted" "$baseline_sorted"; then
    echo "  → matches the committed baseline ($baseline_file): $declared_count expected."
    return 0
  fi

  echo ""
  echo "FAIL: $label — the suppression set CHANGED and the committed baseline was"
  echo "not updated with it."
  echo "  baseline: $declared_count entry/entries ($baseline_file)"
  echo "  observed: $observed_count entry/entries (this run)"
  echo ""
  local added removed
  added=$(LC_ALL=C comm -13 "$baseline_sorted" "$observed_sorted" || true)
  removed=$(LC_ALL=C comm -23 "$baseline_sorted" "$observed_sorted" || true)
  if [[ -n "$added" ]]; then
    echo "ADDED (present now, not in the baseline) — a suppression grew:"
    printf '%s\n' "$added" | sed 's/^/  + /'
    echo ""
  fi
  if [[ -n "$removed" ]]; then
    echo "REMOVED (in the baseline, gone now) — a suppression was retired:"
    printf '%s\n' "$removed" | sed 's/^/  - /'
    echo ""
  fi
  echo "Both directions are failures on purpose: an unreviewed ADD widens what the"
  echo "gate stops seeing, and an unreviewed REMOVE means the baseline no longer"
  echo "describes reality, so the next ADD would slip through against a stale file."
  echo ""
  _suppression_baseline_print_expected "$label" "$observed_sorted" "$baseline_file"
  return 1
}

# Prints the copy-pasteable replacement baseline body, so accepting a
# deliberate change is a mechanical, reviewable one-file diff.
_suppression_baseline_print_expected() {
  local label="$1"
  local observed_sorted="$2"
  local baseline_file="$3"
  local n
  n=$(wc -l < "$observed_sorted" | tr -d ' ')
  echo "FIX (only after confirming each entry below is intended — this file IS the"
  echo "review record for $label): write $baseline_file as"
  echo "---8<---"
  echo "# $label baseline — see the gate script header for what an entry means."
  echo "count: $n"
  if [[ "$n" -gt 0 ]]; then
    cat "$observed_sorted"
  fi
  echo "--->8---"
}
