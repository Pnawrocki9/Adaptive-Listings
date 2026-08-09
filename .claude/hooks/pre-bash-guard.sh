#!/usr/bin/env bash
# .claude/hooks/pre-bash-guard.sh
#
# Runs before every Bash tool use, on top of the deny list in settings.json.
# Adds context-aware guards that the simple deny list can't express.
#
# Reads the proposed command from stdin (Claude Code passes the tool input here).
# Exits non-zero to block the command with a message printed to stderr.

set -euo pipefail

INPUT="$(cat)"
COMMAND=$(echo "$INPUT" | jq -r '.command // empty' 2>/dev/null || echo "")

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# Guard 1: never let an agent push to main directly
if echo "$COMMAND" | grep -qE 'git push.*\b(main|master)\b'; then
  echo "BLOCKED: Direct push to main/master is forbidden. Open a PR instead." >&2
  exit 1
fi

# Guard 2: never run production deploys
if echo "$COMMAND" | grep -qE '(wrangler.*--env.*production|vercel.*--prod|terraform apply.*production)'; then
  echo "BLOCKED: Production deploys require human approval via tagged release workflow." >&2
  exit 1
fi

# Guard 3: never run npm publish (we don't publish to npm in MVP)
if echo "$COMMAND" | grep -qE '\b(npm|pnpm|yarn) publish\b'; then
  echo "BLOCKED: Package publishing requires human approval." >&2
  exit 1
fi

# Guard 4: protect .env files
if echo "$COMMAND" | grep -qE '(cat|less|head|tail|cp|mv).*\.env\b'; then
  echo "BLOCKED: Reading .env files is forbidden. Use Doppler or .env.example." >&2
  exit 1
fi

# Guard 5: rm -rf protections beyond settings.json
# shellcheck disable=SC2016  # `$HOME` and `$` are regex literals for grep, not
# shell expansions — expanding them here would make the pattern match the
# operator's actual home directory instead of the string `$HOME` in the command.
# Pre-existing; surfaced when FOLLOW-910 added this file to the shellcheck job.
if echo "$COMMAND" | grep -qE 'rm\s+-rf?\s+(/|~|\$HOME|\.git\b|node_modules\s|\.\s|\*$)'; then
  echo "BLOCKED: Suspicious rm -rf pattern. Be more specific or escalate." >&2
  exit 1
fi

# ── Guard 6 (FOLLOW-910): the branch warning, for edits made through Bash ────────
#
# WHY. `.claude/settings.json` routes Edit|Write|MultiEdit to
# pre-edit-branch-guard.sh and Bash to this file — and this file used to grep for
# exactly one thing, `git push` to main. So a file edit performed through Bash
# (`sed -i`, `cat > f <<EOF`, `tee`, `python3 - <<'PY'`) was completely unguarded
# on main. That is not a corner case: the FOLLOW-849 worker made EVERY edit in its
# ticket through Bash and the guard never fired once, and the main-loop
# orchestrator is instructed to prefer Bash for file operations — so the dominant
# editing path in this repo was the one shape the guard could not see.
#
# NON-BLOCKING, like its Edit-side twin (FOLLOW-448, and FOLLOW-910 AC(4)): the
# value of this guard is a believable warning, and credibility is the scarce
# resource. It never blocks, and it stays SILENT unless it can point at a real
# write to a real repo file.
#
# WHAT IT DELIBERATELY CANNOT SEE (stated, not silently missing — Rule AS): a
# write performed inside an interpreter heredoc whose target is computed at
# runtime rather than written as a literal. The heredoc case below catches the
# common form (a quoted path literal beside a write call); a path built by string
# concatenation is invisible here and is left to the Edit-side guard and review.

if [[ "${ESTALARA_ALLOW_MAIN_EDITS:-}" == "1" ]]; then
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
[[ -n "$REPO_ROOT" ]] || exit 0

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
if [[ "$BRANCH" != "main" && "$BRANCH" != "master" ]]; then
  exit 0
fi

# Quoted spans lose their CONTENTS before verb detection, so `echo "sed -i x"`
# and `grep '> file'` are not read as writes (FOLLOW-910 AC(3)).
strip_quoted() {
  sed -E "s/'[^']*'/''/g; s/\"[^\"]*\"/\"\"/g" <<<"$1"
}

# The command proper stops at the first heredoc marker; everything after it is
# data, not shell syntax, and must not be scanned for redirection operators.
COMMAND_HEAD="${COMMAND%%<<*}"
HEAD_STRIPPED="$(strip_quoted "$COMMAND_HEAD")"

declare -a TARGETS=()
UNRESOLVED_WRITE=0

collect() { [[ -z "${1:-}" ]] || TARGETS+=("$1"); }

# `>` / `>>` redirections.
while read -r tgt; do
  collect "${tgt##*[>[:space:]]}"
