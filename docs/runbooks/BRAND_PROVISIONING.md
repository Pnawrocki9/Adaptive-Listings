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
      control-plane env **and** as an ingest Worker secret — see §Step 0 below. This is a one-time
      platform flip, not a per-brand step.
- [ ] **`CLOUDFLARE_API_TOKEN`** (Doppler `prd`) — needed only by §Step 6's projection script, to
      write the brand's api-key KV record. Not needed for §Steps 0-5, 7.

---

## Part A — Control-plane provisioning steps

### Step 0 — ONE-TIME platform flip before the first external brand (`FIRST_PARTY_TENANT_ID`)

**Run this once, before the first non-Estalara brand is provisioned. It is not a per-brand step —
but skipping it silently corrupts the compliance record of every external brand.**

Set `FIRST_PARTY_TENANT_ID` (control-plane env / Doppler + Vercel) to the UUID of the Estalara
first-party tenant. `isFirstPartyTenant` in `apps/control-plane/src/lib/brand-identity.ts` reads it
as the first-party allowlist.

**Why it is load-bearing (FOLLOW-654, PR #624):** when the env is UNSET, `isFirstPartyTenant` treats
**every** tenant as first-party, so `consent_text_hash` may be omitted on registration and silently
defaults to the canonical _Estalara_ hash. For an external brand that fabricates the audit record —
the consent log would attest that the visitor accepted Estalara's text when they accepted the
client's. Today the env is unset and the only live tenant IS Estalara (verified in prod 2026-07-26:
exactly one `tenants` row) — correct by accident; that stops being true with the first client.

**Code-level backstop SHIPPED (FOLLOW-660, PR #627, merged 2026-07-26) — this checklist item is no
longer the only defence.** The env-only check above is the no-DB fast path; a SECOND gate now runs
once the DB client exists (`requiresExplicitConsentHash`, same module). With the env UNSET it probes
the tenant count and starts requiring an explicit `consent_text_hash` (400) as soon as more than one
tenant exists, and fails CLOSED if the count cannot be read — so a forgotten env can no longer
silently attest the wrong consent text. Setting the env is still the recommended step: the guard
stops corruption, it does not make the env optional (with 2+ tenants and no env, external
registrations get a 400 until you set it).

```bash
doppler secrets set FIRST_PARTY_TENANT_ID=<estalara-tenant-uuid> --config prd
# Vercel envs are separate from Doppler — set it there too (see project_wave0 trap notes).

# SAME value is now also read by the INGEST WORKER (FOLLOW-658) — set it there too:
cd apps/ingest && pnpm exec wrangler secret put FIRST_PARTY_TENANT_ID --env production
```

**Second consumer (FOLLOW-658):** the ingest Worker uses the same UUID to enable the origin-gate
provisioning guard. With it set to a **well-formed UUID that matches the real first-party tenant
id**, any tenant OTHER than this one whose api-key KV record has no `allowed_origins` is refused
`403 origin_policy_unconfigured` instead of silently inheriting Estalara's own origin list (§Step
6). With it UNSET, blank, OR MALFORMED (not a well-formed UUID once trimmed + lower-cased —
FOLLOW-678), the guard degrades to OFF — a forgotten OR garbled value can never black-hole
first-party traffic, it only leaves the old silent behavior in place.

**A value that IS a well-formed UUID but simply the WRONG one is NOT safe** (FOLLOW-678) — a
mistyped digit or the wrong tenant's UUID pasted here is indistinguishable from an intentional
`explicit` origin scoping and will 403 **every** first-party browser request
(`origin_policy_unconfigured`) the moment this step is applied, because `app.estalara.com` /
`admin.estalara.com` traffic then looks like an un-provisioned external tenant. This is exactly the
step most likely to be run for the first time under this runbook — verify it below before moving on.

Verify:

1. `GET /api/v1/consent/platform-registration` for an external tenant must NOT emit the Estalara
   legal identity **as that brand's controller** — i.e. the opening sentence must read
   `"<Client Brand> Adaptive Listings service (provided by <Client Legal Entity>)"`, never
   "Estalara" / "Time2Show, Inc." (see §Step 3a). **[NARROWED 2026-08-07, FOLLOW-815 / FOLLOW-711.**
   This step used to say "must NOT emit the Estalara legal identity" flat, and that is no longer the
   check to run: since `platform-v1.4-2026-08-07` the consent text names Estalara / Time2Show, Inc.
   exactly ONCE on purpose, in the closing sentence, as the **processor** operating the service for
   the brand — the CEO's ruling (FOLLOW-814 item 3) chose an honest processor disclosure over a
   per-brand contact rendered from `brand_config`. Grepping the response for "Estalara" will
   therefore MATCH for a correctly-provisioned external tenant. Check the opening sentence and the
   `brand_name` / `legal_entity` fields, not the whole body.**]**
