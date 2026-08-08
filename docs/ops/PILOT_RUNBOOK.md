# Pilot Runbook — app.estalara.com

**Status:** RATIFIED (measurement-quality gates) — 2026-05-25 (CEO Piotr Nawrocki).
**APPROVED_TO_IMPLEMENT: true.** Phase-0 ratified the **measurement-quality gates** (go/no-go
thresholds, abort rule, pre-live validation) answering AI Council blocking questions **B4**
(thresholds) and **B6** (abort rule). The **activation procedure** (§5) and **incident response**
(§6) sections remain TODO stubs to be completed by **TICKET-PILOT-002** (Sprint 13b Lane B). Source:
AI Council session `20260525_143939`.

> All `DECISION NEEDED` markers below are resolved with CEO-ratified values.

## 1. Go / No-Go checklist (must ALL pass before shadow→live)

- [ ] Sprint 13a Lane A complete + CI green: FOLLOW-105 (canonical route enforced), FOLLOW-094 +
      FOLLOW-098 (dashboards fail loud, expose `data_source`), FOLLOW-093 (single CTA-lift query
      vocabulary), FOLLOW-097 (`inquiry.started` emits in prod).
- [ ] `DOPPLER_TOKEN_DEV` + `E2E_BEARER_TOKEN` provisioned (ESC-010 / ESC-009).
- [ ] CTA-lift dashboard shows `data_source: 'clickhouse'` (NOT `mock`) for the pilot tenant — the
      RETRO-008 §5a provenance check.
- [ ] Runtime route verification: deployed app.estalara.com SDK calls the **canonical**
      control-plane `/api/adapt` (FOLLOW-105 substep 1a evidence).
- [ ] `cta.clicked` and `inquiry.started` rows confirmed landing in ClickHouse `events` for the
      pilot tenant during shadow mode (FOLLOW-092).
- [ ] Pilot freeze rule in effect (`docs/ops/PILOT_FREEZE_RULE.md`); no prohibited Lane C change
      live.
- [ ] CTA-lift metric spec ratified (`docs/specs/PILOT_CTA_LIFT_METRIC_v1.md`); primary window
      fixed.
- [ ] Incident owner confirmed (Piotr Nawrocki).
- [ ] Sign-off authorities confirmed: **Piotr** (window open/close, abort decision) + **Rafał**
      (mergeable Lane C approvals per the 4-check PR checklist) — per
      `docs/ops/PILOT_FREEZE_RULE.md`.
- [ ] **EU pre-flight: consent disclosure visible on banner for PL/EN/ES locales** — FOLLOW-128
      deployed; banner shows both the §13.1 consent-denial audit sentence and the §13.2
      cross-session identifier sentence in all three pilot locales. See §EU Pre-Flight below for
      full checklist.

## EU Pre-Flight Compliance Checklist (gates EU pilot go-live)

> **Regulatory basis:** GDPR Art. 5(3), ePrivacy Directive Art. 5(3), UODO (Polish supervisory
> authority). All items below must be DONE before app.estalara.com goes live for EU-resident
> visitors. Owner: Compliance Engineering. Source: DPIA §13.1 + §13.2 (FOLLOW-129).

- [ ] **FOLLOW-128 deployed to production.** `packages/sdk/src/ui/consent-banner.ts` COPY constant
      carries the §13.1 denial-audit disclosure and the §13.2 cross-session identifier disclosure
      for EN, PL, and ES locales. Verify by loading app.estalara.com in each locale and confirming
      the disclosure sentences are visible on the consent banner.
- [ ] **EU consent disclosure visible on banner for PL locale.** Banner text in Polish includes both
      disclosure sentences (§13.1 denial audit and §13.2 cross-session identifier).
- [ ] **EU consent disclosure visible on banner for EN locale.** Banner text in English includes
      both disclosure sentences.
- [ ] **EU consent disclosure visible on banner for ES locale.** Banner text in Spanish includes
      both disclosure sentences.
