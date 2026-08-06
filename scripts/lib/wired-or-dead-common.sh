#!/usr/bin/env bash
# Shared preflight + self-test fixtures for the wired-or-dead gate PAIR.
#
# WHY THIS FILE EXISTS (FOLLOW-857 AC(3) / RETRO-253 §4a).
# scripts/check-rule-h.sh (Pattern 2) and scripts/check-rule-i.sh do the same
# job — "does this exported symbol have a non-test importer?" — over the same
# shape of grep pipeline. They diverged silently: check-rule-i.sh received the
# `consumer_count=$(( consumer_count + 0 ))` normalisation and the per-stage
# `{ ... || true; }` guards on 2026-05-17, three days after check-rule-h.sh
# shipped WITHOUT them, and nobody ever diffed the pair. The consequence was
# that Rule H's Pattern 2 could not fail for 84 days: `| wc -l || echo 0` under
# `pipefail` produced the two-line string "0\n0" precisely when the count was
# zero, `[[ "0\n0" -lt 1 ]]` is an arithmetic SYNTAX ERROR (therefore false
# inside an `if`), and the hard gate printed `OK:` over a genuine orphan export.
#
# The remedy is not a third rule, it is a single definition of the things that
# drifted: the dependency preflight, the repo-root guard, and — above all — ONE
# fixture pair that BOTH gates are asserted against in CI. If either gate stops
# failing on an orphan export, the shared fixture goes red in the other gate's
# self-test too.
#
# This file is SOURCED, never executed. It must stay side-effect free at source
# time: define functions, touch no globals, print nothing.
#
# Consumers: scripts/check-rule-h.sh, scripts/check-rule-i.sh
# Exit-code vocabulary shared by both gates:
#   0 = clean verdict, 1 = violations found, 3 = NO VERDICT (could not run).
#   3 is not a milder 1 and is emphatically not a 0.

# ── Preflight helpers ─────────────────────────────────────────────────────────

# wod_require_bash4 — the `mapfile` builtin and ${BASH_VERSINFO} both need >= 4.
wod_require_bash4() {
  if [[ -z "${BASH_VERSINFO[0]:-}" || "${BASH_VERSINFO[0]}" -lt 4 ]]; then
    echo "ERROR: PREFLIGHT FAILED — bash >= 4 is required (the 'mapfile' builtin)." >&2
    echo "  Found: ${BASH_VERSION:-unknown}. macOS ships bash 3.2 as /bin/bash;" >&2
    echo "  install a newer bash (brew install bash) and re-run." >&2
    exit 3
  fi
}

# wod_require_commands <cmd>... — every named command must be on PATH.
wod_require_commands() {
  local cmd missing=""
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || missing="$missing $cmd"
  done
  if [[ -n "$missing" ]]; then
    echo "ERROR: PREFLIGHT FAILED — required command(s) not on PATH:$missing" >&2
    exit 3
  fi
}

# wod_probe_pcre <gate-label> <pcre-pattern> <probe-input> <expected-output>
#
# Probes the EXACT `grep -oP ... \K ...` construct the calling gate extracts
# symbols with, rather than merely asking "does -P exist". A grep whose PCRE
# build lacks \K would pass a weaker probe and still extract nothing — and both
# gates run without `set -e` on that grep, so an extractor that returns nothing
# yields an empty symbol loop, zero violations, and a green over a repo full of
# dead exports. Refuse to run degraded. A named exit 3, never a verdict.
wod_probe_pcre() {
  local label="$1" pattern="$2" input="$3" expected="$4" got
  got="$(printf '%s\n' "$input" | grep -oP "$pattern" 2>/dev/null || true)"
  if [[ "$got" != "$expected" ]]; then
    echo "ERROR: PREFLIGHT FAILED — this 'grep' cannot run the ${label} symbol extractor." >&2
    echo "  grep: $(command -v grep 2>/dev/null || echo 'not found')" >&2
    echo "  Probe input : ${input}" >&2
    echo "  Probe returned '${got}', expected '${expected}'. PCRE (-P) with \\K is a" >&2
    echo "  GNU grep extension; BSD/macOS/busybox grep does not have it." >&2
    echo "  Without it EVERY symbol extraction returns nothing, and because the" >&2
    echo "  extraction is deliberately not fatal the result would be zero" >&2
    echo "  violations and a passing gate over a repo full of dead exports." >&2
    echo "  Refusing to run degraded. Install GNU grep (brew install grep) and re-run." >&2
    exit 3
  fi
}

