#!/usr/bin/env bash
# SHARED HELPER — Python comment/string-literal stripper for the shell gates.
#
# WHY THIS FILE EXISTS (FOLLOW-746 item 8 — the copy decision, recorded)
# ─────────────────────────────────────────────────────────────────────
# `scripts/check-sentry-capture-has-init.sh` (PR #648, FOLLOW-757) introduced
# this ~50-line `python3 tokenize` pass as an embedded heredoc. FOLLOW-746
# needs the SAME pass in `scripts/check-sentry-init-singleton.sh` (AC3:
# trailing comments and docstrings must stop producing false REDs there).
#
# Copying it would have created a THIRD unregistered duplicate of shared logic
# in the Rule J / Rule K.1 gap: `scripts/mirror-files.json` registers only the
# two `observability.py` pairs, and `check-mirror-files.sh`'s `strip_comments()`
# understands `/* */` and `//` only — it cannot express a bash-file-embedding-
# python hybrid, so the two copies could drift with nothing detecting it.
#
# The two structural options were (a) extract to a shared `scripts/lib/` helper
# both gates source, or (b) register the two copies as a `mirror-files.json`
# pair with a comparison strategy that works for this file type. **(a) was
# chosen.** Rationale, recorded so it is not re-litigated:
#   - Rule J mirroring exists for code that CANNOT share an import across a
#     deployment boundary — the `observability.py` case, where each Modal app
#     builds an independent container image. `scripts/` has no such boundary:
#     both gates run as `bash scripts/<gate>.sh` from the same checkout, in the
#     same CI runner and the same lefthook pre-push hook, so a plain `source`
#     is available and costs nothing.
#   - Option (b) would have required inventing a NEW comparison strategy inside
#     `check-mirror-files.sh` for a bash/python hybrid, i.e. more shared-logic
#     surface added in order to police a duplicate that need not exist. Rule J
#     is a fallback for unavoidable duplication, not a licence to duplicate.
#   - Extraction makes drift structurally impossible instead of merely
#     detectable: there is exactly one definition, and both callers fail loudly
#     (see below) if it is missing.
#
# FOLLOW-760 CONTRACT — PRESERVED HERE, DO NOT REINTRODUCE A FALLBACK
# ──────────────────────────────────────────────────────────────────
# On a tokenizer failure (unterminated string, inconsistent dedent, rejected
# encoding, ...) this function writes NOTHING to stdout and exits 3. It must
# NOT fall back to writing the raw, uncleaned file: that would silently revert
# every caller's regexes to matching raw text — re-introducing the exact false
# result FOLLOW-757 removed in one gate and FOLLOW-746 removes in the other.
# Callers MUST distinguish "cannot evaluate this file" (exit 3, no stdout) from
# "evaluated, here is the cleaned source" (exit 0) and report the former as
# their own loud, counted finding. Both current callers do; a new caller that
# does not is a bug in that caller.
#
# USAGE
# ─────
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   # shellcheck source=lib/clean-python-source.sh
#   source "$SCRIPT_DIR/lib/clean-python-source.sh"
#
#   cleaned=$(clean_python_source "$file") || rc=$?
#   #   rc 0 → $cleaned is the source with comments/strings blanked
#   #   rc 3 → cannot evaluate this file; treat as a finding, never as clean
#
# Every stripped token is replaced by same-width whitespace, so line numbers
# and column offsets of the surviving code are preserved and a caller can map a
# match back to the file's ORIGINAL line (for allowlist comments, diagnostics).
#
# This file is sourced, never executed; it defines one function and does not
# set shell options (the sourcing gate owns `set -euo pipefail`).

clean_python_source() {
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
    # fallback) and exit non-zero so the shell caller treats this file as a
    # "cannot evaluate" finding, distinct from a real cleared/violating file.
    print(f"tokenize error on {path}: {exc}", file=sys.stderr)
    sys.exit(3)
PYEOF
}

# Sourcing guard used by both gates: a MISSING or unloadable helper must fail
# the gate loudly, never degrade it to raw-text matching. Callers assert
# `declare -F clean_python_source` immediately after sourcing.
