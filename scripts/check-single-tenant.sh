#!/usr/bin/env bash
# check-single-tenant.sh — single-tenant surface ratchet (instrument N1) [FOLLOW-1320]
#
# WHY: Estalara Adaptive Listings is a single-tenant product (ESC-085). The multi-tenant
# surface (registration, agency roles, fleet pages, per-tenant origins, Stripe, ...) is
# being removed in Phases 2/3 of the localhost-completion plan. This gate makes the
# surface only ever shrink, so half-removals and returning screens go red.
#
# MODES
#   --report   print every counter, exit 0 (also lists offending paths / routes)
#   --ratchet  exit 1 if any counter exceeds scripts/baselines/single-tenant.baseline
#              or a route exists that is not in scripts/baselines/single-tenant-routes.allowlist
#   --final    exit 1 on ANY hit (every counter must be 0, no route outside the allowlist)
#
# COUNTERS (one line each: name=<n>)
#   paths_present       paths from REMOVED_PATHS that still exist
#   dashboard_pages     apps/control-plane/src/app/dashboard/**/page.tsx that are not a pure redirect
#   id_<name>           occurrences of a forbidden identifier in non-test .ts/.tsx under
#                       apps/*/src and packages/*/src (tests, __tests__, __fixtures__ excluded)
#   routes_unlisted     page/route files under apps/control-plane/src/app absent from the allowlist
#
# PRUNING (Phase 2/3 PRs): after deleting code, run `--report`, lower the matching numbers in
# single-tenant.baseline, and delete the removed routes from single-tenant-routes.allowlist
# (keep it sorted: `LC_ALL=C sort`). Ratchet never allows raising a number. The final removal
# PR switches CI from --ratchet to --final.
#
# EXIT CODES (repo convention): 0 pass / 1 violation / 3 could not run (usage, missing baseline).
# Uses only bash, grep, find. No node_modules needed.

set -euo pipefail

mode="${1:-}"
case "$mode" in
  --report | --ratchet | --final) ;;
  *)
    echo "usage: $0 --report|--ratchet|--final" >&2
    exit 3
    ;;
esac

# Test seam: SINGLE_TENANT_ROOT lets the negative-control test run against a temp copy.
repo_root="${SINGLE_TENANT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$repo_root" || exit 3

BASELINE="scripts/baselines/single-tenant.baseline"
ALLOWLIST="scripts/baselines/single-tenant-routes.allowlist"
CP="apps/control-plane/src"

REMOVED_PATHS=(
  "$CP/app/register"
  "$CP/app/api/registrations"
  "$CP/app/admin/registrations"
  "$CP/app/api/detect"
  "$CP/app/api/internal/schema"
  "$CP/app/api/schema/activate"
  "$CP/app/api/admin/diagnostics/first-party-tenant"
  "$CP/app/admin/tenants/page.tsx"
  "$CP/app/admin/analytics"
  "$CP/app/admin/demo-sessions"
  "$CP/app/api/demo/sessions"
  "$CP/app/dashboard/demo/mockup"
  "$CP/lib/mockup-listings.ts"
  "$CP/components/onboarding"
  "$CP/app/dashboard/onboarding"
  "$CP/app/dashboard/detection"
  "$CP/lib/stripe.ts"
  "$CP/app/api/webhooks/stripe"
  "packages/platform-templates"
  "packages/sdk/src/auto-detect"
  "packages/shared/src/schemas/detect.ts"
  "apps/data-quality"
  ".github/workflows/demo-integration.yml"
  "tests/e2e/sprint-9-5-demo.spec.ts"
  "apps/control-plane/scripts/project-allowed-origins.mts"
)

# name|extended-regex ; scanned in non-test .ts/.tsx under apps/*/src packages/*/src
IDENTIFIERS=(
  "agency_roles|agency:owner|agency:admin|agency:viewer"
  "agency_role_rank|AGENCY_ROLE_RANK"
  "require_agency_role|requireAgencyRole"
  "x_agency_role|x-agency-role"
  "getTenantsList|getTenantsList"
  "brand_identity_import|from '@/lib/brand-identity'"
  "PILOT_TENANT_ID|PILOT_TENANT_ID"
  "FIRST_PARTY_TENANT_ID|FIRST_PARTY_TENANT_ID"
)
# allowed_origins is scoped to the two services that used to read it (0 since FOLLOW-1333; the
# DB schema keeps the unread columns and is outside this scan)
ORIGINS_DIRS=("$CP" "apps/ingest/src")

declare -a names=() values=()
add() { names+=("$1"); values+=("$2"); }

