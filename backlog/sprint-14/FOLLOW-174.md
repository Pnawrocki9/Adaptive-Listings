# FOLLOW-174 — admin label table + manual reclassification

**Sprint:** 14 **Agent:** backend-engineer **Priority:** P1 **Estimated hours:** 8 **Status:** READY
**Source:** Conversion Label Loop §T **Promoted:** 2026-06-03 (by human request — MOAT)

---

## Context

The labels must be **viewable and manageable** in admin.estalara.com so staff can audit
prediction-vs-actual and correct outcome classes (the human-verified labels are the highest-quality
fine-tuning fuel) — §T.5. This EXTENDS the existing admin dashboards, not a parallel app.

## Scope

- **EXTEND** `apps/control-plane/src/app/dashboard/{analytics,pilot}` + `app/admin/*`:
  - Joined prediction+outcome table (`adaptation_decisions ⋈ conversion_labels` on `prediction_id`),
    filters: tenant, `outcome_class`, date range, `model_version`.
  - Manual set/change of `outcome_class` → writes `label_source=manual_admin` + `notes`, bumps
    `updated_at`.
  - Render the FOLLOW-173 aggregate/calibration view.
- All views RLS-respected (tenant-scoped).

## Acceptance criteria

- [ ] AC1: Filtered joined table renders predictions next to outcomes.
- [ ] AC2: Manual reclassification persists with `label_source=manual_admin` + audit fields.
- [ ] AC3: Aggregate/calibration view shown; RLS respected; typecheck/lint/CI green.

## Definition of Done

- [ ] Branch `backend-engineer/FOLLOW-174-<slug>`; commits referencing [FOLLOW-174]; PR; CI green
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`

**depends_on:** [FOLLOW-171, FOLLOW-173]
