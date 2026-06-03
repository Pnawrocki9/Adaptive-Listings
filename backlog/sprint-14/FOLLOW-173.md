# FOLLOW-173 — Conversion-label aggregation + score-vs-actual calibration view

**Sprint:** 14 **Agent:** data-engineer **Priority:** P1 **Estimated hours:** 6 **Status:** READY
**Source:** Conversion Label Loop §T **Promoted:** 2026-06-03 (by human request — MOAT)

---

## Context

Once predictions carry `model_version` (FOLLOW-170) and outcomes are durable (FOLLOW-171), the
labels must be aggregated to be useful: conversion performance per archetype/class and — critically
— **model calibration** (does a higher predicted score actually correspond to a higher real
conversion rate?). This is the metric that later proves whether a fine-tuned `lora-tenant-*` model
beats `rulebased-bandit-v1` (§T.3).

## Scope

- **EXTEND** the existing `apps/control-plane/src/app/api/pilot/cta-lift/route.ts` JOIN pattern with
  a `model_version` dimension + the durable label join.
- Aggregate over `(tenant_id, outcome_class, model_version, time_bucket)`: conversion rate per
  class; score-vs-actual reliability curve per `model_version`.
- Document the outcome sync path (ClickHouse materialized view, or scheduled Postgres
  `conversion_labels` → ClickHouse sync, or query-time join).

## Acceptance criteria

- [ ] AC1: Aggregate query returns conversion rate per `outcome_class` per tenant per period.
- [ ] AC2: Score-vs-actual calibration computable per `model_version`.
- [ ] AC3: Outcome sync/join approach documented; tests; typecheck/lint/CI green.

## Definition of Done

- [ ] Branch `data-engineer/FOLLOW-173-<slug>`; commits referencing [FOLLOW-173]; PR; CI green
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`

**depends_on:** [FOLLOW-170, FOLLOW-171]