2. **Post-flip ingest verification (FOLLOW-678) — MANDATORY, do not consider this step done without
   it.** After `wrangler secret put FIRST_PARTY_TENANT_ID` above, POST one test event from an
   allow-listed first-party origin (`https://app.estalara.com`) and require a **2xx** response
   before moving on. No `X-Estalara-Signature` header — the browser SDK never sends one (its `pk_`
   key is origin-locked, not HMAC-signed); the gate under test is the `Origin` header, not the
   signature. The `type` is deliberately the invalid `page_view` (real is `page.view`) so a request
   that clears every gate still writes NOTHING — zero-persistence by construction, safe to run
   against prod. This is the exact same probe as `INGEST_WORKER_DEPLOY.md` §4 Probe C; run that
   runbook's Probe B too if you want the negative case (a non-allow-listed origin) covered as well:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://ingest.estalara.com/v1/events \
     -H "Content-Type: application/json" \
     -H "X-Estalara-API-Key: <estalara-tenant-api-key>" \
     -H "Origin: https://app.estalara.com" \
     -d '{"events":[{"type":"page_view","session_id":"diag-probe","ts":"2026-01-01T00:00:00.000Z"}]}'
   ```

   - **`200`** → the flip is correct (the response body has `accepted:0, rejected:1` from the
     deliberately-invalid `type` — that is expected, not a failure); the guard now protects external
     brands without touching first-party traffic.
   - **`403` (`origin_policy_unconfigured`)** → `FIRST_PARTY_TENANT_ID` is set to a well-formed UUID
     that does **not** match the real first-party tenant id — re-check the value you pasted against
     the `tenants.id` for Estalara, fix it, and re-run this probe. Do NOT proceed to onboard an
     external brand until this returns `200`.
   - **`403` (`forbidden_origin`) or reaches schema validation with no origin check at all** → the
     ingest Worker is not deployed / not on current code — see `INGEST_WORKER_DEPLOY.md` before
     continuing.

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

**Status: SHIPPED — FOLLOW-659 (PR #629).** The section below is rewritten against the merged code.
Two things changed from the pre-merge text that stood here:

- The `PATCH /api/config` call below **now actually works.** Before FOLLOW-659 the route's Zod
  schema knew only `primary_color` / `logo_url` / `white_label`, so it **silently stripped**
  `brand_name` / `legal_entity` and returned 200 — the curl looked successful and wrote nothing.
- Worse, the PATCH rewrites the whole `brand_config` blob, so **any** later Save from
  `/admin/tenants/[id]/settings` (e.g. a logo change) **wiped** a hand-seeded legal identity and
  silently reverted that brand to "Estalara". Both keys are now parsed, merged and written back, and
  the settings page has a **Legal Identity** fieldset — the preferred way to set them.

```bash
curl -s -X PATCH "https://admin.estalara.com/api/config?tenant_id=<id>" \
  -H "Content-Type: application/json" \
  -H "Cookie: <staff SSR session cookie>" \
  -d '{"brand":{"brand_name":"<Client Brand>","legal_entity":"<Client Legal Entity Sp. z o.o.>"}}'
```

Same staff rules as §Step 3 (rank ≥ `estalara:ops`, atomic `staff_audit_log` row, 404 on an unknown
tenant). Bounds: `brand_name` 1–120 chars, `legal_entity` 1–200 chars; `null` clears a key back to
the Estalara fallback. Re-read with `GET /api/config?tenant_id=<id>` — an unset key comes back as
**`null`**, never as a pre-resolved `"Estalara"`, so the response distinguishes "not provisioned"
from "provisioned as Estalara".

**Runtime enforcement (FOLLOW-659) — what happens if you skip this for an external brand:**

| Surface                                      | Behaviour when a NON-first-party tenant has no `brand_name`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/consent/platform-registration`  | **409 `brand_identity_not_provisioned`** — REFUSES to serve consent text that would name Estalara as the client's controller. Registration is blocked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `POST /api/v1/consent/platform-registration` | **HYBRID** (FOLLOW-684 → FOLLOW-697 → FOLLOW-707) — it alerts on this case, and refuses only the sub-case it can PROVE wrong. The three ↳ rows below break it down by what the caller submitted. Unlike the rest of this table they are **not** scoped to the unprovisioned case only — the POST's behaviour depends on the identity state AND on the hash, so both are stated per row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ↳ …caller sends the CANONICAL Estalara hash  | **422 `consent_text_hash_fabricated`, nothing written.** Keyed on the EVIDENCE, not the diagnosis (FOLLOW-697): fires both when the tenant is a **proven-external** brand still on the fallback identity, AND when the tenant IS provisioned with some other display identity (there the route computes what the correct hash would have been, so the submitted one is provably wrong). **Never fires for the first-party tenant** — for Estalara the fallback identity IS the correct identity (FOLLOW-698).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ↳ …caller sends some OTHER hash              | **201, written, plus a Sentry alert — for a PROVISIONED tenant whose rendered hash it does not match.** Unverifiable is not provably wrong; refusing would break legitimate translated copy, so the alert is the entire compensating control (FOLLOW-700/708 own its routing). For a tenant on the fallback identity classified `first_party`, no alert and no refusal at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ↳ …caller OMITS `consent_text_hash`          | **201** — but for a PROVEN-external tenant the omission is already refused one step earlier with a `400` (FOLLOW-654 leg 2 / FOLLOW-660), so this row is reachable only for first-party or unattributable tenants. Since FOLLOW-707 the written default is the tenant's OWN rendered hash whenever its identity is provisioned; only a fallback identity falls back to `CANONICAL_CONSENT_TEXT_HASH` — which since **FOLLOW-815 is no longer a placeholder** but the real digest of the text this server renders for the first-party identity, derived from the renderer rather than hand-typed. **ONE exception (FOLLOW-815):** on the §Step 3b grace band — the caller attests the PREVIOUS `tos_version` — an omitted hash is written **NULL**, not defaulted, because this server no longer renders the text that version names and a defaulted digest would attest a text the subject never saw. The grace-window Sentry warning says so explicitly. Discouraged either way; the caller should GET-then-echo (`backlog/HANDOFFS.md` → FOLLOW-374, Step 1). |
| `POST /api/dsr/initiate`                     | **Sends the OTP e-mail anyway**, and raises a Sentry `error` (`brand_identity: unprovisioned_external`). Never blocked — see below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Estalara's own first-party tenant            | Its Estalara identity is correct, not a fallback artefact, so the gates above do not fire for it. **Conditional, not unconditional** (FOLLOW-698): first-party status is decided by `FIRST_PARTY_TENANT_ID`, falling back to a tenant-count probe. Leave the env unset once a second tenant row exists and Estalara itself is classified external.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

