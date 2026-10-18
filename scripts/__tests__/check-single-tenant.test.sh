#!/usr/bin/env bash
# Negative control for scripts/check-single-tenant.sh [FOLLOW-1320].
#   real tree      --report -> exit 0, --ratchet -> exit 0
#   temp copy with an added requireAgencyRole reference  -> --ratchet exit 1, --final exit 1
set -uo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
gate="$repo_root/scripts/check-single-tenant.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0
expect() { # label want got
  if [ "$2" -eq "$3" ]; then echo "ok   $1 (exit $3)"; else echo "FAIL $1: want $2 got $3"; fail=1; fi
}

bash "$gate" --report >/dev/null; expect "real tree --report" 0 $?
bash "$gate" --ratchet >/dev/null; expect "real tree --ratchet" 0 $?

mkdir -p "$tmp/scripts" "$tmp/apps/control-plane/src/lib"
cp -r "$repo_root/scripts/baselines" "$tmp/scripts/baselines"
cp -r "$repo_root/apps/control-plane/src/app" "$tmp/apps/control-plane/src/app"
cp -r "$repo_root/apps/control-plane/src/lib" "$tmp/apps/control-plane/src/"
# Partial copy: re-baseline to the copy itself so ONLY the added reference can exceed it.
SINGLE_TENANT_ROOT="$tmp" bash "$gate" --report | grep -E '^[a-zA-Z_]+=[0-9]+$' | grep -v routes_inventory >"$tmp/scripts/baselines/single-tenant.baseline"
SINGLE_TENANT_ROOT="$tmp" bash "$gate" --ratchet >/dev/null; expect "copy before edit --ratchet" 0 $?
printf "export const x = requireAgencyRole;\n" >"$tmp/apps/control-plane/src/lib/zz-negative-control.ts"
SINGLE_TENANT_ROOT="$tmp" bash "$gate" --ratchet >/dev/null; expect "added requireAgencyRole --ratchet" 1 $?
SINGLE_TENANT_ROOT="$tmp" bash "$gate" --final >/dev/null; expect "added requireAgencyRole --final" 1 $?
exit "$fail"
