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