# wod_resolve_repo_root — resolve the repo root and cd into it, or exit 3.
#
# Guard R1: `ROOT="$(git rev-parse --show-toplevel)"` unguarded is a fail-open.
# With git missing or outside a working tree ROOT becomes "" and `cd ""` is a
# SUCCESSFUL no-op in bash, so the scan runs against whatever the caller's cwd
# happened to be — typically finding no packages/ at all and reporting clean.
wod_resolve_repo_root() {
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -z "$root" ]]; then
    echo "ERROR: PREFLIGHT FAILED — not inside a git working tree." >&2
    echo "  'git rev-parse --show-toplevel' produced nothing, so there is no repo" >&2
    echo "  root to scan. Running from the current directory instead would report" >&2
    echo "  a clean pass over a tree that contains none of the code this gates." >&2
    exit 3
  fi
  cd "$root" || {
    echo "ERROR: PREFLIGHT FAILED — cannot cd into repo root '$root'." >&2
    exit 3
  }
}

# ── Shared self-test fixtures ─────────────────────────────────────────────────
#
# ONE definition of "an orphan export" and "a wired export", built so that BOTH
# gates can be run against the very same throwaway repo:
#
#   * the symbol lives at packages/a/src/lib/<stem>.ts, which satisfies Rule H's
#     `src/lib/[^/]+\.ts$` added-file filter AND Rule I's `*/src/*` find filter;
#   * the file is ADDED on a work branch off `main`, because Rule H only ever
#     inspects files the diff adds (`--diff-filter=A base...HEAD`);
#   * apps/ and packages/ both exist, because both gates grep them by name;
#   * scripts/check-adapt-schema-drift.sh is a PASSING STUB. Rule H delegates its
#     third pattern to that script; the real one needs node plus the SDK sources.
#     Stubbing it keeps these fixtures about Pattern 2 and nothing else — the
#     real adapt gate is exercised by the real repo run, not here.
#
# Hermetic and offline: nothing below reads the real repo's state, so a fixture
# cannot pass because the repo happens to be in a convenient condition.

# wod_fixture_repo <parent-dir> <name> <mode: wired|orphan>
# Prints the path of the built repo on stdout.
wod_fixture_repo() {
  local mode="$3" d="$1/$2"
  mkdir -p "$d/apps" "$d/packages/a/src/lib" "$d/scripts"

  {
    echo '#!/usr/bin/env bash'
    echo '# Fixture stub — the real adapt-schema comparator needs node + the SDK.'
    echo 'exit 0'
  } > "$d/scripts/check-adapt-schema-drift.sh"
  chmod +x "$d/scripts/check-adapt-schema-drift.sh"
  : > "$d/apps/.gitkeep"

  git -c init.defaultBranch=main init -q "$d" >/dev/null 2>&1
  git -C "$d" -c user.email=fixture@example.invalid -c user.name=fixture \
    add -A >/dev/null 2>&1
  git -C "$d" -c user.email=fixture@example.invalid -c user.name=fixture \
    commit -qm "fixture base" >/dev/null 2>&1
  git -C "$d" checkout -q -b work >/dev/null 2>&1

  if [[ "$mode" == "wired" ]]; then
    echo 'export const wiredFixtureHelper = 1;' > "$d/packages/a/src/lib/util.ts"
    {
      echo "import { wiredFixtureHelper } from './lib/util';"
      echo 'console.log(wiredFixtureHelper);'
    } > "$d/packages/a/src/main.ts"
  else
    echo 'export const orphanFixtureSymbol = 1;' > "$d/packages/a/src/lib/orphan.ts"
  fi

  git -C "$d" -c user.email=fixture@example.invalid -c user.name=fixture \
    add -A >/dev/null 2>&1
  git -C "$d" -c user.email=fixture@example.invalid -c user.name=fixture \
    commit -qm "fixture change" >/dev/null 2>&1

  printf '%s\n' "$d"
}