- [ ] **Privacy Notice template distributed to EU pilot tenant.** The tenant operating
      app.estalara.com has received `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §2 and §3
      paragraphs and has incorporated them into their public-facing Privacy Policy.
- [ ] **DPO sign-off on DPIA §13.1 LIA received.** DPO has reviewed and approved the consent-denial
      audit log legitimate interest assessment. Gate in `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md`
      §4 updated to DONE.
- [ ] **DPO sign-off on DPIA §13.2 LIA received.** DPO has reviewed and approved the cross-session
      identifier legitimate interest assessment. Gate in
      `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §4 updated to DONE.
- [ ] **§13.2 localStorage QA complete (owner: Compliance Engineering).** A QA engineer has manually
      confirmed on a **localhost pilot** session (`docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md`) that
      clicking "Deny" or "Withdraw" on the Estalara consent banner removes the cross-session
      `localStorage` key set by `renderConsentBanner`'s `onDenied` callback. This is a manual
      browser verification; it cannot be executed from CI. Status: **PENDING**. > ⚠️ **CORRECTED
      2026-08-07 (FOLLOW-878 / ESC-052 RESOLVED, CEO option 2).** This item said > "confirmed on a
      **staging** session … awaiting FOLLOW-128 **staging deployment**". There is > no staging
      environment and none is coming, so as written this checklist item was > **unexecutable** and
      would have blocked the pilot on an event that cannot occur. Re-targeted > at the localhost
      substrate.

## 2. Shadow-mode quality thresholds (answers B4) — RATIFIED

Measured during the ≥3-day shadow window before going live:

| Gate                             | RATIFIED threshold                                       | Rationale                              |
| -------------------------------- | -------------------------------------------------------- | -------------------------------------- |
| Event loss rate                  | ≤ 1% of expected events dropped                          | below this, counts are trustworthy     |
| ClickHouse ingestion delay (p95) | ≤ 5 min event→queryable                                  | dashboard freshness                    |
| Dashboard freshness              | data ≤ 15 min stale at readout                           | avoid stale go/no-go calls             |
| Error budget (adapt route 5xx)   | ≤ 0.5% over shadow window                                | route health                           |
| Route targeting                  | 100% of pilot SDK adapt calls hit canonical `/api/adapt` | no 3-bucket leakage (FOLLOW-105)       |
| Bot/QA exclusion verification    | ≥ 99% of known bots/internal sessions excluded           | validates the B5 filter is operational |

## 3. Pre-live validation steps

1. **24-hour instrumentation-only smoke test:** SDK loaded in shadow mode (zero DOM mutation);
   confirm `page.view / listing.viewed / cta.clicked / inquiry.started` flow producer→ClickHouse
   with loss rate under the §2 threshold.
2. **A/A dashboard validation:** before claiming any lift, split the holdout against itself (or two
   random halves of adapted) and confirm the dashboard reports **no** significant lift. A spurious
   "significant" A/A result means the metric or query is wrong — block go-live.
3. **Provenance check:** confirm `data_source: 'clickhouse'` end-to-end (FOLLOW-094).

### Migration sequencing (ESC-012 — Path 1, CEO decision 2026-05-28)

