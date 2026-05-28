#!/usr/bin/env bash
# Migration journal monotonicity + recency check (FOLLOW-149).
#
# Why this gate exists:
#   drizzle-kit on certain developer machines generates `when` timestamps that
#   are exactly one year behind reality (e.g. 2025-05-27 instead of 2026-05-27).
#   Drizzle's migrator applies a migration only when
#     Number(lastDbMigration.created_at) < migration.folderMillis
#   so a stale-year entry is silently SKIPPED — and packages/db/scripts/migrate.ts
#   used to print "Migrations applied successfully." regardless. The combination
#   shipped a column-absent prd database that no one noticed.
#
#   This script is the second-line defence (after migrate.ts hardening) against
#   that exact trap. It runs in CI on every PR and as a pre-push lefthook.
#
# Rules enforced:
#   1. Every entry's `when` MUST be strictly greater than the previous entry's
#      `when` (drizzle silently skips out-of-order entries).
#   2. Every entry's `when` MUST be within MAX_DELTA_DAYS (default 7) of the
#      first-add commit date of the matching SQL file in `packages/db/migrations/`.
#      This catches drizzle-kit's 2025/2026 year drift at PR time. If the SQL
#      file has not yet been committed (added in the current PR but `git add`
#      timestamp does not exist), the script falls back to the file mtime.
#   3. The journal entry count MUST equal the number of SQL files in
#      `packages/db/migrations/` (no orphan files, no orphan entries).
#
# Exit codes:
#   0 = pass
#   1 = monotonicity / recency / count violation
#   2 = self-test failure (use --self-test to invoke)
#
# Usage:
#   bash scripts/check-migration-journal.sh
#   bash scripts/check-migration-journal.sh --self-test
#
# Output: one line per entry on success; per-violation diagnostic on failure
#         with the failing entry, both timestamps, and the delta in days.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
JOURNAL="${ROOT}/packages/db/migrations/meta/_journal.json"
MIGRATIONS_DIR="${ROOT}/packages/db/migrations"
MAX_DELTA_DAYS="${MAX_DELTA_DAYS:-7}"

