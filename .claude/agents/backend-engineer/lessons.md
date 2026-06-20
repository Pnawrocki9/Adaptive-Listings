# Backend Engineer — Lessons Log

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
