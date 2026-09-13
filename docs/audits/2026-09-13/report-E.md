# Report E — AREA 7: Measurement integrity (findings `M-n`)

Repo `main @ f510f749`, read-only. All paths repo-relative. "Lift path" below = the three ClickHouse
readers that turn `adaptation_decisions ⋈ events(cta.clicked)` into a number:
`apps/control-plane/src/app/api/admin/analytics/rollup/data.ts` (staff rollup, the one FOLLOW-819
AC(5) reads), `.../api/dashboard/analytics/lift/route.ts` (per-tenant per-archetype),
`.../api/pilot/cta-lift/route.ts` + `route-helpers.ts` (pilot panel). Feedback (ADR-0015) and CRM
outcome feed Postgres only and never touch the lift number — see M-3.

## Summary table

| #   | Claim (one line)                                                                                                                             | Status        | Impact                      | Coverage                                       | Prio |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------- | ---------------------------------------------- | ---- |
| M-1 | Arm is deterministic per `(tenant, session_id)` but session = one TAB, and POST lets the caller pick `holdout_pct` per request               | PARTIAL       | degrades → can invalidate   | FOLLOW-1102 (P2 stub), FOLLOW-146 (OPEN)       | P1   |
| M-2 | "Adapted" = a treatment-arm decision ROW, written even with `directive_count = 0`; nothing reads `adapt.applied`                             | CONFIRMED     | degrades (dilutes to 0)     | NO COVERAGE                                    | P1   |
| M-3 | Conversion = any `cta.clicked` from any `[data-estalara-cta]` click; no qualification, forgeable with the public key; D-4 says `live.signup` | STALE+PARTIAL | invalidates                 | NO COVERAGE (D-4 mismatch); FOLLOW-1122 (drop) | P1   |
| M-4 | Attribution joins on `(tenant_id, session_id)` only — no listing, no ordering, no window relative to the decision                            | PARTIAL       | degrades; silent 0/null     | NO COVERAGE                                    | P2   |
| M-5 | `events` is MergeTree not Replacing; SDK sends no `Idempotency-Key`; window filters on client `ts` with no bound                             | PARTIAL       | degrades                    | NO COVERAGE (ADR-0017 covers retry only)       | P2   |
| M-6 | `demo_override` is written "for analytics exclusion" and read by no query; no filter for harness/synthetic/ops/localhost traffic             | ASPIRATIONAL  | invalidates                 | NO COVERAGE                                    | P1   |
| M-7 | No sample-ratio check anywhere; `summary` counts rows, `rollup` counts sessions; consent-skips vanish from the denominator                   | ASPIRATIONAL  | degrades → hides M-1/M-6    | FOLLOW-646 (P3 stub), FOLLOW-997 (P2 stub)     | P2   |
| M-8 | Rollup formula correct; `adaptedN=0` → −100 not null; dashboard `computeLift` returns 0 on zero control; `holdoutRate=1` → ≤0 confirmed      | PARTIAL       | degrades                    | FOLLOW-1098/1124 DONE (harness side only)      | P2   |
| M-9 | Nine concrete ways a NULL/empty/failed read renders as a clean number                                                                        | CONFIRMED     | invalidates (reads as real) | partial: FOLLOW-142 (K.2 parity) stub          | P1   |

---

## M-1 — Deterministic holdout: stable per tab, not per visitor; rate is caller-supplied on POST

- **Claim.** `assignHoldout()` is a pure HMAC-SHA-256 of `(tenant_id, session_id)` — stable across
  requests/listings within a tab — but the SDK's `session_id` is a random UUID held in
  `sessionStorage`, so the same visitor in a second tab (or after the tab closes) is an independent
  draw; and the POST route takes `holdout_pct` and `consent_mode_enabled` from the request body.
- **Status:** PARTIAL.
- **Evidence.**
  - `packages/shared/src/ab-holdout.ts:114-130` — `HMAC(key=tenant_id, msg=session_id)`,
    `ratio < holdout_pct`.
  - `packages/sdk/src/core/session.ts:4-6, 86-89, 126-136` — "minted once per tab and then held in
    `sessionStorage`"; `crypto.randomUUID()`.
  - `apps/control-plane/src/app/api/adapt/route.ts:1785-1791` —
    `holdout_pct: body.holdout_pct ?? DEFAULT_HOLDOUT_PCT`,
    `consent_mode_enabled: body.consent_mode_enabled ?? false`. GET path uses the default only
    (`route.ts:1272-1277`, `:1391`). No tenant-level holdout rate exists (`packages/db/src/schema/*`
    — only `ab_bandit_weights` mentions holdout).
  - SDK never sends `holdout_pct` (only a doc comment, `packages/sdk/src/core/adapt-schema.ts:93`),
    so today's regime is the hard-coded 10 % — for every tenant, unchangeable without a code change.
  - The harness already detects intra-session mixing
    (`tests/e2e/follow-819/differentiator-e2e.mjs:401-402` `mixed_holdout_group_within_session`);
    the analytics SQL does not — `pilot/cta-lift/route.ts:163` papers over it with
    `anyHeavy(holdout_group)`, and `rollup/data.ts:199-204` `countDistinctIf(...)` counts a mixed
    session in BOTH arms.
