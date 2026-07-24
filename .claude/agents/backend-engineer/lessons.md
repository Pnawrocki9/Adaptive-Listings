# Backend Engineer — Lessons Log

---

## 2026-07-24 / FOLLOW-638

- **What I built**: `/admin/analytics` (staff-only) + `GET /api/admin/analytics/rollup` — a
  platform-wide rollup (sessions, adapted/holdout, CTA lift, quiz completions) across every
  tenant/brand, plus a per-brand breakdown table. Deliberately unfenced (no `tenant_id` filter,
  `GROUP BY tenant_id` instead) per the CEO's per-brand ruling (every client brand = a white-label
  deployment sharing one data pool). Page and route share a single `getPlatformAnalyticsRollup()`
  builder in a sibling `data.ts` (Rule H: one function, two real non-test consumers, no self-fetch
  loopback in the RSC page).
- **Wiring/auth/fail-loud risks I weighed**: (1) `resolveTenantAccess` (the ADR-0018 staff-override
  pattern used by the per-tenant analytics routes) structurally does not fit an unfenced rollup — it
  always resolves to exactly one tenant fence. Used `verifyTracerAdminAuth` instead (the same gate
  `/api/admin/tracer/sessions` and `/api/admin/intent/config` already use for unfenced staff-only
  reads) and documented the deviation explicitly in the route's JSDoc so a future reviewer doesn't
  read "no resolveTenantAccess" as a missed auth port. (2) This route straddles TWO backing stores
  (ClickHouse for session/CTA metrics, Postgres for the tenant roster + `quiz_completions`). Decided
  the tenant roster + ClickHouse are the PRIMARY metric group (configured-but-failed → hard 500,
  Rule K.2) while `quiz_completions` is SECONDARY and degrades independently (200 + explicit
  `quiz_data_source: 'error'` + every `quizCompletions` field `null`, never a fabricated 0) — this
  is the guardrails' explicit "200 carrying a degraded flag" escape hatch for a non-primary metric,
  used deliberately rather than either always-hard-failing (too brittle for a secondary field) or
  always-soft-failing (would have hidden a real ClickHouse outage on the primary numbers). (3)
  Per-brand rows are built by iterating the Postgres tenant roster (not the ClickHouse result set)
  so every tenant gets a row even with zero activity — a tenant present in ClickHouse but deleted
  from `tenants` is correctly dropped, matching "row per tenant" from the AC literally. (4) Verified
  no regression to the existing 3-tracer+3-tenant+1-platform nav-link-count test in
  `admin/layout.test.tsx` by updating its "exactly N links" assertions in the same PR rather than
  leaving a stale count that would silently start failing.
- **A guardrail I'd add**: none new — this ticket is itself the guardrail-compliant answer to a gap
  (no cross-brand admin view existed at all); the K.2 partial-degrade pattern here (primary vs.
  secondary metric groups failing independently) is reusable and worth naming explicitly next time a
  rollup spans >1 backing store, rather than re-deriving it from scratch.

---
## 2026-07-24 / FOLLOW-622

- **What I built**: de-scoped a producer-only security facade per CEO Option B
  (`docs/DECISION-BRIEF-FACADES-622-623-2026-07-24.md`) — removed the "SDK Allowed Origins" textarea
  and `sdk.allowed_origins` from `/api/config`'s contract (`TenantConfig`, GET assembly, PATCH
  schema/merge/audit payload). Kept the `tenants.allowedOrigins` DB column and its data (deferred,
  not dropped), updated its doc comment + `api_keys.allowedOrigins`'s to state the truth (ingest
  CORS is a hardcoded env allowlist, nothing reads this column), fixed the false
  per-tenant-origin-validation claim in `MASTER_DESIGN.md` §V.3.4, and confirmed FOLLOW-642 (the
  tracked re-enable) was already filed.