The asymmetry is deliberate: refusing consent text stops a _wrong legal attestation_ from being
created, while refusing a DSR e-mail would obstruct the data subject's Art. 15/17/20 right over an
operator config gap — a worse compliance outcome than a mis-branded sender name. So the DSR path
alarms ops instead of punishing the data subject.

"Non-first-party" is decided by the **same** predicate as §Step 0's consent-hash gate
(`FIRST_PARTY_TENANT_ID`, falling back to a tenant-count probe when the env is unset, **failing
closed** on a read error). Consequence worth internalising: **the moment a second tenant row exists
with `FIRST_PARTY_TENANT_ID` still unset, every tenant — including Estalara — is treated as
external** and the consent GET starts refusing. Do §Step 0 first, as it already says.

### Step 3b — Rotating the platform-registration `tos_version` (consent-text version bump, FOLLOW-715)

**Read this BEFORE bumping `PLATFORM_REGISTRATION_TOS_VERSION`
(`apps/control-plane/src/app/api/v1/consent/platform-registration/lib.ts`).** That constant is
checked against every `POST /api/v1/consent/platform-registration` call, and the caller
(`app.estalara.com`, out of this repo, no shared release train) sends whatever `tos_version` its own
last deploy hardcoded. Bumping the server constant with no ramp turns the very next registration
into a hard `422 tos_version_superseded` the instant this repo deploys — that IS the outage
FOLLOW-712 introduced and FOLLOW-715 exists to make survivable. Follow the steps below **in order**;
do not bump the constant and stop.

> **THE FIRST REAL EXECUTION OF THIS PROCEDURE IS THE FOLLOW-815 BUMP (merged 2026-08-07),
> `platform-v1.3-2026-06-21` → `platform-v1.4-2026-08-07`.** Concrete values for step 1, so the
> operator does not have to derive them:
>
> ```
> PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS = platform-v1.3-2026-06-21
> ```
>
> **Set that in Doppler `prd` AND in Vercel BEFORE (or in the same window as) the deploy that
> carries the bump — they are not synced.** If it is not set when the new code goes live, every
> registration on `app.estalara.com` returns `422 tos_version_superseded` from the first request
> until Rafał's side redeploys, because the live caller hardcodes the v1.3 string
> (`backlog/HANDOFFS.md` → FOLLOW-374 Step 2). With it set, the caller keeps getting `201` and only
> a `warning` alert changes. Two things are different on the grace band after FOLLOW-815 and both
> are intended: the row is written under `platform-v1.3-2026-06-21` (never coerced), and if the
> caller also omits `consent_text_hash` — which today's live caller does — the hash column is
> written **NULL** rather than defaulted, because this server no longer renders the v1.3 text. Those
> NULL-hash rows are a small, dated, self-identifying population; scope them into FOLLOW-706's
> remediation rather than treating them as a new defect.

1. **Bump the server.** Edit `PLATFORM_REGISTRATION_TOS_VERSION` in `lib.ts` to the new value
   (matching the newly DPO-reviewed §6.1 text — see the `consent-text-sync` CI gate this same PR
   must keep green), and in the **same PR** set the deploy environment's
   `PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS` to the value `PLATFORM_REGISTRATION_TOS_VERSION`
   held **before** this bump (Doppler `prd`, and Vercel separately — they are not synced, same trap
   as `SENTRY_DSN_CONTROL_PLANE` elsewhere in this runbook). Deploy. From this point, the route
   accepts EITHER the new version OR that one previous version — never anything older.
2. **The alert fires.** The next registration call that still sends the old (now-previous)
   `tos_version` is accepted (`201`, written under the version it actually attested — never coerced
   to the new one) and raises a `warning`-level Sentry alert tagged
   `tos_version_grace: previous_version_accepted` (route: `consent/platform-registration`). **This
   tag is a distinct axis from the `brand_identity` tag family FOLLOW-700/708 registers — coordinate
   it into that registry when it is built; it is not a fourth `brand_identity` value (Rule AJ).**
   Confirm the alert is actually reaching Sentry the same way §Part C step 7 confirms the
   `brand_identity` alerts do (`SENTRY_DSN_CONTROL_PLANE` set in both Doppler `prd` and Vercel).
3. **Notify Rafał.** The alert is the signal that `app.estalara.com` is still on the previous
   `tos_version` — tell him directly (do not wait for him to notice the alert himself) that a
   consent-text bump shipped and his deployment needs to pick up the new `tos_version` (and, if the
   text itself changed meaning, the new `consent_text_hash` — GET-then-echo per
   `backlog/HANDOFFS.md` → FOLLOW-374, Step 1).
4. **Caller redeploys.** Rafał's side updates and redeploys against the current `tos_version`.
   Verify by watching the alert stop firing (same "confirm the alert stops" pattern §Part C step 7
   uses for the DSR/consent `brand_identity` alerts).
5. **Close the window.** Once the alert has stopped firing (no more registrations arrive on the
   previous version), **unset** `PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS` in Doppler `prd` AND
   Vercel and redeploy. After this, the previous version hard-refuses again with
   `422 tos_version_superseded`, exactly like every version older than it already does.

