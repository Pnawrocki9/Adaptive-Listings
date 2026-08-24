#!/usr/bin/env bash
# Rule J hard gate — mirror-code pairs must stay in sync.
#
# Reads scripts/mirror-files.json and checks each declared pair:
#   - strip_comments: true  → strip JSDoc and // comments, compare normalized content
#   - strip_comments: false → compare the signatures of the helper functions the
#                             pair DECLARES in its own `helpers: []` field
#                             (register entries C3/C4 bound what that leaves
#                             out; at the time of writing NO pair in
#                             scripts/mirror-files.json selects this mode, so
#                             the gate compares zero signatures and SAYS SO on
#                             every run — see the "P2 signature check" line).
#
# BASENAME DISCOVERY (FOLLOW-746 AC1, hardened by FOLLOW-766 / FOLLOW-767)
# ─────────────────────────────────────────────────────────────────────────
# The pair loop can only police copies somebody REMEMBERED to register. RETRO-235
# HW-4 found the resulting hole: `apps/<new-app>/src/observability.py` — a 4th,
# unregistered copy of the hardened Sentry initialiser — was invisible to this
# gate (not in the manifest) AND excluded by basename from
# check-sentry-init-singleton.sh, so an unhardened `sentry_sdk.init(` shipped
# green. FOLLOW-738's own rationale ("mirror a small observability.py into your
# app") makes that more likely, not less.
#
# So, for every pair that opts in with `"basename_discovery": true`, this gate
# now also searches THIS REPO'S TRACKED-FILE INDEX for files sharing a
# registered basename and fails on any that is not itself registered, naming
# the path. What that index leaves out is not "nothing" — it is bounded by
# register entries A and B below (Rule AP clause 4: no unconditional coverage
# claim whose mechanism is region-bounded).
#
# Opt-in, not automatic, because a registered basename can be a framework
# convention: `route.ts` — the canonical of the adapt/reorder pair that PR #839
# DE-REGISTERED (that pair is gone from the manifest; `reorder.ts` is dead code
# awaiting FOLLOW-107's deletion, and nothing here re-registers it) — matches 80
# unrelated Next.js App Router files. Pairs that opt OUT must carry a
# non-empty `basename_discovery_note` explaining the forgone coverage — the
# gate FAILS a pair that opts out with no note (FOLLOW-766 AC2), and the note
# text itself is printed alongside the basenames it excuses, under "Discovery
# OFF for basenames:", on every run (FOLLOW-766 AC1) — so the forgone coverage
# and the reason for it travel together, visible in CI output rather than
# silent (Rule Q shape).
#
# DISCOVERY ROOTS (FOLLOW-767)
# ─────────────────────────────
# Candidates come from `git ls-files` (this repo's tracked-file index), NOT a
# `find … -prune` blacklist. A `find` blacklist encodes whatever directories
# its author happened to test against — this gate's previous list pruned
# `.worktrees` (leading dot) while this repo's real agent worktrees live at
# `.claude/worktrees/agent-*` (no leading dot), so `find` silently descended
# into every live worktree and false-failed on files nobody meant to scan. A
# nested agent worktree is its own git checkout (its own `.git`); `git
# ls-files` run against THIS repo's index does not descend into another
# repository's checkout at all — proven by the self-test below, not assumed.
#
# DISCOVERY AVAILABILITY GUARD (FOLLOW-770 AC1)
# ─────────────────────────────────────────────
# That dependency is HARD, and until FOLLOW-770 its failure had no consumer.
# `git ls-files` inside `done < <( … )` writes to stderr and exits 128 when it
# cannot run (the documented way to reach that is MIRROR_FILES_ROOT pointing
# outside any git work tree). A process-substitution failure propagates to
# neither `set -e` nor `pipefail`, so the loop body simply never ran, the gate
# printed `<basename>: 0 file(s) found`, and reported CLEAN having scanned
# nothing. The tracked-file list is now materialised ONCE, its exit status is
# captured explicitly, and a non-zero status — or an empty list while the
# manifest declares at least one discovery-ON basename — is a HARD FAILURE
# with exit 2 (the gate's own machinery is broken; same contract as both
# Sentry gates' missing-helper path, FOLLOW-760), never a silent "0 found".
# No `find` fallback: that is the FOLLOW-767 defect. Residual: entry D below.
#
# GIT_DIR/GIT_WORK_TREE are unset before scanning, so discovery always
# describes $ROOT's index and never an index inherited from an invoking git
# hook (lefthook's pre-push runs under git, which exports GIT_DIR).
#
# SELF-TEST (FOLLOW-746 AC1 / FOLLOW-766 / FOLLOW-767 / FOLLOW-770 — red-first,
# and PROVEN to run)
# ─────────────────────────────────────────────────────────────────────────────
#   bash scripts/check-mirror-files.sh --self-test
#
# Builds a synthetic git repo in a temp dir (registered canonical + mirror, its
# own manifest) and asserts, in order: clean → 0; drifted mirror → 1 (the pair
# check still works); synthetic UNREGISTERED 4th copy → 1, naming the path;
# copy removed → 0; a registered-basename copy that exists ONLY inside a
# nested agent-worktree checkout is NOT reported → 0 (FOLLOW-767); a pair that
# opts out of basename discovery with no note → 1, naming the missing field
# (FOLLOW-766); the same opt-out WITH a note → 0, and the note text appears in
# the output (FOLLOW-766); a pair that OMITS `basename_discovery` entirely
# (rather than setting it to false) with no note → 1, naming the field
# (FOLLOW-770 AC4 — the likelier real case, previously unfixtured); an opt-out
# note containing an embedded newline → 0, printed in full (FOLLOW-770 AC3 —
# the unescaped `basenames<TAB>note` protocol used to split it into a bogus
# second line and false-RED); a mutated fixture that makes register entry C1's
# latency proof return a hit → 3, with the distinct GONE LIVE diagnosis naming
# `[C1]` (FOLLOW-770 AC5, Rule AP verification clause); and a MIRROR_FILES_ROOT
# outside any git work tree → 2, naming DISCOVERY SOURCE UNAVAILABLE
# (FOLLOW-770 AC1/AC2 — against the pre-fix script this exits 0 and prints
# "OK: every file sharing a registered mirror basename is itself registered"
# having scanned nothing); a repo whose core.excludesFile is a DIRECTORY, so
# the availability guard still passes but entries A/B's producer dies with 128
# behind a trailing `grep` that exits 1 → 2, naming [A]/[B] UNEVALUABLE; and
# the gate sourced under a non-existent $0, so entry F's `$MF_SELF` cannot be
# read → 2, naming [F] UNEVALUABLE (both FOLLOW-770 fix-iteration 1 — against
# the pre-fix RUNNER both exit 0 and report the entries as `latent`).
#
# Run against the pre-fix script, the 4th-copy assertion and the worktree
# assertion FAIL (silent hole / false-RED respectively), as do all six
# FOLLOW-770 assertions — the last two of them against the pre-fix RUNNER of
# THIS register, not against main — see the PR body and the fix-iteration
# comment on PR #656 for the transcripts.
#
# The SAME self-test also runs inline at the start of every normal run (one
# summary line, full output only on failure). That is deliberate: this script's
# only automated invocations are `rule-j` in .github/workflows/ci.yml:501 and
# the lefthook pre-push hook, both of which call it with no arguments. A
# --self-test nobody invokes would be a script that only compiles. Skipped in
# child processes via MIRROR_FILES_SKIP_SELF_CHECK=1 (recursion guard).
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
# PER-STAGE PROOF STATUS (FOLLOW-770 fix-iteration 1) — why `pipefail` alone is
# NOT enough, in this gate's own register
# ─────────────────────────────────────────────────────────────────────────────
# Proofs run under `bash -o pipefail -c`, so a failing producer inside a pipe
# (e.g. `git ls-files` exiting 128) cannot silently yield status 0. That is
# necessary but NOT sufficient, and the first cut of this register got it
# wrong: `pipefail` reports the status of the RIGHTMOST command that exited
# non-zero — not the first, and not the worst. Entries A, B and F chain their
# producer into a SECOND `grep`, and `grep` exits 1 ("no match") on the now-empty
# input a dead producer leaves behind. So the pipeline reported 1, the runner's
# `>= 2` test did not fire, and a genuinely dead producer was classified
# `latent` — the reassuring direction Rule AP clause 2 exists to forbid,
# reproduced inside clause 2's own enforcement mechanism:
#   $ bash -o pipefail -c 'git ls-files --others --exclude-standard \
#       | grep -E "observability\.py" | grep -vxF "app-a/src/observability.py"'
#   fatal: not a git repository …          → but the pipeline's status is 1, not 128.
# The runner therefore records ${PIPESTATUS[@]} — every stage's OWN exit status
# — for each proof, and treats ANY stage exiting >= 2 as UNEVALUABLE regardless
# of what later stages did. The decision is made on the WORST stage, never on
# the pipeline's reported status. A proof that never reaches that epilogue at
# all (syntax error, signal) is UNEVALUABLE too, never "assumed latent". This
# lives in the RUNNER, not in three rewritten proof strings, so it also covers
# every entry added later and every gate that copies this register — the three
# known-bad shapes were the symptom, the runner was the defect.
# Each proof is evaluated over the SAME region as the control it describes
# (Rule AL); the region is named in the entry. Retiring an entry requires the
# fix that closes it in the same PR (Rule AP clause 5).
#
# CONTROLS (predicates) in this gate → the entries that bound each:
#   P1 pair byte-identity   (strip_comments:true)     → C1, C2
#   P2 pair signature check (strip_comments:false)    → C3, C4
#   P3 opt-out note enforcement (FOLLOW-766)          → E
#   P4 basename discovery   (FOLLOW-746/767)          → A, B
#   P5 discovery availability guard (FOLLOW-770 AC1)  → D
#   P6 this register's own runner   (FOLLOW-770 AC5)  → F
#   P7 per-pair helpers-declared enforcement (F-1087) → G
#   P8 signature-extractor preflight (FOLLOW-1087)    → H
# Rule AP clause 3: a PR that adds a predicate to this gate MUST add that
# predicate's OWN entry here — its region, its scan root, and what it does when
# its input is unavailable. It may not lean on an entry written about another
# predicate.
#
#   A. [P4] Discovery candidates are TRACKED files only. An unregistered copy
#      that exists on disk but was never `git add`ed is invisible where the
#      pre-FOLLOW-767 `find` scan saw it.
#      Region: `git ls-files` at $ROOT — the exact list P4 iterates.
#      WHY THIS IS A CORRECT TRADE, not an oversight: both contexts this gate
#      is actually invoked in only ever see tracked files. CI (`rule-j` in
#      .github/workflows/ci.yml) runs on an `actions/checkout`, where every
#      file present is tracked; the lefthook pre-push hook runs against
#      COMMITTED changes, so anything being SHIPPED is tracked by definition.
#      An untracked copy is a working-tree artefact that cannot reach main
#      without becoming tracked first — at which point P4 sees it.
#      Latency proof region-matches P4 exactly (its complement over the same
#      root): untracked, non-ignored files whose basename is discovery-ON and
#      whose path is not registered. Deliberately loud: such a file is one
#      `git add` away from being the RETRO-235 hazard.
#   B. [P4] Ignored paths are outside even A's proof. `--exclude-standard`
#      drops everything .gitignore covers — including `.claude/worktrees/`,
#      which is exactly the FOLLOW-767 requirement (a nested agent checkout
#      must stay structurally invisible), so this narrowing is deliberate on
#      both sides.
#      Region: `git ls-files --others --ignored --exclude-standard --directory`
#      at $ROOT — wholly-ignored directories collapse to one entry, so
#      node_modules/, .turbo/ and nested worktrees never contribute files;
#      what remains is an individually-ignored FILE sharing a registered
#      basename, which is a real (and today empty) blind spot.
#   C1. [P1] `strip_comments()` applies its `//` line-comment rule to EVERY
#      language. In Python `//` is floor division, so `x = a // b` and
#      `x = a // c` normalise to the same `x = a` — a genuine code difference
#      between canonical and mirror compares EQUAL (false GREEN). The three
#      registered `.py` mirrors contain no `//` today.
#      Region: registered strip_comments:true files whose extension is NOT in
#      the C-comment family (where `//` really is a comment) — i.e. exactly the
#      files P1 normalises with a rule that is wrong for them. Files listed in
#      the manifest but missing on disk are excluded from the proof's region;
#      that case is already a loud P1 finding (exit 1), not a register concern.
#   C2. [P1] The stripper knows only `/* … */` and `//`. Any registered
#      strip_comments:true pair in a language with different comment syntax
#      (`#`, `--`, `<!-- -->`) is normalised by rules never validated for it.
#      Region: the registered strip_comments:true path set (manifest-scoped) —
#      the same set P1 iterates.
#   C3. [P2] CORRECTED AGAIN by FOLLOW-1087/1088 — the entry that stood here
#      registered "3 HARD-CODED helper names (deterministicScore,
#      affinityScore, buildReorderDirective) checked by NAME only", scoped to
#      the adapt/reorder pair. That residual is CLOSED IN CODE by this PR, not
#      merely re-worded (Rule AP clause 5: the fix ships with the retirement):
#      the helper list is now DECLARED PER PAIR in the manifest's `helpers: []`
#      field, a strip_comments:false pair without a resolvable list is a hard
#      FAIL (predicate P7 / entry G), and a declared helper missing from the
#      canonical is a FAIL too — never the `INFO: … skipping` that used to be
#      followed by `OK: … signatures match`.
#      Its own latency proof was also broken in a way worth recording, because
#      RETRO-307 minted the class as P-85: the proof was
#      `printf … "$MF_SIGPAIR_CANONICALS" | grep -vxF "…/adapt/route.ts"`,
#      which returns EMPTY for "one expected pair" and equally EMPTY for "zero
#      pairs" — so after PR #839 emptied the subject set it reported `latent`
#      unconditionally, forever, and meant something different by it than it
#      had the day before (Rule AL). Entry C4 below now carries the
#      empty-subject-set axis explicitly.
#      What remains open, and is the accurate C3 residual post-fix: P2
#      compares exactly the names a pair DECLARES. A top-level function that
#      exists in the canonical and is NOT in that pair's `helpers` list is
#      never compared — under-declaring is silent by construction, because a
#      declared list is also how a pair legitimately scopes itself to the
#      helpers it means to mirror.
#      Region: the canonicals of manifest pairs with strip_comments:false that
#      DO carry a usable helpers list — exactly P2's iteration set. A pair with
#      no usable list is P7's own exit-1 finding (entry G) and is deliberately
#      not double-counted here, the same precedent entry E sets for empty
#      opt-out notes. Input unavailable (a canonical that cannot
#      be read) → the proof's producer exits non-zero → UNEVALUABLE, never
#      "assumed latent".
#      Latency proof: a top-level `function <name>(` in a sig-pair canonical
#      that the pair does not declare. Goes live on the FIRST under-declared
#      pair, not the second — the "second such pair" wording the pre-#839
#      entry carried has been wrong since #839 and is removed.
#   C4. [P2, NEW in FOLLOW-1088] P2's SUBJECT SET CAN BE EMPTY, AND AT HEAD IT
#      IS. All registered pairs are strip_comments:true, so the signature arm,
#      scripts/lib/extract-fn-signature.cjs and the WARN→FAIL semantics
#      FOLLOW-1070 introduced are exercised on `main` by this gate's own
#      self-test fixtures alone — nothing in the estate is signature-checked.
#      That is not a defect to fix by re-registering a dead pair (#839's
#      de-registration was correct and stands); it is a coverage fact that
#      must be VISIBLE. It is made visible in two places, and deliberately not
#      in a third:
#        (i)  the gate prints a subject/comparison COUNT line on every run, so
#             "0 registered — no signatures compared" is greppably distinct
#             from "checked and matched" (Rule Q clause 1);
#        (ii) this entry's rendered description carries the live count, so the
#             register's own output differs between the zero-pair and the
#             one-pair world instead of printing an identical `latent` in both
#             — the precise Rule AL defect that killed the old C3 proof;
#        (iii) NOT in the entry's VERDICT. This register couples "not latent"
#             to a non-zero exit (GONE LIVE = 3, UNEVALUABLE = 2). An empty
#             subject set is an ACCEPTED, documented state of `main`, so
#             encoding it as GONE LIVE would leave a REQUIRED gate red
#             forever, which is how a gate gets weakened or ignored. The
#             verdict channel is reserved for states that must block a merge.
#      Region: manifest pairs with strip_comments:false (the count), plus this
#      file's own self-test fixtures (the proof). Input unavailable → the
#      manifest cannot be parsed and `set -e` aborts before any verdict.
#      Latency proof: P2 is exercised by NOTHING AT ALL — zero
#      strip_comments:false pairs in the manifest AND zero strip_comments:false
#      fixtures in this file's self-test. Today the fixtures exist, so this is
#      latent; delete them and the gate says so instead of going quiet.
#   D. [P5, NEW in FOLLOW-770] The availability guard proves the tracked-file
#      index is READABLE and non-empty. It does not prove it is COMPLETE with
#      respect to the working tree: a sparse checkout or a partial clone would
#      satisfy the guard while `git ls-files` omits paths that exist in the
#      repository, so P4 would scan a subset and still report a clean verdict.
#      Region / scan root: the single `git ls-files` invocation at $ROOT (cwd),
#      the same invocation P4 consumes. Input unavailable → exit 2 with
#      "DISCOVERY SOURCE UNAVAILABLE" (never a "0 file(s) found" verdict).
#      Latency proof: sparse-checkout / partial-clone configuration present in
#      the repository the guard reads.
#   E. [P3, axis fixtured by FOLLOW-770 AC4] The opt-out enforcement checks the
#      note EXISTS and is non-empty (for `false` AND for an omitted key). It
#      does not check the note SAYS anything — "n/a" passes as readily as a
#      real decision record, and a note that has gone stale is invisible.
#      Region / scan root: `scripts/mirror-files.json` under $ROOT, pairs with
#      `basename_discovery !== true` — exactly P3's iteration set, pair-level.
#      Input unavailable → the manifest cannot be parsed, node exits non-zero
#      and `set -e` aborts the whole run before any verdict is printed.
#      Latency proof: a non-empty note shorter than 40 characters (empty notes
#      are P3's own exit-1 finding, deliberately not double-counted here).
#   F. [P6, NEW in FOLLOW-770] Register entries are hand-written. Rule AP's
#      "every predicate has an entry" check is a reviewer's diff, so a
#      predicate added to this script without an entry is invisible to the
#      register itself.
#      Region / scan root: THIS FILE ($MF_SELF) — the only region in which a
#      new predicate can appear. Input unavailable (file unreadable) → grep
#      exits 2 → UNEVALUABLE → exit 2.
#      Latency proof: the number of FAILURES-incrementing sites in this script
#      differs from the number this register was written against. It goes live
#      on any new failing predicate, forcing register maintenance in the same
#      PR that adds the predicate.
#   G. [P7, NEW in FOLLOW-1087/1083] The helpers-declared enforcement fires on
#      pairs with strip_comments:false. A pair with strip_comments TRUE that
#      carries a `helpers` array is not checked against it at all — the array
#      is silently ignored, so a maintainer who sets the wrong strip flag gets
#      a dead helper list and no signal.
#      Region / scan root: `scripts/mirror-files.json` under $ROOT, pairs with
#      `strip_comments !== false` — the exact complement of P7's iteration set.
#      Input unavailable → the manifest cannot be parsed, node exits non-zero
#      and `set -e` aborts the whole run before any verdict is printed.
#      Latency proof: a pair carrying a non-empty `helpers` array while its
#      strip_comments is not false.
#   H. [P8, NEW in FOLLOW-1087] The extractor preflight proves, before the
#      pair loop, that scripts/lib/extract-fn-signature.cjs exists NEXT TO THIS
#      SCRIPT and that node can load it AND resolve `typescript` — the two
#      conditions that used to be swallowed as "function not found in
#      canonical". What it does NOT prove: (a) that the extractor is the one
#      this repo shipped — there is no checksum, only a behavioural probe
#      against one synthetic declaration; (b) anything at all on a run where
#      the manifest declares ZERO strip_comments:false pairs, because the
#      preflight is deliberately conditional on having a subject. A gate with
#      no subject must not hard-require a dependency it will never call — this
#      script runs in lefthook `pre-push` from agent worktrees that carry no
#      node_modules, and reddening those runs for an unused dependency is how
#      a required gate gets bypassed. This IS a soft-skip, and it is the only
#      one permitted here: it skips on "no subject", never on "the machinery
#      failed" (Rule Q clause 2).
#      Region / scan root: `$(dirname "$SELF")/lib/extract-fn-signature.cjs`
#      and node's module resolution from that directory — resolved from the
#      GATE's own location, never from $ROOT (MIRROR_FILES_ROOT is the tree
#      UNDER CHECK; resolving the extractor there is what let any foreign root
#      silently disarm P2).
#      Input unavailable → `FAIL: SIGNATURE EXTRACTOR UNAVAILABLE`, exit 2 —
#      the gate's own machinery is broken, same contract as the discovery
#      guard above and as check-k2-consumer-swallow.sh:34 /
#      check-staff-write-atomicity.sh:35. Never a skip, never a verdict.
#      Latency proof: the extractor is missing or unreadable while the manifest
#      declares zero sig pairs — i.e. exactly the window in which the preflight
#      is not run and a broken P2 would sit undetected until the first pair is
#      registered.
#
# None of A/B/C1/C2/C3/C4/D/E/F/G/H is fixed here (out of FOLLOW-770's AC): the class
# is documented-and-open, not enumerated-and-guarded — but it is now
# documented-and-EXECUTED, which is the difference Rule AP exists to make.
#
# TEST HOOKS
#   MIRROR_FILES_ROOT           — repo root to operate on (default: git toplevel)
#   MIRROR_FILES_SKIP_SELF_CHECK — set to 1 to skip the inline self-check
#
# Exit codes: 0 = all pairs in sync, no unregistered copies, every register
#                 entry still latent,
#             1 = drift, an unregistered copy, or an unexplained
#                 basename-discovery opt-out detected (an ordinary finding),
#             2 = the gate's own machinery is broken: the self-test failed, the
#                 discovery source could not be read, or a register entry's
#                 latency proof could not be evaluated,
#             3 = a documented residual GONE LIVE — the gate works, but a gap
#                 this register says is latent is now real. Fix it or re-scope
#                 the entry; do not delete the entry (Rule AP clause 5).
# Precedence when more than one applies: 2 (broken) > 3 (gone live) > 1
# (finding). All of them are reported in the output regardless of which one
# sets the exit code.
# Run: bash scripts/check-mirror-files.sh