- **Wiring/auth/fail-loud risks I weighed**: this is a pure removal (not a new
  schema/event/consumer), so Rule H doesn't gate it the normal way — the risk was the INVERSE:
  leaving a stale claim of enforcement somewhere after the control's gone would be worse than the
  original facade (silent lie vs. visible dead control). Did a repo-wide grep for every
  `allowed_origins`/`allowedOrigins` hit and classified each (fixed / historical-record-leave-as-is
  / unrelated name-collision, e.g. `dev-cors.ts`'s local `allowedOrigins()` helper) rather than
  assuming the ticket's file list was exhaustive.
- **A guardrail I'd add**: my own PR doc-comment citing the decision-brief's own 41-char kebab
  filename (`DECISION-BRIEF-FACADES-622-623-2026-07-24`) tripped the `cloudflare-api-token` gitleaks
  heuristic — a self-inflicted Rule V case. Worth a pre-commit lint that greps new diff lines for
  `[a-zA-Z0-9_-]{40,}` runs BEFORE push, so this class of FP is caught locally instead of costing a
  CI round-trip.

## 2026-07-24 / FOLLOW-636

- **What I built**: closed a producer-only revocation facade — the admin "revoke demo session"
  action wrote `demo_sessions.revoked_at` but the runtime gate (`verifyDemoJwt` → POST `/api/adapt`)
  only checked HS256 signature + the JWT's self-contained `exp`, so a revoked demo token kept
  serving adaptations for up to 7d. Added a `session_id` claim passthrough in `verifyDemoJwt`, a new
  `resolveDemoSessionRevocation` helper (one PK lookup, no cache), and a call at the adapt demo-JWT
  path that returns the existing `401 invalid_demo_token` on a revoked row. Deleted orphaned dead
  `demo-session-store.ts`.
- **Wiring/auth/fail-loud risks I weighed**: (1) kept signature+exp fail-CLOSED inside
  `verifyDemoJwt` and made ONLY the enablement (revocation) axis fail-OPEN, mirroring FOLLOW-633
  `resolveAlEnablement` — a DB blip must not break a legit live demo, but configured-but-threw is
  Sentry-captured (K.2 observable) while db-not-configured (dev/CI) stays silent. (2) Gated the
  check on the demo-JWT path only (`apiKeyTenantId === null`) so the api-key path keeps using its
  own `api_keys.revoked_at`. (3) Deliberately NO cache: a TTL cache would re-introduce exactly the
  revocation lag the ticket closes — stated the tradeoff in the helper doc. (4) New `session_id`
  claim + helper both have a real consumer in the same PR (Rule H satisfied). Cost: one indexed PK
  lookup, sub-ms, only on the demo path.
- **A guardrail I'd add**: a "producer-without-consumer" lint for lifecycle columns — a write to a
  `*_revoked_at` / `*_disabled_at` / `*_suspended_at` column should require a grep-provable runtime
  reader on the enforcement path, or a FOLLOW stub. This facade (write with no read) is the same
  shape as the events-never-emitted / tables-never-seeded Rule-H family but on the READ side.

## 2026-07-23 / FOLLOW-624

**What I built:** Fixed a live data-loss path (ESC-039, P1, RETRO-205 §4a LG-1) shared by all three
Estalara-staff per-tenant config editors (`tenant-config-editor.tsx`, `quiz-config-editor.tsx`,
`demo-override-editor.tsx`): each caught a failed initial GET into a no-op
`.catch(() => { /* Load silently */ })`, then kept rendering the component's hardcoded `DEFAULTS` as
if they were the tenant's real stored config. A subsequent Save PATCHed/POSTed/PUT that DEFAULTS
blob, silently wiping the tenant's brand config + origin allow-list, quiz config, or DEMO MODE
override — under a green "Settings saved!" banner. Added a `loadStatus` state
(`'loading'|'loaded'|'error'`) tracked SEPARATELY from the existing save-only `status` state in all
three editors: a failed GET now renders a `role="alert"` banner with a Retry button and disables
Save (also guarded inside `handleSave` as defense in depth against an implicit form submit bypassing
a disabled button). `tenant-config-editor` additionally now formats and surfaces the route's zod
`.flatten()` validation `details` in the save-error banner (was previously dropped, showing only
"Invalid request body"). Wrote the red-first failing tests BEFORE the fix (7 failed / 6 passed
against the pre-fix components), then implemented.

**Wiring/auth/fail-loud risks I weighed:** (1) The ticket drew a 3-way boundary: (a) loaded+row
exists, (b) loaded+no-row-yet (legitimate first-time-tenant state, Save MUST still work), (c) load
failed. The route already renders (b) as a normal 200-with-defaults, indistinguishable from (a) at
the fetch layer — so gating purely on fetch outcome (not on whether the returned values equal
DEFAULTS) correctly treats (a) and (b) identically as "loaded" without touching the route (that
route-side fix is FOLLOW-627, explicitly out of scope and NOT pulled in here). (2) Two of the three
editors (`quiz-config-editor.tsx`, `demo-override-editor.tsx`) had ZERO existing tests before this
PR — exactly the hole the ticket named as what let the swallow ship 3 times (FOLLOW-595→596→600
copy-forward, found only by a retro). Wrote full new test files for both, not just the fixed one.
(3) Confirmed via `grep -rn "catch(() => {" -A3 apps/control-plane/src/app/admin --include=*.tsx`
that all 3 instances are gone post-fix (was 3, now 0) — the exact command the ticket's own AC cited.
(4) Scoped the `details`-surfacing fix to `tenant-config-editor.tsx` only, per the ticket's literal
AC text, even though `quiz/config` and `demo/override` routes also return `details` on validation
failure in a slightly different shape (`error: string` + sibling `details` vs
`error: {message, details}`) — flagging this as a candidate follow-up rather than silently expanding
scope.

**A guardrail I'd add:** FOLLOW-625 (already filed, P2, devops-engineer) is exactly the right next
step — mechanise the `catch(() => {` swallow-detection grep in CI so a 4th copy-forward of this
pattern fails the build instead of shipping. I'd also flag as a follow-up: `quiz/config/route.ts`'s
validation-error shape (`{error: string, details}`) is a different contract from `demo/override` and
`config`'s (`{error: {message, details}}`) — worth a shared error-envelope type so a future
save-error banner (or a future FOLLOW-625-style detail-surfacing pass on the other two editors)
doesn't have to special-case both shapes.

---

## 2026-07-22 / FOLLOW-599

**What I built:** Wired `GET /api/audit` to the real `staff_audit_log` table, replacing the
`MOCK_ENTRIES` stub, and closed an auth hole — the route trusted an unauthenticated `x-tenant-id`
header. Now STAFF-ONLY via `resolveTenantAccess({ allowStaffOverride: true })`, agency callers → 403
(deferred Phase-2, ADR-0018 §3), staff supply `?tenant_id` validated by the helper. Added a
read-only per-tenant staff page (`/admin/tenants/[id]/audit`) + `StaffAuditView`, and the FOLLOW-606
hub link on the `[id]` landing (same PR).

**Wiring/auth/fail-loud risks I weighed:** (1) Invariant-5 fence — `staff_audit_log` has NO RLS and
is read via `createAdminClient()`, so the `eq(staffAuditLog.targetTenantId, access.tenantId)` WHERE
predicate is the ONLY tenant boundary; MANDATORY red-first test drives the REAL Drizzle query (DB
mock keys a per-tenant store on the bound `and(...).conds[0].val`) and proves tenant A never sees B.
(2) Reads-NOT-logged (CEO Q4) — asserted no `.insert`/`.transaction` on a GET; the atomicity guard
correctly does NOT list the route (no `insert(staffAuditLog)` → not a staff-write). (3) Rule K.2 —
DB-unconfigured → `data_source: 'mock'` in the NEW shape; configured-but-throws → 500 + Sentry, no
fabricated rows. (4) Old `AuditResponse` shape had a fabricated `user_email` with no backing column;
migrated to `admin_user_id`. Only consumer of the old type was its own test (grepped) + the new
`audit-view.tsx` consumes the new type (Rule H satisfied).

**A guardrail I'd add:** The staff mock-fallback path is only reachable in tests because
`resolveTenantAccess`'s staff branch calls `tenantExists` → `createAdminClient`, which throws when
the DB is unconfigured (AccessError 500) BEFORE the route's `!dbConfigured` mock check. So for a
staff-only route the `data_source: 'mock'` branch is effectively test-only in a real no-DB env.
Worth a lint/CI note that "mock fallback after a staff-path resolve" is unreachable without DB — or
move the dbConfigured check to short-circuit before resolve on read-only routes. Left as-is here to
mirror the labels precedent exactly.

---

## 2026-07-21 / FOLLOW-612

**What I built:** Closed the 5th bypass (RETRO-196) of the staff-write atomicity CI guard
(`scripts/check-staff-write-atomicity.cjs`): a data mutation delegated through a NAMESPACE/
property-access import (`import * as helper from '@/lib/x'; helper.upsertX(tx, ...)`) fell through
BOTH classification branches of `collectFileFacts`'s `visit()` — not a fixed-method-name mutation
(`transaction`/`insert`/`update`/`delete`/`execute`), not a bare-identifier helper call
(FOLLOW-609's own fix only widened the `ts.isIdentifier(node.expression)` branch) — so it silently
printed SKIP, zero enforcement, identical failure mode to bypass 4 one call-shape hop over. Fix:
reused (did not fork) the existing `localImportedIdentifierSources` map — it already resolves a
namespace import's LOCAL binding (`helper`) to the module path exactly like it does for a named
import's bound name — and added a new branch inside the `PropertyAccessExpression` handling that,
when none of the fixed method names match, checks whether the property access's OBJECT is a
locally-imported identifier; if so it's queued as a `localHelperCallCandidate` keyed by that
object's name and resolved through the SAME `moduleContainsMutation` check bypass 4 already uses.
Added committed fixture pair `bypass5-namespace-import-delegated-mutation(-out-of-tx)/` (OK / FAIL)
mirroring the bypass-4 pair, wired into `check-staff-write-atomicity.test.sh`.

**Wiring/auth/fail-loud risks I weighed:** (1) Re-read the FOLLOW-609 lessons entry first per the
ticket's own instruction — it documents two wrong turns (gating on tx-scope at collection time
silently SKIPs an out-of-tx violation instead of failing it; and "any call to any local import is a
mutation" false-FAILs `admin/labels/export/route.ts`). My fix reuses the exact same
`moduleContainsMutation`-gated, NOT-tx-scope-gated resolution, so neither wrong turn was
reintroduced — verified explicitly by re-running the FULL fixture suite (not just the two new
fixtures) plus the real-repo assertion that `admin/labels/export` still prints SKIP. (2) Confirmed
by grep that every real `import * as X` in `apps/control-plane/src/app/api/**/route.ts` is
`@sentry/nextjs` (a non-local package import) — my new branch only activates for LOCAL
(relative/`@/`-alias) imports, so this posed zero regression risk to the real repo, but I verified
it directly rather than assuming. (3) Gitleaks false positive, caught BEFORE pushing rather than
after a red CI run: downloaded the `gitleaks` binary locally and ran it against the new fixture
content in isolation. The FOLLOW-609 precedent's bypass-4 allowlist regex works because the bypass-4
base name (33 chars) is shorter than gitleaks' `[a-zA-Z0-9_-]{40}` capture window, so the full base
name is always a substring of the 40-char truncated match. My bypass-5 base name is 43 chars —
LONGER than the window — so the capture truncates to `bypass5-namespace-import-delegated-mutat`
(missing `ion`), and an allowlist regex requiring the full word "mutation" would have been silently
inert (a no-op regex, never flagged by any test, CI-green until an unrelated future gitleaks version
bump or line-shift changed the truncation offset and the leak resurfaced with no attribution to this
PR). Fixed by using a shorter prefix regex, and verified fixed with the same local binary before
committing.

**A guardrail I'd add:** when adding a gitleaks allowlist regex for a descriptive identifier ≥40
chars, always verify locally with the actual gitleaks binary (freely downloadable, no CI round-trip
needed) that the regex matches the ACTUAL truncated capture, not just the full identifier — the
capture window truncates non-anchored 40-char runs, and a regex written against the full string can
be a silent no-op if the identifier is longer than 40 chars. This is now the 2nd time a fixture
directory name for this exact guard has needed a gitleaks allowlist entry (bypass 4, bypass 5); a
3rd `bypass6-...` fixture pair should budget for the same check up front.

---

## 2026-07-21 / FOLLOW-609

**What I built:** Deduped the FOLLOW-596 byte-duplicated staff/agency `demo_overrides` write
(RETRO-193) by giving `demo-override-store.ts::upsertDemoOverride` an optional 4th `tx?: Database`
argument. The agency path calls it with no `tx` (unchanged); the staff path now delegates from
inside its own `db.transaction(async (tx) => {...})`, passing `tx as unknown as Database` (the
established cast pattern from `api/crm/outcome/route.ts`), so the upsert and the `staff_audit_log`
insert still commit/roll back atomically (ADR-0018 §3a). In the SAME PR, extended
`scripts/check-staff-write-atomicity.cjs` (the FOLLOW-608 AST guard) to recognise a bare call to a
locally-imported helper function as a mutation candidate — the PM's pre-dispatch verification
(session 46, RETRO-194) had already proven the as-shipped guard silently SKIPped this exact
delegated shape (zero enforcement, misclassified as audit-of-a-read), which would have made the
dedup regress atomicity coverage on `api/demo/override/route.ts` to nothing while CI still reported
"passed."

**Wiring/auth/fail-loud risks I weighed:** (1) My first guard-fix draft gated the new helper-call
detection on "is this call lexically inside a recorded tx scope" — this correctly OK'd the co-scoped
case but silently SKIPped (not FAILed) the out-of-tx violation case, which is the exact zero-
enforcement failure mode the ticket explicitly warned against ("FAILs it when the helper call sits
outside the transaction" is a named AC). Caught this myself by writing the out-of-tx throwaway
fixture BEFORE writing the permanent one, per the ticket's own red-first instruction. (2) My second
draft (any call to any locally-imported identifier is a mutation candidate, unconditionally) was
over-inclusive in the wrong dimension: it regressed `api/admin/labels/export/route.ts` — a genuine
audit-of-a-read/export route with zero `db.transaction()` calls — from a correct SKIP to a false
FAIL, because it imports several unrelated local helpers (`afterResponse`, `getSessionAuthClaims`,
`clickhouseAuthHeaders`). The existing test harness's real-repo assertion
(`assert_contains ... "SKIP: ... labels/export/route.ts"`) caught this immediately on re-run — a
concrete case of a pre-existing regression test earning its keep. Landed on: resolve the bare-call's
imported symbol to its source file, and only count the call as a mutation when THAT resolved module
itself performs a mutation (`moduleContainsMutation`, bounded depth 3, mirrors the existing
`findHelperFactoredAudit` bypass-2 resolution). This is module-level, not per-export, precision — a
known, documented, and deliberately accepted imprecision: a read-only sibling export co-located with
a mutating export in the same file (e.g. `getDemoOverride` beside `upsertDemoOverride`) is also
treated as a mutation candidate when called, but this can only ever push a file toward an
(survivable) false FAIL, never a false OK, so it stays safe under the "fail loud, never silently
pass" guardrail. (3) Ran the full existing fixture suite (10 pre-existing scenarios) after each
draft, not just the new ones — this is what surfaced both wrong turns before they shipped.

**A guardrail I'd add:** when hardening an AST-based CI guard's detection surface, always re-run the
FULL existing fixture/regression suite (not just the new fixture) after every draft of the fix — a
heuristic that closes one gap can silently open a different one in an unrelated existing case, and
that only shows up by re-running everything, not by reasoning about the new case in isolation.

---

## 2026-07-20 / FOLLOW-607

**What I built:** `scripts/check-staff-write-atomicity.sh` — a hard CI gate mechanically enforcing
ADR-0018 §3a: any control-plane route that both mutates data and inserts `staff_audit_log` MUST also
contain `db.transaction(`, else FAIL. Comments are stripped before matching (mirrors Rule H's node
one-liner) — without it a fixture whose _comment_ described "no transaction" false-passed. Refined
the heuristic beyond the ticket's literal spec: only flags files with an audit insert AND a
_separate_ data mutation, so the existing `admin/labels/export` route (audits an export action, no
data mutation) is correctly `SKIP`ped rather than a false positive that would have broken CI on
merge. Wired as a non-soft-skip CI job; proved red-first via 3 committed fixtures + a shell test
harness (`scripts/__tests__/check-staff-write-atomicity.test.sh`).

**Wiring/auth/fail-loud risks I weighed:** (1) This is tooling, not a route — no new schema/auth/DB
surface, so Rule H/mutating-endpoint-auth requirements don't apply here; documented that explicitly
in the PR evidence section rather than silently omitting it. (2) The naive "any file with
`insert(staffAuditLog)` needs `.transaction(`" heuristic from the ticket would have broken CI on the
real `admin/labels/export` route (audit-of-a-read, no data mutation) — caught this by running the
guard against the clean tree before committing, not after. (3) Fixture .ts files under
`scripts/__fixtures__/` tripped the repo's global `eslint.config.mjs` (`projectService: true`
type-checks every staged `.ts` regardless of package) via the pre-commit hook — added an ignore
entry mirroring the existing `apps/control-plane/scripts/**` precedent rather than fighting the
linter with `// eslint-disable`.

**A guardrail I'd add:** none — the exemption comment + SKIP/EXEMPT/FAIL three-way split already
covers the known edge cases (audit-of-read, single-write path, real violation).

---

## 2026-07-20 / FOLLOW-595

**What I built:** First staff WRITE port under ADR-0018 — `POST/GET /api/quiz/config` now resolve
auth via `resolveTenantAccess({ allowStaffOverride: true })`. POST adds a write-rank gate (staff
`canWrite`, rank ≥ ops → else 403) and appends one `staff_audit_log` row per successful STAFF write
(agency writes NOT audited). New minimal staff surface `/admin/tenants/[id]/quiz` (tenantExists →
notFound; minimal editor GET/POSTing `?tenant_id=` rather than extracting the agency client page,
which is coupled to a separate `/api/tenants/:id` toggle route with no staff port yet).

**Wiring/auth/fail-loud risks I weighed:** (1) Audit durability — chose mutate-then-await-audit; if
the audit insert throws, return a loud 500 (`audit_write_failed`) + Sentry rather than a silent
unattributed 200. Update is already applied; retry is idempotent (over-attribution safe,
under-attribution not). NEVER fire-and-forget (Vercel drops un-awaited writes). (2) Invariant-5 RLS
trap — service-role client bypasses RLS, so the `eq(tenants.id, access.tenantId)` fence is the only
boundary; the mandatory READ+WRITE tenant-filter tests key a stateful mock store on the value the
route actually binds (not a pre-filtered array, RETRO-187), red-first verified. (3) FOLLOW-603
option-wiring assertions (`toHaveBeenCalledWith` for `allowStaffOverride`/`minAgencyRole`) so a
future weakening edit fails a test.

**A guardrail I'd add:** A lint/grep that flags any route using `createAdminClient()` +
`db.update`/`db.insert` on a tenant table whose test file lacks a `updateWhere.val === tenantId`
style fence assertion — the invariant-5 leak is only ever caught by that specific test shape.

---

## 2026-06-26 / FOLLOW-405

**What I built:** Cross-package parity gate: `variant-index.parity.test.ts` imports the real
`@estalara/sdk` playbooks (no mock) and asserts `VARIANT_INDEX[v]` is in-range for every non-neutral
archetype's `variants.en[]`. Added order-pinning assertions for `SEED_VARIANTS[0]==='control'` and
`VARIANT_INDEX['control']===0`. Documented the stray-arm served=base/logged=raw contract in route.ts
AC-3 and updated the `@param variant` JSDoc to reference SEED_VARIANTS instead of a textual copy.

**Wiring/auth/fail-loud risks I weighed:** Test-and-comment-only PR — no production behavior
changed. Main risk was the parity test mocking the very data it was supposed to validate
(self-injection weakness). Mitigated by explicitly NOT mocking `@estalara/sdk/playbooks` and
confirming via the vitest alias config that the real source files are resolved. Had to mock
`@estalara/db` and `drizzle-orm` to allow `bandit-query.ts` module load (it imports those at the top
level), but that doesn't affect the SEED_VARIANTS constant.

**A guardrail I'd add:** The `@typescript-eslint/restrict-template-expressions` rule was a surprise:
`${number}` in template literals is disallowed by the project config. Future tests that need to
embed numbers in error messages should use `String()` wrappers proactively. Worth adding this
pattern to the coding standards note for test files.

---

## 2026-06-26 / FOLLOW-407

**What I built:** Applied Rule V (strip-the-superseded) to the consent endpoint gitleaks exemption.
Deleted the FOLLOW-374 file-wide `paths` entry for
`apps/control-plane/src/app/api/v1/consent/platform-registration/` in the `cloudflare-api-token`
rule's `[rules.allowlist]`, replacing it with a token-scoped `regexes` entry: the first 38 chars of
`CANONICAL_CONSENT_TEXT_HASH` (`a3f2e1d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9`), which sits within the
40-char `[a-zA-Z0-9_-]{40}` window that triggered the FP. Also fixed a copy-paste comment that
mentioned `route.ts` (adapt-route language) on a consent-endpoint exemption.

**Wiring/auth/fail-loud risks I weighed:** Config-only change — no TypeScript touched, no mutating
endpoint, no new schema. The only risk was accidentally removing a legitimate exemption or
mis-sizing the substring. Verified length in Python before writing. Confirmed "Archetype embeddings
not-NULL check" is pre-existing-red (also failing on merged PR #352) and not caused by this PR.

**A guardrail I'd add:** When a gitleaks `paths` exemption is added, a follow-up ticket stub should
be auto-generated to convert it to token-scoped within the same sprint. The current flow (FOLLOW-374
paths → FOLLOW-407 fix) took one full PR cycle. A linter that flags new `paths` entries on
non-doc/non-fixture paths at PR time would catch this immediately.

---

## 2026-06-27 / FOLLOW-425

**What I built:** `logDecisionAsync` in `apps/control-plane/src/app/api/adapt/route.ts` had a bare
`.catch()` on its fire-and-forget `fetch()`. That only catches network-layer rejections. ClickHouse
INSERT failures — auth Code 516, unknown column, quota, type mismatch — come back as 4xx/5xx HTTP
responses with `ok: false`; `fetch()` resolves normally so `.catch()` never fires. Added
`.then(async (res) => { if (!res.ok) { ... Sentry.captureException(..., { tags: { kind: 'insert_rejected' } }) } })`.
Existing `.catch()` now also calls `Sentry.captureException` with `kind: 'network'`. Fire-and-forget
semantics preserved throughout. Added three tests covering the HTTP-rejection, network-rejection,
and success (no Sentry) paths.

**Wiring/auth/fail-loud risks I weighed:** Pure observability change on an analytics write; no
effect on decision-grade response path, no auth change, no new schema. Two lint surprises: (1)
`@typescript-eslint/restrict-template-expressions` disallows `${number}` in template strings — fixed
with `String(res.status)`; (2) ESLint `require-await` fires on `async () => 'literal'` in test mocks
— fixed with `() => Promise.resolve(...)`.

**A guardrail I'd add:** The `restrict-template-expressions` rule is non-obvious and bites on every
error-message template that embeds a `number`. A project-level note (or IDE snippet) that says "wrap
numbers in `String()` inside template literals" would save one lint-fail cycle per PR.

---

## 2026-06-26 / FOLLOW-358

**What I built:** Closed a Rule K.1 violation — GET and POST `/api/adapt` were both writing to
`adaptation_decisions.page_context` (ClickHouse) with different derivation semantics: GET echoed the
caller-supplied `tier` URL param (1|2|3); POST derived a value via `pageContextFromPageType()`
(1|2). Added a ClickHouse discriminator column `page_context_source` (migration 0019,
`ADD COLUMN IF NOT EXISTS`, `DEFAULT 'legacy'`). Updated `logDecisionAsync` with a 15th optional
parameter and a JSDoc caller-inventory comment listing both call sites. Added 4 tests in
`route.clickhouse.test.ts` asserting GET→`'caller_supplied'` and POST→`'page_type_derived'`.

**Wiring/auth/fail-loud risks I weighed:** Option A (discriminator column) vs Option B (align GET to
derive from `page_type` too). Option B is cleaner long-term but changes the GET endpoint's contract
and discards historical data provenance; Option A is additive with zero contract change and zero
risk to existing callers. Chose Option A. ClickHouse `ADD COLUMN IF NOT EXISTS` is idempotent and
does not touch the ORDER BY key, so Rule W compliance was straightforward.

**A guardrail I'd add:** When a function is called from N places with optional parameter defaulting,
a per-call-site inventory comment in the function's JSDoc (as I added here) prevents future callers
from silently inheriting the wrong default. For `logDecisionAsync` the 15 positional parameters are
a smell; consider a typed options object so future callers can't pass the wrong value to the wrong
position. None new otherwise.

---

## 2026-06-26 / FOLLOW-361

**What I built:** Reconciled the bandit seed convention — `bandit-seed.ts` was seeding
`variant='default'` (18 rows/tenant) while `bandit-query.ts` lazy-seeded `control/v1/v2` (3 rows per
archetype on first request). Exported `SEED_VARIANTS` from `bandit-query.ts` as the single source of
truth, updated `bandit-seed.ts` to derive its list from the export (54 rows per tenant), added
migration 0031 to delete all `variant='default'` rows, and added a Rule K.1 parity test.

**Wiring/auth/fail-loud risks I weighed:** This ticket is a correctness fix (no new auth surface, no
new data store). The main wiring risk was the import path: Next.js webpack does NOT resolve `.js` →
`.ts` extensions the way Vitest/Vite does — using `'./bandit-query.js'` in production code caused
`Module not found` in the Next.js build while local Vitest passed (a green local test masked a CI
build failure). Fixed by using an extensionless import `'./bandit-query'` which both bundlers
resolve correctly.

**A guardrail I'd add:** When a production lib file imports another lib file in a Next.js project,
always use an extensionless relative path — never `.js`. The `.js` extension convention is for test
files (Vitest resolves it via Vite; webpack doesn't). A CI-enforced lint rule
`no-relative-js-extensions-in-src-lib` would catch this class of issue before push.

---

## 2026-06-26 / FOLLOW-397

**What I built:** Eliminated the third hardcoded variant list — `VARIANT_INDEX` in `route.ts` was a
manual copy of `SEED_VARIANTS`. Extracted derivation into a new `variant-index.ts` lib (Rule K.1:
single source), removed the `?? 0` silent coerce-to-control fallback, replaced it with an explicit
`variantIndex !== undefined` guard in copy selection. Added 6 AC-2 tests (Part A: unit assertions on
VARIANT_INDEX structure; Part B: integration with synthetic playbook where
`s.en !== s.variants.en[0]` to distinguish the two code paths).

**Wiring/auth/fail-loud risks I weighed:** Next.js prohibits non-handler named exports from route
files — exporting `VARIANT_INDEX` directly from `route.ts` caused a `tsc --noEmit` typecheck failure
via `.next/types/app/api/adapt/route.ts`. Solution: extracted `variant-index.ts` as a separate lib
file, imported in route.ts, and used that as the test import target. The 15 existing test mocks of
`@/lib/bandit-query` each needed `SEED_VARIANTS` added to prevent
`SEED_VARIANTS.map is not a function` at module load time.

**A guardrail I'd add:** Next.js route files should have a comment at the top stating "only handler
exports are allowed from this file." A lint rule checking that only
`GET/POST/PUT/DELETE/HEAD/OPTIONS/PATCH/dynamic/maxDuration/revalidate/fetchCache/runtime` are
exported from `app/**/route.ts` files would catch this at authoring time rather than at typecheck.

---

## 2026-06-29 / FOLLOW-434

**What I built:** Bounded the `seedListingEmbeddingsForActivation` after() budget. Added
`MAX_INLINE_SEED = 50` constant (50 × 200ms = 10s, 5s headroom under Vercel Hobby 15s limit).
Overflow listings are NOT silently dropped — captured to Sentry via `captureMessage` +
`console.warn` with full `overflow_listing_ids` for operator retry. Implemented
`extractListingIdsFromSchema` to actually parse `schema.listing_ids` (the forward-compat hook it
documented but never executed). Updated JSDoc at line 10 to remove stale "void fn()" claim and
document the cap. Added activate route budget comment referencing both FOLLOW-432 and FOLLOW-434.
Added 2 new describe blocks: one testing the `listing_ids` forward-compat path
(extractListingIdsFromSchema), one testing the overflow cap (MAX_INLINE_SEED+1 listings → exactly
MAX_INLINE_SEED fetch calls + Sentry captured).

**Wiring/auth/fail-loud risks I weighed:** (1) Overflow path must NEVER silently discard listings —
chose Sentry `captureMessage` (observable in prod dashboards) + `console.warn` (observable in Vercel
logs). The `TODO: FOLLOW-434 — replace with Modal job` comment makes the deferred work clearly
visible. (2) ES module test limitation: `vi.spyOn(module, 'embedOneListing')` cannot intercept
same-module internal calls — the spy replaces the export binding but not the in-closure reference.
Used `vi.stubGlobal('fetch', ...)` instead (equivalent: each `embedOneListing` call makes exactly
one `fetch` call). Injected 51 listings via `schema.listing_ids` (newly implemented
`extractListingIdsFromSchema`). (3) `DEMO_LISTING_MANIFEST` is a getter-only property on the module
namespace; trying to reassign it with `(module as any).DEMO_LISTING_MANIFEST = ...` throws
`TypeError: Cannot set property ... which has only a getter`. Never mutate module namespace objects.

**A guardrail I'd add:** A comment in the test file near any `vi.spyOn(module, 'exportedFn')`
stating "this spy intercepts external callers only, not same-module internal calls — use
vi.stubGlobal/fetch mock for internal call coverage." Would prevent the next engineer from writing a
test that silently passes because the spy was never hit.

---

## 2026-06-29 / FOLLOW-432

**What I built:** Swept 6 request-path fire-and-forget sinks into `afterResponse()` (Rule K.2).
Sinks: `seedListingEmbeddingsForActivation` ×2 in activate route, `redisSet` in `tenant-schema.ts`,
Redis warm-up IIFE + `insertPgCachedDescription` in description route, `checkPilotFrozenAsync` inner
IIFE in adapt route, and `auditCorpusExport` in admin labels export (found by AC grep sweep, outside
the original 5 named sinks). Added 2-case direct unit test for `after-response.ts`. Corrected
FOLLOW-431 AC-1 wording.

**Wiring/auth/fail-loud risks I weighed:** (1) Seed-embeddings judgement call: sequential loop of 12
HTTP calls × ~200ms = ~2.4s fits within Vercel `after()` budget (15s Hobby / 60s Pro); real tenants
are no-ops. Correct to use `afterResponse()`, documented in a code comment. (2) `tenant-schema.ts`
is a shared library — importing `after-response.ts` there adds a Next.js-specific dependency;
acceptable because the only callers are route handlers (request scope), and the fallback in
`afterResponse` handles non-request callers (unit tests). (3) `checkPilotFrozenAsync` was already
declared as fire-and-forget observability; wrapping in `afterResponse` is strictly a completeness
fix with no behavior change. (4) The admin labels export sink was not in the original ticket's
5-sink list but was caught by the AC grep; including it avoids a future retro gap.

**A guardrail I'd add:** An ESLint rule (or `check-rule-h.sh` extension) that flags
`void (async () => {...})()` and `void somePromise` outside `afterResponse()`/`ctx.waitUntil()` in
Next.js route files and shared libs would catch new violations at authoring time rather than at
retrospective time. The grep-based AC is good but runs only at PR merge; a lint gate runs on every
save.

---

## 2026-06-02 / DEMO-001

**What I built:** Per-tenant DEMO MODE archetype + model override. New `demo_overrides` table
(migration 0017), `GET/PUT /api/demo/override` (JWT-gated, Zod-validated), override wired into
`POST /api/adapt` (replaces `archetype_hint` with chosen archetype at high confidence), description
endpoint keyed cache by model to bust on model switch, `forceModel` param added to `callLlmGateway`,
admin UI at `/dashboard/demo/override` with toggle + dropdowns.

**Wiring/auth/fail-loud risks I weighed:**

1. **Rule K.2 on the adapt route:** When `getDemoOverride` throws (configured DB, connection
   refused), I degrade to the SDK hint rather than failing the response — this is correct because
   the adapt endpoint is decision-grade but the override is an _additional_ operator intent layer.
   The degradation is logged loudly and `demo_override` flag is absent from response, making
   provenance observable on the wire.

2. **Rule K.2 on the description route:** Same fail-open treatment — if the DB throws when checking
   DEMO MODE for the description cache key, we use the standard key. This is the right call: the
   worst outcome is a cache miss, not wrong data.

3. **Rule H for the `override_model` event field:** Added `override_model?: string` to
   `DescriptionRequestedEvent` in `@estalara/shared`. Non-test consumer is the description route
   itself (it writes the field to the Redpanda event). ML-engineer consuming it in the Modal job is
   FOLLOW-166 (explicitly deferred with stub).

4. **Auth on the PUT endpoint:** `requireTenantAccess(req, 'agency:admin')` using verified JWT,
   tenant_id taken from JWT claims (never from request body), same commit as the endpoint. Satisfies
   Rule H auth-in-same-PR.

5. **The double `getDemoOverride` call in the adapt route:** I called it twice in the treatment arm
   (once to check enabled, once to get the archetype). Flagged as a risk but acceptable given the DB
   call is fast + the alternative (threading the whole state across try/catch blocks) was harder to
   reason about. A refactor to call it once would reduce DB load.

**A guardrail I'd add:** The adapt route should propagate `demo_override` through to the Redpanda
`ab.assignment` event so the data-engineer can also exclude demo traffic at the event level, not
just at the ClickHouse analytics query level.

---

## 2026-06-03 / FOLLOW-161

**What I built:** Global admin-selectable LLM generation model. New `app_config` global key-value
table (migration 0018), `getGlobalGenerationModel()`/`setGlobalGenerationModel()` helpers,
`GET/PUT /api/admin/generation-model` (agency:admin JWT), `/dashboard/settings` page with model
picker + cost/latency hints table, wired `llm-gateway.ts` full-generation path to use global model
(Haiku tweak path stays Haiku), `description/route.ts` threads `generation_model` into event
payload + keys standard cache by active model, `_resolve_generation_model()` extended with
`generation_model` param in Python job.

**Wiring/auth/fail-loud risks I weighed:**

1. **Precedence chain integrity:** DEMO override_model > global generation_model > default. Verified
   in both TypeScript (description route builds the event, llm-gateway uses forceModel first) and
   Python (\_resolve_generation_model now takes both params, override_model wins if allow-listed).
   End-to-end tests cover all 3 priority levels.

2. **Rule K.2 on global config read:** `getGlobalGenerationModel()` distinguishes "DB not
   configured" (returns default — OK for dev/CI) from "DB configured but threw" (throws, forces
   caller to decide). The description route catches-and-defaults on the throw, keeping the endpoint
   fail-open for non-critical path. The admin GET/PUT routes surface 500 on DB failure.

3. **AC5 cache key:** Standard path now appends `:${globalModel}` suffix so switching global model
   busts the cache. DEMO path already had `:demo:${model}` suffix — kept as-is. Important: the old
   standard cache key format was `desc:{t}:{l}:{a}:{locale}` (no model suffix). Any existing Redis
   entries written before this PR will miss on the new key (desired behaviour — they'll regenerate
   with the correct model).

4. **Rule H for `generation_model` event field:** Added `generation_model?: string` to
   `DescriptionRequestedEventSchema` in `@estalara/shared`. Non-test consumer is
   `apps/control-plane/src/app/api/adapt/description/route.ts` (same PR). Python consumer is
   `_resolve_generation_model()` in same PR.

5. **Tier 1 short-circuit moved earlier:** Discovered that the Tier 1 early return was placed after
   the DB calls (DEMO check + global model read). Moved it before both DB calls so Tier 1 stays O(0)
   DB calls. Test caught this regression.

**A guardrail I'd add:** The `app_config` table has no RLS and no rate-limiting on the admin write
endpoint — a rogue agency:admin could change the model rapidly. Adding a per-minute rate limit on
the PUT would prevent accidental or malicious thrashing. Currently not a priority since it's a
single global write.

---

## 2026-06-03 / FOLLOW-179

**What I built:** UNIQUE constraint on `conversion_labels(tenant_id, prediction_id)` + validated
upsert helper (`upsertConversionLabel`) that applies a class-precedence policy (source dominance +
funnel finality) via `INSERT ... ON CONFLICT DO UPDATE WHERE <rank CASE>`. Replaced the plain
`db.insert()` in the feedback route. Added `conversionLabelRank()` as the TS-layer single source of
truth for the same ordering.

**Wiring/auth/fail-loud risks I weighed:**

- The `onConflictDoUpdate` WHERE clause embeds SQL rank constants that must stay in sync with the TS
  `OUTCOME_CLASS_RANK` map; documented the sync requirement in the code but there is no automated
  enforcement — a future class addition that updates only one side would silently mismatch. This is
  a potential future Rule O-style gate candidate.
- Adding `@estalara/shared` as a dep to `@estalara/db` is the first cross-package import in the db
  layer; vitest config needed an explicit alias because `@estalara/db` previously had no
  inter-package deps and no alias setup.
- The `upsertConversionLabel` helper deliberately does NOT set `app.current_tenant_id` — it uses the
  admin client (which bypasses RLS), matching the existing pattern. Any future caller that wants RLS
  enforcement must use a tenant client instead; this should be documented explicitly to prevent
  misuse.

**A guardrail I'd add:** A CI check that asserts the SQL rank CASE values in
`upsert-conversion-label.ts` are byte-identical to the TS constants in `conversion-label.ts` —
preventing the two from drifting when a new outcome class is added. Pattern analogous to Rule J
mirror checks.

---

## 2026-06-06 / FOLLOW-193

**What I built:** DSR engagement_scores erasure (DPIA §8 line 773 compliance gap) + Vercel cron
restore stub (deployment gated on CEO Q3 Vercel Pro confirmation). Added `engagement_scores` Drizzle
schema (migration 0021, RLS), exported from `@estalara/db`, imported into the DSR erase route and
deleted inside the existing transaction for atomicity. Three new integration tests cover AC3 (delete
issued), AC4 (row absent after), and atomicity (same transaction call as session_embeddings). Cron
block added to `vercel.json` noting the Vercel Pro gate.

**Wiring/auth/fail-loud risks I weighed:**

- The `engagement_scores` delete is inside the Drizzle `db.transaction()` — if it fails, the whole
  transaction rolls back and no partial erasure escapes. Important because a partial Postgres erase
  (session_embeddings deleted, engagement_scores left) is a GDPR Art. 17 gap that no external signal
  would surface.
- The cron block in `vercel.json` is real config — if CEO confirms Q3 and someone deploys before
  reading the PR comment, the cron activates. Mitigated by the explicit code comment and PR
  description gate warning.
- Rebuilding the db package before committing is required when a new schema file is added — ESLint
  needs the dist `.d.ts` files to resolve types for the control-plane. Without the rebuild, ESLint
  fails with "Unsafe member access" on the new table's columns.
- `git stash`/`git stash pop` across branches is dangerous: it can silently drop or revert staged
  changes. Prefer committing to a WIP commit rather than stashing when switching context.

**A guardrail I'd add:** A CI check that scans the DPIA §8 "erasure cascade" table and asserts each
listed table has a `tx.delete(table)` call inside `erase/route.ts`. Would catch future tables added
to the DPIA but forgotten in the code — the same gap that made this ticket necessary.

---

## 2026-06-07 / FOLLOW-204 (lint-fix pass)

**What I built:** Fixed TypeScript lint errors on the FOLLOW-204 branch
(`description_cache_persistent` + `quiz_completions` MOAT tables). Three categories of fix: (1)
`@estalara/db` dist was missing `.d.ts` for the two new schema files — solved by running
`pnpm --filter @estalara/db build` first, then adding `Pick<DescriptionCachePersistent,...>[]` type
annotations to Drizzle query results; (2) removed an unused `insertPgCachedDescription` import in
the internal route (replaced by the strict wrapper defined in the same file); (3) removed
unnecessary `?? new Date()` on a `notNull().defaultNow()` column. Then caught two more CI failures
post-push: Next.js 15 rejected named non-handler exports from a Route file
(`QuizCompletionBodySchema`, `QuizCompletionBody`, `QuizCompletionResponse` — removed `export`); and
migration journal entry 0023 had a drizzle-kit year-drift timestamp (2025 instead of 2026) violating
the monotonicity check.

**Wiring/auth/fail-loud risks I weighed:** No logic changes — purely type annotation and export
scope fixes. The `DescriptionCachePersistent` type import (via `type` keyword) satisfies ESLint's
`consistent-type-imports` rule and gives the Drizzle query result arrays proper structural typing so
`no-unsafe-member-access` passes without suppression comments.

**A guardrail I'd add:** Always run `pnpm --filter @estalara/db build` before linting any package
that imports `@estalara/db` with new schema files — the dist `.d.ts` files must be current or every
Drizzle column access is typed as `any`. Add this to the pre-lint CI step order or to a local dev
`prepare` script.

---

## 2026-06-07 / FOLLOW-203

**What I built:** Removed tier logic and TTL from the description generation route. `tier` dropped
from Zod schema, Tier-1 early-return removed, `TTL_TIER2_SECONDS`/`TTL_TIER3_SECONDS` deleted, Redis
SET no longer passes `EX`, `max_tokens` set to single constant 500. `tier`/`ttl_seconds` made
optional+deprecated in shared `DescriptionRequestedEventSchema` (Python consumer uses `.get()` with
defaults so omitting is backward-safe). All tests updated.

**Wiring/auth/fail-loud risks I weighed:** Auth block is unchanged (same Bearer JWT + ADAPT_API_KEY
constant-time compare). Fail-loud behavior unchanged: getCachedDescription is fail-open returning
null → template_fallback (not a fabricated number, and this endpoint doesn't serve a primary
go/no-go metric). The Python consumer (ml-engineer owned) already had
`event.get("ttl_seconds", default_ttl)` so making `ttl_seconds` optional in the TypeScript type is
safe without touching the Python code.

**A guardrail I'd add:** Never use `git stash` when switching branches mid-session with multiple
parallel branches active — it creates cross-branch contamination. Instead, commit a WIP commit or
use `git worktree`. The stash pop on the first branch checkout brought in sdk-engineer FOLLOW-201
files that polluted the FOLLOW-203 commit, requiring a cleanup commit.

---

## 2026-06-07 / FOLLOW-205

**What I built:** Replaced presence-only Bearer check in POST /api/adapt with real HS256 JWT
verification using `crypto.subtle` (Web Crypto API, built into Node.js 15+). Extracted verification
logic into `src/lib/demo-jwt-verify.ts` with two error types (`DemoJwtSecretMissingError`,
`DemoJwtInvalidError`). Invalid/expired/missing token → 401 `{ error: 'invalid_demo_token' }`.
Secret not configured → 500 `{ error: 'demo_auth_misconfigured' }`. Six new unit tests cover
AC1/AC2/AC3 plus wrong-secret and missing-secret paths. Updated 5 existing adapt test files to mock
`verifyDemoJwt` so non-auth tests keep working.

**Wiring/auth/fail-loud risks I weighed:**

1. **Dependency constraint:** Ticket spec said `jose` was already installed — it wasn't (not in any
   `package.json` or `node_modules`). Used `crypto.subtle` instead, which is available in the
   existing runtime with zero new dependencies. Rule P satisfied.
2. **TypeScript strict-mode:** `token.split('.')` returns `string[]` so destructured elements have
   type `string | undefined` even after `parts.length !== 3` guard. Used explicit
   `parts[0] as string` casts with a comment explaining the post-check guarantee.
   `Uint8Array<ArrayBufferLike>` vs `BufferSource` required `.buffer as ArrayBuffer` cast for the
   `crypto.subtle.verify` call.
3. **Secret misconfiguration vs bad token:** Separated `DemoJwtSecretMissingError` (500 — ops alert)
   from `DemoJwtInvalidError` (401 — client error). Any other error rethrows (uncaught 500). This
   distinction matters: a missing secret in prod is a deployment config error, not an auth failure.
4. **Existing test isolation:** All 5 existing POST adapt test files used arbitrary Bearer strings.
   Mocking `verifyDemoJwt` in those files keeps them focused on their own behavior (holdout, demo
   override, variant, etc.) without coupling them to the auth path.

**A guardrail I'd add:** A linter rule (or CI grep) that flags any
`req.headers.get('Authorization')` in POST handlers that is NOT followed by a cryptographic
verification call within 10 lines — would have caught the presence-only check years earlier.

---

## 2026-06-07 / FOLLOW-206

**What I built:** Unified ClickHouse SQL string escaping from backslash (`\\'`) to ANSI SQL `''`
doubling in two files: `apps/control-plane/src/app/api/adapt/route.ts` (`logDecisionAsync`) and
`apps/control-plane/src/lib/llm-gateway.ts` (`logLlmCallAsync`). Both now match the canonical
pattern in `clickhouse-dsr.ts:99`. No logic change — fire-and-forget INSERT helpers only.

**Wiring/auth/fail-loud risks I weighed:**

1. **Working-tree confusion:** The session started on `sdk-engineer/FOLLOW-209` branch. After
   `git checkout main` and branching, the working tree appeared correct but `grep` from a later Bash
   call showed the old pattern — because the shell had momentarily been on the wrong branch. Always
   verify `git branch` and `grep` on the ACTIVE branch before concluding a fix didn't apply.
2. **Pre-existing Python CI failures:** All `Test (Python)` checks fail due to `pip install`
   timeouts (infrastructure issue, not code). Confirmed by log showing "operation canceled" during
   dependency install. Real gates (Node 22, Typecheck, Lint, Format, Rule H/J, Build, Vercel) all
   green. Documented in `project_ci_gate_landscape.md`.
3. **Scope boundary:** Only ClickHouse raw-SQL paths were changed. Drizzle/Postgres paths use
   parameterized queries and needed no escaping fix.

**A guardrail I'd add:** A CI grep asserting `replace.*\\'` returns zero results in
`apps/control-plane/src/` — would catch any future copy-paste of the non-standard pattern before it
reaches main.

---

## 2026-06-08 / FOLLOW-174

**What I built:** Admin label management surface: `GET /api/admin/labels` (joined
`conversion_labels ⋈ adaptation_decisions`, paginated, filters: outcome_class / date_from / date_to
/ model_version / tenant_id-for-staff), `PATCH /api/admin/labels/[id]` (manual reclassification →
`label_source=manual_admin` + notes + updated_at), dashboard page
`/dashboard/analytics/labels/page.tsx` (filterable table + calibration view from FOLLOW-173). Route
tests: 17 cases covering auth gates, mock fallback, fail-loud 500 (Postgres + ClickHouse),
cross-tenant guard, PATCH success + write-to-upsertConversionLabel verification.

**Wiring/auth/fail-loud risks I weighed:**

1. **Rule H (same-PR auth for PATCH):** JWT-verified via `getAuthClaims` + HMAC-SHA256
   `crypto.subtle`. Role gate: staff ≥ estalara:ops OR agency ≥ agency:owner. Tenant ID always
   sourced from JWT, never from body. Cross-tenant write blocked by re-reading the row's tenant_id
   and comparing before any write. Replay defence: Supabase JWTs carry `exp`, verified on each call.
2. **Rule K.2 — fail loud vs fail open:** Both GET and PATCH return HTTP 500 + Sentry when a
   configured store fails (not a mock fallback). GET falls back to mock ONLY when both
   `DATABASE_URL_ADMIN` and `DATABASE_URL_DIRECT` are unset (dev/CI) — exposed as
   `data_source: 'mock'` so the page renders a visible badge. PATCH returns 503 (not mock) when DB
   is absent.
3. **ClickHouse join guard:** The `decisionIds` -> ClickHouse IN() list validates each ID against
   `/^[0-9a-f-]+$/i` (UUID-safe chars) before embedding in the parameterised query. No user-supplied
   values reach the SQL literal. Caught a test bug where `prediction_id: 'pred-001'` silently
   skipped the CH fetch (non-hex chars filtered out) — fixed by using a UUID-shaped mock ID.
4. **No shared type redeclaration:** Page imports canonical types from route-helpers, not inline
   re-declarations. Closes the drift pattern in RETRO-005/008/013/015.

**A guardrail I'd add:** A CI gate that verifies the ClickHouse IN-list validation regex is present
in every route that builds a CH `IN (...)` from a server-side ID list — prevents a future path that
skips the hex-chars filter and silently allows non-UUID IDs into the query string.

---

## 2026-06-08 / FOLLOW-184

**What I built:** Closed the GDPR Art. 17 DSR erasure gap for CRM-written `conversion_labels` rows.
Added `durable_lead_id` (nullable text) column to `dsr_verifications` (migration 0024) so the tenant
admin can supply the CRM opaque token at DSR initiation time. Extended the erase route with Pass B:
`DELETE conversion_labels WHERE lead_id = durable_lead_id` (runs only when
non-null/non-empty/differs from session_id). Updated `dsr/initiate` to accept and store the optional
`lead_id` field. 8 PG-harness integration tests (PGlite) in
`packages/db/src/__tests__/dsr-crm-erasure.test.ts` prove all ACs against real SQL semantics. 3 new
mock-layer tests in `erase/route.test.ts` verify Pass B behavior. Updated `docs/ops/DSR_ALERTING.md`
and `docs/MASTER_DESIGN.md §T.6` with the identifier-resolution model.

**Wiring/auth/fail-loud risks I weighed:**

1. **Two identifier namespace problem:** The core gap was that session_id and CRM lead_id are in
   completely different namespaces. The cleanest solution without FOLLOW-180 (durable lead_id full
   wiring) is to capture the CRM token at DSR initiation time — the tenant admin initiating the DSR
   knows it. This avoids any cross-table join and keeps the erase path O(1) per pass.
2. **LG-2 guard preserved:** Both Pass A and Pass B gate on `lead_id <> ''` at both application
   layer (empty-string check before DELETE) and DB layer (ne() predicate). The empty-key guard is
   critical — without it, a blank lead_id would erase ALL system labels for the tenant.
3. **Dedup guard:** When `durable_lead_id === session_id`, Pass B is skipped — Pass A already
   covered those rows. Prevents a harmless double-delete but keeps invariant clarity.
4. **No mutation-only endpoint added:** This is a change to an existing DSR flow — auth is already
   production-grade (OTP-verified for erase, JWT-verified for initiate). Rule H amendment satisfied
   because no new auth surface was added.
5. **PG-harness vs mock tests:** The PGlite harness tests prove real SQL semantics (the
   `AND lead_id <> ''` guard actually works in SQL, not just conceptually). The mock tests prove
   Pass B logic at the route level. Both layers are needed — the LG-1 gap from RETRO-031 originally
   shipped green because mocks proved the DELETE was issued, never that it matched the right rows.
6. **FOLLOW-180 dependency:** Since FOLLOW-180 (durable lead_id end-to-end) is OPEN, this PR
   gracefully handles the case where no `durable_lead_id` is supplied (NULL = only Pass A runs, safe
   fallback for SDK-only sessions).

**A guardrail I'd add:** A CI grep that asserts both Pass A AND Pass B delete patterns are present
in `erase/route.ts` — if a future refactor removes Pass B (e.g., merging passes), the grep would
catch the regression before CI allows the commit. Similarly, a DPIA-driven CI check that verifies
every identifier namespace documented in §T.6 has a corresponding DELETE pass in the erase route.

---

## 2026-06-08 / FOLLOW-239

**What I built:** Art. 17 CRM erasure completeness check — closes the silent-incompleteness gap from
RETRO-042. In `dsr/erase/route.ts`, after the main transaction completes, if `durable_lead_id` was
NULL (Pass B skipped), run a count query for surviving CRM-namespace `conversion_labels` rows
(lead_id != '' AND lead_id != session_id). If > 0, emit a Sentry warning + ClickHouse audit entry
with `action = 'incomplete_erasure_crm_rows_detected'` + return
`crm_erasure_status: 'incomplete_no_durable_lead_id'` in the 200 body (observable on the wire). When
Pass B ran or no CRM rows exist, return `crm_erasure_status: 'complete'`. Extended PGlite tests
AC-7/8/9 prove the SQL predicate detects surviving rows, yields no false positives, and returns 0
after a complete erasure. Created `docs/compliance/DSR_ALERTING.md` with operator procedure for
obtaining the durable token and re-running. Updated `docs/MASTER_DESIGN.md` §T.6 with the residual
operator-dependency note (RETRO-042 DG-2).

**Wiring/auth/fail-loud risks I weighed:** Path (b) — alert/audit — is the correct choice because
path (a) (auto-resolver) would require a new DB table and migration; path (b) closes the GDPR Art.
17 observability gap immediately without adding a writable surface. The count query is read-only
after an already-authenticated DSR transaction commits — no new auth surface introduced. The
`crm_erasure_status` field on the 200 body is the observable provenance signal (Rule K.2).

**A guardrail I'd add:** An integration test that mounts the full `POST /api/dsr/erase` route and
asserts the HTTP response body contains `crm_erasure_status: 'incomplete_no_durable_lead_id'` when
CRM rows survive — a route-level test would catch a regression where the count result is not plumbed
into the response field. This is FOLLOW-240's scope (round-trip integration test).

---

## 2026-06-08 / FOLLOW-238

**What I built:** Fixed the tenant-vs-subject scope over-claim in the FOLLOW-239 CRM erasure
completeness check. (1) Changed the status value from `incomplete_no_durable_lead_id` to
`crm_tenant_unverifiable` with a Sentry/audit message explicitly framed as a tenant-capability
warning, not a subject-completeness claim — the count query is tenant-scoped; we cannot prove which
rows belong to the erased subject. (2) Changed the count-query catch-block to emit
`crm_erasure_status: 'unverified'` instead of leaving it as `'complete'` (Rule K.2 — never claim
complete when the configured store threw). (3) Extracted all DSR audit action literals to a shared
`DSR_AUDIT_ACTIONS` const + `DsrAuditAction` type in `_clickhouse.ts`, and updated all four DSR
route callers. (4) Added three tests: two for AC1 (tenant has zero CRM rows → complete; Pass B ran →
complete), one for AC2 (DB throws → unverified). Updated `docs/ops/DSR_ALERTING.md §2` with the new
three-value status table and corrected semantics. Also added `DSR_AUDIT_ACTIONS` to the
`_clickhouse` mock in `dsr-routes.test.ts` to unblock the broader DSR test suite.

**Wiring/auth/fail-loud risks I weighed:** No new DB writes or auth surfaces — all changes are in
the read path of an already-authenticated route. The key risk was the RETRO-041 false-positive
pattern: every DSR erase on a CRM-integrated tenant was claiming incomplete when the query couldn't
substantiate that claim. Rule K.2 (fail-loud, not fabricate) applies in both directions: don't claim
incomplete when you can't prove it, and don't claim complete when the DB threw.

**A guardrail I'd add:** A shared-const parity test between `DSR_AUDIT_ACTIONS` in `_clickhouse.ts`
and the mock objects in the two test files — if someone adds a new action to the const but forgets
the mocks, the type system catches it at call sites but not at mock definition time.

---

## 2026-06-08 / FOLLOW-184 close-out

**What I built:** Confirmed and formally closed out FOLLOW-184 (DSR Art. 17 CRM erasure gap). The
implementation (PR #233) was already merged to main. This PR updates `backlog/FOLLOW_UPS.md` (status
OPEN → DONE, AC checkboxes checked, approach_chosen documented) and `backlog/QUEUE.md` (status READY
→ DONE, pr + merged_at recorded). Approach chosen was Option A: `dsr/initiate` accepts optional
`lead_id` stored as `dsr_verifications.durable_lead_id` (migration 0024); `dsr/erase` reads it and
runs Pass B in the same transaction. HANDOFFS.md FOLLOW-172 condition 7 satisfied.

**Wiring/auth/fail-loud risks I weighed:** None new — this is a bookkeeping-only PR. The
implementation PR #233 was the risk-bearing change.

**A guardrail I'd add:** When a ticket is implemented in a sub-PR (PR #233 here) but the originating
branch name doesn't match the ticket spec, there is a risk the PM delegates the ticket again
assuming it is still open. Backlog entries (FOLLOW_UPS.md + QUEUE.md status) should be updated
atomically in the same PR as the implementation, not in a follow-up bookkeeping PR. Rule: any PR
closing a FOLLOW ticket MUST update FOLLOW_UPS.md status field in the same commit.

---

## 2026-06-08 / FOLLOW-246

**What I built:** Wired `conversion_labels` reads into `dsr/access` and `dsr/portability` on both
identifier namespaces (session_id Pass A + durable_lead_id Pass B). Mirrored the erase route pattern
exactly. Updated §T.6, DSR_ALERTING.md §access/§portability, FOLLOW_UPS.md. 6 new tests.

**Wiring/auth/fail-loud risks I weighed:**

- Both routes are read-only GETs — no new mutation surface, no new auth needed.
- DB errors propagate unhandled → 500 (no catch block swallowing to empty). Rule K.2 satisfied.
- `outcome_raw` deliberately excluded from disclosure — it may contain CRM payload structures; a
  compliance decision is needed before including. Noted in PR description for compliance-engineer.

**A guardrail I'd add:** When a new column/table/route is added that touches the DSR data inventory,
a CI check should verify the corresponding DSR verb (access, erase, portability) all cover it.
Currently the symmetry gap (RETRO-044 LG-1) was caught only by retrospective analysis — not by any
automated check. A "DSR coverage matrix" CI script asserting that every table in the erasure cascade
is also in the access/portability query list would catch this class of gap at PR time.

---

## 2026-06-09 / FOLLOW-250 + FOLLOW-256

**What I built:** Route-driven PGlite integration tests for CRM write + DSR erase + DSR access + DSR
portability handlers. New test files: `crm/outcome/route-driven-pglite.test.ts` (AC1 CRM write + AC3
two-writer convergence), `dsr/erase/route-driven-pglite.test.ts` (AC2 erase Pass A + B + OTP
validation + crm_erasure_status), `dsr/disclosure-route-driven-pglite.test.ts` (AC1 both-namespace
disclosure + AC2 tenant isolation + AC3 access/portability parity). Added `@electric-sql/pglite` to
control-plane devDeps. Labeled existing `runEraseTransaction` + `runDisclosureRead` SQL-semantics
mirrors per Rule T.

**Wiring/auth/fail-loud risks I weighed:**

1. **Rule T compliance mechanism:** Imported the actual route handlers (not re-typed helpers) and
   mocked `createAdminClient()` with a lazy factory (`getTestDb()`) that returns the PGlite-backed
   Drizzle client. This puts the production WHERE clauses on the call-stack — any divergence breaks
   tests.
2. **Erase route complexity:** The erase route touches 6 tables + Redis + ClickHouse. Used unset env
   vars (`UPSTASH_REDIS_URL`, `CLICKHOUSE_URL`) to trigger the built-in no-op code paths for those
   external deps; `vi.mock('@/lib/clickhouse-dsr')` made `readClickHouseConfig()` return null which
   triggers the built-in no-op branch that inserts 'done' rows to `dsr_clickhouse_mutations` (valid
   test behavior, not fabricated data).
3. **PGlite environment:** The control-plane vitest defaults to `jsdom`. Used
   `@vitest-environment node` per-file docblock for the PGlite tests. PGlite is WebAssembly and
   needs the Node runtime.
4. **session_embeddings vector column:** The route does `SELECT *` from session_embeddings including
   the `embedding vector(1024)` column. Defined it as `text` in the fixture DDL (PGlite has no
   pgvector); also included all other columns (`similarity_score`, `signal_count`, `quiz_archetype`)
   to avoid "column does not exist" errors from the route's SELECT \*.

**A guardrail I'd add:** The `@vitest-environment node` docblock is a per-file override but easy to
forget when adding new PGlite tests to a package that defaults to jsdom. A CI check or lint rule
that validates any test file importing `@electric-sql/pglite` has the `@vitest-environment node`
docblock would prevent silent test-skip scenarios where PGlite init fails and all tests are marked
"skipped" instead of "failed".

---

## 2026-06-10 / FOLLOW-263

**What I built:** Repointed the pilot-freeze guard (`checkPilotFrozenAsync`) from JSONB
`quizConfig.enabled` (legacy) to the typed boolean column `tenants.quizEnabled` (SoT per FOLLOW-102
/ migration 0025). Updated `route.pilot-frozen.test.ts` with 7 tests covering AC1–AC4 (typed column
read proven by mock shape, on/off states, mid-window state changes, non-blocking guarantee).

**Wiring/auth/fail-loud risks I weighed:**

1. **Silent regression pattern (RETRO-049):** The guard was observability-only but still had
   correctness: it was reading from the wrong store. The fix was purely a column swap in the SELECT
   — no auth or data flow changes. The risk was that "it still compiles and tests pass" could mask
   the bug. The test mock is now shaped to ONLY expose `quizEnabled` (not `quizConfig`) — if the
   route selected the wrong field it would get `undefined` and the guard would be silent, failing
   the positive-case assertion. This is the correct self-validating test design.
2. **Legacy comment discipline (Rule H):** After the fix, `quizConfig` JSONB still exists on the
   tenants table. Added explicit comments in the guard saying "do NOT use quizConfig.enabled for
   freeze-guard decisions" to prevent future regression. This is the Rule H obligation for a
   dead-read that can't be fully removed yet (the column stores other quiz configuration that is
   still read).
3. **Fire-and-forget observability contract:** The guard is non-blocking. The fix preserves this
   contract — the select now targets a different field but never blocks the response.

**A guardrail I'd add:** A lint rule or CI check that detects reads of `tenants.quizConfig` in files
that also read `tenants.quizEnabled` and emits a warning: "these two fields have different SoT
semantics — double-check you're not mixing quiz-enabled state from the legacy JSONB with the typed
column." Would have caught RETRO-049 at PR time instead of needing a RETRO cycle.

---

## 2026-06-11 / FOLLOW-270

**What I built:** Extracted the hand-duplicated `QuizConfig` interface (which had drifted:
`route.ts` had `language: 'en' | 'pl' | 'es'`, `page.tsx` had `language: 'en' | 'pl'`) into a single
canonical definition in `packages/shared/src/schemas/quiz-config.ts`. Both files now import from
`@estalara/shared`. Added `QUIZ_LANGUAGE_VALUES` tuple to drive the dashboard `<select>` tag so
adding a future locale is a one-file change. Added parity tests (enum coverage, Zod accept-all,
reject-unknown, route handler end-to-end for `'es'`).

**Wiring/auth/fail-loud risks I weighed:** No mutation surface or auth change. The only risk was
introducing an import cycle (packages/shared → apps/control-plane → packages/shared); confirmed safe
because the import is packages → apps (unidirectional). Also confirmed the shared package must be
built before control-plane typecheck sees the new exports (`dist/` is gitignored; CI build step
handles it).

**A guardrail I'd add:** When a `packages/shared/src/schemas/` file is added, a CI step should
assert the new file appears in `packages/shared/dist/schemas/` (i.e. the build was run), OR the
build should be made a prerequisite of the typecheck job in CI. The current setup relies on the
developer remembering to `pnpm --filter @estalara/shared run build` before typechecking downstream
packages — easy to miss without that build step in the local typecheck chain.

---

## 2026-06-11 / FOLLOW-271

**What I built:** Rule U application — eliminated `enabled` from `tenants.quiz_config` JSONB blob
end-to-end: Zod `.omit({ enabled: true })` on `QuizConfigSchema` (strips at parse time, key can
never re-enter blob via POST); `parseStoredQuizConfig()` helper strips legacy key on GET reads;
migration `0026_strip_quiz_config_enabled` backfills existing rows; `QuizConfig` interface and
`QUIZ_DEFAULT_CONFIG` pruned; `DashboardQuizConfig` updated; JSDoc on `tenants.quizConfig` updated
to list only valid blob keys.

**Wiring/auth/fail-loud risks I weighed:** This ticket touches only the quiz config read/write path,
not auth. Auth mechanism on POST (`requireTenantAccess`) was not changed. No new decision-grade
surface introduced. The `parseStoredQuizConfig` helper is a new exported symbol — confirmed it has
two non-test call sites in the route before shipping (Rule H / Rule I). The internal
`_QuizConfigFullSchema` is intentionally unexported to avoid leaking a schema that accepts
`enabled`.

**A guardrail I'd add:** When a `packages/shared` schema is changed and a new helper function added,
the `dist/` rebuild step is currently manual. The typecheck CI job should depend on the shared
package build step explicitly — without it, a `tsc --noEmit` on control-plane gives "no exported
member" and the developer has to know to run `pnpm --filter @estalara/shared run build` first. This
is the same gap noted in the FOLLOW-270 lesson above; second occurrence = should be escalated as a
devops ticket.

---

## 2026-06-11 / FOLLOW-274

**What I built:** Dual key cleanup on `tenants.quiz_config` JSONB blob. (1) `micro_polls_enabled`
WIRED: added `microPollsEnabled?: boolean` to `SdkConfig`, made `readConfig()` parse
`data-micro-polls-enabled="true"` attribute, made `buildSnippet()` emit it when true; replaced two
unsafe `(config as unknown as Record<string, unknown>).micro_polls_enabled` casts in `index.ts` with
`config.microPollsEnabled`. (2) `sticky_widget` RETIRED: zero SDK consumer confirmed,
`.omit({ sticky_widget: true })` added to `QuizConfigSchema`, `parseStoredQuizConfig` extended to
strip it, dashboard toggle UI removed, migration 0027 backfills existing rows. Rule G amendment
applied: grepped for `sticky_widget` in test data files (quiz-toggle.test.tsx, route.test.ts) and
updated stale assertions before running suite.

**Wiring/auth/fail-loud risks I weighed:** No new mutating endpoint; all writes go through the
existing POST /api/quiz/config (unchanged auth). The `microPollsEnabled` field in `SdkConfig` is an
opt-in boolean; the SDK's 90s timer is gated by `if (config.microPollsEnabled)` so the change is
additive and fail-safe. The `require('@estalara/shared')` anti-pattern (CJS require in an ESM test
file) surfaced as a test failure; fixed immediately by using the already-imported named export.

**A guardrail I'd add:** When a test block imports a helper from a package using `require()` in an
ESM test file (vitest + node ESM), it always fails. A CI lint rule (`no-require-imports`) would
catch this pattern at PR time rather than at test run. None beyond that — the attribute wire pattern
(buildSnippet→readConfig) now has a complete Rule L test template that can be copied for future
snippet attributes.

---

## 2026-06-13 / FOLLOW-294

**What I built:** ADR-0012 Ticket A — (1) rewrote `GET /api/intent/config` to use Bearer API-key
auth identical to `quiz/public-config` (SHA-256 constant-time lookup, tenant derived from key,
`?tenant_id` param removed), (2) created `packages/shared/src/schemas/intent-weights.ts` with
canonical `ARCHETYPE_KEYS`/`INTENT_SIGNAL_KEYS`/`IntentWeightsSchema` (.strict(), all sub-fields
optional), (3) narrowed `IntentConfigResponse.weights` from `z.record(z.unknown())` to
`IntentWeightsSchema`, (4) 17 route tests + 31 schema tests all green.

**Wiring/auth/fail-loud risks I weighed:** (a) Auth must not fall back to mock when configured DB
throws on the auth leg — return 503 (same reasoning as quiz/public-config: no tenant_id yet, can't
serve mock to an unauthenticated caller). (b) Weight-fetch DB failure must return 500 +
`data_source: 'error'`, never mock (Rule K.2). (c) The `IntentWeightsSchema.parse()` of stored JSONB
validates the shape before returning — if a legacy row has an invalid shape it raises through to the
500 handler, not silently to the caller. (d) mock path skips auth entirely (DB unconfigured → return
early), which is correct: dev/CI has no real API keys.

**Gotcha — test mock dispatch:** Using a module-level counter to dispatch between two
`createAdminClient()` calls within one request was fragile (counter not reset between tests,
`vi.clearAllMocks()` resets implementations but not counters). The fix:
`mockCreateAdminClient.mockReturnValueOnce(authDb).mockReturnValueOnce(weightDb)` — each test sets
up its own sequence explicitly. Also: the constant-time compare in the route uses the _actual_
SHA-256 of the bearer token, so tests must supply the real precomputed hex of `'valid-api-key'` as
the mock's `hashedKey`, not a placeholder string.

**Gotcha — shared dist:** `pnpm --filter control-plane run typecheck` resolves `@estalara/shared`
from `packages/shared/dist/`. After adding a new export to shared, must run
`pnpm --filter @estalara/shared run build` before typecheck will see it.

**A guardrail I'd add:** A CI step that fails if `packages/shared/dist/` is stale relative to
`packages/shared/src/` (e.g. compare git-tracked dist hash vs current build output). This would
catch the "shared built, but old dist checked in" class of typecheck-passes-locally-fails-CI bugs.

---

## 2026-06-13 / FOLLOW-299

**What I built:** Widened `IntentConfigResponseSchema.data_source` enum in
`packages/shared/src/schemas/tracer.ts` from `['live', 'mock']` to `['live', 'mock', 'error']` so
the SDK (FOLLOW-268-sdk) can `safeParse` HTTP 500 error bodies and observe `data_source: 'error'`
without crashing (RETRO-070 CB-1). Made `weights`, `effective_at`, `is_tenant_specific` optional so
`safeParse` succeeds on the error-path body which omits those fields. Added SCHEMA-1..5 tests in the
route test (direct schema-level assertions) and a new `tracer.test.ts` in `@estalara/shared`.
Updated ADR-0012 `data_source` table and timeout/error-handling section to document `'error'`.

**Wiring/auth/fail-loud risks I weighed:** Making `weights` optional in the schema means callers
could accidentally construct a `IntentConfigResponse` without `weights` on the live/mock paths and
TypeScript wouldn't catch it. Mitigated: the route's type annotations on the mock and live bodies
still provide `weights` — optional means the type annotation permits absence, not that callers
should omit it. The SDK (FOLLOW-268-sdk) must still check `data_source === 'live'` before using
`weights`. No fabricated data was introduced — error path returns no `weights` at all.

**A guardrail I'd add:** A lint rule or custom ESLint check that flags any `z.enum(...)` on a
`data_source`-named field that does NOT include `'error'` — catches future schemas that emit errors
but don't type them, preventing another RETRO-070 CB-1 recurrence.

---

## 2026-06-13 / FOLLOW-301

**What I built:** Defended the `intent_weight_configs` one-active-row invariant. Three changes: (1)
POST and PUT use atomic transactions (deactivate existing active rows in scope, then insert/update)
to avoid hitting the `intent_weight_configs_one_active` partial unique index under normal operation;
residual 23505 race → 409 `active_config_exists`; 23503 FK violation → 400 `unknown_tenant`. (2) GET
weight query adds `ORDER BY created_at DESC` for deterministic newest-active-wins tie-break. (3)
Replaced the AC5 mock-only wiring test with a real POST→GET round-trip (INV-3) plus atomic-swap
tests (INV-1/2), 409 race-path tests (INV-4), 400 FK-violation tests (INV-5), and the ORDER BY
determinism test (ORD-1).

**Wiring/auth/fail-loud risks I weighed:** The transaction path required separate mock chain
builders for auth vs weight DB queries (different chain shapes: `where().limit()` vs
`where().orderBy().limit()`). Test isolation: `vi.clearAllMocks()` does NOT reset
`mockReturnValueOnce` queues; added `mockReset()` in the FOLLOW-301 `beforeEach` to prevent stale
queue entries from corrupted failed-test state corrupting the next test.

**A guardrail I'd add:** When a route adds `.orderBy()` to an existing query, update ALL mock chains
for that query in tests — a shared mock pattern that omits `orderBy` in the chain silently breaks
auth vs weight DB differentiation.

---

## 2026-06-14 / FOLLOW-266-phase2-seed + FOLLOW-302

**What I built:** Migration `0030_seed_global_intent_weights` — the Option A empty/identity
global-default weight seed (tenant_id IS NULL, weights = '{}'). Flips `GET /api/intent/config` from
`data_source:'mock'` to `data_source:'live'` for all tenants without an override, with
behavior-identical SDK defaults. Folded in FOLLOW-302: corrected stale `signal_weights` comment in
migration 0029 and schema docstring in `intent-weight-configs.ts`. Added PGlite idempotency test
(SEED-1..4) in packages/db and SEED-LIVE route-level test in control-plane.

**Wiring/auth/fail-loud risks I weighed:** The empty-weights seed could be confused with the no-row
mock path — the route's existing parse path would fail on `{}` if IntentWeightsSchema rejected it;
confirmed all sub-fields are optional so `{}` parses cleanly. FOLLOW-302 risk: editing an
already-applied migration file — verified the CI journal gate hashes nothing in the SQL content,
only `when` timestamps + file presence, so the 0029 edit is safe.

**A guardrail I'd add:** Add a CI gate that grep-checks `signal_weights` as a banned key in
migration SQL/schema files — would have caught FOLLOW-302 at PR time instead of post-merge retro.

---

## 2026-06-14 / FOLLOW-309+310+311+312

**What I built:** Four bug fixes for K.3.6 tracer admin UI that shipped non-functional despite green
CI (RETRO-077). (1) Added GET /api/admin/intent/config with id field so Weight Editor PUT path
becomes reachable. (2) Removed getAdminToken()+?token= from EventSource URL — SSE cannot send custom
headers; cookie auth already worked, page just wasn't using it. (3) Added per-tenant tracer nav
links from the tenants list page (3 pages were nav-orphaned). (4) Converted CSV export from bare
<a href download> to fetch()+Accept:text/csv — bare navigation cannot set headers.

**Wiring/auth/fail-loud risks I weighed:**

- RETRO-077 TG-1: the root cause of all 4 bugs was fabricated test fixtures masking wire mismatches.
  Solution: all fixtures now derive from AdminIntentConfigResponseSchema.parse() so the schema is
  the single source of truth for both the test and the route.
- SSE auth (FOLLOW-310): ADR-0013 says fix is page-only. I verified verifyTracerAdminAuth Path 2
  (getAuthClaims reads sb-access-token cookie) works correctly before removing the token param — the
  new tracer-auth.test.ts COOKIE-1 proves it.
- Rule K.2: GET handler fails loud on configured-but-thrown DB (500 + Sentry). No mock fallback on
  the GET read path either (reads are also decision-grade — page shows error banner).
- Pre-existing build failure (sdk/playbooks, sdk/auto-detect) confirmed pre-exists on base commit
  via git stash — not caused by this PR.

**A guardrail I'd add:** A CI check that asserts every SSE-producing page has no ?token= URL param
(EventSource can never send headers; passing a token in the URL is always wrong and is now a
documented anti-pattern from RETRO-077).

---

## 2026-06-17 / FOLLOW-325

**What I built:** `buildSnippet()` companion tag — `estalara-detect.iife.js` auto-included in the
onboarding snippet for all Tier 1+2 tenants. New `DETECT_SERVE_URL` constant in
`@estalara/shared/domains`, `apps/control-plane/public/estalara-detect.iife.js` committed as a
Vercel static asset, `GET /api/sdk-detect` dev fallback route, `## window.__EStalaraDetect` section
in `docs/INTERFACES.md`, 5 new test cases in `DetectionPreview.test.tsx`.

**Wiring/auth/fail-loud risks I weighed:**

1. **Build artifact in git:** The companion IIFE is a binary artifact committed to `public/`. The
   pre-commit lint hook tried to lint it, failing the commit. Fixed by adding it to
   `eslint.config.mjs` global ignores — same pattern as the existing `public/sdk.js` entry. Always
   check ESLint ignore list when committing minified/built JS to `public/`.
2. **Rule H for DETECT_SERVE_URL:** New export from `@estalara/shared` consumed in the same PR by
   `buildSnippet()` (line 183 of `DetectionPreview.tsx`) which is called at line 231 in the React
   component render. Production code path confirmed.
3. **Tier 3 exclusion:** Documented both in the JSDoc and in `docs/INTERFACES.md` why Tier 3 (Native
   `<EstalaraListing/>`) doesn't need the companion — Tier 3 owns the DOM. Deferred suppression via
   tenant flag to FOLLOW-332.
4. **Stash vs staged state:** The worktree had substantial staged work from a prior session. Did not
   re-apply stash (stash was superseded by the staged state). Verified staged file list matched all
   AC requirements before committing.

**A guardrail I'd add:** A CI check that asserts `apps/control-plane/public/*.iife.js` and
`apps/control-plane/public/*.js` are in the ESLint global ignores list — prevents the "lint fails on
built artifact" trap on the next similar commit.

## 2026-06-15 / FOLLOW-326

**What I built:** /sign-in page + Supabase SSR auth flow for the Next.js 15 control plane. Installed
@supabase/ssr + @supabase/supabase-js, created browser/server client helpers, added /sign-in Server
Component with SignInForm client component (signInWithPassword + router.push), replaced / with
permanentRedirect to /sign-in, fixed middleware /login→/sign-in (2 occurrences), added Sign out
Server Action in admin sidebar, updated .env.example.

**Wiring/auth/fail-loud risks I weighed:** The sign-out path is a Server Action triggered by a

<form> POST — no HMAC/JWT needed as it's a browser-initiated session invalidation via Supabase's
signOut() which clears the sb-access-token cookie. The existing middleware already verifies that
cookie via getAuthClaims() — no changes to the auth layer needed (AC2 flows through the existing
path). The client helper throws loud on missing env vars rather than silently returning a null client.

**A guardrail I'd add:** When @supabase/ssr adds overloaded function signatures (deprecated vs
non-deprecated), @typescript-eslint/no-deprecated can fire even on the correct overload because
TypeScript resolves by position. A downstream note in the eslint config or an inline cast is
necessary — the code review checklist should ask "did the linter flag a deprecated overload that
you're actually NOT using?"