- **Impact on measured pilot.** Degrades: cross-tab visitors receive the treatment in one tab and
  control in another, so a visitor-level effect is diluted toward zero (and a visitor who converts
  in the control tab after being adapted in the other credits control). Invalidates if any third
  party holding the public `data-api-key` sends `holdout_pct: 0/1` (FOLLOW-1102's point) —
  `tests/integration/adapt-llm-source-live.smoke.test.ts:150` already does so against a live
  deployment.
- **Ticket coverage.** FOLLOW-1102 (P2, stub, `promoted_to_queue: false`) covers the caller-supplied
  rate. FOLLOW-146 (OPEN since RETRO-023) covers threading `xid` into the join key but frames it as
  continuity, not arm stability. FOLLOW-1121 (P1, OPEN) is the harness-side consequence only.
  Per-visitor arm stability itself: NO COVERAGE.
- **Priority + deps.** P1 before GO; depends on nothing. FOLLOW-1102 should be promoted from P2.
- **Proposed AC.**
  - Assignment key is a visitor-stable id (the existing `__estalara_xid__`, 90-day, consent-erased)
    with `session_id` as fallback only when xid is absent; the key used is written to
    `adaptation_decisions` (new column or `features_snapshot`).
  - `holdout_pct` on the public POST is ignored unless the request carries the ADR-0015 ops
    credential; the effective rate comes from a tenant-config column and is what is persisted in
    `holdout_pct`.
  - A CH invariant query
    `SELECT session_id FROM adaptation_decisions GROUP BY session_id HAVING uniq(holdout_group) > 1`
    returns 0 rows over the pilot window, and the rollup route asserts it (or exposes the count).
- **Red-first test.** Unit: two `/api/adapt` POSTs with the same `xid` and different `session_id`s
  must land in the same arm (fails today — no xid in the request). Integration: POST with public
  key + `holdout_pct: 0` must write `holdout_pct = 0.1` (fails today, writes 0).

## M-2 — Impression vs exposure: "adapted" is recorded on RETURN, not on APPLY

- **Claim.** Every treatment-arm request writes an `adaptation_decisions` row with
  `holdout_group = 0`, and every lift query counts that row as "adapted" regardless of
  `directive_count` (which is frequently 0) and regardless of whether the SDK painted anything.
- **Status:** CONFIRMED (defect by design).
- **Evidence.**
  - `route.ts:2156-2172` — treatment call passes `allDirectives.length` (post page-type filter,
    `route.ts:2008`) and `false` for holdout; nothing skips the write when the count is 0
    (confidence below gate, `neutral`, non-`en` locale all reach it).
  - `rollup/data.ts:199-202`, `lift/route.ts:148-149`, `cta-lift/route.ts:113-129` — arm membership
    is `holdout_group = 0` only; no predicate on `directive_count > 0`.
  - The SDK does emit `adapt.applied` / `adapt.skipped`
    (`packages/sdk/src/core/adapt.ts:516, 931, 1001`) with skip reasons (`unresolved_token_*`,
    `no_slot_elements`), but no analytics route reads them (grep of
    `apps/control-plane/src/app/api`: only `lib/placeholder-tokens.ts`, the token register).
  - Page-type default still `listing_list` when no URL/attribute/DOM signal
    (`packages/sdk/src/index.ts:230`), which strips `headline` server-side — FOLLOW-1138 widened
    detection, it did not change what "adapted" means.
  - README `tests/e2e/follow-819/README.md` §0 AC(2) caveat: the pilot page declares no
    `cta`/`feature` slot elements, so on the real pilot page a large share of treatment sessions are
    "adapted" with zero visible change.
- **Impact on measured pilot.** Degrades toward a null result: treatment arm is diluted with
  unexposed sessions, so a real effect reads smaller; and the dashboard still shows a plausible
  `adapted` count. It cannot manufacture a positive lift, but it can hide one, and it makes
  `adapted` an impression count mislabelled as exposure.
- **Ticket coverage.** NO COVERAGE. (FOLLOW-1140 / ESC-074 (c) is about tenant-page slot
  declaration, not about what the analytics count.)
- **Priority + deps.** P1 before FOLLOW-1130; P2 for GO (does not affect condition 1). No deps.
- **Proposed AC.**
  - Lift queries define the adapted arm as `holdout_group = 0 AND directive_count > 0`, and expose a
    third bucket `treatment_unexposed` so the split is visible.
  - `adapt.applied` (with `changedSlots.length > 0`) is joined as the exposure event; the rollup
    reports `exposure_rate = exposed / treatment` per tenant.
  - Docblocks in the three lift readers state "adapted = exposed", not "adapted = treatment".
- **Red-first test.** Seed one treatment session with `directive_count = 0` and a `cta.clicked`;
  today it raises `adapted_conversions`; after the fix it lands in `treatment_unexposed` and does
  not move `ctaLift`. Extend `rollup/data.test.ts`.

## M-3 — "Qualified inquiry" does not exist: conversion is any CTA click, forgeable, and not the CEO's primary event

- **Claim.** The lift conversion is the presence of ≥1 `events` row with `type = 'cta.clicked'` for
  the session; it is emitted by the SDK on any click inside `[data-estalara-cta]`, has no
  qualification, no server-side validation, and can be posted by anyone holding the tenant's public
  ingest key. CEO Decision D-4 names `live.signup` as the primary pilot conversion; no analytics SQL
  reads it.
- **Status:** STALE (D-4 vs code) + PARTIAL (no validation).
- **Evidence.**
  - `rollup/data.ts:206-212`, `lift/route.ts:153-160`, `cta-lift/route.ts:118-125` —
    `WHERE type = 'cta.clicked'`.
  - `packages/sdk/src/core/observer.ts:544-556` — document-level click listener,
    `closest('[data-estalara-cta]')`, emits on every click (no once-per-session gate).
  - `apps/ingest/src/auth.ts:101-104` — any bearer of the API key is the tenant;
    `handlers/events.ts:418` overwrites `tenant_id` from that key. No UA/bot gate in ingest (grep
    `user-agent|isbot|crawler` in `apps/ingest/src`: none). The SDK's crawler-UA short-circuit
    (`packages/sdk/src/index.ts:343`) protects only against honest crawlers.
  - `packages/sdk/src/core/adapt.ts:695-697` — "CEO Decision D-4 (2026-05-30): live.signup is the
    PRIMARY pilot conversion event"; grep `live.signup` in `api/dashboard|pilot|admin`: none.
  - Feedback endpoint (ADR-0015) writes `ab_bandit_weights` + `conversion_labels` only
    (`api/adapt/feedback/route.ts:120-231`); never ClickHouse. It is signed with `config.apiKey` —
    the public browser key (`adapt.ts:139-171`) — so bandit updates are forgeable by anyone with the
    page source. Holdout sessions never post feedback (`adapt.ts:700-702` gates on a cached variant,
    which holdout never has). CRM outcome → `conversion_labels` (`api/crm/outcome/route.ts:2-31`),
    also outside the lift.
- **Impact on measured pilot.** Invalidates as a business number: a "conversion" is a click on a
  button whose copy the treatment arm has just rewritten (the `cta` slot is one of the adapted slots
  — README §0 `changedSlots: ["headline","cta","feature"]`), so treatment can raise `cta.clicked`
  without raising inquiries. One scripted visitor with the public key can add conversions to either
  arm; the admin's own clicks during a demo count.
- **Ticket coverage.** FOLLOW-1122 (P1, OPEN) covers the opposite failure (a real click silently
  dropped). D-4 vs `cta.clicked` mismatch and the forgeability: NO COVERAGE. FOLLOW-1130 (P2, not
  promoted) asks the business question but does not define the outcome event.
- **Priority + deps.** P1 before FOLLOW-1130; P2 for GO. Depends on a CEO choice of outcome event
  (open question 1).
- **Proposed AC.**
  - The lift outcome is a server-validated event (`inquiry.completed` or `live.signup`, per CEO)
    that the tenant backend confirms (CRM/outcome or a signed server-side ping), not a client click;
    `cta.clicked` becomes a funnel stage only.
  - Each session counts at most once per outcome (`countDistinct` already does this — keep it).
  - Ingest rejects or flags events whose `session_id` has no `session.started` from the same
    key/origin within 24 h (cheap bot/forgery filter), and records the reject count.
- **Red-first test.** Post a `cta.clicked` for a never-seen `session_id` with the public key; today
  it appears in the rollup as a conversion for whichever arm that session's HMAC lands in (after one
  `/api/adapt`); after the fix it is rejected/flagged and does not move `ctaLift`.