set -euo pipefail

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
ROOT="${MIRROR_FILES_ROOT:-$(git rev-parse --show-toplevel)}"
MANIFEST="$ROOT/scripts/mirror-files.json"
FAILURES=0

cd "$ROOT"

# Discovery must describe $ROOT's own index, never one inherited from an
# invoking git hook (git exports GIT_DIR to hooks; lefthook's pre-push runs
# this gate from there). Without this, a hook-invoked run — and every self-test
# child it spawns — would read the outer repo's index while sitting in a
# different tree. Children inherit this cleaned environment.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR

if [[ ! -f "$MANIFEST" ]]; then
  echo "ERROR: manifest not found at $MANIFEST"
  exit 1
fi

# Use node for JSON parsing (always available in this repo; avoids jq dependency).
if ! command -v node &>/dev/null; then
  echo "ERROR: node is required but not found in PATH."
  exit 1
fi

# ── Helper: strip JSDoc blocks and // line comments ──────────────────────────
# Uses perl to remove /** ... */ block comments (multiline),
# then sed to remove // line comments.
strip_comments() {
  local file="$1"
  perl -0777 -pe 's{/\*.*?\*/}{}gs' "$file" \
    | sed 's|[[:space:]]//[^/].*$||; s|^[[:space:]]*//[^/].*$||' \
    | sed '/^[[:space:]]*$/d' \
    | sed 's/[[:space:]]*$//'
}

