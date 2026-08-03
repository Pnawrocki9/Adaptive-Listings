#!/usr/bin/env bash
# Sentry init singleton guard (FOLLOW-738 / ESC-045 item 4, holes closed by
# FOLLOW-746).
#
# WHY THIS GUARD EXISTS
# ─────────────────────
# Before FOLLOW-738, four Sentry init call sites existed across three Python
# Modal apps, reading the same bare SENTRY_DSN name and mounting the same
# modal.Secret.from_name("estalara-secrets"). Only one of the four
# (apps/intent-engine/src/nlp.py) set include_local_variables=False,
# send_default_pii=False and an explicit integration list. Provisioning
# SENTRY_DSN would have silently switched on frame-locals capture and the
# default LoggingIntegration on the other three — a new disclosure surface
# opened by the SAME operator action meant to close a missing-alerting gap.
#
# FOLLOW-738 extracted ONE shared, hardened initialiser (`init_sentry()`),
# mirrored byte-identically (Rule J) into all three apps as observability.py.
# This script is the committed CI gate that makes a re-introduced bare
# `sentry_sdk.init(` call impossible to miss at PR time. It mirrors the
# pattern of scripts/check-modal-app-singleton.sh (FOLLOW-438).
#
# WHAT IS DETECTED
# ────────────────
# Python files under apps/*/src:
#   a REAL `sentry_sdk.init(` call site — i.e. one that survives
#   `clean_python_source()` (scripts/lib/clean-python-source.sh), which blanks
#   comments, trailing comments, string literals and docstrings.
#
# EXPECTED COUNT: exactly 0 violations AND 0 unparseable files.
#   Every real `sentry_sdk.init(` call must live inside one of the Rule J
#   mirror paths REGISTERED in scripts/mirror-files.json (the canonical
#   apps/intent-engine/src/observability.py and its two mirrors). All other
#   Python modules must call `init_sentry(<DSN_ENV_NAME>)` instead.
#
# EXCLUSIONS — and the four holes FOLLOW-746 closed
# ─────────────────────────────────────────────────
#   1. REGISTERED MIRROR PATHS, not the basename (FOLLOW-746 AC2). The
#      exclusion list is READ FROM scripts/mirror-files.json and matched
#      against each file's path relative to the scan root, so
#      `apps/<new-app>/src/observability.py` — a 4th, UNREGISTERED copy —
#      is scanned and its bare init is caught. The old `--exclude=
#      "observability.py"` skipped every file with that basename, registered
#      or not, and failed SILENTLY (false GREEN).
#      NOTE (FOLLOW-746 item 7): this exclusion is load-bearing HERE and has
#      no counterpart in check-sentry-capture-has-init.sh, which REMOVED its
#      basename exclusion in PR #648 after verifying the mirrors hold zero
#      capture call sites. The registered mirrors are exactly where the
#      legitimate `sentry_sdk.init(` lives, so this gate must exclude them and
#      the two gates legitimately differ. Do not "converge" them.
#      EXCLUSION IS NOT BLIND TRUST (FOLLOW-765 AC2, closing residual C). Two
#      checks now bound this suppression set, and since FOLLOW-771 BOTH are
#      evaluated over the REGISTERED SET (`$REGISTERED`, the manifest-derived
#      `.py` paths) rather than over the scanned file list:
#        (i)  its MEMBERSHIP is compared against a committed baseline,
#             scripts/baselines/sentry-init-mirror-exclusions.baseline (see
#             "SUPPRESSION BASELINE" below), so registering a fourth `.py` pair
#             reddens the gate until the addition is reviewed — INCLUDING a
#             pair outside `apps/*/src` and a pair whose basename matches this
#             gate's own test-convention exclusion. Both were exempt until
#             FOLLOW-771: the two controls lived inside `for f in $FILES`, so
#             the register they guard (repo-wide) was wider than the assertion
#             over it (`apps/*/src`, minus test-convention basenames) — Rule AL.
#             The bound that REMAINS is the exact `.py` suffix filter, recorded
#             as register entry [H]; and a registered path with no file on disk
#             is its own loud STALE MANIFEST ENTRY finding, never a silent skip;
#             and
#        (ii) every excluded file that holds a real `sentry_sdk.init(` must
#             carry all three FOLLOW-738 HARDENED MARKERS —
#             `default_integrations=False`, `send_default_pii=False`,
#             `include_local_variables=False` — surviving the same tokenizer
#             pass, else the gate fails with an UNHARDENED REGISTERED MIRROR
#             finding.
#      WHY MARKERS RATHER THAN BYTE-IDENTITY TO A NAMED CANONICAL: the attack
#      is a NEWLY registered, self-consistent pair
#      ({canonical: apps/x/src/foo.py, mirror: apps/y/src/foo.py}) that is
#      byte-identical to EACH OTHER and holds a bare init. Byte-identity "to
#      the manifest's canonical" is satisfied trivially by such a pair — its
#      canonical is itself — so that check only works by hard-coding
#      apps/intent-engine/src/observability.py into this gate, which then
#      false-REDs any legitimate second hardened family and breaks the moment
#      the canonical moves. The marker check tests the PROPERTY the exclusion
#      actually assumes ("the init inside is the hardened one") on the bytes
#      that are actually excluded, and composes with Rule J: Rule J gives
#      byte-identity WITHIN a pair, this gives hardened-shape PER excluded
#      file.
#   2. TEST FILES BY ANCHORED CONVENTION, not by substring (FOLLOW-746
#      item 6): `test_*.py`, `*_test.py`, `conftest.py`. The old
#      `--exclude="*test*.py"` also skipped production basenames that merely
#      CONTAIN "test" — `latest_pricing.py`, `contest.py`,
#      `attestation_report.py` — so a bare `sentry_sdk.init(` in one of them
#      was silently unseen. Verbatim the substring-glob shape FOLLOW-757 fixed
#      in the sibling gate. Latent, not live, when fixed (all `*test*`
#      basenames under apps/*/src were genuine test files) — the same status
#      the other closed shapes had.
#   3. COMMENTS AND DOCSTRINGS ARE NOT VIOLATIONS (FOLLOW-746 AC3). The old
#      filter was `grep -vE "^[^:]+:[0-9]+:[[:space:]]*#"`, i.e. WHOLE-LINE
#      comments only, so a trailing comment (`foo = 1  # replaces
#      sentry_sdk.init(`) or a docstring mention (no `#` at all) hard-failed
#      CI. That direction is a false RED — loud, not silent — but it trains
#      readers to route around the gate. Both shapes are now handled by the
#      shared tokenizer pass rather than by a widened regex.
#   4. A FILE THAT CANNOT BE TOKENIZED IS A FINDING, NOT A PASS (FOLLOW-760
#      contract, inherited via the shared helper). It is reported under its
#      own distinct "UNPARSEABLE" heading and fails the gate; it is never
#      silently cleared and never falls back to raw-text matching.
#
# SHARED HELPER (FOLLOW-746 item 8 — the copy decision)
# ────────────────────────────────────────────────────
# The tokenizer pass lives in scripts/lib/clean-python-source.sh and is SOURCED
# by both this gate and check-sentry-capture-has-init.sh. It was deliberately
# NOT copied here and NOT registered as a Rule J mirror pair; the full
# reasoning is recorded in that file's header. A missing helper fails this gate
# with exit 2 — it never degrades to raw-text matching.
#
# SUPPRESSION BASELINE (FOLLOW-765 AC1/AC4 — the missing consumer)
# ───────────────────────────────────────────────────────────────
# This gate used to print "Registered mirror files excluded from the scan: N"
# and NOTHING read N: no baseline, no annotation, no threshold — in a job that
# is GREEN, whose log nobody opens. Register a fourth `.py` pair and the
# exclusion list grew to 4, the gate printed `4`, CI passed. That is a
# HALF_WIRE_P under Rule AJ, and it is more load-bearing than the sibling
# gate's version because this suppresses whole FILES, not single lines —
# `mirror-files.json` had become an editable suppression list for a
# security-shaped gate, and this gate's own FIX text INSTRUCTS the reader to
# register a new copy.
#
# The consumer is scripts/baselines/sentry-init-mirror-exclusions.baseline
# (override: SENTRY_INIT_EXCLUSION_BASELINE), compared by the shared helper
# scripts/lib/suppression-baseline.sh — the SAME helper
# check-sentry-capture-has-init.sh uses for its allowlist inventory
# (FOLLOW-759). One mechanism, not two bespoke ones: the two inventories differ
# only in what an entry is, and two copies of the comparison logic would be
# precisely the "same organ reproduced in the sibling gate" failure that
# produced this ticket. Same structural argument as the shared tokenizer pass.
#
# SCAN DIR
# ────────
# Parameterised via SENTRY_INIT_TARGET (default: apps/*/src in repo root); the
# manifest via SENTRY_INIT_MIRROR_MANIFEST (default: scripts/mirror-files.json);
# the exclusion baseline via SENTRY_INIT_EXCLUSION_BASELINE (default:
# scripts/baselines/sentry-init-mirror-exclusions.baseline).
# The --self-test mode points all three at a temp directory so the detector can
# be verified without touching the real source tree, manifest or baseline.
#
# KNOWN, DELIBERATELY UNGUARDED GAPS — Rule AP RESIDUAL REGISTER (executed)
# ─────────────────────────────────────────────────────────────────────────────
# This section is NOT prose. Every entry below is a row of the
# RESIDUAL_REGISTER array further down, and the gate EXECUTES every entry's
# latency proof on every run, printing one status line per entry. Per entry:
#
#   EVERY pipe stage exits 0 or 1,
#     EMPTY stdout                    → LATENT   (documented, still not real)
#   EVERY pipe stage exits 0 or 1,
#     stdout output                   → GONE LIVE → gate FAILS with exit 3,
#                                       naming the entry id — a diagnosis
#                                       DISTINCT from an ordinary finding (1)
#   ANY pipe stage exits >= 2, or the
#     proof cannot run at all         → gate FAILS with exit 2. A residual
#                                       whose proof cannot be evaluated is
#                                       never "assumed still latent"
#                                       (the FOLLOW-760 contract, applied to
#                                       the register itself)
#
# PER-STAGE PROOF STATUS — why `pipefail` alone is NOT enough
# ─────────────────────────────────────────────────────────────────────────────
# Proofs run under `bash -o pipefail -c`, so a failing producer inside a pipe
# cannot silently yield status 0. That is necessary but NOT sufficient, and
# FOLLOW-770's first cut of this mechanism got it wrong: `pipefail` reports the
# status of the RIGHTMOST command that exited non-zero — not the first, and not
# the worst. Entries B, D and G chain a producer into a SECOND `grep`, and
# `grep` exits 1 ("no match") on the now-empty input a dead producer leaves
# behind, so the pipeline reports 1, a `>= 2` test does not fire, and a
# genuinely dead producer is classified `latent` — the reassuring direction
# Rule AP clause 2 exists to forbid, reproduced inside clause 2's own
# enforcement mechanism. The runner below therefore records ${PIPESTATUS[@]} —
# every stage's OWN exit status — for each proof, and treats ANY stage exiting
# >= 2 as UNEVALUABLE regardless of what later stages did. It is COPIED VERBATIM
# from scripts/check-mirror-files.sh (FOLLOW-770 fix-iteration 1), variable
# names included, so the two diff to zero; see that file for the full writeup.
# Each proof is evaluated over the SAME region as the control it describes
# (Rule AL); the region is named in the entry. Retiring an entry requires the
# fix that closes it in the same PR (Rule AP clause 5).
#
# CONTROLS (predicates) in this gate → the entries that bound each:
#   P1 bare-init detection      (region: $FILES)              → A, B, D
#   P2 registered-mirror exclusion (region: $REGISTERED)      → H
#   P3 hardened-marker check    (region: $REGISTERED)         → C1, C2, C3, H
#   P4 exclusion inventory + baseline (region: $REGISTERED)   → E, H
#   P5 manifest read            (hard fail, no residual)      → see P5 note
#   P6 shared-helper availability guards                      → F
#   P7 this register's own runner                             → G
# Rule AP clause 3: a PR that adds a predicate to this gate MUST add that
# predicate's OWN entry here — its region, its scan root, and what it does when
# its input is unavailable. It may not lean on an entry written about the
# detector. FOLLOW-771 is the ticket that had to be filed because FOLLOW-765
# added P3 and P4 and left them leaning on entry A.
#
#   A. [P1] SCAN_DIRS is only "$ROOT"/apps/*/src — a `sentry_sdk.init(` under
#      packages/, scripts/ or tests/integration/ is unscanned.
#      Region: the COMPLEMENT of the scan region — tracked `*.py` files at
#      $ROOT not under `apps/*/src` (in a SENTRY_INIT_TARGET run the complement
#      is empty BY CONSTRUCTION and the proof reads /dev/null). Scan root:
#      $ROOT. UNAVAILABLE INPUT: if `git ls-files` cannot be read the gate
#      exits 2 ("REGISTER SOURCE UNAVAILABLE") rather than evaluating this proof
#      over an empty — i.e. reassuring — region.
#      SECOND, PROOF-LESS BOUND (stated, deliberately not an entry): `$FILES`
#      also drops test-convention basenames (`test_*.py`, `*_test.py`,
#      `conftest.py`), so a real init in one of them is unscanned. That is
#      EXCLUSIONS item 2, a deliberate exclusion — a test file calling
#      `sentry_sdk.init(` for real is legitimate (this gate's own fixtures do
#      it), so any latency proof over that region would be permanently live and
#      would train readers to ignore the register. NOTE that this bound no
#      longer applies to P2/P3/P4: a REGISTERED test-convention mirror is
#      inventoried and marker-checked (FOLLOW-771 AC3).
#   B. [P1] The detection regex requires the literal `sentry_sdk.` prefix. A
#      module doing `from sentry_sdk import init` (or `import sentry_sdk as s`)
#      and calling the bare name is invisible here — the SAME residual
#      check-sentry-capture-has-init.sh records as its entry C. Fixing it
#      belongs in ONE ticket covering both gates, not here.
#      Region: $FILES (import lines in the scanned set).
#   C1. [P3] The marker check is FILE-scoped and textual, not call-scoped: a
#      file with two inits, where the three markers sit on the other one,
#      satisfies it. Rule J byte-identity keeps a registered pair from
#      diverging, but not from holding two inits.
#      Region: $REGISTERED (cleaned source of each registered `.py`).
#   C2. [P3] A registered `.py` mirror holding NO real init carries no marker
#      requirement — there is nothing to harden — so registration alone
#      suppresses it until it later GAINS an init, at which point the marker
#      check catches it. Region: $REGISTERED.
#   C3. [P3] The asserted set is the three FOLLOW-738 flags. The canonical also
#      pins an explicit `integrations=[...]` list, which this gate does not
#      assert; Rule J byte-identity is what keeps the mirrors equal to the
#      canonical on that. The proof watches registered files that PASS the
#      three-flag check yet carry no explicit integrations list, so it never
#      double-reports a file the UNHARDENED finding already names.
#      Region: $REGISTERED, restricted to marker-clean files.
#   D. [P1] `for f in $FILES` is unquoted word splitting — a filename
#      containing IFS whitespace would break the scan loop AND every proof that
#      word-splits the same list. Region: $FILES itself.
#   E. [P4] The exclusion baseline records PATHS only — not the content of each
#      excluded file. Content is covered by the marker check (ii) and by Rule J
#      byte-identity, so the shape that is genuinely unguarded on both axes is a
#      registered `.py` pair that opts OUT of byte-identity
#      (`strip_comments` other than true) — which is what the proof watches.
#      Region: scripts/mirror-files.json, the same file $REGISTERED comes from.
#   F. [P6] The two shared-helper guards check PRESENCE and `declare -F`, never
#      BEHAVIOUR. A helper that loaded, defined the name and returned raw source
#      would pass both. Semantics are guarded separately and twice, by each
#      gate's own untokenizable fixture; the proof watches the helper's exit-3
#      contract, whose removal is what a raw-source fallback would look like.
#      Region: scripts/lib/clean-python-source.sh.
#      (The former residual F — "neither hard-fail has a fixture, FOLLOW-769
#      owns that gap" — is CLOSED by FOLLOW-769 in this same PR: four fixtures
#      here and four in the sibling gate. Retired as a diff, not a deletion,
#      per Rule AP clause 5.)
#   G. [P7] Register entries are hand-written: a failure accumulator added to
#      this gate without a matching entry is invisible to the register. The
#      proof counts this script's `*_COUNT=0` / `*_MISMATCH=0` accumulators and
#      goes live when the number differs from the 5 this register was written
#      against. Region: this script.
#   H. [P2 + P3 + P4 — FOLLOW-771 AC5, the region bound that SURVIVES AC1]
#      The registered set is `_registered_mirror_py_paths()`, which filters the
#      manifest by the EXACT `.py` suffix. So the three controls now cover every
#      registered `.py` path regardless of scan-region membership — but a
#      Python-family mirror registered under another suffix (`.pyi`, `.pyw`,
#      `.pyx`, `.pxd`) is in NONE of them, and a non-Python mirror (the
#      registered `bandit.ts` pair) is correctly out of scope for a gate about
#      Python init sites. Region: scripts/mirror-files.json. Scan root:
#      $SCAN_ROOT, which is what each registered relative path is resolved
#      against. UNAVAILABLE INPUT: a registered path that does not resolve to a
#      file is a loud STALE MANIFEST ENTRY finding (exit 1), never a silent
#      skip; an unreadable manifest is a hard failure (P5).
#   P5 note (manifest read): P5 has no entry of its own by design — an
#      unreadable manifest already fails the gate loudly (exit 1) rather than
#      scanning with a guessed exclusion list, so there is no latent-vs-live
#      question to prove.
#   Not fixed here (out of this PR's AC): A, B, C1, C2, C3, D, E, F, G, H remain
#   open by design and are now MACHINE-CHECKED rather than asserted in prose.
#   Do NOT widen SCAN_DIRS to close A — that is its own ticket (FOLLOW-771 AC6
#   explicitly scopes it out).
#
# SELF-TEST
# ─────────
# bash scripts/check-sentry-init-singleton.sh --self-test
#
# One fixture per hole above, each RED-FIRST against the pre-FOLLOW-746 script:
# the item-6 (`latest_pricing.py`) and AC2 (unregistered `observability.py`)
# fixtures PASS there when they should fail (silent false GREEN); the AC3
# (trailing-comment, docstring) fixtures FAIL there when they should pass
# (false RED); and the FOLLOW-760 (unparseable) fixture exits 1 there under the
# WRONG diagnosis — the old script reports a confirmed `sentry_sdk.init(` call
# site on a file it never actually evaluated, when the only occurrence is in a
# comment. See the PR body for the pasted before/after transcript.
# Positive controls assert the exclusions still exclude what they must
# (registered mirrors, genuine test files) so a "fix" cannot be a deletion.
# All exit-code assertions check the SPECIFIC expected code, not merely
# non-zero.
#
# PLUS three FOLLOW-765 fixtures, both red-first against the pre-FOLLOW-765
# script (where each PASSES — exit 0): (a) a NEWLY registered, self-consistent
# mirror pair holding a BARE `sentry_sdk.init(` is caught as an UNHARDENED
# REGISTERED MIRROR instead of being excluded by its own registration; (b) an
# exclusion set that differs from the committed baseline in EITHER direction
# fails with the baseline-mismatch diagnosis; (c) a MISSING baseline fails
# rather than soft-passing. Every self-test run is pointed at a TEMP baseline,
# never the repo's committed one.
#
# PLUS, in this PR: three FOLLOW-771 fixtures, all red-first against the
# pre-FOLLOW-771 script (where each exits 0) — (a) a registered, self-consistent
# `.py` pair OUTSIDE the scan region holding a bare init must fail as BOTH a
# baseline mismatch and an UNHARDENED REGISTERED MIRROR; (b) a registered path
# with no file on disk must be its own loud STALE MANIFEST ENTRY finding; (c) a
# registered mirror named `test_helpers.py` — dropped from the scanned set by
# this gate's own `! -name "test_*.py"` — must still be inventoried AND
# marker-checked. PLUS four FOLLOW-769 fixtures: each of the two shared helpers
# under scripts/lib/, in each of its two failure shapes (missing file / present
# but defining nothing), asserted to exit 2 with the specific diagnosis, run
# against a COPY of this gate in a temp directory so SCRIPT_DIR resolves to a
# lib/ tree the fixture controls. PLUS one Rule AP fixture: registering a `.py`
# pair that holds NO init makes entry [C2]'s latency proof return hits, and the
# gate must exit 3 with a GONE LIVE diagnosis naming [C2] while every ordinary
# check stays clean.
#
# PROOF OF EXECUTION (Rule Q). `--self-test` is its own step in the
# `sentry-init-singleton` job of .github/workflows/ci.yml, run immediately
# before the real check on every push and PR, so every fixture above executes in
# CI on this PR — see the green run linked in the PR body.
#
# EXIT CODES
# ──────────
#   0 = pass (zero real sentry_sdk.init( call sites outside the registered
#       mirror paths, every scanned file tokenized cleanly, every excluded
#       mirror's init hardened, and the exclusion set equal to its baseline)
#   1 = finding — ANY of: a real bare sentry_sdk.init( call site outside the
#       registered mirrors; a file whose init shape could not be verified
#       because python3 could not tokenize it; the mirror manifest could
#       not be read (the gate must not guess its own exclusion list); an
#       EXCLUDED registered mirror whose init is missing a hardened marker
#       (FOLLOW-765 AC2); or the exclusion set differing from
#       scripts/baselines/sentry-init-mirror-exclusions.baseline in either
#       direction (FOLLOW-765 AC1); or a registered `.py` path that does not
#       exist on disk (FOLLOW-771 AC1 — a STALE MANIFEST ENTRY). Each has its
#       own heading.
#   2 = the gate itself is broken: a self-test failure, a shared helper under
#       scripts/lib/ missing or defining nothing, a Rule AP register latency
#       proof that could not be evaluated (ANY pipe stage exiting >= 2), or the
#       register's own region source being unreadable. Never a verdict on the
#       tree.
#   3 = a Rule AP REGISTER ENTRY HAS GONE LIVE — a gap this script's register
#       says is latent is now real. Distinct from 1 on purpose: the gate
#       worked, and what changed is the documented residual, not the scanned
#       code.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Shared helper: comment/docstring/string stripper (FOLLOW-746 item 8) ──────
CLEAN_LIB="$SCRIPT_DIR/lib/clean-python-source.sh"
if [[ ! -f "$CLEAN_LIB" ]]; then
  echo "FAIL: shared helper not found: $CLEAN_LIB"
  echo "This gate cannot evaluate Python sources without it, and must NOT fall"
  echo "back to raw-text matching (FOLLOW-746 item 8 / FOLLOW-760)."
  exit 2
