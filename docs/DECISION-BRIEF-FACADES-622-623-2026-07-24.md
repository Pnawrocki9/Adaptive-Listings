# Decision Brief — FOLLOW-622 (`allowed_origins`) + FOLLOW-623 (`brand_config`) facades

**Date:** 2026-07-24 · **Author:** PM orchestrator (session 57) · **Audience:** CEO (Piotr)
**Status:** DECISION REQUESTED · **Source:** session-57 admin-surface audit
(`docs/ADMIN-SURFACE-AUDIT-2026-07-24.md`).

## What these are

Both are **producer-only facades** on the per-tenant settings page
(`admin/tenants/[id]/settings/tenant-config-editor.tsx` → `/api/config`): a staff operator edits a
value, it persists to the `tenants` table, and **no runtime code reads it**. They render as working
controls. The key insight: **they are NOT symmetric** under your single-tenant re-brand model
(memory `project_single_tenant_rebrand_model`), so they get different recommendations.

---

## FOLLOW-623 — `brand_config` (primary_color, logo_url, white_label)

**Recommendation: ENFORCE.** In your stated model — clients get a **full white-label deployment of
app.estalara.com on their own domain** (same app, same DOM; the SDK always runs inside OUR app,
never on a third-party site — CEO terminology clarification 2026-07-24) — per-tenant branding is not
cosmetic, it IS the private-label mechanism. A white-label client's widget / adapted DOM should
carry _their_ colors and logo. Right now that column is written and read by nothing, so
"white-label" is not actually delivered.

- **Enforce means:** the SDK-facing config path (`/api/config` or `/api/quiz/public-config`) exposes
  `brand_config`, and the SDK applies it to the widget / Shadow-DOM styling (colors, logo) instead
  of hardcoded defaults. Moderate effort, mostly SDK-side; no hot-path security risk.
- **Counter-argument (why you might defer):** at ONE first-party tenant (Estalara), the branding is
  Estalara's own, so there's no urgency _today_. But it's the exact feature the first external
  re-brand client will need, and leaving a dead "white-label" control is misleading.
- **Verdict:** enforce — it's aligned with the re-brand strategy and low-risk. If you'd rather
  defer, the honest interim is to hide the control until wired (don't ship a white-label toggle that
  does nothing).

## FOLLOW-622 — `allowed_origins` (SDK origin allow-list)

This one is a genuine **enforce-vs-de-scope** call — it's a _security_ control, and today it lies:
the docs (`tenants.ts:34`, `MASTER_DESIGN §V.3.4`, `api_keys.ts:33`) say the SDK origin is validated
per-tenant, but ingest CORS uses a hardcoded env list (`ingest/src/router.ts:69-73`) and nothing
reads `tenants.allowed_origins`. (It also has a validation bug: `z.string().url()` accepts paths/
schemes that can never match a browser `Origin` header — enforcing requires normalizing URL→origin.)

**Option A — ENFORCE now.** Ingest Worker CORS reads per-tenant `allowed_origins` (with the
URL→origin normalization fix, explicit empty-array semantics = deny-all vs inherit-env, per-request
tenant lookup

- cache). Delivers real key-scoping security: a leaked API key only works on the tenant's own
  domains.

* Cost: moderate; touches the ingest **hot path** (every request) → needs a cache + careful perf.
* Fits: the multi-client future (each re-brand on its own domain needs origin isolation).

**Option B — DE-SCOPE now, re-enable before first external client.** Remove the control from the
settings UI + drop `allowed_origins`/`sdk` from the `/api/config` contract; mark the column deferred
with a tracked re-enable FOLLOW. Removes a false security control.

- Cost: low; no hot-path risk.
- Fits: single first-party tenant (Estalara) on its own domain — the hardcoded env list already
  covers it, so per-tenant enforcement adds ~nothing _today_.

**Recommendation: Option B for now (de-scope) + a tracked ticket to ENFORCE before the first
external re-brand client onboards.** Reasoning: at one first-party tenant the control provides no
real protection the env list doesn't already give, and shipping a half-built enforcement on the
ingest hot path is riskier than removing a control nobody relies on yet. The moment you onboard an
external client on their own domain, flip to Option A (origin isolation becomes a real requirement
then). If you'd prefer the security feature ready _now_ (e.g. you expect a client imminently), take
Option A.

---

## Summary

| Ticket                           | Recommendation                                          | Why                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FOLLOW-623** `brand_config`    | **ENFORCE** (wire SDK consumption)                      | Private-label branding is core to the re-brand strategy; low-risk, SDK-side                                                                        |
| **FOLLOW-622** `allowed_origins` | **DE-SCOPE now + re-enable before 1st external client** | Security control that provides nothing at one first-party tenant; enforcing touches the ingest hot path — do it when a real external domain exists |

**Your call needed:** (1) 623 → enforce or defer? (2) 622 → enforce now (A) or de-scope-now (B)?
Once you rule, I dispatch the workers (the non-gated fixes 636/637/627 are already in flight).

---

## DECISION (CEO, 2026-07-24)

- **FOLLOW-623 `brand_config` → ENFORCE.** Wire SDK consumption of per-tenant branding.
- **FOLLOW-622 `allowed_origins` → OPTION B (de-scope now)** + a tracked FOLLOW to re-enable
  (per-tenant, data-driven) before the first external re-brand client onboards.

### Governing constraint — DOMAIN-INDEPENDENCE (CEO ruling, applies to ALL AL runtime)

`app.estalara.com` is **only** the white-label shell. The same app is re-deployed with each client's
branding on **their own domain** (e.g. `listings.clientX.com`). Therefore **Adaptive Listings
runtime must be independent of the domain it runs on**:

- Tenant identity is resolved from **`api_key` / `tenant_id`, never from the host /
  `window.location`.**
- **623:** SDK resolves branding by tenant identity, applied regardless of serving host (same app,
  different domains, different brands).
- **622 re-enable:** origin validation must be **fully per-tenant / data-driven from tenant config**
  — the current hardcoded env CORS list (`ingest/src/router.ts:69-73`) is the anti-pattern this
  ruling forbids. Our app's own domain is irrelevant; each client's origins come from their own
  config.
- General: SDK API base-URL resolution, CORS, and cookie-domain must all be domain-agnostic and
  tenant-keyed.

### Dispatch sequencing (file-collision note)

Both 622 (de-scope) and 623 (enforce) touch `apps/control-plane/src/app/api/config/route.ts` and
`.../settings/tenant-config-editor.tsx` — the **same files as FOLLOW-627 (PR #616, still open)**. To
avoid worktree collisions, dispatch 622/623 **after #616 merges**. FOLLOW-637 (PR #615) is
independent (analytics files) and can merge in any order.
