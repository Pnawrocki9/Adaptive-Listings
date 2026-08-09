#!/usr/bin/env bash
# Red-first fixture proof for .claude/hooks/pre-edit-branch-guard.sh (FOLLOW-849,
# sightings 1-6 counted in FOLLOW-909).
#
# WHY THIS EXISTS. The guard shipped worktree-blind: it resolved the repository
# with a bare `git rev-parse --show-toplevel`, which runs in the SESSION's cwd
# (the main checkout), and then read THAT HEAD. Every agent editing inside
# `.claude/worktrees/<name>/` — this repo's standard parallel-work mechanism —
# was told `HEAD == 'main'` while sitting on its correct ticket branch. Six
# independent workers hit it, each paying a verification cost before dismissing
# it. The guard is non-blocking and backlog files are exempt, so the only actors
# who could trip it were the ones with no authority to repair it.
#
# The fix is two lines. THIS FILE is the deliverable: proof that the guard STILL
# FIRES on a genuine `main`-tree edit after being taught about worktrees. A guard
# that has been made quiet is not a fixed guard (RETRO-262: four guards shipped in
# two days that could not fail).
#
# RULE AE (CONVENTIONS_PATCH.md) — enumerate every SHAPE the guarded condition can
# take, not only the shape the reported bug happened to use. The reported bug is
# exactly ONE shape: (session cwd = main tree) x (edited file = existing file in a
# worktree under `.claude/worktrees/`). Cases 3-10 and 15-17 below are shapes that
# defect never exercised, including the two INVERSE shapes where the old code was
# silently WRONG IN THE OTHER DIRECTION (a false NEGATIVE: cwd inside a worktree,
# file on `main` — the old guard said nothing, which is the failure FOLLOW-448
# exists to prevent), and a worktree living OUTSIDE the repo directory, which
# falsifies any "the path contains .claude/worktrees" shortcut fix.
#
# Each case asserts the FULL hook contract, not just the warning:
#   - exit code 0 (a PreToolUse hook that dies non-zero can interfere with the tool);
#   - valid JSON on stdout carrying permissionDecision == "allow" (NON-BLOCKING —
#     FOLLOW-448 chose warn-not-block deliberately and no fix may quietly change it);
#   - additionalContext PRESENT (= WARN) or ABSENT (= SILENT), as expected.
#
# RED-FIRST REPRODUCTION. Point the harness at the pre-fix script and watch the
# proof fail; point it at the fixed one and watch it pass:
#
#   git show <pre-fix-sha>:.claude/hooks/pre-edit-branch-guard.sh > /tmp/old-guard.sh
#   GUARD_UNDER_TEST=/tmp/old-guard.sh bash scripts/__tests__/pre-edit-branch-guard.test.sh   # RED
#   bash scripts/__tests__/pre-edit-branch-guard.test.sh                                      # GREEN
#
# Exit codes: 0 = all assertions passed, 1 = any assertion failed.
# Run: bash scripts/__tests__/pre-edit-branch-guard.test.sh

set -uo pipefail # no -e: we inspect non-zero exits ourselves

ROOT="$(git rev-parse --show-toplevel)"
GUARD="${GUARD_UNDER_TEST:-$ROOT/.claude/hooks/pre-edit-branch-guard.sh}"

if [[ ! -f "$GUARD" ]]; then
  echo "FATAL: guard under test not found: $GUARD"
  exit 1
fi

FAILURES=0
CASES=0

# `pwd -P` because `git rev-parse --show-toplevel` resolves symlinks and mktemp
# hands back a symlinked path on some platforms; without it the repo-relative
# path assertion in case 1 would fail for a reason unrelated to the guard.
SANDBOX="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$SANDBOX"' EXIT

MAIN="$SANDBOX/repo"                  # the "main checkout", HEAD == main
WT="$MAIN/.claude/worktrees/wt"       # linked worktree on a ticket branch
WT_MASTER="$MAIN/.claude/worktrees/wt-master" # linked worktree whose HEAD IS master
WT_EXTERNAL="$SANDBOX/external-wt"    # linked worktree OUTSIDE the repo directory
OTHER="$SANDBOX/other-repo"           # an unrelated repository, HEAD == main
OUTSIDE="$SANDBOX/outside"            # not a git repository at all

