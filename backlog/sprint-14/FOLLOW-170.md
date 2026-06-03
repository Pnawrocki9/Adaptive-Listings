# FOLLOW-170 — Enrich prediction row: model_version + features_snapshot + lead_id (T0, BLOCKING)

**Sprint:** 14 **Agent:** data-engineer (migration) + backend-engineer (INSERT) **Priority:** P0
**Estimated hours:** 6 **Status:** READY **Source:** Conversion Label Loop §T (MASTER_DESIGN v3.9) /
RETRO-028 **Promoted:** 2026-06-03 (by human request — MOAT)

---

## Context

**T0 of the Conversion Label Loop and the blocking prerequisite for the whole MOAT.** Every
adaptation decision logged today without these fields is **permanently unusable** as TALLRec/LoRA
fine-tuning fuel — the data cannot be reconstructed retroactively (§T.1). The prediction row
(`adaptation_decisions`, written by `logDecisionAsync()` in
`apps/control-plane/src/app/api/adapt/route.ts:~292`) currently records no model version, no input
feature snapshot, and no durable lead identity. This ticket adds the missing label-fuel columns —
EXTENDING the existing table, not adding a parallel one (§T.2).

## Scope

- **NEW migration** `infra/clickhouse/migrations/0013_adaptation_decisions_label_fuel.sql` adding:
  `lead_id String DEFAULT ''`, `model_version LowCardinality(String) DEFAULT ''`,
  `features_snapshot String DEFAULT ''`, and formalizing the live-but-unmigrated `demo_override`
  column (the INSERT already writes it with no migration — silent-failure risk).
- **EXTEND** `logDecisionAsync()` to write all new columns. REUSE the existing `adapt_decision_id`
  (migration 0012) as the `prediction_id` — do NOT mint a second UUID.
- `features_snapshot` = PII-free JSON of the exact scorer inputs (intent vector, signal counts, quiz
  prior, tier, holdout). `model_version` = `rulebased-bandit-v1` for the current scorer.

## Acceptance criteria

- [ ] AC1: Migration adds the 3 columns + formalizes `demo_override`; applies cleanly; journal
      updated.
- [ ] AC2: `logDecisionAsync` populates `lead_id`, `model_version`, `features_snapshot` (PII-free)
      and reuses `adapt_decision_id` as prediction_id.
- [ ] AC3: Existing `pilot/cta-lift` + analytics aggregates keep working (defaults backfill).
- [ ] AC4: Tests cover the INSERT shape; typecheck/lint/CI green.

## Definition of Done

- [ ] Branch `data-engineer/FOLLOW-170-<slug>`; commits referencing [FOLLOW-170]; PR; CI green
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`

**depends_on:** [] · **produces:** [FOLLOW-171, FOLLOW-173, FOLLOW-174]