fi
# shellcheck source=lib/clean-python-source.sh
source "$CLEAN_LIB"
if ! declare -F clean_python_source > /dev/null 2>&1; then
  echo "FAIL: $CLEAN_LIB did not define clean_python_source()."
  exit 2
fi

# ── Shared helper: suppression-baseline comparator (FOLLOW-765 / FOLLOW-759) ──
# Gives the registered-mirror exclusion inventory a CONSUMER. Shared with
# check-sentry-capture-has-init.sh — see this script's SUPPRESSION BASELINE
# header section and the helper's own header for why one mechanism, not two.
BASELINE_LIB="$SCRIPT_DIR/lib/suppression-baseline.sh"
if [[ ! -f "$BASELINE_LIB" ]]; then
  echo "FAIL: shared helper not found: $BASELINE_LIB"
  echo "This gate cannot verify its exclusion set against the committed baseline"
  echo "without it, and must NOT skip the comparison (FOLLOW-765)."
  exit 2
fi
# shellcheck source=lib/suppression-baseline.sh
source "$BASELINE_LIB"
if ! declare -F compare_suppression_baseline > /dev/null 2>&1; then
  echo "FAIL: $BASELINE_LIB did not define compare_suppression_baseline()."
  exit 2
fi

MANIFEST="${SENTRY_INIT_MIRROR_MANIFEST:-$ROOT/scripts/mirror-files.json}"
EXCLUSION_BASELINE="${SENTRY_INIT_EXCLUSION_BASELINE:-$ROOT/scripts/baselines/sentry-init-mirror-exclusions.baseline}"