# --no-verify: a globally configured core.hooksPath (lefthook) must not run here.
git_commit() { git -C "$1" -c user.email=t@example.com -c user.name=t commit -q --no-verify -m "$2"; }

git init -q -b main "$MAIN"
mkdir -p "$MAIN/backlog" "$MAIN/docs" "$MAIN/.claude/hooks"
echo "queue" >"$MAIN/backlog/QUEUE.md"
echo "followups" >"$MAIN/backlog/FOLLOW_UPS.md"
echo "patch" >"$MAIN/CONVENTIONS_PATCH.md"
echo "doc" >"$MAIN/docs/app.md"
echo "hook" >"$MAIN/.claude/hooks/pre-edit-branch-guard.sh"
git -C "$MAIN" add -A
git_commit "$MAIN" "init"

git -C "$MAIN" worktree add -q -b agent/TICKET-001-slug "$WT" >/dev/null 2>&1
git -C "$MAIN" worktree add -q -b master "$WT_MASTER" >/dev/null 2>&1
git -C "$MAIN" worktree add -q -b agent/TICKET-002-slug "$WT_EXTERNAL" >/dev/null 2>&1
mkdir -p "$WT/apps/ingest/src"
echo "deep" >"$WT/apps/ingest/src/handler.ts"

git init -q -b main "$OTHER"
echo "other" >"$OTHER/file.md"
git -C "$OTHER" add -A
git_commit "$OTHER" "init"

mkdir -p "$OUTSIDE"
echo "loose" >"$OUTSIDE/notes.md"

# ── harness ────────────────────────────────────────────────────────────────────
# run_guard <cwd> <tool_name> <file_path> [ENV=VALUE ...]
OUT=""
CODE=0
run_guard() {
  local cwd="$1" tool="$2" path="$3"
  shift 3
  local payload
  payload="$(jq -nc --arg t "$tool" --arg p "$path" '{tool_name: $t, tool_input: {file_path: $p}}')"
  OUT="$(cd "$cwd" && printf '%s' "$payload" | env "$@" bash "$GUARD" 2>&1)"
  CODE=$?
}

# run_bash_guard <cwd> <command> [ENV=VALUE ...] — FOLLOW-910.
# The Bash guard takes a different payload shape ({command}) and has no file to
# attribute against, so it resolves HEAD from the cwd. Everything downstream —
# exit 0, permissionDecision "allow", additionalContext present/absent — is the
# SAME hook contract, so expect_case and the assert_context_* helpers are reused
# rather than duplicated (FOLLOW-910 AC(2)).
BASH_GUARD="${BASH_GUARD_UNDER_TEST:-$ROOT/.claude/hooks/pre-bash-guard.sh}"
run_bash_guard() {
  local cwd="$1" command="$2"
  shift 2
  local payload
  payload="$(jq -nc --arg c "$command" '{tool_name: "Bash", command: $c}')"
  OUT="$(cd "$cwd" && printf '%s' "$payload" | env "$@" bash "$BASH_GUARD" 2>&1)"
  CODE=$?
  # A silent Bash guard prints NOTHING (it is not a JSON-always hook), whereas
  # expect_case requires a decision object. Normalise the silent case here so the
  # two guards can share one set of assertions.
  if [[ -z "$OUT" ]]; then
    OUT='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
  fi
}

# expect_case <label> <WARN|SILENT>
expect_case() {
  local label="$1" expected="$2"
  CASES=$((CASES + 1))
  local decision context

  if [[ $CODE -ne 0 ]]; then
    echo "FAIL: $label — hook exited $CODE; a PreToolUse hook must always exit 0."
    echo "--- output ---"
    echo "$OUT"
    echo "--------------"
    FAILURES=$((FAILURES + 1))
    return
  fi

  if ! decision="$(jq -er '.hookSpecificOutput.permissionDecision' <<<"$OUT" 2>/dev/null)"; then
    echo "FAIL: $label — stdout is not JSON carrying .hookSpecificOutput.permissionDecision."
    echo "--- output ---"
    echo "$OUT"
    echo "--------------"
    FAILURES=$((FAILURES + 1))
    return
  fi

  if [[ "$decision" != "allow" ]]; then
    echo "FAIL: $label — permissionDecision is '$decision'; the guard is NON-BLOCKING by design (FOLLOW-448)."
    FAILURES=$((FAILURES + 1))
    return
  fi

  context="$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT")"

  case "$expected" in
    WARN)
      if [[ -n "$context" ]]; then
        echo "PASS: $label — WARNS, as required."
      else
        echo "FAIL: $label — SILENT, but the guard MUST fire here."
        FAILURES=$((FAILURES + 1))
      fi
      ;;
    SILENT)
      if [[ -z "$context" ]]; then
        echo "PASS: $label — silent, as required."
      else
        echo "FAIL: $label — WARNED (false positive). Context was:"
        echo "  $context"
        FAILURES=$((FAILURES + 1))
      fi
      ;;
    *)
      echo "FAIL: $label — bad expectation '$expected' in the harness itself."
      FAILURES=$((FAILURES + 1))
      ;;
  esac
}

