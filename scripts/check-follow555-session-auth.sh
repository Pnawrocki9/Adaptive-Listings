#!/usr/bin/env bash
# FOLLOW-555 (A3-F-04) hard gate — browser-called route handlers must use the
# session-aware auth wrappers, never bare getAuthClaims / requireTenantAccess.
#
# The guarded route groups are all reachable from a logged-in browser session
# (chunked @supabase/ssr cookie). Bare getAuthClaims() / requireTenantAccess() only
# read the Bearer header / legacy sb-access-token cookie, so a real SSR session 401s
# (the FOLLOW-326/454/555 bug class, recurred 3×). Use getSessionAuthClaims /
# resolveTenantAccess from @/lib/session-auth (or verifyTracerAdminAuth) instead.
#
# FOLLOW-1335: the browser callers are now the staff backoffice `/admin` pages only (the
# agency `/dashboard` and its onboarding were deleted). The groups below are the ones those
# pages fetch; `detect` and `schema` went with FOLLOW-1328. `requireTenantAccess` no longer
# exists in @estalara/auth — it stays in the pattern so a reintroduction is caught.
#
# This is a full-tree check (not diff-based) so a regression anywhere in the
# guarded groups fails, not just in the current diff. Exit 0 = pass, 1 = violation.
# Run: scripts/check-follow555-session-auth.sh

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

BASE_DIR="apps/control-plane/src/app/api"
# Route groups whose handlers have confirmed /admin browser fetch() callers.
GUARDED_GROUPS=(admin demo dashboard pilot quiz config ab audit tenants)

FAILURES=0
echo "=== FOLLOW-555 gate: no bare getAuthClaims / requireTenantAccess in browser-called routes ==="

for group in "${GUARDED_GROUPS[@]}"; do
  dir="$BASE_DIR/$group"
  [[ -d "$dir" ]] || continue
  # Only non-test route handlers.
  while IFS= read -r file; do
    [[ -f "$file" ]] || continue
    # Match a CALL (identifier immediately followed by "("), skipping comment lines
    # (leading * or //). Word boundary keeps the session-aware variants
    # (getSessionAuthClaims / requireTenantSessionAccess) from matching.
    hits=$(grep -nE '(^|[^A-Za-z])(getAuthClaims|requireTenantAccess)\(' "$file" \
      | grep -vE '^\s*[0-9]+:\s*(\*|//)' || true)
    if [[ -n "$hits" ]]; then
      echo "✖ $file uses bare getAuthClaims/requireTenantAccess — migrate to @/lib/session-auth:"
      echo "$hits" | sed 's/^/    /'
      FAILURES=$((FAILURES + 1))
    fi
  done < <(find "$dir" -name 'route.ts' ! -name '*.test.ts')
done

if [[ "$FAILURES" -gt 0 ]]; then
  echo ""
  echo "FOLLOW-555 gate FAILED ($FAILURES file(s)). Browser-called routes must accept the"
  echo "@supabase/ssr session: use getSessionAuthClaims() / resolveTenantAccess()."
  exit 1
fi

echo "✔ FOLLOW-555 gate passed — all ${GUARDED_GROUPS[*]} routes are session-aware."
exit 0