## M-4 — Attribution: session-only join, no listing, no order, and a tenant-id trap

- **Claim.** Outcome → arm attribution is
  `ON ad.tenant_id = ev.tenant_id AND ad.session_id = ev.session_id` with independent 7-day windows
  on `ad.ts` and `ev.ts`; a click before the decision, or on a different listing, or in a session
  that later flipped arm, all count. The stored `events.tenant_id` is the ingest key's tenant (SDK's
  all-zero placeholder is overwritten), so the join silently returns zero conversions whenever the
  ingest key and the adapt JWT resolve to different tenants.
- **Status:** PARTIAL.
- **Evidence.**
  - `rollup/data.ts:206-213` — join keys and windows; no `listing_id`, no `ev.ts >= ad.ts`.
  - `packages/sdk/src/core/events.ts:71` — `tenant_id: PLACEHOLDER_TENANT_ID`;
    `apps/ingest/src/handlers/events.ts:136, 418` — `tenant_id: tenantId` from `auth.tenant_id`;
    `route.ts:2158` — decision row's tenant is the JWT's `tenantId`. Harness confirms the overwrite
    and drops the tenant clause for that reason (`differentiator-e2e.mjs:473-480`); README §6.4
    records a KV-seed/fixture tenant mismatch on localhost.
  - Memory `project_sdk_reports_all_zero_tenant_id` is correct for the SDK-side value; the stored
    row is real. Consequence: any analysis that filters CH by the SDK-reported id matches nothing;
    any deployment where the SDK page's ingest key ≠ the adapt JWT's tenant produces a LEFT JOIN
    with no matches → `adapted_conversions = holdout_conversions = 0` → `ctaLift = null` (rollup) or
    `0.00` (dashboard, M-9).