assert_context_contains() {
  local label="$1" needle="$2"
  CASES=$((CASES + 1))
  local context
  context="$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT" 2>/dev/null)"
  if grep -qF -- "$needle" <<<"$context"; then
    echo "PASS: $label — warning text contains \"$needle\"."
  else
    echo "FAIL: $label — warning text does NOT contain \"$needle\". Text was:"
    echo "  $context"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_context_lacks() {
  local label="$1" needle="$2"
  CASES=$((CASES + 1))
  local context
  context="$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT" 2>/dev/null)"
  if grep -qF -- "$needle" <<<"$context"; then
    echo "FAIL: $label — warning text unexpectedly contains \"$needle\". Text was:"
    echo "  $context"
    FAILURES=$((FAILURES + 1))
  else
    echo "PASS: $label — warning text does not contain \"$needle\"."
  fi
}

echo "=== FOLLOW-849 red-first fixture proof — guard under test: $GUARD ==="
echo "sandbox: $SANDBOX"
echo ""

# ── A. THE GUARD MUST STILL FIRE (the deliverable) ─────────────────────────────
echo "--- A. the guard still fires on genuine main-tree edits ---"

# 1. The original, unchanged reason the guard exists: an ordinary source edit
#    made on the main checkout while HEAD == main.
run_guard "$MAIN" Edit "$MAIN/docs/app.md"
expect_case "A1 main-tree edit, existing file, cwd = main tree" WARN
assert_context_contains "A1 names the repo-relative path" "docs/app.md"
assert_context_lacks "A1 does not leak the absolute path (REL_PATH still derived)" "$MAIN/docs/app.md"

# 2. NEW SHAPE (the defect never exercised it): a Write creating a file whose
#    parent directory does not exist yet. Resolving the edited path's worktree
#    means walking UP to an existing ancestor; if that walk is wrong or absent,
#    every new-file Write on main goes unguarded — a silent hole opened BY the fix.
run_guard "$MAIN" Write "$MAIN/apps/brand-new/src/feature.ts"
expect_case "A2 main-tree WRITE of a new file under a not-yet-existing directory" WARN

# 3. NEW SHAPE, INVERSE OF THE REPORTED BUG, and the dangerous direction: the
#    session cwd is inside a worktree on a ticket branch while the edit lands on
#    the MAIN checkout. Pre-fix this was SILENT — a false NEGATIVE on exactly the
#    stranded-work-on-main failure FOLLOW-448 exists to catch.
run_guard "$WT" Edit "$MAIN/docs/app.md"
expect_case "A3 main-tree file edited while cwd is a worktree on a ticket branch" WARN

# 4. NEW SHAPE: an unrelated repository that is itself on main, edited from a
#    worktree cwd. Pre-fix: silent.
run_guard "$WT" Edit "$OTHER/file.md"
expect_case "A4 unrelated repo on main, edited while cwd is a ticket-branch worktree" WARN

# 5. NEW SHAPE and the falsifier for a lazy fix: a linked worktree whose OWN HEAD
#    is `master`. A fix that special-cases "the path is inside a worktree" instead
#    of reading that worktree's HEAD passes every other case here and fails this one.
run_guard "$MAIN" Edit "$WT_MASTER/docs/app.md"
expect_case "A5 worktree whose own HEAD is master" WARN

# 6. `.claude/hooks/**` is deliberately NOT exempt: a hook edited directly on main
#    changes every agent's guardrails with no PR. Pinned so a future widening of
#    the exemption is a visible, deliberate change to this file.
run_guard "$MAIN" Edit "$MAIN/.claude/hooks/pre-edit-branch-guard.sh"
expect_case "A6 .claude/hooks/** on main is NOT exempt" WARN