# ── Self-test mode (Part B requirement) ──────────────────────────────────────
# Runs the validator against three deliberately-broken in-memory fixtures and
# a known-good fixture. The script must REJECT all three broken cases and
# ACCEPT the good case. If any assertion fails, exit 2 (self-test failure).
if [[ "${1:-}" == "--self-test" ]]; then
  echo "=== Self-test mode ==="
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT

  # Helper: run validator against a fixture journal + (optional) SQL files
  # Returns "pass" if exit 0, "fail" if exit 1.
  run_fixture() {
    local fixture_journal="$1"
    local fixture_sql_dir="$2"
    if FIXTURE_JOURNAL="$fixture_journal" \
       FIXTURE_SQL_DIR="$fixture_sql_dir" \
       FIXTURE_MODE=1 \
       MAX_DELTA_DAYS=7 \
       bash "$0" >/dev/null 2>&1; then
      echo "pass"
    else
      echo "fail"
    fi
  }

  # ── Fixture 1: monotonicity violation (entry 2 has `when` < entry 1) ──
  mkdir -p "$tmp_dir/fixture1/migrations"
  cat > "$tmp_dir/fixture1/_journal.json" <<'EOF'
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 1779000000000, "tag": "0000_a", "breakpoints": true },
    { "idx": 1, "version": "7", "when": 1779100000000, "tag": "0001_b", "breakpoints": true },
    { "idx": 2, "version": "7", "when": 1778900000000, "tag": "0002_c", "breakpoints": true }
  ]
}
EOF
  : > "$tmp_dir/fixture1/migrations/0000_a.sql"
  : > "$tmp_dir/fixture1/migrations/0001_b.sql"
  : > "$tmp_dir/fixture1/migrations/0002_c.sql"
  res1=$(run_fixture "$tmp_dir/fixture1/_journal.json" "$tmp_dir/fixture1/migrations")
  if [[ "$res1" != "fail" ]]; then
    echo "SELF-TEST FAIL: fixture 1 (monotonicity violation) was not rejected."
    exit 2
  fi
  echo "OK: fixture 1 (monotonicity violation) correctly REJECTED."

  # ── Fixture 2: year-drift violation (when is 2025 but file mtime is 2026) ─
  mkdir -p "$tmp_dir/fixture2/migrations"
  cat > "$tmp_dir/fixture2/_journal.json" <<'EOF'
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 1748304000000, "tag": "0000_yearbug", "breakpoints": true }
  ]
}
EOF
  : > "$tmp_dir/fixture2/migrations/0000_yearbug.sql"
  # File mtime defaults to now (2026); when=1748304000000 is 2025-05-27.
  # Delta will be ~365 days — gate should fail.
  res2=$(run_fixture "$tmp_dir/fixture2/_journal.json" "$tmp_dir/fixture2/migrations")
  if [[ "$res2" != "fail" ]]; then
    echo "SELF-TEST FAIL: fixture 2 (year-drift violation) was not rejected."
    exit 2
  fi
  echo "OK: fixture 2 (year-drift violation) correctly REJECTED."

  # ── Fixture 3: entry without matching SQL file (orphan entry) ─────────────
  mkdir -p "$tmp_dir/fixture3/migrations"
  cat > "$tmp_dir/fixture3/_journal.json" <<'EOF'
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 1779800000000, "tag": "0000_present", "breakpoints": true },
    { "idx": 1, "version": "7", "when": 1779900000000, "tag": "0001_missing", "breakpoints": true }
  ]
}
EOF
  : > "$tmp_dir/fixture3/migrations/0000_present.sql"
  # 0001_missing.sql intentionally absent
  res3=$(run_fixture "$tmp_dir/fixture3/_journal.json" "$tmp_dir/fixture3/migrations")
  if [[ "$res3" != "fail" ]]; then
    echo "SELF-TEST FAIL: fixture 3 (orphan entry) was not rejected."
    exit 2
  fi
  echo "OK: fixture 3 (orphan entry) correctly REJECTED."

  # ── Fixture 4: known-good (monotonic + within 7 days of mtime) ────────────
  mkdir -p "$tmp_dir/fixture4/migrations"
  # Use timestamps near "now" so the recency window is satisfied.
  now_ms=$(($(date -u +%s) * 1000))
  good_when_0=$((now_ms - 86400000))   # 1 day ago
  good_when_1=$((now_ms - 3600000))    # 1 hour ago
  cat > "$tmp_dir/fixture4/_journal.json" <<EOF
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": ${good_when_0}, "tag": "0000_good_a", "breakpoints": true },
    { "idx": 1, "version": "7", "when": ${good_when_1}, "tag": "0001_good_b", "breakpoints": true }
  ]
}
EOF
  : > "$tmp_dir/fixture4/migrations/0000_good_a.sql"
  : > "$tmp_dir/fixture4/migrations/0001_good_b.sql"
  res4=$(run_fixture "$tmp_dir/fixture4/_journal.json" "$tmp_dir/fixture4/migrations")
  if [[ "$res4" != "pass" ]]; then
    echo "SELF-TEST FAIL: fixture 4 (known-good) was rejected — gate is over-tight."
    exit 2
  fi
  echo "OK: fixture 4 (known-good) correctly ACCEPTED."

  echo ""
  echo "Self-test PASSED — all 4 fixtures behaved as expected."
  exit 0
fi

# ── Fixture mode (internal — used by --self-test) ────────────────────────────
# When FIXTURE_MODE=1, validate the provided fixture paths instead of the real
# journal and migration dir.
if [[ "${FIXTURE_MODE:-0}" == "1" ]]; then
  JOURNAL="$FIXTURE_JOURNAL"
  MIGRATIONS_DIR="$FIXTURE_SQL_DIR"
fi

if [[ ! -f "$JOURNAL" ]]; then
  echo "FAIL: journal not found at $JOURNAL"
  exit 1
fi

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "FAIL: migrations directory not found at $MIGRATIONS_DIR"
  exit 1
fi

# Delegate the actual checks to a Node script — JSON parsing + git/mtime fallback
# + delta math is much cleaner in Node than bash, and we already require Node 22
# everywhere in CI.
node --input-type=module - "$JOURNAL" "$MIGRATIONS_DIR" "$MAX_DELTA_DAYS" "${FIXTURE_MODE:-0}" <<'NODE_EOF'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, basename } from 'node:path';

const [journalPath, migrationsDir, maxDeltaDaysArg, fixtureMode] = process.argv.slice(2);
const MAX_DELTA_DAYS = Number(maxDeltaDaysArg) || 7;
const MAX_DELTA_MS = MAX_DELTA_DAYS * 86400 * 1000;
const IS_FIXTURE = fixtureMode === '1';

