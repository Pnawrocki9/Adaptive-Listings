# TICKET-AB-004 — Analytics Dashboard: A/B Lift + Archetype Breakdown

**Sprint:** 8 **Agent:** backend-engineer **Priority:** P1 **Estimated hours:** 8 **Status:** READY
**Depends on:** TICKET-AB-001 (merged PR #80), TICKET-DQS-001 (merged), TICKET-ADP-001 (merged)
**Blocked by:** (none — all dependencies DONE)

## Context

TICKET-AB-001 ships Thompson sampling bandit assignment + `holdout_group` column on
`adaptation_decisions` in ClickHouse. Data is flowing. This ticket builds the analytics UI that
makes that data actionable for agency staff: archetype breakdown, A/B lift, anomaly feed.

Master Design section Q.3 describes the analytics dashboard. This ticket implements a first
production-ready version covering the five panels below.

**References:**

- `docs/MASTER_DESIGN.md` section Q.3 — Analytics dashboard spec
- `apps/control-plane/src/app/dashboard/` — existing dashboard structure (use layout, nav)
- ClickHouse `adaptation_decisions` table — primary data source (schema from TICKET-ADP-001)
- ClickHouse `dqs_events` or equivalent DQS session snapshot table (from TICKET-DQS-001)
- `apps/control-plane/src/lib/clickhouse.ts` — existing ClickHouse client (reuse, do not add a
  second client)
- `apps/decision-api/src/lib/ab-assignment.ts` — `paused` flag on `ab_bandit_weights` (source for
  anomaly feed)

## Acceptance criteria

1. **Route exists.** `apps/control-plane/src/app/dashboard/analytics/page.tsx` renders at
   `/dashboard/analytics` for authenticated tenants. Uses existing dashboard `layout.tsx`.

2. **Panel 1 — Traffic summary (last 7 days).** Shows four KPI cards:
   - **Tracked sessions** — COUNT(DISTINCT session_id) from `adaptation_decisions`
   - **Adapted impressions** — count where `holdout_group = false`
   - **Holdout impressions** — count where `holdout_group = true`
   - **p95 adapt latency** — quantile(0.95)(latency_ms) from `adaptation_decisions`
   - Data fetched via `GET /api/dashboard/analytics/summary` (new internal API route)
   - Date range: rolling 7-day window (relative to now, UTC)

3. **Panel 2 — Buyer archetype breakdown.** Bar chart (top 10 archetypes by session count):
   - X-axis: archetype label (formatted, e.g. `yield_hunter` → `Yield Hunter`)
   - Y-axis: % of total tracked sessions
   - Data:
     `SELECT archetype, COUNT(DISTINCT session_id) FROM adaptation_decisions WHERE tenant_id=:tid AND assigned_at >= now() - INTERVAL 7 DAY GROUP BY archetype ORDER BY 2 DESC LIMIT 10`
   - Chart library: use `recharts` (already in control-plane dependencies — check package.json
     before adding). If not present, render as a sorted `<table>` instead (no new deps).

4. **Panel 3 — Conversion lift vs holdout.** Table with one row per archetype:
   - Columns: Archetype | Adapted rate | Holdout rate | Lift % | p-value | Status
   - Metrics computed from ClickHouse `adaptation_decisions` joined with DQS conversion signals:
     - `cta_clicked` rate (primary conversion metric)
     - `photo_viewed` rate (engagement proxy)
   - Lift = `(adapted_rate - holdout_rate) / holdout_rate × 100`
   - p-value: two-proportion z-test (compute server-side; formula in implementation notes)
   - Status: `✅ Significant` (p < 0.05, N ≥ 200 per arm), `⚠️ Trending` (p < 0.15),
     `— Not significant` otherwise
   - Data fetched via `GET /api/dashboard/analytics/lift`

5. **Panel 4 — Top adaptation types.** Simple ranked list (top 5):
   - Metric: percentage of adapted sessions that received each directive type (`TextDirective`,
     `ReorderDirective`)
   - Counts from `adaptation_decisions.directives_json` (if stored) or directive type column
   - If directive breakdown is not in ClickHouse, show top-5 archetypes by adapted volume instead
     (acceptable fallback)

6. **Panel 5 — Anomaly feed.** Table of archetypes with `paused = true` in `ab_bandit_weights`
   (Postgres, not ClickHouse):
   - Columns: Archetype | Paused since | Reason (regression on which metric) | Resume action
   - "Resume" button calls `PATCH /api/tenants/:id/bandit/weights/:archetype` to set
     `paused = false` (new endpoint, 5 lines — add to the same PR)
   - Empty state: "No anomalies detected — all archetypes active."

7. **Data API routes.** Create internal API routes under
   `apps/control-plane/src/app/api/dashboard/analytics/`:
   - `summary/route.ts` — returns KPI numbers (Panel 1)
   - `lift/route.ts` — returns per-archetype lift table (Panels 3)
   - All routes require Bearer JWT auth, scoped to `tenant_id` from the JWT claim.
   - ClickHouse queries use parameterized inputs (`?tenant_id=...`) — no string interpolation.

8. **Loading and empty states.** Each panel shows a skeleton loader while fetching. If ClickHouse
   returns 0 rows (new tenant, no data yet), each panel shows: "No data yet — start adapting
   listings to see results here."

9. **Test coverage ≥70% for new API routes.** Mock ClickHouse client. Assert:
   - Summary route returns correct shape (`{ sessions, adapted, holdout, p95Latency }`)
   - Lift route returns per-archetype rows with computed lift and p-value fields
   - Routes return `401` without valid JWT

10. **No `any` without inline disable + reason.**

11. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass locally.**

## Files to touch

| File                                                                              | Action                                    |
| --------------------------------------------------------------------------------- | ----------------------------------------- |
| `apps/control-plane/src/app/dashboard/analytics/page.tsx`                         | NEW — analytics dashboard page            |
| `apps/control-plane/src/app/api/dashboard/analytics/summary/route.ts`             | NEW                                       |
| `apps/control-plane/src/app/api/dashboard/analytics/lift/route.ts`                | NEW                                       |
| `apps/control-plane/src/app/api/tenants/[id]/bandit/weights/[archetype]/route.ts` | NEW — PATCH to resume paused archetype    |
| `apps/control-plane/src/app/dashboard/layout.tsx`                                 | Add "Analytics" nav link (if not present) |

## Implementation notes

### Two-proportion z-test (server-side)

```typescript
function zTest(n1: number, k1: number, n2: number, k2: number): number {
  const p1 = k1 / n1,
    p2 = k2 / n2;
  const p = (k1 + k2) / (n1 + n2);
  const z = (p1 - p2) / Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  // Approximate two-tailed p-value using complementary error function
  return 2 * (1 - normalCDF(Math.abs(z)));
}

function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

// erf approximation (Abramowitz & Stegun 7.1.26, max error 1.5e-7):
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return Math.sign(x) * (1 - poly * Math.exp(-x * x));
}
```

No external statistics library required — implement inline to avoid a new dependency.

### ClickHouse client usage

Check `apps/control-plane/src/lib/clickhouse.ts` for the existing client export and query pattern.
Use that pattern verbatim. Do NOT instantiate a second ClickHouseClient.

### Chart library check

Before using `recharts`, verify it is already in `apps/control-plane/package.json`. If absent,
render Panel 2 as a `<table>` with a visual percentage bar using a CSS `width` style on a `<div>` —
no external chart library required for the MVP bar chart.

### Minimum viable first version

If ClickHouse DQS conversion signals are not available (schema not yet joined), Panel 3 may render
"Conversion lift data not available — requires DQS integration." with a note that it will
auto-populate when DQS events flow. The panel shell must exist — do not omit it entirely.

## Branch naming

`backend-engineer/TICKET-AB-004-analytics-dashboard`

## PR title format

`feat(control-plane): A/B analytics dashboard — traffic summary, lift, archetype breakdown [TICKET-AB-004]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items above.
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