# The three FOLLOW-738 hardening flags. An EXCLUDED registered mirror that
# holds a real `sentry_sdk.init(` must carry all of them in code that survives
# clean_python_source — otherwise the exclusion is suppressing exactly the
# unsafe shape this gate exists to stop (FOLLOW-765 AC2).
HARDENED_MARKERS=(
  "default_integrations[[:space:]]*=[[:space:]]*False"
  "send_default_pii[[:space:]]*=[[:space:]]*False"
  "include_local_variables[[:space:]]*=[[:space:]]*False"
)

# Prints the .py paths registered in the Rule J manifest (canonical + mirror),
# one per line, deduped. Exits 3 if the manifest is missing or unparseable —
# the caller turns that into a hard failure rather than scanning with an empty
# (or basename-shaped) exclusion list.
_registered_mirror_py_paths() {
  python3 - "$MANIFEST" <<'PYEOF'
import json
import sys

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as f:
        pairs = json.load(f)
    out = []
    for pair in pairs:
        for key in ("canonical", "mirror"):
            value = pair.get(key)
            if value and value.endswith(".py") and value not in out:
                out.append(value)
    sys.stdout.write("\n".join(out))
    if out:
        sys.stdout.write("\n")
except Exception as exc:
    print(f"mirror manifest error on {path}: {exc}", file=sys.stderr)
    sys.exit(3)
PYEOF
}

# ── Self-test mode ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--self-test" ]]; then
  echo "=== Self-test mode ==="
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT

  st_manifest="$tmp_dir/mirror-files.json"
  st_out="$tmp_dir/.self_test_output"

  mkdir -p "$tmp_dir/app-a/src"
  mkdir -p "$tmp_dir/app-b/src/jobs"

  # The temp manifest registers the two helper copies below, exactly as
  # scripts/mirror-files.json registers the three real ones. Paths are relative
  # to the scan root (here $tmp_dir; in a real run, the repo root).
  cat > "$st_manifest" <<'JSONEOF'
[
  {
    "canonical": "app-a/src/observability.py",
    "mirror": "app-b/src/jobs/observability.py",
    "strip_comments": true
  }
]
JSONEOF

  # Every fixture run below is pointed at a TEMP exclusion baseline, so the
  # self-test never compares the fixture tree against the repo's real committed
  # baseline (FOLLOW-765). Exported once: `bash "$0"` inherits it.
  st_baseline="$tmp_dir/exclusions.baseline"
  export SENTRY_INIT_EXCLUSION_BASELINE="$st_baseline"

  # _st_write_baseline <count> [entry ...]
  _st_write_baseline() {
    local n="$1"
    shift
    {
      echo "# self-test temp baseline"
      echo "count: $n"
      local e
      for e in "$@"; do echo "$e"; done
    } > "$st_baseline"
  }
  _st_write_baseline 2 "app-a/src/observability.py" "app-b/src/jobs/observability.py"

  # Runs the gate over the fixture tree; stores output in $st_out, echoes rc.
  _st_run() {
    local rc=0
    SENTRY_INIT_TARGET="$tmp_dir" \
      SENTRY_INIT_MIRROR_MANIFEST="$st_manifest" \
      bash "$0" > "$st_out" 2>&1 || rc=$?
    echo "$rc"
  }

  # Asserts the fixture tree is reported CLEAN (exit 0).
  _st_expect_clean() {
    local label="$1"
    local rc
    rc=$(_st_run)
    if [[ "$rc" -ne 0 ]]; then
      echo "SELF-TEST FAIL: $label — expected a clean pass (0), got $rc."
      echo "--- gate output ---"
      cat "$st_out"
      exit 2
    fi
    echo "OK: self-test PASSED — $label"
  }

  # Asserts the fixture tree is FLAGGED with exit code 1, and (optionally) that
  # the output contains a required diagnostic string.
  _st_expect_flagged() {
    local label="$1"
    local needle="${2:-}"
    local rc
    rc=$(_st_run)
    if [[ "$rc" -eq 0 ]]; then
      echo "SELF-TEST FAIL: $label — the violation was NOT detected (exit 0)."
      echo "--- gate output ---"
      cat "$st_out"
      exit 2
    elif [[ "$rc" -ne 1 ]]; then
      echo "SELF-TEST FAIL: $label — expected the finding exit code (1), got $rc."
      echo "--- gate output ---"
      cat "$st_out"
      exit 2
    fi
    if [[ -n "$needle" ]] && ! grep -q "$needle" "$st_out"; then
      echo "SELF-TEST FAIL: $label — flagged, but without the expected"
      echo "  diagnostic '$needle' in the output."
      echo "--- gate output ---"
      cat "$st_out"
      exit 2
    fi
    echo "OK: self-test PASSED — $label"
  }

  # ── Positive control 1: the real init lives in the REGISTERED mirrors ─────
  # The fixture carries the three FOLLOW-738 hardening flags AND the explicit
  # integrations list, exactly as the real apps/intent-engine/src/observability.py
  # does — an excluded mirror missing a flag would be an UNHARDENED finding
  # (FOLLOW-765 AC2 below), and one missing the explicit list makes register
  # entry [C3] go live (the markers are not the canonical's whole hardened
  # shape).
  cat > "$tmp_dir/app-a/src/observability.py" <<'PYEOF'
import sentry_sdk

def init_sentry(dsn_env_name):
    sentry_sdk.init(
        dsn="placeholder",
        traces_sample_rate=0.0,
        include_local_variables=False,
        send_default_pii=False,
        default_integrations=False,
        integrations=[],
    )
PYEOF
  cp "$tmp_dir/app-a/src/observability.py" "$tmp_dir/app-b/src/jobs/observability.py"

  cat > "$tmp_dir/app-a/src/main.py" <<'PYEOF'
from observability import init_sentry
# A whole-line comment mentioning sentry_sdk.init( must NOT count.
init_sentry("SENTRY_DSN")
PYEOF

  _st_expect_clean "registered mirrors hold the only real init; whole-line comment ignored."

  # ── Positive control 2: genuine test-convention files stay excluded ───────
  # Guards against "fixing" the substring glob by deleting the exclusion.
  for tf in test_main.py main_test.py conftest.py; do
    cat > "$tmp_dir/app-a/src/$tf" <<'PYEOF'
import sentry_sdk

def _fixture():
    sentry_sdk.init(dsn="test-only", traces_sample_rate=0.0)
PYEOF
  done
  _st_expect_clean "genuine test-convention files (test_*.py, *_test.py, conftest.py) still excluded."
  rm -f "$tmp_dir/app-a/src/test_main.py" "$tmp_dir/app-a/src/main_test.py" \
    "$tmp_dir/app-a/src/conftest.py"

  # ── FOLLOW-746 AC3 (a): a TRAILING comment must not be a violation ────────
  # Against the pre-FOLLOW-746 script this fixture FAILS (false RED): the old
  # filter only dropped WHOLE-LINE comments.
  cat > "$tmp_dir/app-a/src/trailing_comment.py" <<'PYEOF'
from observability import init_sentry

_migrated = 1  # init_sentry() replaces the old sentry_sdk.init( call here