**Window-closing design decision (recorded here per FOLLOW-715 AC-4): manually closed, not
time-based.** A time-based window (e.g. "auto-expire 72h after the bump") was considered and
rejected: nothing in this repo today monitors window expiry (no cron, no scheduled check, no
dashboard), so an unnoticed time-based expiry would silently turn back into the exact outage this
window exists to prevent — on a delay, at whatever hour the timer happened to fire, with no operator
action having caused it. A manually-closed window fails safe instead: it stays open (with a
`warning` alert on every use, so a caller left on the previous version is never silently tolerated)
until an operator deliberately closes it in step 5 above. The cost is symmetrical and smaller:
forgetting to close it just leaves the ramp open a little longer than necessary, loudly, not an
unattended registration outage. If a monitored-expiry mechanism (e.g. a scheduled check that pages
when the window has been open longer than N days) is ever added, revisit this decision — the
tradeoff being weighed, not the conclusion, is what must survive that change.

**Do not chain grace windows.** `PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS` holds exactly ONE value
— the version immediately before the current `PLATFORM_REGISTRATION_TOS_VERSION`. If a second text
bump happens before the first window is closed (step 5), close the first window before opening the
second — the grace band is a one-version migration ramp, not an accumulating amnesty for every
version ever served.

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

**Provisioning action for a new external brand (UPDATED — FOLLOW-658):** run the projection script
once the domain is known. It is the only in-repo writer of `KV_API_KEYS`.

```bash
# DRY RUN first — writes nothing to either store, prints exactly what it would do:
DATABASE_URL_ADMIN=<service-role url> pnpm exec tsx \
  apps/control-plane/scripts/project-allowed-origins.mts \
  --tenant-id <tenant-uuid> \
  --api-key <raw est_pub_… key captured in §Step 2> \
  --namespace-id 523aafacf2d54201a33631d62ba801e3 \
  --origins https://listings.clientx.com

# Same command + --apply to write for real (needs CLOUDFLARE_API_TOKEN in the environment —
# docs/runbooks/cloudflare.md). It then does BOTH writes, in this order:
#   1. tenants.allowed_origins  ← --origins   (only when the column is still the [] default)
#   2. the api_key:<raw key> KV record        (read-modify-write, other fields preserved)
```

`--origins` is how the Postgres column gets set at all: there is **no HTTP writer** for
`tenants.allowed_origins` (the staff settings control was removed as an unenforced facade by
FOLLOW-622 / PR #618, and re-adding one is a product decision, not this script's). Omit `--origins`
on a re-run and the script simply projects whatever Postgres already holds. Supplying `--origins`
that **differs** from a configured column is refused, not applied.

What the script guarantees, and why you should not hand-write the JSON instead:

- **Reconciles the two stores before writing.** SHA-256 of the raw key must match a live (non-
  revoked, non-expired) `api_keys` row **owned by the tenant you named**; otherwise it refuses. A
  typo cannot seed a KV record for the wrong brand.
- **Refuses the `[]` trap.** Postgres `[]` means "not configured"; KV `[]` means **deny-all**. The
  script never projects the empty default — it stops and makes you state the intent
  (`--on-empty=deny-all` for a deliberate lock-down, `--on-empty=inherit-env` for the first-party
  tenant only).
- **Read-modify-write.** An existing record's `hmac_secret` and every other field survive verbatim.
  If the record does not exist yet it is created from Postgres — but only for a `public` key (a
  `secret` key needs an `hmac_secret` that Postgres does not store; seed that one by hand).
- **Refuses malformed origins** rather than silently dropping them the way the read path does.

> **FAIL-LOUD (FOLLOW-658, replaces the previous fail-silent hazard):** if you skip this step, an
> external brand's key resolves to the `inherit` policy — which is **Estalara's own** origin list.
> With the ingest Worker's `FIRST_PARTY_TENANT_ID` set (§Step 0), that now returns **403
> `origin_policy_unconfigured`** with a Sentry `error`, instead of silently inheriting. With the var
> unset the old behavior remains: the brand's own domain is rejected as `forbidden_origin` while its
> key still works from `app.estalara.com` — confusing and mis-scoped. **Set the var (§Step 0) and
> run this step.**
>
> ⚠️ **CORRECTED 2026-08-12 (FOLLOW-965): the 403 is real, the Sentry `error` is not delivered.**
> The Worker's capture sits behind `SENTRY_DSN_INGEST`, unset in prod (`INGEST_WORKER_DEPLOY.md`
> §signal register, RETRO-266); the control plane's sits behind `SENTRY_DSN_CONTROL_PLANE`, absent
> from every Vercel environment (measured 2026-08-12, `observability.md` §Control-plane Sentry
> signals). **Do not plan a go-live around being paged for this.** The refusal is observable only in
> the HTTP response and in runtime logs until a DSN is set and one event is OBSERVED arriving.

