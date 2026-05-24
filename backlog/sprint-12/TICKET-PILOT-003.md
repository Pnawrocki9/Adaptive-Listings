# TICKET-PILOT-003 — CTA lift dashboard: baseline vs adapted, holdout comparison

**Sprint:** 12  
**Lane:** C (ROI instrumentation — parallel with Lane B)  
**Agent:** data-engineer  
**Model:** opus-4.7-xhigh  
**Priority:** P1  
**Estimated hours:** 4  
**Branch:** `data-engineer/TICKET-PILOT-003-cta-lift-dashboard`  
**Depends on:** (none — can start immediately; ClickHouse data structures already exist)

---

## Context

The pilot primary metric is **CTA lift**: adapted sessions vs holdout sessions (10% holdout already
wired via TICKET-AB-001). The A/B holdout infrastructure is fully in place:

- `adaptation_decisions` ClickHouse table has `holdout_group Boolean DEFAULT false`, `archetype`,
  `tenant_id`, `session_id`, `ts`, `variant`
- `events` table has `type`, `session_id`, `tenant_id`, `ts` — `cta.clicked` events flow through
  here
- The existing analytics dashboard (`/dashboard/analytics`) shows conversion lift vs holdout
  (Panel 3) but was built with generic query shapes

The **pilot needs a dedicated CTA lift panel** that is:

- Specific to `cta.clicked` events (not just generic "conversion")
- Includes a full conversion funnel (page.view → listing.viewed → cta.clicked → inquiry.started →
  inquiry.completed)
- Shows statistical lift with confidence (z-test p-value already computed in existing LiftRow
  interface)
- Provides a holdout comparison chart that becomes the primary investor/pilot readout

---

## Acceptance Criteria

### AC 1 — New API route: `/api/pilot/cta-lift`

Create `apps/control-plane/src/app/api/pilot/cta-lift/route.ts`:

```ts
GET /api/pilot/cta-lift?tenant_id=<uuid>&window_days=<7|14|30>
```

Auth: requires valid tenant JWT (same pattern as existing dashboard routes).

Response schema:

```ts
{
  window_days: number;
  tenant_id: string;
  summary: {
    adapted_sessions: number;
    holdout_sessions: number;
    adapted_cta_rate: number; // cta.clicked / total adapted sessions
    holdout_cta_rate: number;
    absolute_lift: number; // adapted_rate - holdout_rate
    relative_lift_pct: number; // (adapted - holdout) / holdout * 100
    p_value: number; // two-proportion z-test
    is_significant: boolean; // p_value < 0.05
    confidence: '95%' | '90%' | 'not_significant';
  }
  funnel: Array<{
    stage: 'page.view' | 'listing.viewed' | 'cta.clicked' | 'inquiry.started' | 'inquiry.completed';
    adapted_count: number;
    holdout_count: number;
    adapted_rate: number; // relative to adapted_sessions
    holdout_rate: number;
  }>;
  by_archetype: Array<{
    archetype: string;
    adapted_cta_rate: number;
    holdout_cta_rate: number;
    lift_pct: number;
    n_adapted: number;
    n_holdout: number;
    p_value: number;
  }>;
}
```

### AC 2 — ClickHouse queries

The query logic must:

1. Join `adaptation_decisions` (for `holdout_group`, `archetype`) with `events` (for event types) on
   `(tenant_id, session_id)` within the time window
2. Compute per-session CTA rates by group
3. Funnel: count unique sessions that fired each event type, split by holdout_group
4. The z-test for two proportions: `z = (p1 - p2) / sqrt(p_pool * (1-p_pool) * (1/n1 + 1/n2))`

Use ClickHouse SQL directly (via `@clickhouse/client`) — do NOT use Drizzle ORM for ClickHouse
queries (Drizzle is Postgres-only in this codebase).

### AC 3 — Dashboard panel: `/dashboard/analytics` Panel 3 enhancement

Extend the existing Panel 3 in `apps/control-plane/src/app/dashboard/analytics/page.tsx`:

- Add a "CTA Lift (Pilot)" sub-section below the existing conversion lift table
- Show: absolute lift %, relative lift %, p-value, and confidence badge (🟢 significant / 🟡
  trending / ⚪ not significant)
- Show the funnel as a simple table (stage | adapted rate | holdout rate | delta)
- By-archetype breakdown: top 5 archetypes by adapted volume with individual lift %

OR create a new dedicated page at `/dashboard/pilot` — use your judgment on whether to extend the
existing analytics page or create a new pilot-specific page. A new page is preferred if it keeps the
existing analytics page clean.

### AC 4 — Statistical correctness (critical — opus-4.7-xhigh requirement)

- Minimum sample guard: if `n_adapted < 30` OR `n_holdout < 30`, return `is_significant: false` and
  note "insufficient sample" in confidence field
- Handle division-by-zero: if `holdout_cta_rate === 0`, set `relative_lift_pct` to `null` and note
  "no holdout conversions yet"
- p-value computed server-side in TypeScript (not in ClickHouse SQL) — import or inline a
  two-proportion z-test function
- Tests must cover: equal rates → p≈1.0; large sample, meaningful lift → p<0.05; small sample →
  not_significant

### AC 5 — Tests

- At minimum 5 unit tests for the z-test math
- At minimum 5 tests for the API route (auth check, empty data, known fixture data, window_days
  parameter, archetype breakdown shape)
- Use ClickHouse mock (same pattern as existing tests) — not a live ClickHouse call

### AC 6 — No schema migration required

The `adaptation_decisions` and `events` tables already exist with the required columns. No new
ClickHouse DDL.

---

## Key files to read first

- `apps/control-plane/src/app/dashboard/analytics/page.tsx` — existing analytics dashboard;
  understand LiftRow interface and Panel 3 shape
- `infra/clickhouse/migrations/0003_create_adaptation_decisions.sql` — adaptation_decisions schema
- `infra/clickhouse/migrations/0006_adaptation_decisions_holdout.sql` — holdout_group column
- `infra/clickhouse/migrations/0010_adaptation_decisions_variant.sql` — variant column
- `infra/clickhouse/migrations/0001_create_events.sql` — events schema (has session_id, type, ts,
  tenant_id)
- `apps/control-plane/src/lib/clickhouse-dsr.ts` — example of how to use `@clickhouse/client` in
  this codebase
- Existing `/api/analytics/` routes — understand auth pattern and ClickHouse query shape

---

## Definition of Done

- [ ] `GET /api/pilot/cta-lift` route exists with correct response schema
- [ ] Two-proportion z-test implemented with minimum sample guard
- [ ] Dashboard panel shows CTA lift, funnel, by-archetype breakdown
- [ ] ≥10 tests total (z-test math + API route)
- [ ] Standard CI green
- [ ] PR description includes example response JSON with realistic dummy data
