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

**What I built:** Art. 17 CRM erasure completeness check — closes the silent-incompleteness gap
from RETRO-042. In `dsr/erase/route.ts`, after the main transaction completes, if `durable_lead_id`
was NULL (Pass B skipped), run a count query for surviving CRM-namespace `conversion_labels` rows
(lead_id != '' AND lead_id != session_id). If > 0, emit a Sentry warning + ClickHouse audit entry
with `action = 'incomplete_erasure_crm_rows_detected'` + return `crm_erasure_status:
'incomplete_no_durable_lead_id'` in the 200 body (observable on the wire). When Pass B ran or no
CRM rows exist, return `crm_erasure_status: 'complete'`. Extended PGlite tests AC-7/8/9 prove the
SQL predicate detects surviving rows, yields no false positives, and returns 0 after a complete
erasure. Created `docs/compliance/DSR_ALERTING.md` with operator procedure for obtaining the durable
token and re-running. Updated `docs/MASTER_DESIGN.md` §T.6 with the residual operator-dependency
note (RETRO-042 DG-2).

**Wiring/auth/fail-loud risks I weighed:** Path (b) — alert/audit — is the correct choice because
path (a) (auto-resolver) would require a new DB table and migration; path (b) closes the GDPR
Art. 17 observability gap immediately without adding a writable surface. The count query is
read-only after an already-authenticated DSR transaction commits — no new auth surface introduced.
The `crm_erasure_status` field on the 200 body is the observable provenance signal (Rule K.2).

**A guardrail I'd add:** An integration test that mounts the full `POST /api/dsr/erase` route and
asserts the HTTP response body contains `crm_erasure_status: 'incomplete_no_durable_lead_id'` when
CRM rows survive — a route-level test would catch a regression where the count result is not plumbed
into the response field. This is FOLLOW-240's scope (round-trip integration test).