# 7. A relative file_path has no worktree of its own to resolve against, so it is
#    interpreted against the session cwd — documented fallback, pinned here.
run_guard "$MAIN" Edit "docs/app.md"
expect_case "A7 relative file_path falls back to the session cwd" WARN

# ── B. THE BUG: the guard must be silent inside worktrees ──────────────────────
echo ""
echo "--- B. silent for edits that belong to a worktree on a ticket branch ---"

# 8. THE REPORTED SHAPE (sightings 1-6): existing file in a worktree, cwd = main.
run_guard "$MAIN" Edit "$WT/docs/app.md"
expect_case "B1 worktree edit, existing file, cwd = main tree (the reported bug)" SILENT

# 9. NEW SHAPE: deep nested path inside the worktree — resolution must not depend
#    on depth.
run_guard "$MAIN" Edit "$WT/apps/ingest/src/handler.ts"
expect_case "B2 worktree edit, deeply nested existing path" SILENT

# 10. NEW SHAPE: Write of a new file in a not-yet-existing directory inside the
#     worktree — the walk-up must land in the WORKTREE, not the main checkout.
run_guard "$MAIN" Write "$WT/apps/brand-new/src/feature.ts"
expect_case "B3 worktree WRITE of a new file under a not-yet-existing directory" SILENT

# 11. NEW SHAPE: a linked worktree that does NOT live under `.claude/worktrees/`.
#     Falsifies any path-substring shortcut.
run_guard "$MAIN" Edit "$WT_EXTERNAL/docs/app.md"
expect_case "B4 linked worktree located outside the repo directory" SILENT

# ── C. exemptions and overrides must survive the fix ───────────────────────────
echo ""
echo "--- C. pre-existing exemptions still work (REL_PATH moved with the fix) ---"

run_guard "$MAIN" Edit "$MAIN/backlog/QUEUE.md"
expect_case "C1 backlog/QUEUE.md on main is exempt" SILENT

run_guard "$MAIN" Edit "$MAIN/backlog/FOLLOW_UPS.md"
expect_case "C2 backlog/FOLLOW_UPS.md on main is exempt" SILENT

run_guard "$MAIN" Edit "$MAIN/CONVENTIONS_PATCH.md"
expect_case "C3 repo-root CONVENTIONS_PATCH.md on main is exempt" SILENT

run_guard "$MAIN" Edit "$MAIN/docs/app.md" ESTALARA_ALLOW_MAIN_EDITS=1
expect_case "C4 ESTALARA_ALLOW_MAIN_EDITS=1 silences a non-exempt main edit" SILENT

run_guard "$MAIN" Bash "$MAIN/docs/app.md"
expect_case "C5 non-write tool is ignored" SILENT

# ── D. cannot-attribute cases must FAIL SILENT (AC(3)) ─────────────────────────
echo ""
echo "--- D. when the edit cannot be attributed to a worktree, stay quiet ---"

# 12. NEW SHAPE: a path in no git repository at all, from a main-tree cwd.
#     Pre-fix this warned — a false positive about a file git has never heard of.
run_guard "$MAIN" Edit "$OUTSIDE/notes.md"
expect_case "D1 path outside any git repository" SILENT

# 13. NEW SHAPE: no file_path in the payload. Nothing to attribute; AC(3) says be
#     quiet rather than guess from the session cwd.
run_guard "$MAIN" Edit ""
expect_case "D2 empty file_path" SILENT

# ── E. the Bash-shaped edit (FOLLOW-910) ───────────────────────────────────────
# Every WARN case below was SILENT before FOLLOW-910: `.claude/settings.json`
# routes Bash to pre-bash-guard.sh, which grepped for `git push` to main and
# nothing else. The FOLLOW-849 worker made every edit in its ticket through Bash
# and the guard never fired once.
#
# RED-FIRST REPRODUCTION for this half:
#   git show <pre-910-sha>:.claude/hooks/pre-bash-guard.sh > /tmp/old-bash-guard.sh
#   BASH_GUARD_UNDER_TEST=/tmp/old-bash-guard.sh bash scripts/__tests__/pre-edit-branch-guard.test.sh
echo ""
echo "--- E. Bash-shaped edits on main are seen (FOLLOW-910) ---"

run_bash_guard "$MAIN" "sed -i s/a/b/ docs/app.md"
expect_case "E1 sed -i on a repo file" WARN
assert_context_contains "E1 names the repo-relative path" "docs/app.md"

