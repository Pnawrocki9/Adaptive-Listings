# Pilot Runbook — app.estalara.com

**Status:** SKELETON — 2026-05-25. Phase-0 drafts the **measurement-quality gates** (go/no-go
thresholds, abort rule, pre-live validation) answering AI Council blocking questions **B4**
(thresholds) and **B6** (abort rule). The **activation procedure** and **incident response**
sections are TODO stubs to be completed by **TICKET-PILOT-002** (Sprint 13b Lane B). Source: AI
Council session `20260525_143939`.

> All numeric values tagged `DECISION NEEDED` are recommended defaults awaiting CEO ratification.

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

## 2. Shadow-mode quality thresholds (answers B4) — `DECISION NEEDED`

Measured during the ≥3-day shadow window before going live:

| Gate                             | Recommended threshold                                    | Rationale                          |
| -------------------------------- | -------------------------------------------------------- | ---------------------------------- |
| Event loss rate                  | ≤ 1% of expected events dropped                          | below this, counts are trustworthy |
| ClickHouse ingestion delay (p95) | ≤ 5 min event→queryable                                  | dashboard freshness                |
| Dashboard freshness              | data ≤ 15 min stale at readout                           | avoid stale go/no-go calls         |
| Error budget (adapt route 5xx)   | ≤ 0.5% over shadow window                                | route health                       |
| Route targeting                  | 100% of pilot SDK adapt calls hit canonical `/api/adapt` | no 3-bucket leakage (FOLLOW-105)   |

## 3. Pre-live validation steps

1. **24-hour instrumentation-only smoke test:** SDK loaded in shadow mode (zero DOM mutation);
   confirm `page.view / listing.viewed / cta.clicked / inquiry.started` flow producer→ClickHouse
   with loss rate under the §2 threshold.
2. **A/A dashboard validation:** before claiming any lift, split the holdout against itself (or two
   random halves of adapted) and confirm the dashboard reports **no** significant lift. A spurious
   "significant" A/A result means the metric or query is wrong — block go-live.
3. **Provenance check:** confirm `data_source: 'clickhouse'` end-to-end (FOLLOW-094).

## 4. Abort rule (answers B6) — `DECISION NEEDED`

If, after the §4 readout floor is reached (`docs/specs/PILOT_CTA_LIFT_METRIC_v1.md` §4):

- Dashboard shows **NULL / zero / negative** lift → this is a **valid measured outcome, not a
  dashboard failure**. Do NOT "fix" the dashboard to show lift. Recommended response: pause external
  claims, investigate (route targeting, signal coverage, sample size), decide continue / extend /
  abort. `DECISION NEEDED`: who makes the continue/abort call (recommend: incident owner).
- Dashboard shows `data_source: 'mock'` or an error/degraded flag in production → **immediate abort
  of any readout** until the data path is fixed (this is a correctness failure, not a result).

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
