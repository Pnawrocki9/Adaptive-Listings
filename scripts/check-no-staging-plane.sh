#!/usr/bin/env bash
# check-no-staging-plane.sh — the FOLLOW-878 staging-plane gate (ESC-052 AC(5)).
#
# WHY THIS GATE EXISTS
# ────────────────────
# ESC-052 (RESOLVED 2026-08-07, CEO option 2) established that Estalara has no
# staging environment and never had one:
#   - Doppler `stg.DATABASE_URL_ADMIN` hashes byte-identical to `prd` (same sha256
#     over the whole URL, same user/host/database). "Staging Postgres" IS production,
#     so `db-migrate.yml`'s staging→prod sequence applied every merged migration to
#     production twice and its gate never protected anything.
#   - Doppler `stg` carries no `CLICKHOUSE_*` at all, `[env.staging]` in both
#     wrangler.toml files declares no KV/DO/queue bindings and an empty
#     CLICKHOUSE_URL, and `ingest-staging.estalara.com` / `decision-staging.estalara.com`
#     have no DNS record (FOLLOW-810, verified live 2026-08-04).
# The ruling's operative sentence is: *nothing may continue to APPEAR to provide
# isolation it does not provide.* Prose cannot enforce that. This gate can.
#
# WHAT IS CHECKED
# ───────────────
# A REGISTER, not a zero-count. Some staging references legitimately survive (they
# are the annotated upload-smoke target, and db-migrate.yml's `--config stg` which
# FOLLOW-873 owns). The gate asserts that the set of surviving references is EXACTLY
# the registered set: a NEW reference fails, and a reference that disappears also
# fails so the register cannot silently rot. Register:
#   scripts/baselines/staging-plane.register
#
# Patterns are swept at two machine-checkable Rule AI vocabularies:
#   (a) symbol   — `--config stg`, `--config staging`, `[env.staging]`, `--env staging`,
#                  `env.staging`, `DOPPLER_TOKEN_STG`, `INGEST_STAGING_URL`
#   (b) value    — the `*-staging.estalara.com` hostnames that resolve to nothing
# Vocabulary (c), the prose paraphrase ("pre-prod testing", "staging first"), is NOT
# machine-checkable without unbounded false positives and is adjudicated by hand in
# the FOLLOW-878 PR body instead. That residual is stated, not hidden (Rule AI
# amendment 2026-08-07, clause 2).
#
# CORPUS
# ──────
# Executable / configuration surfaces only:
#   .github/workflows  apps/*/wrangler.toml  infra/  scripts/  packages/*/src  apps/*/src
# Deliberately EXCLUDED: docs/ and backlog/. Those carry dated historical records
# (RETROSPECTIVES, AUDIT-*, ADR-*, ESCALATIONS) which must stay verbatim — annotating
# a dated snapshot rather than rewriting it is the FOLLOW-887 precedent. A gate that
# forced them to change would be a gate that rewrites history.
#
# SELF-TEST
# ─────────
#   bash scripts/check-no-staging-plane.sh --self-test
# Runs the detector against a synthetic tree with (1) a negative control — a NEW
# `--config stg` that MUST be detected — and (2) a positive control. CI runs the
# self-test BEFORE the real check so a broken detector cannot silently pass.
#
# EXIT CODES
# ──────────
#   0 = pass (observed set == registered set)
#   1 = violation (a new staging-plane reference, or a registered one that vanished)
#   2 = self-test failure (this script is broken)

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

PATTERNS=(
  '--config stg'
  '--config staging'
  '[env.staging]'
  '--env staging'
  'DOPPLER_TOKEN_STG'
  'INGEST_STAGING_URL'
  'ingest-staging.estalara.com'
  'decision-staging.estalara.com'
  'cdn-staging.estalara.com'
)