---

## 2026-06-20 / FOLLOW-360

**What I built:** P0 hotfix — gated GET-path bandit sampling behind the holdout check in
`POST /api/adapt` GET handler. Before the fix (regressed in PR #327 / FOLLOW-342), the GET handler
called `getBanditArms` + `thompsonSample` unconditionally for all requests including holdout ones,
then passed the sampled variant to both `runDecisionTree` (so holdout sessions got v1/v2 copy) and
`logDecisionAsync` (so ClickHouse recorded `holdout_group=1, variant=v1/v2`). This contaminated the
holdout counterfactual baseline. Fix: when `holdoutGroup === true`, skip sampling entirely and use
`'control'` directly — mirroring the POST handler's early-return ordering. Added `runDecisionTree`
JSDoc HOLDOUT BYPASS RULE note and §E.3.0 MASTER_DESIGN update. 4 tests in `route.follow360.test.ts`
prove fail-before (3 fail on origin/main) and pass-after.

**Wiring/auth/fail-loud risks I weighed:**

1. **RETRO-095 contamination shape:** Before fix, `holdout_group=true` rows could carry
   `variant='v1'` or `variant='v2'` in ClickHouse. The causal lift estimate is
   `mean(treatment outcomes) - mean(holdout outcomes)`. If holdout rows include v1/v2 copy effects,
   the "holdout baseline" drifts up, making treatment lift appear smaller than it is. The fix is
   zero-risk: holdout sessions are served control copy (what they would have gotten before
   FOLLOW-342), and logged as such.
2. **PR #327 regression scope:** FOLLOW-342 added bandit variant threading to the GET handler
   without adding the holdout gate that POST already had. The POST holdout gate returns early at
   line 894 before ever calling `getBanditArms`. The surgical fix replicates that same skip logic —
   no new abstractions, just a ternary conditional.
3. **Test determinism:** `thompsonSample` is random (Beta sampling). To write a deterministic
   fail-before/pass-after test, I mocked `thompsonSample` to return `'v1'` always. This ensures the
   positive-control test (`holdout=false → variant='v1'`) is deterministic, and the regression test
   (`holdout=true → variant='control'`) would fail on origin/main where sampling ran
   unconditionally.

**A guardrail I'd add:** A CI check that asserts any code path writing to `adaptation_decisions`
(ClickHouse) where `holdout_group=1` also writes `variant='control'` — this would have caught the
FOLLOW-342 regression before it hit prod. Pattern: grep for `param_p_holdout_group.*1` in tests and
assert a corresponding `param_p_variant.*control` assertion exists nearby.

---

## 2026-06-20 / FOLLOW-357

**What I built:** Surgical rename of the page-type-derived `tier` field on `POST /api/adapt` to
`directive_scope`. Renamed `tierFromPageType` → `directiveScopeFromPageType`, `derivedTier` →
`directiveScope`, POST response fields `tier:` → `directive_scope:` in all three response arms.
Updated `AdaptationDirectives` shared type (tier made optional, directive_scope added optional), SDK
`AdaptResponse` (tier removed, directive_scope added optional), Zod validate schema in SDK
(`adapt-schema.ts`) and test schema in `route.test.ts`. Added 4 lock tests. Docstring rewritten.
MASTER_DESIGN §E.7 patched. ESC-027 resolved. ClickHouse column rename deferred to FOLLOW-358.

**Wiring/auth/fail-loud risks I weighed:** GET handler still uses `tier` (caller-supplied URL param,
different semantics from the POST page-context `directive_scope`). Made both fields optional in
`AdaptationDirectives` to avoid breaking the GET handler without touching it per scope constraints.
The shared type now accurately documents the difference: GET tier = caller integration hint, POST
directive_scope = page-context routing axis.

**A guardrail I'd add:** A rule that any shared type field used by both GET and POST on the same
route should have explicit per-handler documentation in its JSDoc — or be split into separate
response types. GET/POST response shape divergence in a single shared type is a silent drift risk.

---

## 2026-06-23 / FOLLOW-383

**What I built:** Fixed the P0 dead-on-arrival profiling opt-out server gate. (1) SDK
`fetchDirectives` now accepts `profilingOptedOut?: boolean` and appends `?profiling_opt_out=1` to
the `/api/adapt` URL when true — previously the server gate existed but received zero real traffic
because the SDK never sent the param. (2) `POST /api/adapt` gets the mirror gate: reads
`req.nextUrl.searchParams` for `profiling_opt_out=1`, returns neutral directives without calling
`getBanditArms`, `thompsonSample`, or `logDecisionAsync`. (3) Behavioral events in `index.ts`
observer callback now drop before `eventQueue.push` (not after) when opted out — the FOLLOW-372 code
had the guard AFTER the push, silently queuing opted-out events for the training pipeline.

**Wiring/auth/fail-loud risks I weighed:** The POST opt-out gate sits AFTER Zod body parse but
BEFORE bandit sampling — correct placement ensures we never log a variant row or contaminate
training data. No mock fallback risk: the opt-out path returns a well-structured 200 with
`source: 'default'` (provenance flag present). AC-4 (redis_writer.py chat-prior skip) is ml-engineer
scope; filed stub in FOLLOW_UPS.md, not implemented here (Rule H deferral).

**A guardrail I'd add:** A lint rule or CI check that flags any `eventQueue.push` call that does NOT
have an opt-out guard immediately before it — prevents a future developer from adding a new push
site that bypasses the privacy gate.

---

## 2026-06-24 / FOLLOW-387

**What I built:** Threaded `profiling_opt_out` through the full live real-time chat path: (1) added
optional `profiling_opt_out: z.boolean().optional()` to `ChatMessageSentPayloadSchema` in
`packages/shared` (public ingest-event schema change, CEO-approved ESC-029); (2) SDK `index.ts` chat
emit now sets `profiling_opt_out: profilingOptedOut || undefined`; (3) `_spawn_chat_nlp` in
`apps/stream-consumer` reads `profiling_opt_out` from the event payload and passes it through to
`fn.spawn(..., profiling_opt_out=...)` with a `False` default for back-compat; (4)
`process_chat_message` in `apps/intent-engine` already had the consumer param (FOLLOW-384 — no
change needed); (5) updated `test_chat_nlp_bridge.py` to assert `profiling_opt_out` in all spawn
call assertions + added 3 isolation tests + 1 full end-to-end integration test (AC-4) that lets
`_spawn_chat_nlp` run un-mocked while patching only the Modal module.

**Wiring/auth/fail-loud risks I weighed:**

1. **RETRO-108 TG-1 end-to-end gap:** FOLLOW-384's tests called `write_shadow_intent` directly —
   they proved the consumer guard but not the producer chain. The AC-4 integration test in
   `test_chat_nlp_bridge.py` drives the real
   `run_consumer → _spawn_chat_nlp → fn.spawn(profiling_opt_out=True)` path and asserts spawn args.
   This is the specific gap RETRO-108 called out.
2. **Backward compatibility:** The Zod field is `.optional()` so events without it still validate.
   Python uses `payload.get("profiling_opt_out", False)` — in-flight legacy events default to the
   safe behavior (shadow prior is written). No breaking change.
3. **§H.8 invariant preserved:** The chat event STILL reaches ClickHouse. The `profiling_opt_out`
   field is just another payload field — it doesn't change routing.
4. **Escalation (ESC-029):** Filed a RESOLVED escalation documenting the CEO approval before making
   the schema change. Pattern: any additive `packages/shared` event-schema change that touches the
   public ingest wire contract requires human sign-off per CLAUDE.md autonomy rules.
5. **`profilingOptedOut || undefined` lint trap:** The expression converts `false → undefined`
   (which is correct for not serializing the field when opted in), but ESLint's
   `no-unnecessary-condition` flags it when `profilingOptedOut` is a known `boolean` literal in a
   test. Used a `chatOptOutField(b: boolean): true | undefined` helper in tests to avoid the false
   lint positive.

**A guardrail I'd add:** A CI check that asserts any `fn.spawn(` call in `events.py` that targets
`"process_chat_message"` has `profiling_opt_out=` in its kwargs. Would catch a future refactor that
silently drops the flag.

---

## 2026-06-23 / FOLLOW-369

**What I built:** GET-path consent-skip parity for `GET /api/adapt` (FOLLOW-360 AC-2). Added two
optional GET params (`consent_state`, `consent_mode_enabled`) and a pre-bandit early-return gate
that mirrors POST's `assignment.skipped` branch: when `consent_mode_enabled=true` AND
`consent_state` is in `SKIP_CONSENT_STATES` ('opted_out'|'unknown'|'none'), the handler returns
`directives:[]`, `source:'default'`, `archetype:'neutral'` and suppresses `logDecisionAsync`
entirely. Also added `SKIP_CONSENT_STATES` to the shared import. 10 new tests in
`route.follow369.test.ts` covering all three skip states, ClickHouse/bandit suppression, negative
cases (consent mode disabled, consented state), and ordering proof (consent-skip fires before
holdout gate).

**Wiring/auth/fail-loud risks I weighed:**

1. **Gate ordering:** consent-skip sits AFTER profiling_opt_out (harder gate) and AFTER required
   param validation, but BEFORE holdout gate and bandit sampling — mirrors POST ordering exactly.
2. **No mock fallback:** the consent-skip path returns a structured 200 with `source:'default'`
   (provenance observable). No ClickHouse row written.
3. **SKIP_CONSENT_STATES reuse:** reused the existing shared constant — single source of truth.

**A guardrail I'd add:** None beyond what already exists.

---

## 2026-06-25 / FOLLOW-342

**What I built:** Explicit AC-2 fallback test for variant-indexed copy selection: verified that when
a `SlotDirective` carries no `variants` array, the route returns `slot.en` regardless of the bandit
variant index. The core implementation (VARIANT_INDEX map + `s.variants?.en[variantIndex] ?? s.en`
chain) was shipped in PR #327. This session added the explicit fallback test case to
`route.variant.test.ts` that was implicit before (tested only indirectly via the no-variants mock in
the first describe block).

**Wiring/auth/fail-loud risks I weighed:**

1. **Ordering invariant preserved:** sampling happens BEFORE `runDecisionTree()` in both GET and
   POST handlers. Holdout sessions short-circuit before bandit sampling and are forced to 'control'.
   The single `getHandlerVariant`/`selectedVariant` value is reused for both ClickHouse logging and
   directive construction — Rule K (no duplicate logic / single source of truth) is respected.
2. **Rule M compliance:** the PR description does not claim cosine ordering is live in prod.
   `affinityScore()` uses djb2 fallback until `FOLLOW-392` (operator prod seed) runs. The variant
   copy selection is correct end-to-end in prod regardless of which ordering function runs.
3. **No fabricated data:** all three paths (opt-out, consent-skip, holdout) return
   `source:'default'` with empty directives and no ClickHouse row, observable on the wire per Rule
   K.2.

**A guardrail I'd add:** When dispatched to "implement FOLLOW-342", verify git log first — the core
work was already merged in a prior PR (#327). Checking `git log --all --oneline | grep FOLLOW-342`
before reading route.ts would have surfaced this in 30 seconds instead of after reading 1279 lines.

---

## 2026-06-25 / FOLLOW-357 + FOLLOW-356

**What I built:** Renamed all "integration tier" / `tier` vocabulary to `page_context` across shared
types, SDK schema, adapt route, CH migration, and tests. Removed `AdaptResponse.tier: 1|2|3`
(analytics-only per CEO ruling 2026-06-05, no SDK consumer). Added FOLLOW-356 AC behavioral tests:
`listing_detail` → `page_context===2` + headline present; `listing_list` → `page_context===1` +
headline absent; `logDecisionAsync` receives correct `page_context` value via URL param. CH
migration 0018 renames `adaptation_decisions.tier` → `adaptation_decisions.page_context` (Rule W
safe: column not in ORDER BY).

**Wiring/auth/fail-loud risks I weighed:**

1. **Drift gate (check-adapt-schema-drift.sh):** Both `AdaptationDirectives` and
   `adaptResponseSchema` field sets must match exactly. After removing `tier` and renaming
   `directive_scope` to `page_context` in both, the gate passed. Worth running immediately after any
   schema edit — it caught a mismatch in a prior session that wasn't visible from the code alone.

2. **GET handler `satisfies AdaptationDirectives` footgun:** The GET handler's early-return objects
   used `satisfies AdaptationDirectives` — removing `tier` from the type made these strict casts
   fail because `tier` was an extra property. Fix: remove `satisfies` from early-return paths and
   type the main response as `AdaptationDirectives & { tier: number }` to make the extra field
   explicit. Lesson: `satisfies` is stricter than a plain type annotation for extra properties.

3. **Rule W compliance checked before migration:** Confirmed `tier` not in ORDER BY
   `(tenant_id, session_id, ts)` from migration 0003. Only then wrote 0018 with `RENAME COLUMN`. Had
   `tier` been an ORDER BY column, we'd need drop-and-recreate with backfill.

4. **FOLLOW-358 left open:** GET handler still passes caller-supplied `tier` (1|2|3) to
   `logDecisionAsync` as `pageContext`. Documented with comment in route.ts. Making GET accept
   `page_type` and derive `page_context` is a breaking API change — left for FOLLOW-358 (open).

5. **Test fixup for passthrough schema:** The `returns null on a type mismatch` test originally used
   `{ ...VALID_RESPONSE, tier: 'one' }`. After removing `tier` from the schema (which uses
   `.passthrough()`), extra fields are preserved not rejected, so the test falsely passed. Updated
   to `confidence: 'high'` which is a real required-field type mismatch that Zod will reject.

**A guardrail I'd add:** When removing a field from a Zod schema that uses `.passthrough()`, scan
test files for tests that depend on that specific field being _invalid_ — they silently stop testing
what they claim. A lint rule or comment convention ("this test relies on field X being in schema")
would help.

---

## 2026-06-26 / FOLLOW-358 (gitleaks CI fix)

**What I built:** Surgical gitleaks false-positive suppression.
`vi.stubEnv('DEMO_MODE_JWT_SECRET', 'test-secret-32-chars-long-enough!!')` on two lines in
`route.clickhouse.test.ts` triggered the `generic-high-entropy` rule (keyword `SECRET` + 32-char
string). Added the file path to the global `[allowlist]` paths in `.gitleaks.toml`, adjacent to the
existing `apps/control-plane/src/app/api/adapt/feedback/route.test.ts` entry.

**Wiring/auth/fail-loud risks I weighed:** Three options: inline `// gitleaks:allow` (Option A),
low-entropy placeholder (Option B), or global allowlist entry (Option C). Chose C per the decision
rule in the ticket (use C when the allowlist already has test file entries — it does). Option C is
the least invasive to the test file itself and consistent with the existing allowlist pattern for
sibling test files in the same directory.

**A guardrail I'd add:** None new — the existing pattern of adding test file paths to the global
allowlist is clear and consistent. The only future trap is adding a new real secret to a test file
whose path is allowlisted; but that's caught by the secret value itself not being used in tests

---

## 2026-06-26 / FOLLOW-396

**What I built:** Deleted the 5-line `paths` exemption for
`apps/control-plane/src/app/api/adapt/route.ts` from the `cloudflare-api-token` rule in
`.gitleaks.toml`. The exemption (added in FOLLOW-358 / PR #358) was made redundant by FOLLOW-394 (PR
#360), which added a token-scoped `regexes` entry (`'''0019_adaptation_decisions_page_context'''`)
that suppresses the same migration-filename false-positive for any file globally. Keeping both meant
`route.ts` — the highest-value file for real secret detection — was excluded from the
cloudflare-api-token scan.

**Wiring/auth/fail-loud risks I weighed:** No code change, no auth surface, no schema. The only risk
was accidentally deleting the `regexes` entry instead of the `paths` block — verified the regexes
entry was intact after the edit. Also confirmed via `gh api commits/<main-sha>/check-runs` that both
failures (`Archetype embeddings not-NULL check`, `Rule I — wired-or-dead check`) were pre-existing
on `main` HEAD before branching, not caused by this PR. Both `Gitleaks secrets scan` runs passed.

**A guardrail I'd add:** When adding a rule-specific `paths` exemption AND a `regexes` exemption for
the same false-positive, add a comment on the `paths` entry noting which `regexes` entry supersedes
it — and add a comment on the `regexes` entry saying "this makes the `paths` exemption redundant;
delete the paths entry." That pairing comment would have made the redundancy self-documenting and
catchable at PR review time without needing a separate cleanup ticket.

---

## 2026-06-26 / FOLLOW-362

**What I built:** Fixed a locale/A/B variant logging mismatch in `GET` and `POST /api/adapt`.
`thompsonSample()` was sampling v1/v2 for `pl`/`es` sessions and logging the result to ClickHouse,
but no playbook populates `variants.pl` or `variants.es` arrays — so `runDecisionTree` always served
the single locale string (equivalent to control), making the logged variant wrong. Fix: suppress
`getBanditArms` + `thompsonSample` for `locale !== 'en'`; default to `'control'` and log that. Added
13 tests covering all 3 locales (en/pl/es) for both GET and POST handlers.

**Wiring/auth/fail-loud risks I weighed:** Two approaches: (A) suppress sampling for non-en, or (B)
populate `variants.pl/es` from `en` arrays as a fallback. Option B would serve English text to
Polish/Spanish users (language bug), so Option A is correct. Suppression is a two-line change in
each handler; it avoids wasted `getBanditArms` DB calls for non-en sessions and ensures the logged
variant always matches the served copy.

**A guardrail I'd add:** When a new locale is added to the `z.enum(['en','pl','es'])` schema, the
bandit suppression condition (`locale !== 'en'`) should be checked — it will correctly suppress the
new locale until `variants.<locale>` arrays are populated. A code comment at the suppression site
already documents this. No additional gate needed beyond the Rule S requirement to test all locales.
(stubs are stubs).

---

## 2026-06-28 / FOLLOW-426

**What I built:** Added `res.ok` check + `Sentry.captureException` on both the HTTP-rejection and
network failure paths for two fire-and-forget Redpanda publishers in `apps/control-plane`:
`publishAbAssignmentEvent` (ab-events.ts) and `publishDescriptionRequested` (description/route.ts).
Pattern mirrors FOLLOW-425's `logDecisionAsync` fix. Added 7 tests total (4 + 3) covering non-ok
HTTP → Sentry (kind=insert_rejected), network throw → Sentry (kind=network), and ok → no Sentry.

**Wiring/auth/fail-loud risks I weighed:** No auth/mutation concerns — this is a purely
observability change to fire-and-forget analytics sinks. Key risk: changing `await fetch()` to
`fetch().then().catch()` changes WHEN the function's returned Promise<void> resolves (now resolves
immediately rather than after the HTTP request). Callers `void` the call so this makes no functional
difference, but tests needed a `setTimeout(r, 10)` flush to let the `.then().catch()` chain settle
before asserting Sentry was called. The existing "does not block response on Redpanda publish
failure" test in route.test.ts still passes since the outer `.catch()` on the call site becomes a
no-op (the function now handles errors internally).

**A guardrail I'd add:** The `setTimeout(r, 0)` vs `setTimeout(r, 10)` pattern for flushing
fire-and-forget microtasks is fragile in theory (relies on event-loop ordering). A better approach
would be to inject a `fetchImpl` parameter for testing (like `pushToRedpanda` in decision-api does),
which would let tests assert synchronously after the mock resolves. Worth considering for any new
fire-and-forget publisher added in the future.

---

## 2026-06-28 / FOLLOW-427 + FOLLOW-428

**What I built:** Hardened the last two ClickHouse fire-and-forget write paths in
`apps/control-plane` to fail loud on HTTP-level rejection. `logLlmCallAsync` (llm-gateway.ts) had a
`.catch()`-only handler — blind to HTTP 4xx/5xx. `writeDsrAuditLog` (dsr/\_clickhouse.ts) had a bare
`await fetch()` with NO `.catch()` AND no `res.ok` check — both HTTP rejection and network errors
were invisible (network errors propagated as unhandled promise rejections despite callers using
`void`). Both now follow the `logDecisionAsync` reference pattern from FOLLOW-425.

**Wiring/auth/fail-loud risks I weighed:** `writeDsrAuditLog` had the worst posture: the async
function could throw on network error, making `void writeDsrAuditLog(...)` callers produce unhandled
promise rejections. The try/catch fix is non-negotiable. For `logLlmCallAsync`, the private-function
testing challenge — since it's not exported, tests must drive it through `callLlmGateway`. Used the
Haiku path (0.6 < similarity ≤ 0.85) to keep the fetch call sequence predictable (spend-check SELECT
first, INSERT second), avoiding `getGlobalGenerationModel()` DB calls that would complicate mocking.
The module-level `_client` singleton in llm-gateway.ts is preserved across tests in the same file;
this is fine because `mockCreate` is still the controlled mock fn.

**A guardrail I'd add:** A lint rule that flags any `void asyncFn()` call site where `asyncFn` is
`async` but lacks internal try/catch — would have caught the `writeDsrAuditLog` hole at code-review
time. Alternatively, a naming convention: async analytics sinks should end in `*Async` and must have
a CI check that the function body contains a try/catch.

---

## 2026-06-30 / FOLLOW-435 LEG 1

**What I built:** Event contract + Redpanda producer for the listing-embedding seed overflow path.
the `ListingEmbeddingSeedRequested` event schema in `@estalara/shared`; shared fixture JSON at
`packages/shared/contracts/listing-embed-seed-event.required.json`; TS cross-runtime contract test;
`publishListingEmbeddingSeed()` producer in
`apps/control-plane/src/lib/listing-embed-seed-publisher.ts`; overflow stub in
`seed-listing-embeddings.ts` replaced with an `await publishListingEmbeddingSeed(…)` call; 3 new
test cases (enqueue called once with correct payload, not called on no-overflow, fail-open on
publisher reject); CI step for new TS contract test added.

**Wiring/auth/fail-loud risks I weighed:** (1) The producer uses the same Redpanda REST auth pattern
as `publishDescriptionRequested` — Basic auth header, no-op when `REDPANDA_REST_URL` absent, Sentry
capture on HTTP rejection AND network failure. (2) The overflow call is `await`ed inside the
already-`afterResponse()`-wrapped `seedListingEmbeddingsForActivation` — no new bare `void` needed;
FF-sink guard verified clean. (3) The outer try/catch in `seedListingEmbeddingsForActivation`
already wraps the publish call, so a publisher rejection (even though it's designed to never reject)
is fail-open. (4) Next.js webpack requires no `.js` extension on relative imports — caught by a
build failure; fixed before commit.

**A guardrail I'd add:** The cross-language CI gate currently only covers the TS side for the new
event (no Python consumer yet). LEG 2 MUST add the Python pytest step to CI before the gate is fully
bidirectional. The HANDOFF note documents this explicitly. A CI check that asserts "every
`*.required.json` fixture in `packages/shared/contracts/` has at least one Python pytest referencing
it" would prevent the Python side from being silently skipped.

---

## 2026-07-02 / FOLLOW-451

**What I built:** Added a real tenant API-key auth fallback to `POST /api/adapt` (audit F-05). The
handler tries the pre-existing demo HS256 JWT (`verifyDemoJwt`/`DEMO_MODE_JWT_SECRET`) first; on
`DemoJwtInvalidError` it falls back to the shared ADR-0015 `resolveApiKey()` (SHA-256 bearer →
`api_keys`, constant-time compare) — the same helper already used by `adapt/feedback/route.ts`.
`tenantId` is now `apiKeyTenantId ?? jwtClaims.tenant_id ?? body.tenant_id`, never trusting the body
when either auth path resolved a tenant. Added a 403 on `body.tenant_id !== apiKeyTenantId` for the
API-key path only (parity with feedback route's Step 7). 6 new tests in `route.follow451.test.ts`
covering the full auth matrix (valid key → 200 with real directives, mismatched tenant → 403,
unknown bearer → 401, revoked-equivalent → 401, DB error during lookup → 401 fail-loud via Sentry,
DEMO_MODE_JWT_SECRET-missing still 500 even with a valid key present). All 283 existing adapt
tests + 1395 control-plane tests stayed green; no route.demo-auth.test.ts edits needed.

**Wiring/auth/fail-loud risks I weighed:** (1) A missing `DEMO_MODE_JWT_SECRET` still hard-500s
before the API-key path is ever attempted — I kept this literal (rather than falling through to try
the API key), because an existing test locks that exact contract and the ticket explicitly said
"still surfaces as 500." I flagged in the PR that this means a misconfigured demo secret in prod
would also break real-tenant traffic on this route, which is a real operational risk worth watching,
even though it's the ticket-mandated behavior. (2) The ticket's AC2 ("body.tenant_id mismatch →
403") directly conflicts with the pre-existing FOLLOW-260 test, which expects a mismatched
body.tenant_id on the JWT path to be silently superseded (200), not rejected (403). I did not touch
the JWT path's behavior and scoped the new 403 check to the API-key path only — both because the
ticket explicitly required "no regression, existing tests green" and because JWT-path superseding
already closes the same cross-tenant vulnerability by a different mechanism (ignoring the
attacker-controlled field entirely rather than rejecting it). (3) resolveApiKey() DB errors are
caught and normalized to 401 + Sentry capture (Rule K.2) rather than allowed to bubble into a
generic 500 or silently authenticate. (4) Left the GET handler's separate `ADAPT_API_KEY`
presence-only auth untouched — out of ticket scope; noted as a candidate follow-up in the PR since
it's a materially weaker auth pattern than what POST now has, but expanding scope wasn't authorized
here.

**A guardrail I'd add:** When a ticket's AC list contains two clauses that turn out to conflict with
an existing locked-in test (as happened here with AC2 vs. FOLLOW-260), a lightweight pre-flight
`grep`/read of the acceptance-criteria-adjacent test file BEFORE writing the auth code would surface
the conflict earlier — I found it while reading the reference tests, but a step in the ticket
template itself ("list any existing test whose assertions this AC's literal wording would break")
would make agents surface these tensions explicitly.

---

**Date / ticket:** 2026-07-02 / FOLLOW-454 — Fix SSR-cookie auth mismatch on tenant dashboard +
analytics/pilot/ab APIs.

**What I built:** A single `apps/control-plane/src/lib/session-auth.ts` (`getSessionAuth`,
`getSessionAuthClaims`, `requireTenantSessionAccess`) that tries the existing Bearer/legacy-cookie
`getAuthClaims` path first, then falls back to validating the chunked `sb-<project-ref>-auth-token`
SSR cookie via `createServerClient().auth.getUser()` and reconstructing `AuthClaims` from
`app_metadata` — exactly mirroring the admin-side fix (FOLLOW-326/ADR-0013, `checkAdminSession` in
middleware.ts, `checkStaffSession` in tracer-auth.ts). Applied it to `/dashboard/*` middleware (new
`checkDashboardSession`) and every `getAuthClaims` call site in
`dashboard/analytics/{lift,summary}`, `pilot/{inquiry-starts,calibration,cta-lift}`, `ab/weights`,
`quiz/config` (GET + POST via `requireTenantSessionAccess`), and `tenants/[id]*` (route, answers,
lia, bandit/weights/[archetype]).

**Wiring/auth/fail-loud risks I weighed:** (1) `ab/weights` and `bandit/weights/[archetype]` call
`createTenantClient(rawToken)` → `db.rls()` for RLS-enforced queries. The pre-existing code derived
`rawToken` purely from the `Authorization` header, so an SSR-cookie-authenticated browser session
(no Bearer header) would have silently hit `createTenantClient(undefined)` — which DISABLES RLS
(pass-through branch in `packages/db/src/client.ts`). I made `getSessionAuth()` also return a
`rawToken`, sourced from `supabase.auth.getSession().access_token` on the SSR path (the same
already-validated session from `getUser()`), so RLS stays enforced on both auth paths — this was not
explicitly called out in the ticket but would have been a silent RLS-bypass regression if missed.
(2) Deliberately did NOT modify `@estalara/auth`'s `getAuthClaims` itself — it's also used by
`apps/ingest` (CF Workers) and `apps/decision-api` (Edge), neither of which should gain a
`@supabase/ssr` dependency; the fallback lives only in control-plane, same precedent as the admin
fix. (3) `tenants/[id]/lia/[recordId]` DELETE is staff-only (not explicitly named in the ticket's
route list but matches the `tenants/[id]*` glob) — extending the SSR fallback there is a pure auth
improvement (a staff browser session now also works) with zero behavior change for existing callers,
so I included it for consistency rather than leaving an inconsistent gap.

**A guardrail I'd add:** When a route derives a "raw JWT" from the `Authorization` header solely to
feed `createTenantClient()`/`db.rls()`, and a browser-session auth fallback is added elsewhere in
the same app, grep for `createTenantClient(rawToken` / `.rls(` across the app BEFORE wiring the
fallback — it's easy to fix the claims-resolution 401 and miss that the RLS-token propagation path
silently degrades to "RLS disabled" for the exact same request that now successfully authenticates.

---

## 2026-07-02 / FOLLOW-456

**What I built:** Closed 3 tenant-isolation holes from the 2026-07-01 audit (F-13): (1)
`POST /api/demo/sessions/:id/revoke` derived `tenant_id` from a caller-supplied `x-tenant-id` header
(spoofable, real mutation) — switched to `requireTenantAccess` (matching sibling POST/GET in the
same file) and made a _mismatching_ `x-tenant-id` header an explicit 403 rather than silently
ignoring it, so spoofing attempts are observable instead of blending into an ambiguous 404. (2)
`PUT /api/admin/generation-model` let any tenant `agency:admin` mutate the platform-global
generation model — switched to `verifyTracerAdminAuth` (`@/lib/tracer-auth`, already built for the
K.3.6 tracer admin routes/FOLLOW-267): `ADMIN_API_SECRET` Bearer (constant-time) OR a verified
`estalara_staff:true` JWT/session; a tenant JWT now gets 403, not silent success. `updated_by`
(nullable uuid) is `claims?.sub ?? null` — never a sentinel string. (3) `/api/tenants`,
`/api/webhooks/listing-updated`, `/api/internal/description-cache` all had the
`if (secret) { if (provided !== secret) reject }` fail-open bug — an unset secret env skipped auth
entirely. Extracted one shared `secretEquals()` helper (`@/lib/secret-compare.ts`,
SHA-256-hash-then-`timingSafeEqual` — sidesteps the equal-length-buffer requirement without a
raw-length branch that would itself leak a timing signal) and used it in all three, now fail-closed
(401) when the secret is unset.

**Wiring/auth/fail-loud risks I weighed:** (a) For the demo-revoke 403 vs 404 question: the ticket's
AC4 explicitly wants a 403 test for spoofed `x-tenant-id`, but ignoring the header entirely would
naturally produce 404 (row not found under the real tenant scope) — chose to explicitly compare and
reject on mismatch so the signal is unambiguous and testable, without ever using the header for
actual authorization. (b) For `/api/tenants`, fail-closed means the endpoint 401s in any environment
where `ADMIN_API_SECRET` isn't set in Vercel — I confirmed via `docs/ops/DOPPLER_SECRETS_MATRIX.md`
and the still-open `FOLLOW-155` stub that this secret is _supposed_ to be configured in prod but
could not confirm it currently is; flagged as an operational follow-up rather than silently
softening the fix, since fail-open here is exactly the audited vulnerability. (c) Left
`GET /api/admin/generation-model` on `requireTenantAccess('agency:admin')` unchanged — the audit
finding and AC only named the _write_ path; changing the read gate too would have been an
unrequested scope expansion.

**A guardrail I'd add:** When a route reads a secret env var with the pattern
`if (secret) { if (provided !== secret) return 401 }`, that shape itself is the fail-open bug (an
unset `secret` short-circuits the inner check) — worth a grep-based CI lint rule flagging any
`if (\`process.env\` truthiness gate) { ...!== comparison }` shape around an auth check, so this
class of bug can't reappear on a 4th route.

---

## 2026-07-02 / FOLLOW-459

**What I built:** Moved the ClickHouse `events` insert in `apps/ingest/src/handlers/events.ts` off
the ACK critical path via `ctx.waitUntil()`, so the ACK no longer blocks on ClickHouse's 3-attempt/
backoff retry (was up to ~15s worst case, violating the <50ms p95 budget). Redpanda stayed on the
synchronous ACK path unchanged (its 503/retry contract untouched). Documented the resulting
retry-contract change inline (terminal CH failure no longer 503s the client post-ACK) and filed
FOLLOW-475 for the durable-retry-queue gap that Sentry-capture-only doesn't close.

**Wiring/auth/fail-loud risks I weighed:** No new schema/event/exported symbol — only a
module-private `getWaitUntil()` helper reused at its two call sites in the same file (Rule H clean).
No auth surface touched (read-only sink reorder, not a new mutating endpoint). Fail-loud: a post-ACK
ClickHouse terminal failure is captured to `Sentry.captureException` with a dedicated tag, matching
the existing intent-snapshot fire-and-forget pattern in the same file — verified with a test that
stubs a terminal 5xx and asserts the Sentry call, not just that the ACK still returns 200.

**A guardrail I'd add:** Hono v4's `Context#executionCtx` getter **throws** (not `undefined`) when
`app.fetch()` is called without a third `ExecutionContext` argument — a property-access idiom
(`c.executionCtx?.waitUntil`) that looks like safe optional chaining is NOT safe here; it must be
wrapped in try/catch. This was a pre-existing latent bug in this same file (the intent-snapshot
fire-and-forget block used the same unguarded access) that only surfaced because my new code path
runs unconditionally on every batch, while the old one only ran for `intent.snapshot` events, which
no existing test exercised end-to-end. Any future `ctx.waitUntil` fire-and-forget wiring in a CF
Worker built on Hono should reuse a guarded accessor, not re-derive the cast inline.

---

## 2026-07-06 / FOLLOW-490

**What I built:** Fixed `/api/internal/schema`'s auth gate —
`if (schemaApiToken && token !== schemaApiToken)` fails open (accepts any non-empty bearer) when
`SCHEMA_API_TOKEN` is unset. Replaced with the exact `secretEquals()` fail-closed pattern FOLLOW-456
already applied to `/api/tenants`, `/api/webhooks/listing-updated`, and
`/api/internal/description-cache`: `!token || !secret || !secretEquals(secret, token)` → 401. Added
`route.test.ts` asserting the unset/wrong/correct-secret matrix (6 tests). Updated
`secret-compare.ts`'s shared docstring to list this 4th consumer.

**Wiring/auth/fail-loud risks I weighed:** This was literally the "one route FOLLOW-456 forgot to
clone-fix" — same bug shape, same file family, same tenant/blast-radius class (internal cron-only,
not customer-facing), so a surgical one-line-pattern swap was clearly correct with no new judgment
calls needed. The harder call was AC4's repo-wide grep: it surfaced two more identical-shape hits
(`ADAPT_API_KEY` on `GET /api/adapt` and `GET /api/adapt/description`). I did NOT fix those — they
already have a dedicated ticket (FOLLOW-473) that scopes a materially bigger, riskier change (those
are live SDK-facing decision-API paths hit on every pageview, and also trust a spoofable
`x-tenant-id` header — flipping to fail-closed blind, without confirming `ADAPT_API_KEY` is actually
set in prod, risks an SDK-wide outage vs. this ticket's low-blast-radius internal cron endpoint).
Silently expanding a "fix the obvious bug" PR into "also harden the primary decision endpoint" would
have been scope creep into another ticket's territory and a much bigger unreviewed risk to bundle
in.

**A guardrail I'd add:** A repo-wide `scripts/check-rule-h.sh`-style lint for the literal
`if (\w+(Secret|Token|Key) && ... !== ...)` shape (mentioned as FOLLOW-484's future grep-lint in
this ticket) would have caught all 4 FOLLOW-456/490 instances at PR time on the FIRST route, instead
of needing 2 separate tickets across 2 sprints to close 4 near-identical copies of the same bug.
Worth promoting from ticket-time grep to a permanent CI check.

---

## 2026-07-06 / FOLLOW-482

**What I built:** Durable Cloudflare Queue retry buffer for the post-ACK ClickHouse `events` insert
per ADR-0017 (ACCEPTED, ESC-037 — confirmed via the not-yet-merged
`architect/ADR-0017-accepted-follow482-ready` branch, since the ADR file on `main` still read
PROPOSED). Producer: `events.ts`'s existing terminal-CH-failure `.then()` (kept the existing
`logger.error` + `Sentry.captureException`) now also chunks `validated` records by serialized byte
size (`chunkRecordsForRetryQueue`, ~100 KB threshold under CF's 128 KB/message cap) and `.send()`s
each chunk to `env.EVENTS_RETRY_QUEUE`, wrapped in the SAME `getWaitUntil`/`.catch` pattern
FOLLOW-459 built (no new unguarded fire-and-forget). Consumer: a new
`handlers/events-retry-consumer.ts` exports `handleEventsRetryQueue`, wired as `queue` alongside
`fetch` in `index.ts`'s default export; it re-validates the message body with a colocated Zod schema
(`EventsRetryMessageSchema` — internal to this Worker, not `packages/shared`, per ADR-0017 §5),
re-inserts via the unchanged `pushToClickHouse`, and calls `message.ack()`/`message.retry()` per
message (not a batch-level throw) so Cloudflare's native `max_retries`/DLQ do the rest.
`wrangler.toml` mirrors the exact per-env pattern already used for KV/DO bindings (top-level +
explicit `env.production` redeclare; `env.dev`/`env.staging` inherit, matching the pre-existing
KV/DO gap rather than inventing a new convention).

**Wiring/auth/fail-loud risks I weighed:** (1) Made `EVENTS_RETRY_QUEUE` optional in `Env` with a
guard-and-warn-log branch (same shape as `CLICKHOUSE_URL`'s no-cred guard) rather than a hard
requirement, so an environment that hasn't provisioned the queue yet degrades to "same as
pre-FOLLOW-482" instead of throwing — but a `.send()` failure on a _configured_ queue gets its own
distinct Sentry tag (`retry_enqueue_failed`), not silently folded into the generic backstop, per
Rule K.2. (2) Deliberately did NOT route the `queue` handler through `withSentry`/`instrument` —
those are typed/wired for the `fetch` surface only in this app's usage, and forcing a second generic
type param through them risked a `strictFunctionTypes` variance fight for no real benefit since the
consumer already captures its own Sentry events explicitly.

> **⚠️ CORRECTION (FOLLOW-513 / RETRO-160, 2026-07-06 — point (2) above was WRONG and directly
> caused a P1 bug):** `Sentry.captureException` from `@sentry/cloudflare` **silently no-ops when no
> client is initialized**, and `withSentry` is exactly what runs `Sentry.init()` per invocation.
> Because the `queue` handler bypassed `withSentry`, and queue invocations frequently land on fresh
> isolates that never served a `fetch`, the consumer's `retry_reinsert_failed` /
> `malformed_retry_message` captures were **blind in prod** — defeating the exact observability
> guarantee FOLLOW-482 existed to provide. Fix (PR #453): pass the WHOLE `{ fetch, queue }` object
> through `withSentry` (verified `@sentry/cloudflare@10.50.0` DOES instrument `queue`, despite a
> stale JSDoc that only mentions `fetch`). **Lesson: never assume `captureException` works without a
> bound client — a confidently-worded wrong lesson is worse than none because it is trusted.**

(3) No dedup key added — CEO-accepted risk (ESC-037); confirmed the `events` table DDL still lacks
`event_id` in its `ORDER BY` before treating that as settled rather than re-litigating it.

**A guardrail I'd add:** `pnpm install` after adding a new direct dependency (`zod`, needed for the
colocated schema) is easy to skip if `tsc --noEmit` happens to still pass — it silently resolved
against a stray global `~/node_modules/zod` instead of the workspace-pinned version until I re-ran
install and checked `tsc --listFiles` for the actual resolved path. Worth a repo-wide note: after
adding any new `dependencies` entry, verify `--listFiles` (or equivalent) resolves inside the
workspace `node_modules/.pnpm`, not a machine-global fallback — a bundler-mode `moduleResolution`
can mask this in local dev while CI (no stray global node_modules) would fail the exact same import
cleanly, but for the wrong file.

---

## 2026-07-10 / FOLLOW-532

**What I built:** Closed RETRO-164 §4c TG-1: `resolveAdaptGetAuth` (adapt-get-auth.ts) used to leave
the `resolveApiKey` configured-but-failed-DB throw (Rule K.2) as an unenforced CALLER obligation —
both `GET /api/adapt` and `GET /api/adapt/description` owned identical try/catch +
`Sentry.captureException` + 401 blocks with nothing pinning them together. Chose the "fold into the
helper" option over "add a parity test only": added a third `AdaptGetAuthResult` disposition
(`{ ok: false, status: 401, message, dbError: true }`), moved the try/catch + Sentry-capture INSIDE
`resolveAdaptGetAuth` itself (now takes a third `area: 'adapt' | 'description'` param for the Sentry
tag), and deleted the duplicated try/catch at both call sites — they now share the literal same
branch, so divergence is structurally impossible, not just test-detected. Added a helper-level
parity test (`adapt-get-auth.parity.test.ts`) proving both areas produce an identical disposition
and Sentry-capture shape for the same forced DB throw.

**Wiring/auth/fail-loud risks I weighed:** (1) Branch-first discipline slip — edited the helper file
BEFORE running `git checkout -b`, on `main`; the pre-edit-branch-guard hook caught it and I created
the branch immediately after with the edit carried over in the working tree, so no work was lost,
but it's a discipline gap worth flagging on myself. (2) Two PRE-EXISTING route tests
(`route.test.ts`/`description/route.test.ts`, NOT the `route.follow473.test.ts` files) mocked
`resolveAdaptGetAuth` to REJECT to simulate the old "helper throws" contract — after the fold those
mocks no longer match reality (the mock now needs to RESOLVE with `dbError: true`), so I updated
both to the new contract; a bare `pnpm --filter control-plane lint` run (bypassing turbo's `^build`
dependency step) produced a false-positive type-aware ESLint error in an unrelated file
(`description-pg-cache.ts`, last touched by the unrelated, already-merged FOLLOW-464) — confirmed
pre-existing/unrelated by diffing against `main` and by the fact `pnpm turbo run lint` (the actual
CI invocation) passed clean. (3) A full `pnpm --filter control-plane test` run flaked once on
`feedback/route.follow450-e2e.test.ts` (PGlite WASM cold-start hook timeout under heavy parallel
system load from concurrent background builds) — confirmed as an environmental flake, not a
regression, by re-running that file in isolation (passes in ~5.7s) and by a second full-suite run
showing the exact same isolated flake with everything else green (1569 passed / 2 skipped).

**A guardrail I'd add:** When a shared auth/resolver helper is changed from "throws on internal
failure" to "catches and returns a disposition," grep for EVERY mock of that helper across the repo
(not just the dedicated `*.follow473.test.ts`/ticket-named suites) — a `mockRejectedValue` on a
helper mock is exactly the shape that silently goes stale when the real function's contract changes
from throw-based to return-based. A CI lint or comment convention flagging
`mock<HelperName>.mockRejectedValue` next to a helper whose JSDoc says "does NOT throw" would catch
this class of drift before a human has to trace a hook-timeout-adjacent test failure back to a
contract change three files away.

## 2026-07-10 · FOLLOW-549 (RETRO-172 TG-1/DG-1, fast-follow off FOLLOW-532/PR #502)

**What I built:** Two spy assertions (one per GET route test file) pinning
`resolveAdaptGetAuth(req, token, 'adapt')` / `(..., 'description')` to its own literal, plus one
docstring sentence on `adapt-get-auth.ts` noting a genuine third consumer must widen the `area`
union and that the resulting compile error is the forcing function. No production logic touched —
purely additive test-tightening per RETRO-172's finding that both route test files mocked
`resolveAdaptGetAuth` wholesale, so a copy-paste swap of the `area` literal (mislabeling `tags.area`
in Sentry) had zero CI signal.

**Wiring/auth/fail-loud risks I weighed:** The whole point of a "pin" test is that it must actually
fail on the exact regression it targets — an assertion that only checks call count or shape (not the
literal) would give false confidence. I verified this concretely: swapped each literal in turn
(`'adapt'`→`'description'` and vice versa), reran the single test in isolation, confirmed a real
failure with the wrong-literal call args printed in the diff, then reverted. Only after seeing the
red run did I trust the green one.

**A guardrail I'd add:** none — this ticket's guardrail (RETRO-172's own recommendation) is now the
fix. General pattern worth generalizing later: any test that exists solely to catch a copy-paste
literal swap across near-identical siblings should have its "does this test actually fail on the
swap" check documented as part of the PR evidence, not just asserted from the author's confidence —
codifying "verify the test can fail" as a lint-doc convention for spy-based sibling-parity tests
would generalize this beyond just `adapt-get-auth`.

- **2026-07-16 / FOLLOW-559** · Built server-side consent gate at the `apps/ingest` storage boundary
  (`consent-gate.ts` + wiring in `handlers/events.ts`): profiling-class events with
  `consent_state ∉ {consented, legitimate-interest}` are rejected per-event with a structured
  `Sentry.captureMessage` counter; audit/operational events always ingest. · **Risks weighed:** (1)
  placement — chose ingest-boundary over a shared-schema Zod refinement to avoid mutating the public
  ingest contract (would need architect escalation); (2) reject granularity — per-event not
  whole-batch 4xx, because a whole-batch reject would drop a sibling `consent.granted` audit event
  (§H.9 regression); (3) keyed on `consent_state` only, never opt-out (§H.9); (4) Rule I — first cut
  exported the map/classifier which have only test importers → narrowed to `evaluateConsent` as sole
  export, keeping the internal `Record<EventType, ConsentClass>` for compile-time exhaustiveness. ·
  **Guardrail I'd add:** a CI/lint rule that an exported symbol whose ONLY importer is a `*.test.ts`
  must either be un-exported or carry a FOLLOW deferral — catches the Rule-I "test-only export"
  class before push, not after.

- **2026-07-17 / FOLLOW-581** · Fixed the latent DSR `intent_events` erase no-op: erase filtered on
  the zero-default `intent_session_id` UUID (via a Postgres lookup) instead of the String
  `session_id` the ingest writer actually populates, so Art. 17 erasure silently deleted nothing for
  any subject. Realigned the shared `DSR_CLICKHOUSE_TABLES` constant → `session_id`, then propagated
  across all three consumers (erase route, mutation-poll retry path, disclosure) + removed the
  now-orphaned `resolveIntentSessionId` helper (Rule I). · **Risks weighed:** (a) the fix was a
  shared-constant change with 3 divergent special-case call sites — the FOLLOW*UPS stub named only
  2, so I grep-traced every reader before editing (mutation-poll was the missed one); (b) a "green
  200 with fake completeness" compliance surface — the erase route returned `status: pending/done`
  while deleting nothing, exactly the class of bug the guardrails target; (c) removing the helper
  could strand a new dead export, so I deleted the module + test and re-verified Rule I stayed at
  baseline 180. · **Guardrail I'd add:** a test that asserts a ClickHouse DSR erase filter column
  matches the column the \_writer* populates (writer-vs-eraser key parity), so a
  keyed-on-the-wrong-column no-op fails CI instead of shipping latent for months.

- **2026-07-17 / FOLLOW-579** · Stripped §H.8(d) derived-intent fields
  (final_archetype/final_confidence/prediction_stability_score) from unconsented
  `session.quality.snapshot` payloads at the ingest storage boundary via a pure
  `redactPersistedPayloadForConsent` in consent-gate.ts, wired into handlers/events.ts before the
  sinks. Added a golden per-type ConsentClass fixture (RETRO-177 TG-1: exhaustiveness≠correctness —
  the old contract test ran only under consent_state='consented' where all classes return allowed,
  so a mis-class couldn't surface). · Wiring: new export has a non-test consumer in same PR (Rule
  H/I net-zero, 180 violations). Fail-loud: strip is a real redaction, observable on the wire
  (persisted payload demonstrably lacks the fields), event still ingests as operational — no
  fabrication. Verified persistence path is the generic `events` table, not the phantom
  `session_quality` table (no writer). · Guardrail I'd add: a lint/CI check that flags any event
  payload field named like a derived-intent artifact (archetype/confidence/stability) riding a
  non-`profiling` class — the LG-1 pattern was "derived field rides a benign class," and it took a
  retro to catch it.

- **2026-07-20 / FOLLOW-586** · Migrated the last 2 hand-maintained full-parity archetype-ID TS
  copies (`ARCHETYPE_KEYS` in `intent-weights.ts`, the inline `z.enum([...18])` in
  `adapt/description/route.ts`) onto the FOLLOW-584 canonical `CANONICAL_ARCHETYPE_IDS` export —
  pure DRY, both copies already 18/18 in sync, no behavior change. · **Risks weighed:** (a) an
  `as const` readonly-tuple swap could silently narrow/widen `ArchetypeKey` or break the two
  `z.enum(ARCHETYPE_KEYS)` call sites if zod's typings required a mutable tuple (description.ts's
  sibling `ArchetypeIdSchema` documents exactly this trap and spreads); I verified empirically via
  `tsc --noEmit` rather than trusting the doc comment, and it turned out no spread was needed here
  because `ARCHETYPE_KEYS` was already `as const` before my change (identical readonly-tuple shape
  in, readonly-tuple shape out) — the description.ts case differs because it derives a _new_ binding
  from a readonly source for the first time; (b) confirmed order-identity between the two arrays by
  diff before deriving, not by assumption; (c) grepped every consumer (prod + test) of both symbols
  before touching, including a dynamic `import('@estalara/shared')` test consumer in packages/sdk
  that wouldn't have shown up in a naive static-import grep. · **Guardrail I'd add:** none — the
  existing `archetype-canonical-parity.test.ts` + `intent-weights-drift.test.ts` + integration
  parity suite together already covered this refactor's blast radius; a new guardrail here would be
  redundant. (Left one remaining full copy, `packages/sdk/core/adapt-schema.ts`'s
  `archetypeIdSchema`, flagged in the PR for sdk-engineer — out of my ownership scope.)

- **2026-07-20 / FOLLOW-594** · Finished stranded analytics staff-port (ADR-0018): re-greened 3
  route suites + golden-query + follow371 by PARTIALLY mocking `@/lib/session-auth` (spy only
  `resolveTenantAccess`, keep `AccessError`/others real via `importOriginal`); added staff
  200/400/404 + MANDATORY red-first tenant-filter tests that exercise each route's REAL query
  (ClickHouse `param_tenant_id`, drizzle `.where(eq(tenantId,A))`), proving A-fence excludes B;
  built server page `/admin/tenants/[id]/analytics` (tenantExists → notFound → AnalyticsView). ·
  **Risks weighed**: mocking `resolveTenantAccess` drops the route-level SSR-cookie proof —
  acceptable because that wiring is fully covered by `resolve-tenant-access.test.ts`; RETRO-187 says
  a local-array leak demo does NOT discharge the fence invariant, so tenant-filter tests intercept
  the actual outgoing query, and I verified red-first by breaking the fence. Also fixed 4 real
  `exactOptionalPropertyTypes` CI blockers the stranded work left (3× `?? undefined` into resolve
  opts, 1× `onResume={... : undefined}`) via key-omission spreads — behavior-identical, not an
  auth-logic rewrite. · **Guardrail I'd add**: a CI grep that fails any staff-override route lacking
  a tenant-filter test that intercepts the real query (not a local array) — mirrors RETRO-187's
  exact miss.
- **2026-07-20 / FOLLOW-592** · Built `resolveTenantAccess` (ADR-0018 §2): discriminated-union
  agency|staff tenant-access helper in `session-auth.ts` + 17-case security-invariant suite.
  Composed `verifyTracerAdminAuth` (staff gate) + `getSessionAuth` (identity/role) rather than
  reimplementing. · **Risks weighed:** (1) staff path runs under `createAdminClient` = RLS OFF, so
  the returned `tenantId` is the ONLY tenant fence — documented as a loud "RLS TRAP" doc-comment + a
  leak-demo test. (2) `tenantExists` fails CLOSED (throws 500) when the DB can't be reached — an
  unverifiable tenant is a denied tenant, never allowed. (3) Deliberately REJECTED the headless
  `ADMIN_API_SECRET` path (valid for read-only tracer) because a tenant-scoped staff action must be
  attributable to a `staff.sub` for `staff_audit_log`. (4) Malformed (non-UUID) tenant ids
  short-circuit to 404 before touching the uuid column (no sentinel-in-uuid 500). · **Two CI traps
  hit:** relative `./tracer-auth.js` import compiles under tsc/vitest but NOT Next webpack
  (`Module not found`) — use the `@/lib/...` alias for intra-app imports. And
  `Rule I — wired-or-dead` flags any new export lacking a non-test importer; it's pre-existing-red +
  non-blocking and has no comment deferral, so a foundation-helper-before-consumers PR will always
  trip it (Rule H is the real guardrail, satisfied via integration test). · **Guardrail I'd add:** a
  lint rule (or Rule-I exemption) that accepts an inline `// consumer: FOLLOW-NNN` tag on an export
  as a valid deferral, so foundation PRs don't have to choose between a false green and touching
  backlog files.

- **2026-07-20 / FOLLOW-605** · Made the staff quiz-config write atomic: config `update` +
  `staff_audit_log` insert now commit-or-roll-back together in one `db.transaction()` on a single
  `createAdminClient()` (retrofit of FOLLOW-595's mutate-then-audit shape). Ratified
  single-transaction (not outbox) in ADR-0018 §3a; sequence-gated FOLLOW-598. · Risks weighed: (a)
  fail-loud on rollback → 500 `audit_write_failed` + Sentry, never a silent unattributed 200; (b)
  surgical — did NOT touch auth resolution, tenant fence, write-rank gate, or STAFF-only audit
  condition, only the transactional wrapping; (c) red-first proof: reverted the route to
  non-transactional and watched the rollback test fail `expected 'pl' to be 'en'`, then restored.
  Harness needed a `.transaction()` mock with real staged/discard semantics (snapshot store → mutate
  staged → commit on resolve, drop on throw). · Guardrail I'd add: a Rule-H-style CI check that
  flags any staff WRITE port doing `db.update(...)` + `db.insert(staffAuditLog)` OUTSIDE a shared
  `tx` (grep for the two on the same route without `db.transaction`), so 596/597/598 can't silently
  regress to mutate-then-audit.

- **2026-07-21 / FOLLOW-596** · Ported `PUT/GET /api/demo/override` to the ADR-0018 staff-write
  pattern (`resolveTenantAccess` + atomic `db.transaction()` upsert+audit); built the
  `/admin/tenants/[id]/demo` staff page + editor. · Weighed the transaction-plumbing caveat:
  delegating the write to `upsertDemoOverride` would have left only `insert(staffAuditLog)`
  textually in the route, which the FOLLOW-607 atomicity guard SKIPS as an audit-of-a-read — hollow.
  Inlined the upsert inside the tx (matching quiz/config) so the guard actually engages. Preserved
  agency `admin`-write semantics (NOT viewer, unlike quiz) via `minAgencyRole: 'agency:admin'`.
  Red-first verified both the orphan-mutation rollback test and the tenant-filter WRITE fence by
  breaking the route and watching them fail. · **Guardrail I'd add**: a lint/guard that flags a
  staff-write route whose data mutation is delegated to a non-tx-aware store helper while
  `insert(staffAuditLog)` sits in the route — the exact shape that silently defeats
  check-staff-write-atomicity.sh.

- **2026-07-24 / FOLLOW-630** · **What I built**: Applied the FOLLOW-624 swallow-then-clobber guard
  to the three sibling config editors it missed outside `/admin` — `dashboard/quiz/page.tsx`,
  `dashboard/demo/override/page.tsx`, and the shared `components/generation-model-settings.tsx`
  (rendered by both `/admin/settings` and `/dashboard/settings`). Each now tracks a
  `loadStatus`/`loadErrorMsg` separate from save status, renders a `role="alert"` + Retry on a
  failed GET, disables Save, and early-returns from `handleSave` when not loaded. Added the missing
  `!r.ok` guard to the two that parsed a 500 body as config (demo override rendered DEMO MODE OFF
  silently; generation-model rendered the default as stored). Added red-first tests per surface
  asserting no POST/PUT is issued from the errored state. · **Wiring/auth/fail-loud risks I
  weighed**: The demo-override and generation-model twins were WORSE than the admin originals
  because they lacked any `!r.ok` guard, so a non-2xx was silently coerced to config — a Save then
  PUT fabricated state. Evaluated the four residual analytics `catch(() => {})` occurrences: all are
  read-only dashboards or a bandit-resume PATCH retry, none load-then-clobber config, so documented
  as out-of-scope-because-read-only rather than force-fixed. · **A guardrail I'd add**: The root
  cause was FOLLOW-624 running a subdirectory-scoped grep (`…/app/admin`) instead of Rule K.2's
  repo-wide `grep apps/`. FOLLOW-625's mechanized guard should assert the swallow-then-Save shape
  across `src/**` including `src/components/**`, not just page routes — a narrowed grep is how twins
  ship.

- **2026-07-24 / FOLLOW-633** · **What I built**: real per-tenant Adaptive Listings on/off —
  `tenants.al_enabled` column (default true, additive migration 0034), a single shared runtime
  enforcement helper `resolveAlEnablement()` wired into BOTH adapt GET+POST (serves neutral
  pass-through 200 when `al_enabled=false` OR `status IN (suspended,canceled)`), an audited
  staff-only write route `/api/admin/tenants/al-state` (atomic tx: column + `staff_audit_log` action
  `tenant_al_state.update`, write-rank gated), and a FOLLOW-624-shaped admin toggle editor. ·
  **Wiring/auth/fail-loud risks I weighed**: (1) default MUST be true so the one live tenant
  (Estalara) stays ON through the prod auto-apply; (2) fail-OPEN on a configured-but-threw tenant
  lookup (+Sentry) rather than fail-closed — an off-switch must never break the live site on a DB
  blip, and serving REAL adaptation is not fabricated data (so K.2 is satisfied by the Sentry
  capture, not by forcing neutral); (3) put the OFF check in ONE helper so GET/POST cannot diverge;
  (4) added `adaptive_listings_off`/`al_off_reason` provenance to the OFF response via object-spread
  (not a shared-type field) so no Rule-H schema change / no adapt-schema drift — SDK schema is
  `.passthrough()` so it survives. · **A guardrail I'd add**: none — the existing K.2, staff-write
  atomicity, migration-journal and Rule-H guards all covered this change well; the awaited helper in
  the hot path was cheap (one PK lookup) and fail-open kept all 335 existing adapt tests green.