# ── P2 signature machinery (FOLLOW-1087) ─────────────────────────────────────
# The extractor is part of the GATE, so it is resolved relative to THIS SCRIPT.
# It used to be resolved as "$ROOT/scripts/lib/extract-fn-signature.cjs", where
# $ROOT is MIRROR_FILES_ROOT — the tree UNDER CHECK. Pointing the gate at any
# other tree therefore made the extractor "missing", node exited 1, and the
# caller read 1 as the extractor's "function not found" and printed
# `INFO: … skipping` followed by `OK: … signatures match` over a real
# divergence, exiting 0. Same class of silent pass for an unresolvable
# `typescript` (MODULE_NOT_FOUND is also node exit 1).
#
# EXIT CONTRACT with scripts/lib/extract-fn-signature.cjs:
#     0 = signature on stdout
#     2 = that file could not be read or parsed
#     3 = the function is genuinely not a top-level declaration in that file
#   anything else = NODE failed, not the extractor: the machinery is broken and
#                   this gate must not render a verdict (exit 2). Node never
#                   chooses 3 for itself, which is why 3 — not 1 — carries the
#                   benign meaning.
SIG_EXTRACTOR="$(dirname "$SELF")/lib/extract-fn-signature.cjs"

# Machinery-broken exit, matching the DISCOVERY SOURCE UNAVAILABLE contract
# below (FOLLOW-760/FOLLOW-770 AC1) and the bare-`node` posture of
# check-k2-consumer-swallow.sh:34 / check-staff-write-atomicity.sh:35.
sig_machinery_broken() {
  echo ""
  echo "FAIL: SIGNATURE EXTRACTOR UNAVAILABLE — $1"
  echo "      extractor: $SIG_EXTRACTOR"
  echo "      gate:      $SELF"
  echo "      root:      $ROOT"
  if [[ -n "${2:-}" && -s "${2:-}" ]]; then
    echo "      node stderr:"
    sed 's/^/        /' "$2"
  fi
  echo ""
  echo "      The signature check (strip_comments:false pairs) CANNOT run, so"
  echo "      this gate has no verdict to give on them. This is NOT reported as"
  echo "      \"function not found in canonical\" and NOT as an ordinary finding:"
  echo "      it is the gate's own machinery being broken (exit 2)."
  echo "      Usual causes: scripts/lib/extract-fn-signature.cjs was not checked"
  echo "      out next to this script, or \`typescript\` cannot be resolved from"
  echo "      it (run \`pnpm install\` at the repo root)."
  exit 2
}

# Probe the extractor end-to-end before the pair loop: file present AND node
# able to load it AND `typescript` resolvable. Run ONLY when the manifest
# actually declares a strip_comments:false pair — see register entry H for why
# that soft-skip is the one permitted here (no subject, not a masked failure).
sig_preflight() {
  local probe_dir probe rc out err
  if [[ ! -f "$SIG_EXTRACTOR" || ! -r "$SIG_EXTRACTOR" ]]; then
    sig_machinery_broken "the extractor is missing or unreadable."
  fi
  probe_dir=$(mktemp -d)
  probe="$probe_dir/probe.ts"
  err="$probe_dir/err"
  printf 'export function __mfProbe(a: string): number {\n  return 1;\n}\n' >"$probe"
  rc=0
  out=$(node "$SIG_EXTRACTOR" "$probe" __mfProbe 2>"$err") || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    sig_machinery_broken "the extractor exited $rc on a known-good probe file." "$err"
  fi
  if [[ "$out" != "function __mfProbe(a: string): number" ]]; then
    rm -rf "$probe_dir"
    sig_machinery_broken "the extractor returned unexpected output on a known-good probe: '$out'"
  fi
  rm -rf "$probe_dir"
  echo "OK:  signature-extractor preflight passed ($SIG_EXTRACTOR)."
  echo ""
}

