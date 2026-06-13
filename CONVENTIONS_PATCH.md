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

**Rule:** PM-orchestrator MUST run `gh pr checks <pr-number> --watch` and wait for completion before
marking any ticket READY_FOR_REVIEW. Local tests passing ≠ CI passing. This step is non-negotiable
even if the worker reports "all tests pass."

**Verification:**

```bash
gh pr checks <pr-number> --json state,name | jq '[.[] | select(.state != "SUCCESS")] | length'
# Must return 0
```

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

<!-- Rule W added 2026-06-13 — RETRO-060 §6 (FOLLOW-286/PR #279 RENAME+ADD-COLUMN-NOT-NULL apply-time failures + FOLLOW-287/PR #281 MODIFY COLUMN error 524 on ORDER BY key column, both merged green, count 2 on the intent_events sort-key DDL; threshold met). Filed FOLLOW-291 to build the pre-merge guard + ephemeral-apply gate, FOLLOW-290 to rebuild intent_events with the correct ORDER BY (tenant_id, session_id, event_at). Note: Rule V intentionally not used (skipped from the prior sequence); next free letter was W. -->
<!-- Rule U added 2026-06-11 — RETRO-052 §6 (RETRO-049 §4a LG-2/§5d + RETRO-050 §4a LG-1/§5d + RETRO-051 §4a LG-2/§5d, count 3 on tenants.quiz_config; re-confirmed RETRO-053 §5d + RETRO-052 §4a LG-1, threshold long exceeded). The decay recurred key-by-key because each fix annotated/partial-removed without a blob-level policy; this rule converts the recurring per-key fix into a policy. Filed FOLLOW-271 to apply it to quizConfig.enabled. -->
<!-- Rule T added 2026-06-10 — RETRO-049 §6 (RETRO-047 §4b CB-1 + RETRO-049 §4b CB-1, Vitest v2 vi.fn type-arg → CI-only typecheck escape, threshold met). Process rule (no shipped defect); does NOT mandate hook reconfiguration (devops escalation). -->
<!-- Rule R added 2026-06-08 — RETRO-037 §6 (RETRO-032 LG-1 + RETRO-037 LG-1, threshold met). -->
<!-- Rule S added 2026-06-09 — RETRO-045 §6 (RETRO-044 §4a LG-1/§6 + RETRO-045 §4c TG-1/§4a LG-1, threshold met; RETRO-044 set the explicit promote-on-2nd-instance condition). -->
<!-- Rule Q+ added by retrospective-analyst when RULE_PROMOTION_THRESHOLD (2) is met -->
<!-- Rule P added 2026-06-01 by direct CEO directive (provenance noted in-rule), not retro-promoted -->
