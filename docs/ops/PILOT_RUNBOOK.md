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
- [ ] **§13.2 staging localStorage QA complete (owner: Compliance Engineering).** A QA engineer has
      manually confirmed on a staging session that clicking "Deny" or "Withdraw" on the Estalara
      consent banner removes the cross-session `localStorage` key set by `renderConsentBanner`'s
      `onDenied` callback. This is a manual browser verification; it cannot be executed from CI.
      Status: **PENDING** — awaiting FOLLOW-128 staging deployment.

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

## 5. Activation procedure — TODO (TICKET-PILOT-002)

_Stub. To be authored by TICKET-PILOT-002: exact steps to flip shadow→live, verify first adaptation
directive served, check Sentry for errors in the first N minutes._

## 6. Incident response — TODO (TICKET-PILOT-002)

_Stub. To be authored by TICKET-PILOT-002: rollback = remove SDK snippet OR set
`tenants.status='suspended'` for the pilot tenant; escalation path to Piotr as incident owner;
comms._

## Cross-references

- `docs/specs/PILOT_CTA_LIFT_METRIC_v1.md`, `docs/ops/PILOT_FREEZE_RULE.md`,
  `docs/adr/ADR-0006-canonical-adapt-enforcement.md`, QUEUE.md Sprint 13a/13b.
