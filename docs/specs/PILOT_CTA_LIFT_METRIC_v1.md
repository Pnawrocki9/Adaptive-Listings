# Pilot CTA-Lift Measurement Spec v1

**Status:** DRAFT for CEO ratification — 2026-05-25. Answers AI Council blocking questions **B1**
(metric design), **B5** (traffic exclusion), **B7** (query-path ground truth). Source: AI Council
session `20260525_143939`.

> This spec **documents what is already wired** and marks only the values that require a CEO
> decision. Items tagged `DECISION NEEDED` must be resolved before any live CTA-lift readout.

## 1. What "CTA lift" means

The pilot's **primary** metric is the relative lift in CTA-click rate of **adapted** sessions versus
the **holdout** arm, with a significance test. Secondary metric: inquiry starts (separate spec /
panel).

```
cta_rate(arm)   = distinct sessions in `arm` that fired ≥1 cta.clicked  /  distinct sessions in `arm`
cta_lift (%)    = (cta_rate(adapted) − cta_rate(holdout)) / cta_rate(holdout) × 100
significance    = two-proportion z-test, two-tailed
```

## 2. Control vs treatment assignment (already wired)

- **Mechanism:** 10% consent-aware holdout, assigned deterministically by `session_id` hash —
  `apps/decision-api/src/lib/ab-assignment.ts` (TICKET-AB-001). Assignment is random per session and
  MUST NOT segment by any protected characteristic (binding constraint, ESCALATIONS 2026-05-13).
- **Persistence:** the arm is recorded as `adaptation_decisions.holdout_group` (`0` = adapted, `1` =
  holdout) in ClickHouse.
- **Treatment (adapted):** receives directives; **holdout:** adaptation computed but not injected.

## 3. Canonical query (ground truth — answers B7)

The **canonical** measurement path is `apps/control-plane/src/app/api/pilot/cta-lift/route.ts`
(`fetchCtaLiftRaw`). It joins `adaptation_decisions` (arm + archetype) against `events` (event
types) on `(tenant_id, session_id)` within the window:

| Element          | Canonical definition                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| Numerator        | distinct `session_id` with ≥1 `events.type = 'cta.clicked'` in window                                 |
| Denominator      | distinct `adaptation_decisions.session_id` per `holdout_group` in window                              |
| Arm split        | `adaptation_decisions.holdout_group` (0 adapted / 1 holdout)                                          |
| Timestamp/window | `ad.ts >= now() - toIntervalDay(window_days)` — column is **`ts`**, NOT `assigned_at`                 |
| `window_days`    | one of `{7, 14, 30}` (`parseWindowDays`)                                                              |
| Significance     | `apps/control-plane/src/lib/pilot-stats.ts:twoProportionZTest`, `MIN_SAMPLE_PER_ARM = 30`             |
| Confidence band  | `'95%'` (p<0.05) / `'90%'` (p<0.1) / `'not_significant'`; forced `not_significant` if either arm < 30 |

**B7 resolution — divergent path is NON-CANONICAL.** A second route
`apps/control-plane/src/app/api/dashboard/analytics/lift/route.ts` computes lift from `dqs_events`
joined on `adaptation_decisions.assigned_at` (different table, different event name `cta_clicked`,
different timestamp column). It will report **different numbers** for the same tenant/window. **The
pilot route (`events.cta.clicked` on `ad.ts`) is ground truth.** FOLLOW-093 reconciles the
analytics/lift route onto this vocabulary (or marks it superseded) and is a Lane A gate before any
readout.

## 4. Attribution & thresholds — `DECISION NEEDED`

- **Attribution window:** currently per-session within `window_days` (no per-event decay).
  `DECISION NEEDED`: confirm per-session attribution and the default window (recommend 14 days for
  the first readout).
- **Minimum sample before readout:** code enforces ≥30 per arm for significance. `DECISION NEEDED`:
  set a higher **readout** floor (recommend ≥ 200 adapted sessions AND ≥ 30 holdout sessions before
  any lift is reported externally), so a "significant" badge on tiny n is never published.
- **Multiple-window discipline:** `DECISION NEEDED`: fix one primary window for the headline number
  (recommend 14d) to avoid window-shopping.

## 5. Traffic exclusion (answers B5) — `DECISION NEEDED`

The numerator/denominator must exclude non-buyer traffic. Today there is **no** internal/QA/bot
exclusion in the query. `DECISION NEEDED`, options to specify:

- Internal staff sessions (by IP allowlist, a `data-estalara-internal` flag, or a known
  session-tag).
- QA/E2E sessions (the `E2E_TENANT_ID` / canary tenant is already separate — confirm it is never the
  pilot tenant).
- Bots (no bot detection wired today — decide whether to add a filter or accept noise for v1).

Until an exclusion mechanism is specified + implemented, the readout MUST carry a caveat that counts
include unfiltered traffic.

## 6. Data provenance (hard dependency on FOLLOW-094)

The canonical route currently does `raw ?? buildMockRaw(...)` — when `CLICKHOUSE_URL` is unset
**or** any query throws, it serves **fabricated, deliberately-significant** lift with HTTP 200 and
no provenance signal (`route.ts:327-331`). **No CTA-lift readout is valid until FOLLOW-094 lands**:
real-vs-mock must be distinguishable (`data_source: 'mock' | 'clickhouse'`), and a configured-but-
failed query must surface an error + Sentry, never fabricate. This spec's numbers are only
meaningful against `data_source: 'clickhouse'`.

## 7. Open decisions summary (for CEO)

| ID   | Decision             | Recommended default                                                                     |
| ---- | -------------------- | --------------------------------------------------------------------------------------- |
| B1-a | Attribution window   | per-session, 14-day primary                                                             |
| B1-b | Readout sample floor | ≥200 adapted + ≥30 holdout sessions                                                     |
| B5   | Traffic exclusion    | exclude internal + QA tenant; bots deferred to v2 with caveat                           |
| B7   | Ground-truth query   | pilot route (`events.cta.clicked` on `ad.ts`); analytics/lift superseded via FOLLOW-093 |