run_bash_guard "$MAIN" "cat > docs/app.md <<'EOF'
new content
EOF"
expect_case "E2 heredoc redirected into a repo file" WARN

run_bash_guard "$MAIN" "python3 - <<'PY'
open('docs/app.md', 'w').write('x')
PY"
expect_case "E3 interpreter heredoc writing a repo file (this session's own editing shape)" WARN
assert_context_contains "E3 names the path found inside the heredoc" "docs/app.md"

run_bash_guard "$MAIN" "echo x | tee docs/app.md"
expect_case "E4 tee into a repo file" WARN

run_bash_guard "$WT" "sed -i s/a/b/ apps/ingest/src/handler.ts"
expect_case "E5 the same edit from a worktree on a ticket branch" SILENT

# ── F. the false-positive surface named in FOLLOW-910 AC(3) ────────────────────
# A guard that greps command text will see a verb inside a string, a write that
# never touches the repo, and a redirection to /dev/null. Each must stay SILENT
# or the warning stops being believable — which is the whole finding of FOLLOW-849.
echo ""
echo "--- F. scoped to real writes under the repo root (AC(3)) ---"

run_bash_guard "$MAIN" 'echo "sed -i s/a/b/ docs/app.md"'
expect_case "F1 a write verb inside a quoted string is not a write" SILENT

run_bash_guard "$MAIN" "git show > /dev/null"
expect_case "F2 redirection to /dev/null" SILENT

run_bash_guard "$MAIN" "cat > /tmp/scratch.txt <<'EOF'
data
EOF"
expect_case "F3 heredoc writing outside the repository" SILENT

run_bash_guard "$MAIN" "grep -rn foo docs/"
expect_case "F4 a pure read" SILENT

run_bash_guard "$MAIN" "sed -i s/a/b.c/ backlog/QUEUE.md"
expect_case "F5 a sed SCRIPT containing a dot is not a second target" SILENT

run_bash_guard "$MAIN" "sed -i s/a/b/ backlog/QUEUE.md"
expect_case "F6 the pm-orchestrator's exempt backlog files, edited through Bash" SILENT

run_bash_guard "$MAIN" "sed -i s/a/b/ docs/app.md" ESTALARA_ALLOW_MAIN_EDITS=1
expect_case "F7 ESTALARA_ALLOW_MAIN_EDITS=1 silences the Bash guard too" SILENT

run_bash_guard "$OUTSIDE" "sed -i s/a/b/ notes.md"
expect_case "F8 a cwd in no git repository" SILENT

# ── G. the blocking guards are untouched ───────────────────────────────────────
# pre-bash-guard.sh had FIVE blocking rules and zero test coverage before this
# ticket. Adding a non-blocking warning must not disturb them, and the guard's
# blocking half must not be quietly converted into a warning.
echo ""
echo "--- G. the pre-existing blocking guards still block ---"

CASES=$((CASES + 1))
BLOCK_OUT="$(cd "$MAIN" && jq -nc '{tool_name:"Bash", command:"git push origin main"}' | bash "$BASH_GUARD" 2>&1)"
BLOCK_CODE=$?
if [[ $BLOCK_CODE -eq 0 ]]; then
  echo "FAIL: G1 — 'git push origin main' exited 0; guard 1 must BLOCK (exit non-zero)."
  echo "$BLOCK_OUT"
  FAILURES=$((FAILURES + 1))
else
  echo "PASS: G1 direct push to main is still blocked (exit $BLOCK_CODE)"
fi

CASES=$((CASES + 1))
BLOCK_OUT="$(cd "$MAIN" && jq -nc '{tool_name:"Bash", command:"cat .env"}' | bash "$BASH_GUARD" 2>&1)"
BLOCK_CODE=$?
if [[ $BLOCK_CODE -eq 0 ]]; then
  echo "FAIL: G2 — 'cat .env' exited 0; guard 4 must BLOCK."
  FAILURES=$((FAILURES + 1))
else
  echo "PASS: G2 reading .env is still blocked (exit $BLOCK_CODE)"
fi

echo ""
if [[ $FAILURES -eq 0 ]]; then
  echo "=== PASS — $CASES assertions, 0 failures. ==="
  exit 0
fi
echo "=== FAIL — $CASES assertions, $FAILURES failure(s). ==="
exit 1
