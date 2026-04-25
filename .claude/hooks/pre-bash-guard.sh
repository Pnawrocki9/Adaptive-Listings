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
if echo "$COMMAND" | grep -qE 'rm\s+-rf?\s+(/|~|\$HOME|\.git\b|node_modules\s|\.\s|\*$)'; then
  echo "BLOCKED: Suspicious rm -rf pattern. Be more specific or escalate." >&2
  exit 1
fi

# All clear
exit 0
