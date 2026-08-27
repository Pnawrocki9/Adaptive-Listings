# Conventions Patch — Estalara Adaptive Listings

Permanent rules codified from lessons learned. Rules A–F come from Paczka 1 retrospective. Rules G+
are added by the `retrospective-analyst` agent when the same finding pattern appears in ≥2
per-ticket retrospectives (RULE_PROMOTION_THRESHOLD = 2). Rules may also be codified directly from a
CEO/architect directive (provenance is noted on the rule; the ≥2-retro gate applies only to
retro-promoted rules).

**This file is authoritative.** When a rule here conflicts with older prose in CLAUDE.md, this file
wins. PM orchestrator includes the current rules in every worker delegation prompt.

---

## Rule A — Always verify CI green before READY_FOR_REVIEW

**Pattern:** Marking ticket READY_FOR_REVIEW based only on local test pass, without waiting for
GitHub Actions CI to complete.

**Evidence:** Paczka 1 TICKET-001 (original failure mode documented in pm-orchestrator.md)

**Rule (amended 2026-08-05 — FOLLOW-813, "soft-skip inception" class of defect in the gate
itself):** PM-orchestrator MUST run `scripts/gh-pr-checks-verified.sh <pr-number>` and wait for
completion before marking any ticket READY_FOR_REVIEW. Local tests passing ≠ CI passing. This step
is non-negotiable even if the worker reports "all tests pass." **Do not use bare
`gh pr checks <pr-number> --watch`** — it was the original wording of this rule and was found to
exit `0` while a check was still `fail` (PR #668, #670, #671): GitHub does not register a check-run
for a job gated behind `needs:` until that job starts, so a job like `Rule I — wired-or-dead check`
can appear on the check list well after `--watch`'s polling loop has already decided every check-run
it knows about has settled. `scripts/gh-pr-checks-verified.sh` polls until it observes two
consecutive, identical, fully-settled snapshots (immune to that race) **carrying at least a derived
minimum number of check-runs** (two identical snapshots prove the set stopped changing, not that it
is complete — a truncated rollup settled green twice on PR #686 during the ESC-050 Actions incident;
the floor is 40% of the second-highest of the repo's twelve most recent PR rollups, never a
hardcoded constant, and a rollup below it exits 3/UNDETERMINED, never 0 [FOLLOW-865]), re-asserts
pass/fail counts from a fresh read, and dynamically classifies any failure against the documented
pre-existing-red gates (currently only `Rule I`, compared by SYMBOL SET against `main`'s own newest
usable baseline run — never against a count and never against a hardcoded number, because a count
comparison accepts a PR that deletes one dead export and introduces another [FOLLOW-821 AC(1) /
FOLLOW-827]) before exiting.

It also asserts IDENTITY, which the two properties above do not cover: every name in
`.github/required-checks.txt` must be present in the settled rollup, and green unless marked
`any-state`. Stability and size were both satisfiable while the checks that matter were `SKIPPED` —
which the failure regex counts as success — or simply absent; measured on the merged script, six
real gates flipped to `SKIPPED` produced `failing: 0` and `RESULT: all checks green`, and the
completeness floor tolerated 59% of the rollup vanishing [FOLLOW-918 / RETRO-263]. A registered gate
that is absent or not green is exit 3/UNDETERMINED, never 0 — and never exit 1, because an
untriggered workflow is not a red verdict on the PR's content and must not increment
`fix_iteration_counter`. **A PR that adds or renames a required gate must add or update its name in
that register in the same PR; a rename without the edit is exit 3 on the next PR, by design.**

**Verification:**

```bash
scripts/gh-pr-checks-verified.sh <pr-number>
# Exit 0 = safe to mark READY_FOR_REVIEW. Exit 1 = genuine failure. Exit 2 = timed out — do not
# proceed either way; investigate.
# Exit 3 = the gate could not run or could not complete its comparison (preflight, refused fixture
# seam, unreadable Rule I log, no usable baseline in the look-back window, or a check snapshot the
# gate's own parser cannot read [FOLLOW-856]). NOT a green and NOT a red: re-run after fixing the
# named tooling problem, and do not increment fix_iteration_counter against the worker for it
# [FOLLOW-846].
# Exit 4 = NOT ATTRIBUTABLE: the comparison completed, but a Rule I symbol is not this PR's —
# main moved under it (the symbol is on only some of the PR's own check-runs, i.e. on the merge
# ref and not the branch head), or the PR edits scripts/check-rule-i.sh so the two sides came from
# different extractors [FOLLOW-855]. Also NOT a green and NOT a red, and likewise never increments
# fix_iteration_counter: re-run once a newer main run has completed, or adjudicate by hand.
# Precedence when several categories are present: 3 > 1 > 4 > 0.
```

<!-- gate-exit-contract: 0=GREEN 1=GENUINE_FAILURE 2=TIMEOUT 3=TOOLING_FAILURE 4=NOT_ATTRIBUTABLE -->

That marker line is machine-checked by `scripts/check-gate-exit-codes.sh`, a hard gate in `ci.yml`:
it reads the contract out of `gh-pr-checks-verified.sh` itself and fails when any routing consumer
disagrees, so no exit code can be added or re-meant without every consumer being edited in the same
PR (FOLLOW-854).

---

## Rule B — Run prettier on every file you edit, every time

**Pattern:** Skipping prettier re-run on previously formatted files, causing CI format check
failures on unchanged-looking code.

**Evidence:** Paczka 1 format CI failures across multiple tickets

**Rule:** Run `pnpm prettier --write <file>` on every file you touch, on every edit, even if you ran
it earlier in the session. CI format check is strict and catches any divergence.

**Verification:**

```bash
pnpm prettier --check .
# Must return exit 0
```

---

## Rule C — Check repo-config dependencies BEFORE opening PR

**Pattern:** Merging a workflow that requires Code Scanning, GitHub Secrets, or branch protection
rules that don't exist, causing CI to fail in a way that can't be fixed by code changes alone.

**Evidence:** Paczka 1 CodeQL workflow added without Code Scanning enabled in repo settings

**Rule:** Before opening a PR that adds or modifies `.github/workflows/*.yml`, verify that every
required repo setting, secret, or permission already exists. If it doesn't → write to
`backlog/ESCALATIONS.md` BEFORE opening the PR, not after CI fails. Do not push the workflow file
until the human has confirmed the setting is active.

**Verification:** Review `.github/workflows/` diff manually against available repo settings.

---

## Rule D — Python build-backend must be setuptools.build_meta

**Pattern:** Using `setuptools.backends.legacy` as the pyproject.toml build-backend, which does not
exist and causes packaging failures.

**Evidence:** Paczka 1 Python app packaging failures

**Rule:** In every `pyproject.toml`, the build-backend MUST be exactly `setuptools.build_meta`.
Also: every Python app needs `__init__.py` in `src/` (even if empty) for the package to be
importable.

**Verification:**

```bash
grep -r "build-backend" apps/ --include="pyproject.toml"
# All results must say: build-backend = "setuptools.build_meta"
```

---

## Rule E — pnpm version belongs in package.json, not in CI

**Pattern:** Setting `version:` in the `pnpm/action-setup@v4` CI step, which overrides
`packageManager` in `package.json` and causes version mismatch errors.

**Evidence:** Paczka 1 CI pnpm version conflicts

**Rule:** The pnpm version is declared once, in the root `package.json` under `packageManager`. The
`pnpm/action-setup@v4` step in CI MUST NOT include a `version:` key — it reads from `packageManager`
automatically.

**Verification:**

```bash
grep -A3 "pnpm/action-setup" .github/workflows/*.yml
# Must NOT contain "version:" key
```

---

## Rule F — Slot names must be canonical: headline, cta, feature

**Pattern:** Using non-canonical slot names (e.g., `feature-section`) in playbook archetype files,
causing SDK query selector mismatches and silent slot injection failures.

**Evidence:** TICKET-046 / PR #92 — `yield-hunter.ts` had `feature-section` instead of `feature`,
also present in `llm-gateway.ts` prompt string

**Rule:** The three canonical slot names are `headline`, `cta`, `feature`. Any other value is a bug.
When adding a new slot or archetype, validate the name against this list. The LLM gateway prompt
strings listing available slots must also use these exact names.

**Verification:**

```bash
grep -rn "feature-section" packages/sdk/src/core/playbooks/ apps/control-plane/src/
# Must return 0 results
```

---

## Rule G — Breaking type changes require grep for inline mock objects

**Pattern:** Adding a required field to a shared TypeScript type (e.g., making `copy_template`
required on `PlaybookEntry`) without scanning all files that construct inline mock objects of that
type, leaving test mocks incomplete and causing typecheck failures in CI.

**Evidence:** TICKET-046 / PR #92 — `MOCK_PLAYBOOK` in `llm-gateway.test.ts` failed typecheck after
`copy_template` became required on `PlaybookEntry`; RETRO-001 identified this pattern

**Rule:** When making a field required (removing `?`) or adding a new required field to any exported
type in `packages/shared/` or `packages/sdk/`, IMMEDIATELY run:

```bash
grep -rn "TypeName" packages/ apps/ --include="*.ts" --include="*.tsx" | grep -v "import"
```

Find all inline object constructions of that type and update them before opening the PR.

**Verification:**

```bash
pnpm typecheck
# Must return exit 0 — catches all incomplete mock objects
```

### Rule G amendment (2026-06-11 — RETRO-053 §4b BUG-1 / RETRO-010 §6 — shape change escapes typecheck via loosely-typed test data)

**Pattern (the typecheck-blind sub-shape, promoted at count 2):** A shared-type field SHAPE change —
ADDING a required field OR REMOVING a field — breaks test DATA that lives OUTSIDE what
`pnpm typecheck` validates, so the break does NOT surface at typecheck and instead fails at the test
RUN (or, worse, ships needing a separate hotfix commit). The blind spots are: (a) loosely-typed test
helpers that cast `unknown`→a caller-supplied generic (`parseBody<T>(res): Promise<T>`,
`makeRequest(body: unknown)`) — a stale `expect(body.removed_field).toBe(3)` COMPILES clean and only
fails at runtime; (b) HTML/JS string fixtures (`e2e/fixtures/index.html`); (c) JSON fixture files;
(d) Playwright `route.fulfill({ body: JSON.stringify(...) })` bodies.

**Evidence:** RETRO-010 §6 (FOLLOW-105 — a newly-REQUIRED response field broke E2E HTML/JSON string
fixtures `tsc` cannot reach; deferred at count 1: "Threshold (2) NOT met"). RETRO-053 §4b BUG-1
(FOLLOW-264 / PR #263 — REMOVING `trigger_after_n_listings` from the `QuizConfigSchema`/`QuizConfig`
left four `route.test.ts` assertions referencing it via
`parseBody<{ trigger_after_n_listings: number }>` and
`makePostRequest({ ..., trigger_after_n_listings: 5 })`; both compile because the helpers cast
`unknown`, so `tsc --noEmit` stayed green and the stale `.toBe(3)` assertions failed only at the
vitest run — requiring hotfix commit `0820282`). Count 2, non-adjacent retros → promoted.

**Rule (amendment):** Rule G's grep-and-update sweep applies to field REMOVALS as well as
required-field ADDS, and the grep MUST include test/fixture data that the type system does not
constrain. When you add a required field to OR remove any field from an exported type whose values
flow through tests or fixtures, ALSO grep for the field name across `*.test.ts`, `*.spec.ts`,
`*.html`, `*.json`, and Playwright `route.fulfill` bodies — `pnpm typecheck` does NOT cover
loosely-typed test helpers (`parseBody<T>`, `makeRequest(body: unknown)`) or out-of-typesystem
fixtures. A green `tsc` is NOT sufficient evidence the change is complete: you MUST run the test
suite (complements Rule T — Rule T says "hooks are format-only, run `tsc`"; this says "even `tsc` is
blind to loosely-typed test data, run the runner").

**Verification:**

```bash
# After adding/removing a field on a shared type, grep the field NAME across test + fixture data:
grep -rn "removed_or_added_field_name" packages/ apps/ \
  --include="*.test.ts" --include="*.spec.ts" --include="*.html" --include="*.json" --include="*.tsx" \
  | grep -v node_modules
# Then run the suite — typecheck alone will NOT catch stale assertions in parseBody<T>/route.fulfill bodies:
pnpm test    # (or the touched package's vitest) — must be green, not just `tsc --noEmit`
```

---

## Rule H — Schema scaffold MUST ship with at least one runtime-wired consumer

**Pattern:** Adding a database table, event schema, or library module without wiring it into a
production request path — leaving the new surface as dead code at runtime while tests pass in
isolation. The downstream consumer ticket then merges assuming the wiring exists, compounding the
gap. Symptoms include: schema file + unit tests + zero non-test importers, OR Zod event schema
registered in the event union but no producer call site, OR mock API route shipped with a comment
"real implementation in TICKET-X" but TICKET-X never replaces the mock.

**Evidence:**

- RETRO-001 / TICKET-046 (PR #92): `PlaybookEntry.variants[]` shipped + `ab_bandit_weights.variant`
  column present, but Decision API never selects between variants (`variant_index` always 0;
  variant_0/1/2 seed rows never inserted). → FOLLOW-001.
- RETRO-001 / TICKET-046 (PR #92): `PlaybookEntry.copy_template.en` field added to all 17
  non-neutral archetypes, but `GET /api/adapt/description` endpoint, Modal
  `generate_description.py`, and the Redis cache layer described in Master Design E.7 do not exist —
  `copy_template` is unreachable. → FOLLOW-002.
- RETRO-002 / TICKET-AB-001 (PR #80): `AbAssignmentEventSchema` registered in shared event union but
  no producer call emits the event from the adapt route. → FOLLOW-006.
- RETRO-002 / TICKET-AB-001 (PR #80): `apps/decision-api/src/lib/bandit.ts` exports
  `thompsonSample()` + Beta utilities, fully unit-tested, but imported by zero non-test files. The
  adapt route still uses keyword `detectArchetype()`. → FOLLOW-007.
- RETRO-002 / TICKET-AB-001 (PR #80): `ab_bandit_weights` Postgres table created with RLS but zero
  rows seeded for the 18 archetypes — table is schema-only. → FOLLOW-008.
- RETRO-002 / TICKET-AB-001 (PR #80): ClickHouse `adaptation_decisions.holdout_group` column
  migration applied, but the writer that populates `adaptation_decisions` was not updated; every row
  takes the column default `false`. → FOLLOW-010.
- RETRO-002 / TICKET-AB-001 → TICKET-AB-004 cascade: `/api/ab/weights` shipped as a mock with a
  comment "real Drizzle queries will replace this in TICKET-AB-004", but AB-004 (PR #99) merged
  without touching the file. The analytics dashboard now renders fabricated data. → FOLLOW-014.

**Rule:** Every ticket that adds a new schema, Zod type, exported library module, DB table, or
event-union member MUST include at least one of the following in the same PR:

1. **A production consumer call site** — at minimum, one non-test file in `apps/` imports the new
   symbol and uses it on a hot path. Verified by
   `grep -rn '<symbol_name>' apps/ --include='*.ts' | grep -v __tests__ | grep -v node_modules`.
   Must return ≥1 match outside the defining file.
2. **An integration test that proves end-to-end wiring** — for event schemas: a test that mounts the
   producing route and asserts the event reached a mock consumer. For library modules: a test that
   imports through the consuming route, not the module directly. For DB tables: a test that asserts
   seed/insert via the consuming code, not a raw INSERT.
3. **An explicit, dated deferral in the ticket spec + a corresponding FOLLOW-NNN stub created in the
   same PR.** If wiring genuinely cannot land in this ticket, the deferral must be written into the
   AC list (NOT only the context body) and a follow-up stub must be added to `backlog/FOLLOW_UPS.md`
   in the same commit, with `recommended_sprint` set to the next sprint.

Mock API routes are allowed only when (3) is satisfied AND the route file's header comment includes
the target follow-up ID (e.g. `// MVP stub — replaced by FOLLOW-014`). The reviewer MUST verify the
follow-up exists before approving.

**Hard gate (CI + pre-push):** `scripts/check-rule-h.sh` runs as a blocking CI job (`rule-h` in
`.github/workflows/ci.yml`) and as a `pre-push` lefthook. Exit code 1 = PR blocked. The script
checks:

1. Any API route file changed in the PR that contains `MVP stub` / `mock data` /
   `real impl in TICKET-` MUST include a `FOLLOW-NNN` reference, and that stub MUST exist in
   `backlog/FOLLOW_UPS.md`. No FOLLOW-NNN → CI fails.
2. Any newly created `lib/*.ts` file MUST have at least one non-test importer in `apps/` or
   `packages/`. Zero importers → CI fails.

Run locally before pushing:

```bash
bash scripts/check-rule-h.sh origin/main
```

### Rule H amendment (2026-05-23 — RETRO-006 §6a)

**Pattern (sub-case of Rule H):** Shipping a mutation endpoint with weak / placeholder auth in one
PR and tightening it in a follow-up PR ("ratchet later"). Symptom: a route that mutates state ships
with presence-only Bearer / no signature / `if (ADAPT_API_KEY)` permissive fallback, then a later PR
adds HMAC / token binding / proper scope checks. The window between the two PRs is a production
security regression that CI cannot catch and that bandit / feedback / mutation surfaces silently
absorb.

**Evidence:**

- RETRO-002 / FIX-013..019 (Sprint 8): JWT spoofing / RLS bypass / tenant header spoof / API key
  auth gate gaps patched only after running with the issues for weeks.
- RETRO-005 / FOLLOW-041 / FOLLOW-051: feedback endpoint shipped with presence-only Bearer in PR
  #127, hardened to HMAC-SHA256 in PR #133 16 hours later.
- RETRO-006 §6a: 2026-05-22 → 2026-05-23 vulnerability window where `POST /api/adapt/feedback`
  accepted presence-only Bearer tokens in production `main`. No real tenants existed in the window,
  so no exposure — but the pattern recurs.

**Rule:** HTTP endpoints that mutate state MUST ship with production-grade auth in the same PR.
Shipping a weak / placeholder auth path then hardening it in a follow-up PR is **not permitted**.

**Exception:** Internal-only endpoints (gated by `INTERNAL_API_SECRET`, no public exposure, no SDK
or browser caller) may use the ratchet pattern IF documented in an ADR (`docs/adr/`). The ADR must
state (a) why the internal-only assumption holds, (b) the explicit threat model under that
assumption, and (c) the follow-up ticket ID that closes the ratchet.

**How to apply:**

- "Mutates state" includes: any DB write, any ClickHouse insert, any Redpanda emit, any
  external-service mutation, any cache invalidation that affects another tenant.
- "Production-grade auth" means: tenant-scoped + cryptographic (HMAC or JWT signature verified)
  - constant-time compare + replay-resistant (timestamp or nonce). A bare `Bearer <key>` check
    without signature binding does NOT qualify.
- This rule is enforced at reviewer time and PR-description time, not by an automated script (the
  threat model is per-endpoint and cannot be generically scripted). Reviewers MUST reject any PR
  that adds or modifies a state-mutating route without satisfying the rule or pointing to the
  exception's ADR.

**Verification (manual, by reviewer):**

For any new or changed file under `apps/control-plane/src/app/api/**/route.ts` or
`apps/decision-api/src/lib/**/*.ts` that issues a write or emit:

1. Grep for `Authorization` / `Bearer` / `signature` / `hmac` in the route file.
2. Confirm constant-time compare on signature verification.
3. Confirm the threat model is referenced in Master Design §V.3.x or an ADR.

Reject the PR if any check fails AND the route is not exception-eligible per the ADR clause.

### Rule H amendment (2026-05-25 — FOLLOW-105 / ADR-0006: canonical /api/adapt enforcement)

**Pattern (sub-case of Rule H):** Two divergent surfaces for the same logical contract drift apart
silently. Two concrete shapes here: (1) the Cloudflare Worker
`apps/decision-api/src/app/api/adapt/route.ts` re-introduces production archetype-selection logic
(`detectArchetype()` + the `INVESTOR/FAMILY/NEUTRAL` directive buckets) that ADR-0004 §2 forbade,
silently downgrading the pilot to a 3-bucket fallback; (2) the SDK adapt-response validator
(`packages/sdk/src/core/adapt-schema.ts` → `adaptResponseSchema`) drifts from the canonical
`AdaptationDirectives` contract (`packages/shared/src/directives.ts`), so the SDK either rejects
valid live responses or silently accepts a shape the server no longer sends.

**Evidence:**

- FOLLOW-105 substep 1a audit (`docs/audits/FOLLOW-105-1a-sdk-audit.md` §C/§D/§F.5): total drift
  between the ADR-0004 documented contract and the live `AdaptationDirectives` (only `archetype`
  matched by name); the SDK parsed responses with an unchecked `as AdaptResponse` cast.
- ADR-0004 §2 / ADR-0006 §Decision 3: the Worker 3-bucket `detectArchetype()` "MUST NOT be called
  for archetype selection in production"; ADR-0006 retires the Worker `/api/adapt` to `410 Gone`.

**Rule (ADR-0006 §Decision 4):** Two hard gates, run inside the existing `rule-h` CI job and the
`pre-push` lefthook:

1. **Adapt schema drift** — the SDK `adaptResponseSchema` top-level field SET MUST equal the
   `AdaptationDirectives` interface field SET. Any missing/extra/renamed field fails CI. (Value
   types are validated at runtime by Zod; the gate is structural.)
2. **Worker `/api/adapt` is retired** — `apps/decision-api/src/app/api/adapt/route.ts` (if present)
   MUST return `410` and MUST NOT contain `detectArchetype` / `*_DIRECTIVES` archetype-selection
   logic. (Absent entirely is also acceptable — FOLLOW-107 Phase-2 retirement.)

**Hard gate (CI + pre-push):** `scripts/check-adapt-schema-drift.sh` (gate 1, delegating to
`scripts/check-adapt-schema-drift.cjs`) and an extension of `scripts/check-rule-h.sh` that runs gate
1 and inlines gate 2. Exit code 1 = PR blocked.

Run locally before pushing:

```bash
bash scripts/check-adapt-schema-drift.sh
bash scripts/check-rule-h.sh origin/main
```

---

## Rule I — Wired-or-dead: every exported symbol must have a non-test importer

**Pattern:** A ticket ships a new exported symbol (function, class, constant, type) with unit tests
that import it directly, but zero non-test files in `apps/` or `packages/` import it. The symbol is
effectively dead code at runtime; tests give a false sense of coverage.

**Evidence:** Multiple RETRO entries (see Rule H evidence). Pattern is distinct from Rule H (which
gates PR-diff additions); Rule I gates the whole codebase continuously via CI.

**Rule:** A ticket CANNOT be marked DONE if its primary artifact has zero non-test importers. The
reviewer MUST verify at least one non-test file imports the new symbol before approving. If only
test files import it, the ticket reverts to IN_PROGRESS and a wire-up follow-up is required.

**Hard gate (CI):** `scripts/check-rule-i.sh` runs as a blocking CI job (`rule-i` in
`.github/workflows/ci.yml`) after lint, before tests. Exit code 1 = PR blocked. The script scans all
`export` declarations in `packages/*/src` and `apps/*/src` (excluding test files) and fails if any
exported symbol has zero non-test importers anywhere in the repo.

**Exit 3 = no verdict (FOLLOW-842).** Besides 0 (clean) and 1 (violations), the script exits 3 when
it could not run: failed dependency preflight (bash < 4, a `grep` without PCRE `\K`, an unresolvable
repo root) or a scan that produced nothing to check (zero source files discovered, every file
barrel-skipped, or zero symbols parsed). 3 is not a milder 1 and emphatically not a 0. In that state
the script prints **no** `Violations found` line at all, precisely so
`scripts/gh-pr-checks-verified.sh` — which parses this job's log for its baseline — reports an
unparseable log rather than reading a degraded run as a clean 0. Its guards are pinned by
`bash scripts/check-rule-i.sh --self-test`, a hard CI job (`rule-i-gate-self-test`).

Run locally before pushing:

```bash
bash scripts/check-rule-i.sh
```

## Rule J — Mirror-code sync gate for cross-runtime duplicates

**Pattern:** A piece of business logic must run in two runtimes (Cloudflare Worker bundle and
Next.js Edge / Node) that cannot share a workspace package at runtime. The codebase responds by
duplicating the file in both `apps/decision-api/src/lib/<x>.ts` and either `packages/shared/src/` or
`apps/control-plane/src/`. The PR description says "kept in sync" or "byte-identical" but no CI gate
enforces this. The next person to patch one side and forget the other introduces silent divergence
that only manifests when one runtime hits a code path the other doesn't have. Tests on each side
pass independently because they exercise the local copy.

**Evidence:**

- RETRO-003 / TICKET-REORDER-001 (PR #91): `buildReorderDirective()` reorder logic mirrored between
  `apps/decision-api/src/lib/reorder.ts` and `apps/control-plane/src/app/api/adapt/route.ts` with no
  enforcement (FOLLOW-015 wired the Worker side later, but the duplication itself was unaddressed).
- RETRO-005 / FOLLOW-007 (PR #122): `thompsonSample()` / `sampleBeta()` / `updateBanditArm()`
  duplicated between `packages/shared/src/bandit.ts` (canonical) and
  `apps/decision-api/src/lib/bandit.ts` (byte-identical Worker copy). PR description explicitly
  documents the "sync requirement" but ships no CI gate.
- RETRO-005 / FOLLOW-019 (PR #123): cosine math + `buildReorderDirective()` + `affinityScore()`
  duplicated between `apps/decision-api/src/lib/reorder.ts` and
  `apps/control-plane/src/app/api/adapt/route.ts`. Pattern repeats within the same sprint, twice.

**Rule:** Every file in `apps/decision-api/src/lib/` that is documented as a mirror of another file
(canonical source declared in a top-of-file JSDoc comment) MUST be enforced by a CI gate that fails
on byte (or AST) drift. A `MIRROR_FILES` manifest lives at `scripts/mirror-files.json` declaring the
pairs; `scripts/check-mirror-files.sh` reads the manifest, compares the file pairs, and fails CI on
mismatch.

Allowed strategies for keeping the manifest small:

1. **Byte-identical:** strictly identical file contents (fastest check; brittle to JSDoc edits).
2. **AST-equivalent:** compares stripped AST (TypeScript compiler API) — allows JSDoc, comment, and
   whitespace divergence; requires the actual exported symbols + bodies to match.
3. **Snapshot-tested:** both files' exported behavior is exercised by a single shared test fixture
   suite (`packages/shared/__tests__/cross-runtime/*.test.ts`) that imports each and asserts
   byte-identical outputs across N input cases — useful when type signatures differ slightly but
   semantics must match (e.g., Worker has no `Buffer`, Node does).

The PR adding a new mirrored file MUST also add the pair to `mirror-files.json` and choose a
strategy. PRs that touch one side of a mirrored pair MUST touch the other side in the same commit —
failing CI on a one-sided edit is the entire point.

**Hard gate (CI + pre-push):** `scripts/check-mirror-files.sh` runs as a blocking CI job (`rule-j`
in `.github/workflows/ci.yml`) and as a `pre-push` lefthook. Exit code 1 = PR blocked. The manifest
`scripts/mirror-files.json` declares each pair and the comparison strategy (`strip_comments: true`
for byte-equivalent after comment stripping; `strip_comments: false` for function-signature subset
check when the mirror covers helpers only).

**Verification:**

```bash
bash scripts/check-mirror-files.sh
# Must return exit 0
```

## Rule K — No duplicate business logic without a parity gate; decision-grade surfaces fail loud

This rule has two clauses, each independently meeting the ≥2-retro promotion threshold.

### K.1 — Intra-runtime duplicate business logic requires a parity test

**Pattern:** A new module re-implements a statistical or business computation that already exists
elsewhere in the repo — but, unlike a Rule J cross-runtime mirror, both copies run in the SAME
runtime (e.g. two TypeScript modules in different packages, or two API routes within the same app).
Because Rule J's "byte-identical cross-runtime mirror" framing does not apply, no gate catches the
divergence. The two implementations drift in approximation, schema vocabulary, or guard thresholds
and silently report different numbers for the same metric.

**Evidence:** RETRO-008 (third `twoProportionZTest` in `apps/control-plane/src/lib/pilot-stats.ts`
alongside `apps/decision-api/src/lib/ab-assignment.ts:twoProportionZTestPValue`; AND a second
CTA-lift query path in `pilot/cta-lift/route.ts` alongside `analytics/lift/route.ts` with divergent
event-name/column vocabularies), RETRO-002 (consent-vocabulary divergence between AB-001 and
GDPR-004), RETRO-003 (`affinityScore` / `buildReorderDirective` duplicated across two files),
RETRO-005 (duplicate `DetectApiResponse` interface → FOLLOW-044).

**Rule:** Before adding a function/route that computes a metric or business value, grep for an
existing implementation (`twoProportionZTest`, `lift`, `affinityScore`, the metric name). If one
exists you MUST either (a) import/reuse it, or (b) if a separate implementation is genuinely
required (different runtime, different guard semantics), add a shared-fixture parity test asserting
the two agree to a tolerance, and reference the sibling implementation in a top-of-file JSDoc. The
same applies to schema vocabulary: two routes querying the same logical metric MUST use the same
table/column/event-name (the canonical event names live in
`packages/shared/src/schemas/events/index.ts`).

**Verification:**

```bash
# Before adding a metric computation, confirm no sibling exists unparametered:
grep -rn "twoProportionZTest\|<metric-name>" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v "\.test\."
# If two implementations exist, a parity test must reference both.
```

#### Rule K.1 amendment (2026-06-03 — RETRO-030 §4a LG-1 — TS-map ↔ inline-SQL duplication)

**Trigger:** RETRO-030 (FOLLOW-179, PR #190) added a precedence policy that lives BOTH as a
TypeScript constant map (`OUTCOME_CLASS_RANK` + `MANUAL_ADMIN_OFFSET` in
`packages/shared/src/schemas/conversion-label.ts`) AND as a hand-typed SQL `CASE` expression
re-deriving the same ranks inside a Drizzle `onConflictDoUpdate` WHERE clause
(`packages/db/src/upsert-conversion-label.ts`, transcribed twice). The incoming side uses the TS
function; the existing-row side uses the SQL literals. No gate ties them together: adding or
reordering an outcome class can silently mis-rank conflict resolution with green CI. This is a Rule
K.1 instance — but K.1's original framing ("two TypeScript modules in different packages, or two API
routes within the same app") did not enumerate the **one-language-map vs
other-language-inline-query** sub-shape, and Rule J (which only manifests
`apps/decision-api/src/lib/` cross-runtime FILE mirrors) cannot express a TS-map-vs-inline-SQL pair
in `scripts/mirror-files.json`.

**Amendment — K.1 explicitly covers a business rule duplicated across a typed-language map and a
generated query/DSL string in the SAME runtime.** When a precedence/threshold/mapping table is
encoded once as a TS constant and again as inline SQL/DSL (a `CASE`, a `WHERE` literal set, a
hardcoded enum list in a query builder), you MUST either:

1. **Derive the query fragment from the single TS source at runtime** (build the SQL `CASE` by
   iterating the TS map and interpolating via the query builder's `sql`/parameter API) — eliminating
   the second copy entirely; OR
2. **Add a parity test** that executes the generated query path and asserts it agrees with the TS
   source for every key in the map (e.g. all N class × source pairs) against pgmem/Testcontainers.

A hand-typed `ELSE <floor>` in such a CASE is a smell — it silently maps an unknown key to a tier
floor instead of failing; prefer a derived CASE that has no manual fallback. **Verification:** grep
for inline enum/rank literals in query builders that mirror a TS constant —
`grep -rn "CASE WHEN\|THEN [0-9]" packages/ apps/ --include="*.ts" | grep -v node_modules` — and
confirm each such block is either derived from a shared constant or covered by a parity test.

### K.2 — Decision-grade surfaces must fail loud, never fabricate

**Pattern:** A code path swallows an error or empty result and substitutes plausible-looking default
data (a mock, a uniform prior, a neutral response) instead of failing loud. The broken wiring is
hidden because the surface returns HTTP 200 with believable numbers. On a surface that drives a
human or automated decision (a go/no-go dashboard, a bandit reward signal), fabricated data is worse
than an error.

**Evidence:** RETRO-008 (CB-1: `pilot/cta-lift/route.ts` catches ANY ClickHouse failure and serves
`buildMockRaw()` which is engineered to show significant lift — on the pilot's PRIMARY go/no-go
metric), RETRO-006 (CB-1: `postFeedbackPing()` swallows all errors to `console.warn` → bandit sits
at uniform with no signal), RETRO-005 (§4: producer-only half-wires the demo script "silently
degrades"). **Consumer-side completion gap (the producer fails loud but the human surface drops
it):** RETRO-013 (cta-lift `data_source` emitted but `/dashboard/pilot` neither reads it nor checks
`res.ok` → 500 silently nulled), RETRO-015 (inquiry-starts — same, but the field-by-field
`Number(d.x ?? 0)` mapper renders the 500 body as a fabricated all-zeros panel; worse than null).
This is why the rule below requires the field be READ, not merely present.

**Rule:** Distinguish "dependency not configured" (legitimate dev/CI fallback to mock is OK) from
"dependency configured but failed" (MUST surface). When a backing store URL/secret IS set and the
query throws, the handler MUST NOT silently return mock/default data — it must return an error
status (or a 200 carrying an explicit `error`/`degraded`/`data_source` flag) and capture to Sentry.
Any mock/default fallback MUST be observable on the wire (`data_source`/`is_mock` field or header)
so reviewers and go/no-go checks can tell fabricated data from real. **The provenance signal must be
READ, not merely emitted:** the human/automated surface that consumes a fail-loud route MUST (a)
check the response status (`res.ok` / `res.status`) and render a visible error state on a non-2xx
instead of mapping the error body into default/zero values, and (b) read the `data_source`/`is_mock`
field and visibly distinguish mock from real. A producer that fails loud paired with a consumer that
swallows the failure (nulls it, or worse, coerces the error body to plausible zeros) is the same
defect one layer up.

**Verification:**

```bash
# A .catch(() => <fallback>) on a data fetch is a smell — verify it gates on "unconfigured", not "failed":
grep -rn "catch(() =>" apps/ --include="*.ts" | grep -v node_modules | grep -v "\.test\."
# Decision-grade route responses should expose provenance:
grep -rn "data_source\|is_mock\|X-Data-Source" apps/control-plane/src --include="*.ts" | grep -v node_modules
# Consumer side (RETRO-013/015): for each decision-grade fetch in a page/component, confirm it checks
# response status AND reads the provenance field. A .then((r) => r.json()) with no res.ok/res.status
# guard ahead of it is a consumer-side fail-loud swallow:
grep -rn "\.then((r) => r.json())\|\.then((res) => res.json())" apps/control-plane/src/app --include="*.tsx" | grep -v node_modules
grep -rn "data_source" apps/control-plane/src/app/dashboard --include="*.tsx" | grep -v node_modules  # expect ≥1 read per decision-grade page
```

### Rule K.2 amendment (2026-06-13 — RETRO-072 §6 — provenance-enum-completeness + schema-round-trip-test sub-shape)

**Trigger:** Rule K.2 reached its THIRD independent confirming instance of a specific sub-shape with
RETRO-072 (FOLLOW-297, PR #286). The parent rule already requires the degraded/provenance signal be
**observable on the wire** — but three retros across three separate route families show the signal
emitted with **no schema slot**, so a schema-validating consumer rejects the body and the signal is,
in practice, unobservable. And in every case the route test asserted the literal provenance value
**without round-tripping the body through the shared response schema**, so a green test locked in
the drift. Instances: RETRO-058/FOLLOW-277 (`data_source:'fallback'` on `quiz/public-config`, absent
from `QuizPublicConfigResponseSchema`); RETRO-070/FOLLOW-299 (`data_source:'error'` on
`intent/config`, absent from `IntentConfigResponseSchema`'s `['live','mock']`); RETRO-072/FOLLOW-303
(`data_source:'error'` on tracer `sessions/[id]`, absent from `TracerSessionDetailResponseSchema`'s
`['live','mock','clickhouse_unavailable']` — and the new AC2.8/AC2.9 tests assert
`body.data_source === 'error'` with no schema parse, even though the test imports the schema's own
`TracerSessionDetailResponse` type). RETRO-058 and RETRO-070 explicitly logged this as a deferred
"promote on next sighting" amendment candidate; RETRO-072 is that sighting.

**Amendment — every provenance value a route can emit MUST be a member of its response's shared Zod
enum, and a schema-round-trip test MUST assert it:**

```bash
# 1. Enumerate every data_source / provenance literal a route can RETURN (incl. error/500 paths,
#    which are usually bare object literals not typed against the response schema, so tsc is blind):
grep -rn "data_source:\s*'" apps/control-plane/src/app --include="route.ts" | grep -v node_modules
# 2. Enumerate the members of the response schema's provenance enum:
grep -rn "data_source: z.enum(" packages/shared/src/schemas --include="*.ts"
# 3. EVERY literal from step 1 MUST be a member of the enum from step 2. A literal with no slot
#    (e.g. 'error'/'fallback' on the 500 path) = HALF_WIRE_C — the consumer's safeParse rejects the
#    degraded body and the signal is unobservable. Fix: add the value to the enum (preferred) OR
#    document deliberate status-only branching (the consumer reads HTTP status, ignores data_source).
# 4. A route test that asserts `body.data_source === '<value>'` is NOT sufficient — it pins the
#    producer in isolation and is blind to the drift. The test MUST round-trip the body:
#    `<ResponseSchema>.safeParse(body)` and assert success for EVERY emittable value (incl. error).
```

**Amendment rationale:** This is a fourth verification step on the same parent rule, not a new rule,
because it shares K.2's root ("the degraded signal must be observable") — enum membership is the
schema precondition for observability, and the round-trip test is the verification that the producer
and the validating consumer agree. A literal the schema rejects is observable-on-paper but
invisible-in-practice. Priority: P2 by default (contract bug, not a crash); P1 when the consuming
surface is decision-grade and would silently coerce the rejected body to a plausible default.

**Evidence for this amendment:** RETRO-058 §3 (FOLLOW-277), RETRO-070 §3 CHECK-B / §4b CB-1
(FOLLOW-299), RETRO-072 §3 CHECK-B / §4b CB-1 / §4c TG-2 (FOLLOW-303).

### Rule K.2 amendment (2026-06-28 — RETRO-135 §6 — fire-and-forget HTTP-rejection observability sub-shape)

**Trigger:** Rule K.2's parent framing covers AWAITED read paths that can "fail loud" by returning
an error status. But a whole class of K.2 surfaces CANNOT throw to a caller: **fire-and-forget
`fetch` sinks** — analytics writes / event publishes that callers `void` and never await. For these,
`.catch()` is the developer's instinctive error handler — but `fetch` **resolves** (does not reject)
on an HTTP 4xx/5xx, so `.catch()` catches ONLY network-layer failures (DNS, connection-refused,
timeout) and is **completely blind to HTTP-level rejection** (auth Code 516, unknown column, missing
topic, quota). A bare `await fetch()` with no `res.ok` check has the same hole. The
configured-but-rejecting store/topic then fails with **zero log, zero Sentry, zero alert** — the
ESC-031 failure mode. Instances (2 independent backend contexts): **RETRO-118 §4 CB-1** —
`logDecisionAsync` `.catch`-only `console.error` on the **ClickHouse** HTTP interface (named as the
mechanism that made the migration-ordering hazard silent; remediated by FOLLOW-425/PR #374); and
**RETRO-135 §4b CB-1/CB-2** — the SAME shape in two **Redpanda REST-proxy** publishers
(`publishAbAssignmentEvent` @ `apps/control-plane/src/lib/ab-events.ts:72`,
`publishDescriptionRequested` @ `apps/control-plane/src/app/api/adapt/description/route.ts:111`).
The parent rule's verification greps (`catch(() =>`, `.then((r)=>r.json())`) match NEITHER a bare
`await fetch()` nor a fire-and-forget `.catch()`, so the sub-shape was invisible to K.2's own audit.

**Amendment — a fire-and-forget `fetch` sink (one whose result is `void`ed / never awaited) MUST
treat a non-ok HTTP response as an error, not just a network rejection.** Its fail-loud obligation
is satisfied ONLY by BOTH: (1) a `.then((res) => { if (!res.ok) { … capture … } })` that checks
`res.ok` and captures to Sentry (or the configured observability sink) with structured tags, AND (2)
a `.catch()` that captures the network leg with a distinguishing tag (`kind:'network'` vs
`kind:'insert_rejected'`). A bare `await fetch()` with no `res.ok` check, OR a `.catch()`-only
handler, on a fire-and-forget sink is a silent configured-store/topic failure — fix it before merge.
The reference implementations are `logDecisionAsync`
(`apps/control-plane/src/app/api/adapt/route.ts` post-FOLLOW-425) and `pushToClickHouse`
(`apps/ingest/src/clickhouse-producer.ts`, which returns a structured result and — since FOLLOW-986
— treats `written_rows` rather than a bare 2xx as the success criterion, because ClickHouse answers
200 to an INSERT that produced no rows). **The second example used to be `pushToRedpanda`
(`apps/decision-api/src/lib/redpanda-producer.ts:102`); that file was deleted by ADR-0022 /
FOLLOW-988 stage A, so the citation was re-pointed rather than left dangling — a rule whose example
does not exist teaches nothing (Rule AX).** Priority: P1 when the sink carries a decision-grade or
attribution-grade signal (decision logging, bandit reward, A/B assignment, description enqueue); P2
for pure telemetry.

**Verification:**

```bash
# A fire-and-forget sink with a .catch()-only handler is blind to HTTP rejection — verify each also checks res.ok:
grep -rn "void .*\.catch(\|)\.catch((err" apps/ --include="*.ts" | grep -v node_modules | grep -v "\.test\."
# A bare `await fetch(` inside a void-returning publisher with no nearby res.ok is the same hole:
grep -rn "await fetch(" apps/ --include="*.ts" | grep -v node_modules | grep -v "\.test\."
# For each hit that is a fire-and-forget WRITE/PUBLISH sink, confirm a `res.ok`/`response.ok` check
# AND a Sentry.captureException on BOTH the non-ok-then and the .catch paths exist in the same function.
```

**Evidence for this amendment:** RETRO-118 §4 CB-1 (ClickHouse `logDecisionAsync`, FOLLOW-425),
RETRO-135 §4b CB-1/CB-2 / §6 (Redpanda `publishAbAssignmentEvent` + `publishDescriptionRequested`,
FOLLOW-426). 2 independent backend contexts — threshold met.

**Verification strengthening (2026-06-28 — RETRO-137 §6).** The grep above proved insufficient on
two counts: (a) it scans only `apps/`, so the SDK ingest beacon `dispatchEvents`
(`packages/sdk/src/core/events.ts:85`) was invisible to it; and (b) per-hit human triage let the
four-ticket family remediation (FOLLOW-425/426/427/428) walk past 2 still-blind sinks. So the
verification is upgraded to (1) **scan `apps/` AND `packages/`**, and (2) **check against an
enumerated registry, not a re-derivation.** Evidence: RETRO-135 §6 (the amendment itself recorded
the parent grep was blind to this sub-shape — count 1) + RETRO-137 §4b (2 survivors found
post-sweep, one outside the `apps/`-only scope — count 2).

```bash
# Widened scope — fire-and-forget fetch sinks live in packages/ too (SDK beacons):
grep -rn "await fetch(\|void .*\.catch(\|)\.catch((err" apps/ packages/ --include="*.ts" \
  | grep -v node_modules | grep -v "\.test\."
```

**Known fire-and-forget HTTP sink registry (keep current; audit each for `res.ok` + observability on
BOTH the non-ok-then and the network paths).** Hardened: `logDecisionAsync`
(`apps/control-plane/.../adapt/route.ts`, FOLLOW-425), `publishAbAssignmentEvent`
(`apps/control-plane/src/lib/ab-events.ts`, FOLLOW-426), `publishDescriptionRequested`
(`apps/control-plane/.../adapt/description/route.ts`, FOLLOW-426), `logLlmCallAsync`
(`apps/control-plane/src/lib/llm-gateway.ts`, FOLLOW-427), `writeDsrAuditLog`
(`apps/control-plane/src/app/api/dsr/_clickhouse.ts`, FOLLOW-428). Reference-correct (observability

- retry): `pushToRedpanda` / `pushToClickHouse` (`apps/ingest`, `apps/decision-api`). Open
  (RETRO-137): `redisSet` (`apps/decision-api/src/lib/reorder.ts:128`, FOLLOW-429), `dispatchEvents`
  (`packages/sdk/src/core/events.ts:85`, FOLLOW-430 — browser, debug-log not Sentry). A new
  fire-and-forget `fetch` sink added in any PR MUST be added to this registry with its `res.ok`
  posture, or the PR is incomplete.

### Rule K.2 amendment (2026-07-27 — RETRO-226 §6 — fail-CLOSED-value laundering / never-refuse-a-write sub-shape)

**Trigger:** Rule K.2's parent framing covers a dependency that fails and is then SWALLOWED into a
plausible success. This sub-shape is the mirror image: the dependency failure IS logged (K.2's
emission half conforms), but the guard that caught it returns a **plain boolean fail-closed
default** — so "I could not determine this" becomes indistinguishable from "I determined this is
true" — and every caller then renders that value to a client as a **statement of fact** with a
non-retryable 4xx. Four sightings of one helper, `isTreatedAsExternalBrand`
(`apps/control-plane/src/lib/brand-identity.ts:290-314`, `catch → return true`), across four
surfaces and three PRIOR numbered retros, each fixed by its own still-open ticket and none by a
rule:

- **RETRO-222 §4a LG-2 → FOLLOW-674** — the consent POST answers 400 _"FIRST_PARTY_TENANT_ID is not
  configured and more than one tenant exists"_ when the tenant-count read merely **failed**.
  Count 1.
- **RETRO-224 → FOLLOW-686** — the same swallowed read makes the consent GET answer 409
  `brand_identity_not_provisioned`, _"a false statement"_, in a handler where the sibling DB failure
  15 lines above correctly returns `500 { data_source: 'db', degraded: true }`. Count 2.
- **RETRO-225 §4a LG-1 → FOLLOW-695** — the malformed-env branch gives that same false 400 a third
  reaching branch. Count 3.
- **RETRO-226 §4a LG-2 (trigger, PR #631/FOLLOW-684)** — a qualitative escalation, not a fourth
  repetition: the laundered unknown now guards a **WRITE**.
  `POST /api/v1/consent/platform-registration` answers **422 `consent_text_hash_fabricated`** —
  permanent semantics, nothing written — for **Estalara's own first-party tenant** whenever the
  count probe throws (reachable today) or `FIRST_PARTY_TENANT_ID` is unset with ≥2 tenant rows (a
  state `docs/runbooks/BRAND_PROVISIONING.md:316-320` documents as expected). A real consent the
  visitor gave is **discarded**, with a message that is false for that tenant and a remediation that
  cannot fix it — in the same PR whose AC-3 refused to discard a consent on a _guess_.

**Amendment — a predicate that fails CLOSED MUST NOT launder the unknown, and MUST NOT refuse a
write:**

1. **Tri-state, not boolean.** A shared predicate whose answer can be reached by catching a
   dependency failure MUST distinguish `true` / `false` / `indeterminate` (a discriminated union, or
   a throw). Returning the fail-closed value as a bare boolean is the defect; the `console.error`
   next to it is not a mitigation, because the caller cannot read a log.
2. **Fail-closed DIRECTION is scoped by CONSEQUENCE, not by surface.** Fail-closed is correct for a
   guard that refuses to SERVE (a GET), demands more input (a 400 asking for an explicit value), or
   degrades to a safe default. It is FORBIDDEN as the sole basis for **refusing or discarding a
   write** — an `indeterminate` on a write path returns a **retryable 5xx** with
   `data_source: 'db', degraded: true`, never a 4xx, and never a "provably wrong" accusation.
3. **No 4xx may assert a fact the code did not establish.** If the branch is reachable via a caught
   error, the message must state what FAILED, not what the fail-closed value implies. Same for alarm
   tags: do not tag a request `unprovisioned_external` when the real state is "unknown".
4. **A gate added to a write path is audited for BOTH its false-negative and its false-positive
   direction** in the retro/PR. "It fails closed" is a completed argument only when the false
   positive costs nothing; when it costs a user's submitted data, it is a P1 finding.

**Amendment rationale:** this is a fifth verification step on the same parent rule, not a new
letter, because it shares K.2's root — a configured-but-failed dependency must not be turned into a
confident answer. K.2 governs the _emission_ of the failure; this amendment governs the _value_
substituted in its place and what a caller is allowed to assert on it. Deliberately NOT filed as a
new letter, per the RETRO-135 precedent (fire-and-forget sub-shape) and the RETRO-224
anti-duplication discipline. Distinct from **Rule AJ** (an emitted signal must have a consumer — the
emission axis), **Rule AH/AI** (prose truth), **Rule S** (test mechanics), **Rule AE** (call-shape
enumeration). Priority: **P1** when the laundered value gates a write, a payment, a consent or a
deletion; **P2** when it only produces a false message on a read path.

**Verification:**

```bash
# 1. Enumerate every predicate that manufactures its return value inside a catch:
grep -rn -A3 "} catch" apps/ packages/ --include="*.ts" | grep -v node_modules | grep -v "\.test\." \
  | grep -E "return (true|false|\[\]|null|0);"
# 2. For EACH hit, list its callers and classify the consequence of the fail-closed value:
#    grep -rn "<predicateName>" apps/ packages/ --include="*.ts" | grep -v "\.test\."
#    - caller refuses to SERVE / asks for more input  -> allowed
#    - caller refuses, discards or rolls back a WRITE -> VIOLATION (P1): the caller must receive
#      `indeterminate` and answer a retryable 5xx instead.
# 3. Every 4xx message reachable from such a predicate must be grep-checked for asserted facts:
grep -rn "more than one tenant exists\|not provisioned\|provably" apps/ --include="route.ts" \
  | grep -v node_modules
#    Each hit must be unreachable from a caught dependency error, or reworded to name the failure.
```

**Evidence for this amendment:** RETRO-222 §4a LG-2 (FOLLOW-674), RETRO-224 (FOLLOW-686), RETRO-225
§4a LG-1 (FOLLOW-695) — 3 PRIOR numbered retros, 3 separate open tickets, 1 shared helper — promoted
by RETRO-226 §6 (Pattern P-11) on the write-refusing escalation (FOLLOW-698). The promoting retro
does not inflate the count.

<!-- Rule K.2 amendment (fail-CLOSED-value laundering / never-refuse-a-write sub-shape) added 2026-07-27 —
RETRO-226 §6 (Pattern P-11). Priors, all verified at their cited lines and all still OPEN as tickets:
RETRO-222 §4a LG-2 -> FOLLOW-674 (consent POST 400 asserting "more than one tenant exists" on a failed read,
count 1); RETRO-224 -> FOLLOW-686 (consent GET 409 brand_identity_not_provisioned on the same failed read,
15 lines below a sibling that correctly 500s, count 2); RETRO-225 §4a LG-1 -> FOLLOW-695 (malformed-env branch,
third reaching branch of the same false 400, count 3). Promotion trigger = RETRO-226 §4a LG-2 / FOLLOW-698:
PR #631 put the same laundered value in front of a WRITE, so the 4th sighting DESTROYS a submitted consent
instead of merely stating a falsehood — and does so for Estalara's own first-party tenant, in a state the
repo's own runbook (BRAND_PROVISIONING.md:316-320) documents as expected, contradicting the same PR's AC-3
principle that a consent must not be discarded on a guess. NOT A NEW LETTER, deliberately: the root is shared
with K.2 (a configured-but-failed dependency must not become a confident answer) — same adjudication RETRO-135
made for the fire-and-forget sub-shape; checked against AJ (emission has a consumer — different axis, and
RETRO-226 §3 HW-2 files that separately), AH/AI (prose), S (tests), AE (call shapes) before minting. The
promoting retro does not inflate the count (adjudication shared with AA/AB/AC/AD/AE/V/Q/AG/AH/AI/AJ). Remedy
tickets: FOLLOW-698 (the write path + the helper's tri-state), coordinating with the three open priors so all
four surfaces land ONE semantics. -->

## Rule L — Verify the production install/snippet path PRODUCES the config a consumer reads — a test that injects the value is not evidence

**Pattern:** A feature wires an SDK/runtime _consumer_ of a config value (an `<script>`
data-attribute, an env var, a per-tenant schema field) and ships with green CI because the unit/e2e
tests and/or the wizard inject the value directly — but the real production
install/snippet/generator path never PRODUCES it. The consumer is correct; the producer is absent.
Net effect is identical to a dead feature: the value is always `undefined` in prod, so the code path
silently never runs. This is a HALF*WIRE_C that Rule I's zero-importer CI gate does NOT catch,
because the consuming symbol \_is* imported and used — only the production producer is missing.

**Evidence:** RETRO-009 (`inquiry_submit_selector` not threaded into `setupObservers` at the SDK
init call site; the unit test injected it directly), RETRO-010 (§5a — `data-decision-url` not
emitted by the manual `+layout.svelte` install; the wizard `buildSnippet` fix did not cover the
manual path), RETRO-011 (`data-inquiry-submit-selector` emitted by NO snippet generator; the e2e
fixture hand-writes it, so green CI masked a dead wire even after FOLLOW-097 "fixed" the SDK
consumer).

**Rule:** When a feature adds a runtime consumer of a config value, you MUST also verify — and add a
test asserting — that the production path that builds the install snippet / sets the env var /
renders the `<script>` tag actually EMITS that value (sourced from the activated tenant schema /
config store, not a literal). A test that injects the value into the consumer directly proves only
"if present, it works" — it is NOT evidence the install path supplies it. Both the wizard/generated
path AND any manual install path (e.g. a hand-written `+layout.svelte`) must emit it; if a manual
path exists, add an explicit AC to the install ticket. Treat a consumed-but-never-produced config
field as P0 when a launch ticket depends on it.

**Verification:**

```bash
# For each data-* attribute / config field the SDK consumer reads, confirm a NON-TEST producer emits it:
grep -rn "data-inquiry-submit-selector\|data-decision-url\|data-feedback-events" apps/ packages/ \
  --include="*.ts" --include="*.tsx" --include="*.svelte" \
  | grep -v node_modules | grep -v "\.test\." | grep -v "\.spec\." | grep -v "/e2e/" | grep -v "//"
# The snippet generator must read the value from the schema store, not omit it:
grep -rn "buildSnippet\|inquiry_submit_selector" apps/control-plane/src --include="*.ts" --include="*.tsx" \
  | grep -v "\.test\."
```

## Rule N — Compliance docs that disclose user-facing behavior MUST match shipped code before their go-live gate is satisfiable

**Pattern:** A compliance/legal document (DPIA, Privacy Notice, consent banner copy, ROPA) asserts a
specific user-facing behavior or string, but the SDK/app does not implement it — so a data-subject-
facing disclosure is either absent or, worse, present-but-inaccurate. A doc-only PR that "closes"
the gap by shipping the _prose_ without the _behavior_ makes the disclosure a false statement to
data subjects and turns the linked go-live QA gate into an unexecutable checkbox.

**Evidence:** RETRO-018 §3/§6 (DPIA mandated a consent-banner disclosure string the SDK never
rendered — string ABSENCE), RETRO-019 §3/§4/§6 (DPIA §13.2 + Privacy Notice + the FOLLOW-128 banner
string promise a "90-day cross-session `localStorage` identifier deleted on Deny/Withdraw," but the
SDK stores a tab-lifetime `sessionStorage` fingerprint and never `removeItem`s on deny — behavior
ABSENCE + inaccurate disclosure). Parent shape reached 2 occurrences.

**Rule:** When a compliance doc, DPIA section, Privacy Notice paragraph, or consent-banner string
asserts a concrete user-facing behavior (retention period, storage location/API, rotation cadence,
deletion-on-withdrawal, a visible disclosure sentence), verify a real non-test SDK/app symbol
implements it BEFORE the doc's go-live gate is treated as satisfiable. A doc-only PR introducing
such an assertion MUST emit an implementation FOLLOW with a before-go-live `depends_on`, and its
retro MUST confirm the disclosed behavior exists byte-for-byte (90-day vs tab-lifetime; localStorage
vs sessionStorage). A pre-flight QA gate that references a key or behavior the code does not produce
is a disguised P0 bug, not a checklist item — file it as a bug.

**Verification:**

```bash
# Storage claims (retention / deletion / storage API) must resolve to real keys + removeItem on withdraw:
grep -rn "localStorage\|sessionStorage\|removeItem\|setItem" packages/sdk/src --include="*.ts" \
  | grep -v "\.test\." | grep -v "\.spec\."
# Each disclosure SENTENCE the DPIA/Privacy Notice mandates must appear in the banner COPY constant:
grep -rn "disclosure13_1\|disclosure13_2\|disclosure" packages/sdk/src/ui/consent-banner.ts | grep -v "\.test\."
# If a doc says "deleted if you withdraw consent," there MUST be a removeItem on the onDenied/withdraw path:
grep -rn "removeItem" packages/sdk/src --include="*.ts" | grep -v "\.test\."   # zero hits + such a claim = HALF_WIRE_C, P0
```

### Rule N amendment (2026-05-28 — RETRO-023 §6 — cadence-mismatch sub-shape)

**Trigger:** Rule N reached its FOURTH consecutive confirming instance with RETRO-023 (FOLLOW-139,
PR #164). The new sub-shape is **cadence mismatch within an otherwise-wired disclosure**: PR #164
implemented a `localStorage` cross-session identifier, but the disclosure says "rotates monthly" /
"every 30 days" while the code performs single-step 90-day TTL replacement. Five disclosure surfaces
(banner copy ×3 locales, DPIA §13.2 mitigations paragraph, Privacy Notice §3) all carry the
inaccurate cadence claim, and the `consent-banner.test.ts` regex pins `/monthly/i` so the inaccurate
wording is locked in by a green test. This sub-shape is not enumerated by the existing Rule N
verification block (which covers presence/absence of producers and removeItem calls). Per the Rule H
amendment precedent in this file, an amendment is appropriate when the parent rule reaches its
fourth confirming instance and a new, specific verification step is identifiable.

**Amendment — extend Rule N verification with the cadence-claim check:**

```bash
# Rotation/cadence claims in disclosures must match the actual TTL/rotation constant in code.
# 1. Find every cadence claim in disclosure surfaces:
grep -rn "rotate\|every 30\|every 7\|every 24\|monthly\|weekly\|daily\|hourly" \
  packages/sdk/src/ui/consent-banner.ts \
  docs/compliance/dpia.md \
  docs/compliance/PRIVACY_NOTICE_TEMPLATE.md
# 2. Find the matching constant(s) in the SDK:
grep -rn "TTL_MS\|_MS = .*\* 24 \*\|day_bucket\|ROTATION_INTERVAL" packages/sdk/src --include="*.ts" \
  | grep -v "\.test\."
# 3. The disclosed cadence (parsed from step 1) must equal the constant's value (parsed from step 2).
#    A claim of "rotates monthly" with a 90-day TTL constant = HALF_WIRE_C, P0
#    (data-subject-facing accuracy in a GDPR Art. 6(1)(f) disclosure).
# 4. Any consent-banner.test.ts regex that pins the disclosure WORDING must also be reconciled —
#    a green test on "monthly" wording does NOT validate the cadence; it only locks the sentence.
```

**Amendment rationale:** The cadence-mismatch sub-shape is a third verification step on the same
parent rule, not a new rule, because it shares the same root cause (doc asserts user-facing behavior
the code does not perform) and the same priority calculus (P0 when on a GDPR lawful-basis
disclosure). A future fifth occurrence on a fundamentally different axis (e.g. a disclosed UI
element that does not exist) would warrant a separate Rule O.

**Evidence for this amendment:** RETRO-023 §3 HALF_WIRE_C / §4a LG-1 / §4d DG-1/DG-2/DG-3 / §6.

## Rule O — Migration journal monotonicity + recency

**Pattern:** A Drizzle migration's `_journal.json` entry carries a `when` timestamp that is either
(a) less-than-or-equal-to a previously-applied entry's `when` (monotonicity violation), or (b)
year-drifted by drizzle-kit (e.g. 2025 instead of 2026, ~365 days delta vs the SQL file's commit
date). Drizzle's pg-core migrator skips any entry whose `folderMillis` is `<=` the last applied
entry's `created_at` — silently — and `packages/db/scripts/migrate.ts` (before FOLLOW-149) always
printed "Migrations applied successfully." regardless of how many entries it skipped. Net effect:
the migration was never applied to production but every bookkeeping signal said it was. The next
deployment that read the new column got an "undefined column" Postgres error in tenant-facing
traffic.

**Evidence:**

- 2026-05-18 — commit `c92da81` repaired entries 6, 8, 9, 10, 11 and added missing 3, 4, 5, 7, 12
  (first instance: drizzle-kit emitted 2025-stamped `when`s while the local clock was on 2026; the
  unrepaired journal would have silently no-op'd those migrations).
- 2026-05-28 — FOLLOW-149 repaired entries 15 (`0015_pilot_frozen`, `when` was `1748304000000` ≈
  2025-05-27 vs actual commit `b83e6c0` on 2026-05-25) and 16 (`0016_pilot_inquiry_selector`, `when`
  was `1748736000000` ≈ 2025-06-01 vs actual commit `19d11d2` on 2026-05-28). Verified in prd:
  `pilot_frozen` column was ABSENT from `tenants` table at session start despite a green
  `pnpm db:migrate` run in a previous FOLLOW-106 wave.
- Second-line root cause: silent-success in `packages/db/scripts/migrate.ts` (always printed success
  even with 0 applied). Combined with bug 1, this hid the gap from every reviewer. The same script
  now reports applied/before/after/pending counts and exits non-zero with a loud warning when
  `pending > 0 && applied === 0`. See FOLLOW-149 PR.

**Rule:** Every entry in `packages/db/migrations/meta/_journal.json` MUST satisfy:

1. **Strict monotonic `when`** — `entries[i].when > entries[i-1].when` for every `i`. Drizzle
   silently skips out-of-order entries; no automated downstream catches it.
2. **Within MAX_DELTA_DAYS (7) of the SQL file commit date** —
   `|entries[i].when/1000 - git_log_first_add_unix_seconds(entries[i].tag + '.sql')| <= 7 * 86400`.
   Fallback: file mtime for newly-added (uncommitted) entries. This catches drizzle-kit's year-drift
   bug at PR time.
3. **One-to-one with SQL files** — `set(entries[*].tag) === set(basename(*.sql) without .sql)`. No
   orphan entries, no orphan SQL files.

**Verification (CI gate + pre-push lefthook):** `scripts/check-migration-journal.sh` runs as a
blocking CI job (`migration-journal` in `.github/workflows/ci.yml`) on every push. The script
includes a `--self-test` mode that exercises four in-memory fixtures (monotonic-violation,
year-drift-violation, orphan-entry, known-good); CI invokes the self-test first so the gate's own
correctness is provable on every run. Run locally before pushing:

```bash
bash scripts/check-migration-journal.sh             # validate the real journal
bash scripts/check-migration-journal.sh --self-test # verify the gate itself works
```

**Companion guard (runtime, not gate):** `packages/db/scripts/migrate.ts` (the runner invoked by
`pnpm db:migrate`) reports the actual applied/before/after/pending counts and exits with code 2 when
`pending > 0 && applied === 0`. This is the trap-killer for the same defect once it has escaped CI
(e.g. drift introduced by manual journal edits).

**How to apply when you generate a new migration:**

1. Run `pnpm db:generate`.
2. Inspect the new entry in `_journal.json` — verify `when` is in the expected year, AFTER the
   previous entry's `when`. If drizzle-kit emitted a 2025 (or other past-year) value, patch it to
   `Math.floor(Date.now())` and push. Run `bash scripts/check-migration-journal.sh` locally before
   committing.
3. Commit the new SQL file AND the journal change in the same commit so the CI gate sees the
   matching git-add date for the SQL file.

## Rule P — Check docs + repo for prior art BEFORE proposing a ticket, solution, or next step

**Pattern:** Re-opening, re-proposing, or re-deciding a topic that was already discussed,
implemented, or planned — because the proposal was formed without first checking the record. Causes
never-ending decision loops, duplicate tickets, and re-execution of finished work (mess).

**Evidence:** CEO directive 2026-06-01 (direct mandate; not retro-promoted).

**Rule:** Before creating any ticket, proposing a solution, planning a next step, or designing an
approach, FIRST search the record for the topic: `backlog/FOLLOW_UPS.md`, `backlog/QUEUE.md`,
`backlog/sprint-*/`, `docs/adr/`, `docs/MASTER_DESIGN.md`, `backlog/RETROSPECTIVES.md`, and the
relevant code/fixtures. Then:

- already DECIDED → cite the ADR/decision and build on it; do not re-litigate.
- already IMPLEMENTED → reference the code; do not rebuild.
- already PLANNED (a FOLLOW/ticket exists) → extend/continue that ticket; do not create a duplicate.

Only propose genuinely new work. This is the proposal-time complement to Operating Principle 1
(Master_Design = SoT) and Rule I (wired-or-dead).

**Verification:**

```bash
# Before filing FOLLOW-NNN or proposing X, confirm it isn't already covered:
grep -rniE "<topic keywords>" backlog/ docs/ --include='*.md' | grep -viE '\.next'
```

---

## Rule R — A persisted intent-state mutation must be idempotent across the rehydrate boundary (gate it behind `!intentStateRehydrated` or apply only the delta)

**Pattern:** A new intent-engine prior/signal mutates `currentIntentState` and is persisted to
sessionStorage via the FOLLOW-176 wire (`persistIntentState`, reached through `onIntentUpdate`).
Because the next listing page in the same tab REHYDRATES that persisted state, any such mutation
that is NOT gated behind `!intentStateRehydrated` (or otherwise made idempotent) re-applies on top
of the already-folded-in state on every cross-listing navigation — re-perturbing the resumed
archetype and, for boosts, compounding without bound. The author "wires the signal" but does not
account for the rehydrate boundary, so the signal silently double-counts across pages.

**Evidence (≥2 retros):**

- **RETRO-032 (FOLLOW-216 / PR #217)** — the FOLLOW-207 referrer + device-type priors ran
  unconditionally on a rehydrated state (`index.ts` :383/:390 were ungated relative to the
  archetype-hint gate at :350), re-nudging the resumed archetype and inflating `signal_count` +1 per
  navigation.
- **RETRO-037 (FOLLOW-190 / PR #225)** — the dwell-time boost (`applyDwellSignal`) is persisted via
  `onIntentUpdate → persistIntentState` (`index.ts:464,515-516`) and re-accrued on the rehydrated,
  already-boosted distribution on every cross-listing hop; no `!intentStateRehydrated` gate, no cap.

**Rule:** When adding any intent-state mutation that flows into `persistIntentState` (any new prior,
boost, or signal applied inside `init()` or its timers/callbacks), you MUST do ONE of:

- gate it behind `!intentStateRehydrated` (symmetric to the archetype-hint / FOLLOW-207 gates), OR
- make it idempotent under rehydration by persisting the accrued contribution in the IntentState
  envelope and applying only the DELTA on resume, OR
- explicitly decide and COMMENT that the mutation is intended to re-apply every navigation, with a
  bounded per-session cap so it cannot compound without limit.

The accompanying test MUST exercise the rehydrate→re-init path through the `_initForTest()` seam
(Rule Q) and assert the resumed archetype/confidence is not perturbed/compounded — a pure-function
helper test of the mutation does NOT satisfy this (the bug lives in the index.ts wiring, not the
helper).

**Verification:**

```bash
# Every state mutation reached by onIntentUpdate/persistIntentState inside init() must sit under a
# !intentStateRehydrated gate OR carry an explicit "re-apply intended + capped" comment.
grep -nE "currentIntentState = apply" packages/sdk/src/index.ts
grep -n "intentStateRehydrated" packages/sdk/src/index.ts
```

### Rule R amendment (2026-06-10 — RETRO-048 §6/§11 — verification grep was blind to `adapt.ts`-resident idempotency)

**Sub-shape (count 2):** the Rule R verification grep above is `index.ts`-shaped
(`currentIntentState = apply…`) and is BLIND to an idempotency mechanism implemented INSIDE
`packages/sdk/src/core/adapt.ts:fetchDirectives`. The chat-intent prior demonstrated this TWICE: the
ORIGINAL FOLLOW-101 violation lived in `adapt.ts` (in-memory `_chatPriorAppliedSessionId` guard,
RETRO-047 §5d — count 1), AND the FOLLOW-252 FIX also lives entirely in `adapt.ts` (the persisted
`chatPriorApplied` producer at `adapt.ts:791` + guard at `:780`, RETRO-048 — count 2). The original
grep returns ZERO hits for the whole chat-prior chain, so neither the bug nor its fix would be
surfaced by it. A mutation folded into `currentIntentState` via a `FetchDirectivesResult`
DESTRUCTURE at the `index.ts` call-site (`index.ts:589` `currentIntentState = updatedIntentState`) —
rather than a literal `currentIntentState = apply…` — is invisible to the original grep.

**Amended verification (run BOTH the index.ts grep above AND this adapt.ts scan):**

```bash
# Idempotency mechanisms that live inside fetchDirectives/adapt.ts must ALSO be checked: any
# `apply*Prior`/`apply*Signal` fold that feeds persistIntentState must be guarded by a PERSISTED
# flag in the IntentState envelope (survives rehydrate), NOT only an in-memory module variable.
grep -nE "apply[A-Za-z]+(Prior|Signal)\(" packages/sdk/src/core/adapt.ts
grep -nE "persistIntentState\(" packages/sdk/src/core/adapt.ts
# For each such fold, confirm a PERSISTED idempotency flag (e.g. chatPriorApplied) is read BEFORE
# the fold AND written INTO the persisted envelope (not an in-memory `let _xApplied…` alone):
grep -nE "let _[A-Za-z]+Applied" packages/sdk/src/core/adapt.ts   # in-memory-only guard = SMELL
grep -nE "\.chatPriorApplied|Applied: true as const" packages/sdk/src/core/adapt.ts  # persisted flag = OK
```

**Rule (amended):** an idempotency guard for a `persistIntentState`-feeding mutation MUST be a flag
PERSISTED in the IntentState envelope (so it survives the rehydrate boundary), NOT an in-memory
module variable. An in-memory guard alone (`let _xApplied: string | null`) is a SMELL — it resets on
hard reload while the persisted state + any 24h shadow key survive, re-folding the mutation. If an
in-memory guard is kept as a fast-path, the PERSISTED flag MUST be the authoritative `&&`-primary
guard and the accompanying test MUST drive `_initForTest()` TWICE on the SAME sessionStorage (no
clear between calls) and assert the resumed distribution is not re-perturbed.

---

## Rule S — A change made to one verb/branch of a symmetric set MUST be applied to ALL siblings, at the SAME completeness AND verification tier

**Pattern:** When a feature, fix, store-coverage, or compliance behavior belongs to a SET of sibling
endpoints/branches that are supposed to behave symmetrically (e.g. the three DSR verbs
access/erase/portability; both arms of a producer/consumer pair; every locale; every logging branch;
variant AND holdout), a change applied to ONE sibling silently leaves the others with the identical
gap. The dangerous second-order shape: even when the headline behavior IS carried to all siblings,
the VERIFICATION TIER (real-SQL/integration test vs mock) or the OPERATOR SIGNAL (a completeness/
unverifiable advisory) is applied to the template sibling but NOT mirrored to the others — so the
fix "looks symmetric" but the siblings are under-proven or signal completeness differently. This
recurs because the author reasons about the one verb in front of them, not the symmetric set.

**Evidence (≥2 retros):**

- **RETRO-044 (FOLLOW-184 / PR #233) §4a LG-1 + §6** — FOLLOW-184 fixed the
  `lead_id`-vs-`session_id` identifier-namespace gap on DSR _erase_ (added `durable_lead_id` + Pass
  B) but left the symmetric disclosure verbs `access` (Art. 15) and `portability` (Art. 20) unwired
  — they never read `conversion_labels` at all. The GAP instance (count 1). RETRO-044 §6 set the
  explicit promotion condition: "Promote a symmetric-verb completeness rule only if a SECOND
  distinct instance appears."
- **RETRO-045 (FOLLOW-246 / PR #242) §4c TG-1 + §4a LG-1** — FOLLOW-246 DID wire access +
  portability to read both namespaces, but at a LOWER tier than the erase verb it mirrored: erase
  has a real-SQL PGlite harness (`dsr-crm-erasure.test.ts`, 12 cases); the disclosure verbs got
  mock-only Drizzle- chain tests (TG-1) — exactly the PGlite/route test RETRO-044 §4c had scoped
  into FOLLOW-246's ACs. AND erase emits a `crm_erasure_status` completeness advisory while the
  disclosure verbs emit none (LG-1). The RESIDUAL-ASYMMETRY instance (count 2) — the same shape
  recurred WITHIN the fix that closed the first instance. Threshold met.

**Rule:** When you change behavior that belongs to a symmetric set of verbs/branches/arms/locales:

- Enumerate the full sibling set FIRST (in DSR: access, erase, portability; generally: every
  endpoint/branch/locale that shares the contract). State it in the PR description.
- Apply the change to EVERY sibling, or explicitly justify per-sibling why one is exempt.
- Match the VERIFICATION TIER across siblings: if one sibling has a real-SQL/integration/PGlite test
  for the behavior, every sibling gets the equivalent — a mock-layer test for sibling B does NOT
  satisfy parity with a real-SQL test on sibling A.
- Match OPERATOR/USER SIGNALS across siblings: if one sibling emits a completeness/unverifiable/
  error advisory, the siblings emit the equivalent (or justify the asymmetry in docs).
- The retrospective for any such change MUST diff each sibling against the template sibling on EVERY
  axis (behavior, SQL/contract coverage tier, operator signals, error surfacing), not just the
  headline feature.

**Verification:**

```bash
# DSR exemplar: all three verbs must read conversion_labels on both namespaces (Pass A + Pass B).
grep -ln "conversionLabels" apps/control-plane/src/app/api/dsr/{access,erase,portability}/route.ts
# Verification-tier parity: every verb with a Pass B SELECT/DELETE needs a real-SQL test, not mocks.
grep -rln "conversion_labels\|conversionLabels" apps/control-plane/src/app/api/dsr/*/route.test.ts \
  packages/db/src/__tests__/dsr-crm-*.test.ts
# Signal parity: if erase emits crm_erasure_status, check the disclosure verbs for an equivalent.
grep -n "crm_erasure_status\|crm_disclosure_status" apps/control-plane/src/app/api/dsr/*/route.ts
```

### Rule S amendment (2026-06-25 — RETRO-112 §6 — call-site-inventory-comment for shared guarded helpers)

**Trigger:** Rule S reached its THIRD confirming instance with RETRO-112 (FOLLOW-363 / PR #351). The
sibling set here is not endpoints/verbs but the call sites of a single shared classifier helper:
`classifyFromProbabilities(probs, currentArchetype?)` in `packages/sdk/src/core/intent.ts`. PR #329
(FOLLOW-344, RETRO-097) added the `SWITCH_MARGIN` hysteresis guard and threaded the
`currentArchetype` argument into 5 of its 13 call sites, silently leaving 8 unguarded — including
two ONGOING, high-frequency paths (`applyDwellSignal` on a `setInterval` tick,
`applyListingViewRate` on every 2nd+ `listing.viewed`) that flipped the archetype on a near-tie
every tick: exactly the churn the guard was opened to stop. FOLLOW-363 closed the two ongoing
siblings AND added a 13-call-site inventory comment on the helper. The sub-shape not covered by the
parent Rule S verification block: when the "symmetric set" is the call sites of a SHARED helper,
there is no per-endpoint file to diff — the auditable artifact must live AT the helper definition.

**Amendment — when you add a guard, branch-discriminator, or new required argument to a SHARED
helper with ≥3 call sites, the same PR MUST add (or update) a call-site inventory comment on the
helper that enumerates EVERY call site and labels each as guarded vs intentionally-exempt (with the
exemption rationale, e.g. cold-start / one-shot / free-classify).** This makes the symmetric set
auditable at one place, so the next person adding a guard cannot silently leave siblings unguarded.
A guard threaded into SOME call sites without the inventory comment is a Rule S violation even if CI
is green.

**Verification:**

```bash
# 1. Enumerate every call site of the shared helper (the symmetric set):
grep -rn "classifyFromProbabilities(" packages/sdk/src --include="*.ts" | grep -v "\.test\."
# 2. The helper definition MUST carry an inventory comment listing ALL sites with guarded/exempt labels.
#    A guard argument passed to only SOME sites with no inventory comment = Rule S violation (green CI notwithstanding).
```

**Evidence for this amendment:** RETRO-097 §... (FOLLOW-344 / PR #329 — 5 of 13 sites guarded, 8
left unguarded incl. 2 ongoing high-frequency paths; count 2 on the shared-helper sub-shape),
RETRO-112 §6 (FOLLOW-363 / PR #351 — closed the 2 ongoing siblings + added the 13-site inventory
comment; count 3).

### Rule S amendment (2026-08-07 — RETRO-250 §6 armed, RETRO-259 §6 discharged — a deferred sibling's justification MUST be a filed FOLLOW-NNN, never prose)

**Trigger:** Rule S bullet 2 says _"Apply the change to EVERY sibling, **or explicitly justify
per-sibling why one is exempt**"_ and does not say what form the justification takes. RETRO-250 §6
armed this amendment on PR #680, where the exemption for nine sibling scripts was discharged as
**three scoped, dated tickets** (FOLLOW-842/843/844) instead of a paragraph — the conversion of
_unknown_ into _tracked work_ being the thing worth codifying (count 1). Five subsequent PRs (#685,
#686, #687, #688, #689) complied without the rule, which is why RETRO-254 and RETRO-258 declined to
promote: every failure to discharge the arming was a failure **by compliance**.

**Count 2 is a non-compliance with measured harm** (RETRO-259 §6, PR #690 / FOLLOW-816). That PR
delivered a six-process local environment and deferred a seventh — `apps/control-plane`, the
**only** writer of ClickHouse `adaptation_decisions`
(`apps/control-plane/src/app/api/adapt/route.ts:482`) — in **prose**, in the PR body, as _"out of
scope here"_, with no ticket. The deferral never reached the durable artefact
(`docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md`), whose §6 instead attributes that table's zero
row-count to an unrelated ClickHouse defect. **FOLLOW-819 AC(3) requires an `adaptation_decisions`
row from that substrate**, so a dependent P1 now carries an acceptance criterion the substrate
cannot satisfy, and nothing in the record says why. A second instance in the same PR (§8's ownership
deferred to FOLLOW-822, when FOLLOW-853 owns the defect) is recorded as corroboration only — one
sighting per PR, per RETRO-122.

**Amendment — when a sibling of the set your change defines is left out, its justification MUST be a
filed `FOLLOW-NNN` (or an existing ticket cited by number) in the SAME PR. A prose deferral — "out
of scope here", "left for later", "owned elsewhere" — does not satisfy Rule S bullet 2, even in a PR
description that is otherwise exemplary.** Two corollaries, both from the count-2 instance: (a) the
number must be cited in the **durable artefact** (runbook / module docblock / stub), not only in the
PR body, because the PR body is not what the next operator reads; (b) citing the **wrong** ticket is
a mis-graded deferral and fails this amendment the same way prose does — the cited ticket must
actually own the deferred work.

**Verification:**

```bash
# 1. Every deferral phrase in a PR body/runbook must sit within one line of a FOLLOW/ESC number.
gh pr view <N> --json body -q .body |
  grep -nEi 'out of scope|left for later|not covered here|deferred|owned elsewhere' |
  grep -vE 'FOLLOW-[0-9]+|ESC-[0-9]+'          # any hit = Rule S violation
# 2. Same sweep over the durable artefacts the PR added (corollary (a)):
grep -rnEi 'out of scope|deferred|left for later' <new-or-changed docs> |
  grep -vE 'FOLLOW-[0-9]+|ESC-[0-9]+'
```

**Evidence for this amendment:** RETRO-250 §6 (PR #680 / FOLLOW-827+830 — nine sibling scripts,
exemptions discharged as FOLLOW-842/843/844; count 1, ARMED), RETRO-259 §6 (PR #690 / FOLLOW-816 —
the control-plane sibling deferred in prose, never filed, and FOLLOW-819 AC(3) left unbuildable;
count 2, DISCHARGED on the armed clause (b)). **No new letter was minted: the arming states that
Rule S already owns the territory.** Rule count unchanged at 43.

---

## Rule T — A green pre-commit hook is NOT a typecheck pass; type/tooling regressions escape the format-only hook and surface CI-only — run `tsc --noEmit` on touched packages before declaring ready

**Pattern:** An edit introduces a TYPE regression (most often a test-tooling signature change — e.g.
a Vitest v2 `vi.fn<...>()` generic-arg form that compiled under v1 but errors under v2) that the
local pre-commit hook CANNOT catch, because the hook runs `prettier --check` + ESLint + commitlint
but NOT `tsc --noEmit` (typecheck is a CI-only gate, kept out of the hook for speed). The author
sees a green pre-commit and assumes the change is clean; the type error only appears in CI. A
confounding second failure often co-occurs: a format error (trailing space / blank line) that
prettier WOULD strip but only if the edited file is re-staged (`git add`) — a hook validating a
stale staged blob reports "unchanged," so one edit yields two distinct CI failures from two distinct
gates.

**Evidence:** RETRO-047 §4b CB-1 (FOLLOW-101, PR #256 — Vitest v2 `vi.fn` type-arg → CI-only
typecheck failure + stale-stage prettier failure) and RETRO-049 §4b CB-1 (FOLLOW-102, PR #257 — the
SAME Vitest v2 `vi.fn` family, same two-gate split). Same root cause two consecutive retros;
threshold of 2 met. No defect SHIPPED in either case (CI caught both), so this is a PROCESS rule,
not a correctness gate.

**Rule:** Treat a green pre-commit hook as evidence of FORMAT + LINT correctness ONLY — never as a
typecheck pass. Before marking a ticket READY_FOR_REVIEW (and before any PR that touches
`.ts`/`.tsx`, especially test files or shared return types), run `tsc --noEmit` (or the package's
`typecheck` script / `turbo run typecheck --filter=<changed>`) locally on every package you touched.
When a test-runner major version changes (Vitest v1→v2, etc.), re-typecheck all test files that use
the runner's typed mock/spy APIs (`vi.fn<>`, `vi.mocked`, `MockInstance`) — overload signatures
commonly tighten across majors. Re-`git add` every file after every edit so the hook validates the
working-tree blob, not a stale staged one (this is the format half of Rule B, restated for the
stale-stage shape). This rule does NOT mandate adding `tsc --noEmit` to the pre-commit hook itself —
that trades hook speed and is a devops/DX decision to be escalated, not auto-codified here.

**Verification:**

```bash
# Before declaring ready, typecheck every touched package (NOT covered by the format-only pre-commit hook):
pnpm -r --filter '...[origin/main]' run typecheck   # or: turbo run typecheck --filter=<changed-pkg>
# After a test-runner major bump, find typed-mock call sites that may break across the major:
grep -rn "vi\.fn<\|vi\.mocked\|MockInstance" packages/*/src apps/*/src --include="*.test.ts" --include="*.test.tsx"
# Confirm no file was committed with a stale staged blob (working tree must equal index for touched files):
git diff --name-only            # must be empty for files you intend to commit
```

---

## Rule U — Gating / ON-OFF / source-of-truth state MUST live in a typed column, never a JSONB blob key; when a typed column supersedes a blob key, ELIMINATE the blob key (strip-on-write + backfill), do not merely annotate it

**Pattern:** A multi-key JSONB config blob (e.g. `tenants.quiz_config`) holds a key that expresses
ON/OFF, gating, or source-of-truth state (e.g. `enabled`, a trigger threshold, a feature flag).
Later a typed column is introduced as the real SoT (e.g. `tenants.quiz_enabled`), OR the key's
consumer is removed — but the orphaned blob key is left in place. Across consecutive tickets it gets
ANNOTATED ("this key is legacy, read the column instead") or PARTIALLY removed (the reader is
dropped, the writer survives; or the writer is dropped, the persisted value survives), never fully
ELIMINATED. The result: "is X on?" has two stores that can silently diverge, and each per-ticket fix
closes one key or one limb while the blob-level decay continues — because no single fix establishes
the policy. Annotation closes the read-side mislead but NOT the write-side divergence channel: if
any write path still merges client input into the blob (`.set({ blob: updated })`), a stale or
legacy key value can still be persisted and contradict the typed column.

**Evidence (≥2 retros — count 3 on the same `tenants.quiz_config` blob):**

- **RETRO-049 §4a LG-2 + §5d (FOLLOW-102)** — `tenants.quiz_enabled` typed column added as SoT, but
  the legacy `quizConfig.enabled` JSONB key was left written-by-`POST /api/quiz/config` and
  read-by-the-freeze- guard. "Two stores express quiz on/off, they can diverge." (count 1)
- **RETRO-050 §4a LG-1 + §5d (FOLLOW-257)** — same blob: `trigger_after_n_listings` left
  written-by-dashboard-read-by-nothing after the SDK consumer was removed. "The JSONB blob is
  accumulating write-only keys… partial dead-letter store." (count 2)
- **RETRO-051 §4a LG-2 + §5d (FOLLOW-263)** — same blob: `enabled` read-by-nothing after the freeze
  guard repointed to the typed column; "continues to accrete write-only / read-only-mismatched
  keys." (count 3)
- **RETRO-052 §4a LG-1 (FOLLOW-265) + RETRO-053 §5d (FOLLOW-264)** — `trigger_after_n_listings`
  removed (FOLLOW-264) and `enabled` ANNOTATED orphaned but not removed (FOLLOW-265 AC4); the blob
  can still persist a divergent `enabled` via `POST /api/quiz/config`. Threshold long exceeded; the
  recurring "annotate/partial-remove, never set the blob policy" behavior is why this rule is
  promoted now rather than filing a 4th per-key follow-up alone.

**Rule:**

- ON/OFF, gating, feature-flag, freeze-relevant, or any source-of-truth state belongs in a TYPED
  column (`boolean`/`enum`/etc.), NOT a JSONB blob key. A JSONB blob is for non-gating, non-SoT
  configuration (UX settings, presentation, free-form metadata) only.
- When a typed column SUPERSEDES an existing blob key, or a blob key's last consumer is removed,
  ELIMINATE the key end-to-end in the SAME change (or an immediately-filed follow-up that the retro
  tracks): (a) stop writing it — strip it on write (`delete` before `.set()`, or a Zod
  `.strip()`/`.omit()` on the request schema so it cannot re-enter); AND (b) backfill — remove the
  key from existing rows via a migration or documented data-fix so no stale divergent value
  survives. An ANNOTATION ("legacy, ignored") is NOT a close — it fixes the read-side mislead but
  leaves the write-side divergence channel open.
- A retro for any change that touches such a blob MUST grep EVERY key of the blob (not just the one
  the ticket names) for writer/reader parity, and classify each orphaned key as eliminate-now or
  tracked-follow-up — never silently leave it.

**Verification:**

```bash
# Find blob keys that still have a writer but no live (non-test) reader — candidate orphans:
grep -rn "quizConfig\|quiz_config" apps/control-plane/src packages --include="*.ts" --include="*.tsx" \
  | grep -v __tests__ | grep -v ".test."
# Confirm no write path merges a gating key back into the blob (look for .set({ <blob>: ... }) writers):
grep -rn "\.set({[^}]*quizConfig" apps/control-plane/src --include="*.ts"
# After eliminating a key, confirm it is gone from the type, the Zod schema, AND any persisted default:
grep -rn "<keyName>" apps/control-plane/src packages --include="*.ts" --include="*.tsx" | grep -v __tests__
```

---

## Rule W — A ClickHouse migration that touches a column in the table's `ORDER BY` / `PRIMARY KEY` MUST be validated at apply-time against the production sort key before merge; `RENAME COLUMN` / `MODIFY COLUMN` / `DROP COLUMN` on a key column is forbidden in place (resolve via table rebuild + backfill + swap)

**Pattern:** A ClickHouse migration compiles, lints, and passes the smoke gate, then FAILS at
apply-time because it targets a column that is part of the table's `ORDER BY` (or `PRIMARY KEY`)
expression. ClickHouse forbids `RENAME COLUMN` (error on key column), `MODIFY COLUMN` (error 524
`ALTER_OF_COLUMN_IS_FORBIDDEN`), and `DROP COLUMN` on a sort-key column. The migration merges green
because the gate validates a WEAKER condition (SQL parses / a no-op applies) than the real runtime
apply against a table that carries the production sort key. The fix is always a no-op stub plus a
handler workaround (omit the column, rely on the DEFAULT), which leaves a degenerate/dead column in
the sort key — the actual correction (a table rebuild with the right `ORDER BY`) is deferred. The
root error is usually upstream: the original `CREATE TABLE` chose a key column that the writer never
populates correctly (e.g. a UUID surrogate when the producer emits a String fingerprint).

**Evidence (≥2 retros — K.3.6 `intent_events` lineage):**

- **FOLLOW-286 / PR #279 (folded into RETRO-059 §8)** — migration 0015 first shipped a
  `RENAME COLUMN` on `intent_session_id` (an ORDER BY key column → forbidden), corrected to
  `ADD COLUMN`, which then shipped `ADD COLUMN … NOT NULL` (syntax error 62). Two apply-time
  failures caught only post-merge. (count 1)
- **FOLLOW-287 / PR #281 → remediated by PR #282 (RETRO-060 §4b CB-1)** — migration 0016 shipped
  `MODIFY COLUMN intent_session_id String` on the same ORDER BY key column → error 524
  `ALTER_OF_COLUMN_IS_FORBIDDEN`. PR #281 merged GREEN; PR #282 rewrote 0016 to `SELECT 1` and
  omitted the column from the INSERT. (count 2) — threshold met; promoted at RETRO-060.

**Rule:**

- A migration that `RENAME`s, `MODIFY`s the type of, or `DROP`s a column named in the target table's
  `ORDER BY` / `PRIMARY KEY` is FORBIDDEN in place — it will fail at apply-time. Resolve such a
  change via a table rebuild: `CREATE TABLE …_v2 ENGINE=MergeTree ORDER BY (<correct key>)`,
  backfill, atomic rename/swap.
- CI MUST validate migrations at APPLY-TIME against an ephemeral ClickHouse instance seeded with the
  production DDL (the real `ORDER BY` key), not merely parse/lint them — a parse-only or
  no-op-applies gate does not catch error 524/62.
- A pre-merge lint SHOULD parse `infra/clickhouse/migrations/*.sql` and fail on `RENAME COLUMN` /
  `MODIFY COLUMN` / `DROP COLUMN` targeting any column named in the table's `ORDER BY` /
  `PRIMARY KEY` clause.
- Choose the `ORDER BY` key at `CREATE TABLE` time to be the ACTUAL write/read key the producer
  emits and consumers join on — key columns are effectively immutable, so a surrogate-key mistake is
  expensive to undo.
- A retro for any CH-migration PR MUST verify the migration was applied against the production sort
  key (not just that CI was green) before recording it as closed.

**Verification:**

```bash
# Flag forbidden ALTERs on key columns (manual review trigger):
grep -rniE "RENAME COLUMN|MODIFY COLUMN|DROP COLUMN" infra/clickhouse/migrations/*.sql
# For each table, list its ORDER BY key columns, then confirm no migration ALTERs one of them:
grep -rniE "ORDER BY" infra/clickhouse/migrations/*.sql
# Confirm the migrations smoke gate applies against a real CH instance carrying the prod DDL,
# not a parse-only / no-op check (inspect the CI workflow):
grep -rn "clickhouse" .github/workflows/
```

---

## Rule X — Every SDK→control-plane fetch site MUST build its URL through the shared `buildEndpoint(decisionApiUrl, path)` helper, and at least one test MUST assert the resolved URL against the REAL production install-snippet base (`${CONTROL_PLANE_URL}/api`), never a hand-picked bare-host fixture

**Pattern:** An SDK fetch consumer constructs its request URL by RE-DERIVING the `decisionApiUrl`
base-URL FORM inline (`${decisionApiUrl}/api/<path>`, `${decisionApiUrl}/<path>`, etc.) and gets the
form wrong relative to the value the SOLE production install-snippet producer actually emits. The
shipped install snippet (`buildSnippet` in `DetectionPreview.tsx`) emits
`data-decision-url="${CONTROL_PLANE_URL}/api"` = `https://admin.estalara.com/api` — i.e. the base
ALREADY carries `/api`. A consumer that prepends `/api` again produces a double-`/api` URL
(`…/api/api/<path>`) that 404s in production; a consumer that assumes a bare host omits the `/api` a
different snippet expects. CI stays green because every test fabricates a BARE-HOST fixture
(`https://admin.estalara.com`) instead of the real `host + /api` snippet string — so the suite
exercises a base the production producer never emits, and the prod 404 is invisible. This is
DISTINCT from Rule L (which covers a MISSING `data-*` attribute the snippet never emits): here the
attribute IS present and IS read — its base-URL FORM is mis-parsed. The fix is always to centralize
URL construction in one helper with one documented base-URL convention, plus a test asserting the
final URL against the real snippet base.

**Evidence (≥2 retros — the K.3.6 SDK-fetch wave):**

- **RETRO-074 / FOLLOW-268-sdk / PR #290 (§4b CB-1, §4e)** — `fetchIntentWeights` built
  `${decisionApiUrl}/api/intent/config` against the snippet base `https://admin.estalara.com/api` →
  `…/api/api/intent/config` → 404 → SDK silently used internal defaults; server intent weights NEVER
  applied for any `buildSnippet`-onboarded tenant. Traced and named; recorded count 1 on the
  base-URL-FORM axis with an EXPLICIT promote-on-confirmation condition ("if a SECOND fetch site
  ships a base-URL-form mismatch, or the quiz-config sibling is confirmed independent, promote a
  Rule requiring a shared `buildEndpoint` + a prod-snippet-base test"). (count 1)
- **RETRO-075 / FOLLOW-305 / PR #291 (§4b CB-1/CB-2, §6)** — the fix confirmed the mismatch was NOT
  one inherited bug but FOUR independent pre-existing sites each having re-derived the convention
  wrong (`fetchIntentWeights` → `/api/intent/config`, `fetchQuizConfig` → `/api/quiz/public-config`,
  `deriveFeedbackUrl` → `/api/adapt/feedback`, `deriveQuizCompletionUrl` → `/api/quiz/completion`,
  all formerly double-`/api`). Every one was masked by a bare-host test fixture. (count 2 —
  RETRO-074's promote condition met) — threshold met; promoted at RETRO-075. The remedy that landed
  IS this rule: the `buildEndpoint(decisionApiUrl, path)` helper
  (`packages/sdk/src/core/endpoint.ts`)
  - TG-1 prod-URL-form tests asserting `…/api/intent/config` (single `/api`) against the
    `https://admin.estalara.com/api` snippet base.

**Rule:**

- Every SDK call that builds a URL from `config.decisionApiUrl` (or a value derived from it —
  `feedbackUrl`/`quizCompletionUrl` derivations included) MUST construct it via the shared
  `buildEndpoint(decisionApiUrl, path)` helper. NO fetch site may inline `${decisionApiUrl}/…`
  template-literal concatenation — that re-derives the convention and is exactly what drifted four
  times.
- The `decisionApiUrl = host + /api` convention is documented in ONE place (the helper's module
  docstring) and the helper appends ONLY the route-specific path. A new endpoint adds a `path`,
  never a base-URL form.
- At least one test per fetch site MUST drive the function with the REAL production snippet base
  (`${CONTROL_PLANE_URL}/api` = `https://admin.estalara.com/api`, the literal `buildSnippet` emits)
  and assert the EXACT resolved URL (single `/api`, no `/api/api`). A bare-host fixture
  (`https://admin.estalara.com`) is NOT acceptable as the sole base — it is the form that masked all
  four bugs. Such a prod-form test MUST be one that would FAIL if the `/api` were doubled.
- A retro for any SDK PR that adds or changes a `decisionApiUrl` fetch site MUST re-run the
  completeness grep from the SYMBOL (every `decisionApiUrl` URL construction), not the ticket's
  enumeration, and confirm each site routes through `buildEndpoint` before recording the wire
  closed.

**Verification:**

```bash
# (1) Every decisionApiUrl URL construction must go through buildEndpoint — flag any inline join:
grep -rn 'decisionApiUrl' packages/sdk/src --include='*.ts' | grep -v '__tests__' \
  | grep -E '\$\{[^}]*decisionApiUrl[^}]*\}/' | grep -v 'buildEndpoint'   # → expect ZERO hits
# (2) Confirm buildEndpoint has a non-test importer at every fetch site:
grep -rln 'buildEndpoint' packages/sdk/src --include='*.ts' | grep -v 'endpoint.ts'
# (3) At least one test must assert against the production snippet base (host + /api), not bare host:
grep -rn "admin.estalara.com/api'" packages/sdk/src/__tests__ | grep -iE 'toBe|expected|EXPECTED_URL'
# (4) The producer the tests must match — verify the snippet still emits host + /api:
grep -rn 'data-decision-url' apps/control-plane/src --include='*.tsx' | grep -v '\.test\.'
```

---

## Rule Y — A docstring/test-header that cites a named test or file as proof a guard runs in CI MUST be verified against that file: the cited file must actually perform the asserted check, or the citation is forbidden

**Pattern:** A comment — a constant's docstring, a test-file header, a schema annotation — points at
a NAMED test or file as evidence that some invariant is "caught in CI" / "asserted" / "guarded", but
the cited file does NOT perform that assertion. Two sub-shapes, both observed: (1) the cited file
**does not exist** (or asserts something else, e.g. the constant against itself rather than the
cross-package counterpart); (2) the cited file exists and the guard exists, but **the guard lives in
a DIFFERENT file** than the one cited. In both cases a future reader trusts the prose, edits one
side of a duplicated/coupled contract freely, and the silent drift the comment promised would be
caught is not — because the named guard either is absent or is somewhere the reader never looks.
This is the DOCUMENTATION-POINTER cousin of Rule L / Rule K.2-round-trip / Rule Q (which govern the
test MECHANICS — fabricated fixtures, missing round-trips, mirrored-test blind spots); Rule Y
governs the CITATION: a claim that a specific named artifact proves an invariant must be true of
that artifact.

**Evidence (≥2 retros):**

- **RETRO-084 / FOLLOW-327 / PR #312 (§4d DG-1)** —
  `packages/shared/src/schemas/intent-weights.ts:155-160` docstring claimed
  "`intent-weights.test.ts` asserts the two agree ... so drift is caught in CI" for the
  `DEFAULT_INTENT_WEIGHTS` ↔ SDK `BASE_PRIOR` cross-package drift. False: that test asserted the
  shared constant against ITSELF and never imported the SDK; the test header further deferred the
  real check to `packages/sdk/src/__tests__/intent-weights-drift.test.ts` — a file that DID NOT
  EXIST. (count 1; recorded as the over-claimed-verification meta-pattern, held below threshold.)
- **RETRO-089 / FOLLOW-331 / PR #317 (§4d DG-1)** — the FOLLOW-331 fix corrected the
  `intent-weights.ts:155-160` docstring AND created the real drift guard (closing the RETRO-084
  instance end-to-end), but INTRODUCED a fresh instance one file over:
  `packages/shared/src/schemas/intent-weights.test.ts:28-30` now claims the
  `ARCHETYPE_KEYS ↔ ARCHETYPE_NAMES` parity guard "runs in
  `packages/sdk/src/__tests__/intent-weights-drift.test.ts`" — but that file never imports
  `ARCHETYPE_NAMES`/`ARCHETYPE_KEYS`; the real parity guard is in
  `packages/sdk/src/__tests__/intent-weights.test.ts:784-793` (FOLLOW-305). Wrong-pointer sub-shape.
  (count 2 — independent sighting in a distinct file; the PR that fixed sighting 1 produced
  sighting 2. Threshold met → promoted at RETRO-089.) Filed FOLLOW-338.

**Rule:**

- Any comment that names a test, test-file, or any artifact as proof that an invariant is asserted /
  guarded / "caught in CI" MUST be true of that artifact at the time it is written: the cited file
  MUST exist AND MUST perform the cited assertion (import the cited symbols, compare the cited
  values). A citation that defers to a not-yet-written file is forbidden — write the guard first, or
  describe the gap as a gap (e.g. "NO automated guard yet — see FOLLOW-NNN"), never as a guarantee.
- When a guard is RELOCATED, MOVED, or split, every docstring/header that cites it MUST be updated
  to the new location in the SAME change. Fixing the guard without re-pointing its citations is half
  a fix.
- A retro for any PR that touches a "drift guard" / "parity guard" / "asserted in CI" docstring MUST
  open the cited file and confirm it performs the cited assertion before recording the documentation
  gap closed. Re-pointing a docstring is NOT closed until the new target is verified to contain the
  guard.

**Verification:**

```bash
# (1) Find docstrings/headers that cite a guard file as CI proof:
grep -rn -iE "caught in CI|asserts the two|drift is caught|parity guard|runs in .*test" \
  packages --include='*.ts' | grep -v node_modules
# (2) For each cited file, confirm it imports the symbols it claims to reconcile.
#     Example for the intent-weights chain (must each return >0 hits in the CITED file):
grep -n 'ARCHETYPE_NAMES' packages/sdk/src/__tests__/intent-weights.test.ts        # real key↔name guard
grep -n 'BASE_PRIOR' packages/sdk/src/__tests__/intent-weights-drift.test.ts        # real value-drift guard
# (3) A cited file that returns ZERO hits for the symbols it supposedly reconciles is a Rule Y violation.

# (4) VERIFICATION REPAIR 2026-08-05 (RETRO-250 §6, on RETRO-249 §6's armed condition). Steps 1-3
#     grep `packages --include='*.ts'` ONLY, while this rule's TEXT has covered "any doc" since the
#     2026-06-26 broadening — so run verbatim they report a false citation in docs/**, in a runbook,
#     in CONVENTIONS_PATCH.md itself, or in a config comment CLEAN. Widen the corpus, always:
grep -rn -iE "asserts|verifies|guarded|caught in CI|enforces|compares|diffing|pinned by|proven by" \
  docs/ CONVENTIONS_PATCH.md CLAUDE.md .claude/ backlog/HANDOFFS.md --include='*.md' \
  | grep -viE 'RETROSPECTIVES|FOLLOW_UPS|QUEUE|STATUS'
# (5) For every hit that names a script, test, module, config key, migration or column: OPEN THAT
#     ARTIFACT and confirm it performs the cited behavior TODAY. A citation that was true when
#     written and was falsified by a later change is a Rule Y violation now (and a Rule AI failure
#     in the PR that falsified it) — the two rules fire together and neither excuses the other.
# (6) On any PR that changes HOW a named gate/script/guard decides something, this grep is
#     MANDATORY over the corpus in (4), not optional: the sibling set of a corrected CLAIM is
#     enumerated exactly as Rule S requires for a corrected BEHAVIOR.
```

**Amendment (2026-06-26, RETRO-126 §6 — SCOPE BROADENING, not a new letter):** Rule Y was promoted
on the literal sub-shape "a docstring/test-header cites a NAMED TEST/FILE as proof a guard RUNS IN
CI." Three confirming instances across distinct retros established that the SAME failure mode recurs
for ANY named-artifact-cited-as-fact, outside the CI-guard mechanic — so Rule Y now governs **any
named symbol, file, module, migration-number, or schema-column cited as fact in a doc / JSDoc / test
header / schema annotation: the cited artifact MUST exist AND MUST perform / contain / be the
behavior it is cited for, at the time the citation is written.** Sub-shapes now in scope (all
observed): (i) a named CONSTANT cited as living in a file where it does not exist (or no longer
exists — e.g. a symbol DELETED in an earlier PR whose doc citations were not propagated, an
Operating Principle 2 violation); (ii) a named MODULE/FILE cited as performing a behavior it does
not (e.g. a const-only module cited as a function that "returns `[]`"); (iii) a named MIGRATION
NUMBER / SCHEMA COLUMN cited as the provenance of a change when the real artifact is a different
number/column. The operative discipline is unchanged and now applies to all sub-shapes: **when a
symbol is removed, renamed, or relocated, grep its name across ALL doc, JSDoc, and test files in the
SAME change and fix/justify every site — a citation that survives its referent's removal is
forbidden.** A retro for any PR touching a doc/JSDoc/test-header that names a
symbol/file/module/migration/column as fact MUST open the source and confirm the cited artifact
exists and does the cited thing before recording the gap closed.

**Amendment evidence (≥2 PRIOR retros + the promoting retro):**

- **RETRO-115 §4d DG-1 / FOLLOW-410 (PRIOR, broadened-sub-shape count 1)** — "migration 0017" cited
  in three sites (`route.ts:938`, `route.ts:1349`, `directives.ts:137` + dist twin) as the
  `tier→page_context` rename provenance, when the rename is migration **0018**. RETRO-115 explicitly
  RECOMMENDED this exact "Rule Y scope-broadening amendment (extend from 'CI-guard test-header' to
  'any provenance citation: migration number / constant home-file / schema column')."
- **RETRO-119 §6 / FOLLOW-398 (PRIOR, broadened-sub-shape count 2)** — `SIDEBAR_SHOW_THRESHOLD`
  cited in `MASTER_DESIGN.md:728/2409` + `adapt-floor.ts:25` JSDoc + `follow-343.test.ts:207` as a
  live const in `index.ts`; it was a REAL const (TICKET-037) DELETED by PR #340/FOLLOW-375
  (2026-06-23) whose citations were not propagated. RETRO-119 pre-registered: "If a 2nd
  doc-citation-of-nonexistent -symbol (outside the CI-guard sub-shape) is flagged in a future retro,
  consider a Rule Y amendment."
- **RETRO-126 §4d DG-1 (the promoting retro, broadened-sub-shape count 3)** — the FOLLOW-398 fix for
  the RETRO-119 instance itself introduced `MASTER_DESIGN.md:728` "`adapt-floor` returns `[]`,"
  citing a const-only module (`adapt-floor.ts`, no function) as performing the array-drop that
  actually lives at `index.ts:720-724`. Filed FOLLOW-412.

### Rule Y verification repair (2026-08-05 — RETRO-250 §6, on RETRO-249 §6's armed condition)

**This repairs the rule's own Verification block. It is NOT a promotion, NOT a scope change, and no
letter was minted** — the rule's TEXT has covered "any named symbol, file, module … cited as fact in
a doc" since the 2026-06-26 broadening; only its check was still scoped to the pre-broadening corpus
(`packages --include='*.ts'`). Precedent for repairing a control rather than re-promoting a pattern:
**RETRO-246 §6**, which added tier 0 and `.claude/` to Rule AI's Verification block on a single
demonstration, for the identical reason.

**Trigger, pre-authorised by name.** RETRO-249 §6 armed this: _"the next retro that finds a
Rule-Y-shaped citation in a `docs/**` or config file which Rule Y's own Verification grep would miss
cites RETRO-249 §6 as prior 1 and repairs the Verification block in place."_ RETRO-250 §4d DG-1 is
that finding, in two artefacts — counted as **one** sighting per RETRO-122's count-inflation
discipline:

- `docs/AGENT_WORKFLOW.md:193-197` cites `scripts/gh-pr-checks-verified.sh` as verifying `Rule I`
  _"by diffing the PR run's own 'Violations found: N' job-log line"_ and as _"mirroring the shape
  FOLLOW-821 uses"_. Since PR #680 (2026-08-05) the script compares violating-**symbol sets**; the
  count is a printed diagnostic. The named artefact does not perform the cited behaviour.
- `CONVENTIONS_PATCH.md` Rule A `:29-32` cites the same script as comparing against _"`main`'s own
  live violation **count**"_. Same defect, inside this file.

**Prior sighting (RETRO-249 §6, count 1):** `ropa.md` / `dpia.md` citing a `beforeSend` scrubber and
a "CI check on scrubber config" that did not exist (FOLLOW-739), and
`docs/runbooks/git-hooks.md:41-70` citing `commitlint.config.cjs` as enforcing a scope list and a
subject-length minimum that its shadowed `rules` block never applies (FOLLOW-837). Both are `.md`;
both were reported clean by steps 1-3 run verbatim.

**What changed:** steps (4)-(6) above. The corpus is now `docs/`, `CONVENTIONS_PATCH.md`,
`CLAUDE.md`, `.claude/` and `backlog/HANDOFFS.md` — the documents that instruct — and the ledgers
(`RETROSPECTIVES`/`FOLLOW_UPS`/`QUEUE`/`STATUS`) are excluded because a dated record of what was
true when written is not a citation. Step (6) states the obligation that both trigger instances
failed: when a PR changes how a named gate decides something, the sibling set of the CLAIM is
enumerated exactly as Rule S requires for the sibling set of a BEHAVIOR.

<!-- Rule Y VERIFICATION REPAIRED 2026-08-05 — RETRO-250 §6 (no new letter, no promotion, no scope change: the rule's TEXT already covered "any doc" since the 2026-06-26 broadening; only its Verification grep was still pre-broadening and reported docs/**-located instances CLEAN). Armed by RETRO-249 §6 with a named condition (prior 1: FOLLOW-739's ropa/dpia scrubber citation + FOLLOW-837's git-hooks.md commitlint citation, both .md, both reported clean by steps 1-3 verbatim). Discharged by RETRO-250 §4d DG-1 (docs/AGENT_WORKFLOW.md:193-197 + CONVENTIONS_PATCH.md Rule A:29-32 both still citing gh-pr-checks-verified.sh as a COUNT diff after PR #680 replaced it with a symbol-set comparison; two artefacts counted as ONE sighting per RETRO-122) -> FOLLOW-847. Precedent for a Verification repair on a single demonstration: RETRO-246 §6's Rule AI repair (tier 0 + .claude/ added to AI's grep). CHECKED BEFORE EDITING: Rule AI also fires on the same two sentences and its OWN Verification step 1 greps docs/ + CONVENTIONS_PATCH.md, so run verbatim AI CATCHES this PR -> that is a compliance failure against an adequate control, no AI amendment (RETRO-248's Rule P adjudication, same logic). Rule S fires on the un-enumerated claim siblings and Rule AO on the corrective edit's scope; both adequate as written. -->

<!-- Rule Y AMENDED 2026-06-26 — RETRO-126 §6 (SCOPE BROADENING, no new letter): from "named test/file cited as proof a guard runs in CI" to "any named symbol/file/module/migration-number/schema-column cited as fact." Evidence ≥2 PRIOR retros that INDEPENDENTLY recommended/pre-authorized this amendment — RETRO-115 §4d DG-1/FOLLOW-410 (migration-number "0017" vs "0018", broadened count 1, explicit amendment recommendation) + RETRO-119 §6/FOLLOW-398 (nonexistent-const SIDEBAR_SHOW_THRESHOLD, broadened count 2, pre-registered 2nd-sighting trigger) — plus the promoting RETRO-126 §4d DG-1 (const-only module cited as "returns []", broadened count 3, filed FOLLOW-412). RETRO-119's 2nd-sighting trigger exceeded; ≥2-prior-retro threshold firmly met. Count-inflation discipline (RETRO-122) honored: this is a confirming-instance amendment to an ALREADY-promoted rule, not a new letter, grounded in 2 prior retros that recommended it. Original promotion stands: RETRO-089 §6 (RETRO-084 + RETRO-089 CI-guard sub-shape, count 2). -->

---

## Rule Z — Every cross-runtime consumer (Python ↔ TS) that reads an event/payload/DB-write/query-result MUST be tested against a fixture derived from the OTHER runtime's canonical contract or a real backend — a mock that validates the shape THIS runtime emits is not evidence the wire connects

**Pattern:** Two runtimes communicate across a language boundary (SDK/control-plane TypeScript ↔
stream-consumer/intent-engine/ingest Python, or app ↔ ClickHouse/PostgREST). Each side has passing
unit tests, but each test mocks/constructs the shape ITS OWN side expects, never the contract the
OTHER side actually emits or enforces. The wire ships green-but-severed: the producer's field names,
the backend's column types, or the query engine's type rules differ from the consumer's hand-assumed
shape, and the defect is invisible to CI because no test crosses the boundary with a real or
contract-derived payload.

**Rule:** When a symbol in one runtime consumes data produced by another runtime (event payload,
Redis value, DB row, query result), at least ONE test MUST drive it with either (a) a fixture
mechanically derived from the producing runtime's canonical contract (e.g. parsed from the
`@estalara/shared` Zod schema for SDK events, or the producer's actual emitted object), or (b) a
real backend round-trip in a skip-loud/hard-fail CI job. A fixture hand-authored in the consumer's
assumed shape is forbidden as the SOLE evidence the wire connects. Cross-runtime field-name/type
contracts (event payload keys, Redis value shape, INSERT body column types, query result types) are
a HALF_WIRE_C P0/P1 surface until a contract-derived or live-backend test exists.

**Verification:**

```bash
# 1. For each Python consumer of an SDK/ingest event payload, the field names it reads
#    MUST exist in the canonical Zod schema in packages/shared/src/schemas/events/.
grep -rn "payload.get\|payload\[" apps/stream-consumer/src apps/intent-engine/src apps/ingest/src \
  | grep -v "\.test\." | grep -v test_      # each key must appear in the matching *PayloadSchema
# 2. Cross-runtime Redis/CH/PostgREST consumers must have a live-backend smoke (skip-loud):
grep -rln "REQUIRE_CLICKHOUSE\|REQUIRE_REDIS\|REQUIRE_UPSTASH" .github/workflows/   # a guard job must exist
# 3. A consumer test whose fixture is hand-built in the consumer's own assumed shape
#    (not parsed from the shared schema / not a real round-trip) does NOT satisfy this rule.
```

---

## Rule M — A job/seed/migration claimed to "auto-populate / self-apply on merge" MUST have a workflow that actually targets PROD; dev-only automation paired with a prod-effect claim is a HALF_WIRE_P

**Pattern:** A data-population job (embedding seeder, migration apply, backfill) is wired to run
automatically on merge — but the workflow only targets the DEV/staging environment (e.g.
`doppler run --config dev`), while a PR description, doc, AC, or code comment states or implies the
effect reaches production. Prod stays in the pre-job state (NULL embeddings, unapplied migration);
the feature that consumes the populated data silently runs on its FALLBACK path in prod; and every
bookkeeping signal says "done." This is the deployment-tier cousin of Rule H (wired-or-dead) and
shares Rule O's "green-but-never-applied-to-prod" failure mode, but the distinct axis is the CLAIM:
the automation is real and runs — it just does not reach prod, and a human reads "auto-populates" as
"live in prod."

**Evidence (≥2 retros):**

- **RETRO-076 / FOLLOW-307** — Postgres/Drizzle/Supabase migrations do not auto-apply in prod:
  merging a migration ≠ live; no workflow runs `db:migrate` against prod (only ClickHouse
  auto-applies); the new column is ABSENT in prod until a manual operator/Terraform apply. Count 1.
- **RETRO-113 / FOLLOW-341 (PR #352)** — the archetype-embedding seeder. `post-migrate-seed.yml`
  runs `pnpm seed:archetypes` only against DEV Supabase (`doppler run --config dev`); PROD
  `archetype_embeddings.embedding` rows stay NULL → `affinityScore()`'s §F cosine path is inactive
  in prod and silently uses the djb2 hash fallback for 100% of traffic, while the surface was
  described as self-populating-on-merge. Count 2; threshold met. Cross-refs FOLLOW-392 (operator
  action to seed prod) and FOLLOW-308.

**Rule:** When a job/seed/migration is described — in a PR, doc, code comment, or AC — as
"auto-populates," "self-seeds on merge," "applied automatically," or anything implying a PROD
effect, you MUST verify a workflow actually targets the PROD environment for that effect. If only a
dev/staging workflow exists, the prod-effect claim is forbidden. Instead: (a) state explicitly "dev
auto-populates; PROD requires manual operator step `<cmd>`"; (b) file a tracked operator FOLLOW for
the prod step; and (c) treat the consuming feature as running on its FALLBACK path in prod (a
HALF_WIRE_P, P-tier) until the prod-population step is logged complete — NOT when the dev automation
goes green.

**Verification:**

```bash
# 1. For any seed/backfill/migrate workflow, confirm which env(s) it targets:
grep -rniE "doppler run|--config|ENVIRONMENT|SUPABASE_URL|NODE_ENV" \
  .github/workflows/*seed*.yml .github/workflows/*migrate*.yml
# A workflow that only ever passes --config dev/stg CANNOT satisfy a "populates prod on merge" claim.
# 2. Grep PR text / docs / comments for self-populating claims and reconcile against step 1:
grep -rniE "auto-?populat|self-?seed|applied automatically|populates on merge|seeds on merge" \
  apps/ packages/ docs/ backlog/ --include="*.ts" --include="*.md" | grep -v node_modules
# 3. Each prod-effect claim backed by only a dev workflow = HALF_WIRE_P → it MUST carry an operator
#    FOLLOW + an explicit "PROD requires manual <cmd>" note; the consuming feature is on its fallback
#    path in prod until that step is verified.
```

**Provenance:** Promoted by direct CEO directive (Piotr, 2026-06-25) — "we need it to be fully
functional in all aspects." The retro-promotion threshold was already met (RETRO-076 + RETRO-113);
the retrospective-analyst recommended HOLD pending FOLLOW-308, but the CEO chose to codify now to
lock the §F-cosine-dark-in-prod lesson. (Provenance noted in-rule per the file's CEO-directive
clause; the ≥2-retro gate also independently applies here.)

---

## Rule V — A self-inflicted gitleaks false-positive (a PR's OWN long identifier) MUST be suppressed token-scoped (`regexes`/`stopwords`), NEVER file-scoped (`paths`) on a file that handles real secrets; and when a token-scoped entry supersedes a prior file-scoped one for the same trigger, STRIP the file-scoped entry

**Pattern:** A PR introduces a long, high-entropy-looking identifier of its own — a migration
filename (`0019_adaptation_decisions_page_context_source`, 46 chars), an ADR slug, a content hash
(64-char SHA-256), or any ≥40-char snake/kebab symbol — cited in code (JSDoc), a script, a doc, or a
test. A generic secret rule (here `cloudflare-api-token`, a 40-char entropy heuristic)
false-positives on it. The author silences the FP the lazy way: a **file-wide `paths` allowlist**
entry that disables the generic rule for the ENTIRE file/directory — even when that file handles
REAL secrets (env-derived HMAC keys, IP-encryption keys, API tokens, DB creds). The transient,
self-inflicted FP is gone, but so is secret scanning on a high-value file: a real token committed
there later sails through CI. The correct fix is **token-scoped** — a `regexes`/`stopwords` entry
matching the specific offending string, which suppresses only that one token anywhere and leaves the
rule fully armed on the file. Sub-shape: once a token-scoped entry exists for a trigger, any earlier
file-scoped `paths` entry for the same trigger is REDUNDANT and MUST be deleted
(strip-the-superseded) — leaving it disables scanning for no remaining reason.

**Evidence (≥2 prior retros):**

- **RETRO-118 §6 Pattern B (occurrence 1, count 1)** — PR #357 / FOLLOW-358 added a file-wide
  `paths` exemption `'''apps/control-plane/src/app/api/adapt/route\.ts'''` to the
  `cloudflare-api-token` rule to silence its own 46-char migration-filename JSDoc, disabling generic
  secret scanning on a route that holds env-derived HMAC + IP-encryption keys (the BAD shape).
- **RETRO-121 §6 Pattern B (occurrence 2, count 2)** — PR #360 / FOLLOW-394 added a **token-scoped**
  `regexes` entry `'''0019_adaptation_decisions_page_context'''` for the same filename cited in
  `migration-contract-test.sh` + the CH runbook (the GOOD shape). RETRO-121 recorded this as the 2nd
  occurrence and pre-committed: "Watch-item for the NEXT (3rd) sighting: promote a rule
  [token-scoped not file-scoped; strip-the-superseded]." Threshold (≥2 prior retros) reached at
  RETRO-123.
- **RETRO-123 (the 3rd sighting / promotion trigger)** — PR #362 / FOLLOW-396 performed the
  strip-the-superseded action: deleted the file-wide `route.ts` `paths` entry now that the
  token-scoped `regexes` entry covers the trigger, restoring full scanning. Immediate live second
  instance flagged by this rule: the FOLLOW-374 consent `platform-registration/` file-wide `paths`
  exemption (`.gitleaks.toml:172`), suppressing a self-authored 64-char
  `CANONICAL_CONSENT_TEXT_HASH` on a secret-handling endpoint → FOLLOW-407.

**Rule:** To silence a self-inflicted gitleaks FP from a PR's own long identifier, use a
token-scoped allowlist (`regexes`/`stopwords` matching the specific string), NEVER a file-scoped
`paths` allowlist on a file or directory that handles real secrets. A blanket `paths` exemption for
a generic high-entropy rule (e.g. `cloudflare-api-token`) on a secret-handling prod file is
forbidden — it trades one transient FP for permanently-blind secret scanning. When a token-scoped
entry is added (or already exists) for a trigger, DELETE any pre-existing file-scoped `paths` entry
that exists solely for that same trigger (strip-the-superseded). After narrowing/removing an
allowlist, PROVE detection is restored with a negative control: add a dummy high-entropy token to
the file, confirm gitleaks REDs, remove it — "CI is green" alone proves only that the FP is gone,
not that real-secret detection works. (Legitimate `paths` exemptions for non-secret-handling
test-fixture / doc / agent-lesson directories — Pattern G / FOLLOW-083 — are NOT in scope; this rule
governs secret-handling SOURCE files only.)

**Verification:**

```bash
# 1. Flag file-wide paths exemptions of generic secret rules on secret-handling SOURCE files
#    (exclude legitimate test-fixture/doc/agent-lesson exemptions):
grep -nE "src/app|src/lib|src/core|src/jobs" .gitleaks.toml | grep -viE "test|fixture|__"
#    Each hit on a file that handles env keys/tokens/HMAC/creds is a Rule-V violation → narrow to regexes.
# 2. For each self-inflicted long identifier, confirm the suppression is token-scoped, not file-scoped:
grep -nA3 "^regexes" .gitleaks.toml   # the GOOD shape lives here, matching the specific string
# 3. After adding a token-scoped entry, confirm no file-scoped paths entry survives for the same trigger
#    (strip-the-superseded), and run the dummy-token negative control to prove scanning is restored.
```

---

## Rule Q — A CI gate that can soft-skip (`continue-on-error` / exit-0-on-missing-secret / opt-in flag) MUST emit positive proof its assertion executed, and its soft-skip MUST be scoped to the ONE intended condition; a green/non-blocking status is NOT evidence the assertion ran

**Pattern (INERT-GATE):** A CI check is structurally present and reports a green — or intentionally
non-blocking (`continue-on-error: true`) — status, but its actual assertion **never executes**. The
assertion is bypassed because (a) a required flag/secret is unset and the job exits 0 by design, (b)
stacked soft-skips swallow the real failure ("soft-skip inception"), or (c) a build/module-
resolution/runtime error kills the job before the assert line and `continue-on-error` masks it. The
reported status is therefore meaningless: nobody can distinguish "intentionally skipped" from
"silently broken and verifying nothing." This is the verify-not-guess principle turned on the
verifier itself — a gate whose entire purpose is to verify an invariant is never itself verified to
run. The failure is invisible precisely because the status looks fine, so it survives for as long as
nobody independently exercises the invariant the gate was supposed to defend.

**Evidence (≥2 prior retros):**

- **RETRO-006 §Pattern C (occurrence 1, count 1)** — PR #130 E2E spec: "Test exists but is opt-in
  behind an environment flag that CI never sets" — the assertion exists in code but CI never runs
  it. RETRO-006 explicitly pre-authorized promotion: "If a second ticket ships a 'test exists but
  doesn't run' surface, promote to a Rule."
- **RETRO-007 §4b CB-1 (occurrence 2, count 2)** — PR #137 `demo-integration.yml`: "soft-skip
  inception — every layer says 'I could not run, but I am OK with that' and the cumulative effect is
  'the job is structurally present but never actually runs against a real DB'" (P2, → FOLLOW-079). A
  distinct PR, file, and mechanism from RETRO-006 — and, being the FAILED remediation of RETRO-006's
  own gap, the strongest evidence the shape is systemic, not incidental.
- **RETRO-145 (the 3rd sighting / promotion trigger)** — PR #403 / FOLLOW-446, `ci.yml` job
  `archetype-embeddings-not-null`: three stacked blindnesses each stopped the job before its NULL
  assertion (build died at `TS2307` because `@estalara/shared` wasn't built first; then
  `ERR_MODULE_NOT_FOUND` because a bare `@estalara/db` specifier ran from the repo root; then a
  postgres-js socket hung with no `process.exit` and no `timeout-minutes`), while
  `continue-on-error: true` masked every one as an indistinguishable non-blocking red. The gate had
  never once run its assertion between shipping (FOLLOW-341) and this fix; it was discovered only
  when FOLLOW-392 independently validated the invariant the gate was meant to guard.

**Rule:** Any CI gate that can soft-skip MUST:

1. **Prove the assertion executed** on the happy path — emit a distinct, greppable success line
   (e.g. `PASS: all 18 archetype embeddings populated`) that a reviewer/other check can point to, OR
   run a hard-failing `--strict` variant on `push:main`. A green job with no positive-execution
   evidence is treated as unverified.
2. **Scope the soft-skip to the single intended condition.** `continue-on-error` /
   exit-0-on-missing-secret / opt-in-flag must cover ONLY that one condition (e.g. missing
   `DOPPLER_TOKEN_DEV` on a forked PR). Build, dependency, module-resolution, and runtime failures
   MUST fail LOUD — never be swallowed by the same soft-skip. Prefer splitting a hard-failing
   build/setup job that `needs:`-feeds the soft-skippable assertion, or gating only the assert step
   on the skip condition.
3. **Bound the job** with an explicit `timeout-minutes`, and ensure any script that opens a
   persistent socket (postgres-js / ClickHouse / broker) exits explicitly — never rely on the
   360-minute default.
4. When narrowing/adding a soft-skip, PROVE the gate still catches a real violation with a
   **negative control** (a fixture that makes the assertion RED), because "CI is green" proves only
   that nothing tripped the (possibly inert) check — not that the check works.

**Verification:**

```bash
# 1. Find every soft-skippable gate and confirm each has an explicit timeout-minutes:
grep -nE "continue-on-error:|timeout-minutes:" .github/workflows/ci.yml
#    Any job with continue-on-error but no timeout-minutes (or no positive-execution log) is suspect.
# 2. Flag inline node scripts that import a bare @estalara/* specifier without a package context
#    (blindness #2 — ERR_MODULE_NOT_FOUND from repo root):
grep -nB2 "import .*@estalara/" .github/workflows/ci.yml | grep -iE "node --input-type|pnpm --filter"
# 3. Confirm any job that builds/uses an @estalara/shared-dependent package builds shared first
#    (blindness #1 — TS2307 before the assertion):
grep -nE "pnpm --filter @estalara/(shared|db|sdk) build" .github/workflows/ci.yml
# 4. For each soft-skippable gate, confirm a distinct success log line exists AND a negative control
#    proves the assert path REDs — a passing job without both is INERT until proven otherwise.
```

---

## Rule AA — An operator-gated go-live / audit-remediation ticket is `CODE_COMPLETE_OPERATOR_PENDING`, never `DONE` on code alone; the retro/PM verdict MUST split the code axis from the prod/operator axis and keep the prod-measurement axis OPEN with a fail-loud proof step

**Pattern (CODE-VS-PROD-AXIS):** A P0/P1 go-live or audit-remediation ticket ships its full code +
CI + test axis, but the production effect is gated behind a privileged operator-only action
(Doppler-prd flag flip, migration apply, or credential provisioning) that the merged code cannot —
and must not — perform. Marking such a ticket plainly `DONE` on the merged PR over-claims the
finding closed: the code is in `main`, but the invariant the ticket exists to guarantee (a measured
feedback loop, a populated table, a live adaptation) is NOT yet true in prod, and nothing observable
proves it until the operator acts.

**Evidence (≥2 prior retros):**

- **RETRO-146 §5a/§7 (count 1)** — FOLLOW-442 code axis closed (holdout `logDecisionAsync` added);
  the prod holdout-write attestation was explicitly left open.
- **RETRO-150 §3/§5a (count 2)** — FOLLOW-455 code axis closed (DSR OTP hardening); its sibling
  FOLLOW-449's ClickHouse migration apply named as an operator-only Doppler-prd step, not code.
- **RETRO-152 (the 3rd sighting / promotion trigger)** — FOLLOW-450 entire ticket
  `CODE_COMPLETE_OPERATOR_PENDING`: canary + SDK observability + route-driven e2e shipped and
  merged, but the bandit loop is not live until an operator flips `FEEDBACK_ENDPOINT_ENABLED=true`
  and provisions `ADAPT_API_KEY`/`OPS_TENANT_ID`/`DATABASE_URL_ADMIN` in Doppler prd.

**Rule:** For any ticket whose production effect is gated on an operator-only action:

1. Set the ticket to `CODE_COMPLETE_OPERATOR_PENDING`, NOT `DONE`, when its PR merges.
2. The retro/PM verdict MUST split the CODE axis from the PROD/OPERATOR axis, mark ONLY the code
   axis closed, and keep the prod/measurement axis explicitly OPEN on the pilot go-live checklist
   (STATUS.md), named by the exact operator step.
3. The operator leg MUST have a fail-loud proof step (a canary run, an attestation stub, a query
   transcript) whose output is pasted as the finding's closure evidence. The audit finding is not
   "closed with proof" until that proof exists.
4. Any retro on an operator-gated ticket cites BOTH the code-axis closure chain AND the still-open
   operator hop by name — never claims the finding `DONE` on code alone. FOLLOW-471's re-audit gate
   requires the operator proof transcript per finding.

**Verification:**

```bash
# Every ticket whose notes name a Doppler-prd flip / migration apply / credential provisioning as an
# AC must NOT be status: DONE on code-merge alone.
grep -nE "CODE_COMPLETE_OPERATOR_PENDING|FEEDBACK_ENDPOINT_ENABLED|operator-only|Doppler prd" backlog/QUEUE.md
# Each such ticket must appear on the STATUS.md pilot go-live checklist with a named proof step.
```

---

## Rule AB — A latest-wins / in-flight staleness guard on a rapid-nav re-adaptation MUST be consulted at the LAST synchronous instant before EVERY host-DOM write it protects — including fire-and-forget sub-adaptations in other modules AND rAF/microtask-deferred writes; a single synchronous checkpoint or a single post-fetch checkpoint is insufficient

**Pattern (ASYNC-READAPT-NO-INFLIGHT-GUARD):** An async re-adaptation triggered by a rapid-fire
DOM/navigation event (rapid cross-listing SPA nav) commits or paints through an async tail with more
than one continuation. A staleness/latest-wins guard placed at ONE point in that tail (the first
`await` boundary, or a single post-fetch checkpoint) leaves every LATER continuation unguarded, so a
superseded invocation's continuation still interleaves on shared state / paints the stale
archetype's copy onto the NEWER listing's DOM. The gap serially RELOCATES one hop downstream with
each partial fix — from a synchronous checkpoint, to a fire-and-forget sub-adaptation in another
module, to a `requestAnimationFrame`/microtask-deferred write — because each fix guards the point it
can see, not the actual mutation instant.

**Evidence (≥2 prior retros):**

- **RETRO-105 §6 LG-1 (count 1)** — overlapping `refreshDirectives()` on rapid SPA nav had no
  in-flight guard; a stale invocation could clobber the newer navigation's state/DOM. Held →
  FOLLOW-380.
- **RETRO-169 §4a LG-1 (count 2)** — FOLLOW-380 added a single synchronous `latestRefreshId`
  checkpoint (`index.ts:737`) that guarded the directive/headline path but NOT the fire-and-forget
  `applyDescriptionAdaptation` tail dispatched after it; the async-interleave class relocated one
  hop to the description path. Held → FOLLOW-546, with promotion PRE-AUTHORIZED on a 3rd sighting OR
  on the discovery that FOLLOW-546's fix itself re-relocates the guard gap.
- **RETRO-170 §4a LG-1 (the promotion trigger)** — FOLLOW-546 threaded an `isStale()` predicate and
  re-checked it post-`await fetchDescription` (`adapt-description.ts:309`), closing the
  fetch-in-flight window. **Citation correction (FOLLOW-548, 2026-07-10):** the retro's original
  text attributed the residual gap to the `:323`/`:333` `requestAnimationFrame(...)` call sites;
  FOLLOW-548 proved those lines run SYNCHRONOUSLY (JS eager argument evaluation — `f(g())` calls
  `g()` before `f`), so they were already covered by the `:309` check. The genuinely unguarded write
  is the `reapply` loop-guard closure (inside `applyAndObserveSlot`/ `applyAndObserveHeadlineSlot`),
  re-invoked LATER via the `MutationObserver`'s OWN internal `requestAnimationFrame` — independent
  of the caller's initial rAF schedule. A supersession landing after the observer arms but before
  `reapply` fires still let the stale closure repaint, and the self-reinforcing `MutationObserver`
  made it PERSIST when the superseding listing was uncached. The SAME class re-relocated a THIRD hop
  — exactly the pre-authorized trigger; only the specific write-path citation is corrected here, the
  promotion adjudication itself is unaffected. The 2 banked occurrences are both PRIOR retros →
  ≥2-prior threshold met; the promoting retro fires on the discovered re-relocation (NOT on
  FOLLOW-546 merging, which is a fix landing, not a new sighting) and does NOT inflate the count
  (same adjudication as Rules AA/V/Q). → FOLLOW-548.

**Rule:** For any re-adaptation whose trigger can fire faster than its own async tail completes
(rapid cross-listing nav, overlapping refresh, any fire-and-forget sub-adaptation):

1. Thread a latest-wins / staleness predicate (`isStale()` / a claimed `callId` vs a monotonic
   `latest`) through EVERY async continuation that mutates host DOM — including sub-adaptations
   dispatched fire-and-forget into OTHER modules (pass the predicate as a param; do not assume the
   caller's synchronous checkpoint covers them).
2. Consult the predicate at the LAST synchronous instant BEFORE each DOM write — not merely after
   the fetch. If the write is deferred (`requestAnimationFrame`, `queueMicrotask`, `setTimeout`, a
   MutationObserver callback), re-check INSIDE the deferred callback (or capture a snapshot the
   callback re-reads), because a checkpoint before the defer does not cover the write inside it.
3. Make the discard observable (a `skipped {reason:'stale'}`-class event), never a silent return, so
   the guard's decisions are measurable in prod.
4. A staleness predicate passed as an OPTIONAL param with a never-stale default is a footgun: any
   future prod call site that omits it silently loses the guard with no compile/lint error. Prefer a
   required param (give test sites an explicit no-op) or a guard/lint at the prod call site.

**Verification:**

```bash
# Every fire-and-forget sub-adaptation dispatched after an in-flight checkpoint must forward the guard.
grep -nE "void +apply[A-Z][A-Za-z]*Adaptation" packages/sdk/src/index.ts
# Every rAF/microtask-deferred DOM write in an adaptation module must re-check staleness inside the
# deferred callback, not only before scheduling it.
grep -nE "requestAnimationFrame|queueMicrotask|setTimeout" packages/sdk/src/core/adapt-*.ts
```

---

## Rule AC — A guard-authoring ticket for a class of duplicated/hand-maintained literal MUST be scoped by a repo-wide grep for the target signature, not just the files the source audit named

**Pattern (SCOPE-BY-AUDIT-NOT-BY-GREP):** A ticket is created to guard against drift in a "class" of
hand-maintained duplicate (a literal ID set, an enum mirror, a config array) after an audit or a
prior retro names N specific files carrying it. The implementation trusts that enumeration and
writes a guard/test covering exactly those N files. A later retro's independent repo-wide grep for a
distinctive member of the set finds additional, un-guarded instances — sometimes in a
higher-consequence location (a live production code path) than any of the N the ticket covered, and
sometimes already broken (proving the guard would have caught it on its first run had it existed).
The ticket's own stated scope is not itself evidence the guard reaches every instance of what it
exists to guard.

**Evidence (≥2 prior retros):**

- **RETRO-053 → RETRO-055 (count 1)** — FOLLOW-264's Option-A removal was scoped to 3 named limbs;
  RETRO-055 found the SDK + `LocaleSchema` axes the consolidation did not reach.
- **RETRO-107 §7 → RETRO-108 (count 2)** — the FOLLOW-384 stub scoped HW-3's closure to the
  `redis_writer.py` hop only; RETRO-108 confirmed FOLLOW-384's own ACs were met while the §H.9
  behavior it existed to deliver was NOT, because the SDK-chat-emit → ingest-schema →
  `_spawn_chat_nlp` producer chain was never enumerated by the stub.
- **RETRO-178 (the promotion trigger, count 3)** — FOLLOW-561's archetype-ID parity guard scoped to
  the 3 files a 2026-07-11 audit named (`nlp.py`, `archetype-seeds.ts`, migration 0005). A repo-wide
  grep for a distinctive canonical archetype name (`golden_visa_buyer`) surfaced a 4th,
  **production- live** full-parity copy (`generate_description.py` `_ARCHETYPE_GUIDANCE`, feeding
  the live Modal AI-description prompt with a silent generic-fallback on a missing key — no crash,
  no alert) plus 2 subset copies the guard never touches, one of which (`MOCK_ARCHETYPES` /
  `export/route.ts`'s inline mock literal) already contains an invalid id (`family_upsizer` — not a
  member of the canonical 18) that a subset-validity check of the exact shape FOLLOW-561 already
  wrote for `archetype-hints.ts` would have caught immediately, one file over. The 2 banked
  occurrences are both PRIOR retros → ≥2-prior threshold met; this retro does not inflate the count
  (same adjudication as Rules AA/AB/V/Q).

**Rule:** When authoring a ticket (or a retro follow-up) whose job is to guard a class of duplicated
hand-maintained literal:

1. Before declaring the guard's file scope final, run a repo-wide grep for at least one distinctive
   member of the set (a name unlikely to appear for unrelated reasons) across the whole tree
   (excluding `node_modules`), not just the files the source audit/ticket named.
2. Classify every hit: full-parity duplicate (must match the canonical set exactly), documented
   subset (must be a subset-validity check — every referenced id is a real member — mirroring the
   pattern this same repo already uses for deliberate-subset exemptions), or a false positive
   (comment/doc-string example, unrelated string collision).
3. If a hit reveals the literal is ALREADY wrong (a typo/stale id), that is independent evidence the
   grep should have run before scoping the ticket, not after — file it as part of the SAME ticket,
   not a separate one, so the new assertion's first run demonstrably goes red on the real bug before
   the fix lands (proof the guard works, not just that it was written).
4. Weight the found-but-unguarded instances by consequence, not just count: a copy on a live
   production read/write path outranks a copy in test fixtures or dev/CI-only mock data, and should
   be called out explicitly in the ticket/PR description even if it is currently in sync.

**Verification:**

```bash
# Given a canonical literal-set constant, grep for a distinctive member's string value repo-wide to
# find every hand-maintained copy, not just the ones a source audit enumerated.
grep -rn '<distinctive_member_value>' apps/ packages/ --include=*.ts --include=*.py \
  | grep -v node_modules
```

---

## Rule AD — When fixing or guarding a value-domain literal, enumerate EVERY structural shape it can occur in (named array, inline object VALUE, object KEY, JSON-stringified blob key, zod enum, free-form field), not just the shape the triggering grep matched — and prefer a compile-time type over a downstream string-grep guard

**Pattern (MULTI-ANCHOR / MULTI-SHAPE LITERAL BLIND-SPOT — Rule AC failure-mode (a)):** A ticket
fixes or guards instances of a member of a closed value domain (an archetype id, a status enum, an
event type) that were found by ONE search anchor — a distinctive-member grep (`golden_visa_buyer`),
a named-constant grep (`MOCK_ARCHETYPES`), or a single value-position regex
(`archetype:\s*'[a-z_]+'`). The same invalid/at-risk literal recurs in a DIFFERENT structural shape
that the chosen anchor is blind to by construction — an inline object field the array-name grep
can't see, or an unquoted **object KEY** inside a JSON-stringified blob that a quoted-value regex
can't see. Each sweep closes the shape it could see and moves the gap one structural hop to a shape
it never searched, so the "class" is declared closed while a live instance survives one sub-shape
over. A single anchor is never proof of full coverage; only enumerating the shapes (or a
compile-time type on every hand-authored site) is.

**Evidence (≥2 PRIOR retros):**

- **RETRO-179 §6 (count 1, PRIOR)** — the 2 `'investor'` subset-array mock literals
  (`pilot/cta-lift`, `dashboard/analytics/lift` `MOCK_ARCHETYPES`) were invisible to the
  `golden_visa_buyer` full-parity anchor (short subset arrays that never contain that id); found
  only by widening to a `MOCK_ARCHETYPES`-name grep. RETRO-179 was the first retro to explicitly
  separate this multi-anchor sub-pattern from Rule AC's broad scope-by-audit failure-mode.
- **RETRO-181 §4b CB-1 (count 2, PRIOR)** — `top_archetype: 'family_nester'` in
  `admin/tracer/sessions/route.ts` `buildMockSessions()` was invisible to BOTH the
  `golden_visa_buyer` anchor AND the `MOCK_ARCHETYPES`-name grep, because it is an inline object
  field, not a named array. RETRO-181 pre-authorized promotion on "the next genuine anchor-INVISIBLE
  archetype-literal find … the 3rd total / 2nd prior — that one crosses the threshold."
- **RETRO-182 (the promotion trigger)** — FOLLOW-587 (PR #563) swept the two RETRO-181 inline-field
  instances using a `(?:top_archetype|archetype)\s*:\s*'[a-z_]+'` value-position regex, and added a
  compile-time root-fix (`readonly ArchetypeId[]`) on the three named `MOCK_ARCHETYPES` arrays. A
  fresh independent sweep found the SAME invalid `family_nester` surviving one sub-shape over, in
  `admin/tracer/sessions/history/route.ts` `buildMockEvents()`:
  `archetype_deltas: JSON.stringify({ yield_hunter: 0.12, family_nester: -0.03 })` — an unquoted
  object **KEY** inside a JSON-stringified blob, invisible to ALL THREE anchors used to date (the
  distinctive-member grep, the array-name grep, and the quoted-value regex). This is a genuinely new
  3rd structural sub-shape and the 2nd-prior sighting that crosses the ≥2-PRIOR threshold. The 2
  banked occurrences are both PRIOR retros → threshold met; the promoting retro does NOT inflate the
  count (same adjudication as Rules AA/AB/AC/V/Q).

**Rule:** When a ticket (or retro follow-up) fixes or guards a literal from a closed value domain:

1. Before declaring the fix/guard complete, enumerate every STRUCTURAL shape the literal can occupy
   in the codebase and search each — at minimum: named `as const` arrays, inline object VALUES
   (`field: 'id'`), inline object KEYS (`{ id: 0.12 }`, incl. inside `JSON.stringify({...})`), zod
   `z.enum([...])`, and free-form/untyped `Record` fields. A single distinctive-member or
   named-constant anchor is a starting point, never the coverage proof.
2. Prefer a COMPILE-TIME type on every hand-authored site (`readonly ArchetypeId[]`,
   `Record<ArchetypeId, number>`) over adding yet another downstream string-grep runtime guard — a
   type catches every future shape at `tsc`, whereas each grep-guard only covers the one shape its
   regex was written for and silently misses the next sub-shape. Do NOT tighten fields hydrated from
   an external store (ClickHouse/DB/network) that must accept unexpected values — only hand-authored
   constants and mock fixtures are safe to type.
3. When a runtime string-parser guard IS used, make it fail loud on structural drift (assert
   `matched > 0` before comparing) so a future reformat/retype that moves the literal out of the
   regex's reach fails the build instead of passing on an empty match set.
4. If a sweep finds the same invalid literal one sub-shape over, that is evidence the previous
   sweep's anchor was too narrow — enumerate the remaining shapes NOW and state explicitly whether
   the class is then fully enumerated-and-guarded (closable) or still open.

**Verification:**

```bash
# Enumerate a closed-domain literal across ALL structural shapes, not one anchor. Example: archetype id.
# (a) inline VALUE + named-array + zod-enum shapes:
grep -rnE "archetype[a-z_]*\s*:\s*'[a-z_]+'|MOCK_ARCHETYPES|z\.enum\(\[" apps/ packages/ \
  --include=*.ts | grep -v node_modules | grep -v '\.test\.'
# (b) object-KEY-in-JSON-blob shape a quoted-value regex misses (the RETRO-182 sub-shape):
grep -rnE "JSON.stringify\(\{[^}]*(hunter|_buyer|_investor|nester|relocator|upsizer|downsizer)" \
  apps/ packages/ --include=*.ts | grep -v node_modules | grep -v '\.test\.'
# Prefer a compile-time type so tsc catches every shape:
grep -rnE "readonly ArchetypeId\[\]|Record<ArchetypeId" apps/ packages/ --include=*.ts | grep -v node_modules
```

---

## Rule AE — An AST-based mechanical guard for a security invariant (e.g. "audited mutation must be tx-scoped") MUST enumerate every syntactic CALL-SHAPE the guarded action can take before being declared complete — a fix that closes the one shape a regression happened to use is not proof the class is closed

**Pattern (the Rule AD meta-pattern, restated for AST call-shapes instead of value literals):** A
ticket hardens a hand-written AST detector that decides "does this route perform the guarded
mutation?" by pattern-matching ONE syntactic call-shape it observed in a real regression
(`.update(`/`.insert(` property-access calls; later, a bare-identifier delegated helper call). The
NEXT ticket that needs the same kind of delegation happens to phrase it in a DIFFERENT, equally
idiomatic TypeScript call-shape the detector never enumerated (a namespace/property-access import
instead of a named one), and the guard silently reports success (`SKIP`/`OK`) while providing zero
enforcement — moving the gap one syntactic hop, exactly as Rule AD's value-literal shapes move one
structural hop. The fix for hop N is real and correct for the shape it targets; it is never proof
hop N+1 doesn't exist, because each hop is only ever discovered when a subsequent ticket happens to
phrase its own delegation in the untested shape.

**Evidence (≥2 PRIOR retros, all on the SAME staff-write-atomicity guard —
`scripts/check-staff-write-atomicity.cjs`, ADR-0018 §3a/FOLLOW-607):**

- **RETRO-192 §6 (count 1, PRIOR)** — named 3 bypasses in the presence-only v1 guard (unrelated-tx,
  helper-factored-audit, raw-SQL-mutation); explicitly declined promotion as "the guard IS the
  codification," reasoning the 3 bypasses were the SAME arc as the guard's own initial authoring,
  not an independent recurrence. Filed FOLLOW-608.
- **RETRO-194 §6 (count 2, PRIOR)** — FOLLOW-608 shipped the scope-aware fix for RETRO-192's 3
  bypasses, but a 4th call-shape (a bare-identifier delegated helper call, `upsertX(tx, …)`) was
  found un-detected by direct reproduction BEFORE the next ticket (FOLLOW-609) shipped; also
  declined promotion as "same arc, 2nd hop of 607→608→609," matching RETRO-192's reasoning.
- **RETRO-196 (the promotion trigger)** — FOLLOW-609 shipped the fix for RETRO-194's bypass 4
  (`collectLocalImportedIdentifierSources` + `moduleContainsMutation`, correctly recognizing a
  bare-identifier delegated call) — independently re-verified live on `main`
  (`node scripts/check-staff-write-atomicity.cjs` prints `OK`, not `SKIP`, for the fixed route). A
  fresh independent reproduction (uncommitted throwaway fixture, not inferred) found the SAME class
  of gap ONE MORE call-shape over: a **namespace/property-access** delegated call
  (`import * as helper from '@/lib/mutation-helper'; helper.upsertX(tx, …)`) is a
  `PropertyAccessExpression` whose method name matches none of the guard's known mutation method
  names (`insert`/`update`/`delete`/`execute`/`transaction`), so it silently falls through BOTH
  detection branches — `SKIP`, exit 0, zero enforcement. This is a genuinely NEW call-shape (not a
  re-sighting of bypass 4), found independently by the PM session (not inferred from a prior retro's
  prose), and it directly threatens the NEXT two queued tickets (FOLLOW-597/598) which each need
  their own NEW store-delegation helper. Re-adjudicated against Rule AD's own promotion precedent
  (RETRO-182 crossed the threshold on "the same literal, one more STRUCTURAL shape over" across the
  SAME guard-family's evolution, which is likewise "one arc") — the correct bar was never
  same-arc-vs-independent-arc, it was "a genuinely new, independently-found, previously-unenumerated
  shape." That bar is met here: 2 banked PRIOR retros (192, 194) + this 3rd independent sighting of
  a yet-newer shape crosses it. Filed FOLLOW-612 (close bypass 5) with an explicit note in
  FOLLOW-597 and FOLLOW-598's AC to prefer named imports (the recognized shape) until it lands.

**Rule:** When authoring or hardening an AST-based (or regex-based) mechanical guard that decides
whether a route/module performs a guarded security-relevant action (a mutation, an audit write, a
tenant-scoping call, …) by pattern-matching call shapes:

1. Before declaring the guard complete, enumerate every syntactic call-shape the guarded action can
   take: a direct method call (`.insert(`/`.update(`), a bare-identifier delegated helper call
   (`helperFn(...)`), a namespace/property-access delegated call (`ns.helperFn(...)`), a re-exported
   wrapper, and a raw string/SQL escape hatch. A guard that only recognizes the ONE shape the
   triggering regression happened to use is a starting point, never coverage proof.
2. When a fix for shape N ships, explicitly ask (and record the answer in the PR/retro) whether the
   SAME fix technique also covers shapes N+1 that a future ticket could plausibly use — do not wait
   for the next ticket to accidentally discover it.
3. Prefer resolving to the underlying symbol/module (as `moduleContainsMutation`'s bounded
   import-graph walk does) over per-syntax-shape special-casing where practical, since a
   module-level "does this resolved thing mutate" check is shape-agnostic once the identifier is
   resolved — the residual gap is almost always in the IDENTIFIER-RESOLUTION step (which import
   forms are followed), not the mutation-detection step itself.
4. If a fresh, independent reproduction finds the same class of gap one more call-shape over after a
   fix has shipped, that is evidence the previous fix's shape-enumeration was incomplete — enumerate
   the remaining shapes NOW and state explicitly whether the class is then fully
   enumerated-and-guarded (closable) or still open, exactly as Rule AD requires for value-literal
   shapes.

**Verification:**

```bash
# Confirm the guard currently recognizes ONLY the shapes it claims to (read the source, don't guess):
grep -n "isPropertyAccessExpression\|isIdentifier(node.expression)\|isNamespaceImport" \
  scripts/check-staff-write-atomicity.cjs
# Re-run the guard against the live repo after any change — the touched staff-write route must
# print OK, never SKIP:
node scripts/check-staff-write-atomicity.cjs
# Build (do NOT commit) a throwaway fixture per untested call-shape and confirm the guard's verdict
# before trusting any "guard complete" claim in a PR description.
```

---

### Rule AE amendment (2026-07-31 — RETRO-237 §6 — scope-broadening to ANY invariant, and the CLEARANCE-side sub-shape)

**Two changes, one to AE's scope and one to its enumeration obligation.**

**(1) Scope.** Rule AE's title binds it to _"an AST-based mechanical guard for a **security**
invariant"_. Every sighting since promotion has been a **grep**-based guard for a **compliance /
cost / observability** invariant, and in each case the retro recorded that AE as written did not
formally reach the gate, so no reviewer citing AE would have caught it. The rule now reads on **any
mechanical guard (AST- or regex/grep-based) that decides whether a file, route or module satisfies
an invariant by pattern-matching source text** — security, compliance, cost, observability,
contract-parity alike. The rule body already said "(or regex-based)"; the title and the promotion
bar did not.

**(2) The clearance side.** AE's four items are all about the guard's **detection** side: which
syntactic shapes of the _guarded action_ it searches for. Every guard also has a **clearance** side:
the shapes that make it declare a file CLEAN — comment/string filters, allowlist tokens, name-based
exclusions, and the scan-root itself. A guard with perfect detection and a leaky clearance test is
exactly as blind, and it reads as _more_ trustworthy because it looks specific. The clearance side
must be enumerated with the same discipline, and it must be enumerated **by measurement**.

**Evidence (≥2 PRIOR retros, three different guards, three different PRs, three different subsystems
— not three hops of one arc):**

- **RETRO-230 §4a DG-1 / §6 (count 1, PRIOR)** — the consent-contract-parity gate. `extractCalls()`
  searched for the literal `NextResponse.json(` inside two file slices; two hand-built mutations (a
  module-level helper placed **outside** both slices; `new NextResponse(JSON.stringify(...))`
  **inside** the handler) each made the gate exit **0, "CONSENT CONTRACT IN SYNC — PASS"**. Recorded
  explicitly as _"AE sighting (by analogy), count 1 toward a scope-broadening amendment ('mechanical
  guard for ANY invariant')"_, because a parity gate is not a security invariant. Also the origin of
  the **mutation-fixture method** this amendment now requires.
- **RETRO-235 §3 HW-1 / §4b CB-1 / §6 (count 2, PRIOR)** — `scripts/check-sentry-init-singleton.sh`
  was built around the shape RETRO-234's finding happened to use (`sentry_sdk.init(`), so the one
  file that needed an init **because it never had one** (`generate_description.py`, the live LLM
  spend-cap alarm) was invisible to the guard, to the tests and to three `/code-review` passes.
  Pre-specified the amendment in as many words: _"AE's current text is scoped to 'AST-based
  mechanical guard for a security invariant'; both sightings are grep-based guards for
  compliance/cost invariants, which is the exact broadening the amendment should make."_ **HELD at
  count 2** for want of a second prior.
- **RETRO-237 §4b CB-1 (count 3 — the promotion trigger, and the strongest instance because the
  guard in question IS sighting 2's remediation).** `scripts/check-sentry-capture-has-init.sh` (PR
  #646) was written specifically to close RETRO-235's blind spot. Its detection side is sound and
  its repo-wide inventory was complete. Its **clearance** side has four false negatives, each
  reproduced with a throwaway fixture run against the shipped script:
  1. a **docstring** mentioning `init_sentry(` clears the whole file (the comment filter is
     `^[0-9]+:[[:space:]]*#`; docstrings carry no `#`);
  2. a **trailing** `#` comment mentioning `init_sentry(` clears the whole file — the _identical_
     filter bug RETRO-235 §4b CB-4 found in the sibling script, inherited by the script written to
     close that sibling's blind spot;
  3. `! -name "*test*.py"` is a **substring** glob, so a production module named `latest_*.py` /
     `attestation*.py` is never scanned;
  4. `! -name "observability.py"` excludes by **basename**, and its stated rationale is
     **empirically false** — the script's own regex already excludes those files, so the exclusion
     buys nothing and costs a hole. Plus the **direction** finding: bug 2 produces a false **RED**
     in the sibling gate (loud, self-correcting) and a false **GREEN** here (silent, permanent) —
     the same defect, opposite remediation priority, and that is not visible from the code.

**Rule (additions to Rule AE's numbered list):**

5. **Applies to any mechanical guard for any invariant**, AST- or grep-based — not only security
   invariants. If the guard decides "does this file/route/module satisfy X" by pattern-matching
   source text, items 1-4 and 6-8 below bind.
6. **Enumerate the CLEARANCE side, not just the detection side.** Before declaring the guard
   complete, list every shape that makes it declare a file/route CLEAN and state whether each is
   intended: (a) comment filters — whole-line vs trailing vs docstring/string-literal; (b) allowlist
   or suppression tokens; (c) name-based exclusions (`--exclude`, `! -name`) — and check the glob is
   anchored, not a substring; (d) the scan root / directory scope; (e) any early `return 0` /
   `continue`. A guard whose detection is complete and whose clearance test is leaky is exactly as
   blind as one that never looked.
7. **Every named exclusion must carry a rationale that is verified, not asserted** — run the guard's
   own pattern against the excluded file and confirm it would have matched. An exclusion whose
   stated reason does not hold is a pure hole; strip it rather than documenting it.
8. **Prove each shape by MUTATION, not by reading.** Build one throwaway fixture per enumerated
   shape (detection _and_ clearance), run the shipped guard against it, and record the verdict in
   the PR body — this is what separates a measured finding from a plausible one, and it is how all
   three sightings above were established. Ship the surviving fixtures into the guard's
   `--self-test` so the shape cannot silently regress. **State the direction of every defect
   found**: a filter defect on the detection side and the same defect on the clearance side have
   opposite severity (false RED is loud and self-correcting; false GREEN is silent and permanent).

**Verification:**

```bash
# 1. Read the clearance side of the guard, don't guess it — every filter, exclusion and allowlist:
grep -nE "grep -v|--exclude|! -name|allowlist|continue|return 0" scripts/<guard>.sh

# 2. For every "! -name"/"--exclude" pattern, prove the exclusion is needed (the guard's own pattern
#    must actually match the excluded file — if it does not, the exclusion is a hole, not a filter):
grep -nE "<the guard's own detection regex>" <the excluded file>

# 3. Mutation-prove each shape. Fixtures go to a temp dir, NEVER into the live tree (Rule AM):
#    one file per shape — docstring-clear, trailing-comment-clear, substring-name skip, basename
#    exclusion, out-of-scan-root — then run the SHIPPED guard against each and record pass/fail.
mkdir -p /tmp/guardprobe/app-x/src && printf '...' > /tmp/guardprobe/app-x/src/probe.py
<GUARD_TARGET_ENV>=/tmp/guardprobe bash scripts/<guard>.sh; echo "exit=$?"

# 4. Confirm the guard still reports correctly on the REAL tree after the fix (a hardened guard that
#    now false-REDs on main is a Rule AF liability):
bash scripts/<guard>.sh
```

<!-- AMENDED by RETRO-237 (2026-07-31). Rule AE scope-broadening + clearance-side sub-shape, count 3,
PRIOR RETROS: RETRO-230 §6 (count 1, consent-contract-parity gate, mutation-proven, explicitly filed
"toward a scope-broadening amendment") and RETRO-235 §6 (count 2, check-sentry-init-singleton.sh, with
the amendment's scope clause pre-specified verbatim and HELD for want of a second prior). Promotion
trigger: RETRO-237 §4b CB-1 — FOUR measured false negatives in check-sentry-capture-has-init.sh, the
gate written specifically to close sighting 2, all four on the CLEARANCE side which neither prior
covers. Three different guards, three PRs, three subsystems — independent sightings, not one arc
(contrast RETRO-237 §6's DELIBERATE DECLINE of the Rule AJ amendment at count 2, where all three
sightings were the same SENTRY_DSN artefact on one displacement chain). CHECKED BEFORE AMENDING:
Rule AC (scope a guard-authoring ticket by a repo-wide grep of the target signature — adjacent, and it
FIRED and was COMPLIED WITH by PR #646's AC-2 inventory; AC governs which FILES the guard is pointed
at, not which SHAPES clear a file), Rule AM (a self-testing gate's fixtures must be synthesized, not
mutated from live source — the new gate COMPLIES, mktemp -d; AM is about fixture provenance, not
coverage — item 8 above cites AM so the two do not conflict), Rule AL (an assertion must be evaluated
over the same region its consumer reads — nearest neighbour on the scan-root sub-item 6(d), and the
reason RETRO-237 recorded the scan-root hole as verified-not-live rather than as the trigger),
Rule Q (a soft-skippable gate must emit positive proof its assertion ran — satisfied by both Sentry
gates' self-tests; Q is about the JOB running, not about what the assertion can SEE). No existing rule
requires enumerating the shapes that CLEAR a guard. Amendment, not a new letter: this is Rule AE's own
subject (shape-enumeration completeness in a mechanical guard) on its second axis, and splitting it
would let a reviewer cite one half against the other. -->

---

## Rule AF — A gate that is permanently red is a DISABLED gate: no CI check may sit red on `main` un-quarantined, and "CI green modulo the known reds" is only a valid merge signal when the known-red set is compared against `main`'s baseline and found UNCHANGED

**Pattern:** A CI check starts failing for reasons nobody intends to fix today. It is labelled
"pre-existing red, non-blocking" and waved through, PR after PR. Two things then happen, both
silently: (1) NEW violations accumulate inside that check — the red carries no information, so
nobody reads it, so a regression the check was built to catch lands unnoticed; and (2) the
normalization generalizes — a SECOND check reaches terminal-red and no one notices at all, because
"some red is normal" is now the ambient state. At that point "CI is green" has stopped being a merge
control while still being used as one.

**Evidence:** SESSION-RETRO 39 → FOLLOW-591 (`Rule I — wired-or-dead` red on `main` at **179**
violations; the ticket itself argues "a permanently-red gate destroys the signal value of CI red …
it degrades the CI signal for ALL future work and compounds"; no branch protection, so the red is
non-blocking — count 1). RETRO-187 §2/§6 (**183** violations; "the standing pre-existing
non-blocking Rule I noise"; promotion explicitly declined at "single sighting" — count 2). RETRO-188
§5/§6 (+8 more from one PR; filed FOLLOW-602 to stop the eventual diff-scoped version from
false-blocking — count 3). Promotion trigger — RETRO-205 (FOLLOW-600/PR #606): the count is now
**191** (+12 since the remediation ticket was filed, none of them from the promoting PR — verified
against the job log, not assumed); the aggregate `CI` workflow conclusion on `main` is `failure` on
EVERY push, so "is main green?" has no readable answer; a SECOND workflow (`Release`) has failed on
**every run in the last 30** with no success in the last 100 (`@estalara/sdk` publish →
`E403 … owner not found`) and had **zero** mentions in RETROSPECTIVES.md / FOLLOW_UPS.md / QUEUE.md
/ ESCALATIONS.md — prediction (2) realized; and the PR itself was merged with "CI green" as the sole
pre-merge control, evaluated against that baseline. The 3 banked occurrences are all PRIOR retros →
≥2-prior threshold met; the promoting retro does not inflate the count (same adjudication as Rules
AA/AB/AC/AD/AE/V/Q).

**Rule:**

1. **No un-quarantined red on `main`.** A check that is not going to be fixed now MUST be
   quarantined — made advisory (`continue-on-error: true`) or removed from the workflow — with an
   in-file comment naming the owning `FOLLOW-NNN` and the condition for restoring it. A check left
   failing is not "tracked"; it is noise with a ticket attached.
2. **A known-red waiver is a comparison, not a label.** Any agent, PM, or retro that declares a PR
   mergeable "modulo the known reds" MUST record (a) WHICH checks are red, (b) the owning FOLLOW for
   each, and (c) that the red set and its VIOLATION COUNT are **unchanged versus `main`'s
   baseline**. "Still red" is not evidence; "still red, still 191, none from this diff" is. Waving
   through a red whose contents were never opened is forbidden.
3. **Workflow-level red counts too.** If a red job makes its whole workflow's conclusion `failure`
   on every push to `main`, that workflow no longer answers "is main healthy" — quarantine the job
   (rule
   1. or split it out. Periodically sweep workflows that do NOT appear in the PR check list
      (`gh run list --branch main --workflow=<f>`); the `Release` finding above was invisible
      precisely because push-only workflows never surface on a PR.
4. **A pin or suppression applied to un-break CI MUST carry a trigger, not just a ticket.** An
   "un-pin later" AC in a P3 opportunistic ticket is an expiry nobody will observe; pair it with a
   check that fires when the pinned version diverges from production (see FOLLOW-620/621/629).

**Verification:**

```bash
# 1. Is anything red on main right now — including workflows that never appear on a PR?
gh run list --branch main --limit 20 --json conclusion,name,workflowName,headSha
for w in $(ls .github/workflows/*.yml | xargs -n1 basename); do \
  echo "== $w"; gh run list --workflow="$w" --branch main --limit 3 --json conclusion -q '.[].conclusion'; done
# 2. Baseline comparison for a known-red gate (the waiver in rule 2 is invalid without this):
gh run view --job <job-id> --log | tail -20   # read the COUNT, not just the red dot
#    then diff that count against the last recorded baseline in the retro log:
grep -n "violations" backlog/RETROSPECTIVES.md | tail -5
# 3. Every red gate must be quarantined-with-an-owner or genuinely green:
grep -rn "continue-on-error" .github/workflows/*.yml   # each hit needs an owning FOLLOW in a comment
```

---

## Rule AG — Parallel-worktree agents MUST NOT append to a shared monotonic/append-only log (per-agent `lessons.md`, or any single file every worker adds a trailing entry to); write per-ticket fragment files instead

**Pattern:** Two or more concurrently-running agents, each in an isolated worktree, append a
trailing entry to the SAME append-only file (canonically `.claude/agents/<name>/lessons.md`, but any
file whose contract is "add your entry at the end"). Because every writer targets end-of-file, the
merges collide by construction — the second-merged PR hits a non-fast-forward / rebase conflict on
that file even though the two entries have no semantic relationship. This is a MECHANICAL collision
of the append point, not a logical disagreement about content.

**Evidence (≥2 PRIOR numbered retros):** RETRO-213 §PROCESS (PR #618 — `backend-engineer/lessons.md`
append-append collision with merged #617; append-only-log-collision mechanism banked count 1,
explicitly distinguished from RETRO-211/FOLLOW-644's code-CONTRACT conflict) + RETRO-218 §6 (PR #623
— same `backend-engineer/lessons.md`, count 2). Promotion trigger: RETRO-219 (PR #624 — same file,
3rd independent PR); the 2 banked occurrences are both PRIOR retros → ≥2-PRIOR threshold met; the
promoting retro does NOT inflate the count (same adjudication as Rules AA/AB/AC/AD/AE/V/Q). Three
independent PRs (#618/#623/#624) each appended to the SAME monotonic log from separate worktrees.

**Rule:** An agent running in a worktree MUST NOT append to a shared append-only log while other
agents may be running. Write your lesson/entry to a per-ticket (or per-agent-per-session) FRAGMENT
file — e.g. `.claude/agents/<name>/lessons.d/FOLLOW-NNN.md` — never to the shared `lessons.md` tail
(FOLLOW-650 mechanism). A periodic/serial job may concatenate fragments into the rollup. The same
discipline applies to any single file whose only contract is "append your entry at the end" when >1
worker is in flight. The PM sequences bookkeeping writes to genuinely-shared logs (QUEUE.md,
FOLLOW_UPS.md, RETROSPECTIVES.md) either BEFORE dispatch or AFTER completion, never concurrently
(memory `feedback_no_concurrent_git_with_subagents`).

**Distinct axis from:** RETRO-211 / FOLLOW-644 (a code-CONTRACT merge conflict — a semantic
disagreement about the same lines, not a blind append-point collision); Rule A (CI-green before
READY_FOR_REVIEW — governs review status, not merge mechanics).

**Verification:**

```bash
# No file should appear in >1 concurrently-open PR's diff purely as an appended trailing entry:
for pr in $(gh pr list --state open --json number -q '.[].number'); do \
  gh pr diff "$pr" --name-only | grep -E 'lessons\.md$'; done | sort | uniq -d
# Any duplicate = two open PRs both appending to one shared log → collision risk. Prefer fragments:
ls .claude/agents/*/lessons.d/ 2>/dev/null   # fragment dirs should exist once FOLLOW-650 lands
```

### Rule AG amendment (2026-08-05 — RETRO-247 §6 P-30 — the blocked-write fallback and the PM's landing obligation)

**Trigger:** Rule AG tells an agent WHERE its learning entry must go
(`.claude/agents/<name>/lessons.d/<TICKET>.md`, never the shared tail). It says nothing about what
happens when that write is DENIED — and it has now been denied on three consecutive tickets, at
which point the entry's survival depends entirely on whether a human reads the PR description.
Sightings: **RETRO-160 §4d DG-1 / FOLLOW-516** (count 1 — the FOLLOW-513 worker was
permission-blocked from correcting `backend-engineer/lessons.md`; the WRONG lesson stood on disk
until a separate P1 ticket landed it, i.e. the failure mode is real and it cost a ticket cycle),
**RETRO-246 §6 P-30** (count 2 — FOLLOW-813's worker and the RETRO-246 analyst, both blocked, both
preserving the text in the PR body; the PM landed it inside the same PR, and RETRO-246 recorded that
**the PM behaviour is the thing worth codifying** and armed the promotion on the next sighting),
**RETRO-247 §6 P-30** (count 3, the promoting sighting, which does NOT inflate the count — same
adjudication as Rules AA/AB/AC/AD/AE/V/Q/AG's own promotion: FOLLOW-812's worker, `Edit` and `Write`
both denied under `.claude/`, text preserved verbatim in PR #677's "Not done in this PR (environment
limitation, flagged not hidden)" section, pasted in by a human afterwards).

**Adjudicated against the alternatives before amending, per RETRO-246's methodology (read the rule
TEXT, not the title, and ask whether running it verbatim would report the event clean):** this is
**not Rule S** — S governs symmetric sibling sets, not write-permission scope, and RETRO-246 §6
already had to correct a closure note that mislabelled it; **not Rule AH** — AH binds an operator
instruction that cannot execute at its own merge commit, not an agent that cannot write; **not Rule
AI** — AI governs propagating a claim to every document asserting the prior state. Rule AG is the
rule that owns the question _"how does an agent's learning entry reach the durable corpus"_, and all
three sightings are `.claude/` learning-corpus writes, so the amendment is scoped exactly to its
evidence and no wider. **No new letter minted.**

**Amendment — when a mandated write under `.claude/` is refused by the permission system:**

1. **The agent MUST NOT silently drop the entry.** It states, in its PR description AND its final
   report: the exact intended path (`.claude/agents/<name>/lessons.d/<TICKET>.md` — never the shared
   `lessons.md` tail, which Rule AG forbids independently) and the **full text verbatim**, in a form
   a human can paste without editing. "I could not write my lesson" without the text is a dropped
   entry.
2. **The agent MUST NOT work around the block.** It does not change its own permission settings or
   configuration, does not ask another agent to write on its behalf, and does not redirect the entry
   to a file outside `.claude/` (which fragments the corpus and defeats the fragment convention). A
   permission grant is an operator action by construction.
3. **The PM MUST land the text at the named path in the SAME session, before the ticket is closed**,
   and record in the closure note that it did. This is the clause with evidence behind it: in
   RETRO-160 the block cost a full extra ticket cycle (FOLLOW-516, P1) because nobody landed it; in
   RETRO-246 and RETRO-247 the PM landed it immediately and the instances produced no follow-up
   ticket. The delta between those outcomes IS the rule.
4. **A retro MUST record the block as an event, not as a footnote** — including its own, if it is
   blocked. Three consecutive silent occurrences is how a "self-improving" loop quietly becomes a
   manual one.

**Verification:**

```bash
# 1. Every ticket closed in a session should have a fragment, or a closure note that says who landed it:
ls .claude/agents/*/lessons.d/ 2>/dev/null
git log --oneline -20 --name-only -- '.claude/agents/*/lessons.d/*'
# 2. A PR body that says a write was blocked MUST also carry the path and the text:
gh pr view <pr> --json body -q .body | grep -A5 -iE "permission|blocked|could not write"
# 3. The shared tail must NOT be the target (Rule AG parent clause), even in the fallback:
git log --oneline -20 --name-only -- '.claude/agents/*/lessons.md'
```

**Amendment evidence (≥2 PRIOR retros + the promoting retro):** RETRO-160 §4d DG-1 / FOLLOW-516
(prior, count 1) + RETRO-246 §6 P-30 (prior, count 2, which pre-specified the promotion trigger
_"the next numbered retro observing a sandbox-blocked worker whose flagged gap reaches merge (in
either state) cites RETRO-160 + RETRO-246 → ≥2 prior → promote"_ and stated that the rule should
codify the PM behaviour) + RETRO-247 §6 P-30 (the promoting sighting, not counted). The permission
question itself — whether the block should exist at all — is **FOLLOW-835**, an operator decision no
agent may take for itself; this amendment governs conduct while it stands.

<!-- Rule AG AMENDED 2026-08-05 — RETRO-247 §6 P-30 (blocked-write fallback + PM landing obligation; NO new letter). Evidence ≥2 PRIOR numbered retros: RETRO-160 §4d DG-1 / FOLLOW-516 (a worker permission-blocked from correcting backend-engineer/lessons.md; the wrong lesson stood until a separate P1 ticket landed it, count 1) + RETRO-246 §6 P-30 (FOLLOW-813's worker + the RETRO-246 analyst, both blocked, PM landed it in-PR; count 2, and it ARMED the promotion in advance with an explicit trigger). Promoting sighting: RETRO-247 (FOLLOW-812 / PR #677 — third consecutive ticket; does NOT inflate the count, same adjudication as Rules AA/AB/AC/AD/AE/V/Q and AG's own promotion). HOME CHOICE tested against the texts, not the titles: NOT Rule S (symmetric-sibling completeness, not write-permission scope — RETRO-246 §6 had to correct a closure note that mislabelled it, and QUEUE session-102 independently agrees), NOT Rule AH (an operator instruction non-executable at its own merge commit), NOT Rule AI (claim propagation). Rule AG already owns the learning-corpus write PATH, and all three sightings are `.claude/` learning-corpus writes, so the amendment is scoped to its evidence and no wider — amendment precedent = the Rule Y scope-broadening @ RETRO-126 and the Rule S call-site-inventory amendment @ RETRO-112. The permission question itself is FOLLOW-835 (operator decision; an agent must never implement it for itself). RETRO-247 separately DECLINED to amend Rule S on its 2nd consecutive sighting: run verbatim, S's bullets 1 and 3 both fire on PR #677, so it is a compliance failure against an adequate rule, not a rule-text gap -> the remedy is a gate, FOLLOW-834. -->

---

<!-- Rule AG added 2026-07-25 — RETRO-219 §6. Evidence (≥2 PRIOR numbered retros): RETRO-213 §PROCESS
(PR #618 backend-engineer/lessons.md append-append collision w/ merged #617, append-only-log-collision
mechanism count 1, explicitly distinguished from RETRO-211/FOLLOW-644's code-contract conflict) +
RETRO-218 §6 (PR #623, same file, count 2). Promotion trigger: RETRO-219 (PR #624, 3rd independent PR,
same backend-engineer/lessons.md) — the 2 banked occurrences are both PRIOR retros → ≥2-PRIOR threshold
met; the promoting retro does NOT inflate the count (same adjudication as Rules AA/AB/AC/AD/AE/V/Q).
Three independent PRs (#618/#623/#624) each appended a trailing entry to the SAME monotonic log from
separate worktrees → guaranteed EOF collision on each rebase-in-sequence merge. Remedy already ticketed
FOLLOW-650 (per-ticket/per-agent fragment files). DISTINCT axis from RETRO-211/FOLLOW-644 (a code-
CONTRACT merge conflict — a semantic disagreement about the same lines) and from Rule A (CI-green
governs review status, not merge mechanics). Batch gh-pr-merge/mid-queue-rebase (this session, CEO-
authorized): only realized harm was these append-log collisions (now AG); rebase PRESERVATION verified
clean (RETRO-214 confirmed #619's removed sdk.allowed_origins not resurrected) → no separate rule,
subsumed by AG + RETRO-211. LETTER CHOICE: AG is the next in the double-letter sequence after AF. -->
<!-- Rule AF added 2026-07-23 — RETRO-205 §6 (P-1). Evidence (≥2 PRIOR numbered retros): SESSION-RETRO
39 → FOLLOW-591 (Rule I red on main at 179 violations, "a permanently-red gate destroys the signal
value of CI red", count 1) + RETRO-187 §2/§6 (183 violations, promotion explicitly DECLINED at "single
sighting", count 2) + RETRO-188 §5/§6 (+8 in one PR, filed FOLLOW-602, count 3). Promotion trigger:
RETRO-205 (FOLLOW-600/PR #606) — count now 191 (+12 since the remediation ticket was filed; NONE from
the promoting PR, verified against job 89335797339's log rather than assumed), the aggregate CI
workflow conclusion on main is `failure` on every push, and the predicted generalization MATERIALIZED:
a second workflow (`Release`) has been terminal-red on every run in the last 30 (no success in the last
100 — `@estalara/sdk` publish → E403 "owner not found") with ZERO mentions in RETROSPECTIVES.md /
FOLLOW_UPS.md / QUEUE.md / ESCALATIONS.md, while the PR itself was merged on "CI green" as the sole
pre-merge control. The 3 banked occurrences are all PRIOR retros → ≥2-prior threshold met; the
promoting retro does NOT inflate the count (same adjudication as Rules AA/AB/AC/AD/AE/V/Q). DISTINCT
axis from Rule A (PM must WATCH CI go green before READY_FOR_REVIEW — governs whether the status is
checked, not whether a red status still carries information), from Rule Q (a gate that reports GREEN
without ever running its assertion — AF is the mirror image: a gate that reports RED so persistently
that the red carries no information, plus the baseline-comparison obligation), from Rule I itself (the
wired-or-dead CHECK; AF governs what to do when any check goes terminally red), and from Rule AA
(code-vs-prod verdict split). NOT a duplicate of FOLLOW-591/602: those are the remediation tickets for
ONE gate; AF is the behavioural rule that stops the NEXT gate from rotting while 591 sits unscheduled,
and it converts "known red" from a label into a required baseline comparison. Filed FOLLOW-626 (fix or
quarantine the Release workflow) + FOLLOW-628/629 (the pin-expiry limb of point 4). LETTER CHOICE: AF
is the next in the double-letter sequence after AE. -->
<!-- Rule AE added 2026-07-21 — RETRO-196 §6. Evidence (≥2 PRIOR numbered retros, all on
scripts/check-staff-write-atomicity.cjs, ADR-0018 §3a): RETRO-192 §6 (3 bypasses in the v1
presence-only guard — unrelated-tx, helper-factored-audit, raw-SQL-mutation — count 1, explicitly
declined promotion as "same arc as the guard's own authoring") + RETRO-194 §6 (a 4th bypass —
bare-identifier delegated helper call — found by direct reproduction after FOLLOW-608's scope-aware
fix shipped, count 2, also declined as "same arc, 2nd hop"). Promotion trigger: RETRO-196
(FOLLOW-609/PR #597) — independently re-verified FOLLOW-609's fix for bypass 4 is genuinely correct
and live on `main` (guard prints OK not SKIP), then found a 5th bypass (namespace/property-access
delegated call) by a FRESH uncommitted throwaway reproduction, not inferred from a prior retro. Both
RETRO-192 and RETRO-194 used "same arc, not independent" as the reason NOT to promote — but
re-adjudicated against Rule AD's own precedent (RETRO-182's promotion trigger was ALSO "the same
literal, one more structural shape over," across the same guard-family's evolution — i.e. Rule AD's
actual bar was never same-arc-vs-different-arc, it was a genuinely new, independently-found,
previously-unenumerated shape), this crosses the ≥2-PRIOR threshold: 2 banked prior retros (192, 194)
+ this 3rd independent sighting of a yet-newer call-shape. The promoting retro does NOT inflate the
count (same adjudication as Rules AA/AB/AC/AD/V/Q). DISTINCT axis from Rule AD (AD governs
VALUE-LITERAL occurrence shapes in data/config — archetype ids, status enums; AE governs AST
CALL-SHAPE enumeration in security-enforcement guards — which syntactic form a delegated call takes)
and from Rule AC (AC governs FILE-scope-by-audit vs repo-wide grep, the parent scope discipline; AE
is a call-shape-enumeration discipline for a specific class of AST guard). Filed FOLLOW-612 (close
bypass 5) with an explicit note added to FOLLOW-597/598's AC (the next two queued tickets, the
direct beneficiaries/risks) to prefer named imports until it lands. LETTER CHOICE: AE is the next in
the double-letter sequence after AD. -->
<!-- Rule AD added 2026-07-20 — RETRO-182 §6. Evidence (≥2 PRIOR numbered retros): RETRO-179 §6
(the 2 'investor' MOCK_ARCHETYPES subset arrays, invisible to the golden_visa_buyer full-parity
anchor; first retro to separate the multi-anchor SUB-pattern from Rule AC's broad scope-by-audit
pattern — count 1) + RETRO-181 §4b CB-1 (top_archetype: 'family_nester' in
admin/tracer/sessions/route.ts buildMockSessions(), an inline object field invisible to BOTH the
golden_visa_buyer anchor AND the MOCK_ARCHETYPES-name grep — count 2). Promotion trigger: RETRO-182
(FOLLOW-587/PR #563) — FOLLOW-587 swept the RETRO-181 inline-field instances with a value-position
regex `(?:top_archetype|archetype)\s*:\s*'[a-z_]+'` and added a `readonly ArchetypeId[]` compile-time
root-fix on the 3 named MOCK_ARCHETYPES arrays, but a fresh sweep found the SAME invalid family_nester
surviving one sub-shape over — an unquoted object KEY inside a JSON.stringify({...}) blob in
admin/tracer/sessions/history/route.ts buildMockEvents() (archetype_deltas), invisible to all THREE
anchors used to date. This is a genuinely new 3rd structural sub-shape and the 2nd-PRIOR sighting
RETRO-180 §6 / RETRO-181 §6 pre-authorized as the threshold-crosser ("the next genuine
anchor-INVISIBLE find … the 3rd total / 2nd prior — that one crosses the threshold and Rule AD should
be promoted then"). The 2 banked occurrences are both PRIOR retros → ≥2-prior threshold met; the
promoting retro does NOT inflate the count (same adjudication as Rules AA/AB/AC/V/Q). DISTINCT axis
from Rule AC (the PARENT scope-by-audit-not-by-grep discipline — AC governs enumerating every FILE the
audit named vs. a repo-wide grep; AD governs enumerating every structural SHAPE the literal occupies
vs. a single grep anchor, and the compile-time-type-over-grep-guard preference — AC failure-mode (a)
made a standalone rule) and from Rule J (byte-identical cross-runtime FILE mirror sync via a
manifest), Rule Z (producer/consumer TEST-contract across a language boundary), and Rule Q
(check-reports-status-but-never-runs). Filed FOLLOW-589 (fix the family_nester JSON-key literal in
history/route.ts + guard the tracer JSON-blob archetype-key shape). LETTER CHOICE: AD is the next in
the double-letter sequence after AC. -->
<!-- Rule AC added 2026-07-18 — RETRO-178 §6. Evidence (≥2 PRIOR numbered retros): RETRO-053 →
RETRO-055 (FOLLOW-264 3-limb scope missed the SDK + LocaleSchema axes, count 1) + RETRO-107 §7 →
RETRO-108 (FOLLOW-384's HW-3 closure scoped to the redis_writer hop only; RETRO-108 found the
un-enumerated SDK-chat-emit→ingest producer chain, count 2). Promotion trigger: RETRO-178
(FOLLOW-561/PR #552) — the archetype-ID parity guard scoped to 3 audit-named files; a repo-wide grep
found a 4th, production-live full-parity copy (generate_description.py _ARCHETYPE_GUIDANCE, silent
fallback, no alert) plus 2 subset copies, one already broken (family_upsizer, not a canonical
archetype). The 2 banked occurrences are both PRIOR retros → ≥2-prior threshold met; the promoting
retro does NOT inflate the count (same adjudication as Rules AA/AB/V/Q). DISTINCT axis from Rule J
(byte-identical cross-runtime FILE mirror sync, enforced via a manifest + check-mirror-files.sh) — AC
governs the TICKET-SCOPING discipline for enumerating every instance of a literal-set class before a
guard is written, not the mechanism of the guard itself; and from Rule P (check docs/repo for prior
art before proposing a ticket — governs not duplicating existing work, the inverse concern). Filed
FOLLOW-583 (extend the FOLLOW-561 guard to the 4th full-parity copy + 2 subset copies + fix the
family_upsizer typo) — qa-engineer, P2, 3h. LETTER CHOICE: AC is the next in the double-letter
sequence after AB. -->

<!-- Rule AB added 2026-07-10 — RETRO-170 §6. Second double-letter rule (continues the AA… sequence; single letters A–Z exhausted per the Rule AA note). Evidence (≥2 PRIOR numbered retros): RETRO-105 §6 LG-1 (refreshDirectives overlap, no in-flight guard, count 1, held → FOLLOW-380) + RETRO-169 §4a LG-1 (FOLLOW-380's single synchronous :737 checkpoint left the fire-and-forget applyDescriptionAdaptation tail uncovered, count 2, held → FOLLOW-546). Promotion trigger: RETRO-170 (FOLLOW-546/PR #495) — the fix closed the fetch-in-flight window (isStale re-check at adapt-description.ts:309) but a residual gap remained; the class re-relocated a THIRD hop (sync-checkpoint → fire-and-forget tail → the reapply-closure's deferred write) with a persistent-stale leg (uncached superseding listing + self-reinforcing MutationObserver). CITATION CORRECTION (FOLLOW-548, 2026-07-10, PR #501): this footnote originally attributed the residual gap to "the DOM write is rAF-DEFERRED (:323/:333), so the guard covers the rAF scheduling not the deferred write" — FOLLOW-548 proved `:323`/`:333` (`requestAnimationFrame(applyAndObserveSlot(...))`) evaluate their `applyAndObserveSlot`/`applyAndObserveHeadlineSlot` argument SYNCHRONOUSLY (JS eager argument evaluation), so the initial write was already covered by the `:309` check; the genuinely deferred, unguarded write is the `reapply` loop-guard closure, re-invoked LATER via the MutationObserver's OWN internal requestAnimationFrame (independent of the caller's initial rAF schedule) — this is what the "persistent-stale leg" sentence above was actually describing. The promotion adjudication itself (2 banked prior retros, 3rd-hop re-relocation trigger) is unaffected by this correction. This is EXACTLY RETRO-169 §6's pre-authorized "the discovery that FOLLOW-546's fix itself re-relocates the guard gap" trigger — NOT the naive "FOLLOW-546 merged = 3rd sighting" (a clean fix landing is not a new bug sighting; had the fix been fully clean I would have banked at count 2 and NOT promoted). The 2 banked occurrences are both PRIOR retros → ≥2-prior threshold met; the promoting retro does NOT inflate the count (same adjudication as Rules AA/V/Q). DISTINCT axis from Rule R (rehydrate-boundary idempotency — governs re-run-safety across a rehydrate, not concurrency across overlapping navs; RETRO-105 explicitly noted the adjacency-but-distinctness), Rule K.2 / its fire-and-forget amendment (governs OBSERVABILITY of a failed sink, whereas AB governs the CORRECTNESS of a latest-wins guard across an async tail), and Rule AA (code-vs-prod verdict axis). Filed FOLLOW-548 (guard the rAF-deferred write + close the never-stale-default footgun + fix the adapt.description.skipped JSDoc) — DONE, PR #499. LETTER CHOICE: AB is the next in the double-letter sequence after AA; flag for human review if a different scheme is preferred. -->
<!-- Rule AA added 2026-07-02 — RETRO-152 §9. First double-letter rule: single letters A–Z are exhausted (A–P, R–Z used; M/V reclaimed/backfilled; Q is the retro-analyst INERT-GATE rule) so the retro-analyst promotion continues into the AA… sequence. Evidence (≥2 prior numbered retros): RETRO-146 §5a/§7 (FOLLOW-442 code axis closed, prod holdout-write attestation left open, count 1) + RETRO-150 §3/§5a (FOLLOW-455 code axis closed; FOLLOW-449's ClickHouse apply named operator-only, count 2). Promotion trigger: RETRO-152 (FOLLOW-450/PR #426) — entire ticket CODE_COMPLETE_OPERATOR_PENDING; the 2 banked occurrences are both PRIOR retros → ≥2-prior threshold met; the promoting retro is the 3rd sighting and does NOT inflate the count (same adjudication as Rules V/Q). DISTINCT axis from Rule A (PM must verify CI-green before READY_FOR_REVIEW — governs the review-status gate, not the code-vs-prod split), Rule M (a job CLAIMED to auto-apply must actually target prod — governs a false automation claim, whereas AA governs a ticket HONESTLY marked operator-pending being wrongly closed DONE), and RETRO-121 §6 Pattern C (CI-leg-runs-but-prod-state-unverified — AA is the ticket-status/verdict discipline for that class). Cross-refs the F-06 operator attestation folded into the pilot go-live checklist / FOLLOW-471 DoD. LETTER CHOICE FLAGGED FOR HUMAN REVIEW: first use of a double-letter rule id — adjust if a different scheme is preferred. -->
<!-- Rule Q added 2026-07-01 — RETRO-145 §6. Evidence: RETRO-006 §Pattern C (PR #130 E2E spec opt-in-behind-a-flag-CI-never-sets, assertion never runs, count 1 — RETRO-006 explicitly pre-authorized "promote on a 2nd 'test exists but doesn't run' sighting") + RETRO-007 §4b CB-1 (PR #137 demo-integration.yml "soft-skip inception — structurally present but never actually runs against a real DB", P2 → FOLLOW-079, count 2; distinct PR/file/mechanism AND the failed remediation of RETRO-006's gap). Promotion trigger: RETRO-145 (PR #403/FOLLOW-446) — archetype-embeddings-not-null gate had three stacked blindnesses (TS2307 build-order / ERR_MODULE_NOT_FOUND bare-specifier / postgres-js socket-hang no-exit no-timeout) all masked by continue-on-error; the gate never ran its assertion until this fix. The 2 banked occurrences are both PRIOR retros → ≥2-prior threshold met; the promoting retro is the 3rd sighting and does NOT inflate the count (same adjudication as Rule V). Letter Q: the placeholder explicitly reserved for exactly this retro-analyst promotion (see the "Rule Q+ added by retrospective-analyst when RULE_PROMOTION_THRESHOLD (2) is met" note and the Q-reservation references in the Rule M/V provenance comments). DISTINCT axis from Rule A (PM must watch CI-green before READY_FOR_REVIEW — governs whether the human/PM verifies status, not whether the gate's own assertion ran), Rule Y (a docstring/test-header CITATION must be verified against the cited file — governs claims-about-a-check, whereas Q governs a check that reports a status but never executes), Rule L (prod install path must PRODUCE the config a consumer reads), and RETRO-121 §6 Pattern C (CI-leg-runs-but-prod-state-unverified — the inverse: Q is CI-leg-reports-status-but-never-runs). Filed FOLLOW-447 (audit sibling ci.yml gates for the 3 failure modes + add defense-in-depth timeout-minutes to all jobs); the continue-on-error scoping for the archetype gate is FOLLOW-446 (pre-existing, not re-filed). -->
<!-- Rule V added 2026-06-26 — RETRO-123 §6. Evidence: RETRO-118 §6 Pattern B (PR #357/FOLLOW-358 file-wide route.ts paths exemption, BAD shape, count 1) + RETRO-121 §6 Pattern B (PR #360/FOLLOW-394 token-scoped regexes for the migration filename in script+runbook, GOOD shape, count 2 — RETRO-121 pre-authorized "promote on the NEXT (3rd) sighting"). Promotion trigger: RETRO-123 (PR #362/FOLLOW-396) performed the strip-the-superseded delete; the 2 banked occurrences are both PRIOR retros, ≥2-prior threshold met (the promoting PR is itself a remediation and does NOT inflate the count — the discipline RETRO-122 guarded is respected; the count came from 118+121, adjudicated independent by RETRO-121 via different trigger sites + remediation shapes). DISTINCT axis from Rule U (typed-column-vs-JSONB strip-on-supersede — a data-modeling rule; Rule V is the secret-scanning-config sibling of U's strip-the-superseded clause) and from Pattern G / FOLLOW-083 (legitimate test-fixture/doc paths exemptions, which Rule V explicitly excludes). Filed FOLLOW-406 (negative-control attestation for route.ts) + FOLLOW-407 (apply Rule V to the live 2nd instance: the FOLLOW-374 consent platform-registration paths exemption). Letter choice: single letters A–Z were exhausted (Q reserved as the retro-analyst placeholder); V had been "intentionally skipped" only as a 2026-06-13 sequencing artifact (per the Rule W note) with no semantic reservation, and is now the sole remaining single letter once M was consumed — so V is RECLAIMED here on the same backfill logic Rule M used ("the sole genuinely-unused letter"). -->
<!-- Rule M added 2026-06-25 by CEO directive (Piotr) — threshold also met independently: RETRO-076 §6 (FOLLOW-307 migrations-don't-auto-apply-in-prod, count 1) + RETRO-113 §6 (FOLLOW-341/PR #352 archetype-seeder post-migrate-seed.yml dev-only → prod archetype_embeddings stay NULL → §F cosine inactive in prod, count 2). DISTINCT axis from Rule H (wired-or-dead, gates source-importers) and Rule O (migration-journal monotonicity, gates the journal): Rule M governs the CLAIM that automation reaches PROD when the workflow only targets dev. Filed/cross-refs FOLLOW-392 (operator seed prod archetype_embeddings) + FOLLOW-308. Letter choice: single letters A–Z are exhausted except M (the sole genuinely-unused letter — Q is the reserved `Rule Q+` retro-analyst placeholder; V is intentionally skipped per the Rule W note), so the backfilled M is assigned here. -->
<!-- Rule Z added 2026-06-20 — RETRO-098 §6 (P-XLANG-PAYLOAD-CONTRACT: parent "mock-can't-catch-cross-runtime-mismatch" family now 4 instances — RETRO-068 ingest dual-write INSERT body the mock fetchImpl accepts but ClickHouse rejects, count 1; RETRO-078 CH tracer query mock-fetch green but live engine 386s, count 2; RETRO-079 closure required a dedicated live-ClickHouse CI job because mocks structurally could not catch it; RETRO-098 §3 HW-1 SDK(TS) emits chat.message.sent {message,…} but Python _spawn_chat_nlp reads payload.content → spawn never fires for real traffic, both sides green because the Python test invents {role,content} fixtures, count 4; threshold long exceeded). DISTINCT axis from Rule J (byte-identical cross-runtime FILE mirror sync) — Rule Z governs the TEST CONTRACT across a producer/consumer language boundary, not duplicate source files; and from Rule L (missing-attribute) / Rule Y (over-claimed citation). Filed FOLLOW-366 (fix the payload-key mismatch with a producer-shape-grounded fixture) + FOLLOW-368 (live-Upstash round-trip smoke). Next free Rule letter was Z (V skipped per the Rule W note; W,X,Y used). -->
<!-- Rule Y added 2026-06-18 — RETRO-089 §6 (RETRO-084 §4d DG-1 false/absent drift-guard citation, count 1 held as over-claimed-verification meta-pattern + RETRO-089 §4d DG-1 wrong-file guard citation introduced BY the FOLLOW-331 fix for RETRO-084's instance, count 2; threshold met). DISTINCT axis from Rule L (missing-attribute) / Rule K.2 (provenance-enum round-trip) / Rule Q (mirrored-test blind spot) — those govern the test MECHANICS; Rule Y governs the CITATION (a named artifact claimed as proof must perform the cited check). Filed FOLLOW-338 to fix the intent-weights.test.ts:28-30 mis-pointer + reconcile the migration-0030 third copy. Next free Rule letter was Y (Rule V skipped per the Rule W note; W, X used). -->

<!-- Rule X added 2026-06-14 — RETRO-075 §6 (RETRO-074 §4b CB-1 base-URL-FORM mismatch, count 1, with an explicit promote-on-confirmation condition + RETRO-075 §4b CB-1 confirming FOUR independent double-/api fetch sites fixed via buildEndpoint, count 2; threshold met). DISTINCT axis from Rule L (missing-attribute) — RETRO-074 §6 explicitly kept them as separate roots/sibling rules for sibling axes of the same install-snippet→SDK-consumer meta-shape. The remedy (buildEndpoint helper + prod-snippet-base tests) shipped in PR #291. Filed FOLLOW-306 to bring the LAST fetch site (adapt-description.ts, the un-migrated 6th) under the helper + add a dedicated endpoint.test.ts. Next free Rule letter was X (Rule V intentionally skipped per the Rule W note). -->
<!-- Rule W added 2026-06-13 — RETRO-060 §6 (FOLLOW-286/PR #279 RENAME+ADD-COLUMN-NOT-NULL apply-time failures + FOLLOW-287/PR #281 MODIFY COLUMN error 524 on ORDER BY key column, both merged green, count 2 on the intent_events sort-key DDL; threshold met). Filed FOLLOW-291 to build the pre-merge guard + ephemeral-apply gate, FOLLOW-290 to rebuild intent_events with the correct ORDER BY (tenant_id, session_id, event_at). Note: Rule V intentionally not used (skipped from the prior sequence); next free letter was W. -->
<!-- Rule U added 2026-06-11 — RETRO-052 §6 (RETRO-049 §4a LG-2/§5d + RETRO-050 §4a LG-1/§5d + RETRO-051 §4a LG-2/§5d, count 3 on tenants.quiz_config; re-confirmed RETRO-053 §5d + RETRO-052 §4a LG-1, threshold long exceeded). The decay recurred key-by-key because each fix annotated/partial-removed without a blob-level policy; this rule converts the recurring per-key fix into a policy. Filed FOLLOW-271 to apply it to quizConfig.enabled. -->
<!-- Rule T added 2026-06-10 — RETRO-049 §6 (RETRO-047 §4b CB-1 + RETRO-049 §4b CB-1, Vitest v2 vi.fn type-arg → CI-only typecheck escape, threshold met). Process rule (no shipped defect); does NOT mandate hook reconfiguration (devops escalation). -->
<!-- Rule R added 2026-06-08 — RETRO-037 §6 (RETRO-032 LG-1 + RETRO-037 LG-1, threshold met). -->
<!-- Rule S added 2026-06-09 — RETRO-045 §6 (RETRO-044 §4a LG-1/§6 + RETRO-045 §4c TG-1/§4a LG-1, threshold met; RETRO-044 set the explicit promote-on-2nd-instance condition). -->
<!-- Rule Q+ added by retrospective-analyst when RULE_PROMOTION_THRESHOLD (2) is met -->
<!-- Rule P added 2026-06-01 by direct CEO directive (provenance noted in-rule), not retro-promoted -->
<!-- Rule K.2 amendment (fire-and-forget HTTP-rejection observability sub-shape) added 2026-06-28 — RETRO-135 §6 (RETRO-118 §4 CB-1 ClickHouse logDecisionAsync .catch-only silent-swallow, remediated by FOLLOW-425/PR #374, count 1 + RETRO-135 §4b CB-1/CB-2 Redpanda publishAbAssignmentEvent + publishDescriptionRequested same res.ok-blind shape, count 2; 2 independent backend contexts — ClickHouse HTTP interface + Redpanda REST proxy — threshold met). NOT a new rule letter: shares K.2's root ("a configured-but-failed store must be observable"); the fire-and-forget sink just can't fail loud by throwing, so the obligation is res.ok-in-.then + .catch, both → Sentry. The parent K.2 greps were themselves blind to this sub-shape (a bare `await fetch()` + a fire-and-forget `.catch()` match neither `catch(() =>` nor `.then((r)=>r.json())`). Filed FOLLOW-426 to harden the 2 control-plane Redpanda publishers. Reference impls: logDecisionAsync (post-FOLLOW-425) + decision-api pushToRedpanda (redpanda-producer.ts:102). -->

## Rule AH — A doc that gives an operator an executable instruction (or asserts a capability) MUST be verified against the code AT THE DOC'S OWN MERGE COMMIT; support that lives in an unmerged sibling PR is written as BLOCKED-ON-#N or omitted, never as a runnable step

**Pattern:** A runbook step, schema doc-comment, ADR or MASTER_DESIGN section describes behavior the
code does not implement — a `curl` whose fields the receiving route does not parse, a column
"projected at provisioning" by projection code that does not exist, an enforcement control the
request path never reads. The author verified against a ticket stub, a sibling worktree, or an
intention, rather than against the tree the doc merges into. The failure is silent by construction:
the operator runs the step, gets a 200, and believes a control/identity/allow-list is in place.
Under an operating model where the client has no dashboard, **the runbook IS the UI**, so a wrong
command is a functional defect with a compliance blast radius, not a documentation nit.

**Evidence (≥2 PRIOR numbered retros):** RETRO-216 §4d DG-1/DG-2 (PR #621 — the brand-provisioning
runbook's Step 6 instructs the operator to set `tenants.allowed_origins` "via whatever admin surface
FOLLOW-642 ships" and describes a per-request Postgres read; merged #623 reads the KV `ApiKeyRecord`
and ships no admin surface. Step 5 documents a feature as unshipped that had merged. Count 1) +
RETRO-218 §4d DG-1 (PR #623 — the FIX for the first over-claim introduced a **second-generation**
one: `packages/db/src/schema/tenants.ts` and MASTER_DESIGN §V.3.4 state the column is "projected
onto the api-key KV record at provisioning"; a repo-wide grep finds zero writes to `KV_API_KEYS`
anywhere. Count 2). Corroborating, pre-dating both: **ESC-040 / RETRO-205 CHECK B**
(`packages/db/src/schema/api_keys.ts:33` + MASTER_DESIGN §5021 assert SDK origin validation against
`tenant.allowed_origins` while ingest CORS read a hardcoded env list — "a UI that promises a
security control it does not provide is worse than no UI"). Promotion trigger: **RETRO-220** (PR
#625 — `docs/runbooks/BRAND_PROVISIONING.md` §Step 3a shipped a copy-pasteable
`PATCH /api/config -d '{"brand":{"brand_name":…,"legal_entity":…}}'` while the route at that exact
merge commit parsed only `primary_color`/`logo_url`/`white_label` in a **non-strict** Zod object —
silent strip, HTTP 200, nothing written, and the whole-blob rewrite would erase a hand-seeded
identity; the same section simultaneously stated "no in-repo code writes these keys". Proven with
`git show f0a2310:apps/control-plane/src/app/api/config/route.ts:116-137,322` and corroborated
verbatim by the later fix's own correction, `BRAND_PROVISIONING.md:242-247` @HEAD, PR #629). The 2
banked occurrences are both PRIOR retros → ≥2-PRIOR threshold met; the promoting retro does NOT
inflate the count (same adjudication as Rules AA/AB/AC/AD/AE/V/Q/AG). Four sightings, three distinct
document families (schema doc-comment + MASTER_DESIGN, runbook Step 6, runbook Step 3a).

**Rule:** Before merging a doc that (a) instructs an operator to run something, or (b) asserts that
a value is written/projected/enforced by the system, the author MUST open the receiving code AT THE
COMMIT THE DOC WILL MERGE INTO and show the accepting parse — the Zod key, the column write, the KV
field, the request-path read. A claim whose support sits in an unmerged sibling PR is written as
`BLOCKED ON #N — do not run until merged`, or left out; it is never rendered as a runnable command.
A document that BOTH flags "nothing in code writes X / X is operator-seeded" AND supplies a command
to write X is self-contradictory by construction and must not merge. When a doc's claim is
aspirational, say which ticket owns the gap and what the reader must NOT infer (the honest shape
RETRO-218 credited: "the ENFORCEMENT is live; the PROJECTION is aspirational").

**Distinct axis from:** Rule N (compliance/privacy documents disclosing behavior to END USERS before
a go-live gate — AH governs internal operator instructions, and fires on the very first merge, not
at a gate); Rule M (a job/seed/migration claiming to self-apply in PROD while its automation is
dev-only — AH covers hand-executed instructions with no automation at all); Rule Y (a docstring
citing a named test/file as proof a guard runs in CI — a citation-integrity rule, not an
executability rule); Rule L (the production install/snippet path must PRODUCE the config a consumer
reads — a code-to-code wire, not a doc-to-code one); Rule AA (code-vs-prod split for
operator-pending tickets — AH is about whether the operator's instruction can work at all, AA about
whether anyone has run it yet).

**Verification:**

```bash
# 1. Self-contradiction signature: a step that says nothing writes X and then writes X.
grep -n -A 25 -E 'operator-seeded|no in-repo code writes|FAIL-SILENT HAZARD' docs/runbooks/*.md \
  | grep -nE 'curl|psql|wrangler .* put|doppler secrets set'

# 2. For every field a runbook curl sends, prove the receiving route parses it (example: /api/config).
grep -o -E '"[a-z_]+":' docs/runbooks/BRAND_PROVISIONING.md | sort -u
grep -nE '^\s+[a-z_]+: z\.' apps/control-plane/src/app/api/config/route.ts
# every documented key must appear in the route's schema — at the doc's OWN merge commit:
git show <doc-merge-sha>:apps/control-plane/src/app/api/<route>/route.ts | grep -n 'z\.'

# 3. Capability claims in schema/ADR/MASTER_DESIGN prose must name a real writer/reader:
grep -rn 'projected|enforced|validated against|seeded at provisioning' packages/db/src/schema/*.ts docs/MASTER_DESIGN.md \
  | while read -r hit; do echo "$hit"; done   # each hit needs a grep proving the code path exists
```

---

<!-- Rule AH added 2026-07-26 — RETRO-220 §6. Evidence (≥2 PRIOR numbered retros): RETRO-216 §4d DG-1/DG-2
(PR #621 brand-provisioning runbook Step 6 documents a PG per-request read + an admin surface that merged
#623 does not have; Step 5 documents a shipped feature as unshipped — count 1) + RETRO-218 §4d DG-1 (PR #623
— the FIX introduced a second-generation over-claim: tenants.ts + MASTER_DESIGN §V.3.4 "projected onto the
KV record at provisioning" with zero KV_API_KEYS writes repo-wide — count 2). Corroborating and pre-dating
both: ESC-040 / RETRO-205 CHECK B (api_keys.ts:33 + MASTER_DESIGN §5021 assert origin validation the ingest
path never performed). Promotion trigger: RETRO-220 (PR #625 — runbook §Step 3a's PATCH /api/config curl was
non-executable at its own merge commit f0a2310: the brand Zod object knew only primary_color/logo_url/
white_label, was non-strict so unknown keys were silently stripped → 200 with nothing written, and the
whole-blob rewrite would have WIPED a hand-seeded legal identity; the same section also stated "no in-repo
code writes these keys". Verified by git show f0a2310 and corroborated verbatim by PR #629's own runbook
correction at BRAND_PROVISIONING.md:242-247. Closed 2h39m later by #629/3ecec7f, so no remediation ticket —
the recurrence-prevention leg is FOLLOW-662). The 2 banked occurrences are both PRIOR retros → ≥2-PRIOR
threshold met; the promoting retro does NOT inflate the count (same adjudication as Rules AA/AB/AC/AD/AE/V/
Q/AG). Four sightings across three distinct document families. DISTINCT axis from Rule N (end-user
compliance disclosure at a go-live gate), Rule M (dev-only automation paired with a prod-effect claim),
Rule Y (docstring citing a named test as CI proof) and Rule L (production install path produces the config).
ARCHITECTURAL PREMISE (RETRO-220 §5d): under the CEO's no-client-dashboard model the runbook IS the operator
UI, so an unexecutable step is a functional defect, not a docs nit. LETTER CHOICE: AH is the next in the
double-letter sequence after AG. -->

## Rule AI — A change that makes a capability/contract claim true or false MUST update every document asserting the prior state IN THE SAME PR — including `backlog/HANDOFFS.md` integration contracts and the changed file's own API docblock

**Pattern:** The inverse direction of Rule AH. There, a doc is authored ahead of the code and is
false at its own merge commit. Here, the doc was CORRECT when written and a later PR silently
falsifies it: the code author changes a behavior, flag, response contract or capability and leaves
every sentence asserting the prior state untouched. The stale sentence then steers an operator, a
worker, or an integrating team wrong — and unlike Rule AH's case, nobody is looking, because the doc
was reviewed and correct once. The highest-severity variant is a contract handed to a consumer
OUTSIDE this repo: they cannot read our diff, they will not notice, and we cannot fix their code.
Operating Principle 2 (continuous propagation) covers this in prose only, and CONVENTIONS_PATCH
takes precedence over prose — so it needs a mechanised rule.

**Evidence (≥2 PRIOR numbered retros):** **RETRO-213 §4d DOC-1** (PR #618 correctly fixed the
specific false claim at `MASTER_DESIGN.md:5022-5028` but left three adjacent §V statements — the
trust-boundary diagram `:4773`, the STRIDE Spoofing row `:4801`, the `api_keys` code sample `:5052`
— presenting origin validation as a per-tenant control it is not; propagation of the _sibling_
claims never happened → FOLLOW-649. Count 1) + **RETRO-221 §6 P-1** (PR #626 flipped three
capability claims and updated none: `BRAND_PROVISIONING.md:221` + `INTERFACES.md:99/:108` now FALSE
about `white_label`, so an operator would skip the field for three incoming brands;
`ADR-0019:135/:300` stale; `ci.yml:226` "<40KB" against a measured 41.31 KB. The pattern was
formally HELD at 1 prior and **ARMED**: "the next numbered retro observing this cites RETRO-213 +
RETRO-221 → ≥2 prior → promote". Count 2). Promotion trigger: **RETRO-222 §4d DG-1/DG-2** (PR #627 —
two instances in one PR: (a) `backlog/HANDOFFS.md:2842`, the integration contract for the
out-of-repo `app.estalara.com` caller, still says `consent_text_hash` is _"optional; omit to use the
canonical EN §6.1 SHA-256 hash"_ after #624 and #627 added three states in which omission returns
400 — and the same handoff tells that caller at `:2865` to abort investor account creation on any
non-2xx≠409, so the stale sentence plus the new status compose into a registration outage the
integrating team was never told about; (b) the changed route's own `Responses:` docblock,
`route.ts:32-38`, was not extended by the very PR that added the response). The 2 banked occurrences
are both PRIOR retros → ≥2-PRIOR threshold met; the promoting retro does NOT inflate the count (same
adjudication as Rules AA/AB/AC/AD/AE/V/Q/AG/AH). **Deliberately NOT counted:** RETRO-220 §4a LG-1 —
that is the Rule AH direction (doc authored ahead of code), and double-counting it across two rules
would inflate both.

**Rule:** A PR that changes the truth-value of a claim (a flag's effect, a field's optionality, a
response contract, "X has no consumer yet", "Y is not yet shipped", a measured budget) MUST, in the
same PR, grep the ticket ID, the flag/env name, the symbol and the endpoint path across `docs/`,
`docs/runbooks/`, `backlog/HANDOFFS.md`, ADRs and the changed file's own docblock, and update every
sentence asserting the prior state. Three tiers, all non-optional:

1. **Out-of-repo integration contracts (`backlog/HANDOFFS.md`, compliance handoffs) — P1.** If the
   consumer is another team's system, the handoff is the only channel that exists; append a dated
   update block (do not rewrite history) naming the new states and what the caller must now do.
2. **Operator-facing runbooks — P1.** Under the no-client-dashboard model the runbook is the UI.
3. **In-file API docblocks, ADRs, MASTER_DESIGN, CI step labels — P2**, and the changed file's own
   docblock is never exempt: a PR that adds a response/parameter and does not list it there is
   incomplete by definition.

A behavioral change whose blast radius is stated more narrowly in a doc than in the code (e.g. "only
external tenants get the 400" when the guard fires for every tenant) is the same defect as an
outright false sentence — scope understatement is falsification.

**Distinct axis from:** Rule AH (same subject, opposite direction and opposite owner — AH binds the
DOC author at the doc's own merge commit; AI binds the CODE author to the docs their change
falsifies); Rule N (end-user compliance disclosure evaluated at a go-live gate, not at merge); Rule
M (prod-effect claimed for dev-only automation); Rule Y (a docstring citing a named test as CI proof
— citation integrity); Rule AA (whether an operator has RUN the step, not whether the step's
description is still true).

**Verification:**

```bash
# 1. Every ticket ID in the PR: what does the doc corpus still say about it?
grep -rn "FOLLOW-<n>\|<FLAG_NAME>\|<symbolName>" docs/ backlog/HANDOFFS.md CONVENTIONS_PATCH.md \
  | grep -viE 'RETROSPECTIVES|FOLLOW_UPS'

# 2. Prior-state signatures that a shipping PR most often falsifies:
grep -rn -E 'optional|no consumer yet|not yet (shipped|wired|enforced)|only (external|non-first-party)|parsed but' \
  docs/ backlog/HANDOFFS.md

# 3. The changed file's own contract block must list what the PR added:
git diff origin/main -- '<route>.ts' | grep -E '^\+.*(status: [45][0-9][0-9]|NextResponse.json)'
sed -n '/^ \* Responses:/,/^ \*\//p' <route>.ts   # every added status must appear here

# 4. For an out-of-repo consumer, prove the handoff was updated in THIS PR:
git diff --name-only origin/main | grep -q 'backlog/HANDOFFS.md' || echo 'FAIL: external contract changed, handoff not touched'
```

### Rule AI amendment (2026-08-05 — RETRO-246 §6 P-29 — the EXECUTED instruction corpus outranks prose)

**This is an AMENDMENT to an already-promoted rule, not a new rule.** No new letter was minted and
the ≥2-PRIOR-retro promotion gate is not invoked: the pattern (a doc left asserting a state a change
falsified) is Rule AI itself, and RETRO-246 is its **4th** sighting after RETRO-213 / RETRO-221 /
RETRO-222. What the amendment closes is a hole **in this rule's own controls**, demonstrated rather
than hypothesised.

**Trigger (RETRO-246 / FOLLOW-813 / PR #675).** The PR replaced the mandated pre-`READY_FOR_REVIEW`
CI gate (`gh pr checks <pr> --watch` → `scripts/gh-pr-checks-verified.sh <pr>`) and updated
`CLAUDE.md`, `docs/AGENT_WORKFLOW.md` and Rule A above — the prose. It left the **four agent
definition files the agents actually load and execute** hardcoding the retired, known-broken
command, including `.claude/agents/pm-orchestrator.md` §5b, the PM's own NON-NEGOTIABLE CI gate —
i.e. the fix updated the description of the control and not the control. Caught only by a human
during PM validation and repaired on top of the worker's diff (`8e91e4e3`). **Run verbatim, the
Verification block above would have reported this PR clean:** its greps cover `docs/`,
`backlog/HANDOFFS.md` and `CONVENTIONS_PATCH.md`, and `.claude/` appears in none of them; and the
three-tier severity list has no tier for a file whose text IS an executed instruction.
Corroborating, pre-dating, and NOT counted (different axis — a wrong lesson rather than a falsified
claim): **RETRO-160 §4d DG-1 / FOLLOW-516**, where the same corpus stood wrong on disk and was
actively trusted by the next ticket.

**Amendment — add a tier 0 above the existing three, and treat it as strictly higher priority than
tier 1:**

0. **Executed / loaded instruction corpora — P0-in-tier, do it FIRST.** Any file whose text is
   consumed as an instruction by an executing agent or by automation rather than read by a human:
   `.claude/agents/*.md`, `.claude/hooks/*`, `.github/workflows/*.yml` `run:` steps and step labels,
   `package.json` scripts, `lefthook.yml`. When a PR changes a mandated command, flag, script path
   or procedure, these are updated **before** the prose that describes them — prose that is right
   while the executed instruction is wrong is strictly worse than both being wrong, because the PR
   reads as complete. If the authoring agent is **permission-blocked** from writing the file (a real
   and recurring condition under `.claude/`), it MUST say so in the PR description naming the exact
   file and the exact replacement text, and the reviewer MUST land it in the same PR — not defer it
   to a follow-up ticket.

**Amended Verification (add to the block above):**

```bash
# 5. Tier 0 — the corpus that EXECUTES the instruction, not the corpus that describes it.
#    Replace <retired-command> with the exact string the PR retires.
grep -rn "<retired-command>" .claude/ .github/workflows/ package.json lefthook.yml 2>/dev/null \
  | grep -v "lessons.md\|lessons.d/"      # historical self-records are exempt; mandates are not
# Any hit that is a MANDATE (not a "do NOT use X" warning) fails this rule, green CI notwithstanding.

# 6. Coverage, not just absence: every agent definition that opens PRs must carry the CURRENT command.
grep -L "<new-command>" .claude/agents/*.md   # each listed file needs a written exemption
```

**Evidence for this amendment:** RETRO-246 §3 HW-1/HW-2, §4a LG-2, §6 P-29 (PR #675 — prose updated,
4 agent definitions left on the retired command, incl. the PM's own §5b gate; and post-fix the
consumer coverage is still 4 of 9 agent definitions → FOLLOW-828) + RETRO-160 §4d DG-1
(corroborating, same corpus, different axis, NOT counted). Distinct from Rule S, which governs
whether all siblings of a symmetric set were changed; this governs which corpus is authoritative
when only some were.

---

<!-- Rule AI added 2026-07-26 — RETRO-222 §6. Evidence (≥2 PRIOR numbered retros): RETRO-213 §4d DOC-1
(PR #618's §V.3.4 correction left 3 adjacent §V claims — :4773 diagram, :4801 STRIDE row, :5052 code sample —
asserting the prior state → FOLLOW-649; count 1) + RETRO-221 §6 P-1 (PR #626 falsified BRAND_PROVISIONING:221,
INTERFACES:99/:108, ADR-0019:135/:300 and ci.yml:226 and updated none; the pattern was HELD at 1 prior and
explicitly ARMED for the next sighting citing RETRO-213 + RETRO-221; count 2). Promotion trigger: RETRO-222
§4d DG-1/DG-2 (PR #627 — TWO instances in one PR: HANDOFFS.md:2842 still tells the out-of-repo
app.estalara.com caller that consent_text_hash is "optional" although #624/#627 added three states where
omission is a 400, while HANDOFFS.md:2865 tells that same caller to abort investor account creation on any
non-2xx≠409; and the route's own Responses: docblock at route.ts:32-38 was not extended by the PR that added
the response). Both banked occurrences are PRIOR retros → threshold met; the promoting retro does NOT inflate
the count (adjudication shared with AA/AB/AC/AD/AE/V/Q/AG/AH). RETRO-220 §4a LG-1 deliberately NOT counted —
it is the Rule AH direction, and counting it in both rules would inflate both. SCOPE-UNDERSTATEMENT is treated
as falsification (RETRO-222 §4d DG-3: the runbook says "external registrations get a 400" while the guard
fires for EVERY tenant incl. first-party Estalara). TIERING: out-of-repo handoffs and operator runbooks are
P1 because the reader cannot see our diff; in-file docblocks/ADRs/MASTER_DESIGN/CI labels are P2 but the
changed file's OWN docblock is never exempt. LETTER CHOICE: AI is the next in the double-letter sequence
after AH. -->

### Rule AI amendment (2026-08-07 — RETRO-260 §6 — the sweep must run at THREE vocabularies, and the closing evidence is the adjudicated hit list)

**This is an AMENDMENT to an already-promoted rule, not a new rule.** No new letter is minted and
the ≥2-PRIOR-retro gate is not re-invoked: the pattern (a correction that leaves siblings asserting
the retracted claim) **is** Rule AI, and RETRO-260 is its **7th** sighting after RETRO-213 /
RETRO-221 / RETRO-222 / RETRO-246 / RETRO-259. A new letter for "corrections stop short" would
duplicate AI and split its evidence base. What this amendment closes is a hole **in this rule's own
Verification block**, demonstrated on a claim that survived four documents and three competent
correction rounds.

**Trigger (RETRO-260 — PR #692 / FOLLOW-875+877 and PR #693 / FOLLOW-881).** One claim — _"the SDK's
`DOM_ADAPT_CONFIDENCE_FLOOR = 0.5` is the gate on the description axis"_ — was corrected three times
and each round found more sites than the last: FOLLOW-875 corrected the code docblock and two stubs
but not MASTER_DESIGN (→ FOLLOW-881); FOLLOW-881 corrected three MASTER_DESIGN sites but not §E.4.6
(→ FOLLOW-882); FOLLOW-882's own closing AC prescribes
`grep -n 'CONFIDENCE_THRESHOLD\|DOM_ADAPT_CONFIDENCE_FLOOR' docs/MASTER_DESIGN.md`. **RETRO-260 ran
the sweeps that grep cannot express and found two more:**

- **`docs/MASTER_DESIGN.md:2086`** — _"If `combined_confidence < 0.6` → serve `neutral` playbook, no
  DOM mutation"_ — the same boundary error (`<` where `route.ts:275` is `<=`), the same permissive
  direction, containing **neither token** of the prescribed grep because it writes the threshold as
  a **bare literal**. Found by `grep -n "confidence.*0\.6\|0\.6.*confidence" docs/MASTER_DESIGN.md`.
- **`packages/sdk/src/__tests__/follow-354.test.ts:20-22`** — _"the SDK `DOM_ADAPT_CONFIDENCE_FLOOR`
  (0.5) is the **SOLE** gate for description fetches"_, i.e. the exact sentence PR #692 withdrew
  from `packages/sdk/src/core/adapt-floor.ts:26-32`, surviving in the sibling test file of the test
  #692 added and contradicted six lines later by that file's own AC-1. Found by
  `grep -rn "sole gate\|SOLE gate" docs/ backlog/ packages/sdk/src`.

**The mechanism, stated so it generalises past this claim:** a claim exists at up to three
vocabularies — the **symbol**, the **literal value**, and the **prose paraphrase** — and every sweep
so far inherited the vocabulary of the round that happened to find the bug. Rule AI's Verification
block above greps _"the ticket ID, the flag/env name, the symbol and the endpoint path"_: all four
are the symbolic vocabulary. **A claim has as many hiding places as it has vocabularies.**

**Amendment — two clauses, both non-optional:**

1. **Three-vocabulary sweep.** The Rule AI sweep MUST be run at, and its output published for, all
   three: **(a)** the symbol / constant / flag / ticket ID / endpoint path (the existing block);
   **(b)** the **literal VALUE** the symbol holds, together with its comparison operators — for a
   threshold, grep the number and every `<`, `<=`, `>`, `>=` near it; **(c)** the **prose
   paraphrase**, quoted **verbatim from the sentence being retracted** (`"sole gate"`, `"no third"`,
   `"this is intentional"`, `"optional"`). Clause (c) is free: the retracted sentence is already in
   the diff, so its distinctive phrases are known at zero cost.
2. **The closing evidence is the adjudicated hit list, never a cleanliness claim.** Every hit from
   all three vocabularies is listed in the PR body / close note with a per-hit verdict (`corrected`
   / `already correct` / `out of scope, filed as FOLLOW-NNN`). _"The document is now clean"_ is not
   evidence and does not discharge this rule. (FOLLOW-882 AC(4) already had this half and only
   vocabulary (a); FOLLOW-887 discharges the amendment live.)

**Corpus addition, from the same evidence.** Rule AI's listed corpus (`docs/`,
`backlog/HANDOFFS.md`, ADRs, the changed file's own docblock, and — per the 2026-08-05 amendment —
`.claude/`) MUST also include **`packages/**/**tests**/**`and`packages/**/schemas/**`**. Both sites
RETRO-260 found live there: a test-file header is prose that no reviewer reads as documentation and
no compiler checks, and a schema docblock is where this repo demonstrably writes down cross-module
invariants (`packages/shared/src/schemas/intent-weights.ts:110-114` enumerated a four-member class
that the same correction round described as two — RETRO-260 §4a LG-1). Same corpus-hole shape the
2026-08-05 amendment closed for `.claude/`.

**Verification (run all three, publish all three):**

```bash
# (a) symbolic — the existing block, unchanged.
grep -rn "FOLLOW-<n>\|<FLAG_NAME>\|<symbolName>" docs/ backlog/HANDOFFS.md CONVENTIONS_PATCH.md \
  packages/*/src/__tests__ packages/*/src/schemas .claude/ | grep -viE 'RETROSPECTIVES|FOLLOW_UPS'
# (b) the literal value the symbol holds, with its operators — the vocabulary that hid MASTER_DESIGN:2086.
grep -rnE '(^|[^0-9.])<VALUE>([^0-9]|$)' docs/ packages/*/src | grep -iE '<subject-word>|[<>]=?'
# (c) the retracted sentence's own distinctive phrases, taken verbatim from the diff.
git diff origin/main -- <changed-doc> | grep '^-' | tr ' ' '\n' | sort -u   # harvest the phrases
grep -rn "<phrase 1>\|<phrase 2>" docs/ backlog/ packages/ apps/ .claude/
# The PR body MUST contain a per-hit verdict line for every hit above. A "now clean" claim fails.
```

**Evidence for this amendment:** RETRO-213 / RETRO-221 / RETRO-222 (the promotion set), RETRO-246 §6
P-29 (amendment 1 — the corpus hole for `.claude/`), RETRO-259 §4d DG-1 (ESC-052's correction set
stopped one document short of the SoT → FOLLOW-878; sighting 5), **RETRO-260 §4d DG-1/DG-2
(sightings 6 and 7 — the fifth and sixth sites of one claim, both invisible to a symbol-scoped sweep
→ FOLLOW-887)**. **No new letter: rule count stays 43, range AA-AQ; Rule AI amendments 1 → 2.**

### Rule AI amendment (2026-08-07 — RETRO-261 §6 — a REPLICA of the changed unit is a standing claim about EVERY axis of it, not a mention of the one axis under correction)

**This is an AMENDMENT to an already-promoted rule, not a new rule.** No new letter is minted and
the ≥2-PRIOR-retro gate is not re-invoked: the pattern (an artefact left asserting a state a change
falsifies) **is** Rule AI, and RETRO-261 is its **8th** sighting after RETRO-213 / RETRO-221 /
RETRO-222 / RETRO-246 / RETRO-259 / RETRO-260 ×2. Minting a letter for "a replica is a claim" would
duplicate AI and split its evidence base — the RETRO-122 error in rule form. **Rule count stays 43,
range AA–AQ; Rule AI amendments 2 → 3.**

**Trigger (RETRO-261 — PR #694 / FOLLOW-882+887, the ticket that executed amendment 2 within hours
of its being written).** The three-vocabulary sweep worked: it found sites 5–7 that three competent
rounds had missed, and site 7 (`MASTER_DESIGN` §E.1's similarity ladder) was reachable **only**
through vocabulary (b) — the code is `similarity > 0.85` / `similarity <= 0.6` (`route.ts:323,328`)
and the doc was wrong at **both** boundaries while being perfectly correct in the symbol vocabulary.
**RETRO-261 then found an EIGHTH site, and it was inside the corpus amendment 2 had just added, and
inside vocabulary (a):**

- **`packages/sdk/src/__tests__/playbooks.test.ts:172-267`** re-implements `runDecisionTree` under
  the docblock _"Replicates the decision tree logic from route.ts"_. It declares **all three ladder
  constants with the correct values and the correct operators** (`:192-194`), so vocabulary (a) hits
  it and reports it correct, vocabulary (b) reports it correct, and vocabulary (c) finds none of the
  retracted prose in it. **The falsity is in a branch BODY:** `:199-201` returns
  `{ directives: [], source: 'llm_full' }`, a pair `route.ts:340-345` cannot emit (`llm_full` always
  carries the gateway's directives; `[]` always carries
  `source: 'playbook_fallback_llm_unavailable'`, as the route's own header says at `:15`). It is
  **asserted and green** at `:257-261`, and it **contradicts a sibling suite in the same repo**
  (`apps/control-plane/src/app/api/adapt/route.test.ts:396-408` asserts the same branch with
  `directives.length > 0`). Two green suites, opposite contracts, one branch.

**Why this is a rule-TEXT gap and not a compliance failure — the distinction was tested before
amending, because amendment 2 was one retro old.** Run amendment 2 **verbatim** against PR #694:
vocabulary (a) over its own newly-added corpus (`packages/*/src/__tests__`) **HITS**
`playbooks.test.ts:192,196`, and clause 2 requires a written per-hit verdict for it. So the sweep is
adequate and was complied with — which would ordinarily make this a compliance failure against an
adequate control (the Rule P adjudication this log has drawn eight consecutive times) and **no
amendment**. It is not, and the reason is the finding: **the verdict "already correct" is CORRECT
under the rule as written.** Rule AI scopes adjudication to _"every sentence asserting the prior
state"_ of the claim being retracted, and this hit asserts the prior state of a **different axis of
the same replica**. The rule's **subject definition** — not its sweep, not its corpus, not its
execution — is what let the eighth site through. Amendments 1 and 2 both closed corpus/vocabulary
holes; this one closes an adjudication hole, and it is the first of that kind.

**Provenance, recorded because it matters for how rules get made here.** The insight is the
FOLLOW-882/887 architect's, written in `.claude/agents/architect/lessons.d/FOLLOW-882-887.md`:
_"when sweeping a numeric gate claim, sweep the SIBLING CONSTANTS of the same function too … **the
claim class travels by function, not by constant**."_ That is the sharper of the two insights the
FOLLOW-887 round produced, and it landed in a per-agent lessons fragment where it binds one agent on
one ticket. The amendment below is that sentence generalised one level (from _sibling constants_ to
_the whole replicated unit_) and moved into the rule, where it binds every corrective PR.

**Amendment — the replica clause. Two parts, both non-optional:**

1. **A hit that turns out to be a REPLICA of the changed unit is adjudicated on the WHOLE unit, not
   on the axis under correction.** A replica is any artefact that re-declares, re-implements,
   emulates, mirrors or pseudocodes the changed function / constant set / gate ladder / decision
   tree / response contract — including test helpers, fixtures, harnesses, pseudocode blocks,
   docblock ladders and worked examples. It is a **standing assertion about every axis of the
   original**, so `already correct` is a verdict about the claim, never about the replica: the
   adjudication must state, per replica, whether **the whole unit still matches**, and must name the
   axes checked (values, operators, **branch bodies and their return shapes**, branch ORDER where
   order is observable, the set of enumerated cases, the identity/naming of each case). If the
   replica cannot be checked in full within the PR, say so and file it — do not mark it
   `already correct`.
2. **Every replica found by the sweep MUST be listed in the closing evidence with an
   extraction/machine-check disposition.** For each: `extracted` /
   `machine-checked against the owner at run time` /
   `left as a hand-maintained copy, and here is why + here is the compensating control`. A replica
   declared faithful in prose with no mechanism is the subject of **Rule AQ**; this clause is what
   makes Rule AQ fire during a Rule AI sweep instead of at the next audit. The proven in-repo
   mechanism for a module-private owner is a filesystem read + regex that **throws** rather than
   defaults — `scripts/dev/local-pilot-session.mjs:73-108` `readServerConfidenceGate()` — not a
   second hardcoded copy.

**NOT amended, deliberately, and the reasoning is recorded so the next retro tests instead of
re-deriving it.** Amendment 2's clause (b) is written **threshold-only** (_"for a threshold, grep
the number and every `<`, `<=`, `>`, `>=` near it"_, with `<VALUE>` / `<subject-word>` placeholders
that presume a numeric boundary). Tested against three other claim classes: a **wrong enum** — (a)
catches the name, (b) has no analogue as written (the correct (b) would be _the member literals plus
the set's cardinality_), (c) works; a **stale endpoint path** — (a) already lists the endpoint path,
(b) is vacuous; a **retracted default** (`?? 0.5`) — (b) half-works and only if the author thinks to
grep the coalescing operator. So on two of three, amendment 2 degrades to the pre-amendment rule
plus clause (c). **The frame generalises; the letter of clause (b) does not.** It is **NOT
generalised here, at zero sightings** — no enum / path / default miss has been observed, and
codifying an untriggered generalisation is the "patch wearing a rule's clothes" failure applied to
this amendment's own author. **ARMED with a pre-specified trigger:** the next numbered retro that
observes a Rule AI miss on a **non-threshold** claim (enum member, endpoint path, retracted default,
cardinality) where vocabulary (a) was run and vocabulary (b) was inapplicable-as-written cites
RETRO-261 §6 plus its own finding and generalises clause (b) in the same retro. **Count today: 0.**

**Amended Verification (add to the block above):**

```bash
# 7. REPLICA DETECTION — run over every hit vocabularies (a)/(b)/(c) returned.
#    A hit is a REPLICA (not a mention) if it re-declares the changed unit rather than referring to it.
grep -rn "const <CONST_1>\|const <CONST_2>" packages/*/src apps/*/src scripts/ \
  --include=*.ts --include=*.mjs --include=*.py | grep -v "<owner-file>"
#    …and for a re-implemented FUNCTION, the shape of the copy rather than its constants:
grep -rn "eplicat\|irrors\|opied from\|emulat\|same logic as\|as in route\|per <owner-file>" \
  packages/*/src apps/*/src docs/ | grep -iE 'test|fixture|harness|pseudo|simulate|mock'

# 8. For each replica: does the WHOLE unit still match? Diff the branch bodies, not just the constants.
#    The failure this clause exists for is a replica whose CONSTANTS are right and whose RETURN SHAPE
#    is wrong — invisible to (a), (b) and (c) simultaneously.
#    Cross-check every (source|status|enum) value the replica can emit against the owner's:
grep -nE "source: '|status: |return \{" <replica-file> <owner-file>

# 9. Disposition, published per replica. A replica with no mechanism is a Rule AQ finding NOW.
#    Proven mechanism for a module-private owner (read + regex, THROWS, never defaults):
#      scripts/dev/local-pilot-session.mjs:73-108  readServerConfidenceGate()
```

**Evidence for this amendment:** RETRO-213 / RETRO-221 / RETRO-222 (the promotion set), RETRO-246 §6
P-29 (amendment 1 — the `.claude/` corpus hole), RETRO-259 §4d DG-1 (sighting 5), RETRO-260 §4d
DG-1/DG-2 (sightings 6–7, amendment 2 — the vocabulary hole), **RETRO-261 §4a LG-1 / §4b CB-1 / §4c
TG-1 (sighting 8 — the adjudication hole, demonstrated on the very sweep amendment 2 mandates →
FOLLOW-890)**. Corroborating and **NOT counted** (different axis — a corpus that is right while the
SoT is wrong, which is amendment 1's trigger inverted): RETRO-261 §4d DG-3, where
`modal-deploy.yml`'s own comment correctly records the single-tier deploy while §Snapshot.1 row D
still claims two tiers. **Distinct from Rule AQ**, which governs whether a declared-identical block
is extracted or machine-checked at any time; this clause governs **when** AQ must be answered — at
the moment a Rule AI sweep surfaces the copy — and forbids `already correct` as a replica's verdict.

---

## Rule AJ — A newly-shipped failure-detection signal MUST have a consumer in the SAME PR: an alert/registry entry AND a verified delivery channel in the environment it must fire in; a producer-only alarm is a HALF_WIRE_P, not observability

**Pattern:** A PR closes a silent-failure gap by _emitting_ a signal — `Sentry.captureMessage` /
`captureException`, a structured `logger.warn`, a new tag — and ships **no consumer** for it. No
alert rule, no entry in any registry the repo owns, sometimes no DSN in the environment the producer
runs in. The PR body, the ticket AC and the shipped docstring then describe the change as
"fail-loud", and every subsequent retro/QUEUE entry inherits that word. The failure is still silent;
only the _code_ changed.

This is the observability twin of Rule H (a schema scaffold must ship with a runtime-wired consumer)
and of Rule M (a prod-effect claim needs a workflow that targets prod). It is **not** covered by any
existing rule — checked before minting: **Rule K.2** governs whether a fire-and-forget path _emits_
at all and refuses to swallow errors (a producer-side obligation, which producer-only alarms
satisfy); **Rule Q** governs a CI gate proving its assertion _ran_; **Rule AA** governs whether an
operator has _performed_ a step; **Rule AI** governs documents that assert a stale truth. None of
them requires an emitted **runtime** signal to have a **consumer**.

**Evidence (≥2 PRIOR numbered retros, both verified at their cited lines):**

- **RETRO-154 (PR for FOLLOW-459) §4a LG-1 → FOLLOW-495.** After the ClickHouse insert moved past
  the ACK, `clickhouse_push_failed_post_ack` (`tags sink:clickhouse, kind:insert_failed`) became the
  **only** signal that the sole production `events` store dropped a batch. No alert rule keys off
  it. The follow-up asked for "alert, not just capture" and is still open (re-scoped by FOLLOW-515).
  Count 1.
- **RETRO-224 (PR #629, FOLLOW-659) §4d DG-3 → FOLLOW-688.** #629 deliberately chose "alert, never
  block" on `POST /api/dsr/initiate`, making the Sentry tag `brand_identity: unprovisioned_external`
  the **entire** enforcement mechanism on that surface — and it appears in no rule in
  `docs/ops/DSR_ALERTING.md`, the repo's own registry of DSR Sentry alert rules, while
  `BRAND_PROVISIONING.md:543` instructs the operator to "confirm the alert stops". Count 2.

**Promotion trigger — RETRO-225 (PR #630, FOLLOW-678) §3 CHECK B**, the strongest of the three
because the channel is not merely unrouted but **absent**: the new `first_party_tenant_id_malformed`
signal is produced on both planes (`apps/ingest/src/handlers/events.ts:160-169`,
`apps/control-plane/src/lib/brand-identity.ts:191-201`), has zero consumers anywhere, and on the
ingest plane `SENTRY_DSN_INGEST` is unset in prod (`docs/runbooks/INGEST_WORKER_DEPLOY.md:123` — a
file the same PR edited four lines above its own note) with no `logpush`/`tail_consumers` in
`wrangler.toml`, so the `logger.warn` fallback needs a live `wrangler tail`. The shipped docstring
(`events.ts:47-52`) promises the opposite in as many words. Both banked occurrences are PRIOR retros
→ threshold met; the promoting retro does **not** inflate the count (adjudication shared with
AA/AB/AC/AD/AE/V/Q/AG/AH/AI).

**Rule:**

1. A PR that introduces a **new** runtime failure signal (Sentry message/exception, new tag, new
   structured log key) whose purpose is to make an otherwise-silent failure visible MUST, in the
   same PR:
   - **(a) Register it.** Add the signal to a registry the repo owns — `docs/ops/DSR_ALERTING.md`
     for DSR, otherwise the alert-rule section of `docs/runbooks/observability.md` — with the
     tag/message key, the severity, a rule recipe (threshold/window), and who is expected to act.
   - **(b) Prove the channel exists in the environment the producer runs in.** Name the DSN/sink env
     var and its state in the target environment. If it is unset, the PR either sets it or states,
     in the PR body **and** in the producing file's docstring, that the signal is currently
     undeliverable there. "Sentry will pick it up" is not evidence; a `wrangler secret list` /
     dashboard check is.
   - **(c) Scope the claim.** A docstring, runbook, AC or QUEUE entry may not describe the change as
     "fail-loud", "visible", "alerts ops" or "surfaces" beyond what (a) and (b) establish.
2. When a signal is the **sole** enforcement mechanism on a surface (the code deliberately does not
   refuse — e.g. alert-rather-than-block on a data-subject right, or degrade-to-off on a config
   typo), (a) and (b) are **P1**, not P2: the alarm is the control, and an unrouted control is no
   control.
3. A retro that finds a new signal with a producer and no consumer classifies it **HALF_WIRE_P**
   under CHECK B and files a follow-up. An existing unrouted signal touched by the PR is a doc/AC
   gap, not a new half-wire, but MUST be cited so the count is visible.
4. The registry entry is the consumer of record. Absent a registry, "someone will see it in the
   Sentry UI" is treated as **no consumer** — the same adjudication CHECK B applies to a DB column
   no code reads.

**Distinct axis from:** Rule H (schema scaffold ↔ runtime consumer — structural, not observability);
Rule K.2 (the consumer must not swallow — producer-side emission, which this rule presupposes); Rule
M (automation claimed to affect prod must target prod); Rule Q (a CI gate must prove it ran); Rule
AA (whether the operator ran the step, not whether the alarm reaches anyone); Rule AI (documents
asserting a stale claim — AJ is about the runtime wire, AI about the prose, and a producer-only
alarm usually trips both).

**Verification:**

```bash
# 1. Every new signal key introduced by the PR must appear outside its producer + tests.
git diff origin/main | grep -oE "captureMessage\('([a-z0-9_]+)'|captureException.*kind: '([a-z0-9_]+)'" \
  | grep -oE "'[a-z0-9_]+'" | tr -d "'" | sort -u | while read -r sig; do
    hits=$(grep -rln "$sig" docs/ops docs/runbooks 2>/dev/null | wc -l)
    [ "$hits" -eq 0 ] && echo "FAIL (AJ.1a): '$sig' has no registry entry in docs/ops or docs/runbooks"
  done

# 2. The channel must exist where the producer runs (example: the ingest Worker).
grep -rn "SENTRY_DSN" apps/<app>/src/observability.ts   # confirm the no-op-without-DSN branch
pnpm exec wrangler secret list --env production | grep SENTRY_DSN_INGEST \
  || echo 'FAIL (AJ.1b): producer runs in an environment with no Sentry DSN'
grep -qE '^\s*logpush|tail_consumers' apps/<app>/wrangler.toml \
  || echo 'WARN (AJ.1b): logger.* fallback is only visible during a live `wrangler tail`'

# 3. The claim must not outrun the wire.
git diff origin/main | grep -nE '\+.*(fail[- ]loud|visible in (Sentry|logs)|alerts ops|surfaces)' \
  # every hit must be justified by an AJ.1a registry entry added in the same diff
```

---

<!-- Rule AJ added 2026-07-27 — RETRO-225 §6 (Pattern P-9, PRODUCER-ONLY ALARM). Evidence (≥2 PRIOR numbered
retros): RETRO-154 §4a LG-1 / FOLLOW-495 (clickhouse_push_failed_post_ack became the sole signal that the sole
prod events store dropped a batch after FOLLOW-459 moved the CH insert past the ACK; no alert rule; follow-up
still open, re-scoped by FOLLOW-515; count 1) + RETRO-224 §4d DG-3 / FOLLOW-688 (#629's brand_identity:
unprovisioned_external tag is the ENTIRE enforcement mechanism on the DSR path and is in no rule in
DSR_ALERTING.md while BRAND_PROVISIONING.md:543 tells the operator to "confirm the alert stops"; count 2).
Promotion trigger: RETRO-225 §3 CHECK B — PR #630's first_party_tenant_id_malformed has producers on BOTH
planes and zero consumers, and on ingest the channel is ABSENT not merely unrouted (SENTRY_DSN_INGEST unset per
INGEST_WORKER_DEPLOY.md:123 — the same file the PR edited four lines below — plus no logpush/tail_consumers in
wrangler.toml), while events.ts:47-52 promises the opposite. The promoting retro does NOT inflate the count.
CHECKED BEFORE MINTING, per RETRO-224's anti-duplication discipline: K.2 = producer-side emission (this PR
CONFORMS to K.2 and still fails AJ), Q = a CI gate proving its assertion ran, AA = whether an operator ran a
step, AI = stale prose. None requires an emitted RUNTIME signal to have a CONSUMER — AJ is a new axis, not a
fourth rule on the doc-truth axis. TIERING: clause 2 makes (a)+(b) P1 whenever the alarm is the sole
enforcement mechanism (alert-rather-than-block, or degrade-to-off), P2 otherwise. LETTER CHOICE: AJ is the next
in the double-letter sequence after AI. -->

## Rule AK — A PR that changes an out-of-repo-consumed contract MUST ship the caller-facing documentation update, machine-checked against the code, in the SAME PR

**Pattern:** An endpoint's only consumer is a system outside this repo (`app.estalara.com`, no
shared release train), and its only specification is English prose in `backlog/HANDOFFS.md`,
unlinked to the route's source. A PR changes the route's emittable HTTP status codes or `code`
string literals and the doc silently drifts — the out-of-repo caller now has no spec for a response
it can receive, or a stale spec for one it can no longer receive. **This happened four times in a
row, on the SAME endpoint, each caught only by a human retrospective after the fact, never by CI**:
RETRO-226 §4d DG-2 (PR for FOLLOW-684 added a 422 the doc never gained) → RETRO-227 §4d DG-4 (PR for
FOLLOW-697/698 shipped a second 422 + a 500 the doc still didn't have) → RETRO-228 §4d DG-1 (PR for
FOLLOW-705 — third consecutive occurrence, formally flagged "the next sighting promotes this") →
RETRO-229 §4 DG-2 (PRs #634/#635 — fourth occurrence; #635 re-synced the four stale surfaces but
fixed nothing structural, because the contract still lives as unlinked prose). Four is twice
CONVENTIONS_PATCH's own ≥2-prior-retros bar, and the fourth retro states plainly: "more prose does
not help" (RETRO-229 §4 DG-2 / §6 L-1).

**Distinct axis from Rule AI** (the existing rule closest to this one): Rule AI requires the CODE
author to update every document asserting a prior state, verified in Rule AI's own script by
`git diff --name-only origin/main | grep -q 'backlog/HANDOFFS.md'` — i.e. proof the file was
**touched**. That check passed on \#635 (HANDOFFS.md WAS touched, four times) and the structural gap
persisted anyway, because "touched" does not mean "still true": nothing compares what the doc now
says against what the route can now emit. Rule AK is the mechanised escalation Rule AI's own text
anticipates ("Operating Principle 2 covers this in prose only... it needs a mechanised rule") for
the specific case where human diligence on file-touching has demonstrably failed at the same site
four times: **a hard, source-derived, bidirectional CI gate**, not an author obligation to remember.
Also distinct from **Rule N** (compliance/DPIA disclosure TEXT vs. shipped SDK behavior, not an HTTP
status/`code` enum) and **Rule Q** (a CI gate must prove its assertion ran generally; this rule is
the specific contract-parity assertion Rule Q presupposes exists).

**Rule:**

1. **Derive, don't hand-maintain.** The set of HTTP status codes and `code` string literals an
   endpoint can return, per HTTP method, MUST be extracted/asserted from the route's own source —
   never a hand-typed mirror a future PR can forget to update. See
   `scripts/check-consent-contract-sync.mjs` for the reference shape (modelled on
   `scripts/check-consent-text-sync.mjs`, PR #633 / FOLLOW-705).
2. **The out-of-repo caller-facing document (e.g. `backlog/HANDOFFS.md`'s per-endpoint handoff
   section) MUST carry a small, fixed-format, machine-parseable block** — not only prose — that a CI
   script parses and compares against (1). Prose stays for humans; the block is what CI reads.
3. **The CI gate MUST fail in BOTH directions:** the route can emit a status/`code` pair the doc
   does not document (undocumented addition), AND the doc documents a pair the route cannot actually
   emit (stale/phantom entry). A stale removal is exactly as misleading to an out-of-repo caller as
   a stale addition — do not build a one-directional gate.
4. **HTTP methods on the same path are DISJOINT namespaces and MUST be checked separately**, never
   unioned into one set. FOLLOW-685's real bug — the GET's `409 brand_identity_not_provisioned`
   (refuse, do not proceed) being read as if it meant the POST's uncoded `409` (safe, duplicate
   replay, proceed) — is exactly what a merged per-path set would fail to catch: both are `409`, but
   they are not the same tuple, and only per-method scoping keeps that visible.
5. **Prove the gate is red-first** before merge: deliberately falsify one side (remove a documented
   row, or introduce an undocumented status/code in the route), confirm the gate fails, then restore
   and confirm it passes again. Paste both results in the PR description.
6. This rule applies to any endpoint whose consumer is confirmed to be outside this repo — it does
   not require a NEW gate per endpoint if an existing one (e.g. this one) can be generalized, but it
   forbids merging a new out-of-repo contract change into an unrelated PR without either extending
   an existing gate or shipping a new one in the same PR as the contract change.

**Verification:**

```bash
# 1. The gate exists and is wired into CI as a hard (non-continue-on-error) job:
grep -n "consent-contract-sync" .github/workflows/ci.yml

# 2. The gate proves it detects drift in both directions, per method, before trusting a green run:
node scripts/check-consent-contract-sync.mjs --self-test

# 3. Route and doc currently agree:
node scripts/check-consent-contract-sync.mjs

# 4. For a NEW out-of-repo contract elsewhere in the repo, confirm it has an equivalent gate —
#    absence of a hit here is a Rule AK gap, not evidence the contract is stable:
grep -rln "out-of-repo\|no shared release train" backlog/HANDOFFS.md
```

---

<!-- Rule AK added 2026-07-28 — RETRO-229 §6 L-1 (promoted from FOLLOW-716). Evidence (4 PRIOR
numbered retros, twice the ≥2 bar): RETRO-226 §4d DG-2 (FOLLOW-684 PR added a 422 HANDOFFS.md never
gained; count 1) + RETRO-227 §4d DG-4 (FOLLOW-697/698 PR added a second 422 + a 500 still undocumented;
count 2, explicitly flagged "third consecutive merge with this shape" in RETRO-227's own Rule AI
sighting) + RETRO-228 §4d DG-1 (FOLLOW-705 PR — RETRO-228 itself labels this the point past which
promotion is due; count 3). Promotion trigger: RETRO-229 §4 DG-2 (PRs #634/#635 fixed the four stale
INSTANCES and nothing STRUCTURAL — contract still lives as unlinked English prose in HANDOFFS.md;
RETRO-229 §6 L-1: "four retros in a row have paid for this... never docs follow-up next sprint"; count
4). CHECKED BEFORE MINTING: Rule AI already requires the doc to be TOUCHED in the same PR (verified via
`git diff --name-only | grep HANDOFFS.md`) and that check was satisfied on #635 while the structural gap
remained — AK is the mechanised, source-derived, bidirectional PARITY gate Rule AI's own prose
anticipates needing "when human diligence has demonstrably failed at the same site", not a duplicate of
AI's touched-file obligation. Rule N is compliance-disclosure TEXT vs SDK behavior, a different subject
matter. Rule Q is the general CI-gate-proves-it-ran rule; AK is the specific assertion instantiated here.
METHOD-DISJOINTNESS clause is not hypothetical — FOLLOW-685 (RETRO-224's origin, re-surfaced in
RETRO-229) is a real 409-collision bug between GET and POST namespaces on this exact endpoint.
IMPLEMENTATION: scripts/check-consent-contract-sync.mjs + .github/workflows/ci.yml
`consent-contract-sync` job, modelled explicitly on scripts/check-consent-text-sync.mjs (PR #633,
FOLLOW-705) — the precedent RETRO-229 §4 DG-2 named as proof this gate shape works in this repo.
LETTER CHOICE: AK is the next in the double-letter sequence after AJ. -->

---

## Rule AL — An assertion MUST be evaluated over the SAME region its consumer reads: a check that greps a whole file/repo while the thing it guards parses only a delimited slice reports on the wrong bytes, and fails in the direction that looks like a real finding

**Pattern:** A guard, a self-test fixture, or a rule's own verification command asserts that a
literal is PRESENT (or ABSENT) across a **whole file or repo**, while the thing it guards reads only
a **delimited region** of that file — a sentinel block, a method body, a template literal, a
normalized projection. The assertion is then satisfied, or defeated, by matter **outside** the
region its consumer will ever look at. Two failure directions, both bad and both silent about their
real cause:

- **Defeated:** the mutation/predicate lands out-of-region, the guarded check correctly reports
  nothing changed, and the assertion fails — **as a red that accuses the guard of being broken**, on
  a legitimate change. The reader's first line is an accusation about the wrong subsystem.
- **Satisfied:** the predicate hits an out-of-region occurrence and the assertion passes while
  enforcing nothing. **A verification step that cannot fail is not a verification step** (Rule Q's
  subject, applied to a region rather than to an exit code).

**Evidence — three numbered retros, two of them PRIOR (twice the ≥2 bar is not claimed; the bar is
exactly met and stated openly):**

- **RETRO-230 §3 / §4d DD-2 (prior, count 1)** — Rule AK's own Verification step 4,
  `grep -rln "out-of-repo\|no shared release train" backlog/HANDOFFS.md`, annotated "absence of a
  hit here is a Rule AK gap". `grep -l` on a single named file that contains the phrase **always**
  hits, so "absence" is unreachable; and the phrase-match cannot find the strongest real candidate
  (`POST /api/crm/outcome`) because that endpoint uses neither phrase. Satisfied-direction instance,
  in **prose**, not code.
- **RETRO-231 §4a LG-1 (prior, count 2)** — `mustReplace`'s file-wide `str.includes()` /
  `str.replace()` in `scripts/check-consent-text-sync.mjs` vs the gate's sentinel-delimited slice.
  `the agency's DSR contact` occurs 3× in `PRIVACY_NOTICE_TEMPLATE.md` (`:249` in-block, `:263` and
  `:352` out-of-block); a correctly-performed consent-text change mutates the out-of-block copy and
  CI prints `=== SELF-TEST FAILED — the gate does not detect drift ===`. **Proven in a sandbox.**
  Defeated-direction instance, in **code**.
- **RETRO-232 §4a LG-1 + §4a LG-2 (promotion trigger, count 3)** — the remediation PR for the above
  (#640) fixed the `docSrc` axis and shipped an in-file audit declaring two remaining sites safe.
  **Both verdicts are wrong, both proven in a sandbox:** (i) `renderer-side text drift` anchors on a
  phrase inside `extractRendererTemplate`'s returned template literal but mutates `lib.ts`
  file-wide, and the comment's justification ("no narrower region exists to scope to") is factually
  false; (ii) contract-sync case (a) records its trigger as "a second literal match across GET/POST"
  when the real trigger is a match **anywhere earlier in the file**, including the module-level
  region `extractCalls()` is already blind to — reachable by an ordinary five-line helper
  extraction. **The audit itself was region-blind**: it reasoned about the _count of matches_
  instead of _the region the consumer reads_.

**CHECKED BEFORE MINTING.** Not covered by **Rule Q** (a check that _cannot_ fail; Rule AL's checks
fail readily — they just fail about the wrong bytes, and the defeated direction is a _false red_,
not a false green). Not covered by **Rule AE** (enumerate every syntactic CALL-SHAPE — shapes, not
regions; AE is also bound to "a security invariant"). Not covered by **Rule AD** (structural shapes
a value-domain literal occurs in). Not covered by **Rule AK item 5** (red-first proof at merge time,
which is orthogonal — a region-blind fixture is red-first-provable on the day it is written and
breaks on the next legitimate change). No existing rule states the region invariant.

**Rule:**

1. **Name the region before writing the assertion.** For any grep, `includes`, `replace`, `sed`,
   fixture mutation or verification command, state — in the code or in the rule's Verification block
   — **which region the consumer of that assertion actually reads**: whole file, a
   sentinel-delimited block, a function/method body, a template literal, a normalized projection, a
   named directory.
2. **Evaluate the assertion over that region, not over its container.** If the consumer slices, the
   assertion slices, **using the same locator the consumer uses** (call the extractor, or replicate
   its invariants including any uniqueness/ordering counts). A whole-file predicate is acceptable
   **only** when the anchor IS the thing the consumer's own whole-file locator matches — and that
   coincidence must be stated per site, not assumed.
3. **Compared, not extracted.** When the consumer normalizes, projects or sub-slices what it
   extracted (strips markdown, unwraps paragraphs, reads one substring of a line), the assertion's
   region is the **compared** projection, not the extracted container.
4. **Fail loud, and fail as the right diagnosis.** If the anchor is absent from the region, throw a
   staleness error naming the region — never fall back to a file-wide search, and never let the miss
   surface as "the guard is broken".
5. **A "safe" verdict is itself an assertion and inherits this rule.** An audit that records "unique
   today, `grep -c` → 1" has counted matches, not established region alignment. Any verdict left in
   code MUST state the region the consumer reads, the region the assertion evaluates, and the
   **real** trigger that would break the alignment — a wrong "audited safe" comment is worse than no
   comment, because it stops the next auditor.

**Verification (region-scoped, per its own clause 2 — do not paste a whole-repo grep here):**

1. For the file under review, list every `includes(` / `.replace(` / `grep` / `sed` anchor in
   fixture or verification code: `grep -n "includes(\|\.replace(\|grep -" <file>`.
2. For each hit, identify the consumer's locator in the same file (the `extract*` function, the
   slice, the regex) and confirm the anchor is evaluated inside it — by reading the call, not by
   counting matches.
3. Red-first, in a **sandboxed copy of the tree, never the working tree**: place a duplicate of the
   anchor **outside** the consumer's region and **earlier in the file**, then run the check. A
   region-scoped assertion reports staleness naming the region; a region-blind one reports a failure
   naming the guard.

<!-- Rule AL added 2026-07-29 — RETRO-232 §6 (pattern P-17 "REGION-BLIND ASSERTION"). Evidence (2 PRIOR
numbered retros, exactly the ≥2 bar, arithmetic re-derived independently rather than inherited):
RETRO-230 §3 / §4d DD-2 (Rule AK Verification step 4 inert; satisfied-direction, prose; count 1) +
RETRO-231 §4a LG-1 (mustReplace file-wide vs sentinel slice, sandbox-proven; defeated-direction, code;
count 2). Promotion trigger: RETRO-232 §4a LG-1 + §4a LG-2 (count 3) — TWO further sandbox-proven
instances inside the remediation PR for count 2, plus one named in advance (§4a LG-3, normalization).
RETRO-231 §6 pre-authorised promotion "on the next sighting (3rd, = 2 priors)" in the corrected P-15
form; RETRO-232 honoured it only AFTER re-deriving the count, per RETRO-231's own lesson that a
predecessor's pre-authorisation is not an authorisation. CHECKED BEFORE MINTING: Rule Q (cannot-fail
checks — AL's checks DO fail, about the wrong bytes), Rule AE (call-SHAPES, and bound to security
invariants), Rule AD (structural shapes of a literal), Rule AK item 5 (red-first at merge time,
orthogonal). Clause 5 exists because RETRO-232's two P1 findings were both wrong verdicts produced by
a conscientious audit whose counts were all correct. LETTER CHOICE: AL is the next in the double-letter
sequence after AK. -->

---

## Rule AM — A self-testing gate's fixtures MUST NOT be produced by mutating the live source the gate polices — synthesize them; if a live-source mutation is unavoidable it MUST be region-scoped AND report fixture-staleness as a diagnosis distinct from gate-failure

**Pattern:** A CI gate ships a `--self-test` mode that proves it detects drift by **mutating a copy
of the very source it polices** and asserting the check then fails. The fixture is therefore
anchored on the exact literals the gate exists to protect — so **the first CORRECT change the gate
was built for invalidates the fixture**, `String.replace` becomes a no-op, the "mutated" source
equals the original, the case's `ok === false` assertion fails, and CI prints a banner accusing the
gate of not detecting drift. The gate is fine. The change is fine. The message is a lie, it lands on
the author of a legitimate change, and it lands **at the moment of highest stakes** (a consent-text
bump, a contract change) when a red CI is least likely to be read charitably.

**The repo already solved this, one directory over.** The three other self-testing gates —
`scripts/check-migration-journal.sh:50-160`, `scripts/check-fire-and-forget-sinks.sh:57-92`,
`scripts/check-modal-app-singleton.sh:68-111` — build **fully synthetic fixtures in a `mktemp -d`**
and point the gate at the temp tree via an env var / fixture mode. **None of them mutates a live
repo source, and all three are structurally immune to this entire class.** The two `.mjs` consent
gates are the only gates in `scripts/` that mutate live sources (RETRO-231 §5, repo-wide scan). That
choice — not the anchor style — is the root coupling.

**Evidence — three numbered retros, two of them PRIOR:**

- **RETRO-230 §4c TG-1 (prior, count 1)** — proven on **both** consent gates in one sandbox session.
  Adding `429 rate_limited` to GET **and** to its machine block (i.e. doing the change perfectly) →
  contract gate: real check PASS, self-test **1/5 FAIL**. Bumping
  `PLATFORM_REGISTRATION_TOS_VERSION` consistently in `lib.ts` **and** `PRIVACY_NOTICE_TEMPLATE.md`
  (i.e. exactly what FOLLOW-704/710/711 must do) → text gate: real check PASS, self-test **1/7
  FAIL**. Both under `=== SELF-TEST FAILED — the gate does not detect drift ===`.
- **RETRO-231 §4a LG-1 / §5 (prior, count 2)** — the dedicated remediation PR (#639, FOLLOW-720)
  introduced `FixtureStaleError` / `STALE` to fix the _message_, and the defect **survived**: a
  correctly-performed FOLLOW-710/711 edit still produced `FAIL` with the identical banner. §5's
  repo-wide scan established the synthetic-fixture precedent above and named live-source mutation as
  the root coupling; `mustReplace` "treats a symptom".
- **RETRO-232 §2 / §6 (promotion trigger, count 3)** — the **second** dedicated remediation PR
  (#640, FOLLOW-723) region-scoped the doc fixtures and genuinely fixed the axis it targeted
  (pre-fix `FAIL` → post-fix correctly-worded `STALE`, both reproduced independently on an identical
  sandbox tree). **And the pattern still holds:** a `STALE` is still `exit 1` on a CI step named
  "proves it detects drift", so the next legitimate consent-text change still reddens CI — now
  honestly, but red; and two further sites remain region-blind (§4a LG-1/LG-2). The
  synthetic-fixture alternative was **explicitly offered in FOLLOW-723's AC-1 and declined** in
  favour of region-scoping. That is a defensible call for a 3h ticket, and it is exactly why the
  invariant belongs in a rule rather than in a ticket: **the next gate author will make the same
  default choice**, and `CONVENTIONS_PATCH.md:2605` (Rule AK item 1) already points them at these
  two scripts as "the reference shape".

**CHECKED BEFORE MINTING.** **Rule Q** requires a gate to emit positive proof its assertion executed
— it says nothing about where the fixture comes from, and both consent gates satisfy Q while
carrying this defect. **Rule AJ** is about a shipped signal having a consumer. **Rule AK item 5**
requires a red-first proof _at merge time_ — a live-source fixture is red-first-provable on the day
it is written; the defect appears on the _next_ legitimate change. **Rule AL** (minted alongside
this one) governs the region an assertion is evaluated over; AM governs where the fixture **comes
from** in the first place. AM is the fixture-provenance rule none of them states.

**Rule:**

1. **Default: synthesize.** A gate's `--self-test` / fixture mode MUST construct its fixture from
   synthetic content it owns — a `mktemp -d` tree or an in-memory string built in the test — not by
   mutating a copy of the live source the gate polices. Follow
   `scripts/check-migration-journal.sh:50-160` for the reference shape.
2. **If live-source mutation is genuinely necessary** (e.g. the gate's whole subject is "these two
   real artifacts agree"), then **both** of the following are mandatory, not optional: a. every
   mutation is **region-scoped per Rule AL** to the region the check actually compares; and b. an
   anchor that no longer matches reports **fixture staleness**, naming the anchor and its region —
   never "the gate does not detect drift".
3. **Fixture staleness is a distinct diagnosis and MUST reach a machine consumer**, not only a log
   body: a distinct exit code (this repo's documented convention is
   `2 = self-test failure / guard unproven`, see `check-migration-journal.sh:28-30`,
   `check-fire-and-forget-sinks.sh:50`, `check-modal-app-singleton.sh:61`), and a CI step name that
   does not assert a conclusion the run may contradict.
4. **The fail-loud path MUST itself execute.** At least one self-test case per gate MUST feed a
   deliberately-stale anchor through the staleness path and assert the outcome is the staleness
   status — otherwise the diagnosis is never rendered and a typo in it ships inert (Rule Q, one
   level down).
5. **Anchor choice, when live mutation is used:** prefer an anchor the gate derives dynamically from
   the current source (the pattern `check-consent-text-sync.mjs`'s `TOS version bumped` case uses —
   read the value with the gate's own regex, then mutate what you read) over a hardcoded literal. A
   dynamically-derived anchor cannot go stale.

**Verification:**

1. `grep -rln "self-test\|selfTest\|SELF-TEST" scripts/` — for each gate, determine whether its
   fixture is synthetic (`mktemp`, in-memory literal) or a mutation of a live repo source.
2. For every live-source mutator, confirm clause 2a (region-scoped, per Rule AL's verification) and
   2b (staleness reported distinctly), clause 3 (distinct exit code + honest step name in `ci.yml`)
   and clause 4 (a case that actually exercises the staleness path — check it appears in the gate's
   PASS list on a normal run).
3. Red-first, in a **sandboxed copy of the tree, never the working tree**: perform the change the
   gate exists to police, **done perfectly and completely**, and run the self-test. A compliant gate
   is green or reports staleness naming the anchor; a non-compliant one accuses itself.

<!-- Rule AM added 2026-07-29 — RETRO-232 §6 (pattern P-16, first raised RETRO-230 §6). Evidence (2 PRIOR
numbered retros, exactly the ≥2 bar, arithmetic re-derived independently): RETRO-230 §4c TG-1 (both
consent gates, two sandbox-proven instances in one retro — counted as ONE retro sighting per RETRO-228's
"instances ≠ retros" discipline; count 1) + RETRO-231 §4a LG-1 / §5 (the pattern survived its first
dedicated remediation PR #639; §5's repo-wide scan named live-source mutation as the root coupling and
established the three shell gates as the immune precedent; count 2). Promotion trigger: RETRO-232 §2 / §6
(count 3) — survived a SECOND dedicated remediation PR #640; the fix works on the axis it targeted
(independently reproduced) yet the next legitimate change still reddens CI, and the synthetic-fixture
alternative was explicitly offered in FOLLOW-723 AC-1 and declined. RETRO-230 §6 pre-authorised promotion
"on the 2nd sighting", which RETRO-231 §6 identified as drafted ONE HOP EARLY against the ≥2-PRIOR bar,
declined, and re-issued in RETRO-229's correct P-15 form ("on the 3rd sighting"); RETRO-232 honours the
CORRECTED form only after re-deriving the count. CHECKED BEFORE MINTING: Rule Q (gate proves its assertion
RAN — orthogonal to fixture provenance; both consent gates satisfy Q and carry this defect), Rule AJ
(signal needs a consumer), Rule AK item 5 (red-first AT MERGE TIME — a live-source fixture passes that and
breaks on the NEXT change), Rule AL (region of an assertion; AM is provenance of a fixture). Clause 5 is
lifted from the one case in these gates that is already immune (the dynamically-derived TOS-version
anchor, RETRO-231 §4a LG-2 table row 2). LETTER CHOICE: AM follows AL, minted in the same retro. -->

---

## Rule AN — A number in a sequentially-allocated register (FOLLOW / RETRO / ADR / ESC / ROPA activity / DPIA section) MUST be allocated against `origin/main` and the allocating write MUST land on `main` before that number is used anywhere else; a number minted on a feature branch is not allocated, it is guessed

**Pattern:** Two writers need the next number in an append-only register. Each computes it as
`max(entries) + 1` — but from a **different tree**: one from `main`, one from a feature branch, one
from a stale dispatch brief, one from a concurrent retro run. Both get the same number. The register
is now double-booked, and because both writes are individually well-formed, nothing detects it: no
CI gate reads these files, `git merge` cheerfully keeps both `## FOLLOW-735` headings, and the
duplicate is found later by a human reading the file — or not at all, at which point two tickets,
two ADRs or two ROPA activities share an identifier that other documents cite. The failure is
silent, it is discovered downstream, and the repair is a rename that invalidates every
cross-reference already written against it.

The seductive part is that the arithmetic feels rigorous. `max + 1` **is** rigorous — over the tree
you ran it in. The defect is never in the counting; it is in the implicit premise that the tree you
counted is the register.

**Evidence — five sightings, four of them PRIOR numbered retros:**

- **RETRO-036 §6 (prior, count 1)** — minted the pattern: _"a sequentially-numbered append-only
  register … gets the SAME number assigned by two independent writers because neither checks the
  already-reserved number before writing — only the register's current max."_ Two instances in one
  run: ROPA "Activity 14" claimed by FOLLOW-218 five days after FOLLOW-187 reserved it (→ FOLLOW-227
  carried the renumber, and it **gated** FOLLOW-187), plus duplicate `RETRO-035` headers from
  concurrent retro runs. Set the explicit watch-item: _"a second register-number collision in a
  future retro promotes …"_.
- **RETRO-113 §7 (prior, count 2)** — _"the next free number is 390; RETRO-111 also references a
  FOLLOW-390 for the GET-surface question — to avoid a number collision I assign the GET-surface
  follow-up FOLLOW-390 and THIS prod-seed follow-up FOLLOW-391"_ — two retros allocating from the
  same max, caught only because one retro happened to read the other.
- **RETRO-154 §2 / §7 (prior, count 3 — the exact branch shape)** — _"the PR's third commit
  renumbered 475→482 to avoid the RETRO-151 collision … a bookkeeping fix for a
  **concurrent-branch** collision."_ A realized collision, repaired mid-PR, with the
  residual-pointer documentation in `events.ts` having to be re-pointed at the new number.
- **RETRO-188 (prior, count 4)** — the retro number itself: the dispatch brief said "use RETRO-276
  (max 275)" while the file's true max heading was RETRO-187; the stray 275/276 tokens were prose
  inside RETRO-063. Allocated from a stale non-register source.
- **RETRO-234 §6 P-18 (promotion trigger, count 5 — two live instances).** (a) A `FOLLOW-735` stub
  was written on the PR #642 branch while `main` independently received a **different** FOLLOW-735;
  the branch copy was deleted by hand —
  `git log origin/ml-engineer/FOLLOW-730-extraction-error-marker -- backlog/FOLLOW_UPS.md` →
  `a8bfc27e docs(backlog): drop duplicate follow-735 stub, main's copy is canonical`. (b) A
  **third** collision was armed at the moment of promotion: `FOLLOW-736` and `FOLLOW-737` exist only
  on the unmerged branch `pm-orchestrator/FOLLOW-735-adr-0020-shadow-write-admission` (`0f2a033e`,
  no PR), so `grep "^## FOLLOW-" backlog/FOLLOW_UPS.md` on `main` returns max 735 and the next
  session's next-free computation yields 736. RETRO-234 allocated from 738 and filed FOLLOW-742.

**Why RETRO-036's own proposed remedy is insufficient, and what this rule adds.** RETRO-036 proposed
_"grep the open FOLLOW/QUEUE backlog AND the register itself for the next **reserved** number, not
just the current max."_ That closes the reserved-but-unwritten axis (its ROPA case) and does nothing
for the branch axis: on a feature branch, grepping the register **more thoroughly** still reads the
wrong tree. The missing variable is **which tree you allocate from**, not how many places you grep
in it. Rule AN states the tree, and adds the landing requirement — because a number written only to
a branch is invisible to every other writer for as long as that branch stays unmerged, which on this
repo's evidence can be days.

**CHECKED BEFORE MINTING.** **Rule O** governs migration-journal monotonicity + recency — one
specific register, with an apply-time consequence, and RETRO-036 itself named it the structural
near-neighbour; it says nothing about ticket/RETRO/ADR registers or about branch-vs-`main`
allocation. **Rule AG** forbids parallel-worktree agents appending to a shared monotonic log and
prescribes per-ticket fragment files — a write-**conflict** remedy, not a **numbering** remedy:
fragments still need unique numbers, and AG's own remedy would not have prevented any of the five
sightings above. **Rule P** (check docs + repo for prior art before proposing) is about duplicate
_work_, not duplicate _identifiers_ — two writers can each be doing genuinely novel work and still
collide. **Rule J** (mirror-file sync) governs byte-identical duplicates across runtimes. None of
them covers allocation provenance.

**Rule:**

1. **Allocate from `origin/main`, always.** Before writing a new entry to any sequentially-allocated
   register, fetch and compute the next number from `origin/main`, not from your working tree, not
   from your branch, not from a dispatch brief, and not from a memory note. If you cannot reach
   `origin/main`, you may not allocate — say so and stop.
2. **Scan the whole namespace, not just the register file.** The next-free number is
   `max(register headings, references in QUEUE.md / STATUS.md / ESCALATIONS.md / HANDOFFS.md / open PR branches) + 1`.
   A number **reserved** in prose (a QUEUE note saying "filed FOLLOW-N") is taken even when no stub
   exists yet — RETRO-036's ROPA case and RETRO-188's brief case are both this shape.
3. **Land the allocating write on `main` before the number is used anywhere else.** A stub, ADR or
   retro that exists only on a feature branch is **not allocated**. Either commit the allocating
   write directly to `main` (backlog bookkeeping is permitted this), or open its PR immediately, or
   record a one-line reservation on `main` naming the number and the branch that holds it. Never all
   three of: mint on a branch, leave the branch unmerged, and tell another session the number is
   taken.
4. **A cross-branch collision is repaired by renumbering the LATER-LANDING write, and the repair is
   not complete until every cross-reference moves with it.** The canonical shape is RETRO-154's
   475→482: the renumber commit must also update the residual pointers in code comments, QUEUE rows,
   ticket `cross_ref` lists and any doc citing the old number.
5. **`main` is the register's source of truth for identity even when a branch is the source of truth
   for content.** When landing a branch that carries an allocated number, verify the number is still
   free on `main` **at merge time**, not only at branch time — the whole failure mode is that the
   two moments differ.

**Verification:**

1. `git fetch origin && git show origin/main:backlog/FOLLOW_UPS.md | grep -c "^## FOLLOW-"` and
   `… | grep "^## FOLLOW-" | tail -1` — the allocation baseline. Repeat for
   `backlog/RETROSPECTIVES.md` (`^## RETRO-`), `docs/adr/` (filenames), `backlog/ESCALATIONS.md`
   (`ESC-`).
2. `grep -rn "FOLLOW-<N>" backlog/ docs/` on `origin/main` for the candidate number — a prose-only
   reservation counts as taken (clause 2).
3. `git branch -r --sort=-committerdate | head -20`, then for each unmerged branch touching a
   register file: `git show <branch>:backlog/FOLLOW_UPS.md | grep "^## FOLLOW-" | tail -3` — this is
   the step that catches the branch-only allocations of RETRO-154 and RETRO-234 and is the one no
   prior remedy performed.
4. After landing any branch that allocated a number: re-run step 1 and confirm the heading appears
   exactly **once** (`grep -c "^## FOLLOW-<N>"` → `1`).

<!-- Rule AN added 2026-07-30 — RETRO-234 §6 (pattern P-18). Evidence (4 PRIOR numbered retros, well over
the ≥2 bar; arithmetic re-derived independently against RETROSPECTIVES.md line numbers, not taken from a
summary): RETRO-036 §6 (count 1, pattern minted + watch-item "a second register-number collision in a
future retro promotes …" — this rule discharges that watch-item), RETRO-113 §7 (count 2, two retros
allocating from one max), RETRO-154 §2/§7 (count 3, realized CONCURRENT-BRANCH collision repaired by a
475→482 renumber — the exact shape), RETRO-188 (count 4, RETRO number from a stale brief). Promotion
trigger: RETRO-234 §6 P-18 (count 5) — a realized branch-vs-main duplicate FOLLOW-735 deleted by hand
(a8bfc27e) PLUS a third collision armed at promotion time (FOLLOW-736/737 live only on an unmerged
branch), i.e. the pattern recurring twice inside a single ticket chain. CHECKED BEFORE MINTING: Rule O
(migration-journal monotonicity — one register, apply-time consequence, named by RETRO-036 as the
near-neighbour, silent on ticket registers and on branch allocation), Rule AG (parallel-worktree shared-log
APPENDS — a write-conflict remedy; per-ticket fragments still need unique numbers and would not have
prevented any sighting), Rule P (prior-art check — duplicate WORK, not duplicate IDENTIFIERS), Rule J
(mirror-file sync). Clause 3 is the axis RETRO-036's own remedy ("grep for the reserved number, not just
the max") does NOT cover: on a branch, grepping harder still reads the wrong tree. Clause 4's repair shape
is lifted verbatim from RETRO-154's successful repair. LETTER CHOICE: AN follows AM. -->

---

## Rule AO — A corrective edit whose purpose is to REMOVE a false or over-broad claim MUST be re-verified against the SAME PR's own evidence artefacts before merge; a correction written in fixing-mode inherits the mental model that produced the original error

**Pattern.** A defect is found in a claim — a doc paragraph, an ADR decision record, a comment, a
guard's stated invariant. Someone rewrites the claim specifically to make it true. The rewrite is
false, over-broad, or wrong on an adjacent case — and in the sharpest instances it is falsified by
evidence the same PR already produced and the same author already read. The correction is not
reviewed as a new claim, because everyone (author and reviewer) is evaluating it against the error
it replaces rather than against the code. "The old text was just disproved" reads as "the new text
is verified".

**Evidence (≥2 prior retros — promotion arithmetic).**

- **RETRO-234 §6 (count 1, minted the pattern).** PR #642's three review rounds: of 30 findings,
  round 2 found "10 more defects, **4 of them created by the round-1 fixes**"; round 3 found "10
  more and **9 of them lived in the don't-clobber logic added in rounds 1-2**". Directional
  instance: the round-1 fix that made Sentry delivery actually work (adding `sentry-sdk` to the
  Modal image) is what converted a dormant `include_local_variables=True` default into a live
  disclosure of raw buyer chat text. Pre-specified clause (a): _a fix that ENABLES a previously-dead
  code path must re-open the security/compliance review of everything downstream of it, because "it
  never ran" was the mitigation._
- **RETRO-235 §6 / CB-3 (count 2).** FOLLOW-741 existed **solely** to stop ADR-0020 asserting
  visibility channels that did not exist. Its fix asserted `SENTRY_DSN` provisioning was "blocked by
  FOLLOW-738" in four places (`ADR-0020:148-149`, `:165`, `:196`, `:200`); FOLLOW-738 merged **30
  minutes later** (`479ac0ef`, the very next commit) and made the fix false. Pre-specified clause
  (b): _a document amended to describe a blocker's existence has a lifetime measured in commits and
  must be written to expire (`BLOCKED-ON-#N`, Rule AH) rather than to assert._
- **RETRO-236 §4b CB-1 + §4a LG-1 (count 3, TWO live instances in one PR — promotion trigger).** (i)
  PR #645 rewrote the shadow-key retention statement in `C-07:96-97` and `ropa.md:133` **precisely
  to make it more accurate** ("24 hours from the last chat message that yielded at least one intent
  dimension") — and the new wording is false for the cold-key all-null record, which **the same PR
  verified as step 4 of its own evidence table** (`sess_cold`, `TTL 86400`, "the marked all-null
  record IS stored"). (ii) FOLLOW-741's amendment to ADR-0020 §D6, written to stop the ADR
  over-claiming visibility, over-claims visibility on the one channel it certified as real: it
  glosses "the key itself on a cold session" as "**i.e. exactly the case where there is no prior to
  lose**", but `SET … NX` keys on **key absence**, not on the absence of a prior — so a session that
  opens with "hi" has a record, no prior, and a permanently invisible degraded write.
- **Why the prior clauses do not cover the new instances, i.e. what this rule adds.** Clause (a) is
  about a fix that _enables_ dead code — neither RETRO-236 instance enables anything. Clause (b) is
  about a claim falsified by a _later, external_ commit — both RETRO-236 instances were false the
  moment they were written, and (b)'s remedy would not have helped: an expiring form of a wrong
  anchor is still a wrong anchor. The missing axis is **the direction the falsifying evidence comes
  from**. Here it came from inside the PR, from artefacts the author produced and read. That is the
  axis with a mechanical check attached, and it is clause (c) below.

**Rule.**

1. **A PR that edits an existing claim in order to correct it MUST treat the replacement as a NEW
   claim requiring its own verification** — never as verified-by-inheritance from the disproof of
   the old one. In the PR body, state the evidence for the _new_ wording separately from the
   evidence that the _old_ wording was wrong. These are two different sentences and must both be
   present.
2. **The replacement MUST be checked against every case in the same PR's own evidence artefacts** —
   verification table, live-run log, red-first output, new test names, the ACs' own proof steps. If
   the PR contains a row, a case or a log line the corrected claim does not cover, the claim is
   wrong or the row is out of scope, and the PR must say which. This is the cheapest check in the
   rule and it would have caught both RETRO-236 instances (`C-07`'s anchor vs the table's step 4;
   D6's "no prior to lose" vs the cold-NX-write case the same table proves).
3. **A corrected claim about a CONDITION must restate the condition in the code's own terms, not in
   the terms of the symptom that motivated the fix.** "The key does not exist" is the code's term;
   "there is no prior to lose" is the symptom's term, and the gap between them is where the third
   state lives. Where the claim is a data-retention or user-facing statement, the code's term wins
   even when it is less readable; add the readable gloss _after_ the exact statement, never instead
   of it.
4. **A corrective edit to a document is in scope for the same wiring/consumer audit as code.** If
   the PR edits one document asserting a fact, `grep` the repo for the other documents asserting the
   same fact and correct them in the same PR (this is Rule AI's obligation) — AND check that the
   file you are already editing does not retain a _different_ falsified assertion elsewhere in it.
   RETRO-236 §4b CB-2 is the miss: PR #645 edited `ADR-0020`'s header while leaving four falsified
   "blocked by FOLLOW-738" assertions in the same file, and wrote the CORRECT expiring form into
   `MASTER_DESIGN` in the same commit — leaving the repo holding both versions with the normative
   document carrying the wrong one.
5. **A review round N+1 brief MUST name round N's diff as its primary target** (RETRO-234's clause
   (a), retained), and **a fix that enables a previously-dead code path MUST re-open the
   security/compliance review of everything downstream of it**, because "it never ran" was the
   mitigation.

**Verification.**

- Reviewer check, mechanical, no tooling required: for every claim the PR _changes_ (as opposed to
  adds), locate the PR's own evidence artefact and read the corrected claim against each row of it.
  If the PR has no evidence artefact, the correction is unverified — say so in the PR body rather
  than shipping it silently.
- Retro check (this rule's own enforcement): a retro examining a PR that contains a corrective doc
  edit MUST re-derive the corrected claim from the code, not from the diff's plausibility. Both
  RETRO-236 instances were found this way and neither was visible from reading the diff.
- No CI gate is proposed. The falsification is semantic and the artefacts are prose; a grep-based
  gate here would be the Rule AE failure (a guard scoped to the one shape the finding happened to
  use) applied to natural language. If a mechanical check is ever wanted, the tractable one is
  narrow: **a PR that edits a compliance document's retention/lifetime sentence must also touch or
  cite a test or evidence artefact** — nothing broader.

<!-- PROMOTED by RETRO-236 (2026-07-31). Pattern P-19 "THE FIX ROUND IS THE DEFECT SOURCE", count 3,
PRIOR RETROS: RETRO-234 §6 (count 1, review-round mechanism, clause (a)) and RETRO-235 §6 / CB-3
(count 2, concurrent-merge mechanism, clause (b)). Promotion trigger: RETRO-236 §4b CB-1 + §4a LG-1 —
TWO instances in a single PR, both falsified by evidence INSIDE that PR (the C-07/ropa retention
anchor vs the PR's own verification-table step 4; ADR-0020 D6's "no prior to lose" gloss vs SET…NX
key-absence semantics), i.e. a third distinct MECHANISM (self-falsifying correction) that neither
prior clause covers. CHECKED BEFORE MINTING: Rule AI (must update every doc asserting the prior state
in the same PR — the TRIGGER rule; fires on docs NOT updated, silent on the accuracy of docs that
WERE updated; both RETRO-236 instances are docs correctly updated with wrong content), Rule AH
(operator-executable instruction verified at the doc's own merge commit, BLOCKED-ON-#N form — nearest
neighbour, owns RETRO-235's instance, but neither RETRO-236 instance is an operator instruction and
CB-1 would PASS AH's merge-commit check because SET…NX is real and merged), Rule Y (a citation naming
a test/file must be verified against that file — about artefact citations, not about factual claims
derived from code; RETRO-236 DG-3 is a Y instance and is deliberately filed under Y, not here),
Rule AE (a mechanical guard must enumerate every call-shape — same ORGAN, one domain over, code not
prose, no evidence/doc axis). Clause 2 is the novel, mechanically checkable part and the reason the
rule earns its letter. Clause 5 preserves RETRO-234's clause (a) verbatim so promotion does not drop
the first sighting's remedy. LETTER CHOICE: AO follows AN. -->

---

## Rule AP — A gate's "known residual gaps" list MUST be a MACHINE-CHECKED register the gate itself executes, not prose; and every PR that adds a new predicate/control to a gate MUST add that control's OWN region-and-scope entry, not rely on the detection axis's

**Pattern.** Four consecutive retrospectives found the same thing about four consecutive
gate-hardening PRs: **every individual fix was correct, and every PR's own enumeration of what
remained open was one shape short.** The incompleteness is systematically invisible for one reason —
the enumeration is **prose**. A prose residual list cannot be wrong-in-CI, cannot go stale loudly,
and cannot be diffed against the mechanism it describes. It is the only artefact in these gates that
makes a claim about coverage and has no consumer.

The second half of the rule is the sharper half, and it is what the fourth sighting added: the
residual lists in this repo are written **per gate**, on the **detection** axis, and are then
inherited unchanged by every control added afterwards. When a PR bolts a _new_ predicate onto a gate
(a baseline comparator, a clearance test, a marker check, a discovery source), that predicate has
its own region, its own scan root and its own failure modes — and none of them are covered by a
residual written about the original detector.

**Evidence (≥2 prior retros — three, with exact citations):**

- **RETRO-237 §6** (the Rule AE scope-broadening + clearance-side amendment). Sighting 1 of the
  chain: `check-sentry-capture-has-init.sh` shipped with an enumeration written about its detection
  side while its two worst holes were on the **clearance** side. RETRO-237's own words: a guard with
  perfect detection and a leaky clearance test "reads as _more_ trustworthy because it is
  'specific'".
- **RETRO-238 §4b CB-3 and §8.** PR #648's AC6 asked for an explicit statement of whether the class
  was fully enumerated; the PR answered _"PARTIALLY, the residual is {unscanned dirs, unquoted
  word-split}"_. RETRO-238: **_"an enumeration itself short by at least this shape and CB-1's"_**,
  and in §8: **_"the AC6 answer should read 'partially enumerated, and the enumeration is itself
  partial'"_**.
- **RETRO-239 §6 and §8.** **_"This is the third consecutive retro in which a gate-hardening PR's
  own enumeration of what remains is one shape short … The pattern is not 'the fix was wrong' —
  every fix in this chain worked. It is 'the enumeration of the residual is systematically
  incomplete, and the incompleteness is invisible because the enumeration is prose.'"_** RETRO-239
  **declined** to promote — correctly, because Rule AE already demands full enumeration, so the
  defect is in application, not wording — and **pre-specified the trigger for this rule**: _"if a
  fourth consecutive retro reaches the same verdict, the right response is not a fourth AE sighting
  but a **mechanical** residual register (a machine-checkable per-gate list), which would be a new
  rule with a real mechanism."_ FOLLOW-760 AC5 was graded **PARTIAL** on the same basis.
- **RETRO-240 §4b CB-1 and §4d DG-1 — the pre-specified fourth sighting, triggered TWICE
  independently in one merge pair.** (a) PR #652 gave `check-sentry-init-singleton.sh` the best
  residual list in the chain (A, B, C1/C2/C3, D, E, F) and it _still_ does not state that
  FOLLOW-765's two **new** controls inherit the `apps/*/src` bound, while the header (`:52-55`) and
  `scripts/baselines/sentry-init-mirror-exclusions.baseline` both assert the redden-on-a-fourth-pair
  guarantee **unconditionally**. (b) PR #655 gave `check-mirror-files.sh` a hard `git ls-files`
  dependency with a silent-degradation failure mode and a tracked-files-only semantic narrowing, and
  that gate has **no residual section at all** — it is the only one of the three without one.

**Rule.**

1. **Every CI/pre-push gate that documents deliberately-unguarded gaps MUST express them as a
   REGISTER, not prose.** One entry per residual, each carrying: a stable id (`A`, `B`, `C1`, …), a
   one-line description, the **control it applies to** (which predicate — detection, clearance,
   exclusion, discovery, inventory), and a **`latency proof`: a single shell command whose empty (or
   zero) result means the residual is still latent**.
2. **The gate MUST execute its own register on every run** and report per entry. A residual whose
   latency proof now returns hits has **gone live**: the gate must fail with a diagnosis distinct
   from an ordinary finding, naming the entry id. A residual whose proof cannot be executed is also
   a failure — never "assume still latent" (the FOLLOW-760 contract, applied to the register).
3. **A PR that adds a NEW predicate/control to a gate MUST add that control's own register
   entry/entries**, stating at minimum its **region** (what it iterates), its **scan root**, and
   what it does when its input is unavailable. It may not rely on an existing entry written about
   the detector. A PR that adds a control and no entry is incomplete regardless of test coverage.
4. **Any prose claim about a gate's coverage — in the script header, in a committed baseline's
   comment, in a runbook — MUST be qualified by the register entry that bounds it**, or must be
   written unconditionally only when no entry bounds it. An unconditional guarantee whose mechanism
   is region-bounded is a Rule AI violation as well as this one.
5. **Retirement is a diff, not a deletion.** Removing a register entry requires the fix that closes
   it in the same PR, or an explicit downgrade note. Silently dropping an entry is the failure this
   rule exists to make impossible.
6. **Scope.** This binds gates under `scripts/` that are wired into a blocking CI job or a
   `lefthook` hook. It does not bind application code, and it does not require a new framework — a
   bash array of `id|control|description|proof-command` tuples iterated at the end of the run
   satisfies it. FOLLOW-770 AC5 is designated the reference implementation.

**Verification.**

- Reviewer check, mechanical: for every gate touched by a PR, `diff` the set of predicates against
  the set of register entries. A predicate with no entry naming it fails review.
- The gate's own `--self-test` MUST include one fixture proving a **register entry going live is
  caught** (mutate a fixture so one latency proof returns a hit; assert the distinct diagnosis and
  the entry id in the output). Red-first against the pre-register script.
- The register's proof commands are themselves subject to **Rule AL**: each must be evaluated over
  the same region the control it describes reads. A proof that greps the whole repo for a residual
  bounded to `apps/*/src` is wrong in the direction that looks reassuring.
- Cheap grep for auditors: a gate whose header contains the words "deliberately unguarded",
  "residual", "known gap" or "not fixed here" and which prints no per-entry status line on a normal
  run is non-compliant.

<!-- PROMOTED by RETRO-240 (2026-08-03). Pattern "A GATE'S RESIDUAL ENUMERATION IS SYSTEMATICALLY ONE
SHAPE SHORT, AND THE INCOMPLETENESS IS INVISIBLE BECAUSE THE ENUMERATION IS PROSE", count 4, PRIOR
RETROS: RETRO-237 §6 (count 1, clearance-side vs detection-side), RETRO-238 §4b CB-3 + §8 (count 2,
"an enumeration itself short by at least this shape"), RETRO-239 §6 + §8 (count 3, "third consecutive
retro … the incompleteness is invisible because the enumeration is prose" — DECLINED promotion and
PRE-SPECIFIED this exact rule as the fourth-sighting response). Promotion trigger: RETRO-240 §4b CB-1
+ §4d DG-1 — TWO independent instances in one merge pair, in two different scripts, by two different
dispatches (#652's best-in-chain residual list still missing its own new controls' region bound;
#655's script having no register at all while acquiring a hard git-index dependency). CHECKED BEFORE
MINTING: Rule AE and the Rule AE amendment (demand full enumeration of call-SHAPES for a mechanical
guard — the ORIGIN rule and the one RETRO-239 correctly said already covers the obligation; AP does
not restate it, it converts the obligation's ARTEFACT from prose into an executed register, which is
the "defect is in application, not wording" diagnosis made actionable), Rule AL (assertion region ==
consumer region — fires on individual proofs and is invoked BY clause 4 of the verification section,
but says nothing about whether a residual list exists or is complete), Rule AM (fixture provenance —
orthogonal), Rule Q (a soft-skippable gate must emit positive proof its assertion ran — nearest
neighbour on the "prove it executed" axis, but Q governs the ASSERTION and AP governs the
KNOWN-GAP LIST, which Q explicitly does not reach), Rule AH (an operator-executable doc instruction
verified at its own merge commit — about docs for humans, not a gate's self-executed register),
Rule Y (a citation naming a test/file must be verified against that file — a citation-accuracy rule;
AP's clause 2 is about executing a proof, not verifying a citation), Rule AI (fires jointly with
clause 4 and is named there rather than duplicated). LETTER CHOICE: AP follows AO. NOTE: this
promotion moves the CONVENTIONS_PATCH rule count to 42, against docs/MASTER_DESIGN.md §Snapshot.6's
recorded 27 — filed as FOLLOW-772 per Rule AI, since MASTER_DESIGN is outside the retro's write
scope. -->

---

## Rule AQ — A block of code DECLARED identical across files MUST be extracted or machine-checked; a prose "copied verbatim, keep in sync" note is not a control, and the reference MUST name its copies as explicitly as the copies name the reference

**Pattern.** Rule J was promoted because a PR body saying "kept in sync" is not a gate. The pattern
it was promoted on has now recurred **three times in shapes Rule J's mechanism cannot express**, and
the third recurrence is inside the gate that implements Rule J.

Rule J's manifest (`scripts/mirror-files.json`) compares **whole files**, keyed by path, discovered
by **basename**. Rule K.1 covers intra-runtime duplication of a **"function/route that computes a
metric or business value"**. Between them sits a gap that keeps producing duplicates: a **contiguous
REGION** of a file, copied into files with **different names and different overall content**, in the
**same runtime**, in code that is **infrastructure rather than business value**. Neither the
manifest nor basename discovery nor Rule K.1's grep can see it. What such duplicates always have
instead is a **comment** — "byte-identical", "copied verbatim", "keep in sync", "do not clean it up
per gate" — which is a claim about coverage with no consumer, i.e. the artefact Rule AP was promoted
to abolish, in a different medium.

The second half of the rule is the half the third sighting added and it is the sharper one: **the
pointer is one-directional.** In every instance so far, each copy names its origin and **the origin
names nothing**. That is exactly backwards. A contributor editing a copy is already reading a
warning; the contributor most likely to make a _substantive_ change is the one working in the file
everyone calls canonical — and that file is silent.

**Evidence (≥2 prior retros — four, with exact citations):**

- **RETRO-231 §6 (count 1).** Three byte-identical helpers duplicated across two `scripts/*.mjs`
  gates, recorded as a "Rule J / Rule K.1 scope-boundary sighting, no amendment proposed yet" (→
  FOLLOW-725). RETRO-231 established that gate/test-harness machinery does not reach Rule K.1's
  "business value" framing.
- **RETRO-233 §6 (count 2).** A whole Python function (`_valid_bearer`) **plus a 24-line inline
  block** inside a larger function — intra-app and **partial**. It declined promotion at one prior
  retro and **pre-specified what the third sighting must carry so the rule would not be
  under-scoped**: _"**(a)** a comparison strategy that is language-agnostic … and **(b)** a strategy
  for a REGION of a file rather than a whole file, since neither RETRO-231's nor this instance is a
  file-level mirror."_
- **RETRO-235 §6 (held at 2, and this is the decisive prior).** It **declined** a sighting the
  arithmetic appeared to authorise, because the Python mirror pair in question **was registered**
  and Rule J passed on it: _"This is the pattern's remedy being applied — the first time in Python —
  not its recurrence. Counting a compliant instance would have inflated the arithmetic and codified
  a rule off evidence that argues the opposite."_ It also **measured** the one candidate that would
  have qualified and rejected it on the measurement (`check-sentry-init-singleton.sh` vs
  `check-modal-app-singleton.sh`: 36% identical lines, largest common block **8 lines**, all of it
  comment/echo boilerplate — _"two scripts sharing a house style, not a declared-identical
  duplicate"_). It added clause **(c)** (an opt-in registry cannot enforce a repo-wide invariant
  without a discovery step) and recorded the pattern as **"count 2, pre-authorised for promotion on
  the next genuine (i.e. UNREGISTERED) sighting."**
- **RETRO-238 §6 (held at 2).** Declined again, on a _prediction_ rather than a sighting — _"A
  prediction is not a sighting"_ — and wrote the prevention into FOLLOW-764 instead.
- **RETRO-242 §4b CB-1 — the promoting, pre-authorised sighting.** The Rule AP residual-register
  runner exists **byte-identically in three blocking gates**: `check-mirror-files.sh:1109-1166`,
  `check-sentry-capture-has-init.sh:1253-1310`, `check-sentry-init-singleton.sh:1428-1485` — all
  three `md5sum` to **`5fa38c527c083faf0dc83b3c8d9f6a00`**, 58 lines each, against file sizes of
  1195 / 1381 / 1600 lines. It is **declared** identical in prose in both copies (_"byte-identical
  to scripts/check-mirror-files.sh's … Do not 'clean it up' per gate"_) and
  **`grep -rn "byte-identical to scripts/check-mirror-files" scripts/` returns 2 hits, both in the
  copies, ZERO in the reference**. It is registered nowhere: `scripts/mirror-files.json` holds 4
  pairs, none of them these; the whole-file model cannot express 58-of-1195; three different
  basenames defeat discovery; and no register entry in any of the three gates bounds it. It
  satisfies RETRO-233's clause **(b)** — a region of a file — which **no prior sighting could**, and
  RETRO-235's UNREGISTERED condition exactly. The stakes are recorded in the duplicated code's own
  commit message (`faa4753b`): the fix was placed **in the runner** _"so every entry added later —
  or copied into another gate — inherits it"_ — and the runner is now the one artefact in that
  estate that cannot propagate a fix.

**Rule.**

1. **A duplication that is DECLARED identical is a contract and MUST have a mechanism.** If a PR
   copies a contiguous block of ≥ 20 non-blank, non-comment lines into another file and any artefact
   (comment, PR body, commit message, ticket) states that the copies are identical or must stay in
   sync, the PR MUST do **one** of: **(a)** extract the block into a shared module the copies load
   at runtime (for shell, the `scripts/lib/` convention: `source` + `declare -F` assertion +
   `exit 2` when absent; for TS, a workspace package; for Python, a mirrored module already
   registered under Rule J); **(b)** register the duplication in a machine-checked comparison that
   runs in a blocking job and names which copies diverged; or **(c)** add a **Rule AP register
   entry, in every file holding a copy**, whose latency proof compares that copy against the others.
   Choose one and say why the other two are worse — do not stack them.
2. **Reciprocity is mandatory and is the clause most often missed.** Every copy MUST name its origin
   **and the origin MUST name every copy, by path**. A one-way pointer is not a control: it warns
   the party least likely to make the change that matters. This clause is satisfiable in one comment
   line and is the minimum acceptable outcome even when clause 1's option (c) is chosen.
3. **Do not cite Rule J as coverage for a region.** `scripts/mirror-files.json`'s pair model is
   whole-file and its discovery is basename-keyed; a duplicated region in two differently-named
   files is invisible to **both**. A PR creating such a duplication may not record "covered by Rule
   J", and a reviewer may not accept that answer. If the duplication genuinely is whole-file,
   register it under Rule J and this rule is discharged.
4. **The "canonical" designation raises the bar, it does not lower it.** If a rule, ADR or ticket
   names one copy the reference implementation for others to copy (as Rule AP clause 6 does), that
   designation makes clauses 1 and 2 **mandatory rather than advisory**, because the copy count is
   expected to grow. A designated reference with no mechanism and no back-pointer is incomplete
   regardless of test coverage.
5. **Scope and threshold.** This binds duplication **within one runtime** and covers infrastructure,
   gate and harness code — precisely the region Rule J (`apps/decision-api/src/lib/` cross-runtime
   file mirrors) and Rule K.1 ("a metric or business value") leave uncovered. It does **not** bind
   incidental similarity: a shared house style, boilerplate echo blocks, or a block nobody has
   declared identical. RETRO-235's measurement is the operative test — **declared identical, or a
   largest-common-block that is substantive rather than boilerplate**; 36%-similar scripts with an
   8-line common comment block are not a duplicate.

**Verification.**

- Reviewer check, mechanical, cheap:
  `grep -rn "byte-identical\|copied verbatim\|keep in sync\|kept in sync\|do not clean it up\|mirror of" --include=*.sh --include=*.ts --include=*.py --include=*.mjs . | grep -v node_modules`
  — **every hit must resolve to a shared module, a registered pair, or a Rule AP entry with a
  comparison proof**, and must have a reciprocal pointer at the other end. A hit whose only
  mechanism is the sentence itself fails review.
- Bidirectionality is a second, separate grep: for each declared duplicate, grep the **origin** for
  the copies' paths. Zero hits in the origin is a finding on its own (clause 2).
- If clause 1 option (b) or (c) is taken, the comparison MUST have a red-first fixture: mutate ONE
  copy by a single character in a **synthesized** tree (Rule AM — never the live source) and show
  the gate going red naming the diverged file, then restore and show it green.
- The comparison itself is subject to **Rule AL**: it must compare the same region it claims to
  compare. A checksum over a line range is only valid while the range is derived, not hard-coded.

<!-- PROMOTED by RETRO-242 (2026-08-03). Pattern "SAME-RUNTIME DECLARED-IDENTICAL DUPLICATE IN THE
Rule J / Rule K.1 GAP", count 3, PRIOR RETROS: RETRO-231 §6 (count 1, three byte-identical helpers
across two scripts/*.mjs gates → FOLLOW-725), RETRO-233 §6 (count 2, Python _valid_bearer + a 24-line
inline block; PRE-SPECIFIED clauses (a) language-agnostic and (b) REGION-of-a-file), RETRO-235 §6
(HELD at 2 because its candidate was REGISTERED — "the pattern's remedy being applied, not its
recurrence"; added clause (c); and PRE-AUTHORISED promotion on "the next genuine (i.e. UNREGISTERED)
sighting"), RETRO-238 §6 (HELD at 2 on "a prediction is not a sighting"). Four priors; threshold is
two. PROMOTION TRIGGER: RETRO-242 §4b CB-1 — the Rule AP register runner byte-identical in THREE
blocking gates (md5 5fa38c527c083faf0dc83b3c8d9f6a00 on all three), DECLARED identical in prose in
the two copies only, ZERO back-pointer in the designated reference, registered nowhere, and
inexpressible in mirror-files.json's whole-file/basename-keyed model. This is the FIRST sighting to
satisfy RETRO-233's clause (b), which is why the rule is built around a REGION rather than a file.
CHECKED BEFORE MINTING: Rule J (the ORIGIN rule — its normative scope is apps/decision-api/src/lib/
files with a top-of-file JSDoc canonical declaration, and its manifest cannot express a region; AQ
does not restate J, it covers J's gap and clause 3 forbids citing J for it), Rule K.1 + its
2026-06-03 amendment (scope is "a function/route that computes a metric or business value" —
RETRO-231 §6 established gate/harness machinery does not reach it), Rule AP (governs whether a gate's
RESIDUALS are enumerated and executed, not whether the gate's own MACHINERY is duplicated — AQ clause
1(c) routes THROUGH AP rather than restating it, and AQ clause 4 is triggered BY AP clause 6's
reference-implementation designation), Rule AL (assertion region == consumer region — invoked by AQ's
verification section, says nothing about duplication), Rule AM (fixture provenance — invoked, not
duplicated), Rule AI (claim breadth — adjacent, and it fires on the "keep in sync" sentence, but AI
asks the claim to be narrowed while AQ asks for a mechanism), Rule AO (corrective edits — no),
Rule Y (citation accuracy — no). LETTER CHOICE: AQ follows AP. NOTE: this promotion moves the
CONVENTIONS_PATCH rule count to 43 and the range to AA-AQ, against docs/MASTER_DESIGN.md
§Snapshot.6:564's recorded 42 — filed as FOLLOW-779 per Rule AI, since MASTER_DESIGN is outside the
retro's write scope; FOLLOW-779 also carries the two FALSE ID RANGES at §Snapshot.6:562-563 that
FOLLOW-772's own closure introduced. Rule AP was DELIBERATELY NOT AMENDED by RETRO-242: it is one
retro old and no amendment bar was met — see RETRO-242 §6. -->

<!-- RULE ACTION 2026-08-07 (RETRO-259, PR #690 / FOLLOW-816): Rule S AMENDED IN PLACE (2026-08-07 block above)
— a deferred sibling's justification MUST be a filed FOLLOW-NNN, never prose. This DISCHARGES the arming
RETRO-250 §6 set on 2026-08-05, on its clause (b) ("a sibling deferred in PROSE later found under-assessed,
mis-graded or never filed"), at count 2. Clause (a) was tested and REFUSED (no enumerate-not-fix instruction
in FOLLOW-816's stub or in the db50e3b2 dispatch brief; counting AC(2)'s pre-authorised deferral would be the
RETRO-122 conflation RETRO-255 already refused). RETRO-258 pre-authorised RETRO-259 to RETIRE the arming if
clause (b) failed BY COMPLIANCE a sixth time — it did not: #690 broke the norm and the break left FOLLOW-819
AC(3) requiring a row the substrate cannot produce, which is exactly the measured harm RETRO-254/258 said was
missing when they declined. NO NEW LETTER (the arming forbids one; Rule S owns the territory): rule count
stays 43, range AA-AQ, Rule S amendments 1 -> 2. NOT promoted by RETRO-259: the interrupted-session /
stranded-worktree class (5th sighting, FIRST with zero loss — worker output was merged, only PM bookkeeping
was lost and it was reconstructed; remedy owned by FOLLOW-448/573/645; the memory note
feedback_check_worktrees_before_concluding_agent_didnt_run worked unprompted — bar pre-specified in RETRO-259
§6); P-39 MINTED at count 1 ("a harness asserts against a constant the deciding code does not read") with a
3-clause bar, tested against Rule Q / Rule AL / Rule AM / Rule AK item 5 and none fires. -->

<!-- RULE ACTION 2026-08-07 (RETRO-260, PR #692 / FOLLOW-875+877 squash e55063b0 and PR #693 / FOLLOW-881
squash dc36740a): Rule AI AMENDED IN PLACE (2026-08-07 block, its SECOND amendment) — the Rule AI sweep MUST
run at THREE vocabularies (symbol / literal VALUE + its comparison operators / prose paraphrase quoted
verbatim from the retracted sentence), its corpus MUST include packages/**/__tests__/** and
packages/**/schemas/**, and the closing evidence MUST be a per-hit adjudicated list — "the document is now
clean" does not discharge the rule. NO NEW LETTER: the class ("a correction that leaves siblings asserting the
retracted claim") IS Rule AI, promoted on RETRO-213/221/222 and amended on RETRO-246; minting an AR for it
would duplicate AI and split its evidence base (RETRO-122 discipline). Rule count stays 43, range AA-AQ,
Rule AI amendments 1 -> 2, Rule AI sightings 4 -> 7. TRIGGER: one claim ("DOM_ADAPT_CONFIDENCE_FLOOR = 0.5 is
the description-axis gate") corrected three times, each round finding more — FOLLOW-875 missed MASTER_DESIGN
(-> FOLLOW-881), FOLLOW-881 missed §E.4.6 (-> FOLLOW-882), and FOLLOW-882's own closing grep
(`CONFIDENCE_THRESHOLD\|DOM_ADAPT_CONFIDENCE_FLOOR` over MASTER_DESIGN) cannot see the FIFTH site
(MASTER_DESIGN.md:2086, "combined_confidence < 0.6" — the same permissive-boundary error written as a BARE
LITERAL) or the SIXTH (packages/sdk/src/__tests__/follow-354.test.ts:20-22, still "SOLE gate", contradicting
its own AC-1 six lines later). Every sweep inherited the vocabulary of the round that found the bug.
FOLLOW-887 discharges the amendment live. NOT promoted by RETRO-260: P-40 MINTED at count 1 ("a drift guard
asserts a LOCAL COPY of the constant it claims to guard, so it can only detect drift in itself" —
follow-877.test.ts:74 + D-6b) with a 3-clause bar, and RETRO-260 explicitly REFUSED to count it as P-39's
second sighting because P-39 clause (a) requires the assertion to READ from source and this one hardcodes;
P-39 stays at count 1. Also NOT promoted: the FROZEN-convention re-pricing gap (FOLLOW-849's FOURTH sighting)
— the failure mode is real (priority is set once, from the first sighting; rediscovery cost accrues
invisibly) but the remedy is stub metadata rather than an agent constraint, and the PM's manual P2->P1
re-pricing is a control succeeding; bar pre-specified in RETRO-260 §6. RECORDED AS A CONTROL THAT WORKED:
Rule AN held across four allocating writes on three branches (#691's FOLLOW-874 vs main's 875..882) — the
merge conflicted on CONTENT, not on a duplicated number. RULE AG's 2026-08-05 amendment (the PM's LANDING
OBLIGATION for a no-Bash agent's learning entry) fired for the FIRST time since promotion and is recorded as
a COMPLIANCE failure against an adequate control, no rule action: .claude/agents/architect/lessons.md is
MODIFIED AND UNCOMMITTED on main at 648a0bb9 (PR #693 carried docs/MASTER_DESIGN.md alone), and its closing
sentence — "grep the document for every occurrence of the constant's NAME and its VALUE; the fourth wrong
statement was findable only by value (0.6), not by the constant name" — IS the Rule AI amendment above,
reached independently by the FOLLOW-881 architect hours earlier and lost in transit. That is the strongest
corroboration available for this amendment: the estate generated the control and dropped it, rather than
failing to conceive it. Remedy: FOLLOW-888 (P2, pm-orchestrator, 1h). -->

---

## Rule AR — A claim of ABSENCE that scopes or closes work MUST be produced by ≥2 INDEPENDENT search strategies — at least one LEXICAL and at least one STRUCTURAL — and the record MUST name both and paste their commands; a negative reached by one strategy is a hypothesis, not a verdict

**Pattern (UNVERIFIED-NEGATIVE):** An agent, PM or audit writes a negative — _"X is unaffected"_,
_"no such reference exists"_, _"nothing consumes this"_, _"it imports only third-party modules"_,
_"the toggle does not exist"_ — and that negative is then used to **scope or close work**: to
exclude a component from a fix, to satisfy an acceptance criterion, to close a ticket or an
escalation. The negative is produced by **one** search: one grep for one naming token, one read of
one file region, one enumeration of the sinks the author happened to think of. Positives get
challenged because a reviewer can see the thing being claimed; **a negative presents no object to
inspect, so it travels through handoffs with materially less scrutiny than a positive of the same
weight** — and it is cheap to write and expensive to verify. When the negative is wrong, the work it
scoped is silently narrower than the defect, and nothing goes red: the excluded component simply
stays broken, often latently, until something invokes it.

**Evidence (≥2 PRIOR retros, per the AA/AB/AC/AD/AE/AF/V/Q adjudication — the promoting retro does
not inflate the count):**

- **RETRO-217 §6 (count 1, PRIOR, and it ARMED this promotion in its own words)** — the
  `ProfilingToggle` / `OptedOut` absence claim, **wrong across three separate audits**, which
  falsified FOLLOW-641's entire charter (_"build the opt-out toggle UI — none exists"_; it had
  shipped in PR #337). RETRO-217 held at count 1, distinguished the pattern from Rules AC/AD and
  OPERATING*PRINCIPLES Rule 5 (*"those govern POSITIVE enumeration completeness; absence-proof is
  the mirror"_), and pre-authorized promotion verbatim: _"an absence/negative claim requires ≥2
  independent search strategies — **naming variants AND import-graph/mount-point** — before it is
  recorded as a verdict … on the NEXT independent-subsystem sighting."\_
- **RETRO-247 §4d DG-1 + §5b (count 2, PRIOR — the mount-point half)** — a negative quantified over
  four sinks on evidence covering three, recorded as closure evidence in `ropa.md:534-539`,
  `C-07:250-259` and `dpia.md:255-258`. §5b names the pattern in the arming's own terms: _"every
  future compliance correction inherits DG-1's shape — a negative claim is cheap to write and
  expensive to verify."_ **Weakness stated rather than hidden: RETRO-247 homed the REMEDY in Rule AO
  and did not bank this against RETRO-217; RETRO-262 banks it retroactively, which is the retro
  loop's designed mechanism but is one degree weaker than a self-declared count. It qualifies under
  RETRO-217's own two-strategy text, which names mount-point enumeration as the second strategy.**
- **Promotion trigger — RETRO-262 (FOLLOW-900 / PR #698), count 3, does NOT inflate.** The PM's
  dispatch brief asserted `apps/intent-engine` "imports only third-party modules". **True of its
  module-level imports; false of its import graph** — `apps/intent-engine/src/main.py:82-83` imports
  `nlp` and `redis_writer` **inside `process_chat_message`**, which pull `observability` and
  `schemas`; all four are local. The claim **gated a decision**: it scoped a P1's AC(6) audit to
  exclude a second Modal app carrying the identical dead-image defect. Registration succeeds and
  `modal app list` reports `deployed`, so the first real invocation would have died with
  `ModuleNotFoundError` inside a `.spawn()` the ingest Worker had already 202'd away from. It was
  wrong in the safe direction only because nothing had invoked that app in production. The dispatch
  brief's instruction _"re-verify, do not inherit"_ — a human sentence doing a control's job — is
  the sole reason it surfaced.
- **Subsystem independence, tested:** SDK/control-plane symbol naming (217) · compliance docs and
  Python observability sinks (247) · Modal/Python deploy import graph (262). Three subsystems, and
  between them all three strategies RETRO-217 named.

**Rule:**

1. **SCOPE — this rule fires ONLY on a DECISION-GATING negative.** A negative used to (a) exclude a
   file/module/app/tenant/route from the scope of a fix, audit or sweep, (b) close a ticket,
   escalation or acceptance criterion, or (c) stand as closure evidence in a durable record (QUEUE,
   FOLLOW*UPS, ESCALATIONS, RETROSPECTIVES, a runbook, a compliance document, a PR body's per-AC
   status). **A negative offered as colour in prose is out of scope** — requiring two search
   strategies for every *"X is unaffected"\_ sentence in a retro would be unaffordable and would be
   ignored, which is worse than absent.
2. **TWO INDEPENDENT STRATEGIES, at least one of each kind.**
   - **LEXICAL** — a text search over **naming variants**, not one token: the symbol, its
     casing/kebab/snake variants, its value, and the natural-language paraphrase.
   - **STRUCTURAL** — a search that does not depend on how the thing is spelled: an import/call
     graph walk **at any nesting depth** (function bodies, `try:` blocks, conditional imports), an
     AST query, a mount-point / sink / route / consumer enumeration derived from a registry rather
     than from memory, or a type-checker/compiler result.
   - The two must be **independent**: two greps with different tokens are one strategy.
3. **THE RECORD NAMES BOTH AND PASTES THE COMMANDS.** _"Verified: no consumers"_ is not a verdict.
   _"`grep -rn 'foo\|Foo\|FOO_' packages apps` → 0 hits; AST import-graph walk from the 3 registered
   entrypoints → not reachable"\_ is. A negative whose record shows one strategy is downgraded to a
   **hypothesis** and MUST be re-verified by whoever depends on it.
4. **A HANDOFF DOES NOT LAUNDER A NEGATIVE.** A decision-gating negative inherited from a brief,
   stub, prior retro, PM message or prior PR carries its original evidence, not the authority of the
   handoff. If the two strategies are not in the record, the receiving agent re-verifies or states
   in writing that it did not. **The receiving agent's re-verification finding takes precedence over
   the brief**, and disagreement is reported, not silently resolved.
5. **MODULE-LEVEL IS NOT A PROGRAM.** For any negative about what code imports, calls, reads or
   writes, the structural strategy MUST cover function bodies, methods, conditional and lazy imports
   — the FOLLOW-900 class exists because a module-level read looked clean.

**Verification:**

```bash
# 1. Decision-gating negatives in the durable record that cite no command at all.
grep -rnE "(is|are) unaffected|no (such |other )?(reference|consumer|producer|caller|usage)s? (exist|found)|nothing (consumes|reads|imports|calls)|only third-party|does not exist" \
  backlog/QUEUE.md backlog/FOLLOW_UPS.md backlog/ESCALATIONS.md backlog/HANDOFFS.md docs/runbooks/
#    Each hit that SCOPES or CLOSES work must have two named strategies within its own block.
# 2. The structural half for a code-structure negative is not a grep. Minimum bar, per language:
python3 - <<'PY'   # Python: imports at ANY nesting depth, not just module level
import ast,sys,pathlib
for f in pathlib.Path(sys.argv[1] if len(sys.argv)>1 else "apps").rglob("*.py"):
    t=ast.parse(f.read_text(encoding="utf-8"),filename=str(f))
    for n in ast.walk(t):
        if isinstance(n,(ast.Import,ast.ImportFrom)):
            print(f, getattr(n,"lineno","?"), ast.dump(n)[:80])
PY
# TypeScript: `tsc --noEmit` / an AST pass, NOT `grep "import"` — dynamic import() and
# re-exports are invisible to a line grep.
# 3. A negative reused across PRs: the second use must cite the first's commands or re-run them.
grep -rn "re-verify, do not inherit" backlog/ .claude/agents/   # the instruction this rule replaces
```

<!-- Rule AR added 2026-08-08 — RETRO-262 §6. 44th permanent rule; range AA–AR (single letters A–Z exhausted per the Rule AA note). Evidence (≥2 PRIOR numbered retros): RETRO-217 §6 (count 1, ProfilingToggle/OptedOut absence claim wrong across three audits, falsifying FOLLOW-641's charter — held at count 1 with an explicit verbatim pre-authorization naming "naming variants AND import-graph/mount-point" and "the NEXT independent-subsystem sighting") + RETRO-247 §4d DG-1 / §5b (count 2, the mount-point half — a negative quantified over four sinks on three sinks' evidence, recorded as closure evidence in ropa.md/C-07/dpia.md; RETRO-247 homed the REMEDY in Rule AO and did not bank it against RETRO-217, so RETRO-262 banks it retroactively and says so — one degree weaker than a self-declared count, and it qualifies under RETRO-217's own two-strategy text). Promotion trigger: RETRO-262 (FOLLOW-900 / PR #698) — the PM's "apps/intent-engine imports only third-party modules", true of module-level imports and false of the import graph (main.py:82-83 imports nlp + redis_writer inside a function body, pulling observability + schemas), which scoped a P1's AC(6) audit to exclude a second app with the identical dead-image defect; it surfaced only because the dispatch brief said "re-verify, do not inherit". The 2 banked occurrences are both PRIOR retros → ≥2-prior threshold met; the promoting retro does NOT inflate the count (same adjudication as Rules AA/AB/AC/AD/AE/AF/V/Q). NEW LETTER, not an amendment — four homes were tested against their TEXTS: Rule AC (scope a guard ticket by repo-wide grep, not the files the audit named) fails on MECHANISM, since a grep is exactly what produced the wrong claim and the needed second strategy is structural; Rule AD governs value-domain literals; Rule AE governs a GUARD's call-shape enumeration whereas AR governs the CLAIM (both fire on PR #698, at different objects — corroboration, not overlap); Rule AI governs propagation of a CHANGED claim to documents and its amendments 2 and 3 have already solved the document-corpus half under their own name, so folding absence-proof into AI would split AI's evidence base (the RETRO-122 error in rule form). RETRO-217 argued for a separate home in its arming and that argument is honoured. SCOPE LIMITER IS LOAD-BEARING (rule item 1): decision-gating negatives only — a rule demanding two search strategies for every "X is unaffected" sentence would be unaffordable and would be ignored. ALSO IN RETRO-262 §6, two rule actions REFUSED with reasons: (a) NO Rule AF amendment for unwatched scheduled workflows — RETRO-262 ran Rule AF's own Verification loop VERBATIM and it printed `== e2e-smoke.yml : failure,failure,failure` in under ten seconds, so the text is adequate and the failure is COMPLIANCE (16 days unexecuted since Rule AF's RETRO-205 promotion); remedy is mechanisation → FOLLOW-905; class count for the record is three (ESC-041 Release, E2E Smoke 97/97 failures since 2026-05-04 with zero successes ever, validate_schemas). (b) NO Rule AA amendment for the "deployed" vocabulary — Rule AA step 3 already mandates a fail-loud EFFECT proof ("a query transcript") and was COMPLIED WITH in all four rounds (B.6 never said DONE); the defect is that §Snapshot.1's single status token absorbs a change of axis without visibly changing (deployed ≠ configured / ≠ live / ≠ importable / works ≠ scheduled, four meanings in four days), which is a schema defect in docs/MASTER_DESIGN.md → FOLLOW-906 proposes decomposing it into registered / importable / invoked / observed with a per-axis evidence KIND. LETTER CHOICE: AR is the next in the double-letter sequence after AQ; flag for human review if a different scheme is preferred. -->

---

## Rule AS — When a control's DEFECT REPORTS drive a fix, the fix MUST also cover the control's SILENT direction: false positives are reported and false negatives are not, so a scope set by the reports is set by the half that was never dangerous — and the fixture MUST be executed against the PRE-FIX artefact to prove it is red-first

**Pattern:** every control can be wrong in two directions. The **noisy** direction — it fires when
it should not — produces reports, because a human or an agent sees a warning it did not deserve and
pays a verification cost. The **silent** direction — it does not fire when it should — produces
**nothing at all**, because nobody sees an absent warning. The reports therefore sample one half of
the defect space, and the ticket authored from them inherits that sampling. The fix for the noisy
half is real and correct; it is never evidence about the silent half, and the silent half is the one
the control exists for. The same asymmetry explains why a self-test harness accumulates cases only
for defects that were once filed: it becomes a changelog of past bugs, and a changelog cannot fail
on something nobody has ever complained about.

**Evidence (≥2 PRIOR retros, plus the promotion trigger; the promoting retro does NOT inflate the
count):**

- **RETRO-252 §5d (2026-08-06, count 1, PRIOR)** — three generations of
  `scripts/gh-pr-checks-verified.sh`'s self-test, each scoped to the defect being fixed and never to
  the mechanism being inherited, stated in that retro's own words: _"The harness is a **changelog of
  past bugs**, and a changelog cannot fail on a regression in something that never had a bug filed
  against it."_ Generation 3 pinned generation 2's two defects and not generation 1's settle loop;
  generation 4 pinned generation 3's and still not generation 1's.
- **RETRO-237 §4b CB-1 (2026-07-31, count 2, PRIOR)** — _"FOUR MEASURED false negatives in the new
  gate, reproduced with throwaway fixtures"_ (`check-sentry-capture-has-init.sh`). Four
  silent-direction defects in a freshly-shipped control, **none of them reported by anyone**, all
  found only by deliberate perturbation. Corroborating but not counted: RETRO-253 (`check-rule-h.sh`
  Pattern 2 _"has never been able to fail"_) and RETRO-262 §3 (three blind shapes in
  `check-modal-local-imports.py`, found by driving synthetic trees through the real gate).
- **RETRO-263 (the promotion trigger), where the asymmetry is quantified for the first time.**
  `.claude/hooks/pre-edit-branch-guard.sh` was reported **six times in one day by six independent
  workers** (FOLLOW-849 → FOLLOW-881 → FOLLOW-909). **All six reports were the noisy direction** — a
  false warning while editing inside a worktree. **Zero reported the silent direction** — cwd in a
  worktree, edit landing on `main`, no warning at all — which is precisely the stranded-work failure
  the guard was written for (FOLLOW-448 / RETRO-146 §4e) and which was live the entire time. It
  entered scope only because PR #701's worker chose to write fixture cases A3/A4 for it. In the same
  retro, the identical asymmetry was found on PRIOR 1's own artefact one generation later: the merge
  gate's six cardinality fixtures all vary rollup SIZE and none varies rollup MEMBERSHIP, so a check
  that is merely `SKIPPED` counts as green **and** as completeness — driven to
  `RESULT: all checks green. Safe to mark READY_FOR_REVIEW`, exit 0, with six real gates skipped.
  Nobody has ever filed a bug about a skipped check.

**Rule:** when a ticket hardens, fixes or re-scopes a control (a hook, a CI gate, a linter, a
detector, an alarm, a classifier) **and its scope was set by reports of that control misbehaving**:

1. **Name both directions explicitly in the ticket or the PR**, in the control's own vocabulary:
   what does a FALSE POSITIVE look like here, and what does a FALSE NEGATIVE look like here. If the
   report set contains only one of them, say so — that sentence is the finding.
2. **Ship a fixture for the direction that was NOT reported**, in the same PR. A fix that closes the
   reported direction is a starting point, never coverage proof. Where the unreported direction is
   genuinely out of reach, assert the current (wrong) verdict with the reason recorded beside it —
   an executable disclosure, per Rule AP.
3. **Prove the fixture is red-first by running it against the PRE-FIX artefact**
   (`git show <fix-commit>^:<path>` into a throwaway tree) and record the pass/fail split in the PR.
   A fixture authored after the fix, in the fix's mental model, is not evidence it can fail — this
   is Rule AO's argument applied to fixtures instead of prose.
4. **When adding cases to an existing self-test, ask what the harness does NOT vary**, not what it
   covers. The accumulated cases are a changelog; enumerate the axes (size vs identity, present vs
   absent, fires vs silent) and state which ones no case perturbs.
5. Scope limiter, load-bearing: this rule fires on **report-driven** control work. It does not fire
   on a brand-new control (Rule Q owns "a check that has never seen itself go red") or on feature
   work. A rule demanding a two-direction fixture for every change would be unaffordable and would
   be ignored, which is worse than absent.

**Verification:**

```bash
# 1. Before writing the fix: collect the report set and classify each report by direction.
grep -rn "<control-name>" backlog/FOLLOW_UPS.md backlog/QUEUE.md | head -40
#    If every report is "it warned and it should not have", the silent direction is unscoped.

# 2. After writing the fixture, prove it is red-first against the artefact as it was:
mkdir -p /tmp/prefix && git show <fix-commit>^:<path/to/control> > /tmp/prefix/<control>
#    run the NEW fixture against the OLD control; record "N of M assertions fail".

# 3. Ask the harness what it does not vary (example: the merge gate's own fixtures):
grep -n "_st_fixture" scripts/gh-pr-checks-verified.sh
#    six cardinality fixtures, all varying SIZE; none varies the check-run SET.
```

<!-- Rule AS added 2026-08-09 — RETRO-263 §6. 45th permanent rule; range AA–AS. Evidence (≥2 PRIOR numbered retros): RETRO-252 §5d (count 1, "the harness is a changelog of past bugs, and a changelog cannot fail on a regression in something that never had a bug filed against it" — three generations of gh-pr-checks-verified.sh's self-test each scoped to the defect being fixed) + RETRO-237 §4b CB-1 (count 2, four MEASURED false negatives in check-sentry-capture-has-init.sh, none reported by anyone, all found by throwaway-fixture perturbation). Corroborating, not counted: RETRO-253 (check-rule-h.sh Pattern 2 could never fail) and RETRO-262 §3 (three blind shapes in check-modal-local-imports.py found by driving synthetic trees). Promotion trigger: RETRO-263 (PRs #699/#700/#701/#702) — the branch guard drew SIX independent reports in one day, ALL of them the noisy direction, ZERO of the silent direction (cwd in a worktree, edit landing on main, no warning), which is the exact stranded-work failure the guard exists for and which entered scope only because PR #701's worker volunteered fixture cases A3/A4; and in the same retro the identical asymmetry was driven on PRIOR 1's own artefact one generation later — gh-pr-checks-verified.sh printed "all checks green. Safe to mark READY_FOR_REVIEW" (exit 0) over six real gates flipped to SKIPPED, because its six cardinality fixtures vary rollup SIZE and none varies rollup MEMBERSHIP. The 2 banked occurrences are both PRIOR retros → ≥2-prior threshold met; the promoting retro does NOT inflate the count (same adjudication as Rules AA/AB/AC/AD/AE/AF/AR/V/Q). NEW LETTER, not an amendment — four homes tested against their TEXTS: Rule AE governs the enumeration of syntactic CALL-SHAPES of a guarded action by an AST/regex SECURITY guard (a SHAPE axis; it does not reach an application classifier in Python or a shell PreToolUse hook, both of which are Rule AS instances in RETRO-263); Rule Q governs a NEW gate emitting positive proof its assertion executed and scoping its soft-skip — the remedy for one sub-case, not the scoping principle for report-driven work; Rule AM governs how fixtures are SYNTHESIZED (not mutated from live source), an orthogonal axis; Rule AP governs DISCLOSURE of residuals as a machine-checked register, not the DIRECTION a fixture must cover. What is unpromoted is the DIRECTION axis plus the red-first-against-the-pre-fix-artefact obligation, and PR #701 is the estate's own proof both are affordable (20 assertions, ~2h, fixture as the deliverable: 8/20 fail on 5fb90e37^, 0/20 at HEAD, re-derived independently by RETRO-263). SCOPE LIMITER IS LOAD-BEARING (rule item 5): report-driven control work only. LETTER CHOICE: AS is the next in the double-letter sequence after AR; flag for human review if a different scheme is preferred. -->

---

## Rule AT — An escalation whose premise contains a QUANTITY or an EXISTENCE claim MUST have that premise MEASURED and the transcript pasted into the escalation, immediately before it is put to the decision-maker — a premise is a claim, it ages, and this estate has no control that re-validates one between `filed` and `ruled`

**Pattern:** an escalation is a document that asks a human to decide something, and its
recommendation rests on a premise. Premises about the world — how many rows are affected, whether a
credential exists, whether a budget is exhausted, whether a table is empty — are cheap to measure
and expensive to be wrong about, and they are wrong in two distinct ways: **wrong at filing** (the
author inferred instead of measuring) and **aged** (true when written, false when ruled, because the
intervening work changed it). Both consume the scarcest resource in the project — the CEO's decision
attention — on a question that has already dissolved, and both have happened. There is no register,
no owner and no re-validation step between `filed` and `ruled`, so the only thing that catches a bad
premise is somebody choosing to measure it.

**Evidence (≥2 PRIOR retros, plus the promotion trigger; this discharges pattern P-41, which
RETRO-261 §8 minted explicitly as "at 1 prior — not promoted"):**

- **RETRO-260 §5d (count 1, PRIOR)** — _"'An escalation's premise is stable between filing and
  ruling' — false, demonstrated within one session"_. ESC-054's stakes halved hours after it was
  written (one real signal, not two); the PM recorded the change in QUEUE.md and **the escalation
  text did not move**. RETRO-260's own words: _"There is no mechanism that would have caught it,
  because escalations have no re-validation step, no register, and no owner between `filed` and
  `ruled`."_
- **RETRO-261 §5d (count 2, PRIOR)** — _"An escalation is a document with a premise, and this estate
  has no control that re-validates a premise between `filed` and `executed`."_ ESC-053's premise was
  **wrong at filing** (a value named by a label whose meaning is inverted in Doppler), and
  RETRO-261's finding on the mechanism is the rule's design input: _"What caught it was **a probe,
  not a control**"_ — a credential-free reachability test. Minted as **P-41 at 1 prior — not
  promoted**, i.e. armed.
- **RETRO-263 (the promotion trigger), and it is the first sighting where the remedy was executed
  and worked — twice, in one session, on two independent escalations.** **ESC-044:** the remediation
  axis was measured before the ruling — prod `consent_records` = **0 rows total, 0 with the
  placeholder hash** — so the "data subjects hold records attesting text they did not see" premise
  had an **empty population**, and the CEO/DPO could rule on principle instead of on remediation
  (FOLLOW-916 AC(4) even records that today's zero expires the moment the consent caller is
  integrated). **ESC-045:** it asked for credentials that **already existed** (the Anthropic key was
  in Doppler dev the whole time). Both escalations were re-framed by measurement **before** they
  consumed a decision, and the measurement in each case was one command.

**Rule:** before an escalation is put to the decision-maker (and again if it has been open more than
one session):

1. **Identify whether the premise contains a QUANTITY or an EXISTENCE claim.** "N records are
   affected", "credential X is missing", "the budget is exhausted", "the table is empty", "the
   endpoint returns 403". If it does not — the escalation is about ambiguity, an interface
   disagreement, a policy or a product direction — **this rule does not fire.** That limiter is
   load-bearing: a measurement demand on every escalation would be unaffordable and would be
   ignored, which is worse than absent.
2. **Measure it and paste the transcript into the escalation**, dated, with the command that
   produced it — not a summary of it. A one-line `psql` count, a `modal run` probe, a `gzip` of the
   artefact. If it cannot be measured from where you sit, say who can and what they must run.
3. **If the measurement changes the question, rewrite the escalation before asking, not after.** A
   premise that has dissolved makes the recommendation an artefact of history; the decision-maker
   should meet the current question.
4. **State the premise's expiry.** A measured zero is true on the day it is taken; record what would
   change it ("re-take this count immediately before the consent caller is integrated"), so the next
   reader knows whether the number is still load-bearing.
5. Applies symmetrically to a **ruling being executed**: the ticket that implements a ruling
   re-measures the premise before building, and reports a divergence instead of building through it.

**Verification:**

```bash
# 1. Does the escalation contain a measurable premise? (quantities and existence claims)
grep -nE '\b(0|zero|no|none|[0-9]+)\b.*(rows?|records?|bytes?|runs?|keys?|missing|unset|empty|exhausted)' \
  backlog/ESCALATIONS.md | sed -n '1,40p'

# 2. Measure it. Examples actually used in this repo, each one command:
doppler run --config prd -- psql "$DATABASE_URL" -Atqc 'SELECT count(*) FROM consent_records;'
modal run scripts/check-modal-secret-keys.py::check --required "SENTRY_DSN"
node -e "console.log(require('zlib').gzipSync(require('fs').readFileSync(B)).length)"

# 3. Before ruling, confirm the escalation carries a DATED transcript, not a claim:
grep -n "measured\|transcript\|as of 20" backlog/ESCALATIONS.md | head -20
```

<!-- Rule AT added 2026-08-09 — RETRO-263 §6. 46th permanent rule; range AA–AT. Discharges pattern P-41, minted by RETRO-261 §8 as "at 1 prior — not promoted". Evidence (≥2 PRIOR numbered retros): RETRO-260 §5d (count 1, ESC-054's premise AGED — stakes halved hours after filing, the PM recorded it in QUEUE.md and the escalation text did not move; "there is no mechanism that would have caught it") + RETRO-261 §5d (count 2, ESC-053's premise was WRONG AT FILING — a value named by a label whose meaning is inverted in Doppler; "what caught it was a probe, not a control"). Promotion trigger: RETRO-263 (session 107's eight CEO rulings) — the first sighting where the remedy was EXECUTED and worked twice on independent escalations: ESC-044's remediation axis measured at zero rows before the ask (prod consent_records = 0 total, 0 with the placeholder hash), turning a remediation question into a principle question; and ESC-045 asking for credentials that already existed. Two prior failures uncaught by any control + one session in which a nameless practice caught two premises for one command each = the promotion condition, and it is the rare case where the rule codifies a remedy already demonstrated rather than a wish. The 2 banked occurrences are both PRIOR retros → ≥2-prior threshold met; the promoting retro does NOT inflate the count. NEW LETTER, not an amendment — homes tested against their TEXTS: Rule AR governs a claim of ABSENCE that scopes or closes WORK and requires two SEARCH strategies over a codebase (lexical + structural); AT governs a claim about the WORLD (a count, a credential, a budget) in a document that asks a HUMAN to decide, and its remedy is a measurement transcript, not a second grep — they fire on different objects and would split each other's evidence base (the RETRO-122 error in rule form). Rule AA governs code-vs-prod status vocabulary on a TICKET; Rule AO governs a corrective edit re-verified against its own PR's evidence; Rule AI governs propagating a CHANGED claim to documents — none reaches an escalation's premise between filed and ruled, which RETRO-260 and RETRO-261 both named as having no owner. SCOPE LIMITER IS LOAD-BEARING (rule item 1) and was the brief's explicit affordability question: quantity/existence premises ONLY; escalations about ambiguity, interface disagreement or policy have no measurable premise and are out of scope. ALSO IN RETRO-263 §6: pattern P-42 ("read the seam before dispatching" — PR #702's PM re-route of FOLLOW-915 from sdk-engineer to architect on an ADR-0011 collision, with NO mechanical backstop: grep -rln 'docs/adr' .github/workflows/ scripts/ returns zero files) is ARMED AT COUNT 1 WITH AN EXPLICIT PRE-AUTHORIZATION in the RETRO-217 form and NOT promoted; and two rule actions were REFUSED — no Rule AJ amendment for RETRO-263 §3 HW-2 and no Rule AQ amendment for §3 HW-1, both being COMPLIANCE failures against adequate texts per RETRO-258/261's standard (→ FOLLOW-920 / FOLLOW-921). LETTER CHOICE: AT is the next in the double-letter sequence after AS; flag for human review if a different scheme is preferred. -->

---

## Rule AU — A control MUST assert the BEHAVIOUR it is named for, not the PRESENCE of a name that stands for it: a test that greps for a symbol, a path in a list, a call site or a sentence in a doc, where it means "the deployed system does X", is a claim about the repo wearing the costume of a claim about the world

**Pattern:** A gate is written to close a class. Its assertion is a **predicate weaker than its
claim** — it checks that a name is present (a key in a config object, a path in a prefix array, a
`foo(` call in a named file, a sentence in a runbook) and its header says the system therefore
behaves a certain way. The gate is green, the class is reported closed, and the behaviour it names
is false. This is not a missing test and not a stale fixture: the input is genuine and the assertion
really runs. The proposition is simply weaker than the sentence above it.

**Distinguishing test (carried forward verbatim from RETRO-264, unchanged because it works):** _does
the control's assertion, if it PASSED, permit the failure the control exists to prevent?_ If yes,
the control is an instance of this rule.

**Evidence (≥2 PRIOR retros, plus the promotion trigger; the promoting retro does NOT inflate the
count):**

- **RETRO-264 §6 — prior 1 (minting).** Pattern P-43 named after `consent-text.json`: the fix's
  correctness rested on Vercel applying `headers()` to a `public/` asset, and only the config had
  been tested.
- **RETRO-265 §6 — prior 2.** `apps/control-plane/src/consent-text-headers.test.ts` asserts the
  **presence of a header rule in a config object** where it means **the deployed origin sends the
  header**. It passed on #710 and would have passed unchanged had Vercel dropped `headers()` on
  `public/` assets, or had the deploy never run. RETRO-265 also corrected RETRO-264's
  pre-authorization, which read literally as promotion at one prior plus the trigger.
- **Promotion trigger — RETRO-266 §6, TWO independent sightings in one window, in two subsystems:**
  (a) `apps/ingest/src/observability-signals.test.ts:117-127` asserts
  `runbook.includes('`SENTRY_DSN_INGEST` is unset in prod')` — a **markdown substring** standing for
  **the state of a Cloudflare Worker secret**; set the secret without editing the doc, which is the
  likely order since they live in different systems, and the gate stays green while all five
  `consumer: null` rows are false. (b) `apps/control-plane/src/sdk-cors-coverage.test.ts:216-233`
  asserts a **regex over the preflight builder's source text** and that a `resolveOriginDecision(`
  call **appears in a named file**, where it means **an external brand's browser can read the
  response** — and that was **falsified against live production** in the same retro: the actual
  `/api/adapt` response to an external origin carries no `Access-Control-Allow-Origin` at all, while
  the gate is green. Sighting (b) is the sharpest form recorded: the control written specifically to
  close this class is itself an instance of it.

**Rule:** When you add a control whose stated purpose is a claim about deployed behaviour:

1. **Write the claim as a sentence, then read your assertion and ask whether the sentence could be
   false with the assertion green.** If it could, the control does not discharge the claim.
2. **Prefer, in order:** an assertion over the real effect (a live probe, a request through the real
   path, a rendered output); an assertion over the artefact that is actually deployed (the built
   bundle, the served bytes); an assertion over source. Source-level assertions are legitimate —
   they catch regressions cheaply — but the control's header MUST then state what it does **not**
   cover.
3. **A control whose subject lives outside the repo (a Worker secret, a DNS record, a CDN behaviour,
   a DB column) cannot be discharged by a repo assertion.** The acceptable substitute is a dated,
   pasted measurement plus a stated re-verification trigger; a doc substring is not one.
4. **A register or coverage gate MUST NOT be satisfiable by the register merely naming its
   subject.** Assert the claim made about each entry, not that the entry exists.
5. **Scope limiter, load-bearing:** this rule governs controls whose header makes a **behavioural or
   deployment** claim. A test that deliberately asserts a source-level invariant _and says so_ — a
   lint, a shape check, a "this constant is 5" pin — is out of scope and must not be rewritten to
   chase it.

**Relationship to neighbouring rules, tested against their texts so the evidence bases do not
split:** Rule Q asks whether the assertion **ran**; Rule AS asks whether the fixture covers the
control's **silent** direction; Rule AM governs where a fixture **comes from**; Rule AP requires a
residual-gaps list to be **machine-checked rather than prose**. Rule AU governs the **proposition**
— a control that ran, on a genuine input, in the right direction, machine-checked, and still
asserted something weaker than it claimed.

**Verification:**

```bash
# For every control added or edited in this PR, answer in the PR body, per control:
#   CLAIM:     <one sentence, in the present tense, about the deployed system>
#   ASSERTION: <what the test literally evaluates>
#   GAP:       <the failure that would keep the assertion green — or "none", with the reason>
# A control whose GAP is non-empty must either be strengthened or have the gap written into its
# own header comment. "none" is a claim and is reviewable.
```

<!-- Rule AU added 2026-08-10 — RETRO-266 §6. 47th permanent rule; range AA–AU. Discharges pattern P-43, minted by RETRO-264 §6 and incremented by RETRO-265 §6. Evidence (≥2 PRIOR numbered retros): RETRO-264 §6 (count 1 — consent-text.json's fix rested on Vercel applying headers() to a public/ asset and only the config was tested) + RETRO-265 §6 (count 2 — consent-text-headers.test.ts asserts a header rule in a config object where it means the deployed origin sends the header; would have passed unchanged had Vercel dropped headers() or had the deploy never run). Promotion trigger: RETRO-266, with TWO independent sightings in two subsystems, neither inflating the count: (a) observability-signals.test.ts:117-127 asserting runbook.includes('SENTRY_DSN_INGEST is unset in prod'), a markdown substring standing for a Cloudflare Worker secret; (b) sdk-cors-coverage.test.ts:216-233 asserting a source-text regex plus the presence of a resolveOriginDecision( call, where it means an external brand can read the response — FALSIFIED against live production in the same retro (curl to https://admin.estalara.com/api/adapt with Origin: https://homes.brandclient.com returns 401 with NO access-control-allow-origin, while the contrast probe with Origin: https://app.estalara.com carries it, and the gate is green). RETRO-265's threshold correction is honoured: 2 PRIORS + trigger, matching the standard stated verbatim in Rules AR/AS/AT and the RETRO-217 form (P-41: RETRO-260=1, RETRO-261=2, RETRO-263=trigger; Rule AR: RETRO-217=1, RETRO-247=2, RETRO-262=trigger). RETRO-266 checked the pre-authorization on its own evidence rather than inheriting it, as briefed. NEW LETTER, not an amendment — homed against neighbouring TEXTS: Rule Q = did the assertion RUN; Rule AS = does the fixture cover the SILENT direction; Rule AM = where does the fixture COME FROM; Rule AP = is the residual-gaps list machine-checked rather than prose; AU = is the PROPOSITION as strong as the CLAIM, for a control that ran, on a genuine input, in the right direction. SCOPE LIMITER IS LOAD-BEARING (rule item 5): behavioural/deployment claims only; a source-level invariant test that says so is out of scope. ALSO IN RETRO-266 §6: P-44 NOT incremented (RETRO-266's window contains a COUNTER-example — FOLLOW-936's AC(5) was discharged and carried the next defect — and FOLLOW-941's false AC(4) is a P-43/AU instance, not P-44; merging them would split this rule's evidence base, the RETRO-122 error in rule form); P-45 MINTED AT 1 PRIOR AND NOT PROMOTED ("a file:line anchor written in the same PR as the code it points at is invalidated by that PR's own later hunks" — FOLLOW-913 merged 8 wrong anchors, 3 in shipped source, displaced by exactly the comment block the same diff inserted; distinguishing test recorded on FOLLOW-947); P-42 not incremented and recorded as a control that worked a second time. Rule count 46 -> 47, re-counted with grep -c "^## Rule " before and after. LETTER CHOICE: AU is the next in the double-letter sequence after AT; flag for human review if a different scheme is preferred. -->

---

## Rule AV — A probe offered as EVIDENCE about a subject MUST share every property with that subject except the one under test: a control that differs on the axis being measured — a different route, method, artefact class, environment, or POINT IN TIME — is a hypothesis wearing a measurement's clothes

**Pattern:** Somebody does the right thing and goes to look at the real world instead of arguing
about it. They run a probe, get a clean result, and use it to establish or eliminate a claim. The
probe is genuine — a real request, a real origin, a real exit code — and it is **not a probe of the
subject**. It differs from the subject on exactly the property whose effect was being measured: it
drives a method the route does not export, it targets a static asset while the subject is
function-served, it reads a variable through a tool that returns empty for everything, or it runs
before the deployment it claims to describe exists. The result is trusted more than a test would be,
because it came from production — and it is about something else.

**Distinguishing test:** _list every property on which the probe and the subject differ. Is the axis
under test on that list?_ If it is, the probe is an instance of this rule, however live it was.

**Evidence (≥2 PRIOR retros, plus the promotion trigger; the promoting retro does NOT inflate the
count):**

- **RETRO-267 §4c/§5a — prior 1 (minting of P-48's shape).** The FOLLOW-942 closure probe drove
  `POST /api/adapt/description`, a method that route does not export. The response it read was
  produced by the middleware layer, so the probe confirmed the layer and said nothing about the
  route — while being cited as the route's closure evidence.
- **RETRO-268 §Headline 3 — prior 2 (P-48 minted by name).** #722 eliminated a hypothesis about a
  **function-served** route using `/consent-text.json`, a **static `public/` asset**
  (`next.config.mjs:30` says so in as many words). Static-vs-function was the axis under test. The
  outcome #722 established was correct; one of its two "eliminations" was not evidence.
- **Promotion trigger — RETRO-269 §Headline 3, on the TIME axis, which neither prior exercised.**
  The FOLLOW-935 effect probe is guarded to `push:main` and asserts _"the deployed origin serves the
  header"_ for the merge that triggered it. Measured against
  `gh api repos/…/deployments/<id>/statuses`: on `a3ba1503` the probe finished at 19:03:27 and the
  production deployment reached `success` at 19:05:00; on `764c2f7e` the probe finished at 05:35:03,
  the second the deployment was **queued**, and `success` came at 05:37:17. **Every merge-triggered
  run asserts the state produced by the previous merge.** Two documents written in the same PR call
  it "per-deploy". This sighting is why the rule is worth a letter rather than a third note: the
  first two are visible by reading the probe; this one is visible only by comparing timestamps from
  two different APIs.

**Rule:** When a probe's result is used to establish, close, or eliminate anything:

1. **Name the subject in one sentence** — the specific route, artefact, environment and commit the
   claim is about. Then name the probe the same way.
2. **Enumerate the axes on which they differ** — route, HTTP method, artefact class (static asset vs
   function response vs built bundle), environment, credential state, and **time / deployed
   revision**. State, per axis, why the difference is immaterial to the claim. An axis you cannot
   justify is the axis your probe is about.
3. **For any assertion about "this deploy", prove the probe ran AFTER the deployment reached
   `success`** — a workflow triggered by the merge starts in seconds and a deploy does not. Prefer
   the deployment event over a `sleep`; a poll must fail UNDETERMINED on timeout, never green.
4. **A probe that cannot reach the subject is an UNDETERMINED, not a negative.** Report it as "could
   not look", not as "the effect is absent" and not as a pass.
5. **Scope limiter:** this governs a probe used as EVIDENCE for a claim. A probe run to explore, or
   as a smoke test of a neighbouring layer, is not covered — the rule attaches the moment its result
   is written into a ticket, a retro, a doc, or a closure verdict.

**Verification:**

```bash
# In the PR body / retro entry, for every probe whose result licenses a claim:
#   SUBJECT: <route|artefact> @ <environment> @ <commit or deploy id>
#   PROBE:   <the exact command>
#   DIFFERS ON: <axis> — <why immaterial>   (repeat; "none" is a claim and is reviewable)
#   TIME:    <deploy success timestamp> vs <probe timestamp>   (or "N/A — not a deploy claim")
# A probe that differs on the axis under test may be reported, but may not close anything.
```

<!-- Rule AV added 2026-08-12 — RETRO-269 §6. 48th permanent rule; range AA–AV. Discharges pattern P-48, minted by RETRO-268 §6 (which named RETRO-267 as prior 1 and itself as count 2, explicitly writing "No promotion; the next sighting is the trigger"). Evidence (≥2 PRIOR numbered retros): RETRO-267 §4c/§5a (count 1 — the FOLLOW-942 closure probe drove POST on a route exporting no POST, confirming the middleware layer and not the route) + RETRO-268 §Headline 3 (count 2 — #722's control was a static public/ asset eliminating a hypothesis about a function-served route, and static-vs-function IS the axis under test). Promotion trigger: RETRO-269, the TIME axis, measured from gh api deployments statuses against gh run view job timestamps: a3ba1503 probe finished 19:03:27 / deploy success 19:05:00; 764c2f7e probe finished 05:35:03 while the deploy was still QUEUED / success 05:37:17. 2 PRIORS + trigger, the standard stated verbatim in Rules AR/AS/AT/AU and the RETRO-217 form; the promoting retro does not inflate the count. NEW LETTER, not an amendment — homed against neighbouring texts: Rule AU = the instrument is a REPO assertion standing for the world (here the instrument IS a live probe and is still invalid); Rule AR = >=2 independent strategies for a claim of ABSENCE (here it is one probe's VALIDITY, not a negative); Rule Q = did the assertion RUN (here it ran, against the wrong thing); Rule AM = where the FIXTURE comes from (here there is no fixture, there is a subject). SECOND SIGHTING IN THE TRIGGER WINDOW, DELIBERATELY NOT COUNTED per RETRO-228's discipline and recorded because it is a COUNTER-example: #725's own vercel env pull calibration, where the author noticed the tool returned empty for 46 of 55 variables including NODE_ENV, named P-48 in the stub, and refused to file a false drift alarm. LETTER CHOICE: AV is next after AU; flag for human review if a different scheme is preferred. -->

---

## Rule AW — A ticket's `blocks:` field is an assertion about OTHER work and is not discharged by that ticket's own closure: at DONE, every entry must be shown FALSE or re-homed BY NAME onto an open ticket, or the thing it protects becomes unblocked by bookkeeping rather than by fact

**Pattern:** A ticket carries `blocks: [<some downstream event>]`. It is completed and marked DONE —
honestly, on its own acceptance criteria. Nobody re-reads the `blocks:` line, because it is not an
acceptance criterion and no gate parses it. The downstream event is still blocked, by the residual
the ticket admitted, by a sibling ticket that is still open, or by an operator step that never ran.
But the record no longer says so anywhere: the last ticket naming the blocker closed, and the
blocker's tracking closed with it. The next planning pass reads an empty blocker list and treats it
as a green light.

**Distinguishing test:** _at the moment of closure, for each entry in `blocks:` — is it FALSE now,
demonstrably, or is it named on a ticket that is still open?_ If neither, the entry has evaporated.

**Evidence (≥2 PRIOR retros, plus the promotion trigger; the promoting retro does NOT inflate the
count):**

- **RETRO-267 §6 — prior 1 (minting of P-47).** FOLLOW-942 closed `DONE — LIVE-VERIFIED` with
  `blocks: [first external-brand go-live]` still true. Its residual was admitted, tested, and filed
  as FOLLOW-943 — which was itself `promoted_to_queue: false`, so the block was re-homed onto a
  ticket nobody was scheduled to do. `grep -n "blocks:" CONVENTIONS_PATCH.md` returned **zero**: no
  promoted text governed the field.
- **RETRO-268 §6 — prior 2.** FOLLOW-951 `DONE (merged)` with
  `blocks: [first external-brand go-live — jointly with FOLLOW-943]` still true. RETRO-268 applied
  the ≥2-priors arithmetic to its own strongest candidate and declined to promote at count 2.
- **Promotion trigger — RETRO-269 §5d.** FOLLOW-957 closed carrying the identical `blocks:` entry
  **with its own AC(3) explicitly undischarged**, and FOLLOW-943 — the co-named blocker in that same
  entry — closed with `blocks: []`. **After both closures no open ticket records that the first
  external-brand go-live is blocked**, while FOLLOW-949 and FOLLOW-950 (RETRO-267, P2/P1) are open
  and `BRAND_PROVISIONING.md` §Step 6 has never been run. Three independent sightings, one field,
  three consecutive retros, and still zero governing text.

**Rule:** For any ticket whose record carries a `blocks:` (or `depends_on:` read in the blocking
direction) entry:

1. **Closing the ticket does not close the entry.** At DONE, adjudicate every entry explicitly in
   the closure note: **FALSE now** (with the evidence that makes it false), or **re-homed** onto a
   named, open ticket.
2. **"Re-homed" means the receiving ticket carries the entry in its own `blocks:` field**, not that
   it is mentioned in prose. A block recorded only in a paragraph is not tracked.
3. **A ticket closing with an undischarged AC may not silently discharge a `blocks:` entry that AC
   was protecting.** If AC(n) is open, say which entries remain true because of it.
4. **Never re-home onto a ticket with `promoted_to_queue: false` without saying so** — that is the
   RETRO-267 shape and it defers the block into a backlog nobody is scheduled against.
5. **This is cheap to check mechanically and should be:** the smallest useful control greps
   `FOLLOW_UPS.md` for entries whose status line says DONE while their `blocks:` list is non-empty
   and unadjudicated. Prefer that to a convention; a convention is what failed three times.

**Verification:**

```bash
# At closure, in the ticket's own record, one line per blocks: entry —
#   BLOCKS ENTRY: <verbatim>
#   VERDICT:      FALSE (evidence: …)  |  RE-HOMED to FOLLOW-NNN (which now carries it)
# And, as a standing check:
grep -n -A3 '^## FOLLOW-' backlog/FOLLOW_UPS.md \
  | grep -B1 'blocks: \[[^]]' | grep -i 'promoted_to_queue: true'
# Every hit is a closed ticket whose blocks: list still asserts something. Each needs a verdict.
```

<!-- Rule AW added 2026-08-12 — RETRO-269 §6. 49th permanent rule; range AA–AW. Discharges pattern P-47, minted by RETRO-267 §6 and incremented by RETRO-268 §6 (which stated "1 prior != 2 priors. No promotion" and applied that arithmetic to its own strongest candidate rather than only to inherited ones). Evidence (>=2 PRIOR numbered retros): RETRO-267 §6 (count 1 — FOLLOW-942 DONE, LIVE-VERIFIED, with blocks:[first external-brand go-live] still true and its residual re-homed onto FOLLOW-943 which was itself promoted_to_queue:false) + RETRO-268 §6 (count 2 — FOLLOW-951 DONE (merged) with blocks:[first external-brand go-live — jointly with FOLLOW-943] still true). Promotion trigger: RETRO-269 §5d — FOLLOW-957 closed with the SAME entry undischarged AND its own AC(3) explicitly open, while FOLLOW-943 closed with blocks:[], leaving the go-live with NO open ticket recording that it is blocked, though FOLLOW-949/950 are open and BRAND_PROVISIONING §Step 6 has never run. Three sightings, one field, three consecutive retros. grep -n "blocks:" CONVENTIONS_PATCH.md returned 0 before this rule: no promoted text governed the field at all, which is why two prior retros could name the defect and neither could cite anything. NEW LETTER, not an amendment — homed against neighbouring texts: Rule AA = the CODE-vs-PROD split in a ticket's own DONE verdict (AW governs the OTHER work a closure silently unblocks); Rule AI = propagating a changed CLAIM across documents (a blocks: entry is a scheduling assertion, not a claim in prose); Rule AT = escalation-scoped premise measurement, a boundary RETRO-267 established; Rule AN = number ALLOCATION in a register, not field discharge. SECOND PROMOTION IN ONE RETRO: this is a first for this estate and the arithmetic is stated separately from Rule AV's, sharing no evidence — Rule AV's priors are RETRO-267 §4c/§5a and RETRO-268 §Headline 3 (probe validity), Rule AW's are RETRO-267 §6 and RETRO-268 §6 (ticket bookkeeping). Both meet the standard written verbatim in Rules AR/AS/AT/AU; neither relaxes it. LETTER CHOICE: AW is next after AV; flag for human review if a different scheme is preferred. -->

---

## Rule AX — A `file:line` anchor is evidence with a shelf life measured in commits: cite the SYMBOL, treat the line number as perishable, and never let a doc/comment's citation into a file it does not itself change stand as verified past its own merge

**Pattern:** Someone does exactly the right thing. They cite their claim with a `path:line` anchor
so the next reader can check it, and — better than most — they verify each anchor by **reading the
target line** rather than recomputing an offset. The citation is correct at the commit that ships
it. Then any later edit ABOVE that line in the target file moves it, and nothing anywhere detects
that the citation has stopped pointing at what it names. The displacing edit is usually in a
different PR whose diff never touches the citing document, so git cannot conflict on it and no
reviewer sees both halves. The failure is silent, and its worst form is not a dangling number: it is
an anchor that now resolves to **real, plausible-looking code**, so a reader who checks the citation
is misled rather than blocked.

This estate runs on `file:line`. It is the primary evidence mechanism in `MASTER_DESIGN.md`, in
every retro, in every FOLLOW stub, in `CONVENTIONS_PATCH.md` itself and in hundreds of source
docblocks — **8502 anchors, counted (FOLLOW-947 AC(2))**. Every one is invalidated by an insertion
above it.

**Distinguishing test:** _does this citation point into a file the citing change does not itself
modify?_ If yes, its correctness is a property of one commit, not of the claim, and it must be
written so that it survives — or written so that its rot is detectable.

**Evidence (≥2 PRIOR retros, plus the promotion trigger; the promoting retro does NOT inflate the
count):**

- **RETRO-267 — prior 1 (minting of P-45).** #717 merged **eight** `packages/sdk/src/index.ts`
  anchors that were already wrong **at its own merge commit**, displaced by a ~13-line comment block
  the same diff inserted above them.
- **RETRO-268 §6 — prior 2, on the condition RETRO-268 itself wrote.** FOLLOW-956's `cross_ref`
  cited `middleware.ts:117,355-357`; at `58adb2da` that range was the `Vary` producer and at
  `34a02bbb` it was prose inside the comment that replaced it — displaced by **#722, the next PR one
  hour later**, which rewrote 39 lines of that same FOLLOW entry and did not re-anchor it. RETRO-268
  declined to count it under P-45's then-narrow "the same PR's own later hunks" test and recorded,
  in terms: _"Recorded so the next retro can decide whether P-45 should be widened to 'the same
  session' — **if it is, this becomes prior 2**."_ It is widened here, and further than "the same
  session", because the trigger's interval is longer still.
- **Promotion trigger — RETRO-271.** FOLLOW-947 existed _only_ to correct prior-1's anchors. #729
  corrected **nine**, verified every one by reading the target line, and stated its own immunity in
  the PR body: _"This PR does not touch `index.ts`, so its anchors cannot be displaced by its own
  later hunks."_ True, and about the wrong threat. **#732 merged 22 hours later, edited
  `packages/sdk/src/index.ts`, and touched none of the citing documents. All nine were wrong
  again**: `aboveFloor` 879-881 → 880-882; `aboveDescriptionFloor` 882-884 → 883-885; the two `if`
  blocks 886/900 → 920/936; the `device_type` prior 1089-1094 → **1117-1121** (the cited range is
  now a `DetectGlobal` interface); the sidebar comment 1135-1137 → **1163-1165** (the cited range is
  now `captureOriginalHeadline`). **Corroborating sighting in the same analysis pass, deliberately
  NOT counted as a second trigger** (two sightings in one pass are one observation): #738's §V.3.4
  rewrite — the section whose entire defect was wrong citations — shipped
  `origin-policy.ts:114-237`, `:139-234` and `:230-234` **past end-of-file**, because #735 removed
  20 net lines from that file and merged into #738's base eight seconds earlier.
- **RETRO-269 declined to increment, and its reason strengthens rather than breaks the chain:** it
  found a genuine **counter-example** (all seven of #725's same-session anchors verified correct at
  HEAD), not a rejection of the pattern.

**Why this is a convention and only a narrow gate — decided by measurement, not preference.**
FOLLOW-947's AC(2) scanned all 8502 anchors and reported that a bounds check would have caught
**zero of the nine** (`index.ts` is 1882 lines; every wrong anchor was in range — the defect is
wrong-line-inside-file, which bounds cannot see) while firing ~76 times on append-only historical
logs that must not change. **A gate with a 0% catch rate on its own class is a green light, not a
control.** So the rule is primarily a citation form, plus the one check the measurement does
support.

**Rule:**

1. **Cite the symbol; demote the line.** Write
   `` `resolveOriginDecision` (`apps/control-plane/src/lib/origin-policy.ts`) `` or
   `` `origin-policy.ts` → `firstPartyStatus === 'unverified'` branch ``. A bare `path:line` is
   permitted only where no symbol exists (a comment block, a config literal, a data row), and then
   the surrounding text must quote enough of the target that a reader can re-find it.
2. **A range is a claim about a region, not a coordinate.** Prefer `` `<fn>` in `<file>` `` over
   `:114-237`. A range spanning most of a file is a symbol citation written badly.
3. **Verify by reading the target line, never by recomputing an offset.** #729 established this and
   it is not negotiable — an offset recomputed from a stale base reproduces the defect exactly.
4. **A verification is scoped to a commit and must say so.** _"Re-verified against HEAD `<sha>`"_ is
   the correct form, and it stops being true the moment anything merges into that base. **If your
   change cites files it does not itself modify, re-check the citations against the merge base
   immediately before merge** — this is Rule AV's TIME axis applied to a citation instead of a
   probe.
5. **Never re-anchor inside a dated record.** Changelog entries, retro entries, `lessons.md` and any
   append-only log state what was true when written; correcting their anchors falsifies the record.
   FOLLOW-947 deliberately left three such anchors and disclosed it — that is the correct behaviour
   and this rule does not override it. Fix the anchor at the live site; leave the history alone.
6. **The one mechanical check the evidence supports:** an anchor whose line number exceeds its
   target file's length is unambiguously wrong, costs nothing to detect, and is the exact shape #738
   shipped. Scope it to non-changelog regions and to in-repo paths.

**Verification:**

```bash
# 1. Out-of-bounds anchors — the only check FOLLOW-947's 8502-anchor measurement supports.
#    Every `path:NNN` citation whose NNN exceeds `wc -l path`.
grep -rnoE '[A-Za-z0-9_./-]+\.(ts|tsx|mjs|js|py|sh|toml|yml):[0-9]+' docs backlog CONVENTIONS_PATCH.md \
  | while IFS= read -r hit; do
      ref="${hit##*:*:}"; file="${ref%%:*}"; line="${ref##*:}"
      [ -f "$file" ] && [ "$line" -gt "$(wc -l < "$file")" ] && echo "OUT OF BOUNDS: $hit"
    done
# (Exclude dated Changelog / RETROSPECTIVES / lessons regions — rule item 5.)

# 2. Before merging a change that cites files it does not modify:
git diff --name-only origin/main...HEAD            # what THIS change touches
grep -oE '[A-Za-z0-9_./-]+\.(ts|tsx|mjs):[0-9]+' <the changed docs>   # what it CITES
# Any cited file NOT in the first list is a citation this merge cannot protect.
# Re-read each target line against the current merge base, not against the base you started on.
```

<!-- Rule AX added 2026-08-14 — RETRO-271 §6. 50th permanent rule; range AA–AX. Discharges pattern P-45, minted by RETRO-267 and WIDENED here; P-45 is no longer tracked as an open pattern. Evidence (>=2 PRIOR numbered retros): RETRO-267 (count 1 — #717's eight index.ts anchors wrong at its OWN merge commit, displaced by a ~13-line block the same diff inserted) + RETRO-268 §6 (count 2 — FOLLOW-956's cross_ref middleware.ts:355-357 displaced by #722 one hour later; RETRO-268 declined it under the NARROW test and wrote "if it is [widened], this becomes prior 2", which is the condition being met here). Promotion trigger: RETRO-271 — FOLLOW-947, whose ENTIRE deliverable was correcting prior 1's anchors, shipped nine anchors verified correct at 623f5844 and all nine were wrong at HEAD 22 hours later, displaced by #732; two of them (index.ts:1089-1094, :1135-1137) now resolve to UNRELATED code that reads plausibly, which is the misleading rather than merely-broken form. RETRO-269 declined to increment for a COUNTER-EXAMPLE (#725's seven same-session anchors all correct at HEAD), not a rejection. CORROBORATION, deliberately NOT counted as a second trigger per RETRO-228's discipline: #738's §V.3.4 rewrite shipped origin-policy.ts:114-237 / :139-234 / :230-234 past END-OF-FILE (217 lines at HEAD) because #735 merged into its base 8 seconds earlier — the same class, and simultaneously a Rule AV compliance failure on the TIME axis. WHY A CONVENTION AND ONLY A NARROW GATE, MEASURED NOT PREFERRED: FOLLOW-947 AC(2) scanned 8502 anchors and found a bounds check would catch 0 of 9 (index.ts is 1882 lines; the defect is wrong-line-INSIDE-file) while firing ~76 times on append-only logs that must not change; #729 recommended the convention and explicitly declined to self-promote it, which is the correct actor boundary. ITEM 5 IS LOAD-BEARING: #729 deliberately LEFT three stale anchors inside dated Changelog blocks ("correcting them would falsify a record") and this rule preserves that. NEW LETTER, not an amendment — homed against neighbouring texts: Rule AV = whether a probe's SUBJECT matches (an anchor can match its subject perfectly and still rot); Rule AI = propagating a changed CLAIM across documents (here the claim is unchanged and only its coordinate moved); Rule Y = a citation that never performed the asserted check (here it did, at the time); Rule AQ = blocks DECLARED identical (an anchor declares nothing); Rule AH = a doc verified at its own merge commit (adjacent and complementary — AH is about capability claims, AX about coordinates, and AX item 4 is the merge-base half AH does not cover). ONE PROMOTION ACROSS THE WHOLE THREE-ENTRY PASS (RETRO-270/271/272, ten PRs), with four candidates declined including three of the retro's own: P-51 (count 1), P-52 (count 1), P-53 (count 2, ONE prior), P-54 (count 2, ONE prior). Self-audit performed as RETRO-269's lessons entry demanded. LETTER CHOICE: AX is next after AW; flag for human review if a different scheme is preferred. -->

---

## Rule AY — `tsc --noEmit` + `vitest` is NOT the verification set: a change under `apps/control-plane` MUST be validated with the same build CI runs, and every gate MUST be re-run AFTER every autofixer, not before

**Pattern.** Local verification in this repo has converged on `tsc --noEmit` + `eslint` + `vitest` +
`prettier --check`, run once, in that order. That set is a **proper subset** of what CI runs, and
the difference is not cosmetic — `next build` executes at least three checks none of the four can:
type-aware lint rules that have no type graph standalone, **webpack**'s module resolution (stricter
than TypeScript's), and Next's own **route-file export validation**. Separately, the order matters:
`eslint --fix` and `prettier --write` **mutate the tree**, so a `tsc` run that preceded them
certified a tree that no longer exists — and the two tools can disagree about the same construct, so
an autofix can remove exactly what the compiler requires.

**Evidence (≥2 PRIOR numbered retros, plus the promotion trigger).**

1. **RETRO-138 §6 VP-1 (2026-06-29, PR #379 / FOLLOW-431)** — _"Standalone `pnpm eslint <files>` /
   `tsc --noEmit` does NOT reproduce CI, because `next build`/`next lint` run TYPE-AWARE rules
   (`@typescript-eslint/no-floating-promises`) that have no type graph standalone."_ A
   `void → Promise<void>` signature flip turned bare sink calls into floating promises CI rejected;
   local eslint did not catch it (fix commit `9a24da5`). Recorded as **count 1, HELD**.
2. **RETRO-150 §4e/§6/§9 (2026-07-02, PR #423 / FOLLOW-455)** — `next build`'s webpack resolution
   rejected a relative `./dsr-otp.js` import that both `tsc --noEmit` and `vitest` accepted; the
   retro named it _"a DISTINCT failure axis"_ and filed **FOLLOW-474**, whose AC(1) is verbatim
   _"`docs/AGENT_WORKFLOW.md` explicitly lists `next build` as a required pre-PR gate for any
   `apps/control-plane` change."_ Recorded as **count 2** on this axis.
3. **Promotion trigger — RETRO-277 §4a LG-5 (2026-08-16, PR #761 / FOLLOW-1002)** — **two** CI reds
   on one ticket, one per limb of this rule:
   - `dfe4c0f2` — `Build (control-plane)` rejected `route.ts` exporting `ARCHETYPE_DESCRIPTORS`:
     _"not a valid Route export field"_. The commit says why local missed it: _"only tsc/vitest ran,
     never `next build`."_ **Third sighting of limb 1.**
   - `086d1939` — `eslint --fix`'s `no-unnecessary-type-assertion` **stripped** an
     `as HTMLTextAreaElement` cast that `tsc` requires (it types `getByTestId()` as `HTMLElement`).
     The commit says why local missed it: _"tsc ran BEFORE the autofix and only vitest ran after."_
     **First sighting of limb 2**, folded in here rather than minted as a separate letter because
     the remedy is one sentence in the same procedure.

**Why now and not at RETRO-150.** FOLLOW-474 was the correct response then, and it has sat
`status: READY` in `backlog/QUEUE.md:22189` since 2026-07-02 — **45 days** — with AC(1) undone
(`grep -n "next build" docs/AGENT_WORKFLOW.md` returns nothing at `d3a358c0`). A ticket that has not
been picked up in 45 days is not a control. The rule is the durable half; FOLLOW-474 remains the
executable half and is deliberately **not** re-filed.

**The counter-example, recorded because it is the argument for codifying rather than trusting.** PR
#762, merged **53 minutes** after #761, wrote in its own test plan: _"`tsc`, `eslint`, `prettier`
clean; **full `turbo run build` 5/5** (the FOLLOW-1002 lesson)."_ The lesson propagated correctly
and voluntarily — one agent-session deep, with no mechanism to carry it into the next session, which
is exactly what a convention is for.

### Rule

For any change touching `apps/control-plane` (and by extension any Next.js app in this repo):

1. **Run the app's real build before opening the PR** —
   `pnpm turbo run build --filter=@estalara/control-plane` (add `--force` when a warm cache could
   fake the result; see the standing warm-cache caveat). `tsc --noEmit` and `vitest` do **not**
   substitute for it, and the PR's test plan must state the build's task result (e.g. `5/5`), not
   just "tests pass".
2. **Run every verification AFTER every fixer, never before.** Any command that mutates the tree —
   `eslint --fix`, `prettier --write`, the lefthook pre-commit pair — invalidates every check that
   ran before it. The final, reported sequence is: fixers → `tsc --noEmit` → `eslint` (no `--fix`) →
   `vitest` → `prettier --check` → build. A verification transcript whose order cannot be
   reconstructed is not a verification transcript.
3. **Never write an `as` cast that the repo's own autofix will delete.** If
   `no-unnecessary-type-assertion` and `tsc` disagree about a construct, the cast is unstable under
   this repo's tooling: replace it with a runtime narrowing (`instanceof`, a type guard) that both
   tools accept. Silencing either side with a disable directive re-opens the same disagreement one
   edit later.
4. **A Next.js Route file may export only route handlers (`GET`/`POST`/…), route segment config
   (`dynamic`, `revalidate`, `runtime`, …), and types** (erased, therefore allowed — the `al-state`
   precedent). Any value a route needs to share lives in a sibling module.

### Verification

- **The PR body's test plan names the build and its result**, e.g.
  `full turbo run build --filter=@estalara/control-plane 5/5`. A test plan that lists only
  `tsc`/`eslint`/`vitest`/`prettier` for a control-plane change is incomplete on its face and a
  reviewer may return it on that basis alone.
- **The sequence is stated, not implied** — the transcript must make it visible that the fixers ran
  first.
- **Executable half:** FOLLOW-474 (READY, `backlog/QUEUE.md:22189`) adds this to
  `docs/AGENT_WORKFLOW.md`'s pre-PR checklist and evaluates a `scripts/pre-pr-check.sh`. Until it
  lands, this rule is the only written form. **PM: promote FOLLOW-474 or close it as superseded — it
  has now paid three dividends.**
- **This rule does NOT claim `next build` catches everything CI does.** It claims the three named
  axes (type-aware lint, webpack resolution, route-export validation) are invisible to the standard
  four commands, each demonstrated by a dated production sighting above. Any wider claim needs its
  own evidence.

<!-- Rule AY added 2026-08-16 — RETRO-277 §6. 51st permanent rule; range AA–AY. Evidence (>=2 PRIOR numbered retros): RETRO-138 §6 VP-1 (count 1, HELD — type-aware no-floating-promises, fix commit 9a24da5) + RETRO-150 §4e/§6/§9 (count 2 — webpack import resolution on ./dsr-otp.js, FOLLOW-474 filed). Promotion trigger: RETRO-277 §4a LG-5 — PR #761/FOLLOW-1002 went red TWICE, once per limb: dfe4c0f2 (route.ts exporting ARCHETYPE_DESCRIPTORS -> "not a valid Route export field", caught by Build (control-plane), missed locally because "only tsc/vitest ran, never next build") and 086d1939 (eslint --fix's no-unnecessary-type-assertion STRIPPED an `as HTMLTextAreaElement` that tsc requires; missed locally because "tsc ran BEFORE the autofix and only vitest ran after"). LIMB 2 IS FOLDED IN AT COUNT 1 DELIBERATELY — its nearest prior is a one-line note at RETROSPECTIVES.md:5268 (RETRO-121) recording the same lint class as "a clean fix, no behavior change", an observation never named as a pattern; it is folded rather than minted because the remedy is one sentence in the same procedure and a separate letter would split one evidence base (RETRO-228 discipline). WHY NOW, NOT AT RETRO-150: FOLLOW-474 has been status: READY in QUEUE.md:22189 since 2026-07-02 with AC(1) undone — `grep -n "next build" docs/AGENT_WORKFLOW.md` returns NOTHING at d3a358c0, 45 days on. A ticket unstarted for 45 days is not a control. FOLLOW-474 is NOT re-filed; it remains the executable half. COUNTER-EXAMPLE RECORDED AS THE ARGUMENT FOR CODIFYING: PR #762 merged 53 minutes after #761 and adopted `full turbo run build 5/5 (the FOLLOW-1002 lesson)` voluntarily — correct propagation, one agent-session deep, with no mechanism to carry it forward. HOMED AGAINST NEIGHBOURS: Rule AF = a permanently-red gate is a disabled gate (about CI's state, not about what local verification omits); Rule AU = a control asserting a name where it means a behaviour (about what an assertion proves, not about which command runs it); Rule AM = a self-testing gate's fixtures (about fixture provenance); the Paczka-1 lesson "local tests passing != CI passing" is the ANCESTOR of this rule and is deliberately general — AY names the three specific axes and the ordering constraint that generality never produced. ONE PROMOTION ACROSS THE WHOLE THREE-ENTRY PASS (RETRO-276/277/278, eight PRs), with FOUR candidates declined: P-56 (an enumeration inherits its blind axis — 2 instances, BOTH in this pass, 0 priors; next sighting -> Rule AR amendment), P-57 (a UI over a producerless field — count 1; nearest Rule AU), P-58 (a control byte defeats every lexical gate — count 1; the durable fix is FOLLOW-1006's gate, not a rule), P-59 (a hand-listed register with a prose extend-me instruction — 2 instances both this pass; next sighting -> Rule AP amendment). The TOTAL_SITES parallel-PR collision was evaluated and DELIBERATELY NOT minted: the constant is machine-checked against a live scan (register assertion 4), so a wrong value fails CI, and a serialize-on-a-named-constant rule would cost velocity to prevent what a green gate already prevents. LETTER CHOICE: AY is next after AX; flag for human review if a different scheme is preferred. -->

---

## Rule AZ — Regenerating a document section does NOT close the findings filed against it: a PR that rewrites a status/evidence section MUST first grep the backlog for open findings naming that section, and either close them or record why not, in the same PR

**Pattern.** This estate's status sections — `README §0`-style "read this first" blocks, evidence
tables, AC tables, and the long rationale comments above a verdict in code — are **regenerated from
the latest run**, not edited from a findings list. The author opens the section, replaces the
numbers and the narrative with what they just measured, and ships. Every defect previously filed
_against that section_ survives the rewrite untouched, because nothing in the authoring path ever
consults the backlog. The section then looks freshly maintained, which is worse than looking stale:
a reader correctly infers that someone reviewed it this week, and infers wrongly that its inherited
claims were reviewed too.

The failure is silent in both directions. The finding stays open in `FOLLOW_UPS.md` while its
subject text keeps changing around it, so a later reader cannot tell whether the finding was
considered and declined or never seen — and the retro that re-observes it has to re-derive the whole
thing to find out. Three of the four sightings below are the **same finding**, inherited by the
**same section**, across **four consecutive PRs**.

**Evidence (≥2 PRIOR numbered retros, plus the promotion trigger).**

1. **RETRO-309 §4d DG-4 (2026-08-24, PR #838 / FOLLOW-1075)** — named the shape without minting it:
   `tests/e2e/follow-819/README.md` §0's evidence row was **regenerated** by that PR and inherited
   **FOLLOW-1080** (RETRO-305 §4d DG-2 — §0 cites `last-run.json` as pasted evidence while
   `tests/e2e/follow-819/.gitignore` excludes it, so no reader who did not personally run the
   harness has it) entirely unchanged. Recorded as **count 1**.
2. **RETRO-310 §4d DG-5 (2026-08-25, PR #849 / FOLLOW-1098+1099)** — minted as pattern **P-86** at
   count 2 when #849 regenerated §0 again, from a fresh run, and inherited the same un-actioned
   finding a **third** time. The discharge condition was written out in advance, verbatim: _"a third
   regeneration of any section that inherits a filed finding, at which point the rule shape is 'a PR
   that regenerates a document section MUST first grep the backlog for open findings filed against
   that section.'"_ Recorded as **count 2**.
3. **Promotion trigger — RETRO-311 §4d (2026-08-25, PR #850 / FOLLOW-1124+1125)** — the trigger
   fired **five times in one PR**, and one of them is a P1 on a CEO decision ticket:
   - **§4d DG-1 (P1).** README §0's ⚠️ block was regenerated and still reads _"FOLLOW-820 condition
     1 requires a POSITIVE lift over a REAL control, and this harness cannot produce one."_
     **ESC-073, merged at `4dbff0aa` — the direct parent of the PR's branch point — rules the
     opposite in bold:** _"Condition 1 does NOT require a positive lift, and never did."_ The author
     cited ESC-073 correctly in the PR body, the commit message, the QUEUE banner and the code
     docblock; the one artefact a grader is told to read first kept the superseded rule. **Failure
     direction: a spurious NO-GO — the exact deadlock ESC-073 was raised to break, reinstated inside
     the instrument.**
   - **§4d DG-2 (P2).** The same regenerated §0 reports `4 / 5 green … RED: AC(2)` at line 21 and
     _"2 of its 5 measurable ACs are still RED"_ at line 80 — self-contradictory across sixty lines,
     the second number stale from the 3/5 era through two regenerations.
   - **§4d DG-7 (P3).** §0 regenerated a **fourth** time; FOLLOW-1080 inherited a **fourth** time.
   - **§4d DG-8 (P3).** README §1's AC table stale for the **second consecutive PR** that redefined
     AC(5) — FOLLOW-1127 is open against it. Verified structurally: the README diff has four hunks
     (`@@ -14`, `@@ -398`, `@@ -667`, `@@ -726`) and §1 lives at lines 89–101, untouched again.
   - **§4d DG-3.2 (P2).** The pattern is **not confined to prose**: the long rationale comment above
     AC(5)'s verdict in `differentiator-e2e.mjs` was heavily edited by the same PR and inherited the
     mis-cited `RETRO-298 §LG-1` lineage that **FOLLOW-1127** was filed against — _and_ it retained
     a red-first recipe (_"Remove `[data-estalara-cta]` … and `adaptedConversions` falls to 0"_)
     that the same PR's own execution falsified (`adaptedConversions: 5`).

**Dissolution-tested against the register before promoting, per RETRO-305's methodology — each
candidate letter's TEXT read and run verbatim against these events.** **Rule AI** binds the PR that
_changes a capability or contract claim_ to update every document asserting the prior state; it
makes ESC-073's PR the violator for DG-1 and **reaches none of DG-2, DG-7, DG-8 or DG-3.2**, which
are not capability changes — they are findings **already filed in the backlog** against a section
someone later rewrote. **Rule AO** governs a _corrective_ edit re-verified against its own PR's
evidence; a regenerative edit never claimed to correct anything, so AO's text does not reach it.
**Rule AX** governs perishable `file:line` anchors, not perishable findings. **Rule AH** governs an
operator instruction verified at its own merge commit — closest of the four, and about executability
rather than inherited findings. **No adequate letter.**

### Rule

1. **Before rewriting a status, evidence, AC or "read this first" section — in a doc OR in a code
   comment block that plays that role — grep `backlog/FOLLOW_UPS.md` and `backlog/RETROSPECTIVES.md`
   for the file path and the section id.** Two strategies, per Rule AR: lexical (the path, the
   section number, the artefact name) and structural (the ticket ids already cross-referencing that
   file).
2. **Every open finding the grep returns is either CLOSED in the same PR, or explicitly recorded as
   knowingly deferred**, with one line saying why, in the PR body. Silence is not a decision; a
   finding inherited three times has never been decided even once.
3. **A section rewritten in the same PR as a ruling, escalation or contract change that lands on
   `main` first MUST be diffed against that ruling's text**, not against the author's memory of it.
   The adjacent-commit case is the dangerous one: the ruling is fresh enough that everyone believes
   they know it and new enough that nothing has propagated.
4. **This rule does NOT require rewriting sections you did not touch.** It fires only when a PR
   regenerates a section — that is the moment the inherited claim gets a fresh coat of paint and
   becomes harder, not easier, for the next reader to doubt.

### Verification

- **The PR body names the grep and its result** — e.g.
  `grep -n "follow-819/README" backlog/*.md → FOLLOW-1080, FOLLOW-1127; FOLLOW-1080 closed here, FOLLOW-1127 deferred (owns two other items)`.
  A PR that regenerates a status section and reports no grep is incomplete on its face and a
  reviewer may return it on that basis alone.
- **A retro re-observing a finding for the Nth consecutive regeneration MUST report N**, not
  re-derive the finding. The count is the signal; the finding is already written down.
- **This rule does NOT claim the finding must be fixed.** It claims it must be _seen and decided_. A
  deferral recorded in one line is full compliance; an inherited claim nobody looked at is not.
- **Executable half — none exists and none is proposed here.** The natural machine form is a pre-PR
  grep over changed doc paths, and it is deliberately not specified: the sections this rule protects
  are identified by role, not by a naming convention a script could match. If a future ticket finds
  a mechanical predicate, it supersedes clause 1.

<!-- Rule AZ added 2026-08-25 — RETRO-311 §6, promoting pattern P-86. 52nd permanent rule; range AA–AZ. Evidence (>=2 PRIOR numbered retros): RETRO-309 §4d DG-4 (count 1 — named the shape, README §0 regenerated by #838, inherited FOLLOW-1080 unchanged) + RETRO-310 §4d DG-5 (count 2 — minted as P-86 when #849 regenerated §0 again and inherited the same finding a third time, WITH the discharge condition pre-specified verbatim as "a third regeneration of any section that inherits a filed finding"). Promotion trigger: RETRO-311 §4d — the pre-specified trigger fired FIVE times in PR #850: DG-1 (P1, README §0's warning block imposes the positive-lift requirement ESC-073 abolished at 4dbff0aa, the branch point's own parent — failure direction is a spurious NO-GO on a CEO decision ticket), DG-2 (§0 self-contradictory on its own AC count across 60 lines), DG-7 (FOLLOW-1080 inherited a FOURTH time), DG-8 (README §1's AC table stale for the SECOND consecutive PR that redefined AC(5); FOLLOW-1127 open against it; verified structurally — the README diff's four hunks are at lines 14/398/667/726 and §1 lives at 89-101), DG-3.2 (the pattern extends to CODE: the AC(5) rationale comment block was heavily edited and inherited both the mis-cited RETRO-298 lineage FOLLOW-1127 owns and a red-first recipe the same PR's own execution falsified). ALL FIVE COUNTED SEPARATELY, not folded — RETRO-001/004 under-count precedent. DISSOLUTION-TESTED AGAINST FOUR NEIGHBOURS AND NONE REACHES IT: Rule AI binds the PR that changes a capability claim (so it makes ESC-073's PR the DG-1 violator and reaches none of the other four, which are filed FINDINGS not capability changes); Rule AO governs a CORRECTIVE edit re-verified against its own evidence, and a regenerative edit never claimed to correct anything; Rule AX governs perishable file:line anchors, not perishable findings; Rule AH governs an operator instruction verified at its own merge commit — closest, and about executability. SCOPED NARROWLY ON PURPOSE: it fires only when a PR REGENERATES a status/evidence/AC section, not on every doc edit, because a rule that fires on every edit is ignored — and the evidence base is specifically about regenerated sections that OTHER tickets are told to read. FIRST PROMOTION IN EIGHT PASSES (RETRO-289, 290, 291, 292-297, 298-305, 309, 310 all zero), taken on arithmetic rather than appetite: the other four RETRO-311 candidates were declined — Rule AU explicitly NOT amended (RETRO-310's RETRO-122 split-evidence-base reasoning re-endorsed; and RETRO-311 §4a LG-0 found NO third Rule AU instance, the FOLLOW-1124 fix is correct), P-87 (a fallback firing on a superset of its intended states, count 1, no prior, no adequate letter — discharge trigger pre-specified), P-88 (query-level proof vs execution as distinct evidence classes, count 1 — Rule AV run verbatim reports it RED, letter adequate), P-89 (the P-NN register has THREE colliding "P-85"s from RETRO-306/307/309 and RETRO-310 counted only one, orphaning two patterns at count 0 — the vehicle when it recurs is a Rule AN AMENDMENT adding the pattern register to AN's enumeration, not a 53rd letter; register repair filed as FOLLOW-1137). LETTER CHOICE: AZ is next after AY and EXHAUSTS the two-letter A-series; the next promotion needs a scheme decision (BA, or a numbered scheme) — flag for human review before minting rule 53. -->

---

## Rule BA — Work is DELIVERED when it is on `origin`, not when it is committed: a commit with no remote ref does not exist for anyone but its author, and no backlog write may assert that something is fixed unless the commit carrying it is reachable from `origin`

**Pattern:** _"Work that has been committed but never pushed does not exist for anyone but its
author — and this estate repeatedly treats a local commit as a landed fact."_

An agent or session finishes real work, commits it to a local branch inside
`.claude/worktrees/agent-*` (or on the shared checkout), and the session ends — interrupted,
crashed, context-exhausted, or simply moved on. Nothing is pushed. The next session sees an empty
`git diff main..<branch>` (or no branch at all), concludes the work was never done, and either
re-dispatches it or, worse, records the intended outcome as achieved. The estate has spent fourteen
months building **detectors** for this, and detectors answer the wrong question: they ask _"did
somebody lose work?"_ after the fact. The question that prevents the loss is _"is this work
reachable by anyone but me?"_

### Evidence (≥2 PRIOR numbered retros required; NINE available — arithmetic stated, not asserted)

- **RETRO-146** — the founding sighting: worker output stranded uncommitted in
  `.claude/worktrees/agent-*`.
- **RETRO-188 §4e / RETRO-189** — the session-41 terminal shutdown stranded the content of PRs #581
  and #582; both recovered by re-dispatch into the same worktree.
- **RETRO-210 §6 / RETRO-211** — session-58 stranded #615/#616 the same way; the `HEAD==main` guard
  did not reach it.
- **RETRO-233** — fourth sighting; six PRs across four sightings, both worktree sightings stranding
  finished work.
- **RETRO-287 / FOLLOW-1046** — the stranded-work guard family.
- **RETRO-303** — a dispatch that died leaving no branch, no commit and no notification.
- **RETRO-308** — the retro on FOLLOW-1081, the detector built for exactly this class, which it
  measured as **blind in both directions**: its join key is the existence of a branch NAME in a repo
  that has never deleted one of its refs, so the founding incident's own re-dispatch would have
  silenced it.
- **RETRO-314 §5a (the promoting sighting, and a NEW sub-shape)** — commit `6f89597d`
  (_"docs(backlog): correct the stale NEXT line — FOLLOW-815 closed on 2026-08-07"_) exists on one
  local branch and nowhere else:

  ```
  git merge-base --is-ancestor 6f89597d origin/main   → false
  git branch -a --contains 6f89597d                   → pm-orchestrator/session-146c-… (local only)
  git for-each-ref --contains 6f89597d refs/remotes   → (empty)
  ```

  **In every one of the eight prior sightings the work was recovered. Here it was not**, and the
  defect it corrects — `backlog/QUEUE.md`'s `NEXT:` line naming a ticket closed nineteen days
  earlier as the critical path — is live on `main`. The session that produced it is the same session
  whose banner reads _"recorded because it is the third time this class has bitten."_

**Why nine predecessors declined to promote and why that no longer holds.** Every one of them
reasoned that the remedy was a **ticket**: FOLLOW-573 → 645 → 961 → 1046 → 1081 → 1092/1093, six
tickets over roughly fourteen months, all building detection. RETRO-308 then measured the shipped
detector as structurally silent on the incident that motivated it. A seventh detector is not the
missing instrument; a convention binding the author is, and it has never been tried.

**Dissolution-tested against the register before minting**, reading each candidate letter's TEXT and
asking whether running it verbatim reports this event clean:

- **Rule AN** — _"A number in a sequentially-allocated register … MUST be allocated against
  `origin/main` and the allocating write MUST land on `main` before that number is used anywhere
  else; a number minted on a feature branch is not allocated, it is guessed."_ **The closest letter,
  and its mechanism is exactly this one** — an unlanded commit is not a fact. But its **subject** is
  register numbers. Run verbatim on `6f89597d`: no number was minted, and it reports **clean**.
  Inadequate by subject, not by reasoning. (Rule BA is deliberately worded to generalise AN's
  mechanism without swallowing AN; AN stays the specific, stricter rule for register numbers.)
- **Rule AG** — parallel-worktree agents and shared append-only logs. Subject is file contention.
  Reports clean.
- **Rule A** — CI green before READY_FOR_REVIEW. Presupposes a PR already exists. Reports clean.
- **Rule AH** — an operator instruction verified at its own merge commit. Reaches the _stale line_
  half of the founding incident and says nothing about the unpushed correction.
- **Rule AW** — `blocks:` residuals discharged at DONE. Different subject. Reports clean.
- **Rule AZ** — findings filed against a regenerated document section. Different subject. Reports
  clean.

**No adequate letter.**

### Rule

1. **Push at the first commit.** Any session that creates a branch and commits to it MUST
   `git push -u origin <branch>` at (or immediately after) its **first** commit — before the next
   file edit, before any handoff note, before any backlog write. A red-first loop may continue
   locally after that first push; what is forbidden is a branch whose only copy is on one disk.
2. **No landed-fact claim without a remote ref.** No write to `backlog/` (QUEUE banner, HANDOFFS,
   FOLLOW*UPS status block, RETROSPECTIVES) may assert that something is \_fixed*, _corrected_,
   _closed_ or _done_ unless the commit carrying it is **reachable from `origin`** — an ancestor of
   `origin/main`, or the head of a pushed branch with an open PR. Reachability is proved by pasting
   `git merge-base --is-ancestor <sha> origin/main` or
   `git for-each-ref --contains <sha> refs/remotes`, not by a clean `git status` and not by a commit
   sha alone. **A sha is not evidence of reach.**
3. **A session that ends leaves every branch it created pushed, or says so.** If work is genuinely
   incomplete and must not be pushed, the handoff record MUST name the branch, the worktree path and
   the fact that the work is unreachable. Silence is the failure mode this rule exists to remove.
4. **This rule does NOT require a PR.** Pushing a branch is cheap, reversible and creates no review
   obligation. The obligation is reachability, not readiness.
5. **This rule does NOT fire on every commit.** It fires on **branch creation** and on **any backlog
   write that asserts a landed fact** — deliberately narrow, because a rule that fires on every
   commit is ignored (RETRO-311's own warning about over-broad letters).

### Verification

- **The claim's own transcript.** A backlog write asserting a fix landed carries the reachability
  command and its output on the same line or in the PR body. A reviewer may return a "corrected in
  `<sha>`" claim that shows no reachability proof on that basis alone.
- **Cheap mechanical half, if a future ticket wants one:** a `SessionStop`/`SubagentStop` hook that
  runs `git for-each-ref --format='%(refname:short)' refs/heads` over every worktree and reports any
  local branch with commits ahead of `origin/main` and **no** matching `refs/remotes` entry. That
  predicate is strictly stronger than FOLLOW-1081's, whose join key is the existence of a branch
  NAME (RETRO-308 §4a) — it keys on the **remote ref**, which cannot be satisfied by a name that
  merely exists locally. Not specified as mandatory here: this rule binds the author, and the hook
  is a convenience.
- **The negative case, so the rule is falsifiable:** a session that pushes at first commit and is
  then killed leaves recoverable work and violates nothing, even if the branch is abandoned.
  Abandoned pushed branches are noise; abandoned unpushed branches are loss.

<!-- Rule BA added 2026-08-26 — RETRO-314 §6. 53rd permanent rule; FIRST of the B-series. EVIDENCE (>=2 PRIOR numbered retros; NINE available, each cited by the sighting it contributed): RETRO-146 (founding, stranded uncommitted in .claude/worktrees/agent-*), RETRO-188 §4e + RETRO-189 (session-41 terminal shutdown stranded #581/#582, both recovered), RETRO-210 §6 + RETRO-211 (session-58 stranded #615/#616, HEAD==main guard did not reach), RETRO-233 (fourth sighting, six PRs / four sightings), RETRO-287 + FOLLOW-1046 (guard family), RETRO-303 (dispatch died leaving no branch, no commit, no notification), RETRO-308 (measured FOLLOW-1081's detector BLIND IN BOTH DIRECTIONS — join key is a branch NAME in a repo that has never deleted a ref). PROMOTING SIGHTING = RETRO-314 §5a and it is a NEW SUB-SHAPE: every prior sighting was RECOVERED; 6f89597d was not, has zero refs/remotes entries, and the P-class defect it corrects (QUEUE.md NEXT: naming FOLLOW-815, DONE since 2026-08-07 / PR #688, as the critical path) is LIVE on main. WHY NINE PREDECESSORS DECLINED AND WHY THAT NO LONGER HOLDS: all of them judged the remedy to be a TICKET, and six tickets across ~14 months (FOLLOW-573/645/961/1046/1081/1092+1093) built DETECTION, which answers "did somebody lose work?" after the fact; RETRO-308 then measured that detector silent on its own founding incident. The untried instrument is a CONVENTION binding the author, answering "is this reachable by anyone but me?" before the loss. DISSOLUTION-TESTED AGAINST ALL 52 LETTERS: Rule AN is the closest and its MECHANISM is identical (an unlanded commit is not a fact) but its SUBJECT is register numbers and it reports 6f89597d clean; BA generalises AN's mechanism WITHOUT swallowing AN, which stays the stricter specific rule for numbers. Rule AG (worktree agents + shared append-only logs) = file contention, clean. Rule A (CI green before READY_FOR_REVIEW) presupposes a PR, clean. Rule AH reaches the stale-line half only. Rule AW (blocks: residuals) and Rule AZ (findings vs regenerated sections) = different subjects, clean. SCOPED NARROWLY ON PURPOSE per RETRO-311's over-broad-letter warning: fires on BRANCH CREATION and on any backlog write asserting a landed fact, NOT on every commit, and explicitly does not require a PR. LETTER CHOICE: RETRO-311's Rule AZ trailing comment flagged that AA-AZ is exhausted and asked for human review before rule 53. Taken as BA, and the reasoning is recorded rather than assumed: the alternative (a numbered scheme) is not a decision but a migration invalidating several hundred "Rule <letter>" citations across RETROSPECTIVES.md, FOLLOW_UPS.md, PR bodies, code docblocks and four CI gate scripts. Continuing base-26 costs nothing and is unambiguous. THE FLAG STANDS for whoever wants to change the scheme — but a promotion meeting its evidence bar should not be blocked on a cosmetic naming question, and deferring would leave a nine-retro pattern uncodified for a tenth. Register repair for the pattern-id collisions remains FOLLOW-1137; the QUEUE.md landing for 6f89597d is FOLLOW-1151 (the retrospective-analyst does not write QUEUE.md). -->

---

## Rule BB — A registered `revalidate_on` trigger is an obligation the tripping PR discharges, not a note for later: a diff that touches a symbol a measured premise names MUST revalidate that premise or stamp it STALE, in the same PR

**Pattern:** _"A measurement's expiry condition is written down as an event, the event happens, and
nothing consumes it — so a measurement silently becomes a belief."_

`docs/ops/MEASURED_PREMISES.md` entries carry two expiry fields. `revalidate_by:` is a **date**, and
a date is self-executing: it arrives whether anyone is watching or not. `revalidate_on:` is an
**event**, usually named as a symbol or a deploy — and an event only fires for someone who is
looking. This estate has now watched that field fail four times, twice on the same premise. The
failure is quiet by construction: the premise keeps reading as measured, its numbers keep being
cited, and the diff that invalidated it is merged, green, and correct on its own terms.

The obligation is on the **tripping PR**, not on a later ticket, because only the tripping PR knows
what changed. Deferring it into a follow-up converts a staleness stamp into a citation guard — those
are different controls, and the second does not imply the first.

### Evidence (≥2 PRIOR numbered retros required; three available, two counted)

- **RETRO-271 §LG-3 (count 1)** — `revalidate_on` is _"a producer with no consumer"_ for four of its
  five triggers. The field was already known to be un-wired.
- **RETRO-282 §LG-2 (count 2)** — _"`revalidate_by` is a date; `revalidate_on` is a hope"_, filed
  against MP-010. Names the mechanism exactly.
- **`RETROSPECTIVES.md:65234`, corroborating and NOT counted** — _"MP-012's `revalidate_on` fired
  three times inside 90 minutes"_ of the entry being written, i.e. the field failed before the ink
  dried, on the same premise this rule's promoting sighting trips.
- **PROMOTING SIGHTING: RETRO-316 §4d DG-2** — the fourth, and the second on MP-012 specifically. PR
  #869 changed `buildDirectiveGroundingText`; MP-012's `revalidate_on` names _"the grounding-text
  builder"_ verbatim. The premise was neither revalidated nor stamped, and it is **materially**
  stale, not merely untouched: MP-012 enumerates three false-positive classes, `GROUNDING_RULE`'s
  three token-level constraints were engineered to map one-to-one onto them, and RETRO-316 measured
  a fourth class the change created. Consistent with this estate's adjudication (Rules
  AA/AB/AC/AD/AE/AF/AR/AS/V/Q), the promoting retro does not inflate the count.

**Rule:** before opening a PR, check `MEASURED_PREMISES.md` for any `revalidate_on` naming a symbol,
file or deploy your diff touches. For each match, do ONE of:

1. **Revalidate** — re-run the measurement and update `measured_on` plus the numbers; or
2. **Stamp STALE** — edit the entry to say so, with the date, the tripping PR and what is now
   unknown; or
3. **Argue it does not apply** — in the PR body, naming the entry, and say why the trigger's text
   does not reach this diff.

Silence is not one of the three. Filing a follow-up to "re-read it later" is option 2 **plus** a
ticket, never a substitute for the stamp — an unstamped premise is cited by people who never read
the ticket.

**Verification:**

```bash
# Which premises does this diff trip? Run before opening the PR.
git diff --name-only origin/main... | sed 's#.*/##' > /tmp/touched.txt
grep -n "revalidate_on:" -A 3 docs/ops/MEASURED_PREMISES.md
# then: for each trigger naming a SYMBOL, grep the diff for that symbol
git diff origin/main... | grep -nE 'buildDirectiveGroundingText|GROUNDING_RULE|checkDirectiveFacts'
```

**The negative case, so the rule is falsifiable:** a PR that touches a file merely _mentioned_ by an
entry's prose, without touching any symbol its `revalidate_on` names, trips nothing and owes
nothing. The trigger's own text is the boundary — this rule does not license re-measuring the world
on every diff.

<!-- Rule BB added 2026-08-27 — RETRO-316 §6. 54th permanent rule; second of the B-series. EVIDENCE (>=2 PRIOR numbered retros): RETRO-271 §LG-3 (count 1, revalidate_on is a producer with no consumer for four of five triggers) + RETRO-282 §LG-2 (count 2, "revalidate_by is a date; revalidate_on is a hope", filed against MP-010). Corroborating, uncounted: RETROSPECTIVES.md:65234 (MP-012's revalidate_on fired three times inside 90 minutes). PROMOTING SIGHTING = RETRO-316 §4d DG-2, the FOURTH sighting and the SECOND on MP-012 — a trigger that fires repeatedly on one premise and is never honoured is an un-wired field, not an oversight. WHY THE PRIOR SIGHTINGS DECLINED: RETRO-271 and RETRO-282 both diagnosed the field correctly and both routed the remedy to a TICKET (FOLLOW-983 and the MP-register work), i.e. to a consumer that would watch the field; none was built, and RETRO-316 shows the field failing again with the register otherwise healthy. The untried instrument is an obligation on the AUTHOR of the tripping diff, which needs no watcher. FOUR HOMES TESTED AGAINST THEIR TEXTS before minting a letter: Rule AP governs a GATE's residual-gap list being machine-checked (a gate's own disclosure axis; it does not reach a premise register's staleness); Rule AT governs an ESCALATION's premise being measured immediately before a RULING (the decision moment, not the code-change moment — MP-012 was tripped by a merge, not by an escalation); Rule AX governs file:line citation rot (anchor shelf life, orthogonal to whether the measurement still holds); Rule AZ governs regenerated document sections not closing findings filed against them (backlog hygiene, and its subject is findings, not measurements). None reaches a premise register whose trigger a code diff trips. SCOPED NARROWLY per RETRO-311's over-broad-letter warning: fires ONLY on a diff touching a symbol/file/deploy a revalidate_on NAMES, and the three discharge options include "argue it does not apply", so the rule cannot be used to demand re-measurement of the world. The machine-checkable form (a gate mapping revalidate_on symbols to paths) is FOLLOW-1167 AC(4) — deliberately NOT made a precondition of the rule, because Rule BA's promotion established that a convention binding the author does not wait on a detector. LETTER CHOICE: BB, next after BA; the naming-scheme flag Rule BA raised for human review still stands and is still not a reason to defer a promotion that meets the bar. -->

---

## Rule BC — A predicate justified by ENUMERATING a population is evidence about THAT population only: giving it a second consumer requires re-running the enumeration over the second consumer's inputs, or saying in the PR that the second population is unbounded and the predicate is being applied to it without evidence

**Pattern (EVIDENCE-AXIS ≠ APPLICATION-AXIS):** An author does the expensive, correct thing — they
enumerate every member of a population before drawing a line, and they write the enumeration into
the code as the justification for a predicate. The predicate is right. Later (often in the very next
merge, and often by the same author) the predicate is **shared** — exported, extracted, promoted to
a module boundary — and given a second consumer. The second consumer's inputs are a **different
population**, frequently one that does not exist in the repository at all (a model's output, a
tenant's page, a third party's payload). The enumeration is not re-run, because from the diff's
point of view nothing was enumerated: a predicate was reused. The docblock still carries the
original evidence, now scoped to one of two callers, and reads as though it covers both.

This is the sharper cousin of "the author's analysis covered one branch of an N-branch artefact". It
is worse than that shape because the extraction is **correct engineering** — one definition, no
drift, `Rule I`-clean — and the correctness of the refactor is what makes the scope change
invisible.

**Evidence (≥2 PRIOR numbered retros required; two available, both counted; the promoting sighting
is not counted):**

- **RETRO-317 §6 Candidate A (count 1)** — ESC-077 option 2 defined credit-worthiness precisely
  (_"did anything SERVED differ between arms"_) and applied it to **two of five** decision-tree
  exits. A predicate introduced as a claim about one branch, silently a claim about all of them.
- **RETRO-318 §6 (count 2)** — #873's `ANGLE` clause was reasoned about, justified by and measured
  on the Haiku band, and shipped through a `GROUNDING_RULE` shared by **both** prompt builders, to a
  Sonnet prompt whose referent does not exist. RETRO-318 named the shared cause in its own words —
  _"the author's analysis covered one branch of an N-branch artefact"_ — declined to promote at
  count 2, and pre-committed to a home: _"if a third comes, the right move is probably an amendment
  to Rule AC's verification, not `Rule BC`."_
- **PROMOTING SIGHTING: RETRO-319 §4a LG-1** — the third, and the one that shows RETRO-318's guessed
  home is **wrong**. `ungrounded-directives.ts` enumerates all **seventeen** shipped `cta` strings,
  argues the two hardest, and exempts the slot; #875 exports that predicate to
  `checkDirectiveFacts`, whose `cta` values are written by a **model**. Measured both ways across
  the merge boundary: three fabricated proper names (`Book a Viewing with Knight Frank`,
  `Download the Marina Heights Yield Report`, `Enquire about the Guaranteed Rental Income scheme`)
  were DISCARDED before the merge and are SERVED after it, with a `headline`-slot control discarded
  both ways. Consistent with this estate's adjudication (Rules AA/AB/AC/AD/AE/AF/AR/AS/BB/V/Q), the
  promoting retro does not inflate the count.

**Why this is a letter and not an amendment to Rule AC — stated because RETRO-318 predicted the
opposite and the prediction is falsifiable.** Rule AC's instrument is _"a repo-wide grep for a
distinctive member of the set"_. Run it on the promoting sighting and it **succeeds**: grepping
`'Request Investment Pack'` finds all seventeen strings and confirms the enumeration is complete.
Rule AC cannot fail here, because the population that breaks the predicate — the strings a model
will write tomorrow — **has no bytes in the repository**. A rule whose verification is a grep
structurally cannot reach a population that is not text on disk. Rule AC governs _did you find every
instance you have_; this rule governs _is the population you enumerated the population your caller
feeds it_.

**Four other homes were tested against their own texts before minting:** **Rule AR** (a claim of
ABSENCE needs two independent search strategies — here the search was correct and the claim is a
property over a population, not an absence); **Rule AV** (a probe must share every property with its
subject except the one under test — the same intuition, but AV governs evidence-gathering artefacts
at measurement time, not a shipped predicate acquiring a second caller); **Rule AQ** (a block
declared identical across files must be extracted or machine-checked — the promoting sighting DID
extract, correctly; the failure happened _because_ extraction succeeded, which is the opposite of
AQ's subject); **Rule AI** (documents asserting a prior state — reaches the stale docblock
afterwards but not the scope decision at introduction).

**Rule:** when a PR **exports, extracts, or adds a caller to** a predicate/classifier/allow-list
whose justification is an enumeration:

1. **Name the population the evidence covers**, in the predicate's own docblock, in one sentence
   (_"enumerated over the seventeen shipped playbook `cta` strings"_). If it is already there, check
   that it is still true after the diff.
2. **Name the new consumer's input population** and say whether it is the same one. Three honest
   outcomes: **same** (cite it and move on); **different but enumerable** (re-run the enumeration
   and paste it); **different and unbounded** (say so explicitly — _"the model writes this value;
   the enumeration does not bound it"_ — and either bound it another way or state in the PR body
   that the predicate is being applied without evidence and why that is acceptable).
3. **Cover the new population with at least one red-first test.** If the population is unbounded,
   one adversarial member is the minimum: the member you would be embarrassed to ship.

Silence is not an outcome. A predicate that is correct for its first caller and unargued for its
second is not "reused", it is **widened**.

**Verification:**

```bash
# 1. What did this PR newly export or newly call?
git diff origin/main... | grep -nE '^\+.*\bexport (function|const)'
git diff origin/main... | grep -nE "^\+.*\bimport \{[^}]+\} from"
# 2. For each such predicate, who feeds it? Enumerate the CALLERS, then each caller's input source.
grep -rn "<predicateName>" --include=*.ts apps packages | grep -v node_modules
# 3. Read the predicate's docblock: does it name the population its evidence covers?
#    If it does not, this rule is unsatisfiable by inspection and the PR owes the sentence.
```

**The negative case, so the rule is falsifiable:** a predicate whose justification is a TYPE or an
INVARIANT rather than an enumeration (`isNonEmpty`, `isValidUuid`, a Zod schema) owes nothing — its
evidence is not population-scoped, so a second consumer cannot fall outside it. The rule fires only
where the docblock's argument is of the form "I looked at all of them and they are all X".

<!-- Rule BC added 2026-08-28 — RETRO-319 §6. 55th permanent rule; third of the B-series. EVIDENCE (>=2 PRIOR numbered retros): RETRO-317 §6 Candidate A (count 1, ESC-077's credit predicate applied to 2 of 5 decision-tree exits) + RETRO-318 §6 (count 2, the ANGLE clause justified on the Haiku band and shipped through a GROUNDING_RULE shared by both builders). PROMOTING SIGHTING = RETRO-319 §4a LG-1: #875 exported isNonAssertiveSlot -- justified by an enumeration of the 17 shipped playbook cta strings -- to checkDirectiveFacts, whose cta values are model-generated; measured both ways across 080662a5, three fabricated proper names went DISCARDED -> SERVED with a headline-slot control unchanged. WHY RETRO-318's GUESSED HOME FAILS: it pre-committed to "an amendment to Rule AC's verification, not Rule BC". Rule AC's instrument is a repo-wide grep for a distinctive member of the set; run on the promoting sighting it SUCCEEDS (all 17 strings found, enumeration complete) because the population that breaks the predicate has no bytes in the repository. A grep cannot reach a population that is not text on disk. FOUR OTHER HOMES TESTED AGAINST THEIR TEXTS: Rule AR (absence claims need two search strategies -- the search here was correct; the claim is a property over a population, not an absence); Rule AV (a probe must share every property with its subject -- governs evidence-gathering artefacts at measurement time, not a shipped predicate gaining a caller); Rule AQ (declared-identical blocks must be extracted or machine-checked -- #875 DID extract correctly, and the failure happened BECAUSE extraction succeeded); Rule AI (documents asserting a prior state -- reaches the stale docblock after the fact, not the scope decision at introduction). SCOPED NARROWLY per RETRO-311's over-broad-letter warning: fires ONLY on a predicate whose docblock argument is an ENUMERATION, only when a PR gives it a new consumer, and the third discharge option is "say the population is unbounded and why that is acceptable" -- so the rule cannot be used to demand an enumeration of the world. The negative case (type/invariant-justified predicates owe nothing) is stated so the rule is falsifiable. LETTER CHOICE: BC, next after BB; the naming-scheme flag Rule BA raised for human review still stands and is still not a reason to defer a promotion that meets the bar. -->