# ── Self-test (FOLLOW-746 AC1) ───────────────────────────────────────────────
# Prints one OK line per assertion; returns non-zero on the first failure.
run_self_test() {
  local tmp nogit
  tmp=$(mktemp -d)
  # A SECOND root that is deliberately NOT a git work tree (step 11). It cannot
  # live under $tmp: $tmp is a git repo, so a subdirectory of it would still be
  # inside a work tree and `git ls-files` would succeed there.
  nogit=$(mktemp -d)
  # shellcheck disable=SC2064  # expand the paths now, not at trap time
  trap "rm -rf '$tmp' '$nogit'" RETURN

  mkdir -p "$tmp/scripts" "$tmp/app-a/src" "$tmp/app-b/src/jobs"

  cat > "$tmp/scripts/mirror-files.json" <<'JSONEOF'
[
  {
    "canonical": "app-a/src/observability.py",
    "mirror": "app-b/src/jobs/observability.py",
    "strip_comments": true,
    "basename_discovery": true
  }
]
JSONEOF

  cat > "$tmp/app-a/src/observability.py" <<'PYEOF'
def init_sentry(dsn_env_name):
    return None
PYEOF
  cp "$tmp/app-a/src/observability.py" "$tmp/app-b/src/jobs/observability.py"

  # FOLLOW-767: basename discovery now scans `git ls-files`, not the raw
  # filesystem — the fixture root must itself be a git repo (and its files
  # tracked) for that scan to see anything. A commit (not just a stage) is
  # required so step 5 below can `git worktree add` a real nested checkout.
  git -C "$tmp" init -q
  git -C "$tmp" add -A
  git -C "$tmp" -c user.email=self-test@example.invalid -c user.name=mirror-gate-self-test \
    commit -q -m "self-test fixture baseline"

  local out rc
  _st_run() {
    rc=0
    out=$(MIRROR_FILES_ROOT="$tmp" MIRROR_FILES_SKIP_SELF_CHECK=1 bash "$SELF" 2>&1) || rc=$?
  }

  # 1. Registered pair, in sync, no stray copies → clean.
  _st_run
  if [[ "$rc" -ne 0 ]]; then
    echo "SELF-TEST FAIL: a synced pair with no stray copies was not clean (exit $rc)."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — synced pair with no stray copies passes."

  # 2. Drifted mirror → 1 (the pre-existing pair check must still work).
  echo "    # drift" >> "$tmp/app-b/src/jobs/observability.py"
  _st_run
  if [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL: a drifted mirror was not reported (expected exit 1, got $rc)."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — drifted mirror is still detected (pair check intact)."
  cp "$tmp/app-a/src/observability.py" "$tmp/app-b/src/jobs/observability.py"

  # 3. Synthetic UNREGISTERED 4th copy → 1, and the path must be named.
  #    RED-FIRST: the pre-FOLLOW-746 script exits 0 here (the silent hole).
  mkdir -p "$tmp/app-c/src"
  cat > "$tmp/app-c/src/observability.py" <<'PYEOF'
import sentry_sdk

def init_sentry(dsn_env_name):
    sentry_sdk.init(dsn="unregistered", traces_sample_rate=1.0)
PYEOF
  # Must be tracked to be visible to the git-ls-files-based scan (FOLLOW-767).
  git -C "$tmp" add -A
  _st_run
  if [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL: an UNREGISTERED copy sharing a registered mirror basename was"
    echo "  not reported (expected exit 1, got $rc) — this is the FOLLOW-746 AC1 hole."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "app-c/src/observability.py"; then
    echo "SELF-TEST FAIL: the unregistered copy was reported without naming its path."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — an unregistered 4th copy is detected and named (red-first)."

  # 4. Copy removed → clean again (the check is not stuck red).
  rm -rf "$tmp/app-c"
  git -C "$tmp" add -A
  _st_run
  if [[ "$rc" -ne 0 ]]; then
    echo "SELF-TEST FAIL: removing the unregistered copy did not restore a clean run (exit $rc)."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — removing the unregistered copy restores a clean run."

  # 5. FOLLOW-767: a registered-basename file that exists ONLY inside a
  #    nested agent-worktree checkout (this repo's real convention:
  #    .claude/worktrees/agent-*, no leading dot) must NOT be scanned or
  #    reported. RED-FIRST: against the pre-FOLLOW-767 `find`-based scan this
  #    IS reported (5 false FAILs on the real tree — see the PR body).
  git -C "$tmp" worktree add -q -b self-test-agent-worktree \
    "$tmp/.claude/worktrees/agent-x" >/dev/null 2>&1
  _st_run
  if [[ "$rc" -ne 0 ]]; then
    echo "SELF-TEST FAIL: a registered-basename copy that exists only inside a nested"
    echo "  agent-worktree checkout was reported as an unregistered copy (expected"
    echo "  exit 0, got $rc) — this is the FOLLOW-767 hole."
    echo "$out"
    return 1
  fi
  if echo "$out" | grep -q '\.claude/worktrees/agent-x'; then
    echo "SELF-TEST FAIL: the nested agent-worktree checkout was scanned and reported"
    echo "  (it must be structurally invisible to a git-ls-files-based scan)."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — a nested agent-worktree checkout is not scanned (FOLLOW-767)."
  git -C "$tmp" worktree remove --force .claude/worktrees/agent-x >/dev/null 2>&1

  # 6. FOLLOW-766: a pair that opts out of basename discovery with NO
  #    basename_discovery_note must fail the gate — the opt-out must be a
  #    recorded decision, not a silent default.
  cat > "$tmp/widget.ts" <<'TSEOF'
export function widget() {
  return 1;
}
TSEOF
  git -C "$tmp" add -A
  cat > "$tmp/scripts/mirror-files.json" <<'JSONEOF'
[
  {
    "canonical": "app-a/src/observability.py",
    "mirror": "app-b/src/jobs/observability.py",
    "strip_comments": true,
    "basename_discovery": true
  },
  {
    "canonical": "widget.ts",
    "mirror": "widget.ts",
    "strip_comments": true,
    "basename_discovery": false
  }
]
JSONEOF
  _st_run
  if [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL: a pair opting out of basename discovery with no"
    echo "  basename_discovery_note was not caught (expected exit 1, got $rc) —"
    echo "  this is the FOLLOW-766 AC2 hole."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "basename_discovery_note"; then
    echo "SELF-TEST FAIL: the missing-note failure did not name the missing field."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — an opted-out pair with no basename_discovery_note fails the gate (FOLLOW-766)."

  # 7. FOLLOW-766: the same opt-out WITH a note must pass, and the note text
  #    must appear in the gate's output (the reason travels with the gap).
  cat > "$tmp/scripts/mirror-files.json" <<'JSONEOF'
[
  {
    "canonical": "app-a/src/observability.py",
    "mirror": "app-b/src/jobs/observability.py",
    "strip_comments": true,
    "basename_discovery": true
  },
  {
    "canonical": "widget.ts",
    "mirror": "widget.ts",
    "strip_comments": true,
    "basename_discovery": false,
    "basename_discovery_note": "SELF-TEST-NOTE-widget-reason — recorded at length, because register entry E flags any note under 40 characters as a placeholder."
  }
]
JSONEOF
  _st_run
  if [[ "$rc" -ne 0 ]]; then
    echo "SELF-TEST FAIL: an opted-out pair WITH a basename_discovery_note was not"
    echo "  clean (expected exit 0, got $rc)."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "SELF-TEST-NOTE-widget-reason"; then
    echo "SELF-TEST FAIL: the basename_discovery_note text did not appear in the"
    echo "  gate's output."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — an opted-out pair WITH a note passes and the note text appears in the output (FOLLOW-766)."

  # 8. FOLLOW-770 AC4: the pair OMITS `basename_discovery` entirely rather than
  #    setting it to false — the default for any pair added without thinking
  #    about the flag, i.e. exactly the population the enforcement exists to
  #    catch. Steps 6/7 both set the key explicitly, so this axis had no
  #    red-first proof and would have survived a refactor to `=== false`.
  cat > "$tmp/scripts/mirror-files.json" <<'JSONEOF'
[
  {
    "canonical": "app-a/src/observability.py",
    "mirror": "app-b/src/jobs/observability.py",
    "strip_comments": true,
    "basename_discovery": true
  },
  {
    "canonical": "widget.ts",
    "mirror": "widget.ts",
    "strip_comments": true
  }
]
JSONEOF
  _st_run
  if [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL: a pair that OMITS basename_discovery (rather than setting it"
    echo "  to false) with no basename_discovery_note was not caught (expected exit 1,"
    echo "  got $rc) — this is the FOLLOW-770 AC4 / FOLLOW-766 AC2 omitted-key axis."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "basename_discovery_note"; then
    echo "SELF-TEST FAIL: the omitted-key failure did not name the missing field."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — an OMITTED basename_discovery key with no note fails the gate, naming the field (FOLLOW-770 AC4)."

  # 9. FOLLOW-770 AC3: a note containing an embedded newline must PASS and
  #    print in full. RED-FIRST: with the old raw "basenames<TAB>note" line
  #    protocol the note split into a bogus second record whose note was
  #    empty, and the gate false-REDded a pair that has a note.
  cat > "$tmp/scripts/mirror-files.json" <<'JSONEOF'
[
  {
    "canonical": "app-a/src/observability.py",
    "mirror": "app-b/src/jobs/observability.py",
    "strip_comments": true,
    "basename_discovery": true
  },
  {
    "canonical": "widget.ts",
    "mirror": "widget.ts",
    "strip_comments": true,
    "basename_discovery": false,
    "basename_discovery_note": "SELF-TEST-NOTE-line-one, long enough to keep register entry E latent.\nSELF-TEST-NOTE-line-two"
  }
]
JSONEOF
  _st_run
  if [[ "$rc" -ne 0 ]]; then
    echo "SELF-TEST FAIL: an opt-out note containing an embedded newline false-REDded"
    echo "  the gate (expected exit 0, got $rc) — this is the FOLLOW-770 AC3 unescaped"
    echo "  line-protocol hole."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "SELF-TEST-NOTE-line-one" \
    || ! echo "$out" | grep -q "SELF-TEST-NOTE-line-two"; then
    echo "SELF-TEST FAIL: a multi-line basename_discovery_note was not printed in full."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — a note with an embedded newline passes and prints in full (FOLLOW-770 AC3)."

  # 10. FOLLOW-770 AC5 / Rule AP verification: a REGISTER ENTRY GOING LIVE must
  #     be caught, with a diagnosis distinct from an ordinary finding, naming
  #     the entry id. Mutate the fixture so entry C1's latency proof returns a
  #     hit: put `//` into the registered .py pair. This is the residual made
  #     concrete — the two files differ in CODE (`// b` vs `// c`) and the pair
  #     check still says "normalized content identical", because strip_comments
  #     deletes ` //…` in every language including Python, where it is floor
  #     division. RED-FIRST: the pre-register script exits 0 on this fixture.
  echo "x = a // b" >> "$tmp/app-a/src/observability.py"
  echo "x = a // c" >> "$tmp/app-b/src/jobs/observability.py"
  git -C "$tmp" add -A
  _st_run
  if [[ "$rc" -ne 3 ]]; then
    echo "SELF-TEST FAIL: a register entry whose latency proof now returns hits did not"
    echo "  fail the gate with the distinct GONE LIVE exit code (expected exit 3, got"
    echo "  $rc) — this is the Rule AP clause 2 contract."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "GONE LIVE" || ! echo "$out" | grep -q "\[C1\]"; then
    echo "SELF-TEST FAIL: the gone-live residual was not reported with the distinct"
    echo "  GONE LIVE diagnosis naming its entry id (C1)."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "normalized content identical"; then
    echo "SELF-TEST FAIL: the C1 fixture no longer demonstrates the residual it"
    echo "  registers — the pair check was supposed to compare the two DIFFERENT"
    echo "  files as identical (that is the false GREEN entry C1 documents)."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — a register entry going live fails the gate (exit 3) with a distinct diagnosis naming [C1] (FOLLOW-770 AC5 / Rule AP)."
  cp "$tmp/app-a/src/observability.py" "$tmp/app-b/src/jobs/observability.py"
  git -C "$tmp" add -A

  # 11. FOLLOW-770 AC1/AC2: MIRROR_FILES_ROOT outside any git work tree. The
  #     discovery source (`git ls-files`) exits 128 with empty stdout there.
  #     RED-FIRST: the pre-fix script exits 0 and prints "OK: every file sharing
  #     a registered mirror basename is itself registered" — a CLEAN verdict
  #     over a scan that never happened, with an unregistered copy sitting in
  #     the tree. After the fix it must be a hard exit 2.
  mkdir -p "$nogit/scripts" "$nogit/app-a/src" "$nogit/app-b/src/jobs" "$nogit/app-c/src"
  cat > "$nogit/scripts/mirror-files.json" <<'JSONEOF'
[
  {
    "canonical": "app-a/src/observability.py",
    "mirror": "app-b/src/jobs/observability.py",
    "strip_comments": true,
    "basename_discovery": true
  }
]
JSONEOF
  cat > "$nogit/app-a/src/observability.py" <<'PYEOF'
def init_sentry(dsn_env_name):
    return None
PYEOF
  cp "$nogit/app-a/src/observability.py" "$nogit/app-b/src/jobs/observability.py"
  # The unregistered 4th copy a working discovery pass would have caught.
  cp "$nogit/app-a/src/observability.py" "$nogit/app-c/src/observability.py"
  rc=0
  out=$(MIRROR_FILES_ROOT="$nogit" MIRROR_FILES_SKIP_SELF_CHECK=1 bash "$SELF" 2>&1) || rc=$?
  if [[ "$rc" -ne 2 ]]; then
    echo "SELF-TEST FAIL: a root outside any git work tree did not hard-fail the gate"
    echo "  (expected exit 2, got $rc). The discovery source cannot run there, so the"
    echo "  gate must NOT report a verdict — this is the FOLLOW-770 AC1 hole."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "DISCOVERY SOURCE UNAVAILABLE"; then
    echo "SELF-TEST FAIL: the unreadable discovery source was not named as such."
    echo "$out"
    return 1
  fi
  if echo "$out" | grep -q "every TRACKED file sharing a registered mirror basename"; then
    echo "SELF-TEST FAIL: the gate printed its clean-discovery line while its discovery"
    echo "  source could not be read — a CLEAN verdict over a scan that never happened."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — a root with no readable tracked-file index hard-fails (exit 2), never a silent '0 file(s) found' (FOLLOW-770 AC1/AC2)."

  # 12. FOLLOW-770 fix-iteration 1: a register proof whose PRODUCER dies while a
  #     LATER stage of the same pipe exits non-zero for an ordinary reason must
  #     still be UNEVALUABLE. Entries A and B are
  #     `git ls-files … | grep -E … | grep -vxF …`; when git dies the trailing
  #     grep returns 1 ("no match" on empty input) and `pipefail` reports THAT,
  #     because pipefail takes the RIGHTMOST non-zero status.
  #     The fixture must reach the register, so it cannot be step 11's non-git
  #     root (the discovery-availability guard exits 2 first, shielding A/B by
  #     execution order rather than by their own correctness — which is exactly
  #     the finding). Instead: point core.excludesFile at a DIRECTORY. Plain
  #     `git ls-files` — what the guard reads — still succeeds, so the gate runs
  #     to completion; `git ls-files --others --exclude-standard` — what A and B
  #     read — dies with 128 ("cannot use … as an exclude file").
  #     RED-FIRST: against the pre-fix runner this is exit 0 with `[A] latent`
  #     and `[B] latent` — see the PR comment for the transcript.
  #     Step 10 deliberately left `//` in the pair, which keeps entry C1 GONE
  #     LIVE; restore the baseline first so this step's verdict comes only from
  #     A/B, and assert that clean baseline explicitly (a fixture that was
  #     already failing proves nothing about the sabotage).
  cat > "$tmp/app-a/src/observability.py" <<'PYEOF'
def init_sentry(dsn_env_name):
    return None
PYEOF
  cp "$tmp/app-a/src/observability.py" "$tmp/app-b/src/jobs/observability.py"
  git -C "$tmp" add -A
  _st_run
  if [[ "$rc" -ne 0 ]]; then
    echo "SELF-TEST FAIL: the step-12 baseline is not clean (exit $rc) — the sabotage"
    echo "  below would prove nothing."
    echo "$out"
    return 1
  fi
  mkdir -p "$tmp/exclude-file-is-a-directory"
  git -C "$tmp" config core.excludesFile "$tmp/exclude-file-is-a-directory"
  _st_run
  git -C "$tmp" config --unset core.excludesFile
  if [[ "$rc" -ne 2 ]]; then
    echo "SELF-TEST FAIL: a register proof whose producer died (git exit 128) but whose"
    echo "  trailing grep exited 1 was not reported UNEVALUABLE (expected exit 2, got"
    echo "  $rc). pipefail reports the RIGHTMOST non-zero status, so the runner must"
    echo "  decide on PIPESTATUS, not on the pipeline's own status."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "\[A\] UNEVALUABLE" || ! echo "$out" | grep -q "\[B\] UNEVALUABLE"; then
    echo "SELF-TEST FAIL: entries A and B were not both named UNEVALUABLE while their"
    echo "  shared producer was dead."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "128"; then
    echo "SELF-TEST FAIL: the UNEVALUABLE report did not surface the producer's real"
    echo "  exit status (128) — the masked status is the whole finding."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — a dead producer masked by a trailing grep's ordinary exit 1 is UNEVALUABLE (exit 2), naming [A]/[B] and the real 128 (FOLLOW-770 fix-iteration 1)."

  # 13. Same defect class, entry F's differently-shaped producer
  #     (`grep -cE … "$MF_SELF" | grep -vx "6"`): when $MF_SELF cannot be read,
  #     grep exits 2 — and the trailing `grep -vx` exits 1 on the empty input,
  #     masking it. Fixture: invoke the gate SOURCED under a $0 that does not
  #     exist, which is precisely the "MF_SELF unreadable" condition entry F's
  #     header paragraph claims lands in UNEVALUABLE.
  #     RED-FIRST: against the pre-fix runner this is exit 0 with `[F] latent`.
  rc=0
  out=$(MIRROR_FILES_ROOT="$tmp" MIRROR_FILES_SKIP_SELF_CHECK=1 \
    bash -c '. "$1"' "$tmp/gate-was-here.sh" "$SELF" 2>&1) || rc=$?
  if [[ "$rc" -ne 2 ]]; then
    echo "SELF-TEST FAIL: entry F's proof could not read \$MF_SELF (grep exit 2) yet the"
    echo "  entry was not reported UNEVALUABLE (expected exit 2, got $rc) — the trailing"
    echo "  'grep -vx' masked it, exactly as for A/B."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "\[F\] UNEVALUABLE"; then
    echo "SELF-TEST FAIL: entry F was not named UNEVALUABLE with an unreadable \$MF_SELF."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — entry F with an unreadable \$MF_SELF is UNEVALUABLE (exit 2), not latent (FOLLOW-770 fix-iteration 1)."

  # ── P2 SIGNATURE ARM (FOLLOW-1087 / FOLLOW-1088) ───────────────────────────
  # Everything above fixtures strip_comments:TRUE pairs only. So did every
  # fixture this self-test has ever had, and after PR #839 removed the last
  # strip_comments:false row from scripts/mirror-files.json the P2 branch was
  # reachable from NO pair and NO fixture: an entire arm of a REQUIRED merge
  # gate, exercised by nothing, reporting the same green as before (RETRO-307
  # §3 DEAD_PATH, §6 pattern P-85). Steps 14-20 give it subjects that live in
  # the gate itself, so P2 stays exercised whatever the manifest says.
  local sig_manifest
  sig_manifest() {
    # $1 = the helpers field line for the sig pair (may be empty)
    cat > "$tmp/scripts/mirror-files.json" <<JSONEOF
[
  {
    "canonical": "app-a/src/observability.py",
    "mirror": "app-b/src/jobs/observability.py",
    "strip_comments": true,
    "basename_discovery": true
  },
  {
    "canonical": "sig-a.ts",
    "mirror": "sig-b.ts",
    "strip_comments": false,
    $1
    "basename_discovery": false,
    "basename_discovery_note": "SELF-TEST-SIG-PAIR — synthetic fixture for the P2 signature arm; its basenames are unique to this fixture so discovery would find nothing."
  }
]
JSONEOF
  }

  cat > "$tmp/sig-a.ts" <<'TSEOF'
export function computeThing(
  a: string,
  b: number,
): ResultA {
  return doSomething(a, b);
}
TSEOF
  cp "$tmp/sig-a.ts" "$tmp/sig-b.ts"
  sig_manifest '"helpers": ["computeThing"],'
  git -C "$tmp" add -A

  # 14. A strip_comments:false pair whose declared helper MATCHES must pass —
  #     and the gate must SAY it compared something. RED-FIRST against the
  #     pre-FOLLOW-1087 script: the helper names were a file-level constant
  #     (deterministicScore/affinityScore/buildReorderDirective), so this pair
  #     produced three "INFO: … not found in canonical — skipping." lines and
  #     then "OK: all required helper functions present in mirror, signatures
  #     match." having compared NOTHING, and printed no count line at all.
  _st_run
  if [[ "$rc" -ne 0 ]]; then
    echo "SELF-TEST FAIL: a strip_comments:false pair with a matching declared helper"
    echo "  was not clean (expected exit 0, got $rc)."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "computeThing — signatures match"; then
    echo "SELF-TEST FAIL: the declared helper was never compared by name — the P2"
    echo "  branch did not run against the pair's own helpers (FOLLOW-1087/1083)."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "1 signature pair(s) registered — 1 signature(s) compared"; then
    echo "SELF-TEST FAIL: the gate did not emit the P2 subject/comparison count line"
    echo "  (Rule Q clause 1 — 'checked and matched' must be greppably distinct from"
    echo "  'nothing was compared')."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — a strip_comments:false pair's DECLARED helper is compared and the count line is emitted (FOLLOW-1087/1088)."

  # 15. The same pair with a REAL divergence must FAIL. This is the assertion
  #     the whole arm exists for, and until now no fixture made it.
  cat > "$tmp/sig-b.ts" <<'TSEOF'
export function computeThing(
  a: string,
  b: number,
): ResultB {
  return doSomething(a, b);
}
TSEOF
  git -C "$tmp" add -A
  _st_run
  if [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL: a real signature divergence on a strip_comments:false pair"
    echo "  did not fail the gate (expected exit 1, got $rc)."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "computeThing — signatures differ"; then
    echo "SELF-TEST FAIL: the divergence was not reported naming the function."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — a real signature divergence FAILS the gate, naming the function (FOLLOW-1088)."
  cp "$tmp/sig-a.ts" "$tmp/sig-b.ts"
  git -C "$tmp" add -A

  # 16. A strip_comments:false pair that declares NO helpers must FAIL. Pre-fix
  #     the names came from a file-level constant, so a pair with no list of its
  #     own was not merely unchecked — it printed "signatures match".
  sig_manifest ''
  git -C "$tmp" add -A
  _st_run
  if [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL: a strip_comments:false pair declaring no helpers did not fail"
    echo "  the gate (expected exit 1, got $rc)."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "helpers"; then
    echo "SELF-TEST FAIL: the missing-helpers failure did not name the missing field."
    echo "$out"
    return 1
  fi
  if echo "$out" | grep -qF "declared helper(s) compared, signatures match"; then
    echo "SELF-TEST FAIL: the gate claimed 'signatures match' for a pair whose helper"
    echo "  list could not be resolved — it compared nothing (Rule AU)."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — a strip_comments:false pair with no helpers list FAILS, never 'signatures match' (FOLLOW-1083 AC1)."

  # 17. A DECLARED helper that does not exist in the canonical must FAIL, not
  #     print "INFO: … not found in canonical — skipping." The declaration is
  #     the contract; a name that does not resolve is a broken registration.
  sig_manifest '"helpers": ["computeThing", "noSuchHelper"],'
  git -C "$tmp" add -A
  _st_run
  if [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL: a declared helper absent from the canonical did not fail the"
    echo "  gate (expected exit 1, got $rc) — this is the 'INFO: … skipping' hole."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "noSuchHelper"; then
    echo "SELF-TEST FAIL: the unresolvable declared helper was not named."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — a declared-but-absent helper FAILS instead of being skipped (FOLLOW-1087)."

  # 18. MACHINERY BROKEN, variant 1 (FOLLOW-1087): the extractor is not next to
  #     the gate. Fixtured by running a COPY of this script from a directory
  #     with no lib/ — which is also the proof that the extractor is resolved
  #     from $SELF and not from $ROOT (a $ROOT-relative resolution would find
  #     nothing here either, but would then be read as "function not found").
  #     RED-FIRST: the pre-fix script prints the MODULE_NOT_FOUND stack trace,
  #     then "INFO: … not found in canonical — skipping.", then
  #     "OK: … signatures match." and exits 0 over the divergence.
  sig_manifest '"helpers": ["computeThing"],'
  cat > "$tmp/sig-b.ts" <<'TSEOF'
export function computeThing(
  a: string,
  b: number,
): ResultB {
  return doSomething(a, b);
}
TSEOF
  git -C "$tmp" add -A
  cp "$SELF" "$tmp/scripts/check-mirror-files.sh"
  rc=0
  out=$(MIRROR_FILES_ROOT="$tmp" MIRROR_FILES_SKIP_SELF_CHECK=1 \
    bash "$tmp/scripts/check-mirror-files.sh" 2>&1) || rc=$?
  if [[ "$rc" -ne 2 ]]; then
    echo "SELF-TEST FAIL: a missing signature extractor did not hard-fail the gate"
    echo "  (expected exit 2, got $rc). A required gate whose extraction machinery is"
    echo "  absent must NOT render a verdict — this is the FOLLOW-1087 fail-open hole."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "SIGNATURE EXTRACTOR UNAVAILABLE"; then
    echo "SELF-TEST FAIL: the missing extractor was not named as such."
    echo "$out"
    return 1
  fi
  if echo "$out" | grep -qF "declared helper(s) compared, signatures match" || echo "$out" | grep -qF "not found in canonical — skipping"; then
    echo "SELF-TEST FAIL: the gate reported a signature verdict (or a benign 'not found"
    echo "  in canonical' skip) while its extractor was missing."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — a missing signature extractor hard-fails (exit 2), never 'not found in canonical' (FOLLOW-1087)."

  # 19. MACHINERY BROKEN, variant 2 (FOLLOW-1087): the extractor is present but
  #     `typescript` cannot be resolved from it — node exits 1 with
  #     MODULE_NOT_FOUND, the SAME status the extractor used to use for
  #     "function not found". That collision is the root cause the exit-3
  #     contract removes. $tmp is under the system temp dir, so there is no
  #     node_modules on the resolution path above the copied extractor.
  mkdir -p "$tmp/scripts/lib"
  cp "$(dirname "$SELF")/lib/extract-fn-signature.cjs" "$tmp/scripts/lib/"
  rc=0
  out=$(MIRROR_FILES_ROOT="$tmp" MIRROR_FILES_SKIP_SELF_CHECK=1 \
    bash "$tmp/scripts/check-mirror-files.sh" 2>&1) || rc=$?
  if [[ "$rc" -ne 2 ]]; then
    echo "SELF-TEST FAIL: an unresolvable \`typescript\` did not hard-fail the gate"
    echo "  (expected exit 2, got $rc). node's own MODULE_NOT_FOUND exit 1 must never"
    echo "  be read as the extractor's 'function not found' (FOLLOW-1087)."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "SIGNATURE EXTRACTOR UNAVAILABLE"; then
    echo "SELF-TEST FAIL: the unresolvable dependency was not named as machinery-broken."
    echo "$out"
    return 1
  fi
  if echo "$out" | grep -qF "declared helper(s) compared, signatures match"; then
    echo "SELF-TEST FAIL: the gate reported 'signatures match' while \`typescript\` was"
    echo "  unresolvable — Rule Q clause 2, a module-resolution failure swallowed by a"
    echo "  soft-skip."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — an unresolvable \`typescript\` hard-fails (exit 2), not a silent skip (FOLLOW-1087)."
  rm -rf "$tmp/scripts/lib" "$tmp/scripts/check-mirror-files.sh"

  # 20. FOLLOW-1088 AC2 / Rule AL: register entry C4 must READ DIFFERENTLY for
  #     zero registered sig pairs than for one. The proof the old C3 carried
  #     returned empty in BOTH worlds, so it printed an identical `latent` and
  #     meant something different by it the day after PR #839 emptied the
  #     subject set. RED-FIRST: against the pre-fix script both runs print the
  #     byte-identical `[C3] latent (P2-pair-signature) 3 hard-coded helper
  #     names …` line and nothing distinguishes them.
  cp "$tmp/sig-a.ts" "$tmp/sig-b.ts"
  sig_manifest '"helpers": ["computeThing"],'
  git -C "$tmp" add -A
  _st_run
  local one_pair_line
  one_pair_line=$(echo "$out" | grep -F "[C4]" || true)
  cat > "$tmp/scripts/mirror-files.json" <<'JSONEOF'
[
  {
    "canonical": "app-a/src/observability.py",
    "mirror": "app-b/src/jobs/observability.py",
    "strip_comments": true,
    "basename_discovery": true
  }
]
JSONEOF
  git -C "$tmp" add -A
  _st_run
  local zero_pair_line
  zero_pair_line=$(echo "$out" | grep -F "[C4]" || true)
  if [[ -z "$one_pair_line" || -z "$zero_pair_line" ]]; then
    echo "SELF-TEST FAIL: register entry C4 did not appear in the gate's output."
    echo "  one-pair: '$one_pair_line'"
    echo "  zero-pair: '$zero_pair_line'"
    return 1
  fi
  if [[ "$one_pair_line" == "$zero_pair_line" ]]; then
    echo "SELF-TEST FAIL: the register reported the P2 residual IDENTICALLY with one"
    echo "  registered sig pair and with none. A control whose subject set emptied out"
    echo "  must not keep the same verdict text (RETRO-307 P-85 / Rule AL)."
    echo "  line: '$one_pair_line'"
    return 1
  fi
  if ! echo "$zero_pair_line" | grep -q "0 strip_comments:false pair(s) registered"; then
    echo "SELF-TEST FAIL: the zero-pair C4 line does not carry the subject count."
    echo "  line: '$zero_pair_line'"
    return 1
  fi
  if ! echo "$out" | grep -q "0 signature pair(s) registered — no signatures compared"; then
    echo "SELF-TEST FAIL: with zero sig pairs the gate did not say so on its own P2"
    echo "  line — a green run must not be silent about having compared nothing."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — register entry C4 distinguishes zero registered sig pairs from one (FOLLOW-1088 AC2)."

  return 0
}

if [[ "${1:-}" == "--self-test" ]]; then
  echo "=== Rule J gate self-test (FOLLOW-746 AC1) ==="
  if run_self_test; then
    echo ""
    echo "Self-test PASSED."
    exit 0
  fi
  exit 2
fi

# Inline self-check on every normal run (see header: this is how the self-test
# is PROVEN to run — CI and lefthook both invoke this script with no args).
if [[ "${MIRROR_FILES_SKIP_SELF_CHECK:-}" != "1" ]]; then
  if self_check_out=$(run_self_test 2>&1); then
    echo "Rule J gate self-test: PASSED ($(echo "$self_check_out" | grep -c '^OK:') assertions)"
    echo ""
  else
    echo "FAIL: the Rule J gate's own self-test did not pass — the gate is broken,"
    echo "so its verdict on the real tree cannot be trusted."
    echo ""
    echo "$self_check_out"
    exit 2
  fi
fi

# ── Read manifest via node ────────────────────────────────────────────────────
pair_count=$(node -e "const m=require('$MANIFEST'); console.log(m.length);")

# P2's subject set, counted BEFORE the loop so the gate can say out loud how
# many pairs it is about to signature-check (FOLLOW-1088, Rule Q clause 1) and
# so the extractor preflight runs only when there is something to check
# (FOLLOW-1087, register entry H).
SIG_PAIR_COUNT=$(node -e "const m=require('$MANIFEST'); console.log(m.filter(p=>p.strip_comments===false).length);")
SIG_COMPARED=0
if [[ "$SIG_PAIR_COUNT" -gt 0 ]]; then
  sig_preflight
fi

for i in $(seq 0 $((pair_count - 1))); do
  canonical=$(node -e "const m=require('$MANIFEST'); console.log(m[$i].canonical);")
  mirror=$(node -e "const m=require('$MANIFEST'); console.log(m[$i].mirror);")
  strip=$(node -e "const m=require('$MANIFEST'); console.log(m[$i].strip_comments);")

  echo "=== Checking mirror pair $((i + 1))/$pair_count ==="
  echo "    canonical: $canonical"
  echo "    mirror:    $mirror"

  if [[ ! -f "$canonical" ]]; then
    echo "FAIL: canonical file not found: $canonical"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  if [[ ! -f "$mirror" ]]; then
    echo "FAIL: mirror file not found: $mirror"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  if [[ "$strip" == "true" ]]; then
    # ── Byte-equivalent check (strip comments, compare normalized) ────────
    tmp_canonical=$(mktemp)
    tmp_mirror=$(mktemp)

    strip_comments "$canonical" >"$tmp_canonical"
    strip_comments "$mirror" >"$tmp_mirror"

    if diff -u "$tmp_canonical" "$tmp_mirror" >/dev/null 2>&1; then
      echo "OK:  normalized content identical."
      rm -f "$tmp_canonical" "$tmp_mirror"
    else
      echo ""
      echo "FAIL: normalized content differs between canonical and mirror."
      echo "      Diff (canonical vs mirror, comments stripped):"
      diff -u "$tmp_canonical" "$tmp_mirror" \
        --label "canonical: $canonical (stripped)" \
        --label "mirror:    $mirror (stripped)" \
        || true
      echo ""
      echo "      Fix: update the mirror to match the canonical."
      echo "      Both sides must be patched in the same commit."
      rm -f "$tmp_canonical" "$tmp_mirror"
      FAILURES=$((FAILURES + 1))
    fi

  else
    # ── Function-signature check (P2): the helpers the PAIR declares ──────
    # FOLLOW-1087/1083: the names come from the pair's own `helpers: []` field
    # in scripts/mirror-files.json. They used to be a file-level constant
    # (deterministicScore/affinityScore/buildReorderDirective) written for the
    # adapt/reorder pair — a pair PR #839 de-registered. Against ANY other
    # pair each of those three names printed
    # `INFO: <fn> not found in canonical — skipping.` WITHOUT incrementing
    # FAILURES, and the loop then fell into `OK: … signatures match` having
    # compared nothing (Rule AU). A declared name that is absent from the
    # canonical is now a FAIL: the declaration is the contract, so a name that
    # does not resolve is a broken manifest, not a benign skip.
    #
    # FOLLOW-1070: extraction is a TS-parser read of the WHOLE declaration —
    # from `function <name>(` through (not including) the `{` that opens the
    # body — via scripts/lib/extract-fn-signature.cjs, not a `grep | head -1`
    # of one physical line. The old one-line extraction compared only
    # `function <name>(` for any multi-line declaration (params/return type
    # on later lines), which is identical text regardless of what the params
    # or return type actually say — it printed "signatures match" on PR #825's
    # real divergence in both `affinityScore` (return type) and
    # `buildReorderDirective` (arity + return type). See RETRO-298 §4a LG-1.
    #
    # FOLLOW-1070 also changes a signature MISMATCH from WARN to FAIL. Rule J
    # is a REQUIRED merge gate; a WARN never fails a required gate, so it does
    # not block merge. Rule AU's distinguishing test: "does the assertion, if
    # it PASSED, permit the failure the control exists to prevent?" — a WARN
    # is exactly a pass for CI-gating purposes, so a real breaking divergence
    # (different arity, different return type) would sail through the one
    # control that exists to catch it. There is no case where a genuine
    # signature mismatch on a registered mirror pair is an acceptable steady
    # state: either the mirror is fixed to match, or the pair is
    # re-registered/re-scoped in the same PR (Rule AP clause 5). FAIL is the
    # only value consistent with this gate's own required-check status.
    sig_fail=0

    # P7: a strip_comments:false pair MUST declare a non-empty helpers list.
    # A non-array, or an array with no usable string in it, yields the empty
    # string here and is a hard FAIL — never an empty loop followed by an OK.
    pair_helpers=$(node -e "
      const m=require('$MANIFEST');
      const h=m[$i].helpers;
      if (Array.isArray(h)) console.log(h.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()).join('\n'));
    ")
    if [[ -z "$pair_helpers" ]]; then
      echo "FAIL: this pair is registered strip_comments:false but declares no usable"
      echo "      \"helpers\": [\"fnA\", \"fnB\"] array in scripts/mirror-files.json."
      echo "      The signature check compares the functions the PAIR names; with no"
      echo "      list there is nothing to compare, and a gate that compares nothing"
      echo "      must not report that the signatures match (Rule AU)."
      echo "      Fix: add the helper names to this pair, or register it"
      echo "      strip_comments:true for a whole-file comparison."
      FAILURES=$((FAILURES + 1))
      echo ""
      continue
    fi

    sig_err=$(mktemp)
    for fn in $pair_helpers; do
      # `&& rc=0 || rc=$?` (not a bare `$?` after the assignment) so a non-zero
      # extractor exit does not trip `set -e` before the case below classifies
      # it. The classification is the whole point of FOLLOW-1087: 2 and 3 are
      # the extractor's own, documented outcomes; ANY other status came from
      # node itself (missing module, unresolvable dependency, signal) and means
      # the machinery is broken — it is NOT "not found".
      canonical_sig=$(node "$SIG_EXTRACTOR" "$canonical" "$fn" 2>"$sig_err") \
        && canonical_rc=0 || canonical_rc=$?
      case "$canonical_rc" in
        0) ;;
        2)
          echo "FAIL: could not parse '$canonical' while extracting '$fn' (extractor exit 2)."
          sig_fail=$((sig_fail + 1))
          FAILURES=$((FAILURES + 1))
          continue
          ;;
        3)
          echo "FAIL: declared helper '$fn' is not a top-level function in the canonical ($canonical)."
          echo "      This pair's \"helpers\" list names it, so either the function was"
          echo "      renamed/removed and the manifest was not updated, or the name is a"
          echo "      typo. A declared-but-absent helper is a broken registration, not a"
          echo "      reason to skip (FOLLOW-1087)."
          sig_fail=$((sig_fail + 1))
          FAILURES=$((FAILURES + 1))
          continue
          ;;
        *)
          sig_machinery_broken "node exited $canonical_rc extracting '$fn' from '$canonical' — outside the extractor's 0/2/3 contract." "$sig_err"
          ;;
      esac

      mirror_sig=$(node "$SIG_EXTRACTOR" "$mirror" "$fn" 2>"$sig_err") \
        && mirror_rc=0 || mirror_rc=$?
      case "$mirror_rc" in
        0) ;;
        2)
          echo "FAIL: could not parse '$mirror' while extracting '$fn' (extractor exit 2)."
          sig_fail=$((sig_fail + 1))
          FAILURES=$((FAILURES + 1))
          continue
          ;;
        3)
          echo "FAIL: function '$fn' present in canonical ($canonical) but missing from mirror ($mirror)."
          sig_fail=$((sig_fail + 1))
          FAILURES=$((FAILURES + 1))
          continue
          ;;
        *)
          sig_machinery_broken "node exited $mirror_rc extracting '$fn' from '$mirror' — outside the extractor's 0/2/3 contract." "$sig_err"
          ;;
      esac

      SIG_COMPARED=$((SIG_COMPARED + 1))
      if [[ "$canonical_sig" == "$mirror_sig" ]]; then
        echo "OK:  $fn — signatures match."
      else
        echo "FAIL: $fn — signatures differ."
        echo "      canonical: $canonical_sig"
        echo "      mirror:    $mirror_sig"
        echo "      Fix: update the mirror to match the canonical, or re-register/re-scope"
        echo "      this pair in scripts/mirror-files.json (Rule AP clause 5) in the same PR."
        sig_fail=$((sig_fail + 1))
        FAILURES=$((FAILURES + 1))
      fi
    done
    rm -f "$sig_err"

    if [[ "$sig_fail" -eq 0 ]]; then
      echo "OK:  all $(printf '%s\n' "$pair_helpers" | grep -c '') declared helper(s) compared, signatures match."
    fi
  fi

  echo ""