# Collect "<pattern>\t<path>\t<count>" for every corpus file, sorted and stable.
collect() {
  local base="$1"
  local -a files=()
  # PRUNE is mandatory: without it `find apps -path '*/src/*'` walks every
  # node_modules/.next tree in the workspace and the gate takes minutes.
  local -a PRUNE=(
    -name node_modules -o -name .git -o -name .next -o -name dist
    -o -name .turbo -o -name coverage -o -name .wrangler -o -name .venv
  )
  while IFS= read -r f; do files+=("$f"); done < <(
    {
      [ -d "$base/.github/workflows" ] && find "$base/.github/workflows" \( "${PRUNE[@]}" \) -prune -o -type f -name '*.yml' -print
      [ -d "$base/infra" ] && find "$base/infra" \( "${PRUNE[@]}" \) -prune -o -type f -print
      [ -d "$base/scripts" ] && find "$base/scripts" \( "${PRUNE[@]}" \) -prune -o -type f ! -name 'check-no-staging-plane.sh' ! -name 'staging-plane.register' -print
      [ -d "$base/apps" ] && find "$base/apps" \( "${PRUNE[@]}" \) -prune -o -type f \( -name 'wrangler.toml' -o -path '*/src/*' \) -print
      [ -d "$base/packages" ] && find "$base/packages" \( "${PRUNE[@]}" \) -prune -o -type f -path '*/src/*' -print
    } 2>/dev/null | LC_ALL=C sort
  )
  [ ${#files[@]} -eq 0 ] && return 0
  # One batched grep per pattern (not per file): `grep -c` over many files prints
  # "<path>:<count>" for each. 9 grep processes instead of 9 x |files|.
  local p line path cnt
  for p in "${PATTERNS[@]}"; do
    while IFS= read -r line; do
      cnt="${line##*:}"
      path="${line%:*}"
      [ "$cnt" == "0" ] && continue
      printf '%s\t%s\t%s\n' "$p" "${path#"$base"/}" "$cnt"
    done < <(grep -c -F -- "$p" "${files[@]}" 2>/dev/null || true)
  done
}

# ── Self-test ────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--self-test" ]]; then
  echo "=== Self-test mode (FOLLOW-878 staging-plane gate) ==="
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/.github/workflows"

  cat > "$tmp/.github/workflows/known.yml" <<'EOF'
run: doppler run --config stg -- pnpm db:migrate
EOF
  reg="$tmp/register.txt"
  collect "$tmp" > "$reg"

  if ! diff -u "$reg" <(collect "$tmp") > /dev/null; then
    echo "SELF-TEST FAIL: collector is not deterministic."; exit 2
  fi
  echo "OK: collector is deterministic."

  # Negative control: a NEW staging reference must change the observed set.
  cat > "$tmp/.github/workflows/new.yml" <<'EOF'
run: npx wrangler deploy --env staging
EOF
  if diff -u "$reg" <(collect "$tmp") > /dev/null; then
    echo "SELF-TEST FAIL: a NEW '--env staging' reference was NOT detected."
    echo "  The detector is broken — check PATTERNS/collect() in this script."
    exit 2
  fi
  echo "OK: a new staging-plane reference is detected."

  # Positive control: removing it restores the registered set.
  rm -f "$tmp/.github/workflows/new.yml"
  if ! diff -u "$reg" <(collect "$tmp") > /dev/null; then
    echo "SELF-TEST FAIL: registered-only tree was flagged as a violation."; exit 2
  fi
  echo "OK: a registered-only tree passes."
  echo ""
  echo "Self-test PASSED."
  exit 0
fi

# ── Print mode (regenerate the register body) ────────────────────────────────
if [[ "${1:-}" == "--print" ]]; then
  collect "$ROOT"
  exit 0
fi

# ── Real check ───────────────────────────────────────────────────────────────
REGISTER="${STAGING_PLANE_REGISTER:-$ROOT/scripts/baselines/staging-plane.register}"

echo "=== Staging-plane gate (FOLLOW-878 / ESC-052) ==="
echo "Register: ${REGISTER#"$ROOT"/}"
echo ""

if [ ! -f "$REGISTER" ]; then
  echo "FAIL: register file not found: $REGISTER"
  exit 1
fi

observed=$(collect "$ROOT")
expected=$(grep -v '^#' "$REGISTER" | grep -v '^[[:space:]]*$' || true)

if [ "$observed" == "$expected" ]; then
  echo "PASS: the surviving staging-plane references are exactly the registered set."
  echo ""
  echo "$observed"
  exit 0
fi

echo "FAIL: the staging-plane reference set changed."
echo ""
echo "--- registered (expected) / +++ observed (actual) ---"
diff -u <(printf '%s\n' "$expected") <(printf '%s\n' "$observed") || true
echo ""
echo "A '+' line is a NEW reference to a plane that does not exist. ESC-052 (CEO"
echo "option 2) ruled that nothing may APPEAR to provide isolation it does not"
echo "provide: Doppler 'stg' is byte-identical to 'prd' (a write to stg writes to"
echo "PRODUCTION), and the '*-staging.estalara.com' hosts have no DNS record."
echo ""
echo "A '-' line means a registered reference was removed. That is usually GOOD —"
echo "e.g. FOLLOW-873 collapsing db-migrate.yml to a single prod apply. Update"
echo "scripts/baselines/staging-plane.register in the same PR, keeping the reason"
echo "comment for every surviving line."
echo ""
echo "See ESC-052, FOLLOW-873, FOLLOW-878, FOLLOW-810, docs/MASTER_DESIGN.md §V.6.1/§V.6.3."
exit 1
