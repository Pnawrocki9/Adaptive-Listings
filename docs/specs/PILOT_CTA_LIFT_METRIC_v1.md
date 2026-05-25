# Pilot CTA-Lift Measurement Spec v1

**Status:** RATIFIED — 2026-05-25 (CEO Piotr Nawrocki ratified all `DECISION NEEDED` markers).
**APPROVED_TO_IMPLEMENT: true.** Answers AI Council blocking questions **B1** (metric design),
**B5** (traffic exclusion), **B7** (query-path ground truth). Source: AI Council session
`20260525_143939`.

> This spec **documents what is already wired** plus the CEO-ratified measurement values. All former
> `DECISION NEEDED` markers are resolved below.

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

## 4. Attribution & thresholds — RATIFIED

- **Attribution window (B1-a):** **per-session, 14-day primary window.** No per-event decay; a
  session counts in the numerator if it fired ≥1 `cta.clicked` within the 14-day window. 14d is the
  fixed primary window for the headline number (no window-shopping); `{7, 30}` remain available for
  diagnostics only.
- **Readout sample floor (B1-b):** **≥300 adapted sessions AND ≥30 holdout sessions — HARD guard,
  both required.** No lift is reported (internally or externally) until BOTH thresholds are met.
  This is stricter than the code's `MIN_SAMPLE_PER_ARM = 30` significance guard; the readout floor
  is a separate, higher gate so a "significant" badge on small n is never published.

## 5. Traffic exclusion (answers B5) — RATIFIED

The numerator/denominator exclude non-buyer traffic via three ratified filters:

- **Internal staff:** sessions carrying the cookie/header `x-estalara-internal: true` are excluded.
- **QA/E2E:** `tenant_id != E2E_TENANT_ID` filter (existing infrastructure — the canary/E2E tenant
  is separate from the pilot tenant; confirm during TICKET-PILOT-001 that the pilot tenant id is
  never `E2E_TENANT_ID`).
- **Bots:** a basic User-Agent regex in **SDK init** blocks `Googlebot`, `bingbot`, `Slurp`,
  `DuckDuckBot`, `AhrefsBot`, `SemrushBot`, `MJ12bot`. **Bot detection runs BEFORE any event
  emission** (no event is dispatched for a matched UA) — implemented as part of FOLLOW-099 (see its
  AC). Operational verification (≥99% known bots/internal excluded) is a runbook go/no-go gate
  (`docs/ops/PILOT_RUNBOOK.md` §2).

## 6. Data provenance (hard dependency on FOLLOW-094)

The canonical route currently does `raw ?? buildMockRaw(...)` — when `CLICKHOUSE_URL` is unset
**or** any query throws, it serves **fabricated, deliberately-significant** lift with HTTP 200 and
no provenance signal (`route.ts:327-331`). **No CTA-lift readout is valid until FOLLOW-094 lands**:
real-vs-mock must be distinguishable (`data_source: 'mock' | 'clickhouse'`), and a configured-but-
failed query must surface an error + Sentry, never fabricate. This spec's numbers are only
meaningful against `data_source: 'clickhouse'`.

## 7. Ratified decisions summary (CEO 2026-05-25)

| ID   | Decision             | RATIFIED value                                                                                |
| ---- | -------------------- | --------------------------------------------------------------------------------------------- |
| B1-a | Attribution window   | per-session, 14-day primary window (fixed; 7/30 diagnostic only)                              |
| B1-b | Readout sample floor | ≥300 adapted **AND** ≥30 holdout sessions — HARD guard, both required                         |
| B5   | Traffic exclusion    | `x-estalara-internal: true` excluded; `tenant_id != E2E_TENANT_ID`; bot UA regex pre-emission |
| B7   | Ground-truth query   | pilot route (`events.cta.clicked` on `ad.ts`); analytics/lift superseded via FOLLOW-093       |