- **Impact on measured pilot.** Degrades: a zero-conversion join is indistinguishable from "nobody
  converted"; cross-listing journeys (ADR-0014's own premise) credit the arm regardless of which
  listing was adapted.
- **Ticket coverage.** NO COVERAGE.
- **Priority + deps.** P2; depends on M-3's outcome definition.
- **Proposed AC.**
  - Join adds `ev.ts >= first_decision_ts(session)` (outcome after exposure) and reports
    `pre_exposure_conversions` separately.
  - The rollup asserts `count(events with tenant_id ∉ tenants.id) = 0` over the window and surfaces
    the count if not.
  - A doc line in the three lift readers states the join semantics.
- **Red-first test.** Insert a `cta.clicked` with `ts` 1 h before the session's first
  `adaptation_decisions.ts`; today it counts; after the fix it lands in `pre_exposure_conversions`.

## M-5 — Dedup and late arrivals: storage does not dedup, aggregates happen to

- **Claim.** `events` is `(Replicated)MergeTree`, not `ReplacingMergeTree` as the idempotency
  middleware's docblock claims; the SDK sends no `Idempotency-Key`; the in-process 3-attempt/4
  s-timeout retry plus the ADR-0017 queue can insert the same batch twice. Lift arithmetic is immune
  only because every reader uses `DISTINCT`/`countDistinct`. Windows filter on client-supplied `ts`
  (`int().positive()`, no upper bound), not `ingest_received_at`.
- **Status:** PARTIAL.
- **Evidence.**
  - `infra/clickhouse/migrations/0001_create_events.sql` — `ENGINE = ReplicatedMergeTree`,
    `ORDER BY (tenant_id, type, session_id, ts)`; `tests/e2e/fixtures/clickhouse-init.sql:20` —
    `MergeTree()`.
  - `apps/ingest/src/middleware/idempotency.ts:11-13` — "ClickHouse `ReplacingMergeTree` handles
    per-event dedup downstream" (STALE). `packages/sdk/src/core/events.ts` — no `Idempotency-Key`
    header (grep none).
  - `apps/ingest/src/clickhouse-producer.ts:~215-290` — `MAX_ATTEMPTS` loop with `timeoutMs = 4000`
    abort → an insert that committed but timed out is re-sent. `events-retry-queue.ts:1-12`
    re-inserts via the same path.
  - `packages/shared/src/schemas/event.ts:76` — `ts: z.number().int().positive()`;
    `rollup/data.ts:210, 213` — window on `ev.ts` / `ad.ts`. `adaptation_decisions.ts` is server
    time (`route.ts` `p_ts`).
- **Impact on measured pilot.** Degrades: duplicate rows inflate funnel-stage `count()`s elsewhere
  and storage; a skewed client clock moves a session's conversion out of (or into) the 7-day window
  while its decision row is in it. Does not move `ctaLift` by itself.
- **Ticket coverage.** ADR-0017 / FOLLOW-482 (retry queue, DONE) — retry only; dedup semantics and
  `ts` bounds: NO COVERAGE.
- **Priority + deps.** P2. No deps.
- **Proposed AC.**
  - `events` gains a dedup path (ReplacingMergeTree keyed on `event_id`, or a `FINAL`/`argMax` view
    the readers use), and the idempotency docblock is corrected.
  - Ingest clamps `ts` to `[ingest_received_at − 24 h, ingest_received_at + 5 min]` and counts
    clamps.
  - Lift readers window on `ingest_received_at` for events.
- **Red-first test.** Insert the same `event_id` twice;
  `SELECT count() FROM events WHERE event_id = X` returns 2 today, 1 after (or the reader view
  returns 1).

## M-6 — No exclusion of admin / demo / synthetic / test traffic

- **Claim.** `adaptation_decisions.demo_override` is written on every treatment row with the comment
  "tag demo-driven decisions for analytics exclusion", and no analytics query reads it. Nothing
  filters harness sessions (`SYNTHETIC_CONTROL_PREFIX`), ops-key requests, localhost origins, or the
  `local-e2e` tenant; the staff rollup is deliberately unfenced across all tenants.
- **Status:** ASPIRATIONAL.
- **Evidence.**
  - `route.ts:2167` — `demoActive, // AC6: tag demo-driven decisions for analytics exclusion`;
    `route.ts:1740-1779` — set from the tenant's demo-override state.
  - grep `demo_override` in `api/dashboard|pilot|admin`: none (only `api/demo/override/route.ts`
    writes it).
  - `rollup/data.ts:177-179` — "Deliberately UNFENCED — no `tenant_id = {...}` filter".
  - README §0 "AC(5) red-first … 11 pooled sessions in the window" and
    `differentiator-e2e.mjs:410-431` — the harness's own synthetic control sessions live in the same
    7-day pool the rollup reads.
