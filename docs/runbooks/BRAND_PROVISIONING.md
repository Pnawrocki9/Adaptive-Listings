# Brand Provisioning Runbook (FOLLOW-652)

**Audience:** Piotr (CEO) — the sole operator of `admin.estalara.com`. **Status:** authored
2026-07-25, verified against the real HEAD code paths (routes read + local dry-run against a
throwaway tenant; see [§Dry-run log](#dry-run-log-executed-2026-07-25)). **Backing design:**
[ADR-0018](../adr/ADR-0018-superadmin-tenant-access.md) (staff URL-scoped access),
[ADR-0019](../adr/ADR-0019-per-tenant-presentation-config.md) (per-tenant presentation config),
`docs/DECISION-BRIEF-FACADES-622-623-2026-07-24.md` (domain-independence ruling).

## Model recap (read this before running anything)

- **A brand = a `tenants` row.** Every client brand is a **full white-label deployment of
  `app.estalara.com` on the client's own domain** — same app, same known DOM, one shared data pool.
  There is no per-brand fork of the codebase; there is one `tenants` row per brand.
- **Domain-independence.** Every AL runtime decision resolves tenant identity from `api_key` /
  `tenant_id`, **never** from the serving host. The SDK snippet always points at
  `https://admin.estalara.com` (`CONTROL_PLANE_URL`, `packages/shared/src/domains.ts:41`) regardless
  of which domain the SDK is embedded on — the client's domain is where the SDK _runs_, not where it
  _calls back to_.
- **The CEO operates every brand from `admin.estalara.com`.** Clients get **no dashboard access**
  (`/dashboard/*`, the agency self-serve UI, is not used for external brands going forward). All
  provisioning and ongoing per-tenant control happens through the **staff surfaces** under
  `/admin/tenants/[id]/*` (ADR-0018), plus two headless endpoints that predate ADR-0018's staff
  model (§Step 1, §Step 2 — see the GAP boxes there).
- **The domain is not known until deploy time and the provisioning steps below do not require it up
  front** — only §Step 6 (ingest CORS) and the deploy-side HANDOFF (§Part B) need the real domain.

---

## Pre-flight — access & tools

- [ ] **`ADMIN_API_SECRET`** (Doppler `prd`) — headless admin auth for `POST /api/tenants` and the
      K.3.6 admin-intent routes' `Bearer` path.
- [ ] **A logged-in `estalara:superadmin` session on `admin.estalara.com`** — the CEO's existing
      staff account (prod has exactly one auth user today, per ADR-0018 §Context).
- [ ] **Supabase Auth Admin API access** (service role key, or the Supabase dashboard's Auth → Users
      → "Add user") — only needed for §Step 2's GAP workaround (auto-detect + activate).
- [ ] The brand's **name** and a **URL-safe slug** (`^[a-z0-9-]+$`). The client's real domain is
      **not** required yet.

---

## Part A — Control-plane provisioning steps

### Step 1 — Create the `tenants` row

**Route:** `POST /api/tenants` (`apps/control-plane/src/app/api/tenants/route.ts`). **Auth:**
`x-admin-secret: <ADMIN_API_SECRET>`, constant-time compared (`secretEquals`, fail-closed when the
secret is unset — `route.ts:58-62`). This is a **headless shared-secret** endpoint, not a staff
session route — it predates ADR-0018 and was never ported to `resolveTenantAccess`.

```bash
curl -s -X POST https://admin.estalara.com/api/tenants \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: $ADMIN_API_SECRET" \
  -d '{"name":"<Brand Name>","slug":"<brand-slug>","plan":"native"}'
```

- `plan` is a legacy Tier label field (`free|observer|augment|native`) — the field still exists on
  the schema but Tiers are retired (CLAUDE.md, MASTER_DESIGN §E.7); use `native` for every new brand
  (broadest capability set) unless billing says otherwise. Do not read this as a live product tier.
- `registration_id` / `approved_by` are **optional** and tied to the self-serve
  `tenant_registrations` approval flow (`apps/control-plane/src/app/api/registrations/route.ts`).
  External re-brand clients are bespoke deals, not self-serve signups — omit both fields.
- On success (201): the route **also seeds 54 `ab_bandit_weights` rows** (18 canonical archetypes ×
  3 variants, uniform `Beta(1,1)` priors) via `seedBanditWeightsForTenant`
  (`apps/control-plane/src/lib/bandit-seed.ts:26`) so Thompson sampling has arms to draw from
  immediately. This is fire-and-forget — a seeding failure does **not** fail tenant creation (it
  logs `[tenants/POST] bandit seed failed for tenant …` and the 201 still returns); if bandit
  sampling looks stuck at uniform-random after go-live, check this log line for the tenant.
- **Response carries `id`** — this is the `tenant_id` every subsequent step below is keyed on.

> **GAP (not a blocker, note it):** there is no admin UI button for this step (`/admin/tenants`
> lists tenants but has no "Create" form) — the runbook step is a `curl`/Postman call. Low priority;
> a UI wrapper is a straightforward follow-up if creation frequency justifies it.

### Step 2 — Auto-detect the site schema + activate (schema, `api_key`, embeddings seed)

**Routes:** `POST /api/detect` then `POST /api/schema/activate`
(`apps/control-plane/src/app/api/detect/route.ts`,
`apps/control-plane/src/app/api/schema/activate/route.ts`). **UI:** `/dashboard/onboarding/detect`
(`DetectWizard` → `DetectionPreview`, "Save & Activate" button).

**What `POST /api/schema/activate` automates in one call** (verified by reading
`schema/activate/route.ts:161-259` and its 16-case test suite — all passing, see
[§Dry-run log](#dry-run-log-executed-2026-07-25)):

1. Upserts the detected `TenantSiteSchema` into `tenant_site_schemas` (unique on
   `(tenant_id, domain)`).
2. Flips `tenants.status` `'pending' → 'active'` — **conditionally**, only if the row is still
   `'pending'` (`WHERE id = tenantId AND status = 'pending'`), so re-running activation is safe.
3. Looks up an existing non-revoked, non-expired `public` API key for the tenant; if found, returns
   `<prefix>...<last4>` (the raw key is not recoverable — this only matters on re-runs). If absent,
   **generates a new `est_pub_<16 hex>` key**, stores its SHA-256 hash, and returns the **raw key
   this one time only**.
4. Busts the Redis tenant-schema cache (`invalidateTenantSchemaCache`) so the next `/api/adapt` call
   sees the fresh schema immediately.
5. **Seeds listing embeddings** (`seedListingEmbeddingsForActivation`, fire-and-forget via
   `afterResponse()`) — inline for up to `MAX_INLINE_SEED = 50` listings (~200ms/listing, ~10s
   budget). **Catalogs beyond 50 listings** overflow to the Modal embed-seed consumer (ADR-0016,
   live in prod since session 9 — `docs/runbooks/modal-embed-seed-consumer-golive.md`); this is
   already-provisioned infrastructure, not a new step for this runbook, but if a client's real
   catalog is large, confirm the overflow log line
   (`[seed-listing-embeddings] OVERFLOW: tenant=<id> has <N> listings beyond MAX_INLINE_SEED=50 …`)
   appears and the Modal `consume_embed_seed_requests` job picks it up within 30s.

**Auth on both routes:** `getSessionAuthClaims()` — Bearer tenant JWT **or** an `@supabase/ssr`
**agency** browser session (`claims.tenant_id` + `claims.agency_role`). A **staff** session
(`estalara_staff: true`, `tenant_id: null`) is explicitly rejected 403
`STAFF_TENANT_CONTEXT_MISSING` on both routes (`detect/route.ts:219-227`,
`schema/activate/route.ts:112-121` — the sentinel-in-uuid-column guard, RETRO-005 FOLLOW-047
lineage).

> **GAP (real, load-bearing — read before Step 2's TRIGGER date):** `POST /api/detect` and
> `POST /api/schema/activate` have **no staff URL-scoped port**. ADR-0018 generalized staff access
> to per-tenant dashboard features (Analytics, Quiz, Demo, Labels, Intent, Settings, AL on/off) but
> these two onboarding-wizard routes were never ported — they predate ADR-0018 and still require a
> real **agency** session (`claims.tenant_id` matching the target tenant). ADR-0018 §Alternatives
> explicitly **rejects** session-impersonation as a fix (audit-hostile, ambient mutable state).
> Given "clients get no dashboard access," there is today **no way for the CEO's staff superadmin
> session to run the detect→activate wizard directly.**
>
> **Executable workaround (uses existing tools, ships no new code):** provision a one-off internal
> `agency:admin` Supabase Auth user scoped to the new tenant, log in as it **only** to run the
> wizard, then leave the account dormant (never hand its credentials to the client — this satisfies
> "clients get no dashboard access," which is about the _client_ never having a login, not about an
> agency-shaped identity never existing).
>
> ```
> # Supabase Dashboard → Authentication → Users → Add user (or supabase.auth.admin.createUser)
> email:        brand-ops+<slug>@estalara.com   (an internal alias, never given to the client)
> app_metadata: {
>   "tenant_id": "<the id from Step 1>",
>   "agency_role": "agency:admin",
>   "mfa_verified": true
> }
> ```
>
> (Shape verified against `resolveSsrSession` in
> `apps/control-plane/src/lib/session-auth.ts:122-136` — `tenant_id` + `agency_role` are the two
> `app_metadata` keys the SSR-session reconstruction reads; `agency_role` must be one of
> `agency:owner|agency:admin|agency:viewer`, `packages/auth/src/jwt.ts:29-36`.) Log in as this user
> in a private browser session, run `/dashboard/onboarding/detect` → paste the client's
> staging/preview URL (or the live URL once known) → Save & Activate → copy the returned `api_key`
> for §Part B. Then either leave the account dormant or delete it — it is never surfaced to the
> client.
>
> **Candidate follow-up (do not build in this PR):** a staff URL-scoped
> `/admin/tenants/[id]/onboarding` port of detect+activate (ADR-0018 Phase-2 shape:
> `resolveTenantAccess({ allowStaffOverride: true })`, staff-atomic-audited write). File as a FOLLOW
> ticket — see PR body.

### Step 3 — Brand config (colors, logo, white-label)

**Route:** `PATCH /api/config` (`apps/control-plane/src/app/api/config/route.ts`). **UI:**
`/admin/tenants/[id]/settings` (`StaffTenantConfigEditor`). **Auth:** `resolveTenantAccess` with
`allowStaffOverride: true` — the CEO's normal staff session works directly, no workaround needed.
Write requires staff rank ≥ `estalara:ops` (satisfied by `estalara:superadmin`).

```bash
curl -s -X PATCH "https://admin.estalara.com/api/config?tenant_id=<id>" \
  -H "Content-Type: application/json" \
  -H "Cookie: <staff SSR session cookie>" \
  -d '{"brand":{"primary_color":"#1a2b3c","logo_url":"https://.../logo.png","white_label":true}}'
```

- **404s if the `tenants` row doesn't exist** (`UnknownTenantError`, `route.ts:343-345`) — Step 1
  must have run first.
- Writes `tenants.brand_config` (jsonb) and commits a `staff_audit_log` row
  (`action: 'tenant_config.update'`) **in the same transaction** as the config update (ADR-0018 §3a)
  — a failed audit insert rolls back the config change too (never a silent unaudited write).
- **Real SDK consumer since PR #619 (FOLLOW-623, ENFORCE):** the trigger button color and quiz-card
  logo read this slice via the extended `GET /api/quiz/public-config` response (`brand` key,
  ADR-0019 D1/D2). `white_label` is **parsed but has no consumer yet** (ADR-0019 ticket-impact note
  — likely a future "Powered by Estalara" attribution hide; do not assume it does anything today).

### Step 4 — `quiz_enabled` / `al_enabled` flags

**`al_enabled` (Adaptive Listings master ON/OFF) — staff-only, works directly, no workaround:**

Route `PUT /api/admin/tenants/al-state?tenant_id=<id>`
(`apps/control-plane/src/app/api/admin/tenants/al-state/route.ts`). UI:
`/admin/tenants/[id]/al-state`. **This route explicitly REJECTS agency sessions (403 `staff_only`)**
— unlike `/api/config`, there is no agency write path at all (`route.ts:11-14`); the CEO's staff
session is the _only_ valid caller, which is exactly the operating model here. Default is `true` on
row creation (migration 0034 default) — a freshly created tenant already has AL on; flip it off only
if the brand should go live "quiet" first.

> **GAP:** `quiz_enabled` (the Investor Quiz widget master ON/OFF, distinct from the quiz _content_
> config below) writes through `PATCH /api/tenants/:id`
> (`apps/control-plane/src/app/api/tenants/[id]/route.ts`), which — like §Step 2 — requires an
> **agency** session matching the tenant (`validateTenantAuth`, `route.ts:48-59`); **no staff
> override exists**. The staff quiz editor's own doc comment flags this
> (`quiz-config-editor.tsx:10-13`: "that page is tightly coupled to the agency session AND its quiz
> ON/OFF toggle writes through a DIFFERENT route … that has no staff-override port yet"). Default is
> `true` (quiz on) at row creation, so **most brands need no action here** — only touch this if a
> brand should ship without the quiz widget. Use the same §Step 2 internal-agency-account workaround
> if you must flip it. Do not use a raw SQL `UPDATE tenants SET quiz_enabled = …` shortcut — it
> bypasses the `staff_audit_log` trail every other staff write in this runbook produces, breaking
> the audit-completeness invariant ADR-0018 §3 establishes for every other flag in this document.

**Quiz _appearance_ (language, accent color, micro-polls) — staff-writable today, no workaround:**
`POST /api/quiz/config?tenant_id=<id>` / UI `/admin/tenants/[id]/quiz` (`StaffQuizConfigEditor`) —
this DOES support `resolveTenantAccess({ allowStaffOverride: true })` (`quiz/config/route.ts:4-9`).
Set language/accent color here per brand.

### Step 5 — Quiz _definition_ (questions, answers, branching, answer→archetype mapping)

**Status: post-FOLLOW-639 (not yet shipped — worktree active as of this writing).** Per ADR-0019 D2

- D4, until FOLLOW-639 ships every brand renders the SDK's **built-in default question tree** (the
  current hardcoded `resolveArchetype()` / `QUIZ_CONTENT`, EN/PL/ES) — there is no per-brand quiz
  content today, only per-brand quiz _widget settings_ (§Step 4). **No action for this step until
  FOLLOW-639 merges.** When it does, this runbook needs a new numbered step: create/activate a row
  in the new `quiz_definitions` table for the brand (staff-atomic-audited write,
  `action: 'quiz_definition.update'`, ADR-0019 D2/D7) — update this file then, do not guess the
  route shape now.

### Step 6 — `allowed_origins` (ingest CORS allow-list for the brand's domain)

**Status: post-FOLLOW-642 (P1, active in a parallel worktree as of this writing) — verify the
write-path below against the MERGED PR before relying on it, do not assume this section is current
once #642 lands.**

**Current state (verified by reading `apps/ingest/src/router.ts:44-73` directly — this is the
blocking fact for real go-live):** ingest CORS is a **hardcoded, environment-wide** allow-list —
`PROD_ALLOWED_ORIGINS = ['https://app.estalara.com', 'https://admin.estalara.com']`. It is **not**
per-tenant and does **not** read `tenants.allowed_origins` (that column exists,
`packages/db/src/schema/tenants.ts:44`, but nothing writes or reads it as of FOLLOW-622's de-scope,
PR #618). **A brand-new client domain is NOT on this list and the SDK's ingest calls from that
domain will be CORS-rejected until one of the following happens:**

1. **(Preferred, once shipped) FOLLOW-642's data-driven per-tenant enforcement** — per the ticket
   stub's spec: ingest reads `tenants.allowed_origins` per-request (with a cache for the ingest
   hot-path p95 <50ms budget), URL→origin normalized (scheme+host+port, no path), explicit
   empty-array semantics. Once merged, this step becomes: **write the brand's domain(s) to
   `tenants.allowed_origins`** via whatever admin surface FOLLOW-642 ships (re-verify the exact
   route against the merged PR — it may resurrect the settings-page control FOLLOW-622 removed, or
   ship a dedicated staff route; do not assume the pre-FOLLOW-622 `sdk.allowed_origins` shape on
   `/api/config` still applies, since FOLLOW-622 explicitly dropped it from that contract).
2. **(Interim mitigation if a client's domain is known before FOLLOW-642 merges)** add the literal
   origin string to `PROD_ALLOWED_ORIGINS` in `apps/ingest/src/router.ts` and redeploy the Worker.
   This uses the **existing** (if crude) enforcement mechanism — it is a one-line code change + a
   Cloudflare Worker deploy, not new functionality, and is explicitly the stopgap the FOLLOW-622
   decision brief anticipated ("the hardcoded env list already covers it" for the single-tenant
   case; extending the literal list is the same mechanism, just longer). **This backend-engineer
   worktree does NOT modify `apps/ingest` — that file is out of scope for this PR** (FOLLOW-642 owns
   it); this paragraph documents the option for the operator, it is not executed here.

**GAP (P0-shaped, flag prominently in the PR):** with **three external clients onboarding in 2-4
weeks**, if FOLLOW-642 has not merged by the time a client's domain is known, ingest will silently
drop every SDK event from that domain (a CORS-blocked `fetch` fails client-side with no
server-visible error) unless the interim mitigation above is applied per-domain. This is a real
go-live blocker, not a nice-to-have — call it out to Piotr explicitly when the first domain lands.

### Step 7 — Intent weights (defaults vs per-tenant override)

**Route:** `GET`/`POST /api/admin/intent/config`, `PUT /api/admin/intent/config/[id]`
(`apps/control-plane/src/app/api/admin/intent/config/`). **UI:** `/admin/tenants/[id]/intent`
(`StaffIntentWeightsEditor`). **Auth:** `verifyTracerAdminAuth` — `Bearer <ADMIN_API_SECRET>` **or**
a staff SSR session/JWT (this one DOES accept the headless secret, unlike the ADR-0018-ported
routes, per its own docstring).

- **Default behavior:** a brand with no `intent_weight_configs` row uses the platform's global
  default weights — **no action needed** unless the brand needs different archetype priors /
  behavioral damping / signal likelihoods than the default population (e.g. a luxury-only brand
  where the signal-to-archetype mapping should differ).
- To set a per-tenant override: `POST` a new row with `tenant_id` + `weights` (partial or complete
  `IntentWeightsSchema`); the one-active-row-per-scope invariant is enforced by an atomic swap
  inside a transaction (`config/[id]/route.ts:16-25`).

---

## Part B — Deploy-side HANDOFF checklist (outside this repo)

The app deployment onto the client's own domain (DNS, hosting, branding assets, snippet install)
lives **outside `Adaptive-Listings`** — it is the same deployment mechanism that stands up
`app.estalara.com` itself, re-pointed at the client's domain with the client's branding assets. This
repo does not own that infrastructure; this section names the contract precisely so nothing is
assumed on either side.

**Inputs the deploy side needs from this runbook (produced by Part A):**

| Input                         | Produced by                | Notes                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tenant_id`                   | Step 1                     | UUID; not secret, but is the fence for every per-tenant lookup.                                                                                                                                                                                                                                                    |
| `api_key` (raw, `est_pub_…`)  | Step 2                     | **Visible only once** on first activation — capture it immediately; re-running Step 2 for an existing key returns only `<prefix>...<last4>`. Baked into the deployed instance's SDK snippet config, NOT the domain.                                                                                                |
| Branding assets (logo, color) | Client, applied via Step 3 | `primary_color` / `logo_url` are ALSO stored in `tenants.brand_config` for the SDK-runtime consumer (§Step 3) — the deploy side's static branding (page chrome, favicon, etc.) and the AL runtime branding (widget color/logo) are two independent surfaces that should visually match but are not the same write. |
| Domain (once known)           | Client                     | Needed for §Step 6 (ingest CORS) — **not** needed for §Steps 1-5, 7 (domain-independence).                                                                                                                                                                                                                         |

**Outputs the deploy side must send back:**

| Output                                                                                                                                                                                                                       | Used for                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Live URL                                                                                                                                                                                                                     | §Part C verification (SDK-load check, origin-allow-list entry for §Step 6). |
| Confirmation the snippet (`estalara-detect.iife.js` + `sdk.js`, both served from `admin.estalara.com` per `packages/shared/src/domains.ts:41,57,73` — **never** the client's own domain) is installed on every listing page. | §Part C SDK-load verification.                                              |

**Explicit non-requirement (domain-independence, re-stated):** the deploy side does **not** need to
tell this repo the domain before Steps 1-5 and 7 run — only Step 6 needs it, and only once
FOLLOW-642 ships (or the interim mitigation is applied).

---

## Part C — Per-brand verification checklist

Run this on every new brand after Part A + the deploy side confirms the live URL. Items marked
**[OPERATOR-GATED]** require prod/staging access this runbook's author does not have (real
Supabase/ClickHouse/Vercel prod credentials) and could not be executed as part of authoring this
document — the local dry-run below (§Dry-run log) is the closest verification possible without them.

1. **SDK loads.** [OPERATOR-GATED] Open the live URL, DevTools → Network: confirm
   `estalara-detect.iife.js` and `sdk.js` both load 200 from `admin.estalara.com` (never the brand's
   own domain — domain-independence check).
2. **`public-config` returns the brand slice.**
   ```bash
   curl -s https://admin.estalara.com/api/quiz/public-config \
     -H "Authorization: Bearer <the brand's api_key>"
   ```
   Expect `data_source: "db"` and a `brand` key matching what §Step 3 wrote (`primary_color`,
   `logo_url`, `white_label`). **`data_source: "fallback"` here means the DB read failed or the
   Bearer key didn't resolve — treat as a hard verification FAIL, not a soft default** (Rule K.2 — a
   `fallback` response looks identical in shape to a real one; the field is the only signal). This
   step **is** locally dry-runnable in shape (see §Dry-run log) but the brand-specific assertion
   needs the real deployed key — [OPERATOR-GATED] for the real-key case.
3. **Ingest accepts events from the brand domain.** [OPERATOR-GATED, blocked on §Step 6] Trigger an
   SDK event from the live page, confirm the browser does **not** log a CORS error and the ingest
   Worker returns 2xx. This will FAIL until §Step 6 is resolved for the domain — do not skip this
   check assuming Step 6 "probably" ran.
4. **Events land in ClickHouse under the right `tenant_id`.** [OPERATOR-GATED] Query
   `SELECT count() FROM intent_events WHERE tenant_id = '<id>' AND event_time > now() - INTERVAL 1 HOUR`
   against prod ClickHouse (`doppler secrets get CLICKHOUSE_URL --config prd`, per the pattern in
   `docs/runbooks/OPERATOR_SESSION_2026-07-12.md` §Pre-flight) after generating a test event.
5. **Brand appears in per-tenant analytics AND the cross-brand rollup.** [OPERATOR-GATED]
   `/admin/tenants/[id]/analytics` (FOLLOW-594) shows the brand's own numbers; `/admin/analytics`
   (FOLLOW-638, PR #617, `apps/control-plane/src/app/admin/analytics/page.tsx`) shows the brand as a
   row in the per-brand breakdown table alongside the platform-wide rollup. Both render a
   `data_source` badge (`clickhouse`/`live` = real, `mock`/`error` = FAIL, per Rule K.2) — a green
   page with a `mock`/`error` badge is **not** a pass.
6. **AL on/off flip has runtime effect.** [OPERATOR-GATED for the live-traffic assertion; the code
   path is verified by reading, not by a live call] `PUT /api/admin/tenants/al-state` with
   `al_enabled: false` must make the next `POST /api/adapt` for that tenant return the neutral
   pass-through shape (`resolveAlEnablement`, `apps/control-plane/src/lib/al-enablement.ts:1-50`,
   consumed at `apps/control-plane/src/app/api/adapt/route.ts:813,1272`) rather than a real
   directive — verify by toggling off, calling `/api/adapt` for a real session, confirming the
   neutral response, then toggling back on.

---

## Dry-run log (executed 2026-07-25)

No live Supabase/ClickHouse/Vercel prod credentials are available in this authoring environment
(`apps/control-plane/.env.local` carries only `RESEND_API_KEY`) — a full end-to-end brand
provisioning run against real infrastructure was **not possible**. What follows is what **was**
actually run and its real output, against `apps/control-plane` running locally (`pnpm dev`, port
3000, no `DATABASE_URL_ADMIN` / no Supabase env configured — the "dependency not configured" branch
of every route below, per Rule K.2's distinction from "configured but threw").

**1. Full route test suites for every route this runbook's Part A steps depend on:**

```
$ pnpm vitest run src/app/api/tenants/route.test.ts src/app/api/detect/route.test.ts \
    src/app/api/schema/activate/route.test.ts src/app/api/config/route.test.ts \
    'src/app/api/tenants/[id]/route.test.ts' src/app/api/admin/tenants/al-state/route.test.ts \
    src/app/api/quiz/public-config/route.test.ts

 ✓ src/app/api/admin/tenants/al-state/route.test.ts (9 tests) 65ms
 ✓ src/app/api/config/route.test.ts (25 tests) 108ms
 ✓ src/app/api/schema/activate/route.test.ts (16 tests) 98ms
 ✓ src/app/api/quiz/public-config/route.test.ts (14 tests) 1246ms
 ✓ src/app/api/detect/route.test.ts (43 tests) 165ms
 ✓ src/app/api/tenants/route.test.ts (12 tests) 84ms
 ✓ src/app/api/tenants/[id]/route.test.ts (7 tests) 137ms

 Test Files  7 passed (7)
      Tests  126 passed (126)
```

All 126 pre-existing tests pass unmodified — these prove the fail-loud/fallback/auth behaviors this
runbook describes are the ACTUAL shipped behavior, not this document's assumption.

**2. Live HTTP dry-run against the running dev server (throwaway tenant name
`"Throwaway Test Brand"` / slug `throwaway-test-brand`), unconfigured DB, per-request auth varied:**

```
$ curl -s -w "HTTP %{http_code}\n" -X POST http://localhost:3000/api/tenants \
    -H "x-admin-secret: whatever-i-want" \
    -d '{"name":"Throwaway Test Brand","slug":"throwaway-test-brand","plan":"native"}'
# ADMIN_API_SECRET unset in env → fail-closed regardless of header value:
{"error":"Unauthorized"}
HTTP 401

# Restarted with ADMIN_API_SECRET=throwaway-dry-run-secret, still no DB configured:

$ curl -s -w "HTTP %{http_code}\n" -X POST http://localhost:3000/api/tenants \
    -H "x-admin-secret: throwaway-dry-run-secret" \
    -d '{"name":"Throwaway Test Brand","slug":"throwaway-test-brand","plan":"native"}'
{"id":"b7969777-b031-49be-90b4-38834144e35e","slug":"throwaway-test-brand","name":"Throwaway Test Brand","plan":"native","mock":true}
HTTP 201
# The "mock":true field is the observability the K.2 dev-mock rule requires — the
# unconfigured-DB path is never indistinguishable from a real write.

$ curl -s -w "HTTP %{http_code}\n" -X POST http://localhost:3000/api/tenants \
    -H "x-admin-secret: totally-wrong" -d '{...}'
{"error":"Unauthorized"}
HTTP 401
# constant-time secretEquals rejects a wrong secret even when the correct one IS set.

$ curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/api/detect \
    -d '{"url":"https://example.com"}'
{"error":{"code":"UNAUTHORIZED","message":"Missing or invalid token","request_id":"a5124773-…"}}
HTTP 401
# No agency session → 401, confirming §Step 2's GAP box: there is no staff bypass to test here
# because none exists in the code.

$ curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/api/schema/activate \
    -d '{"schema":{}}'
{"error":{"code":"UNAUTHORIZED","message":"Missing or invalid token"}}
HTTP 401

$ curl -s -w "\nHTTP %{http_code}\n" -X PATCH http://localhost:3000/api/config \
    -d '{"brand":{"primary_color":"#ff0000"}}'
{"error":{"code":"unauthorized","message":"Unauthorized: no tenant access for this request"}}
HTTP 401

$ curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/api/admin/tenants/al-state
{"error":{"code":"unauthorized","message":"Unauthorized: no tenant access for this request"}}
HTTP 401

$ curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/api/quiz/public-config \
    -H "Authorization: Bearer est_pub_deadbeef00000000"
{"quiz_enabled":true,"micro_polls_enabled":false,"language":"en","accent_color":"#2563EB","data_source":"fallback"}
HTTP 200
# Unconfigured DB → 200 + explicit data_source:"fallback", exactly the §Part C step-2
# verification contract this runbook tells the operator to check for.
```

Server killed after the run (`pkill -f "next dev --turbo"`); no state was left running.

**What this dry-run proves:** every auth gate and every fail-loud/fallback provenance flag described
in Part A and Part C behaves exactly as documented, on the real route code, today. **What it does
NOT prove:** anything requiring a real Postgres row, a real ClickHouse event, a real Vercel prod
deploy, or a real Cloudflare Worker — those are the [OPERATOR-GATED] items in Part C and must be run
for real against staging/prod before the first external brand goes live.

---

## GAP summary (for ticket promotion — see the PR body for the actual FOLLOW filings)

1. **No staff URL-scoped port for `POST /api/detect` / `POST /api/schema/activate`** (§Step 2) —
   real onboarding-wizard blocker under the "no client dashboard" model; documented workaround
   exists (internal agency account) but is manual and off the ADR-0018 staff-audit trail.
2. **No staff-override port for `quiz_enabled`** (§Step 4, `PATCH /api/tenants/:id`) — same shape as
   #1, lower blast radius (defaults to `true`, action only needed to turn quiz OFF).
3. **No admin UI to create a `tenants` row** (§Step 1) — low priority, `curl` works.
4. **FOLLOW-642 (ingest per-tenant origin enforcement) is P1-active but not yet merged** — until it
   ships (or the interim `PROD_ALLOWED_ORIGINS` literal-add mitigation is applied per domain), a new
   external brand's domain **cannot** call ingest at all. Time-critical given the 2-4 week client
   timeline.
5. **FOLLOW-639 (quiz definition editor) not yet shipped** — brands get the SDK's built-in default
   quiz tree only; §Step 5 is a placeholder until it lands.
