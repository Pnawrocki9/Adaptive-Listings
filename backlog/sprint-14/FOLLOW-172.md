# FOLLOW-172 — CRM deep-outcome ingest → conversion_labels (PII-stripped)

**Sprint:** 14 **Agent:** backend-engineer + compliance-engineer **Priority:** P1 **Estimated
hours:** 8–12 (consider split) **Status:** READY **Source:** Conversion Label Loop §T **Promoted:**
2026-06-03 (by human request — MOAT)

---

## Context

The deep, high-value outcomes (`offer_made`, `contract_signed`, `purchased`, `lost`) live in tenant
CRMs by design — Estalara never ingests their PII (`inquiry.completed` already strips PII by
schema). Without ingesting these, the label corpus is limited to shallow in-funnel signals and can
never train on the outcomes that matter most for ROI (§T.4, §T.6). This ticket adds the ingest path
while keeping the `lead_id` ↔ CRM PII boundary intact.

## Scope

- **NEW** authenticated tenant webhook (e.g. `apps/control-plane/src/app/api/crm/outcome/route.ts`)
  that accepts deep outcomes and resolves the CRM record to the Estalara `lead_id` **tenant-side**
  (or via a tenant-supplied opaque correlation token) — **no CRM PII enters Estalara stores**.
- Writes `conversion_labels` (`label_source=system`, `confidence=1.0`, `outcome_raw` retained), RLS
  enforced.

## Acceptance criteria

- [ ] AC1: Webhook authenticated + tenant-scoped; maps inbound outcome → `outcome_class`.
- [ ] AC2: Resolves to `lead_id` without ingesting CRM PII; compliance-engineer signs off on the PII
      boundary (§T.6).
- [ ] AC3: Writes RLS-scoped `conversion_labels` rows; typecheck/lint/CI green.

## Definition of Done

- [ ] Branch `backend-engineer/FOLLOW-172-<slug>`; commits referencing [FOLLOW-172]; PR; CI green
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`

**depends_on:** [FOLLOW-171]