- **Impact on measured pilot.** Invalidates: a sales demo (demo override forces a fixed archetype at
  `DEMO_OVERRIDE_CONFIDENCE`), a FOLLOW-819 re-run, or an ops smoke test during the pilot window all
  land in the arms as real visitors — and the synthetic control converts 100 %, dragging
  `holdoutRate` up and `ctaLift` down.
- **Ticket coverage.** NO COVERAGE.
- **Priority + deps.** P1 before GO (the pilot window and the localhost harness share one substrate
  shape). No deps.
- **Proposed AC.**
  - All three lift readers add `AND demo_override = 0` and exclude sessions whose id matches the
    harness prefix or whose tenant is in an `excluded_tenants` list (`local-e2e`).
  - Requests authenticated with the ADR-0015 ops key write `source = 'ops'` (or a new flag) and are
    excluded.
  - The rollup response carries `excluded: { demo, synthetic, ops }` counts so exclusion is visible,
    not silent.
- **Red-first test.** Seed one `demo_override = 1` treatment session with a click; today it raises
  `adapted_conversions`; after the fix it does not and appears in `excluded.demo`.

## M-7 — Sample-ratio mismatch is never checked; the two staff surfaces disagree on the split

- **Claim.** No query compares the observed holdout share with the intended rate; `holdout_pct` is
  read by nothing (FOLLOW-997); `dashboard/analytics/summary` counts decision ROWS per arm while the
  rollup counts DISTINCT sessions, so the same tenant shows two different splits; consent-skipped
  sessions write no row and drop out of every denominator silently.
- **Status:** ASPIRATIONAL.
- **Evidence.**
  - `summary/route.ts:84-90` — `countIf(holdout_group = false) AS adapted` (rows) next to
    `countDistinct(session_id) AS sessions`.
  - `rollup/data.ts:199-200` — `countDistinctIf(ad.session_id, …)`.
  - `route.ts:1795-1806` — consent-skip returns before any `logDecisionAsync`.
  - No `holdout_pct` reader (FOLLOW-997 body, verified by grep: `SELECT` naming `holdout_pct` —
    none).
- **Impact on measured pilot.** Degrades and, more importantly, hides M-1/M-6: an SRM check is the
  one cheap diagnostic that would catch a caller-supplied `holdout_pct`, a demo flood, or a broken
  assignment after GO. Without it a corrupted split renders as a clean lift.
- **Ticket coverage.** FOLLOW-646 (P3 stub, not promoted) — counting-method drift; FOLLOW-997 (P2
  stub) — `holdout_pct` unread. SRM check itself: NO COVERAGE.
- **Priority + deps.** P2 before GO; P1 before FOLLOW-1130. Depends on M-1's tenant-config rate.
- **Proposed AC.**
  - Rollup reports per tenant `holdout_share = holdout / (adapted + holdout)`, the configured rate,
    and a chi-square p-value; `srm_alarm = p < 0.001`.
  - `summary` is reconciled to distinct sessions (FOLLOW-646).
  - Consent-skipped sessions are counted (a row with `source='consent_skip'` or a separate counter)
    so the denominator is the real visitor count.
- **Red-first test.** Seed 100 sessions at 50/50 with `holdout_pct = 0.1` recorded; the rollup
  returns `srm_alarm: true`. (Field does not exist today → red.)

## M-8 — Lift arithmetic: formula right, edge cases wrong in one reader, `holdoutRate = 1` collapse confirmed

- **Claim.** `rollup/data.ts` `computeLift` is `(adaptedRate − holdoutRate) / holdoutRate × 100`,
  null when `holdoutN = 0` or `holdoutRate = 0`, but returns **−100** (not null) when
  `adaptedN = 0`; the dashboard reader returns **0** when `holdoutRate = 0`; with the harness's
  synthetic control `holdoutRate = 1` so `ctaLift = (adaptedRate − 1) × 100 ≤ 0` — FOLLOW-819
  AC(5)'s non-positive result is arithmetic, as stated. Platform totals pool tenants
  (Simpson-exposed). Significance uses `n ≥ 30` in one reader and `n ≥ 200` in another.
- **Status:** PARTIAL.
- **Evidence.**
  - `rollup/data.ts:255-266` —
    `if (holdoutN === 0) return null; … adaptedRate = adaptedN > 0 ? … : 0; if (holdoutRate === 0) return null;`
    → `adaptedN = 0, holdoutRate > 0` yields `(0 − r)/r × 100 = −100`.
  - `rollup/data.ts:541` — totals from summed counts across all tenants.
  - `lift/route.ts:100-104` — `if (holdoutRate === 0) return 0;` (docblock `:66` calls this
    "NaN-safe").
  - `lib/pilot-stats.ts:88-91` — `relativeLiftPct` returns null (correct); `:18`
    `MIN_SAMPLE_PER_ARM = 30` vs `lift/route.ts:92` `minN = 200`.
  - `differentiator-e2e.mjs:565-569, 1299-1301` — `holdout_pct: 1` → control converts with certainty
    → `holdoutRate === 1`.