let journal;
try {
  journal = JSON.parse(readFileSync(journalPath, 'utf8'));
} catch (err) {
  console.error(`FAIL: cannot parse journal JSON: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
  console.error('FAIL: journal has no entries[] array or is empty.');
  process.exit(1);
}

let failures = 0;

// ── Check 1: monotonic strictly-increasing `when` ────────────────────────────
let prev = -1;
let prevTag = '(none)';
for (const entry of journal.entries) {
  if (typeof entry.when !== 'number') {
    console.error(`FAIL: entry idx=${entry.idx} tag=${entry.tag} has non-numeric when.`);
    failures++;
    continue;
  }
  if (entry.when <= prev) {
    const delta = prev - entry.when;
    console.error(
      `FAIL: monotonicity — entry idx=${entry.idx} tag=${entry.tag} when=${entry.when} (${new Date(entry.when).toISOString()}) ` +
      `is NOT > previous idx=${journal.entries[journal.entries.indexOf(entry) - 1]?.idx} tag=${prevTag} when=${prev} (${new Date(prev).toISOString()}). ` +
      `Delta = ${delta} ms (${(delta / 86400000).toFixed(2)} days behind previous).`,
    );
    console.error(
      `       Drizzle migrator silently SKIPS out-of-order entries — fix the journal's "when" value.`,
    );
    failures++;
  }
  prev = entry.when;
  prevTag = entry.tag;
}

// ── Check 2: entry count matches SQL file count + each entry has SQL file ────
const sqlFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const sqlTags = new Set(sqlFiles.map((f) => f.replace(/\.sql$/, '')));
const journalTags = new Set(journal.entries.map((e) => e.tag));

for (const tag of journalTags) {
  if (!sqlTags.has(tag)) {
    console.error(`FAIL: journal entry tag="${tag}" has no matching ${tag}.sql in ${migrationsDir}.`);
    failures++;
  }
}
for (const tag of sqlTags) {
  if (!journalTags.has(tag)) {
    console.error(`FAIL: ${tag}.sql exists but has no matching entry in _journal.json.`);
    failures++;
  }
}

// ── Check 3: recency — each entry's `when` is within MAX_DELTA_DAYS of the
//             SQL file's first git-add date (fallback: file mtime) ────────────
function getSqlTimestampSeconds(tag) {
  const sqlPath = join(migrationsDir, `${tag}.sql`);
  if (!existsSync(sqlPath)) return null;

  // Try git first (the SQL file may not yet be committed — that's OK for newly
  // added migrations in the current PR, in which case fall back to mtime).
  if (!IS_FIXTURE) {
    try {
      const out = execSync(
        `git log --diff-filter=A --format=%ct -- "${sqlPath}" 2>/dev/null | head -1`,
        { encoding: 'utf8' },
      ).trim();
      if (out) return Number(out);
    } catch {
      // fall through to mtime
    }
  }

  // Fallback: file mtime in seconds.
  try {
    return Math.floor(statSync(sqlPath).mtimeMs / 1000);
  } catch {
    return null;
  }
}

for (const entry of journal.entries) {
  const tsSec = getSqlTimestampSeconds(entry.tag);
  if (tsSec === null) continue; // already reported as orphan above

  const whenSec = Math.floor(entry.when / 1000);
  const deltaSec = Math.abs(whenSec - tsSec);
  const deltaDays = deltaSec / 86400;

  if (deltaSec * 1000 > MAX_DELTA_MS) {
    console.error(
      `FAIL: recency — entry idx=${entry.idx} tag=${entry.tag}`,
    );
    console.error(
      `       journal when = ${entry.when} ms (${new Date(entry.when).toISOString()})`,
    );
    console.error(
      `       SQL file ts  = ${tsSec * 1000} ms (${new Date(tsSec * 1000).toISOString()})`,
    );
    console.error(
      `       |delta|     = ${deltaSec} s = ${deltaDays.toFixed(2)} days (limit: ${MAX_DELTA_DAYS} days)`,
    );
    console.error(
      `       Likely drizzle-kit year-drift bug (2025-instead-of-2026). Repair the "when" value in _journal.json`,
    );
    console.error(
      `       to match the SQL file's commit date in ms. See CONVENTIONS_PATCH.md Rule O.`,
    );
    failures++;
  }
}

if (failures > 0) {
  console.error(`\nMigration journal check FAILED with ${failures} violation(s).`);
  process.exit(1);
}

console.log(`Migration journal OK — ${journal.entries.length} entries, all monotonic, all within ${MAX_DELTA_DAYS}d of SQL file commit date.`);
process.exit(0);
NODE_EOF