scan_files() { # $@ dirs -> non-test ts/tsx files, one per line
  find "$@" -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name '*.test.*' ! -path '*/__tests__/*' ! -path '*/__fixtures__/*' \
    ! -path '*/node_modules/*' ! -path '*/dist/*' ! -path '*/.next/*' 2>/dev/null | LC_ALL=C sort
}

count_hits() { # regex, files-on-stdin
  local f hits=0 n
  while IFS= read -r f; do
    n=$(grep -cE -- "$1" "$f" 2>/dev/null || true)
    hits=$((hits + ${n:-0}))
  done
  echo "$hits"
}

# --- paths ---
present=()
for p in "${REMOVED_PATHS[@]}"; do [ -e "$p" ] && present+=("$p"); done
add paths_present "${#present[@]}"

# --- dashboard pages that are not pure redirects ---
dash=()
if [ -d "$CP/app/dashboard" ]; then
  while IFS= read -r f; do
    # pure redirect = has redirect(/permanentRedirect( and no JSX return of markup
    if grep -qE '(permanentRedirect|redirect)\(' "$f" && ! grep -qE 'return[[:space:]]*\(?[[:space:]]*<' "$f"; then
      continue
    fi
    dash+=("$f")
  done < <(find "$CP/app/dashboard" -type f -name 'page.tsx' | LC_ALL=C sort)
fi
add dashboard_pages "${#dash[@]}"

# --- identifiers ---
mapfile -t src_files < <(scan_files $(ls -d apps/*/src packages/*/src 2>/dev/null))
for spec in "${IDENTIFIERS[@]}"; do
  name="${spec%%|*}"
  rx="${spec#*|}"
  add "id_$name" "$(printf '%s\n' "${src_files[@]}" | count_hits "$rx")"
done
org_dirs=()
for d in "${ORIGINS_DIRS[@]}"; do [ -d "$d" ] && org_dirs+=("$d"); done
mapfile -t org_files < <(scan_files "${org_dirs[@]}")
add id_allowed_origins "$(printf '%s\n' "${org_files[@]}" | count_hits 'allowed_origins')"

# --- route inventory ---
routes_tmp="$(mktemp)"
trap 'rm -f "$routes_tmp"' EXIT
if [ -d "$CP/app" ]; then
  find "$CP/app" -type f \( -name 'page.ts' -o -name 'page.tsx' -o -name 'route.ts' -o -name 'route.tsx' \) |
    LC_ALL=C sort >"$routes_tmp"
fi
unlisted=()
if [ ! -f "$ALLOWLIST" ]; then
  echo "SINGLE_TENANT: missing $ALLOWLIST" >&2
  exit 3
fi
while IFS= read -r r; do
  grep -qxF -- "$r" "$ALLOWLIST" || unlisted+=("$r")
done <"$routes_tmp"
add routes_unlisted "${#unlisted[@]}"

# --- output ---
total=0
for i in "${!names[@]}"; do
  echo "${names[$i]}=${values[$i]}"
  total=$((total + values[i]))
done
echo "routes_inventory=$(wc -l <"$routes_tmp" | tr -d ' ')"

if [ "$mode" = "--report" ]; then
  [ "${#present[@]}" -gt 0 ] && printf 'PATH_PRESENT %s\n' "${present[@]}"
  [ "${#dash[@]}" -gt 0 ] && printf 'DASHBOARD_PAGE %s\n' "${dash[@]}"
  [ "${#unlisted[@]}" -gt 0 ] && printf 'ROUTE_UNLISTED %s\n' "${unlisted[@]}"
  echo "SINGLE_TENANT total=$total mode=$mode result=PASS"
  exit 0
fi

fail=0
if [ "$mode" = "--final" ]; then
  [ "$total" -gt 0 ] && fail=1
else
  [ -f "$BASELINE" ] || { echo "SINGLE_TENANT: missing $BASELINE" >&2; exit 3; }
  for i in "${!names[@]}"; do
    b=$(grep -E "^${names[$i]}=" "$BASELINE" | head -1 | cut -d= -f2 || true)
    if [ -z "$b" ]; then
      echo "SINGLE_TENANT: counter ${names[$i]} missing from baseline" >&2
      exit 3
    fi
    if [ "${values[$i]}" -gt "$b" ]; then
      echo "RATCHET_EXCEEDED ${names[$i]}: ${values[$i]} > baseline $b"
      fail=1
    fi
  done
  [ "${#unlisted[@]}" -gt 0 ] && fail=1
fi
[ "${#unlisted[@]}" -gt 0 ] && printf 'ROUTE_UNLISTED %s\n' "${unlisted[@]}"

if [ "$fail" -eq 1 ]; then
  echo "SINGLE_TENANT total=$total mode=$mode result=FAIL"
  exit 1
fi
echo "SINGLE_TENANT total=$total mode=$mode result=PASS"