init_sentry("SENTRY_DSN")
PYEOF
  _st_expect_clean "FOLLOW-746 AC3(a) — a TRAILING comment mentioning sentry_sdk.init( is not a violation."
  rm -f "$tmp_dir/app-a/src/trailing_comment.py"

  # ── FOLLOW-746 AC3 (b): a DOCSTRING mention must not be a violation ───────
  # Against the pre-FOLLOW-746 script this fixture FAILS (false RED): there is
  # no `#` on the line at all, so the whole-line-comment filter never saw it.
  cat > "$tmp_dir/app-a/src/docstring_mention.py" <<'PYEOF'
"""Module docs.

Historically this module called sentry_sdk.init( directly; it now defers to
the shared hardened initialiser instead.
"""
from observability import init_sentry

init_sentry("SENTRY_DSN")
PYEOF
  _st_expect_clean "FOLLOW-746 AC3(b) — a DOCSTRING mention of sentry_sdk.init( is not a violation."
  rm -f "$tmp_dir/app-a/src/docstring_mention.py"

  # ── Negative control (FOLLOW-738 original): a re-introduced bare init ─────
  cat > "$tmp_dir/app-b/src/jobs/rogue_consumer.py" <<'PYEOF'
import sentry_sdk
import os

dsn = os.environ.get("SENTRY_DSN")
if dsn:
    sentry_sdk.init(dsn=dsn, traces_sample_rate=0.0)
PYEOF
  _st_expect_flagged "a bare sentry_sdk.init( outside the registered mirrors is detected." \
    "rogue_consumer.py"
  rm -f "$tmp_dir/app-b/src/jobs/rogue_consumer.py"

  # ── FOLLOW-746 AC2: an UNREGISTERED observability.py must be scanned ──────
  # Against the pre-FOLLOW-746 script this fixture PASSES (silent false GREEN
  # — the 4th-copy hole this ticket closes): `--exclude="observability.py"`
  # skipped every file with that basename, registered or not.
  mkdir -p "$tmp_dir/app-c/src"
  cat > "$tmp_dir/app-c/src/observability.py" <<'PYEOF'
import sentry_sdk

def init_sentry(dsn_env_name):
    # A 4th copy nobody registered in scripts/mirror-files.json, and NOT the
    # hardened initialiser: no include_local_variables/send_default_pii.
    sentry_sdk.init(dsn="unregistered", traces_sample_rate=1.0)
PYEOF
  _st_expect_flagged "FOLLOW-746 AC2 — an UNREGISTERED observability.py is scanned, not basename-excluded." \
    "app-c/src/observability.py"
  rm -rf "$tmp_dir/app-c"

  # ── FOLLOW-746 item 6: a production basename CONTAINING "test" ────────────
  # Against the pre-FOLLOW-746 script this fixture PASSES (silent false GREEN):
  # `--exclude="*test*.py"` matches `latest_pricing.py`, whose basename contains
  # "test" as a substring ("la-test-_pricing").
  cat > "$tmp_dir/app-a/src/latest_pricing.py" <<'PYEOF'
import sentry_sdk

def _boot():
    sentry_sdk.init(dsn="substring-name-masked", traces_sample_rate=1.0)
PYEOF
  _st_expect_flagged "FOLLOW-746 item 6 — a production basename containing 'test' (latest_pricing.py) is scanned." \
    "latest_pricing.py"
  rm -f "$tmp_dir/app-a/src/latest_pricing.py"

  # ── FOLLOW-760 contract: an UNPARSEABLE file is a loud finding ────────────
  # The shared helper writes nothing and exits 3 when python3 cannot tokenize a
  # file. This asserts the gate reports that as its own distinctly-tagged
  # finding instead of silently clearing the file or crashing.
  # The file's ONLY `sentry_sdk.init(` is inside a trailing comment, so the
  # honest answer is "not verifiable", not "violation": against the
  # pre-FOLLOW-746 script this fixture exits 1 claiming a confirmed call site
  # that does not exist (raw-text match on a file it never evaluated).
  cat > "$tmp_dir/app-a/src/unparseable.py" <<'PYEOF'
import sentry_sdk

_x = 1  # the only sentry_sdk.init( on this file is in THIS comment