done

# ── P2 positive-execution line (FOLLOW-1088, Rule Q clause 1) ────────────────
# Printed on EVERY run, pass or fail, carrying the subject count. Before this,
# a reviewer reading a green `Rule J — mirror-code sync check` could not tell
# "the helper signatures were compared and agree" from "nothing was compared":
# PR #839 removed the last strip_comments:false pair, and the gate's output
# went from three OK lines to silence with no change in verdict (RETRO-307 §6
# pattern P-85 — a control's SUBJECT SET emptied out and its verdict did not
# change). Register entry C4 carries the same count, so the register cannot
# report an identical `latent` in the zero-pair and one-pair worlds either.
echo "=== P2 signature check — subject count ==="
if [[ "$SIG_PAIR_COUNT" -eq 0 ]]; then
  echo "OK:  0 signature pair(s) registered — no signatures compared."
  echo "     Nothing in this repo is signature-checked: every registered pair is"
  echo "     strip_comments:true (whole-file). This is a coverage fact, not a"
  echo "     failure — see register entry C4."
else
  echo "OK:  $SIG_PAIR_COUNT signature pair(s) registered — $SIG_COMPARED signature(s) compared."
fi
echo ""

# ── Basename discovery (FOLLOW-746 AC1; hardened by FOLLOW-766 / FOLLOW-767) ─
echo "=== Basename discovery — unregistered copies of mirrored files ==="

