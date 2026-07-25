# Brand Provisioning Runbook (FOLLOW-652)

**Audience:** Piotr (CEO) — the sole operator of `admin.estalara.com`. **Status:** authored
2026-07-25, **reconciled the same day (FOLLOW-657 Leg 2)** against four PRs that merged after the
first draft — #620 (quiz definitions), #621 (this runbook), #623 (origin enforcement), #624
(per-brand identity) — plus FOLLOW-657's own staff port. Verified against the real HEAD code paths
(routes read + local dry-run against a throwaway tenant; see
[§Dry-run log](#dry-run-log-executed-2026-07-25-pre-follow-657)). **Backing design:**
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
  `/admin/tenants/[id]/*` (ADR-0018), plus one headless endpoint that predates ADR-0018's staff
  model (§Step 1). **§Step 2 and the `quiz_enabled` flip were ported to the staff model by
  FOLLOW-657** — the shadow-agency-account workaround they used to require is now break-glass only
  (see the emergency appendix).
- **The domain is not known until deploy time and the provisioning steps below do not require it up
  front** — only §Step 6 (ingest CORS) and the deploy-side HANDOFF (§Part B) need the real domain.

---

## Pre-flight — access & tools

- [ ] **`ADMIN_API_SECRET`** (Doppler `prd`) — headless admin auth for `POST /api/tenants` and the
      K.3.6 admin-intent routes' `Bearer` path.
- [ ] **A logged-in `estalara:superadmin` session on `admin.estalara.com`** — the CEO's existing
      staff account (prod has exactly one auth user today, per ADR-0018 §Context).
- [ ] **Supabase Auth Admin API access** (service role key, or the Supabase dashboard's Auth → Users
      → "Add user") — **no longer needed for the normal path** (FOLLOW-657 ported Steps 2 and 4 to
      the staff session); keep it only for the emergency appendix at the end of this file.
- [ ] The brand's **name** and a **URL-safe slug** (`^[a-z0-9-]+$`). The client's real domain is
      **not** required yet.
- [ ] **Before the FIRST external (non-Estalara) brand only:** `FIRST_PARTY_TENANT_ID` set in the
      control-plane env — see §Step 0 below. This is a one-time platform flip, not a per-brand step.

---

## Part A — Control-plane provisioning steps

### Step 0 — ONE-TIME platform flip before the first external brand (`FIRST_PARTY_TENANT_ID`)

**Run this once, before the first non-Estalara brand is provisioned. It is not a per-brand step —
but skipping it silently corrupts the compliance record of every external brand.**

Set `FIRST_PARTY_TENANT_ID` (control-plane env / Doppler + Vercel) to the UUID of the Estalara
first-party tenant. `apps/control-plane/src/lib/brand-identity.ts:146` reads it as the first-party
allowlist.

**Why it is load-bearing (FOLLOW-654, PR #624):** when the env is UNSET, `isFirstPartyTenant` treats
**every** tenant as first-party, so `consent_text_hash` may be omitted on registration and silently
defaults to the canonical _Estalara_ hash. For an external brand that fabricates the audit record —
the consent log would attest that the visitor accepted Estalara's text when they accepted the
client's. Today the env is unset and the only live tenant IS Estalara (correct by accident); that
stops being true with the first client. `FOLLOW-660` tracks a code-level guard so a forgotten env
cannot degrade silently — until it ships, **this checklist item is the only defence.**

```bash
doppler secrets set FIRST_PARTY_TENANT_ID=<estalara-tenant-uuid> --config prd
# Vercel envs are separate from Doppler — set it there too (see project_wave0 trap notes).
```

Verify: `GET /api/v1/consent/platform-registration` for an external tenant must NOT emit the
Estalara legal identity (see §Step 3a).

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
[§Dry-run log](#dry-run-log-executed-2026-07-25-pre-follow-657)):

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

**Auth on both routes (UPDATED — FOLLOW-657):** `resolveTenantAccess({ allowStaffOverride: true })`
— the **agency** path is unchanged (Bearer tenant JWT or an `@supabase/ssr` agency browser session),
and an Estalara **staff** session may now drive both routes directly by passing an explicit
`?tenant_id=<uuid>`, validated against `tenants`. **The CEO's superadmin session runs the whole
detect→activate wizard with no shadow account.**

**GAP-1 CLOSED (FOLLOW-657).** The original version of this step documented a shadow `agency:admin`
Supabase user as the only way to run the wizard, because both routes rejected staff sessions with
403 `STAFF_TENANT_CONTEXT_MISSING`. FOLLOW-657 ported both to the ADR-0018 §2 staff override, so
**the workaround is no longer part of the normal path** — it survives only as the emergency appendix
at the end of this file. Run the two routes as staff:

```bash
# 1. Detect the schema (staff — explicit tenant, no agency session)
curl -s -X POST "https://admin.estalara.com/api/detect?tenant_id=<tenant-id>" \
  -H "Content-Type: application/json" \
  -b "<your staff session cookies>" \
  -d '{"url":"https://<the brand deployment url>"}'

# 2. Review the returned schema, then activate it (staff)
curl -s -X POST "https://admin.estalara.com/api/schema/activate?tenant_id=<tenant-id>" \
  -H "Content-Type: application/json" \
  -b "<your staff session cookies>" \
  -d '{"schema": <the schema object from step 1>}'
```

Staff-path specifics to know before running:

- **Write rank ≥ `estalara:ops`** (satisfied by `estalara:superadmin`). `estalara:readonly` → 403.
- **The `ADMIN_API_SECRET` Bearer path is REJECTED for staff** on these routes (RETRO-187 — a shared
  secret is not attributable to a staff user). Use a real staff session; the headless secret works
  only on the routes that explicitly document it (§Step 1, §Step 7).
- **Unknown/soft-deleted `tenant_id` → 404**, so a typo'd id cannot create an orphan write.
- **Atomic audit (ADR-0018 §3a):** on the staff path the mutation and its `staff_audit_log` row
  commit in ONE transaction (`action: 'detect.schema_upsert'` / `'schema.activate'`). If the audit
  write fails, **everything rolls back** and the route returns 500 `AUDIT_WRITE_FAILED` — the change
  did NOT apply, so retry rather than assuming a partial success. (The agency path stays
  non-transactional and unaudited, per ADR-0018 §3 — unchanged.)
- **`api_key` is still returned once**, exactly as on the agency path — capture it immediately.

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

### Step 3a — Per-brand LEGAL identity (`brand_name` / `legal_entity`) — REQUIRED for external brands

**Do not skip this for a non-Estalara brand.** These two keys drive what the visitor is told in the
**consent** and **DSR** flows (`apps/control-plane/src/lib/brand-identity.ts`, PR #624 /
FOLLOW-654):

| Key            | Type             | Consumed by                                                   |
| -------------- | ---------------- | ------------------------------------------------------------- |
| `brand_name`   | string, 1–120 ch | DSR e-mail identity, consent text                             |
| `legal_entity` | string, 1–200 ch | The legal controller named in the consent/registration record |

They live under `tenants.brand_config` as **additive, server-side-only** keys — deliberately NOT on
the SDK public-config wire, so they cannot be set from the browser and are not part of §Step 3's
SDK-facing `brand` slice.

> **FAIL-SILENT HAZARD (FOLLOW-659):** no in-repo code writes these keys — they are **operator-
> seeded JSONB**. The consumer fails _honestly_ (absent → explicit `"Estalara"` fallback), so
> nothing errors — but an external brand's DSR e-mails and consent records will say **Estalara**
> until an operator populates them. There is no runtime alarm today. **Treat this step as mandatory
> for every external brand and verify it (§Part C step 7).**

Seed them alongside §Step 3 (same `PATCH /api/config` transaction and audit row):

```bash
curl -s -X PATCH "https://admin.estalara.com/api/config?tenant_id=<id>" \
  -H "Content-Type: application/json" \
  -H "Cookie: <staff SSR session cookie>" \
  -d '{"brand":{"brand_name":"<Client Brand>","legal_entity":"<Client Legal Entity Sp. z o.o.>"}}'
```

### Step 4 — `quiz_enabled` / `al_enabled` flags

**`al_enabled` (Adaptive Listings master ON/OFF) — staff-only, works directly, no workaround:**

Route `PUT /api/admin/tenants/al-state?tenant_id=<id>`
(`apps/control-plane/src/app/api/admin/tenants/al-state/route.ts`). UI:
`/admin/tenants/[id]/al-state`. **This route explicitly REJECTS agency sessions (403 `staff_only`)**
— unlike `/api/config`, there is no agency write path at all (`route.ts:11-14`); the CEO's staff
session is the _only_ valid caller, which is exactly the operating model here. Default is `true` on
row creation (migration 0034 default) — a freshly created tenant already has AL on; flip it off only
if the brand should go live "quiet" first.

**`quiz_enabled` (Investor Quiz widget master ON/OFF, distinct from the quiz _content_ config below)
— GAP-2 CLOSED (FOLLOW-657), staff-writable directly:**

`PATCH /api/tenants/:id` (`apps/control-plane/src/app/api/tenants/[id]/route.ts`) now takes the
ADR-0018 §2 staff override. Note the shape difference from §Step 2: **the tenant comes from the
`:id` path segment, not a `?tenant_id=` query param** — the route already had a tenant in the URL,
so adding a second source would have created two fences to keep in sync.

```bash
curl -s -X PATCH "https://admin.estalara.com/api/tenants/<tenant-id>" \
  -H "Content-Type: application/json" \
  -b "<your staff session cookies>" \
  -d '{"quiz_enabled": false}'
```

Same staff rules as §Step 2 (rank ≥ `estalara:ops`; unknown id → 404; atomic `staff_audit_log`
write, `action: 'tenant.quiz_enabled_update'`, 500 `AUDIT_WRITE_FAILED` rolls the flip back).
Default is `true` (quiz on) at row creation, so **most brands need no action here** — touch it only
if a brand should ship without the quiz widget. Still do **not** use a raw SQL
`UPDATE tenants SET quiz_enabled = …` shortcut: it bypasses the `staff_audit_log` trail every other
staff write in this runbook produces, breaking the audit-completeness invariant of ADR-0018 §3.

**Quiz _appearance_ (language, accent color, micro-polls) — staff-writable today, no workaround:**
`POST /api/quiz/config?tenant_id=<id>` / UI `/admin/tenants/[id]/quiz` (`StaffQuizConfigEditor`) —
this DOES support `resolveTenantAccess({ allowStaffOverride: true })` (`quiz/config/route.ts:4-9`).
Set language/accent color here per brand.

### Step 5 — Quiz _definition_ (questions, answers, branching, answer→archetype mapping)

**Status: SHIPPED — FOLLOW-639 merged (PR #620, `7f4aa1e`).** The quiz tree is now fully editable
per brand (questions, answers, branching, answer→archetype weights, i18n).

**Optional per brand.** A brand with **no** `quiz_definitions` row renders the SDK's built-in
`DEFAULT_QUIZ_DEFINITION` (EN), which reproduces the 17 legacy leaves byte-equivalently — so **doing
nothing here is a valid, supported outcome**. Only author a definition when the brand needs
different questions, different wording, or a different answer→archetype mapping.

**UI:** `/admin/tenants/[id]/quiz-definition`. **Route:**
`GET`/`PUT /api/admin/tenants/quiz-definition?tenant_id=<uuid>`
(`apps/control-plane/src/app/api/admin/tenants/quiz-definition/route.ts`).

- **STAFF-ONLY** — unlike §Step 4's appearance config, a resolved agency session is rejected 403
  `staff_only` (mirrors `al-state`). Write rank ≥ `estalara:ops`; headless `ADMIN_API_SECRET`
  rejected (RETRO-187).
- **Atomic + audited (ADR-0018 §3a):** the PUT deactivates the prior active row, inserts the new
  active version, and writes `staff_audit_log` (`action: 'quiz_definition.update'`) in ONE
  transaction. Versioned — saving does not destroy the previous definition.
- **Integrity is enforced on write, not by restricting edits** (CEO ruling, ADR-0019 D3): unknown
  archetype id, dangling `next`, cycles and duplicate ids **reject the save (400)**. The
  unreachable-archetype list is **non-blocking** and comes back as `warnings.unreachable_archetypes`
  — the editor surfaces it, it never blocks the save. A brand whose tree cannot reach some
  archetypes is a legitimate business choice.
- **Runtime consumption:** the active row is served in the `quiz_definition` slice of
  `GET /api/quiz/public-config` (keyed by `api_key`, domain-independent) and walked by the SDK's
  generic tree-walker. Verify per §Part C step 2.

### Step 6 — `allowed_origins` (ingest CORS allow-list for the brand's domain)

**Status: SHIPPED — FOLLOW-642 merged (PR #623, `d631a08`).** The section below is rewritten against
the MERGED code (`apps/ingest/src/origin-gate.ts` + `apps/ingest/src/auth.ts`), replacing the
pre-merge speculation that previously stood here.

**Where the allow-list actually lives: the KV api-key record, NOT the Postgres column.** Enforcement
reads `ApiKeyRecord.allowed_origins` from `KV_API_KEYS` — data the auth layer already fetched, so
the gate does zero extra I/O and stays inside the <50ms ACK budget. It is enforced on the real
`POST /v1/events` (where the api key is present), **not** on the CORS preflight — browsers strip
`X-Estalara-API-Key` from OPTIONS, so the tenant cannot be resolved there. A mismatch returns **403
`forbidden_origin` before any Redpanda/ClickHouse side effect**, so a stolen key on `evil.com`
ingests nothing.

**Three-state semantics — read carefully, `null` and `[]` are NOT the same:**

| `allowed_origins` | Meaning                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| absent / `null`   | **inherit** the env list (`PROD_ALLOWED_ORIGINS`) — the backward-compatible default for Estalara's own pre-FOLLOW-642 keys |
| `[]`              | **deny ALL browser traffic** for that tenant                                                                               |
| `["https://…"]`   | explicit allow-list — only these origins                                                                                   |

> **DANGER (two sources of truth, FOLLOW-658):** Postgres `tenants.allowed_origins` is
> `NOT NULL DEFAULT []`, where `[]` means _inherit_. KV reads `[]` as _deny-all_. **A naive PG→KV
> copy of an unset column flips the brand to deny-all and blocks all its browser traffic.** Never
> project the PG column mechanically; write the KV field deliberately.

**Provisioning action for a new external brand:** seed `allowed_origins` on the brand's KV api-key
record with the brand's real origin(s) once the domain is known.

> **FAIL-SILENT HAZARD (FOLLOW-658):** **no in-repo code writes this KV field** — a repo-wide grep
> finds zero writes to `KV_API_KEYS`; `schema/activate` writes only the Postgres `api_keys` table.
> The whole record is operator-seeded out-of-band. So until an operator seeds it, an external
> brand's key **silently inherits the env list** — i.e. no per-brand lock-down at all, with no error
> anywhere. Nothing in the code guarantees this step ran. (The doc comments in
> `packages/db/src/schema/tenants.ts` / MASTER_DESIGN §V.3.4 claiming the value is "projected onto
> the KV record at provisioning" **overstate reality** — FOLLOW-658 tracks both the projection and
> the correction.)

Origins must be **scheme+host+port, no path** (e.g. `https://listings.clientx.com`). Include every
origin the SDK actually posts from — apex vs `www`, and any staging host used during §Part C.

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
tell this repo the domain before Steps 1-5 and 7 run — only §Step 6 needs it, to seed the brand's
`allowed_origins` on its KV api-key record (FOLLOW-642 shipped, PR #623).

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

   **Then prove the negative — enforcement is per-brand, not inherited.** [OPERATOR-GATED] A 2xx
   above proves traffic flows; it does **not** prove the brand is locked down, because an unseeded
   KV record inherits the env list and lets the key work from anywhere (FOLLOW-658). Replay the same
   `POST /v1/events` with the brand's api key and an `Origin` header of some other domain — expect
   **403 `forbidden_origin`**. A 2xx here means `allowed_origins` was never seeded (§Step 6) and the
   brand's key would work from any site that stole it.

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
7. **The brand speaks in its OWN name (external brands only).** [OPERATOR-GATED] Trigger a DSR
   initiation and a consent registration for the brand and confirm the e-mail/consent text names the
   **client's** brand and legal entity, not "Estalara". Seeing "Estalara" means §Step 3a was never
   seeded, or §Step 0's `FIRST_PARTY_TENANT_ID` is unset — both fail silently by design (FOLLOW-659
   / FOLLOW-660), so this check is the only thing standing between a client and a compliance record
   written in the wrong company's name.

---

## Dry-run log (executed 2026-07-25, PRE-FOLLOW-657)

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
# No agency session → 401. NOTE (FOLLOW-657): this run predates the staff port — at the time
# there was no staff bypass to test because none existed. The 401-without-a-session result is
# still correct today; what changed is that an IDENTIFIED staff session + ?tenant_id now works.

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

## GAP summary — reconciled 2026-07-25 (FOLLOW-657 Leg 2)

The original list is kept with its resolution, so a reader can tell what actually closed from what
merely moved.

| #   | Original gap                                                                 | Status now                                                                                             |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | No staff port for `POST /api/detect` / `POST /api/schema/activate` (§Step 2) | ✅ **CLOSED** — FOLLOW-657 Leg 1. Staff `?tenant_id=`, rank ≥ ops, atomic audit.                       |
| 2   | No staff-override port for `quiz_enabled` (§Step 4)                          | ✅ **CLOSED** — FOLLOW-657 Leg 1 (`PATCH /api/tenants/:id`, tenant from `:id`).                        |
| 3   | No admin UI to create a `tenants` row (§Step 1)                              | 🟡 **OPEN, low priority** — `curl` works.                                                              |
| 4   | FOLLOW-642 ingest per-tenant origin enforcement not merged                   | ✅ **CLOSED for the read/enforce path** — PR #623. ⚠️ **write path still open: FOLLOW-658** (§Step 6). |
| 5   | FOLLOW-639 quiz definition editor not shipped                                | ✅ **CLOSED** — PR #620; §Step 5 rewritten.                                                            |

**Open items that now gate an external go-live (all fail SILENTLY — none of them errors):**

1. **FOLLOW-658** — nothing writes `allowed_origins` into the KV api-key record, so origin
   enforcement inherits the env list for an external brand until an operator seeds it by hand (§Step
   6). Also: PG `[]` = inherit vs KV `[]` = deny-all, so a naive projection blocks all traffic.
2. **FOLLOW-659** — nothing writes `brand_config.brand_name` / `legal_entity`, so DSR + consent name
   **Estalara** for an external brand until an operator seeds them (§Step 3a).
3. **FOLLOW-660** — `FIRST_PARTY_TENANT_ID` unset treats every tenant as first-party and can default
   the consent hash to Estalara's canonical text (§Step 0). Env checklist is the only defence until
   the code guard ships.

The common shape across all three: **a live consumer shipped without its producer.** Each is
operator-seeded state that no code writes and no alarm reports missing — which is exactly why §Step
0, §Step 3a and §Step 6 are written as mandatory, verified steps rather than notes.

---

## Emergency appendix — internal agency account (superseded, keep for break-glass only)

**Do not use this on the normal path.** Before FOLLOW-657 it was the only way to run §Step 2 / §Step
4, because both routes rejected staff sessions. It survives here solely for the case where the staff
port itself is unavailable (e.g. `resolveTenantAccess` regression) and a brand must still be
provisioned. It is **manual and off the ADR-0018 staff-audit trail** — prefer waiting for a fix.

Provision a one-off internal `agency:admin` Supabase Auth user scoped to the new tenant, use it
**only** to run the wizard, then leave it dormant or delete it. Never hand its credentials to the
client.

```
# Supabase Dashboard → Authentication → Users → Add user (or supabase.auth.admin.createUser)
email:        brand-ops+<slug>@estalara.com   (an internal alias, never given to the client)
app_metadata: {
  "tenant_id": "<the id from Step 1>",
  "agency_role": "agency:admin",
  "mfa_verified": true
}
```

(Shape verified against `resolveSsrSession` in `apps/control-plane/src/lib/session-auth.ts:122-136`
— `tenant_id` + `agency_role` are the two `app_metadata` keys the SSR-session reconstruction reads;
`agency_role` must be one of `agency:owner|agency:admin|agency:viewer`,
`packages/auth/src/jwt.ts:29-36`.) Log in as this user in a private browser session, run
`/dashboard/onboarding/detect` → paste the brand's URL → Save & Activate → copy the returned
`api_key`.

**If you use this path, record it manually** — the agency route is not audited, so the
`staff_audit_log` will show no trace of the provisioning.