# wod_run_shared_fixtures <gate-script> <label> <orphan-needle> <wired-needle> [gate-args...]
#
# Runs the SAME two fixture repos through the caller's gate and asserts the only
# two facts that matter for the wired-or-dead pair:
#   orphan repo → exit 1, says <orphan-needle>, and never says "<label> passed"
#   wired  repo → exit 0, says <wired-needle>            (the positive control)
#
# Sets WOD_SHARED_PASSES / WOD_SHARED_FAILURES for the caller to fold in.
wod_run_shared_fixtures() {
  local gate="$1" label="$2" orphan_needle="$3" wired_needle="$4"
  shift 4
  local tmp out rc dir
  WOD_SHARED_PASSES=0
  WOD_SHARED_FAILURES=0
  tmp="$(mktemp -d)"
  out="$tmp/out.txt"

  # -- orphan: the gate MUST fail, for the stated reason -----------------------
  dir="$(wod_fixture_repo "$tmp" orphan orphan)"
  rc=0
  (cd "$dir" && bash "$gate" "$@") > "$out" 2>&1 || rc=$?
  if [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL [shared fixture] $label on an orphan export: expected exit 1, got $rc"
    echo "--- gate output ---"
    cat "$out"
    echo "-------------------"
    WOD_SHARED_FAILURES=$((WOD_SHARED_FAILURES + 1))
  elif ! grep -qF -- "$orphan_needle" "$out"; then
    echo "SELF-TEST FAIL [shared fixture] $label exited 1 but never said '$orphan_needle'"
    echo "  — the right verdict for the wrong reason is not a pass."
    echo "--- gate output ---"
    cat "$out"
    echo "-------------------"
    WOD_SHARED_FAILURES=$((WOD_SHARED_FAILURES + 1))
  elif grep -qF -- "$label passed" "$out"; then
    echo "SELF-TEST FAIL [shared fixture] $label ALSO printed '$label passed' over an orphan."
    echo "--- gate output ---"
    cat "$out"
    echo "-------------------"
    WOD_SHARED_FAILURES=$((WOD_SHARED_FAILURES + 1))
  else
    WOD_SHARED_PASSES=$((WOD_SHARED_PASSES + 1))
    echo "OK: shared fixture PASSED — $label FAILS on an orphan lib export"
  fi

  # -- wired: the positive control. A gate that fails everything is useless ----
  dir="$(wod_fixture_repo "$tmp" wired wired)"
  rc=0
  (cd "$dir" && bash "$gate" "$@") > "$out" 2>&1 || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    echo "SELF-TEST FAIL [shared fixture] $label on a WIRED export: expected exit 0, got $rc"
    echo "--- gate output ---"
    cat "$out"
    echo "-------------------"
    WOD_SHARED_FAILURES=$((WOD_SHARED_FAILURES + 1))
  elif ! grep -qF -- "$wired_needle" "$out"; then
    echo "SELF-TEST FAIL [shared fixture] $label exited 0 but never said '$wired_needle'"
    echo "  — a pass earned by checking nothing is the failure mode under test."
    echo "--- gate output ---"
    cat "$out"
    echo "-------------------"
    WOD_SHARED_FAILURES=$((WOD_SHARED_FAILURES + 1))
  else
    WOD_SHARED_PASSES=$((WOD_SHARED_PASSES + 1))
    echo "OK: shared fixture PASSED — $label PASSES on a wired lib export"
  fi

  rm -rf "$tmp"
}
