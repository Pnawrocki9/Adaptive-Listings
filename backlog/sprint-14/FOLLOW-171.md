# FOLLOW-171 — Persist durable conversion_labels from the feedback route

**Sprint:** 14 **Agent:** backend-engineer + data-engineer **Priority:** P0 **Estimated hours:** 8
**Status:** READY **Source:** Conversion Label Loop §T (MASTER_DESIGN v3.9) **Promoted:** 2026-06-03
(by human request — MOAT)

---

## Context

Today the outcome label is **destroyed at write time**:
`apps/control-plane/src/app/api/adapt/feedback/route.ts` receives
`{session_id, tenant_id, archetype, variant, converted}` and only increments Beta counters on
`ab_bandit_weights` — the per-event (prediction, outcome) tuple is discarded, so no durable training
pair survives (§T.1). This ticket persists that pair.

## Scope

- **NEW** Postgres table `conversion_labels` (drizzle `packages/db` + migration, **RLS on
  `tenant_id`**): `prediction_id` (text, NOT NULL, = `adaptation_decisions.adapt_decision_id`),
  `lead_id`, `outcome_class` (enum), `outcome_raw` (jsonb), `labeled_at`, `label_source`
  (`system|manual_admin`), `confidence`, `notes`, `created_at`/`updated_at` (§T.2.b).
- **NEW** taxonomy `packages/shared/src/schemas/conversion-label.ts` (Zod enum, single source of
  truth: `viewing_booked | offer_made | contract_signed | purchased | lost | no_response`), imported
  by the route + the db schema.
- **EXTEND** the feedback route: in addition to the unchanged bandit update, write a durable
  `conversion_labels` row (`label_source=system`, mapped `outcome_class`). Extend the feedback body
  schema to carry `prediction_id` (= `adapt_decision_id`); note the SDK contract change in
  `backlog/HANDOFFS.md`.

## Acceptance criteria

- [ ] AC1: `conversion_labels` table + RLS policy + Zod enum live; `prediction_id` NOT NULL.
- [ ] AC2: Feedback route writes a durable label row joined to the prediction; tuple no longer
      discarded; bandit update unchanged.
- [ ] AC3: Feedback body carries `prediction_id`; HANDOFF note for the SDK.
- [ ] AC4: ≥80% coverage on new package code; typecheck/lint/CI green.

## Definition of Done

- [ ] Branch `backend-engineer/FOLLOW-171-<slug>`; commits referencing [FOLLOW-171]; PR; CI green
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`

**depends_on:** [FOLLOW-170] · **produces:** [FOLLOW-173, FOLLOW-174]
