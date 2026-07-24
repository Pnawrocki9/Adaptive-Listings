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

**Recommendation: ENFORCE.** In your stated model — clients run Estalara **private-label**,
embedding the SDK on their own sites — per-tenant branding is not cosmetic, it IS the private-label
mechanism. A white-label client's embedded widget / adapted DOM should carry _their_ colors and
logo. Right now that column is written and read by nothing, so "white-label" is not actually
delivered.

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