- **Impact on measured pilot.** Degrades: a dead treatment arm shows −100 % (reads as "adaptation
  hurts"), a dead control shows 0 % on the dashboard (reads as "no effect"). No confidence interval
  anywhere; the number is a point estimate presented without uncertainty.
- **Ticket coverage.** FOLLOW-1098 / FOLLOW-1124 (DONE) fixed the harness's reading of it; the
  readers themselves: NO COVERAGE.
- **Priority + deps.** P2. No deps.
- **Proposed AC.**
  - All three readers share one `relativeLiftPct` (null on either arm empty or `holdoutRate = 0`),
    plus a Wilson/Newcombe 95 % CI on the difference.
  - Totals are reported as pooled AND as the per-tenant table; the UI labels the pooled number
    "pooled".
  - One `MIN_SAMPLE_PER_ARM` constant.
- **Red-first test.** `computeLift(0, 0, 10, 2)` in `rollup/data.test.ts` expects `null`; today
  returns `-100`. `lift/route.ts` with `holdout_conversions = 0` expects `lift: null`; today `0`.

## M-9 — Plausible numbers on missing data: concrete failure modes

- **Claim.** The following paths render a NULL/empty/failed read as a clean value. Each is cited.
- **Status:** CONFIRMED.

| #   | Path                                                                                                | What renders                                              | Evidence                                                                |
| --- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| a   | Either store unconfigured → `buildMockRollup()` with `seededRandom()` lift (−5…+25 %)               | A full table of brands and lifts, badge says `mock`       | `rollup/data.ts:387-433, 446-449`; badge `admin/analytics/page.tsx:181` |
| b   | Dashboard lift with zero control conversions                                                        | `lift: 0.00`, `status: not_significant`                   | `lift/route.ts:101-104`                                                 |
| c   | Treatment arm has no sessions but control does                                                      | `ctaLift: -100`                                           | `rollup/data.ts:263-265`                                                |
| d   | Tenant-id mismatch between ingest key and adapt JWT (M-4)                                           | 0 conversions both arms → rollup `null`, dashboard `0.00` | `rollup/data.ts:212`; `lift/route.ts:160`                               |
| e   | Any missing JSON field from CH                                                                      | `Number(row.x ?? 0)` → 0                                  | `rollup/data.ts:243-249`; `lift/route.ts:196-199`                       |
| f   | Tenant present in roster, absent in CH                                                              | `sessions: 0, adapted: 0, holdout: 0, ctaLift: null`      | `rollup/data.ts:505-510`                                                |
| g   | `dqsUnavailable = true` only when `adaptation_decisions` has no rows; comment says "no cta.clicked" | Empty table labelled as a conversion-data gap             | `lift/route.ts:348-352`                                                 |
| h   | `summary` split (rows) vs rollup split (sessions)                                                   | Two different "adapted" counts for one tenant             | `summary/route.ts:86-87` vs `rollup/data.ts:199-200`                    |
| i   | Harness diagnostics `chQuery(...).catch(() => [])` / `-1` sentinel                                  | Diagnostic reads as "0 synthetic runs"                    | `differentiator-e2e.mjs:441-442`                                        |

- **Impact on measured pilot.** Invalidates: (b), (c), (d) are the dangerous ones — each is a broken
  wire that renders as a product verdict.
- **Ticket coverage.** FOLLOW-142 (stub) — K.2 consumer parity for the analytics page; nothing
  covers (b)–(d), (g), (h).
- **Priority + deps.** P1. No deps.
- **Proposed AC.**
  - Every lift reader returns `null` + a `reason` enum (`no_control`, `no_treatment`,
    `no_conversions_either_arm`, `join_empty`) instead of 0 / −100.
  - `join_empty` is raised when `adapted_n + holdout_n > 0` and
    `adapted_conversions + holdout_conversions = 0` while `events(cta.clicked)` for the tenant in
    the window is > 0 — i.e. the join, not the visitors, produced zero.
  - The admin page renders `—` with the reason, never `0.0%`.
- **Red-first test.** Seed 10 treatment + 10 control decisions, 3 `cta.clicked` events under a
  DIFFERENT tenant_id for those sessions; dashboard returns `lift: 0.00` today; after the fix
  `lift: null, reason: 'join_empty'`.

---

## Synthetic end-to-end lift test (design)

**Purpose.** A fixed script whose lift is computable by hand, pushed through the REAL path (SDK HTTP
contract → ingest Worker `:8787` → ClickHouse → `/api/adapt` on `:3000` → the three analytics
readers), with the expected numbers written down BEFORE the run. It is the test that turns M-1…M-9
from findings into gates.

**Harness.** New script `tests/e2e/follow-819/synthetic-lift.mjs`, reusing from
`differentiator-e2e.mjs`: `assertRealControlPlane()` (refuses `:9100`), `readFixtureApiKey()`,
`chQuery()`, the ingest envelope from `driveHoldoutArm()` (`:612-651`), and `ADMIN_API_SECRET` for
the rollup. Runs against a FRESH ClickHouse (`TRUNCATE events, adaptation_decisions` in the local
container first — the §3 runbook never truncates, which is why FOLLOW-1124 was needed). Not a
`*.spec.ts` (README's soft-skip rule).

**Arm control without touching `holdout_pct`.** Pre-compute session ids offline with the real
`assignHoldout()` (`packages/shared/src/ab-holdout.ts`) for the fixture tenant at the DEFAULT 0.1:
draw UUIDs until 30 land treatment and 10 land control. This exercises the production assignment
byte-for-byte and never sends the caller-supplied rate (M-1's latent surface stays untouched — and a
second variant of the run that DOES send `holdout_pct: 0` with the public key is the M-1 gate).

**Fixture (N = 40 + 8 adversarial).**

| Group           | n         | `/api/adapt` POST                                                               | events posted to ingest                             |
| --------------- | --------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| T-conv          | 9         | `archetype_hint: yield_hunter, confidence: 0.9, page_type: listing_detail`      | `session.started`, `cta.clicked`                    |
| T-noconv        | 21        | same                                                                            | `session.started`                                   |
| C-conv          | 2         | same body; id pre-drawn into control                                            | `session.started`, `cta.clicked`                    |
| C-noconv        | 8         | same                                                                            | `session.started`                                   |
| A1 dup-click    | 1         | treatment                                                                       | `cta.clicked` ×3 (same and different `event_id`)    |
| A2 stale-ts     | 1         | treatment                                                                       | `cta.clicked` with `ts = now − 10 d`                |
| A3 pre-exposure | 1         | treatment, POST issued AFTER the click                                          | `cta.clicked` with `ts = now − 1 h`                 |
| A4 unexposed    | 1         | treatment, `archetype_hint: neutral` (directive_count = 0)                      | `cta.clicked`                                       |
| A5 demo         | 1         | treatment with the demo override enabled for the tenant during this call only   | `cta.clicked`                                       |
| A6 wrong-tenant | 1         | treatment                                                                       | `cta.clicked` posted with a SECOND tenant's API key |
| A7 two-tab      | 1 visitor | two `/api/adapt` calls with two session ids (one drawn T, one C)                | `cta.clicked` only on the control-drawn id          |
| A8 mixed-arm    | 1         | two POSTs, same session id, `holdout_pct: 0` then `holdout_pct: 1` (public key) | `cta.clicked`                                       |

**Expected values, written before the run (core 40 only; adversarial rows are individually
asserted).** `adapted_n = 30`, `adapted_conversions = 9`, `holdout_n = 10`,
`holdout_conversions = 2` → `adaptedRate = 0.30`, `holdoutRate = 0.20`, **`ctaLift = +50.00`** on
`/api/admin/analytics/rollup` (`brands[fixture]` and `rollup` totals if the substrate is fresh),
`/api/dashboard/analytics/lift` row `yield_hunter` `lift = 50.00`, `pValue` from
`twoProportionZTest(0.3, 30, 0.2, 10)` = 1.0 (holdout n < 30 → `not_significant`),
`/api/pilot/cta-lift` `relative_lift_pct = 50`, `confidence = 'not_significant'`,
`/api/dashboard/analytics/summary` `sessions = 40, adapted = 30, holdout = 10`.

**Assertions and the finding each catches.**

| #   | Assertion                                                                                                                   | Catches   |
| --- | --------------------------------------------------------------------------------------------------------------------------- | --------- |
| S1  | `data_source === 'clickhouse'` on all three readers (never `mock`)                                                          | M-9a      |
| S2  | `ctaLift === 50.00 ± 0.01` on rollup, dashboard row, pilot — all three agree                                                | M-8, M-9h |
| S3  | `adapted = 30, holdout = 10` on rollup AND summary (summary fails today: it counts rows)                                    | M-7       |
| S4  | Every core session has exactly one `holdout_group` value; the pre-drawn arm equals the logged arm                           | M-1       |
| S5  | A1: `adapted_conversions` unchanged by the two extra clicks; `count(events where event_id = dup)` = 1                       | M-5       |
| S6  | A2: stale click does not count (window) — AND the reader reports it under `late_or_skewed`, not silently                    | M-5       |
| S7  | A3: pre-exposure click does not count as a conversion (fails today)                                                         | M-4       |
| S8  | A4: `directive_count = 0` session is NOT in `adapted_n` (fails today: 31)                                                   | M-2       |
| S9  | A5: demo session excluded and reported in `excluded.demo` (fails today)                                                     | M-6       |
| S10 | A6: wrong-tenant click yields no conversion AND rollup raises `join_empty`/`foreign_tenant_events > 0`                      | M-4, M-9d |
| S11 | A7: one visitor → one arm when `xid` is threaded; today: two arms, control gets the conversion (fails)                      | M-1       |
| S12 | A8: public-key `holdout_pct` ignored; stored `holdout_pct = 0.1` both rows, single arm (fails today)                        | M-1, M-7  |
| S13 | Delete all C-conv events, re-run readers: rollup `null`, dashboard `null` + reason (today dashboard `0.00`)                 | M-9b      |
| S14 | Delete all T decisions, re-run: rollup `null` + reason (today `-100`)                                                       | M-9c, M-8 |
| S15 | Replace `cta.clicked` with the CEO-chosen outcome event and re-run S2 — until that event is chosen, S15 is a documented RED | M-3       |
| S16 | SRM: with 30/10 at rate 0.1 the reader returns `srm_alarm: true` (expected share 0.10, observed 0.25)                       | M-7       |

**What this test is NOT.** It does not prove the differentiator converts (FOLLOW-1130); it proves
the instrument returns the number the fixture encodes and refuses the eight ways it can be wrong. It
does not replace FOLLOW-819 (which proves the SDK → DOM hops); it is the analytics-side twin.

## Ticket coverage — what is and is not covered

| Ticket           | Status (QUEUE, newest)                 | Covers                                                   | Does NOT cover                                                 |
| ---------------- | -------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| FOLLOW-819       | 6/6 green (§5.9), AC(2) fixture caveat | chain runs; harness-side AC(5) scoping; AC(7) separation | any analytics-reader defect (M-2…M-9); positive lift by design |
| FOLLOW-1124      | DONE (#850)                            | AC(5) scoped to this run's `session_id`                  | pool pollution in the readers (M-6)                            |
| FOLLOW-1131      | DONE (#851)                            | control arm receives 0 directives (AC(7))                | per-visitor stability, caller-supplied rate (M-1)              |
| FOLLOW-1121      | OPEN P1 (stub)                         | harness's adapted arm may draw control                   | production cross-tab flip (M-1)                                |
| FOLLOW-1122      | OPEN P1 (stub)                         | silent drop of the `cta.clicked` batch                   | forgeable / unqualified conversion (M-3)                       |
| FOLLOW-1130      | OPEN P2, not promoted                  | asks the business question                               | defines no outcome event, no exclusion, no SRM (M-3, M-6, M-7) |
| FOLLOW-1102      | P2 stub, not promoted                  | caller-supplied `holdout_pct`                            | tenant-config rate does not exist yet (M-1)                    |
| FOLLOW-997       | P2 stub                                | `holdout_pct` unread                                     | SRM (M-7)                                                      |
| FOLLOW-646       | P3 stub                                | summary rows vs rollup sessions                          | consent-skip denominator (M-7)                                 |
| FOLLOW-146       | OPEN                                   | xid into join key (continuity)                           | xid as assignment key (M-1)                                    |
| FOLLOW-1155/1156 | in flight (AC subsets)                 | placeholder-token/grounding residuals                    | nothing in this area (they are copy/grounding tickets)         |
| FOLLOW-142       | stub                                   | K.2 parity on the analytics page                         | reader-level 0/−100 (M-8, M-9)                                 |

Grepped and absent: "sample ratio", "SRM", "bot traffic", "admin traffic", "two tabs",
"demo_override" as a read predicate, "live.signup" in any analytics route.

## Area verdict

The instrument that FOLLOW-820 condition 1 and FOLLOW-1130 both rely on is wired end-to-end and its
formula is right, but it measures the wrong things and cannot tell a broken wire from a null result.
Arm assignment is stable per tab, not per visitor, and the rate is caller-supplied on the public
route; "adapted" is an impression count with no exposure predicate; the conversion is an unvalidated
client click on a button whose copy the treatment rewrites, contradicting D-4; no demo/synthetic/ops
traffic is excluded although the column for it is written; there is no sample-ratio check; and two
readers render dead control or dead treatment as `0.00 %` / `−100 %`. None of this blocks condition
1 as ESC-073 restated it (technical chain + AC(7) separation), and FOLLOW-819's own claims are
honest about what `ctaLift` does not mean. All of it blocks reading any post-GO number as evidence,
which is what the pilot exists to produce. The synthetic test above is the cheapest way to make M-2,
M-6, M-7 and M-9 gates before real traffic arrives.

## Open questions for the CEO

1. **Outcome event.** D-4 (2026-05-30) named `live.signup` primary; every lift query uses
   `cta.clicked`. Which is the pilot's conversion, and must it be server-confirmed (M-3)?
2. **Unit of assignment.** Visitor (`xid`, 90-day, consent-erased) or tab-session? Per-visitor is
   the statistically correct unit but re-opens the DPIA §13.2 continuity disclosure (M-1).
3. **Does the measured pilot share a ClickHouse pool with demos and harness runs?** If yes, M-6's
   exclusion list is a GO precondition, not a nice-to-have.
4. **Promote FOLLOW-1102 to P1 before GO, or accept the caller-supplied rate as a known hole?**