> **FOLLOW-308 (2026-06-14):** `.github/workflows/db-migrate.yml` auto-applies `pnpm db:migrate` on
> every push to `main` that touches `packages/db/migrations/**`. This eliminates the
> operator-driven-only gap that caused prod to drift 14 migrations behind (ESC-022 / RETRO-076
> OG-1). Manual fallback: `doppler run --config prd -- pnpm db:migrate`.
>
> ⚠️ **CORRECTED 2026-08-07 (FOLLOW-878 / ESC-052 RESOLVED, CEO option 2).** This note said the
> workflow applies "**to staging then prod**" and was "inert until `DOPPLER_TOKEN_STG` /
> `DOPPLER_TOKEN_PRD` are provisioned". Both tokens ARE provisioned, and the staging-first sequence
> never protected anything: `stg.DATABASE_URL_ADMIN` is byte-identical to `prd`, so **every merged
> migration has been applied to production twice**. Treat every merged migration as an unrehearsed
> production write — it must be additive and safe. Collapsing the workflow to a single prod apply
> and dropping `DOPPLER_TOKEN_STG` is **FOLLOW-873**, deliberately not done here (FOLLOW-878 AC(4):
> do not do that ticket's work twice).

**Mandatory order:** wizard creates tenant row → `pnpm db:migrate` → verify selector via SELECT.

**Why the order matters:** Migration 0016 (`0016_pilot_inquiry_selector.sql`) contains a
`RAISE EXCEPTION` guard that fires when the pilot tenant `000-app-estalara` is absent from the
`tenants` table. Drizzle's pg-core migrator wraps ALL pending migrations in a single transaction, so
0016's exception rolls back every co-pending entry (0017+ in the future) alongside it. Running
`pnpm db:migrate` before the Magic Link wizard has created the pilot tenant is the exact failure
mode ESC-012 documents — it was triggered during FOLLOW-149 Part D on prd.

**Verification step after migration:**

```sql
SELECT inquiry_submit_selector FROM tenants WHERE id = '<pilot-tenant-id>';
```

The column must be non-null. Do NOT infer success from the migration exit message alone.

**Troubleshooting — recovery pattern if Path (1) misfires:**

If `pnpm db:migrate` still raises on 0016 after the wizard has run (e.g., due to a wizard bug that
did not commit the tenant row), use the isolated apply pattern:

```sql
BEGIN;
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
  VALUES ('<migration-0016-hash>', extract(epoch from now()) * 1000);
-- run the migration SQL from 0016_pilot_inquiry_selector.sql manually here
COMMIT;
```

This mirrors the per-entry logic the migrator uses internally, without the cross-migration
transaction wrapping. It is the same approach used to apply migration 0015 to prd in FOLLOW-149 Part
D. Use this pattern only as a recovery tool — it bypasses the migrator's integrity checks. Once the
tenant row is confirmed present, `pnpm db:migrate` should apply cleanly from that point forward.

See `backlog/ESCALATIONS.md` ESC-012 for full context and rationale.

## 4. Abort rule (answers B6) — RATIFIED

**Scenario A — measured outcome (NULL / zero / negative lift).** A NULL/zero/negative result is a
**valid measured outcome, not a dashboard failure**. Do NOT "fix" the dashboard to show lift. The
continue/extend/abort call is **Piotr's only** (incident owner). Timeline matrix:

| Outcome                                            | Timeline                 | Action                                              |
| -------------------------------------------------- | ------------------------ | --------------------------------------------------- |
| NULL data (no holdout/adapted to compare)          | 24h from window open     | Pause, escalate Piotr, investigate ClickHouse + SDK |
| Zero significant lift (p>0.05), N < readout floor  | continuous               | Wait — collect more traffic                         |
| Zero significant lift (p>0.05), N ≥ floor (300/30) | 48h after reaching floor | Continue OR declare neutral result (Piotr)          |
| Negative lift (p<0.05), N ≥ floor (300/30)         | 24h after confirmation   | ABORT, retrospective, root-cause analysis           |

**Scenario B — correctness failure (fabricated/degraded data).** Dashboard shows
`data_source: 'mock'` or an error/degraded flag in production → **immediate abort of any readout**
until the data path is fixed. This is a correctness failure, not a result.

## 5. SDK snippet — canonical format (TICKET-PILOT-001)

The canonical snippet is generated by `buildSnippet()` in
`apps/control-plane/src/components/onboarding/DetectionPreview.tsx`. The correct `data-*` attribute
names are sourced from `packages/sdk/src/core/config.ts` `readConfig()`. Use these exactly — the
attribute names in the ticket spec Step 1 comment (`data-estalara-tenant`,
`data-estalara-decision-url`) are WRONG; the SDK reads different attribute names.

```html
<script
  src="https://cdn.estalara.com/sdk.js"
  data-tenant-id="<PILOT_TENANT_UUID>"
  data-api-key="<API_KEY>"
  data-decision-url="https://admin.estalara.com/api"
  data-inquiry-submit-selector="[data-estalara-slot='inquiry-submit']"
></script>
```

Attribute mapping (canonical source: `packages/sdk/src/core/config.ts`):

| HTML `data-*` attribute        | SdkConfig field         | Purpose                                                    |
| ------------------------------ | ----------------------- | ---------------------------------------------------------- |
| `data-api-key`                 | `apiKey`                | Tenant API key (required)                                  |
| `data-tenant-id`               | `tenantId`              | Tenant UUID (required for adapt route attribution)         |
| `data-decision-url`            | `decisionApiUrl`        | Control-plane base URL; SDK appends `/adapt`               |
| `data-inquiry-submit-selector` | `inquirySubmitSelector` | CSS selector for inquiry CTA; required for inquiry.started |
| `data-language`                | `language`              | Locale: `en` / `pl` / `es`; defaults to `en`               |

The `data-inquiry-submit-selector` value for app.estalara.com is
`[data-estalara-slot='inquiry-submit']` (from fixture `000-app-estalara/detail-ground-truth.json`).
The corresponding HTML element must carry `data-estalara-slot="inquiry-submit"`.

### Slots required on app.estalara.com for Tier 3 (from `000-app-estalara/detail-ground-truth.json`)

```html
<!-- Listing detail page -->
<h1 data-estalara-slot="headline">...</h1>
<p data-estalara-slot="description">...</p>
<button data-estalara-slot="inquiry-submit">Schedule a viewing</button>

<!-- Listing index page -->
<div data-estalara-slot="listing-grid">...</div>
<!-- per-card: each card needs data-estalara-listing-id="<id>" -->
```

### Smoke test for /api/adapt

Before SDK install, confirm `GET https://admin.estalara.com/api/adapt` returns 200 (not 410):

```bash
curl -s -o /dev/null -w "%{http_code}" \
  "https://admin.estalara.com/api/adapt?session_id=smoke&archetype=neutral&confidence=0.5&similarity=0.5&tier=1" \
  -H "Authorization: Bearer <ADAPT_API_KEY>"
```

Expected: `200`. If `404`: DNS for `admin.estalara.com` may not point to the Vercel deployment yet
(confirmed open issue as of 2026-05-29 — the domain resolves to an unrelated nginx server). In that
case use the Vercel preview URL until DNS is configured. Report to Piotr before proceeding.

## 7. Activation procedure — TODO (TICKET-PILOT-002)

## 5. Install the snippet (pilot)

The Magic Link wizard's "Save & Activate" step renders a copyable snippet (see
`apps/control-plane/src/components/onboarding/DetectionPreview.tsx:buildSnippet()`). For the Sprint
13a pilot it looks like:

```html
<script
  src="https://admin.estalara.com/sdk.js"
  data-tenant-id="<TENANT-UUID>"
  data-api-key="<EST_PUB_KEY>"
  data-decision-url="https://admin.estalara.com/api"
></script>
```

**Why `admin.estalara.com/sdk.js` and not `cdn.estalara.com/sdk.js`** — the canonical CDN host
(`SDK_CDN_URL` in `packages/shared/src/domains.ts`) is not yet provisioned (no R2 bucket, no release
pipeline, no SRI hashes). For the pilot we serve the IIFE bundle as a Vercel static asset from the
control-plane `public/` directory (resolved via `SDK_SERVE_URL`). Provisioning `cdn.estalara.com`
end-to-end is Phase 2 (see ESC-015 resolution). Until then, treat the admin host as the SDK origin
in every pilot install conversation.

Operator verification after first install:

```
curl -I https://admin.estalara.com/sdk.js
# Expect: HTTP/2 200, content-type: application/javascript
```

If that returns 404 / 5xx, the bundle did not ship with the most recent control-plane deployment —
re-run
`pnpm --filter @estalara/sdk build && cp packages/sdk/dist/estalara-sdk.iife.js apps/control-plane/public/sdk.js`
and redeploy. Do NOT instruct a tenant to flip the snippet `src` to `cdn.estalara.com` — that host
is not live.

## 6. Activation procedure — TODO (TICKET-PILOT-002)

_Stub. To be authored by TICKET-PILOT-002: exact steps to flip shadow→live, verify first adaptation
directive served, check Sentry for errors in the first N minutes._

## 8. Incident response — TODO (TICKET-PILOT-002)

## 7. Incident response — TODO (TICKET-PILOT-002)

_Stub. To be authored by TICKET-PILOT-002: rollback = remove SDK snippet OR set
`tenants.status='suspended'` for the pilot tenant; escalation path to Piotr as incident owner;
comms._

## Cross-references

- `docs/specs/PILOT_CTA_LIFT_METRIC_v1.md`, `docs/ops/PILOT_FREEZE_RULE.md`,
  `docs/adr/ADR-0006-canonical-adapt-enforcement.md`, QUEUE.md Sprint 13a/13b.