_trailing = '''this triple-quoted string is never closed, so tokenize fails
PYEOF
  _st_expect_flagged "FOLLOW-760 — a file python3 cannot tokenize is a LOUD, distinctly-tagged finding." \
    "UNPARSEABLE"
  rm -f "$tmp_dir/app-a/src/unparseable.py"

  # ── FOLLOW-765 AC2 (RED-FIRST): a newly-registered, SELF-CONSISTENT pair ──
  # holding a BARE sentry_sdk.init( must be CAUGHT. The two copies are
  # byte-identical to EACH OTHER, so Rule J passes; test_observability.py never
  # imports them; and the pair's own registration excludes it from this gate's
  # scan. That is the hole residual C's old text claimed was covered. Against
  # the pre-FOLLOW-765 script this fixture PASSES (exit 0) — the manifest was an
  # editable suppression list for a security-shaped gate.
  st_manifest_rogue="$tmp_dir/mirror-files-rogue.json"
  cat > "$st_manifest_rogue" <<'JSONEOF'
[
  {
    "canonical": "app-a/src/observability.py",
    "mirror": "app-b/src/jobs/observability.py",
    "strip_comments": true
  },
  {
    "canonical": "app-a/src/telemetry_boot.py",
    "mirror": "app-b/src/jobs/telemetry_boot.py",
    "strip_comments": true
  }
]
JSONEOF
  cat > "$tmp_dir/app-a/src/telemetry_boot.py" <<'PYEOF'
import sentry_sdk


def boot(dsn):
    sentry_sdk.init(dsn=dsn, traces_sample_rate=1.0)
PYEOF
  cp "$tmp_dir/app-a/src/telemetry_boot.py" "$tmp_dir/app-b/src/jobs/telemetry_boot.py"

  # Baseline updated to the 4 registered paths on purpose, so this fixture
  # isolates the HARDENED-MARKER check from the baseline check below.
  _st_write_baseline 4 \
    "app-a/src/observability.py" \
    "app-a/src/telemetry_boot.py" \
    "app-b/src/jobs/observability.py" \
    "app-b/src/jobs/telemetry_boot.py"

  rc=0
  SENTRY_INIT_TARGET="$tmp_dir" \
    SENTRY_INIT_MIRROR_MANIFEST="$st_manifest_rogue" \
    bash "$0" > "$st_out" 2>&1 || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-765 AC2): a newly-registered, self-consistent mirror pair"
    echo "  holding a BARE sentry_sdk.init( was excluded and NOT caught — mirror-files.json"
    echo "  is still an editable suppression list for this gate."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  elif [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-765 AC2): expected the finding exit code (1), got $rc."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  if ! grep -q "UNHARDENED REGISTERED MIRRORS" "$st_out" \
    || ! grep -q "telemetry_boot.py" "$st_out"; then
    echo "SELF-TEST FAIL (FOLLOW-765 AC2): flagged, but not under the distinct UNHARDENED"
    echo "  REGISTERED MIRROR diagnosis naming the offending path."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-765 AC2) — a registered, self-consistent pair holding a"
  echo "  bare sentry_sdk.init( is caught by the hardened-marker check, not trusted."
  rm -f "$tmp_dir/app-a/src/telemetry_boot.py" "$tmp_dir/app-b/src/jobs/telemetry_boot.py" \
    "$st_manifest_rogue"

  # ── FOLLOW-765 AC1 (RED-FIRST): a GROWN exclusion set fails the gate ──────
  # Baseline still claims the 4 paths above; the tree is back to 2. Against the
  # pre-FOLLOW-765 script the exclusion count changed with NO consumer at all
  # (exit 0) — the silent growth this ticket closes. Both directions fail: a
  # stale baseline is as dangerous as an unreviewed addition.
  rc=$(_st_run)
  if [[ "$rc" -eq 0 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-765 AC1): the exclusion set differed from the committed"
    echo "  baseline and the gate still passed — the inventory has no consumer."
    exit 2
  elif [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-765 AC1): expected the finding exit code (1), got $rc."
    exit 2
  fi
  if ! grep -q "does not match its committed" "$st_out"; then
    echo "SELF-TEST FAIL (FOLLOW-765 AC1): flagged, but not under the distinct"
    echo "  baseline-mismatch diagnosis."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-765 AC1) — an exclusion set that differs from the"
  echo "  committed baseline is a LOUD, distinctly-diagnosed failure."

  # ── FOLLOW-765 AC1: a MISSING baseline must fail, never soft-pass ─────────
  rm -f "$st_baseline"
  rc=$(_st_run)
  if [[ "$rc" -ne 1 ]] || ! grep -q "committed baseline not found" "$st_out"; then
    echo "SELF-TEST FAIL (FOLLOW-765): a MISSING baseline must fail the gate (exit 1) with a"
    echo "  'committed baseline not found' diagnosis — it must never degrade to"
    echo "  'assume the current exclusion set is fine'. Got exit $rc."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-765) — a missing baseline fails the gate loudly."
  _st_write_baseline 2 "app-a/src/observability.py" "app-b/src/jobs/observability.py"
  _st_expect_clean "the fixture tree is clean again once the baseline matches the exclusion set."

  # ── Manifest failure must be loud, not an empty exclusion list ────────────
  rc=0
  SENTRY_INIT_TARGET="$tmp_dir" \
    SENTRY_INIT_MIRROR_MANIFEST="$tmp_dir/does-not-exist.json" \
    bash "$0" > "$st_out" 2>&1 || rc=$?
  if [[ "$rc" -ne 1 ]] || ! grep -q "mirror manifest" "$st_out"; then
    echo "SELF-TEST FAIL: an unreadable mirror manifest must fail the gate (exit 1) with a"
    echo "  'mirror manifest' diagnosis — the gate must not guess its own exclusion list."
    echo "  Got exit $rc."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  echo "OK: self-test PASSED — an unreadable mirror manifest fails the gate loudly."

  # ── FOLLOW-771 AC2 (RED-FIRST): a registered pair OUTSIDE the scan region ──
  # Both FOLLOW-765 controls used to live inside `for f in $FILES`, so a
  # registered `.py` pair with BOTH sides outside `apps/*/src` entered NEITHER:
  # the observed exclusion set never grew, the baseline matched, and a file the
  # manifest had just blessed as a legitimate `sentry_sdk.init(` site was never
  # marker-verified. Against the pre-FOLLOW-771 script this fixture exits 0 with
  # a matching (zero-entry) baseline; after the fix it must fail as BOTH a
  # baseline mismatch (the set grew) AND an UNHARDENED REGISTERED MIRROR.
  # The fixture's shape is the real repo's shape — a root holding apps/ and
  # packages/, with the scan region a subdirectory — and
  # scripts/mirror-files.json already registers a pair whose canonical is under
  # packages/, so this is established practice here, not a hypothetical.
  f771="$tmp_dir/f771"
  mkdir -p "$f771/apps/app-a/src" "$f771/packages/shared/src" "$f771/packages/other/src"
  cat > "$f771/apps/app-a/src/main.py" <<'PYEOF'
from observability import init_sentry

init_sentry("SENTRY_DSN")
PYEOF
  cat > "$f771/packages/shared/src/telemetry.py" <<'PYEOF'
import sentry_sdk


def boot(dsn):
    sentry_sdk.init(dsn=dsn, traces_sample_rate=1.0)
PYEOF
  cp "$f771/packages/shared/src/telemetry.py" "$f771/packages/other/src/telemetry.py"
  f771_manifest="$f771/mirror-files.json"
  cat > "$f771_manifest" <<'JSONEOF'
[
  {
    "canonical": "packages/shared/src/telemetry.py",
    "mirror": "packages/other/src/telemetry.py",
    "strip_comments": true
  }
]
JSONEOF
  f771_baseline="$f771/exclusions.baseline"
  {
    echo "# self-test temp baseline"
    echo "count: 0"
  } > "$f771_baseline"

  rc=0
  SENTRY_INIT_TARGET="$f771/apps/app-a/src" \
    SENTRY_INIT_SCAN_ROOT="$f771" \
    SENTRY_INIT_MIRROR_MANIFEST="$f771_manifest" \
    SENTRY_INIT_EXCLUSION_BASELINE="$f771_baseline" \
    bash "$0" > "$st_out" 2>&1 || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-771 AC2): a registered, self-consistent .py pair OUTSIDE"
    echo "  the scan region holding a BARE sentry_sdk.init( entered neither the exclusion"
    echo "  inventory nor the hardened-marker check — the two controls are still bounded"
    echo "  to the scan region while the register they guard is repo-wide (Rule AL)."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  elif [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL (FOLLOW-771 AC2): expected the finding exit code (1), got $rc."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  if ! grep -q "does not match its committed" "$st_out"; then
    echo "SELF-TEST FAIL (FOLLOW-771 AC2): the out-of-region pair did not grow the observed"
    echo "  exclusion set (no baseline-mismatch diagnosis)."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  if ! grep -q "UNHARDENED REGISTERED MIRRORS" "$st_out" \
    || ! grep -q "packages/shared/src/telemetry.py" "$st_out"; then
    echo "SELF-TEST FAIL (FOLLOW-771 AC2): the out-of-region pair was not marker-checked"
    echo "  (no UNHARDENED REGISTERED MIRROR finding naming its path)."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-771 AC2) — a registered pair OUTSIDE the scan region is"
  echo "  inventoried AND marker-checked; the manifest is the region now, not apps/*/src."

  # ── FOLLOW-771 AC1: a registered path with no file on disk is its OWN ─────
  # loud diagnosis. A silent skip would restore the same hole by another route
  # (register a path, delete the file, keep the exclusion).
  rm -f "$f771/packages/other/src/telemetry.py"
  rc=0
  SENTRY_INIT_TARGET="$f771/apps/app-a/src" \
    SENTRY_INIT_SCAN_ROOT="$f771" \
    SENTRY_INIT_MIRROR_MANIFEST="$f771_manifest" \
    SENTRY_INIT_EXCLUSION_BASELINE="$f771_baseline" \
    bash "$0" > "$st_out" 2>&1 || rc=$?
  if [[ "$rc" -ne 1 ]] || ! grep -q "STALE MANIFEST ENTRIES" "$st_out" \
    || ! grep -q "no such file under" "$st_out"; then
    echo "SELF-TEST FAIL (FOLLOW-771 AC1): a registered .py path that does not exist on"
    echo "  disk must be its own loud diagnosis (exit 1, STALE MANIFEST ENTRIES), never a"
    echo "  silent skip. Got exit $rc."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-771 AC1) — a stale manifest entry is a distinct, loud"
  echo "  finding rather than a suppression nothing can verify."
  rm -rf "$f771"

  # ── FOLLOW-771 AC3 (RED-FIRST): the test-name axis of the same defect ─────
  # A registered `.py` mirror named test_helpers.py is dropped from `$FILES` by
  # this gate's own `! -name "test_*.py"` exclusion, so before the fix it was
  # never inventoried and never marker-checked even though it sits INSIDE the
  # scan region. Against the pre-FOLLOW-771 script this fixture exits 0.
  cat > "$tmp_dir/app-a/src/test_helpers.py" <<'PYEOF'
import sentry_sdk


def boot(dsn):
    sentry_sdk.init(dsn=dsn, traces_sample_rate=1.0)
PYEOF
  cp "$tmp_dir/app-a/src/test_helpers.py" "$tmp_dir/app-b/src/jobs/test_helpers.py"
  st_manifest_testname="$tmp_dir/mirror-files-testname.json"
  cat > "$st_manifest_testname" <<'JSONEOF'
[
  {
    "canonical": "app-a/src/observability.py",
    "mirror": "app-b/src/jobs/observability.py",
    "strip_comments": true
  },
  {
    "canonical": "app-a/src/test_helpers.py",
    "mirror": "app-b/src/jobs/test_helpers.py",
    "strip_comments": true
  }
]
JSONEOF

  # (a) baseline still at 2: the registered test-convention mirrors must GROW
  #     the observed exclusion set.
  rc=0
  SENTRY_INIT_TARGET="$tmp_dir" \
    SENTRY_INIT_MIRROR_MANIFEST="$st_manifest_testname" \
    bash "$0" > "$st_out" 2>&1 || rc=$?
  if [[ "$rc" -ne 1 ]] || ! grep -q "does not match its committed" "$st_out" \
    || ! grep -q "app-a/src/test_helpers.py" "$st_out"; then
    echo "SELF-TEST FAIL (FOLLOW-771 AC3): a registered mirror matched by the gate's own"
    echo "  test-name exclusion was not inventoried (expected exit 1 with a baseline"
    echo "  mismatch naming it). Got exit $rc."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-771 AC3a) — a registered test_*.py mirror is inventoried"
  echo "  even though the scan loop never sees it."

  # (b) baseline updated to 4, isolating the MARKER check: the same files hold a
  #     bare init, so they must be UNHARDENED findings.
  _st_write_baseline 4 \
    "app-a/src/observability.py" \
    "app-a/src/test_helpers.py" \
    "app-b/src/jobs/observability.py" \
    "app-b/src/jobs/test_helpers.py"
  rc=0
  SENTRY_INIT_TARGET="$tmp_dir" \
    SENTRY_INIT_MIRROR_MANIFEST="$st_manifest_testname" \
    bash "$0" > "$st_out" 2>&1 || rc=$?
  if [[ "$rc" -ne 1 ]] || ! grep -q "UNHARDENED REGISTERED MIRRORS" "$st_out" \
    || ! grep -q "test_helpers.py — missing" "$st_out"; then
    echo "SELF-TEST FAIL (FOLLOW-771 AC3): a registered test_*.py mirror holding a BARE"
    echo "  sentry_sdk.init( was not marker-checked (expected exit 1 with an UNHARDENED"
    echo "  REGISTERED MIRROR finding naming it). Got exit $rc."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  echo "OK: self-test PASSED (FOLLOW-771 AC3b) — a registered test_*.py mirror is"
  echo "  marker-checked; registration alone no longer suppresses it."
  rm -f "$tmp_dir/app-a/src/test_helpers.py" "$tmp_dir/app-b/src/jobs/test_helpers.py" \
    "$st_manifest_testname"
  _st_write_baseline 2 "app-a/src/observability.py" "app-b/src/jobs/observability.py"

  # ── FOLLOW-769 AC1/AC2: the shared-helper hard-fail contract, FIXTURED ────
  # Two helpers x two failure shapes. Same four cases as the sibling gate; both
  # gates promise "a missing helper fails this gate with exit 2 — it never
  # degrades to raw-text matching" and neither exercised it.
  helper_dir="$tmp_dir/helper-fixture"
  helper_out="$tmp_dir/.follow_769_self_test_output"
  _st_helper_case() {
    local label="$1" expect_needle="$2"
    local hrc=0
    SENTRY_INIT_TARGET="$tmp_dir" bash "$helper_dir/gate.sh" > "$helper_out" 2>&1 || hrc=$?
    if [[ "$hrc" -ne 2 ]]; then
      echo "SELF-TEST FAIL (FOLLOW-769): $label — expected the broken-guard exit code (2),"
      echo "  got $hrc. A gate that cannot load its shared helper must NOT report a"
      echo "  verdict on the tree (exit 0/1); it must say it is broken."
      echo "--- gate output ---"
      cat "$helper_out"
      exit 2
    fi
    if ! grep -q "$expect_needle" "$helper_out"; then
      echo "SELF-TEST FAIL (FOLLOW-769): $label — exited 2, but without the expected"
      echo "  diagnosis '$expect_needle'."
      echo "--- gate output ---"
      cat "$helper_out"
      exit 2
    fi
    echo "OK: self-test PASSED (FOLLOW-769) — $label"
  }

  rm -rf "$helper_dir"
  mkdir -p "$helper_dir"
  cp "$0" "$helper_dir/gate.sh"
  _st_helper_case "a MISSING lib/clean-python-source.sh hard-fails the gate." \
    "shared helper not found: $helper_dir/lib/clean-python-source.sh"

  mkdir -p "$helper_dir/lib"
  cp "$CLEAN_LIB" "$helper_dir/lib/clean-python-source.sh"
  _st_helper_case "a MISSING lib/suppression-baseline.sh hard-fails the gate." \
    "shared helper not found: $helper_dir/lib/suppression-baseline.sh"

  : > "$helper_dir/lib/clean-python-source.sh"
  cp "$BASELINE_LIB" "$helper_dir/lib/suppression-baseline.sh"
  _st_helper_case "a lib/clean-python-source.sh that defines NOTHING hard-fails the gate." \
    "did not define clean_python_source()"

  cp "$CLEAN_LIB" "$helper_dir/lib/clean-python-source.sh"
  : > "$helper_dir/lib/suppression-baseline.sh"
  _st_helper_case "a lib/suppression-baseline.sh that defines NOTHING hard-fails the gate." \
    "did not define compare_suppression_baseline()"
  rm -rf "$helper_dir" "$helper_out"

  # ── Rule AP verification (CONVENTIONS_PATCH Rule AP) ──────────────────────
  # A REGISTER ENTRY GOING LIVE must fail the gate with a diagnosis DISTINCT
  # from an ordinary finding, naming the entry id. Entry [C2] records that a
  # registered `.py` mirror holding NO real init carries no marker requirement,
  # so registration alone suppresses it until it later gains one. Registering
  # exactly such a pair makes its proof return hits. The baseline is set to
  # match on purpose, and an init-less file can produce neither an UNHARDENED
  # nor a VIOLATION finding, so exit 3 can only come from the register.
  # RED-FIRST: against the pre-register script this fixture exits 0.
  cat > "$tmp_dir/app-a/src/no_init_helper.py" <<'PYEOF'
def helper():
    return "no sentry init here at all"
PYEOF
  cp "$tmp_dir/app-a/src/no_init_helper.py" "$tmp_dir/app-b/src/jobs/no_init_helper.py"
  st_manifest_noinit="$tmp_dir/mirror-files-noinit.json"
  cat > "$st_manifest_noinit" <<'JSONEOF'
[
  {
    "canonical": "app-a/src/observability.py",
    "mirror": "app-b/src/jobs/observability.py",
    "strip_comments": true
  },
  {
    "canonical": "app-a/src/no_init_helper.py",
    "mirror": "app-b/src/jobs/no_init_helper.py",
    "strip_comments": true
  }
]
JSONEOF
  _st_write_baseline 4 \
    "app-a/src/no_init_helper.py" \
    "app-a/src/observability.py" \
    "app-b/src/jobs/no_init_helper.py" \
    "app-b/src/jobs/observability.py"
  rc=0
  SENTRY_INIT_TARGET="$tmp_dir" \
    SENTRY_INIT_MIRROR_MANIFEST="$st_manifest_noinit" \
    bash "$0" > "$st_out" 2>&1 || rc=$?
  if [[ "$rc" -ne 3 ]]; then
    echo "SELF-TEST FAIL (Rule AP): a register entry whose latency proof now returns hits"
    echo "  did not fail the gate with the distinct GONE LIVE exit code (expected 3, got"
    echo "  $rc) — this is the Rule AP clause 2 contract."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  if ! grep -q "GONE LIVE" "$st_out" || ! grep -q "\[C2\]" "$st_out"; then
    echo "SELF-TEST FAIL (Rule AP): the gone-live residual was not reported with the"
    echo "  distinct GONE LIVE diagnosis naming its entry id (C2)."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  if ! grep -q "matches the committed baseline" "$st_out"; then
    echo "SELF-TEST FAIL (Rule AP): the fixture was supposed to isolate the register — the"
    echo "  exclusion baseline should have MATCHED, so exit 3 comes only from the register."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  echo "OK: self-test PASSED (Rule AP) — a register entry going live fails the gate (exit 3)"
  echo "  with a distinct diagnosis naming [C2], while every ordinary check is clean."
  rm -f "$tmp_dir/app-a/src/no_init_helper.py" "$tmp_dir/app-b/src/jobs/no_init_helper.py" \
    "$st_manifest_noinit"
  _st_write_baseline 2 "app-a/src/observability.py" "app-b/src/jobs/observability.py"

  echo ""
  echo "Self-test PASSED."
  exit 0
fi

# ── Real check ────────────────────────────────────────────────────────────────
TARGET="${SENTRY_INIT_TARGET:-}"

echo "=== Sentry init singleton guard (FOLLOW-738 / FOLLOW-746) ==="

if [[ -n "$TARGET" ]]; then
  SCAN_DIRS=("$TARGET")
  # SENTRY_INIT_SCAN_ROOT (self-test only) lets a fixture put the scan region in
  # a SUBDIRECTORY of the root that manifest paths are relative to — which is
  # the real repo's shape (root = repo, scan region = apps/*/src) and the only
  # way to express a registered pair that lies OUTSIDE the scan region, i.e. the
  # FOLLOW-771 case. Without it, TARGET is both the root and the region, so that
  # case is inexpressible and would have gone on being untested.
  SCAN_ROOT="${SENTRY_INIT_SCAN_ROOT:-$TARGET}"
else
  SCAN_DIRS=()
  for d in "$ROOT"/apps/*/src; do
    [[ -d "$d" ]] && SCAN_DIRS+=("$d")
  done
  SCAN_ROOT="$ROOT"
fi

echo "Scanning: ${SCAN_DIRS[*]}"
echo ""

# ── Registered Rule J mirror paths = the ONLY legitimate init sites ──────────
REGISTERED=""
manifest_rc=0
REGISTERED=$(_registered_mirror_py_paths) || manifest_rc=$?
if [[ "$manifest_rc" -ne 0 ]]; then
  echo "FAIL: could not read the Rule J mirror manifest: $MANIFEST"
  echo ""
  echo "This gate derives its exclusion list from the registered mirror paths"
  echo "(FOLLOW-746 AC2). Without the manifest it would have to guess — either"
  echo "excluding by basename (the 4th-copy hole this ticket closed) or"
  echo "excluding nothing (a false RED on the legitimate mirrors). Neither is"
  echo "acceptable, so an unreadable manifest is a hard failure."
  exit 1
fi

echo "Registered Rule J mirror paths (the only legitimate sentry_sdk.init( sites):"
if [[ -n "$REGISTERED" ]]; then
  # shellcheck disable=SC2001  # prefixing every line of a multi-line string;
  # a parameter-expansion replacement cannot anchor to line starts here.
  echo "$REGISTERED" | sed 's/^/  /'
else
  echo "  (none registered — every sentry_sdk.init( call site will be flagged)"
fi
echo ""

FILES=$(
  find "${SCAN_DIRS[@]}" -type f -name "*.py" \
    ! -name "test_*.py" \
    ! -name "*_test.py" \
    ! -name "conftest.py" \
    2>/dev/null || true
)

VIOLATIONS=""
VIOLATION_COUNT=0
UNPARSEABLE=""
UNPARSEABLE_COUNT=0
UNHARDENED=""
UNHARDENED_COUNT=0
STALE=""
STALE_COUNT=0
EXCLUDED_OBSERVED=$(mktemp)
# Register evidence, accumulated while the registered set is walked (entries
# C1/C2/C3 below read exactly what their controls read — Rule AL).
SI_MULTI_INIT=""
SI_NOINIT=""
SI_NO_INTEGRATIONS=""

# ── Controls over the REGISTERED SET (FOLLOW-771 AC1) ────────────────────────
# The exclusion inventory and the hardened-marker check iterate `$REGISTERED` —
# the manifest-derived `.py` paths — NOT `$FILES`. They used to live inside the
# `for f in $FILES` loop, which bounded them to `apps/*/src` while the
# suppression register they guard (scripts/mirror-files.json) is repo-wide: a
# registered pair with BOTH sides outside the scan region entered NEITHER
# control, the observed exclusion set stayed at 3, the baseline matched, and a
# file the manifest had just blessed as a legitimate `sentry_sdk.init(` site was
# never marker-verified. That is Rule AL — an assertion evaluated over a
# narrower region than the register it guards — and it made the header's and the
# baseline file's redden-on-a-fourth-pair guarantee false for exactly the case
# that matters. `mirror-files.json` is the region now.
#
# A registered path that does not exist on disk is its OWN loud diagnosis (a
# stale manifest entry), never a silent skip: silence there would restore the
# same hole by a different route (register a path, delete the file, the
# exclusion is inventoried but nothing is ever checked).
if [[ -n "$REGISTERED" ]]; then
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    # Membership in the suppression set is a property of the MANIFEST, so it is
    # recorded before the file is even opened — a stale entry still suppresses.
    printf '%s\n' "$rel" >> "$EXCLUDED_OBSERVED"

    f="$SCAN_ROOT/$rel"
    if [[ ! -f "$f" ]]; then
      STALE="${STALE}  ${rel} (registered in $MANIFEST; no such file under $SCAN_ROOT)"$'\n'
      STALE_COUNT=$((STALE_COUNT + 1))
      continue
    fi

    # Registered mirror path → excluded from the init scan, but NOT trusted
    # blindly: if it holds a real init, that init must be the hardened one
    # (FOLLOW-765 AC2, residual C). Byte-identity to a named canonical would be
    # satisfied trivially by a newly-registered self-consistent pair; the marker
    # check tests the property the exclusion actually assumes.
    excl_cleaned=""
    excl_rc=0
    excl_cleaned=$(clean_python_source "$f") || excl_rc=$?
    if [[ "$excl_rc" -ne 0 ]]; then
      # An excluded file we cannot even tokenize is the worst case: suppressed
      # AND unverifiable. Same FOLLOW-760 contract as any other file.
      UNPARSEABLE="${UNPARSEABLE}  ${rel} (registered mirror; python3 tokenize exit $excl_rc — hardened shape NOT verified)"$'\n'
      UNPARSEABLE_COUNT=$((UNPARSEABLE_COUNT + 1))
      continue
    fi

    excl_init_count=$(printf '%s\n' "$excl_cleaned" | grep -cE "sentry_sdk\.init\(" || true)
    if [[ "$excl_init_count" -gt 0 ]]; then
      [[ "$excl_init_count" -gt 1 ]] && SI_MULTI_INIT="${SI_MULTI_INIT}${rel} (${excl_init_count} real init call sites)"$'\n'
      missing=""
      for marker in "${HARDENED_MARKERS[@]}"; do
        if ! printf '%s\n' "$excl_cleaned" | grep -qE "$marker"; then
          # Display the flag name (everything before the first regex bracket).
          missing="${missing}${missing:+, }${marker%%\[*}=False"
        fi
      done
      if [[ -n "$missing" ]]; then
        UNHARDENED="${UNHARDENED}  ${rel} — missing: ${missing}"$'\n'
        UNHARDENED_COUNT=$((UNHARDENED_COUNT + 1))
      elif ! printf '%s\n' "$excl_cleaned" | grep -qE "(^|[^_[:alnum:]])integrations[[:space:]]*="; then
        # Register entry C3: this file passes the three-flag marker check yet
        # does NOT pin an explicit integrations list the way the canonical
        # does. Evaluated only on files the marker check CLEARS, so it reports
        # the residual (markers are not the whole hardened shape) and never
        # double-reports a file the UNHARDENED finding already names.
        SI_NO_INTEGRATIONS="${SI_NO_INTEGRATIONS}${rel}"$'\n'
      fi
    else
      SI_NOINIT="${SI_NOINIT}${rel}"$'\n'
    fi
  done <<< "$REGISTERED"
fi

# ── Control over the SCANNED SET: bare-init detection ────────────────────────
for f in $FILES; do
  rel="${f#"$SCAN_ROOT"/}"

  # Registered paths are handled above, over the manifest region.
  if [[ -n "$REGISTERED" ]] && printf '%s\n' "$REGISTERED" | grep -Fxq -- "$rel"; then
    continue
  fi

  cleaned=""
  clean_rc=0
  # `clean_python_source` exits 3 (no stdout) when python3 cannot tokenize the
  # file. Capture that via `||` so it does not trip `set -e` — this is "cannot
  # evaluate", which must be reported, not swallowed (FOLLOW-760).
  cleaned=$(clean_python_source "$f") || clean_rc=$?
  if [[ "$clean_rc" -ne 0 ]]; then
    UNPARSEABLE="${UNPARSEABLE}  ${rel} (python3 tokenize exit $clean_rc — init shape NOT verified)"$'\n'
    UNPARSEABLE_COUNT=$((UNPARSEABLE_COUNT + 1))
    continue
  fi

  hits=$(printf '%s\n' "$cleaned" | grep -nE "sentry_sdk\.init\(" | cut -d: -f1 || true)
  [[ -z "$hits" ]] && continue

  while IFS= read -r ln; do
    [[ -z "$ln" ]] && continue
    orig_line=$(sed -n "${ln}p" "$f")
    VIOLATIONS="${VIOLATIONS}  ${rel}:${ln}:${orig_line}"$'\n'
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  done <<< "$hits"
done

# ── Exclusion inventory + its baseline consumer (FOLLOW-765 AC1) ─────────────
BASELINE_MISMATCH=0
compare_suppression_baseline \
  "Registered mirror files excluded from the scan" \
  "$EXCLUSION_BASELINE" \
  "$EXCLUDED_OBSERVED" || BASELINE_MISMATCH=1
rm -f "$EXCLUDED_OBSERVED"
echo ""

echo "UNHARDENED REGISTERED MIRRORS (excluded from the scan, but their"
echo "sentry_sdk.init( is missing a FOLLOW-738 hardening flag — FOLLOW-765"
echo "AC2): $UNHARDENED_COUNT"
if [[ "$UNHARDENED_COUNT" -gt 0 ]]; then
  printf '%s' "$UNHARDENED"
fi
echo ""

echo "STALE MANIFEST ENTRIES (registered as a Rule J .py mirror, but no such file"
echo "on disk — the path is suppressed and nothing can ever be checked on it —"
echo "FOLLOW-771 AC1): $STALE_COUNT"
if [[ "$STALE_COUNT" -gt 0 ]]; then
  printf '%s' "$STALE"
fi
echo ""

echo "UNPARSEABLE FILES (python3 could not tokenize; treated as findings, not"
echo "silently cleared — FOLLOW-760): $UNPARSEABLE_COUNT"
if [[ "$UNPARSEABLE_COUNT" -gt 0 ]]; then
  printf '%s' "$UNPARSEABLE"
fi
echo ""

# ── Rule AP residual register (FOLLOW-771 AC5) ───────────────────────────────
# Region sources for the entries below, built HERE so every proof reads exactly
# the region its control reads (Rule AL) in BOTH modes — the real scan and a
# SENTRY_INIT_TARGET fixture run.
if [[ -z "$FILES" ]]; then
  # grep with no file operands would read stdin and hang; /dev/null is the
  # empty region and keeps the proof's exit status meaningful (1, no output).
  SI_FILES_OPERANDS="/dev/null"
else
  SI_FILES_OPERANDS="$FILES"
fi

# Entry [A] reads the COMPLEMENT of the scan region — the .py files this gate
# never looks at.
if [[ -n "$TARGET" ]]; then
  # In TARGET mode SCAN_DIRS is the whole scan root, so the complement is empty
  # BY CONSTRUCTION — a known-empty region, not an unreadable one.
  SI_OUTSIDE_OPERANDS="/dev/null"
else
  si_ls_rc=0
  si_tracked_py=$(git -C "$ROOT" ls-files -- '*.py') || si_ls_rc=$?
  if [[ "$si_ls_rc" -ne 0 ]]; then
    echo "FAIL: REGISTER SOURCE UNAVAILABLE — \`git ls-files\` exited $si_ls_rc at"
    echo "$ROOT, so register entry [A]'s region (the .py files OUTSIDE the scan"
    echo "region) could not be enumerated. A residual whose latency proof cannot"
    echo "be evaluated is never assumed still latent (Rule AP clause 2), so this"
    echo "is a hard failure rather than an empty — i.e. reassuring — region."
    exit 2
  fi
  SI_OUTSIDE_OPERANDS=""
  while IFS= read -r si_p; do
    [[ -z "$si_p" ]] && continue
    case "$si_p" in apps/*/src/*) continue ;; esac
    # A tracked-but-deleted index entry is not a readable operand; skipping it
    # keeps the proof's exit status meaningful instead of an unrelated grep 2.
    [[ -f "$ROOT/$si_p" ]] || continue
    SI_OUTSIDE_OPERANDS="${SI_OUTSIDE_OPERANDS}${ROOT}/${si_p}"$'\n'
  done <<< "$si_tracked_py"
  [[ -z "$SI_OUTSIDE_OPERANDS" ]] && SI_OUTSIDE_OPERANDS="/dev/null"
fi

# NOTE — why there is NO entry for the test-convention basename exclusion.
# `$FILES` is narrower than SCAN_DIRS in two ways: by directory (entry [A]) and
# by basename convention (`test_*.py`, `*_test.py`, `conftest.py`). The second
# half is deliberately NOT a register entry, and that is a judgement, not an
# omission: a test file calling `sentry_sdk.init(` for real is legitimate and
# common (this gate's own self-test fixtures do it), so ANY latency proof over
# that region would be permanently live and would train readers to ignore the
# register — the opposite of what Rule AP is for. It is recorded as a bound with
# no proof, in entry [A]'s header text and in EXCLUSIONS item 2, rather than
# given a proof that means nothing.

# Manifest-derived facts for entries E and H — read from the SAME manifest the
# exclusion set comes from, so the proofs cannot drift from the register they
# describe.
SI_MANIFEST_FACTS=$(
  python3 - "$MANIFEST" <<'PYEOF' || true
import json
import sys

try:
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        pairs = json.load(f)
except Exception:
    sys.exit(0)

py_family = (".pyi", ".pyw", ".pyx", ".pxd")
for pair in pairs:
    strip = pair.get("strip_comments")
    for key in ("canonical", "mirror"):
        value = pair.get(key)
        if not value:
            continue
        if value.endswith(".py") and strip is not True:
            print(f"NONBYTE\t{value}")
        if value.endswith(py_family):
            print(f"PYFAMILY\t{value}")
PYEOF
)
SI_NONBYTE_PY=$(printf '%s\n' "$SI_MANIFEST_FACTS" | awk -F'\t' '$1=="NONBYTE"{print $2}')
SI_PYFAMILY=$(printf '%s\n' "$SI_MANIFEST_FACTS" | awk -F'\t' '$1=="PYFAMILY"{print $2}')

SI_SELF="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
SI_CLEAN_LIB="$CLEAN_LIB"
export SI_FILES_OPERANDS SI_OUTSIDE_OPERANDS SI_SELF SI_CLEAN_LIB
export SI_MULTI_INIT SI_NOINIT SI_NO_INTEGRATIONS SI_NONBYTE_PY SI_PYFAMILY
export SI_FILES="$FILES"

# id | control | one-line description | latency proof
# EMPTY stdout ⇒ the residual is still latent. Output ⇒ it has GONE LIVE.
# ANY pipe stage exiting ≥ 2 — not merely the pipeline's own reported status ⇒
# the gate is broken (see PER-STAGE PROOF STATUS in the header). See the header
# for each entry's region, scan root and unavailable-input behaviour.
# shellcheck disable=SC2016  # DELIBERATE: proof strings must NOT expand here.
# They are executed later by `bash -c`, which expands them against the exported
# region variables. Expanding at array-definition time would bake one run's
# file list into the register.
RESIDUAL_REGISTER=(
  'A|P1-init-detection|the scan region is apps/*/src only: a bare init anywhere else in the repo is never looked at|grep -HnE "sentry_sdk\.init\(" $SI_OUTSIDE_OPERANDS'
  'B|P1-init-detection|detection requires the literal sentry_sdk. prefix, so a from-import or aliased import of init is invisible|grep -HnE "^[[:space:]]*(from sentry_sdk import|import sentry_sdk as)" $SI_FILES_OPERANDS'
  'C1|P3-hardened-marker|the marker check is FILE-scoped, not call-scoped: a registered mirror with two inits satisfies it if the markers sit on the other one|printf "%s" "$SI_MULTI_INIT"'
  'C2|P3-hardened-marker|a registered .py mirror holding NO real init carries no marker requirement, so registration alone suppresses it until it later gains one|printf "%s" "$SI_NOINIT"'
  'C3|P3-hardened-marker|only the three FOLLOW-738 flags are asserted; the canonical also pins an explicit integrations list, which this gate does not check|printf "%s" "$SI_NO_INTEGRATIONS"'
  'D|P1-init-detection|the scan loop word-splits its file list, so a scanned path containing whitespace would break it|printf "%s" "$SI_FILES" | grep -nE "[[:blank:]]"'
  'E|P4-exclusion-baseline|the baseline records PATHS only, never content: content is covered by the marker check and by Rule J byte-identity, so a registered .py pair that opts OUT of byte-identity is unguarded on both axes|printf "%s" "$SI_NONBYTE_PY"'
  'F|P6-shared-helper-availability|the helper guards check presence and declare -F, never behaviour: a helper that loaded, defined the name and returned raw source would pass them|grep -L "sys.exit(3)" "$SI_CLEAN_LIB"'
  'G|P7-residual-register|entries are hand-written, so a failure accumulator added to this gate without an entry is invisible to the register|grep -cE "^[A-Z][A-Z_]*(COUNT|MISMATCH)=0$" "$SI_SELF" | grep -vx "5"'
  'H|P2-exclusion + P3-hardened-marker + P4-exclusion-baseline|the registered set is filtered by the exact .py suffix, so a Python-family mirror (.pyi/.pyw/.pyx/.pxd) is registered, suppressed by Rule J semantics, and in none of the three controls|printf "%s" "$SI_PYFAMILY"'
)

echo "=== Rule AP residual register — ${#RESIDUAL_REGISTER[@]} documented gap(s), every latency proof EXECUTED ==="
REGISTER_LIVE=0
REGISTER_BROKEN=0
reg_err=$(mktemp)
reg_ps=$(mktemp)

# ── RUNNER — byte-identical to scripts/check-mirror-files.sh's (FOLLOW-770 ────
# fix-iteration 1). Copied verbatim rather than re-derived, INCLUDING the
# MF_PS_FILE variable name, so the two runners diff to zero and a future fix to
# one is a mechanical copy to the other. Do not "clean it up" per gate.
#
# Appended to EVERY proof before execution. It records each pipe stage's OWN
# exit status (bash's PIPESTATUS) to $MF_PS_FILE, then re-exits with pipefail's
# own rightmost-non-zero status so the diagnostic below can still report it.
# See PER-STAGE PROOF STATUS in the header for why the pipeline's own status is
# not sufficient. Written as an epilogue rather than baked into each proof so
# the register keeps the one `id|control|description|proof` format (Rule AP
# clause 6) and EVERY entry — including ones added later, and ones copied into
# another gate — gets this for free instead of per-author discipline.
# shellcheck disable=SC2016  # DELIBERATE: this epilogue is source text appended
# to each proof and evaluated inside the proof's own `bash -c`; expanding
# PIPESTATUS here would capture THIS shell's status, which is the bug it fixes.
REGISTER_PROOF_EPILOGUE='
__mf_ps=("${PIPESTATUS[@]}")
printf "%s\n" "${__mf_ps[@]}" >"$MF_PS_FILE"
__mf_rc=0
for __mf_s in "${__mf_ps[@]}"; do if [ "$__mf_s" -ne 0 ]; then __mf_rc="$__mf_s"; fi; done
exit "$__mf_rc"
'

for entry in "${RESIDUAL_REGISTER[@]}"; do
  # Only the first three '|' delimit; the rest of the line is the proof, which
  # contains pipes of its own.
  IFS='|' read -r r_id r_control r_desc r_proof <<< "$entry"
  r_rc=0
  : > "$reg_ps"
  # -o pipefail so a failing producer inside a pipe (e.g. git exiting 128)
  # cannot masquerade as an empty — i.e. reassuring — result, AND the epilogue
  # so a SECOND stage's ordinary "no match" 1 cannot mask that producer either.
  r_out=$(MF_PS_FILE="$reg_ps" bash -o pipefail -c "$r_proof$REGISTER_PROOF_EPILOGUE" 2>"$reg_err") || r_rc=$?

  r_stages=()
  if [[ -s "$reg_ps" ]]; then mapfile -t r_stages < "$reg_ps"; fi
  # UNEVALUABLE is decided by the WORST stage, never by the pipeline's own
  # reported status.
  r_worst=0
  if [[ "${#r_stages[@]}" -gt 0 ]]; then
    for r_st in "${r_stages[@]}"; do
      if [[ "$r_st" =~ ^[0-9]+$ ]] && [[ "$r_st" -gt "$r_worst" ]]; then r_worst="$r_st"; fi
    done
    r_stages_txt="${r_stages[*]}"
  else
    # The proof never reached the epilogue: a syntax error, a signal, or an
    # explicit exit inside the proof. Its stage statuses — and therefore its
    # latency — could NOT be established, so it is UNEVALUABLE. Never "assume
    # still latent" (Rule AP clause 2), not even when the pipeline reported 0.
    r_worst=2
    if [[ "$r_rc" -gt 2 ]]; then r_worst="$r_rc"; fi
    r_stages_txt="none recorded"
  fi

  if [[ "$r_worst" -ge 2 ]]; then
    echo "  [$r_id] UNEVALUABLE ($r_control) $r_desc"
    echo "        proof:  $r_proof"
    echo "        status: stage exit codes [$r_stages_txt] (pipeline reported $r_rc);"
    echo "                a stage exited $r_worst — the residual's latency could NOT be established."
    if [[ -s "$reg_err" ]]; then sed 's/^/        stderr: /' "$reg_err"; fi
    REGISTER_BROKEN=$((REGISTER_BROKEN + 1))
  elif [[ -n "$r_out" ]]; then
    echo "  [$r_id] GONE LIVE   ($r_control) $r_desc"
    echo "        proof:  $r_proof"
    echo "        hits:"
    printf '%s\n' "$r_out" | sed 's/^/          /'
    REGISTER_LIVE=$((REGISTER_LIVE + 1))
  else
    echo "  [$r_id] latent      ($r_control) $r_desc"
  fi
done
rm -f "$reg_err" "$reg_ps"
echo "  ${#RESIDUAL_REGISTER[@]} entry/entries checked — $REGISTER_LIVE gone live, $REGISTER_BROKEN unevaluable."
echo ""

if [[ "$VIOLATION_COUNT" -eq 0 && "$UNPARSEABLE_COUNT" -eq 0 \
  && "$UNHARDENED_COUNT" -eq 0 && "$BASELINE_MISMATCH" -eq 0 \
  && "$STALE_COUNT" -eq 0 && "$REGISTER_LIVE" -eq 0 && "$REGISTER_BROKEN" -eq 0 ]]; then
  echo "PASS: no real sentry_sdk.init( call sites found outside the registered"
  echo "Rule J mirror paths, every scanned file tokenized cleanly, every excluded"
  echo "mirror's init carries the FOLLOW-738 hardening flags, and the exclusion"
  echo "set matches its committed baseline."
  echo ""
  echo "Every Python Modal app must call the shared init_sentry(<DSN_ENV_NAME>)"
  echo "helper (apps/intent-engine/src/observability.py and its Rule J mirrors)"
  echo "instead of calling sentry_sdk.init() directly."
  exit 0
fi

if [[ "$VIOLATION_COUNT" -gt 0 ]]; then
  echo "FAIL: $VIOLATION_COUNT real sentry_sdk.init( call site(s) found OUTSIDE the"
  echo "registered Rule J mirror paths:"
  echo ""
  printf '%s\n' "$VIOLATIONS"
  echo "ESC-045 item 4 hazard (FOLLOW-738): every Python Modal app shares one"
  echo "SENTRY_DSN and one Modal secret. A bare sentry_sdk.init() call here"
  echo "silently ships frame locals (send_default_pii/include_local_variables"
  echo "default to unsafe) and installs the default LoggingIntegration the"
  echo "moment SENTRY_DSN is provisioned."
  echo ""
  echo "FIX: replace the call above with:"
  echo "  from observability import init_sentry   # or the app-local import path"
  echo "  init_sentry(\"SENTRY_DSN\")"
  echo ""
  echo "If the file IS a legitimate new Rule J copy of the hardened helper,"
  echo "register it in scripts/mirror-files.json (canonical + mirror) — the"
  echo "mirror gate then enforces byte-identity on it, and this gate excludes"
  echo "it. A 4th, unregistered copy is exactly what FOLLOW-746 closed."
  echo ""
fi

if [[ "$UNPARSEABLE_COUNT" -gt 0 ]]; then
  echo "FAIL: the file(s) above could not be tokenized by python3 — their"
  echo "sentry_sdk.init( shape could NOT be verified, so each is treated as a"
  echo "finding rather than silently cleared (FOLLOW-760: a gate that cannot"
  echo "evaluate a file must not report it clean). See stderr above for the"
  echo "tokenizer error on each path."
  echo ""
  echo "FIX: make the file tokenizable (fix the syntax/encoding error)."
  echo ""
fi

if [[ "$UNHARDENED_COUNT" -gt 0 ]]; then
  echo "FAIL: $UNHARDENED_COUNT registered mirror file(s) are EXCLUDED from the scan but"
  echo "hold a sentry_sdk.init( that is missing a FOLLOW-738 hardening flag."
  echo ""
  echo "This is the shape FOLLOW-765 closed: registering a NEW, self-consistent"
  echo "pair in scripts/mirror-files.json (byte-identical to each other, holding a"
  echo "bare init) passes Rule J, is untouched by test_observability.py, and would"
  echo "be excluded here by its own registration — i.e. the manifest would be an"
  echo "editable suppression list for this gate. An excluded init must be the"
  echo "HARDENED one:"
  echo "  include_local_variables=False,"
  echo "  send_default_pii=False,"
  echo "  default_integrations=False,"
  echo ""
  echo "FIX: make the file a real copy of apps/intent-engine/src/observability.py"
  echo "(then Rule J enforces byte-identity on it), or stop registering it and"
  echo "call init_sentry(\"SENTRY_DSN\") instead."
  echo ""
fi

if [[ "$BASELINE_MISMATCH" -ne 0 ]]; then
  echo "FAIL: the registered-mirror exclusion set does not match its committed"
  echo "baseline (details and the copy-pasteable replacement are printed above,"
  echo "under the inventory). FOLLOW-765: this suppression set hides WHOLE FILES"
  echo "from the gate, and it used to be a number in a green job's log with no"
  echo "consumer. Update the baseline in the SAME PR as the mirror-files.json"
  echo "change, so widening it is a diff a human reads."
  echo ""
fi

if [[ "$STALE_COUNT" -gt 0 ]]; then
  echo "FAIL: $STALE_COUNT registered Rule J .py mirror path(s) do not exist on disk."
  echo ""
  echo "A registered path is SUPPRESSED by this gate whether or not it exists, so"
  echo "a stale manifest entry is a suppression nothing can ever verify. It is"
  echo "reported here rather than skipped silently, because a silent skip would"
  echo "restore the FOLLOW-771 hole by a different route (register a path, delete"
  echo "the file, keep the exclusion)."
  echo ""
  echo "FIX: remove the entry from scripts/mirror-files.json (and from"
  echo "$EXCLUSION_BASELINE) in the same PR, or restore the file."
  echo ""
fi

if [[ "$REGISTER_BROKEN" -gt 0 ]]; then
  echo "Rule AP REGISTER BROKEN: $REGISTER_BROKEN entry/entries could not be evaluated."
  echo "A residual whose latency proof cannot run is NEVER assumed still latent"
  echo "(FOLLOW-760, applied to the register itself). Fix the proof or the"
  echo "environment it reads."
  echo ""
  exit 2
fi

if [[ "$REGISTER_LIVE" -gt 0 ]]; then
  echo "Rule AP REGISTER ENTRY GONE LIVE: $REGISTER_LIVE documented residual(s) are now REAL."
  echo "This is NOT an ordinary singleton finding — the gate worked; a gap this"
  echo "script's register says is latent has become live, and the entry ids are"
  echo "named above. Close the gap, or re-scope the entry and say so in the PR."
  echo "Do not delete the entry (CONVENTIONS_PATCH.md Rule AP clause 5)."
  echo ""
  exit 3
fi

echo "See ESC-045 item 4 / FOLLOW-738 / FOLLOW-746 / FOLLOW-765 / FOLLOW-769 /"
echo "FOLLOW-771 and this script's header for full context."
exit 1