REGISTERED_PATHS=$(node -e "
const m=require('$MANIFEST');
const s=new Set();
for (const p of m) for (const k of ['canonical','mirror']) if (p[k]) s.add(p[k]);
console.log([...s].join('\n'));
")

DISCOVER_BASENAMES=$(node -e "
const m=require('$MANIFEST');
const s=new Set();
for (const p of m) if (p.basename_discovery === true)
  for (const k of ['canonical','mirror']) if (p[k]) s.add(p[k].split('/').pop());
console.log([...s].join('\n'));
")

# FOLLOW-766: one line per pair that opts OUT of basename discovery (false or
# omitted) — pair-level, not a deduped flat basename set, because the note is a
# pair-level decision record and must stay attached to the pair it justifies.
#
# FOLLOW-770 AC3: both fields are base64-encoded, so the line protocol is
# TOTAL. The previous raw "basenames<TAB>note" form broke on a note containing
# a literal newline (JSON permits one): the note split into a bogus second
# line whose "basenames" was a note fragment and whose note was empty, and the
# gate emitted a false-RED "opted out with no note" for a pair that has one.
# base64 output is single-line by construction, so no note content can forge a
# record boundary.
OFF_PAIRS=$(node -e "
const m=require('$MANIFEST');
const b64=(s)=>Buffer.from(s,'utf8').toString('base64');
for (const p of m) {
  if (p.basename_discovery === true) continue;
  const basenames=[...new Set(['canonical','mirror'].map(k=>p[k]).filter(Boolean).map(x=>x.split('/').pop()))].join(' ');
  const note=(p.basename_discovery_note || '').trim();
  console.log(b64(basenames) + '\t' + b64(note));
}
")

if [[ -n "$DISCOVER_BASENAMES" ]]; then
  echo "Discovery ON for basenames:  $(echo "$DISCOVER_BASENAMES" | tr '\n' ' ')"
else
  echo "Discovery ON for basenames:  (none — every pair opted out)"
fi
if [[ -n "$OFF_PAIRS" ]]; then
  echo "Discovery OFF for basenames:"
  while IFS=$'\t' read -r off_basenames_b64 off_note_b64; do
    [[ -z "$off_basenames_b64" ]] && continue
    off_basenames=$(printf '%s' "$off_basenames_b64" | base64 -d)
    off_note=""
    if [[ -n "$off_note_b64" ]]; then
      off_note=$(printf '%s' "$off_note_b64" | base64 -d)
    fi
    echo "  $off_basenames"
    if [[ -z "$off_note" ]]; then
      echo "    FAIL: basename_discovery is off for this pair — the key is set to"
      echo "    false, or OMITTED entirely, which counts the same — and there is no"
      echo "    (or an empty) basename_discovery_note. An opt-out must be a recorded"
      echo "    decision, not a silent default (FOLLOW-766)."
      echo "    Fix: add a non-empty basename_discovery_note to this pair in"
      echo "    scripts/mirror-files.json, or set basename_discovery: true."
      FAILURES=$((FAILURES + 1))
    else
      # A note may be multi-line (FOLLOW-770 AC3); print every line, indented.
      printf '%s\n' "$off_note" | while IFS= read -r note_line; do
        echo "    reason: $note_line"
      done
    fi
  done <<< "$OFF_PAIRS"
fi
echo ""

DISCOVERY_FAILURES=0
if [[ -n "$DISCOVER_BASENAMES" ]]; then
  # ── FOLLOW-770 AC1: give the discovery source's failure a consumer ────────
  # The tracked-file list is materialised ONCE and its exit status captured
  # explicitly. Previously `git ls-files` ran inside `done < <( … )`, where a
  # 128 ("not a git repository", reachable via MIRROR_FILES_ROOT) propagates to
  # neither `set -e` nor `pipefail`: the loop body never ran, found_count
  # stayed 0, and the gate reported CLEAN having scanned nothing.
  TRACKED_LIST=$(mktemp)
  TRACKED_ERR=$(mktemp)
  tracked_rc=0
  git ls-files >"$TRACKED_LIST" 2>"$TRACKED_ERR" || tracked_rc=$?
  tracked_count=$(grep -c '' "$TRACKED_LIST" || true)

  if [[ "$tracked_rc" -ne 0 || "$tracked_count" -eq 0 ]]; then
    echo "FAIL: DISCOVERY SOURCE UNAVAILABLE — basename discovery could not read"
    echo "      this repo's tracked-file index, so it scanned NOTHING."
    echo "      git ls-files exit status: $tracked_rc, files listed: $tracked_count"
    echo "      root under inspection:    $ROOT"
    if [[ -s "$TRACKED_ERR" ]]; then
      echo "      git stderr:"
      sed 's/^/        /' "$TRACKED_ERR"
    fi
    echo ""
    echo "      The manifest declares $(printf '%s\n' "$DISCOVER_BASENAMES" | grep -c '') basename(s) with"
    echo "      basename_discovery: true, so a discovery pass MUST happen. This is"
    echo "      NOT reported as \"0 file(s) found\" and NOT as an ordinary finding:"
    echo "      the gate's own machinery is broken, so its verdict on the real tree"
    echo "      cannot be trusted (exit 2 — same contract as the Sentry gates'"
    echo "      missing-helper path, FOLLOW-760/FOLLOW-770 AC1)."
    echo "      Usual cause: MIRROR_FILES_ROOT points outside any git work tree."
    echo "      Fix the root (or the checkout); do NOT fall back to \`find\` — that"
    echo "      is the FOLLOW-767 defect this scan was built to remove."
    rm -f "$TRACKED_LIST" "$TRACKED_ERR"
    exit 2
  fi
  rm -f "$TRACKED_ERR"

  while IFS= read -r basename_to_find; do
    [[ -z "$basename_to_find" ]] && continue
    found_count=0
    while IFS= read -r found_path; do
      [[ -z "$found_path" ]] && continue
      # A tracked-but-deleted index entry (not yet `git rm`'d) should not
      # count — matches the previous `find -type f` semantics.
      [[ -f "$found_path" ]] || continue
      rel="$found_path"
      found_count=$((found_count + 1))
      if printf '%s\n' "$REGISTERED_PATHS" | grep -Fxq -- "$rel"; then
        continue
      fi
      echo "FAIL: unregistered copy of a mirrored file: $rel"
      echo "      Its basename ($basename_to_find) IS registered in"
      echo "      scripts/mirror-files.json, but this path is not — so no gate"
      echo "      enforces that it matches the canonical, and"
      echo "      check-sentry-init-singleton.sh does not treat it as a"
      echo "      legitimate init site either (FOLLOW-746 AC1/AC2)."
      echo "      Fix: register it as a pair in scripts/mirror-files.json (and"
      echo "      make it byte-identical to the canonical), or delete it."
      DISCOVERY_FAILURES=$((DISCOVERY_FAILURES + 1))
      FAILURES=$((FAILURES + 1))
    done < <(
      # FOLLOW-767: candidates come from THIS repo's tracked-file index, not
      # a `find … -prune` blacklist — see the header comment for why that
      # blacklist false-failed on real agent worktrees. FOLLOW-770: the index
      # is read from the pre-materialised, status-checked list above, so a
      # failure here can no longer be silent.
      awk -F/ -v b="$basename_to_find" '$NF==b' "$TRACKED_LIST"
    )
    echo "    $basename_to_find: $found_count file(s) found under $ROOT"
  done <<< "$DISCOVER_BASENAMES"
  rm -f "$TRACKED_LIST"
fi

if [[ "$DISCOVERY_FAILURES" -eq 0 ]]; then
  echo "OK:  every TRACKED file sharing a registered mirror basename is itself"
  echo "     registered (register entries A/B bound what 'tracked' leaves out)."
fi
echo ""

# ── Rule AP residual register (FOLLOW-770 AC5) ───────────────────────────────
# The regions each latency proof is evaluated over. Every one of them is the
# SAME region as the control its entry describes (Rule AL) — see the header.
MF_MANIFEST_FACTS=$(node -e "
const fs=require('fs');
const m=require('$MANIFEST');
const CFAM=new Set(['ts','tsx','js','jsx','mjs','cjs']);
const strip=new Set(), nonc=new Set();
for (const p of m) {
  if (p.strip_comments !== true) continue;
  for (const k of ['canonical','mirror']) {
    const v=p[k]; if (!v) continue;
    strip.add(v);
    const ext=(v.split('.').pop() || '').toLowerCase();
    if (!CFAM.has(ext) && fs.existsSync(v)) nonc.add(v);
  }
}
for (const v of strip) console.log('STRIP\t'+v);
for (const v of nonc) console.log('NONC\t'+v);
for (const p of m) if (p.strip_comments === false && p.canonical) console.log('SIG\t'+p.canonical);
// C3: top-level functions in a sig-pair canonical the pair does NOT declare.
// A text scan (same '^(export )?(async )?function name(' shape the pre-#836
// extraction anchored on), deliberately NOT the TS-parser extractor: a
// register proof must not depend on \`typescript\` being resolvable, or it
// would report UNEVALUABLE — i.e. red — in every worktree without
// node_modules. Under-declaration is a manifest-hygiene question, and a
// regex over 'function <name>(' answers it without a compiler.
for (const p of m) {
  if (p.strip_comments !== false || !p.canonical) continue;
  // A pair with NO usable helpers list is P7's own exit-1 finding; it is
  // deliberately not double-counted here (same precedent as entry E).
  if (!Array.isArray(p.helpers) || p.helpers.filter((x) => typeof x === 'string' && x.trim()).length === 0) continue;
  const declared = new Set(Array.isArray(p.helpers) ? p.helpers : []);
  let src;
  try { src = fs.readFileSync(p.canonical, 'utf8'); } catch (e) { continue; }
  const re = /^(?:export[ \t]+)?(?:async[ \t]+)?function[ \t]+([A-Za-z0-9_]+)[ \t]*\(/gm;
  let hit;
  while ((hit = re.exec(src)) !== null) {
    if (!declared.has(hit[1])) console.log('SIGUNDECL\t'+p.canonical+': '+hit[1]);
  }
}
// G: a helpers array on a pair that is NOT strip_comments:false is dead config.
for (const p of m) {
  if (p.strip_comments === false) continue;
  if (Array.isArray(p.helpers) && p.helpers.length > 0)
    console.log('STRAYHELPERS\t'+(p.canonical || '?')+' -> '+(p.mirror || '?'));
}
for (const p of m) {
  if (p.basename_discovery === true) continue;
  const note=(p.basename_discovery_note || '').trim();
  if (!note) continue;
  const basenames=[...new Set(['canonical','mirror'].map(k=>p[k]).filter(Boolean).map(x=>x.split('/').pop()))].join(' ');
  console.log('NOTELEN\t'+note.length+' '+basenames);
}
")

MF_STRIP_PATHS=$(printf '%s\n' "$MF_MANIFEST_FACTS" | awk -F'\t' '$1=="STRIP"{print $2}')
MF_STRIP_NONC_PATHS=$(printf '%s\n' "$MF_MANIFEST_FACTS" | awk -F'\t' '$1=="NONC"{print $2}')
MF_SIGPAIR_CANONICALS=$(printf '%s\n' "$MF_MANIFEST_FACTS" | awk -F'\t' '$1=="SIG"{print $2}')
MF_SIG_UNDECLARED=$(printf '%s\n' "$MF_MANIFEST_FACTS" | awk -F'\t' '$1=="SIGUNDECL"{print $2}')
MF_STRAY_HELPERS=$(printf '%s\n' "$MF_MANIFEST_FACTS" | awk -F'\t' '$1=="STRAYHELPERS"{print $2}')
MF_OFF_NOTE_LENS=$(printf '%s\n' "$MF_MANIFEST_FACTS" | awk -F'\t' '$1=="NOTELEN"{print $2}')
if [[ -z "$MF_STRIP_NONC_PATHS" ]]; then
  # grep with no file operands would read stdin and hang; /dev/null is the
  # empty region, and keeps the proof's exit status meaningful (1, no output).
  MF_STRIP_NONC_PATHS="/dev/null"
fi
if [[ -n "$DISCOVER_BASENAMES" ]]; then
  MF_DISCOVERY_BN_RE="(^|/)($(printf '%s\n' "$DISCOVER_BASENAMES" | sed 's/\./\\./g' | paste -sd'|' -))\$"
else
  MF_DISCOVERY_BN_RE='a^' # never matches: no basename is discovery-ON
fi
MF_REGISTERED_PATHS="$REGISTERED_PATHS"
MF_SELF="$SELF"
MF_SIG_EXTRACTOR="$SIG_EXTRACTOR"
MF_SIGPAIR_COUNT="$SIG_PAIR_COUNT"
# C4's second conjunct: how many strip_comments:false fixtures THIS FILE's own
# self-test carries. If the manifest has none AND the self-test has none, the
# P2 arm is exercised by nothing at all and C4 goes live.
# Anchored to the JSON-line shape so this counter line does not count ITSELF —
# an unanchored grep matched its own source and reported 2 for 1 fixture.
MF_SELFTEST_SIGFIXTURES=$(grep -cE '^[[:space:]]+"strip_comments": false,?$' "$MF_SELF" || true)
export MF_STRIP_PATHS MF_STRIP_NONC_PATHS MF_SIGPAIR_CANONICALS MF_OFF_NOTE_LENS
export MF_DISCOVERY_BN_RE MF_REGISTERED_PATHS MF_SELF
export MF_SIG_UNDECLARED MF_STRAY_HELPERS MF_SIG_EXTRACTOR MF_SIGPAIR_COUNT
export MF_SELFTEST_SIGFIXTURES

# id | control | one-line description | latency proof
# EMPTY stdout ⇒ the residual is still latent. Output ⇒ it has GONE LIVE.
# ANY pipe stage exiting ≥ 2 — not merely the pipeline's own reported status ⇒
# the gate is broken (see PER-STAGE PROOF STATUS in the header). See the header
# for each entry's region, scan root and unavailable-input behaviour.
RESIDUAL_REGISTER=(
  'A|P4-basename-discovery|discovery sees TRACKED files only: an untracked copy on disk is invisible|git ls-files --others --exclude-standard | grep -E "$MF_DISCOVERY_BN_RE" | grep -vxF "$MF_REGISTERED_PATHS"'
  'B|P4-basename-discovery|.gitignore-d paths (incl. nested agent worktrees, deliberately) are outside even A|git ls-files --others --ignored --exclude-standard --directory | grep -E "$MF_DISCOVERY_BN_RE" | grep -vxF "$MF_REGISTERED_PATHS"'
  'C1|P1-pair-byte-identity|the // line-comment strip is applied to non-C languages, where // is code (py: floor division)|grep -Hn -- "//" $MF_STRIP_NONC_PATHS'
  'C2|P1-pair-byte-identity|the comment stripper only knows /* */ and //; other comment syntaxes are unvalidated|printf "%s" "$MF_STRIP_PATHS" | grep -Ev "\.(ts|tsx|js|jsx|mjs|cjs|py)\$"'
  'C3|P2-pair-signature|P2 compares exactly the helpers a pair DECLARES; a top-level function in a sig-pair canonical that the pair does not list is never compared (the hard-coded-name half is CLOSED in code by FOLLOW-1087)|printf "%s" "$MF_SIG_UNDECLARED" | grep -v "^$"'
  "C4|P2-pair-signature|P2's subject set can be EMPTY and at HEAD it is ($MF_SIGPAIR_COUNT strip_comments:false pair(s) registered, $MF_SELFTEST_SIGFIXTURES self-test fixture(s)); the count is reported here and on the gate's own P2 line, never as a verdict (the verdict channel is reserved for merge-blocking states)|test \"\$MF_SIGPAIR_COUNT\" -eq 0 && test \"\$MF_SELFTEST_SIGFIXTURES\" -eq 0 && echo 'P2 is exercised by NOTHING: zero manifest sig pairs AND zero self-test sig fixtures'"
  'D|P5-discovery-availability|the guard proves the index is READABLE, not that it is COMPLETE (sparse/partial checkout)|git config --get-regexp "core\.sparsecheckout|partialclonefilter"'
  'E|P3-optout-note|the note must EXIST and be non-empty; nothing checks that it says anything|printf "%s" "$MF_OFF_NOTE_LENS" | grep -E "^([0-9]|[123][0-9]) "'
  'F|P6-residual-register|entries are hand-written: a predicate added without an entry is invisible to the register|grep -cE "FAILURES=.\(\(FAILURES" "$MF_SELF" | grep -vx "11"'
  'G|P7-helpers-declared|the helpers list is only enforced on strip_comments:false pairs; a helpers array on a strip_comments:true pair is silently ignored dead config|printf "%s" "$MF_STRAY_HELPERS" | grep -v "^$"'
  'H|P8-extractor-preflight|the preflight runs only when a sig pair exists, so with zero pairs a missing extractor sits undetected until the first pair is registered|test "$MF_SIGPAIR_COUNT" -eq 0 && test ! -r "$MF_SIG_EXTRACTOR" && echo "signature extractor unreadable at $MF_SIG_EXTRACTOR while 0 sig pairs are registered"'
)

echo "=== Rule AP residual register — ${#RESIDUAL_REGISTER[@]} documented gap(s), every latency proof EXECUTED ==="
REGISTER_LIVE=0
REGISTER_BROKEN=0
reg_err=$(mktemp)
reg_ps=$(mktemp)

# Appended to EVERY proof before execution. It records each pipe stage's OWN
# exit status (bash's PIPESTATUS) to $MF_PS_FILE, then re-exits with pipefail's
# own rightmost-non-zero status so the diagnostic below can still report it.
# See PER-STAGE PROOF STATUS in the header for why the pipeline's own status is
# not sufficient. Written as an epilogue rather than baked into each proof so
# the register keeps the one `id|control|description|proof` format (Rule AP
# clause 6) and EVERY entry — including ones added later, and ones copied into
# another gate — gets this for free instead of per-author discipline.
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

# ── Summary ───────────────────────────────────────────────────────────────────
if [[ "$FAILURES" -gt 0 ]]; then
  echo "Rule J FAILED: $FAILURES drift/unregistered-copy violation(s) found."
  echo "See CONVENTIONS_PATCH.md Rule J for remediation options."
fi

if [[ "$REGISTER_BROKEN" -gt 0 ]]; then
  echo "Rule AP REGISTER BROKEN: $REGISTER_BROKEN entry/entries could not be evaluated."
  echo "A residual whose latency proof cannot run is NEVER assumed still latent"
  echo "(FOLLOW-760). Fix the proof or the environment it reads."
  exit 2
fi

if [[ "$REGISTER_LIVE" -gt 0 ]]; then
  echo "Rule AP REGISTER ENTRY GONE LIVE: $REGISTER_LIVE documented residual(s) are now REAL."
  echo "This is NOT an ordinary Rule J finding — the gate worked; a gap this"
  echo "script's register says is latent has become live, and the entry ids are"
  echo "named above. Close the gap, or re-scope the entry and say so in the PR."
  echo "Do not delete the entry (CONVENTIONS_PATCH.md Rule AP clause 5)."
  exit 3
fi

if [[ "$FAILURES" -gt 0 ]]; then
  exit 1
fi

echo "✓ all mirror pairs in sync, no unregistered copies, all ${#RESIDUAL_REGISTER[@]} register entries latent"