done < <(grep -oE '>>?[[:space:]]*[^[:space:];|&()<>]+' <<<"$HEAD_STRIPPED" || true)

# In-place editors and writers: every non-flag argument is a candidate target.
if grep -qE '(^|[;|&[:space:]])(sed|perl)([[:space:]]+-[^[:space:]]*)*[[:space:]]+-[^[:space:]]*i' <<<"$HEAD_STRIPPED" ||
  grep -qE '(^|[;|&[:space:]])(tee|cp|mv|install|truncate)([[:space:]]|$)' <<<"$HEAD_STRIPPED"; then
  while read -r tok; do
    [[ "$tok" == -* ]] && continue
    case "$tok" in
      sed | perl | tee | cp | mv | install | truncate | '' | *=*) continue ;;
    esac
    # A sed/perl SCRIPT is not a file: `s/a/b/`, `y/x/y/`, `1,3d/`. Without this
    # the expression itself is collected as a target and every `sed -i` warns,
    # including on files the exemption list is supposed to silence.
    [[ "$tok" =~ ^[0-9,\$]*[sydpaic]/ ]] && continue
    if [[ -e "$tok" ]]; then
      collect "$tok"
      continue
    fi
    # Not on disk: accept only something shaped like a path to a named file, so
    # a stray flag value or regex fragment does not become a "write target".
    base="${tok##*/}"
    [[ "$tok" != */ && "$base" == *.* ]] && collect "$tok"
  done < <(tr -s '[:blank:]' '\n' <<<"$HEAD_STRIPPED" || true)
fi

# An interpreter fed by a heredoc: look for a write call, then for the path
# literals beside it. `python3 - <<'PY' … open(p,"w") … PY` is the dominant
# editing shape in this repo and produces no redirection to find.
if grep -qE '(^|[;|&[:space:]])(python3?|node|perl|ruby)([[:space:]]+-[^[:space:]]*)*[[:space:]]*-?[[:space:]]*<<' <<<"$COMMAND" &&
  grep -qE "open\(|\.write\(|write_text\(|writeFileSync|>>?[[:space:]]*[\"']" <<<"$COMMAND"; then
  before="${#TARGETS[@]}"
  while read -r lit; do
    lit="${lit//\'/}"
    lit="${lit//\"/}"
    [[ "$lit" == */* ]] && collect "$lit"
  done < <(grep -oE "['\"][^'\"]*\.[A-Za-z0-9_]+['\"]" <<<"$COMMAND" || true)
  [[ "${#TARGETS[@]}" -gt "$before" ]] || UNRESOLVED_WRITE=1
fi

# Backlog bookkeeping files are legitimately edited directly on main by the
# pm-orchestrator (docs/AGENT_WORKFLOW.md "state files"), exactly as the
# Edit-side guard exempts them.
EXEMPT_RE='backlog/(QUEUE|ESCALATIONS|STATUS|HANDOFFS|RETROSPECTIVES|FOLLOW_UPS)\.md$|(^|/)CONVENTIONS_PATCH\.md$'

declare -a HITS=()
for target in ${TARGETS[@]+"${TARGETS[@]}"}; do
  case "$target" in
    /dev/* | /tmp/* | /proc/* | /sys/*) continue ;;
  esac
  if [[ "$target" = /* ]]; then
    abs="$target"
  else
    abs="$PWD/$target"
  fi
  # Outside the repository (a scratchpad, another checkout) is not our business.
  [[ "$abs" == "$REPO_ROOT/"* ]] || continue
  rel="${abs#"$REPO_ROOT"/}"
  [[ "$rel" =~ $EXEMPT_RE ]] && continue
  case "$rel" in
    .git/* | node_modules/* | */node_modules/*) continue ;;
  esac
  HITS+=("$rel")
done

if [[ "${#HITS[@]}" -eq 0 && "$UNRESOLVED_WRITE" -eq 0 ]]; then
  exit 0
fi

if [[ "${#HITS[@]}" -gt 0 ]]; then
  WHAT="'$(printf '%s, ' "${HITS[@]}" | sed 's/, $//')'"
else
  WHAT="a repository file (the target is not a literal in the command, so it cannot be named here)"
fi

REASON="FOLLOW-910 branch guard: this Bash command writes ${WHAT} while HEAD == '$BRANCH'. Worker discipline (docs/AGENT_WORKFLOW.md) requires 'git checkout -b <agent>/<ticket-id>-<slug>' as the FIRST action, before any file edit — and a Bash-shaped edit (sed -i, a heredoc, tee, a python3 script) is an edit. Uncommitted edits left on main are silently absorbed by the next 'git checkout -b' from main, or discarded by 'git checkout main' / 'git stash drop' (RETRO-146 §4e). This is a WARNING, not a block; the command will proceed. Set ESTALARA_ALLOW_MAIN_EDITS=1 to silence intentionally."

jq -n --arg reason "$REASON" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", additionalContext: $reason}}'
exit 0