> **GAP (open, not a blocker):** there is still no admin UI / HTTP writer for
> `tenants.allowed_origins` (§Step 3's `/api/config` writes only `brand_config`). The script's
> `--origins` is a provisioning-time service-role write and is therefore **not** in
> `staff_audit_log`, unlike the ADR-0018 staff routes. Restoring an audited HTTP writer is a product
> decision (it reverses part of FOLLOW-622 Option B) — out of FOLLOW-658's scope.

**SECOND CONSUMER since FOLLOW-941 (PR #714) — this column is no longer ingest-only.** The
control-plane CORS gate now reads `api_keys.allowed_origins ?? tenants.allowed_origins` on
`/api/adapt*` and `/api/quiz/completion`. Note the semantics differ from KV again: here a populated
list takes **precedence over** the platform list, so populating this column for the ingest
projection above now also decides who may call the control plane. For the **first party** that
precedence is explicitly softened (FOLLOW-946, `origin-policy.ts`): Estalara additionally keeps
`CORS_PROD_ORIGINS`, so doing this documented step for Estalara's own tenant cannot lock Estalara
out of its own control plane. **An external brand gets no such fallback** — its list is the whole
answer, which is FOLLOW-658's rule one layer up.

**Measured in prod (FOLLOW-946 AC(1)(3)) — registered as [MP-001], not restated here:**

```
SELECT id, name, allowed_origins FROM tenants;
 cbc51cfa-1056-40aa-b0a9-6e982b52b1de | app.estalara.com pilot | []

SELECT tenant_id, allowed_origins FROM api_keys WHERE revoked_at IS NULL;
 cbc51cfa-1056-40aa-b0a9-6e982b52b1de | null
 cbc51cfa-1056-40aa-b0a9-6e982b52b1de | []
```

Both levels are unconfigured, so the live first-party tenant falls through to the platform list and
PR #714 changed **no** live request. The date, the re-measurement trigger and the owner live in
`docs/ops/MEASURED_PREMISES.md` [MP-001], which a CI gate reads; this transcript is the shape of the
result, not the authority on whether it is still true.

> ### 🛑 §Step 6 BLOCKS on re-measuring [MP-001] — this is a gate, not a request [FOLLOW-952 AC(4)]
>
> The previous version of this section said _"Re-verify this the moment §Step 6 is run for any
> tenant"_. **Nothing read that sentence.** It was an unenforced human obligation addressed to an
> operator who has no reason to open `origin-policy.ts`, asking them to re-check a premise whose
> only other home was a comment in that file — and §Step 6 is the very step this runbook tells an
> operator to run for every new brand. The request was aimed at the exact event that invalidates it
> and still had no teeth.
>
> **The rule now:** running §Step 6 for ANY tenant falsifies [MP-001] by construction — that is what
> populating the column MEANS. So:
>
> 1. **Before** you run §Step 6, re-run [MP-001]'s `measure_with` queries and record the result.
> 2. **After** the run, update [MP-001] in `docs/ops/MEASURED_PREMISES.md` — new `measured_on`, new
>    `revalidate_by`, and a `claim` that says what is now true. If a populated list now exists, say
>    so; do not re-assert the old claim with a fresh date.
> 3. Confirm `FIRST_PARTY_TENANT_ID` still measures good ([MP-002]) **in the same sitting**.
>    Populating `allowed_origins` is what makes the first-party clause reachable, so [MP-002] stops
>    being latent and becomes load-bearing at exactly this moment.
>
> **Why this can block a runbook step but not a CI job.** CI has no read path to production
> Postgres, so no gate can verify step 1 or 3 — it can only notice that [MP-001] passed its
> `revalidate_by` date. The blocking obligation therefore lives here, at the trigger, where the
> person who invalidates the premise is standing. The CI gate is the backstop for the case where
> nobody ever runs §Step 6 and the premise simply rots.

> ### ⚠️ Running this step ARMS the `FIRST_PARTY_TENANT_ID` dependency — read this first [FOLLOW-951]
>
> Populating `allowed_origins` for **any** tenant makes `configured.length > 0` true, which is the
> only condition under which the control plane consults first-party identity to decide whether to
> ADD the platform origins on top of a tenant's own list. Until then that clause is unreachable.
> **Setting the env var and this clause becoming reachable are the same event**, which is why the
> gate lives here and not only in the code.
>
> Since FOLLOW-951 that clause is **fail-CLOSED**: it grants nothing unless `FIRST_PARTY_TENANT_ID`
> is a well-formed UUID that MATCHES the tenant. Unset, blank or malformed now yields `unverified`
> and grants nothing, where previously `isFirstPartyTenant` failed OPEN and would have handed
> **every** brand Estalara's two origins. The _unconfigured_ path is deliberately left permissive on
> `unverified` — see `origin-policy.ts` — because every live request takes it and requiring
> confirmation there would be an outage, not a fix.
>
> **Measured 2026-08-10 (FOLLOW-951 AC(3)) — two stores, and only one of them is read at runtime:**
>
> ```
> doppler secrets get FIRST_PARTY_TENANT_ID --config prd
>   cbc51cfa-1056-40aa-b0a9-6e982b52b1de        ← matches the live tenant id measured above
>
> vercel env ls production | grep FIRST_PARTY_TENANT_ID
>   FIRST_PARTY_TENANT_ID    Encrypted    Production    15d ago
> ```
>
> **The control plane runs on Vercel, so Vercel's value is the one that decides.** It is present but
> `Encrypted`, so its VALUE could not be read back — presence is confirmed, agreement with Doppler
> is **not**. Treat `unverified` as _believed inactive in prod, not proven_. Before running §Step 6
> for the first external brand, re-assert the Vercel value by a means that reads it (a deploy-time
> log line or a temporary diagnostic route), not by reading Doppler and assuming parity — the two
> stores have drifted before (the `prd` DB-URL naming inversion).
>
> ### What you will SEE if this is wrong — the symptom, not just the risk [FOLLOW-957 AC(4)]
>
> The section above tells you the danger. This tells you how it presents, because until FOLLOW-957
> the failure was silent and its only symptom was a lie:
>
> | where         | what appears                                                                                                                                                                                                                                                                                                               |
> | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | HTTP response | `403` with `first_party_unverified` — a DISTINCT reason from `forbidden_origin` (a genuinely disallowed origin) and from `origin_policy_unconfigured` (a provisioning gap)                                                                                                                                                 |
> | logs only     | `[brand-identity] FIRST_PARTY_TENANT_ID is unset\|malformed …` — a `console.warn`, once per server instance, in **Vercel runtime logs**. Its Sentry twin `first_party_tenant_id_unresolved` (tagged `consumer: authorisation`, `env_status: unset\|malformed`) is emitted but **NOT delivered** — see the correction below |
>
> **Before FOLLOW-943 + FOLLOW-957 the same event surfaced as `401 Invalid API key` on a correct
> key, with nothing in any log naming the cause.** If you are reading this while debugging that
> exact symptom on an OLD deploy, the cause is most likely here.
>
> ⚠️ **CORRECTED 2026-08-12 (FOLLOW-965) — where to actually look.** The row above said "logs /
> Sentry". **Sentry is not one of the places**: `SENTRY_DSN_CONTROL_PLANE` is absent from every
> Vercel environment (measured 2026-08-12), so `Sentry.init()` never runs and
> `first_party_tenant_id_unresolved` is a silent no-op, not a delayed send. Look in **Vercel runtime
> logs** (`vercel logs <deployment>` or the Vercel dashboard → Logs), filtering for
> `[brand-identity]`. Delivery status, check commands and the arming procedure:
> `docs/runbooks/observability.md` §Control-plane Sentry signals.
>
> ✅ **BETTER — ask the running instance directly (FOLLOW-973).** Logs are a weak instrument for
> this question: the warning fires only under authenticated traffic carrying an `Origin` header,
> once per instance, into an unsubscribed expiring stream — so its ABSENCE means nothing (Rule AR).
> Since 2026-08-12 there is a staff-only route that reads the env var in-process and reports its
> STATUS, never its value:
>
> ```bash
> curl -s -H "Authorization: Bearer $ADMIN_API_SECRET" \
>   https://admin.estalara.com/api/admin/diagnostics/first-party-tenant | jq
> ```
>
> ⚠️ **The host matters, and two obvious guesses are both wrong.** `app.estalara.com` is the
> SvelteKit product, not the control plane — it answers `302 → /en?back=…`. The Vercel-generated
> `adaptive-listings-control-plane-*.vercel.app` host is behind **Vercel Deployment Protection** and
> answers `302 → vercel.com/sso-api` for EVERY path, so the secret never even reaches the app.
> **`admin.estalara.com` is the control plane.** Verified live 2026-08-12 with negative controls:
>
> ```
> $ curl -s https://admin.estalara.com/api/admin/diagnostics/first-party-tenant
> {"error":{"code":"unauthorized","message":"Unauthorized: provide Bearer <ADMIN_API_SECRET> or a valid Estalara staff JWT"}}   # HTTP 401
> $ curl -so/dev/null -w '%{http_code}' https://admin.estalara.com/api/admin/diagnostics/definitely-not-a-route
> 404      # control: 401 above is THIS route refusing, not a blanket gate
> ```
>
> ```jsonc
> {
>   "env_status": "valid", // "unset" | "malformed" | "valid"
>   "resolves_to_known_tenant": true, // false ⇒ well-formed but WRONG uuid; null ⇒ could not tell
>   "tenant_status": "active",
>   "tenant_lookup_error": false, // true ⇒ the DB leg failed; do NOT read the null as "no"
>   "checked_at": "2026-08-12T…Z",
> }
> ```
>
> ✅ **Last measured 2026-08-12 18:49:03Z — Production is HEALTHY on this axis:**
> `{"env_status":"valid","resolves_to_known_tenant":true,"tenant_status":"active","tenant_lookup_error":false}`.
> `FIRST_PARTY_TENANT_ID` is a well-formed uuid resolving to a real ACTIVE tenant, so
> `first_party_unverified` is **not** live and no lockout is latent for §Step 6. This is a
> point-in-time fact about the deployment that served it — **re-run the curl** after any edit or
> rotation of the var, when a Vercel environment is added, or on any `first_party_unverified`
> symptom. Do not treat this line as permanent.
>
> **How to read it.** `env_status: "valid"` + `resolves_to_known_tenant: true` ⇒ first-party
> identity resolves on this instance and no lockout is possible from this cause. Anything else is
> actionable: `unset`/`malformed` ⇒ set the var (below); `valid` + `false` ⇒ the var holds a
> well-formed uuid that is **not a tenant** — a live lockout the day §Step 6 arms, escalate. `null`
> with `tenant_lookup_error: true` means the check could not run, which is NOT a pass.
>
> **Why a route and not `vercel env pull`.** Pull cannot read this project's variables at all —
> measured 2026-08-12: of 55 variables, the only 9 with values are Vercel/Turbo build-injected ones
> (`VERCEL_ENV`, `TURBO_*`, …); **every project-defined variable pulls empty**, including `NODE_ENV`
> and `VERCEL_URL`, which certainly have values. An empty pull is a tool artefact and has never been
> evidence. `vercel env ls` is a different call and proves only EXISTENCE
> (`FIRST_PARTY_TENANT_ID  Encrypted  Production`, 17d ago) — presence, not value.
>
> **The fix is always the same:** set `FIRST_PARTY_TENANT_ID` in **Vercel** — the store read at
> runtime — not only in Doppler. Presence is not agreement; the two have drifted before.

> **Also blocking the same event:** **FOLLOW-943** — the 403 origin refusal is collapsed into 401 by
> four of six callers, so on the day this arms, a misconfigured origin is indistinguishable from a
> bad key. Do not run §Step 6 for an external brand with FOLLOW-943 still open unless you are
> willing to debug that ambiguity live.

Origins must be **scheme+host+port, no path** (e.g. `https://listings.clientx.com`). Include every
origin the SDK actually posts from — apex vs `www`, and any non-production host used during §Part C.
(There is no Estalara staging environment — FOLLOW-878 / ESC-052; a brand's own staging host, if it
has one, still needs its origin allow-listed.)

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

| Input                         | Produced by                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenant_id`                   | Step 1                     | UUID; not secret, but is the fence for every per-tenant lookup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `api_key` (raw, `est_pub_…`)  | Step 2                     | **Visible only once** on first activation — capture it immediately; re-running Step 2 for an existing key returns only `<prefix>...<last4>`. Baked into the deployed instance's SDK snippet config, NOT the domain.                                                                                                                                                                                                                                                                                                                                                                                                                |
| Branding assets (logo, color) | Client, applied via Step 3 | `primary_color` / `logo_url` are ALSO stored in `tenants.brand_config` for the SDK-runtime consumer (§Step 3) — the deploy side's static branding (page chrome, favicon, etc.) and the AL runtime branding (widget color/logo) are two independent surfaces that should visually match but are not the same write.                                                                                                                                                                                                                                                                                                                 |
| `data-privacy-url` (REQUIRED) | Client (their policy page) | The brand's OWN Privacy Policy URL, set as `data-privacy-url` on the `sdk.js` script tag. **No generator in this repo emits it — it is hand-set per deployment, and the SDK treats it as optional (`if (options.privacyPolicyUrl)`, `packages/sdk/src/ui/consent-banner.ts:258`), so omitting it renders a consent banner with NO policy link and no error.** At one first-party tenant that was a UX nit; on a client domain under a client controller identity it is a GDPR Art. 13 transparency defect. Compliance classifies the consequence as a disguised P0 — `EXTERNAL_BRAND_GOLIVE_CHECK-2026-07.md` Axis 1. [FOLLOW-928] |
| Domain (once known)           | Client                     | Needed for §Step 6 (ingest CORS) — **not** needed for §Steps 1-5, 7 (domain-independence).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Outputs the deploy side must send back:**

| Output                                                                                                                                                                                                                       | Used for                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Live URL                                                                                                                                                                                                                     | §Part C verification (SDK-load check, origin-allow-list entry for §Step 6). |
| Confirmation the snippet (`estalara-detect.iife.js` + `sdk.js`, both served from `admin.estalara.com` per `packages/shared/src/domains.ts:41,57,73` — **never** the client's own domain) is installed on every listing page. | §Part C SDK-load verification.                                              |
| Confirmation `data-privacy-url` on that snippet resolves to the BRAND's policy page (not Estalara's, not absent).                                                                                                            | §Part C step 8 — the consent banner's "Learn more" target. [FOLLOW-928]     |

**Explicit non-requirement (domain-independence, re-stated):** the deploy side does **not** need to
tell this repo the domain before Steps 1-5 and 7 run — only §Step 6 needs it, to seed the brand's
`allowed_origins` on its KV api-key record (FOLLOW-642 shipped, PR #623).

---

## Part C — Per-brand verification checklist

Run this on every new brand after Part A + the deploy side confirms the live URL. Items marked
**[OPERATOR-GATED]** require prod access this runbook's author does not have (corrected 2026-08-07,
FOLLOW-878 / ESC-052 — there is no staging access to have) (real Supabase/ClickHouse/Vercel prod
credentials) and could not be executed as part of authoring this document — the local dry-run below
(§Dry-run log) is the closest verification possible without them.

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
   above proves traffic flows; it does **not** prove the brand is locked down. Replay the same
   `POST /v1/events` with the brand's api key and an `Origin` header of some other domain — expect
   **403 `forbidden_origin`**. A 2xx here means the brand's key would work from any site that stole
   it.

   **Reading the failure modes (FOLLOW-658):** if the FIRST call returns **403
   `origin_policy_unconfigured`**, §Step 6 never ran for this key — the KV record has no
   `allowed_origins` and the guard is refusing to let it inherit Estalara's list. If it returns 403
   `forbidden_origin` from the brand's OWN domain, the seeded list does not contain that origin
   (check apex vs `www`). Both are loud; neither should be retried, they are provisioning defects.

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
   **client's** brand and legal entity, not "Estalara". Since FOLLOW-659 the two failure modes are
   no longer symmetric — read the result accordingly:
   - **Consent GET returns 409 `brand_identity_not_provisioned`** → §Step 3a was never seeded.
     Nothing wrong was recorded (that is the point of the refusal); seed it and re-run.
   - **Consent POST returns 422 `consent_text_hash_fabricated`** → the caller sent the canonical
     Estalara hash for a tenant the route can prove it is wrong for. Nothing was written. Two fixes,
     and they are not interchangeable: seed §Step 3a if the brand is genuinely unprovisioned, **or**
     fix the caller to GET the text first and echo the returned hash (the canonical flow — see
     `backlog/HANDOFFS.md` → FOLLOW-374, Step 1). Re-running the identical request will 422 again.
   - **Consent POST returns 201 but a Sentry alert fires** → the submitted hash matches neither the
     tenant's rendered text nor the canonical constant. The record IS written and the attested text
     is unverified. Legitimate only if the brand displays translated copy; otherwise the caller is
     authoring its own text and must be moved to the GET-then-echo flow.
   - **Consent POST returns 422 `tos_version_superseded`** → the caller's hardcoded `tos_version` is
     older than the one this deploy serves. Nothing was written. A consent-text bump is a two-repo
     operation (FOLLOW-712): the out-of-repo caller must be updated in the same window. **Since
     FOLLOW-715, there is a bounded grace window for the ONE immediately-previous version — see
     §Step 3b below before assuming this is an outage.** Anything older than that one previous
     version still hard-refuses unconditionally; this is a migration ramp, not an amnesty.
   - **Consent POST returns 201 but a `warning`-level Sentry alert tagged
     `tos_version_grace: previous_version_accepted` fires** → expected during a §Step 3b grace
     window: the caller submitted the immediately-previous `tos_version` and it was accepted
     (written under the version it actually attested, not coerced). This is the visibility signal
     that a caller has not yet redeployed — see §Step 3b's response procedure.
   - **DSR e-mail arrives branded "Estalara"** → §Step 3a was never seeded, and a Sentry `error`
     tagged `brand_identity: unprovisioned_external` was raised for this exact request. The e-mail
     is sent on purpose (never block a data subject's right); seed §Step 3a and confirm the alert
     stops.
   - **Both look correct but §Step 0's `FIRST_PARTY_TENANT_ID` is unset** → the gate cannot tell
     first-party from external while only one tenant row exists. Still fix §Step 0 before the second
     brand goes live (FOLLOW-660).

8. **The consent banner links the BRAND's privacy policy.** [OPERATOR-GATED] [FOLLOW-928] On the
   live URL, trigger the consent banner and inspect the "Learn more ↗" link.
   - **Link present and points at the client's own policy page** → correct.
   - **No "Learn more" link at all** → `data-privacy-url` is missing from the snippet. The SDK
     treats the attribute as optional (`if (options.privacyPolicyUrl)`,
     `packages/sdk/src/ui/consent-banner.ts:258`), so this fails SILENTLY — there is no console
     error and no Sentry event. Send it back to the deploy side (§Part B). **Do not pass the go-live
     gate on the grounds that the banner rendered:** compliance marks this axis
     UNSATISFIABLE-PENDING-HANDOFF, not passed
     (`docs/compliance/EXTERNAL_BRAND_GOLIVE_CHECK-2026-07.md` Axis 1).
   - **Link points at an Estalara page** → the snippet was copied from the first-party deployment
     without re-pointing it. Worse than absent: the visitor is told a third party's policy governs
     processing performed under the client's controller identity.

   The disclosure TEXT itself is deliberately identical for every brand and is not part of this
   check (ADR-0021 §D3 — the consent-text request is byte-identical per tenant by design). Only the
   LINK is per-brand.

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
for real against the localhost pilot substrate and then prod before the first external brand goes
live (corrected 2026-08-07, FOLLOW-878 / ESC-052 — "staging" is not an option that exists).

---

## GAP summary — reconciled 2026-07-25 (FOLLOW-657 Leg 2)

The original list is kept with its resolution, so a reader can tell what actually closed from what
merely moved.

| #   | Original gap                                                                 | Status now                                                                                                        |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | No staff port for `POST /api/detect` / `POST /api/schema/activate` (§Step 2) | ✅ **CLOSED** — FOLLOW-657 Leg 1. Staff `?tenant_id=`, rank ≥ ops, atomic audit.                                  |
| 2   | No staff-override port for `quiz_enabled` (§Step 4)                          | ✅ **CLOSED** — FOLLOW-657 Leg 1 (`PATCH /api/tenants/:id`, tenant from `:id`).                                   |
| 3   | No admin UI to create a `tenants` row (§Step 1)                              | 🟡 **OPEN, low priority** — `curl` works.                                                                         |
| 4   | FOLLOW-642 ingest per-tenant origin enforcement not merged                   | ✅ **CLOSED** — read/enforce path PR #623; write path (projection script + fail-loud guard) FOLLOW-658 (§Step 6). |
| 5   | FOLLOW-639 quiz definition editor not shipped                                | ✅ **CLOSED** — PR #620; §Step 5 rewritten.                                                                       |

**Items that gated an external go-live — ALL THREE NOW CLOSED (2026-07-26). Each failed SILENTLY;
none of them errored, which is why they needed dedicated tickets rather than a bug report:**

1. ~~**FOLLOW-658**~~ — **CLOSED 2026-07-26 (PR #628).** A projection script now writes the KV field
   (§Step 6) and the ingest guard refuses a non-first-party tenant that is still on `inherit` with
   403 `origin_policy_unconfigured` (gated on §Step 0's `FIRST_PARTY_TENANT_ID`, which the ingest
   Worker now also reads). The PG `[]` = inherit vs KV `[]` = deny-all mismatch is handled by
   refusing the ambiguous empty case rather than projecting it. Still operator-run, by design — see
   §Step 6.
2. ~~**FOLLOW-659**~~ — ✅ **CLOSED 2026-07-26 (PR #629).** `PATCH /api/config` + the settings
   page's **Legal Identity** fieldset now write `brand_config.brand_name` / `legal_entity` (and no
   longer wipe them), and an un-seeded EXTERNAL brand no longer fails silently: consent-text GET
   returns 409, DSR still sends but raises a Sentry error (§Step 3a). Seeding is still a required
   provisioning step — what changed is that skipping it now announces itself.
3. ~~**FOLLOW-660**~~ — **CLOSED 2026-07-26 (PR #627).** An unset `FIRST_PARTY_TENANT_ID` no longer
   silently treats every tenant as first-party: `requiresExplicitConsentHash` falls back to a
   tenant-count probe and refuses (400) rather than defaulting the canonical consent hash when more
   than one tenant exists, failing CLOSED on a count-read error (§Step 0). Setting the env is still
   the recommended provisioning step — the guard is the backstop, not a replacement.

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
