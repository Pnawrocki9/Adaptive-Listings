#!/usr/bin/env bash
# check-consent-text-headers.sh — the FOLLOW-935 effect probe.
#
# WHY THIS EXISTS
#   The ADR-0021 §D2 consent-banner text is fetched CROSS-ORIGIN by the SDK running on a tenant's
#   own domain. Without `Access-Control-Allow-Origin` the browser discards the response, §D4 fails
#   closed exactly as designed, and every FIRST-VISIT browser gets no banner and a null `init()` —
#   the SDK behaving correctly on top of a missing header. That was the FOLLOW-929 P0.
#
#   The fix shipped with a test that `await`s `nextConfig.headers()` and inspects the returned
#   array. It is a good test, but it would pass unchanged if Vercel stopped applying `headers()` to
#   `public/` assets, if the asset moved, or if the deploy never ran. The ONLY observation of the
#   real response was one curl typed by a retrospective agent (RETRO-265). A one-time observation
#   is not a control. [FOLLOW-935 AC(1)]
#
# WHAT IT ASSERTS, against the DEPLOYED origin
#   GET <CONSENT_TEXT_URL> with `Origin: https://app.estalara.com` returns
#     - HTTP 200
#     - access-control-allow-origin: *
#     - cache-control: public, max-age=300, stale-while-revalidate=60
#
#   The wildcard is CORRECT here and not a concession: ADR-0021 §D3 requires the request to carry
#   no credentials and no identifiers, and the document is byte-identical for every tenant, so an
#   origin allowlist would both break the embedding model and make the response vary by origin —
#   the tenant-distinguishing behaviour §D3 forbids.
#
# EXIT CODES
#   0  every assertion held — the effect is live
#   1  an assertion failed — the effect is ABSENT or changed
#   2  the probe could not run (URL unresolvable, network unreachable): UNDETERMINED, never green
#
# USAGE
#   bash scripts/check-consent-text-headers.sh                  # resolves the URL from source
#   bash scripts/check-consent-text-headers.sh --url http://…   # negative control only

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAINS_TS="${REPO_ROOT}/packages/shared/src/domains.ts"
PROBE_ORIGIN="https://app.estalara.com"

EXPECT_ACAO='*'
EXPECT_CACHE='public, max-age=300, stale-while-revalidate=60'

URL_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL_OVERRIDE="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ── Resolve the URL from source, never from a literal here ────────────────────────────────────
# AC(1) is explicit that the host must come from `CONSENT_TEXT_URL`. Parsed out of the TypeScript
# rather than imported, so the probe needs no build step — but every parse FAILS LOUD (exit 2,
# UNDETERMINED). A resolver that silently fell back to a default host would assert the header of
# whatever host it guessed, which is the failure this whole ticket exists to remove.
resolve_url() {
  [ -n "$URL_OVERRIDE" ] && { printf '%s' "$URL_OVERRIDE"; return 0; }

  [ -f "$DOMAINS_TS" ] || { echo "UNDETERMINED: cannot read ${DOMAINS_TS}" >&2; return 2; }

  local domain path
  domain="$(grep -oE "CONTROL_PLANE_DOMAIN = '[^']+'" "$DOMAINS_TS" | head -1 | sed "s/.*'\\(.*\\)'/\\1/")"
  # CONSENT_TEXT_URL = `${CONTROL_PLANE_URL}/consent-text.json`
  path="$(grep -oE 'CONSENT_TEXT_URL = `\$\{CONTROL_PLANE_URL\}[^`]+`' "$DOMAINS_TS" \
    | head -1 | sed 's/.*}\(.*\)`/\1/')"

  if [ -z "$domain" ] || [ -z "$path" ]; then
    echo "UNDETERMINED: could not derive the consent-text URL from ${DOMAINS_TS}." >&2
    echo "  CONTROL_PLANE_DOMAIN='${domain}' path='${path}'" >&2
    echo "  The constants were refactored. Fix this resolver — do NOT hardcode a host here." >&2
    return 2
  fi
  printf 'https://%s%s' "$domain" "$path"
}

URL="$(resolve_url)" || exit 2
echo "probe target: ${URL}"
echo "probe origin: ${PROBE_ORIGIN}"

# ── Observe the real response ─────────────────────────────────────────────────────────────────
HEADERS="$(curl -sS -m 30 -D - -o /dev/null -H "Origin: ${PROBE_ORIGIN}" "$URL" 2>&1)" || {
  echo "UNDETERMINED: request to ${URL} failed:" >&2
  printf '%s\n' "$HEADERS" | sed 's/^/    /' >&2
  exit 2
}

header_value() { # header_value <lowercase-name>
  printf '%s\n' "$HEADERS" \
    | tr -d '\r' \
    | grep -iE "^$1:" | tail -1 | sed "s/^[^:]*:[[:space:]]*//"
}

STATUS="$(printf '%s\n' "$HEADERS" | tr -d '\r' | grep -oE '^HTTP/[0-9.]+ [0-9]+' | tail -1 | awk '{print $2}')"
ACAO="$(header_value 'access-control-allow-origin')"
CACHE="$(header_value 'cache-control')"

FAILURES=0
fail() { echo "FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ "$STATUS" = "200" ] || fail "expected HTTP 200, got '${STATUS:-<none>}'"
[ "$ACAO" = "$EXPECT_ACAO" ] \
  || fail "expected 'access-control-allow-origin: ${EXPECT_ACAO}', got '${ACAO:-<absent>}' — the SDK's cross-origin fetch fails closed and every first-visit browser gets no banner (FOLLOW-929)"
[ "$CACHE" = "$EXPECT_CACHE" ] \
  || fail "expected 'cache-control: ${EXPECT_CACHE}', got '${CACHE:-<absent>}' — this is the ADR-0021 §D2 wire contract"

echo "observed: status=${STATUS:-<none>} acao=${ACAO:-<absent>} cache-control=${CACHE:-<absent>}"

if [ "$FAILURES" -ne 0 ]; then
  echo
  echo "RESULT: the consent-text effect is ABSENT or changed at ${URL} (${FAILURES} failed assertion(s))."
  exit 1
fi

echo "RESULT: consent-text CORS + cache effect is LIVE at ${URL}."
