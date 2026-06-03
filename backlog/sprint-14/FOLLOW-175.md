# FOLLOW-175 — Label-set export for LoRA fine-tuning

**Sprint:** 14 **Agent:** backend-engineer + ml-engineer **Priority:** P2 **Estimated hours:** 4
**Status:** READY **Source:** Conversion Label Loop §T **Promoted:** 2026-06-03 (by human request —
MOAT)

---

## Context

The end of the loop: turn the accumulated labels into the actual fine-tuning corpus. Per-tenant
export of the PII-free `(features_snapshot, model_version, score) → outcome_class` set is the Y2
fine-tune (§D.5.7) input — the realized MOAT (§T.5).

## Scope

- **NEW** per-tenant export route under `app/admin/*` (or `dashboard/analytics`) producing CSV/JSONL
  of the PII-free `(features_snapshot, model_version, score) → outcome_class` corpus.
- Tenant-scoped (RLS), export action auditable.

## Acceptance criteria

- [ ] AC1: Per-tenant export of the PII-free labeled corpus (CSV/JSONL).
- [ ] AC2: RLS-scoped + the export is auditable.
- [ ] AC3: Documented as the Y2 fine-tune (§D.5.7) input; typecheck/lint/CI green.

## Definition of Done

- [ ] Branch `backend-engineer/FOLLOW-175-<slug>`; commits referencing [FOLLOW-175]; PR; CI green
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`

**depends_on:** [FOLLOW-174]
