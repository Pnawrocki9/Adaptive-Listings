# TICKET-PILOT-001 — Onboard app.estalara.com: SDK install, schema activation, shadow mode

**Sprint:** 13 (Lane B — deferred from Sprint 12) **Lane:** B (pilot launch) **Agent:**
sdk-engineer + backend-engineer **Model:** sonnet-4.6 **Priority:** P1 **Estimated hours:** 4
**Branch:** TBD — to be set at Lane B spawn **Depends on:** FOLLOW-094, FOLLOW-098, FOLLOW-093,
FOLLOW-097, FOLLOW-105, FOLLOW-106, FOLLOW-149, ESC-012

---

## Context

Onboard app.estalara.com (the pilot tenant, `DEMO_TENANT_ID`) onto the Estalara SDK in shadow mode,
validate schema detection, then flip to live to open the CTA-lift measurement window.

Steps:

1. Install `@estalara/sdk` snippet in SvelteKit `+layout.svelte`.
2. Run Magic Link wizard to activate tenant schema (000-app-estalara fixture,
   `detection_source=data_estalara`, confidence ≥0.99).
3. Shadow mode (adaptation runs, directives not injected) for 3–5 days as baseline.
4. Generate and verify SDK snippet for production embed. 4b. **Verify pilot tenant exists in
   `tenants` table BEFORE running `pnpm db:migrate`. Then run `pnpm db:migrate` to apply migration
   0016 (sets `inquiry_submit_selector` on pilot tenant). Verify column is populated via SELECT (not
   via success message).**
5. Set `tenants.pilot_frozen = true` on the shadow→live flip — opens the measurement window per
   `PILOT_FREEZE_RULE.md`.

---

## Acceptance Criteria

- [ ] `@estalara/sdk` snippet is installed in SvelteKit `+layout.svelte` on app.estalara.com.
- [ ] Magic Link wizard activates tenant schema; `detection_source=data_estalara`, confidence ≥0.99.
- [ ] Shadow mode runs 3–5 days (adaptation decisions logged, no DOM mutation on pilot tenant).
- [ ] SDK snippet includes `data-decision-url="${CONTROL_PLANE_URL}/api"` (absolute host; the SDK
      appends `/adapt` → `https://admin.estalara.com/api/adapt`). A bare host 404s; a relative
      `/api` resolves against the tenant origin (wrong). Never omit it.
- [ ] Smoke assertion: `GET https://admin.estalara.com/api/adapt` returns 200 (NOT 410) for the
      pilot tenant — confirms the SDK reaches the canonical control-plane route, not the deprecated
      Worker.
- [ ] On shadow→live flip: `tenants.pilot_frozen` is set to `true` for the pilot tenant record in
      Postgres. This opens the CTA-lift measurement window per `PILOT_FREEZE_RULE.md` and activates
      the runtime warning in `apps/control-plane/src/app/api/adapt/route.ts` (FOLLOW-106).
- [ ] **Migration sequencing (ESC-012 / step 4b):** pilot tenant row (`000-app-estalara`) confirmed
      present in `tenants` table BEFORE `pnpm db:migrate` is run. After migration 0016 applies,
      `inquiry_submit_selector` is non-null for the pilot tenant — verified via
      `SELECT inquiry_submit_selector FROM tenants WHERE id = '<pilot-tenant-id>'` (not inferred
      from migration success message).

---

## Key files to read first

- `docs/ops/PILOT_FREEZE_RULE.md` — freeze classification and ratified decisions
- `docs/ops/PILOT_RUNBOOK.md` — go/no-go checklist and abort procedure
- `packages/db/src/schema/tenants.ts` — `pilot_frozen` column (added in FOLLOW-106)
- `packages/db/migrations/0015_pilot_frozen.sql` — migration that adds the column
- `apps/control-plane/src/app/api/adapt/route.ts` — runtime warning logic (FOLLOW-106)

---

## Definition of Done

- [ ] SDK snippet live on app.estalara.com (shadow mode verified)
- [ ] `tenants.pilot_frozen = true` set on shadow→live flip
- [ ] `GET https://admin.estalara.com/api/adapt` smoke assertion passes
- [ ] `inquiry_submit_selector` non-null for pilot tenant after migration 0016 (ESC-012 step 4b)
- [ ] Standard CI green

---

## Notes

**ESC-012 — Migration sequencing (Path 1, CEO decision 2026-05-28):**

CEO chose Path (1): the Magic Link wizard (`POST /api/tenants`) creates the pilot tenant row FIRST,
then the operator runs `pnpm db:migrate` to pick up migration 0016. This ordering is mandatory
because migration 0016 (`0016_pilot_inquiry_selector.sql`) contains a `RAISE EXCEPTION` guard that
aborts (and rolls back the entire Drizzle transaction, including any future 0017+ entries) when the
pilot tenant row is absent.

The Path (1) rationale: the wizard creates the `tenants` row as part of schema activation (step 2 of
this ticket). Migration 0016's UPDATE then safely targets an existing row. Running `pnpm db:migrate`
before wizard completion is the exact failure mode ESC-012 documents — it was triggered during
FOLLOW-149 Part D on prd.

**Recovery pattern if Path (1) misfires:** If migration 0016 still fails after wizard completion
(e.g., tenant row missing due to wizard bug), use the isolated apply pattern documented in
`docs/ops/PILOT_RUNBOOK.md` §3 "Migration sequencing" subsection. Do NOT re-run `pnpm db:migrate`
blind — it will roll back any co-pending entries (0017+) alongside 0016.

See `backlog/ESCALATIONS.md` ESC-012 for full context.
