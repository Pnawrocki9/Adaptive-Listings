# FOLLOW-039 — ClickHouse DSR Hard-Delete (Art.17 Erasure)

**Sprint:** 11 **Agent:** data-engineer **Priority:** P1 (EU pilot gate, non-negotiable) **Estimated
hours:** 5 **Status:** IN_PROGRESS **Source:** Sprint 8 audit / RETRO-002 P0 finding deferred to
Sprint 11 per Q7 2026-05-21 **Model:** opus-4.7-xhigh

---

## Context

Master Design §H.1 promises full GDPR / RODO Art. 17 ("right to erasure") compliance for EU tenants.
The current `dsr_erase()` implementation in `apps/control-plane/src/app/api/dsr/` does the following
on a verified erasure request:

- Writes an audit-log row to the `dsr_audit_log` Postgres table
- Soft-deletes from Postgres tenant tables (sets `deleted_at`)
- **Does NOT issue any DELETE / mutation against ClickHouse**

The ClickHouse tables `adaptation_decisions` and the events store (`estalara.events`,
`estalara.ab_assignments`, etc.) retain the data subject's `session_id`-scoped rows indefinitely
after erasure. This is **non-compliant with RODO Art. 17** for any EU tenant: the controller has
failed to erase data the data subject has the right to have erased.

**This finding has been deferred since Sprint 8 audit** on the basis that no EU pilot tenant
existed. Sprint 11 closes Sprint 10 with pilot onboarding imminent — this deferral is no longer
safe.

**ClickHouse erasure semantics:**

ClickHouse supports `ALTER TABLE ... DELETE WHERE` (mutation), not row-level DELETE. Mutations are
async — they queue and execute eventually. The `system.mutations` table tracks status. The DSR flow
must:

1. Issue the mutation
2. Track the mutation_id
3. Poll until status = `is_done = 1` (or treat as eventual + return 202)
4. Only mark the DSR audit row as `erasure_completed_at` when the mutation completes
5. On mutation failure, retry; on persistent failure, escalate to ops + the DSR audit row gets
   `erasure_failed_reason`

Per Master Design §H.1, the controller has 1 month to fulfill an erasure request (extendable to 3
with reason). Async ClickHouse mutation is acceptable within that window.

---

## Acceptance Criteria

- [ ] `apps/control-plane/src/app/api/dsr/erase/route.ts` (or equivalent existing path) issues
      `ALTER TABLE adaptation_decisions DELETE WHERE session_id IN (...)` against ClickHouse, scoped
      to the data subject's session_ids resolved from the DSR token.
- [ ] Same mutation pattern applied to all ClickHouse event tables that contain session-scoped PII:
      `estalara.events`, `estalara.ab_assignments`, and any other table per a documented data
      inventory check at the top of the PR.
- [ ] Mutation status tracked: `dsr_audit_log` row gains columns `clickhouse_mutation_id` (string),
      `clickhouse_mutation_status` (enum: `pending` / `in_progress` / `done` / `failed`),
      `clickhouse_mutation_completed_at` (timestamp). Drizzle migration adds these.
- [ ] Background job or scheduled handler polls `system.mutations` and updates the audit log row.
      Choice of implementation: cron job, Vercel Cron, Modal scheduled job, or inline `setTimeout` —
      pick the simplest that fits the existing stack. Document the choice in the PR description with
      reasoning.
- [ ] Retry-on-failure: if `system.mutations.latest_failed_reason` is non-empty, retry up to 3 times
      with exponential backoff. On final failure, the audit row status is `failed` and an alert is
      logged via Sentry.
- [ ] Idempotency: re-running the erase endpoint for an already-erased session is safe — it either
      finds the existing mutation_id and reports its status, or issues a new
      `WHERE session_id IN (...)` which is a no-op if rows are already gone.
- [ ] Tests: - Unit: the ClickHouse mutation SQL builder produces the correct `ALTER TABLE`
      statements for a given session_id list. - Integration: against a local / CI ClickHouse
      instance (or mocked client), the full DSR-erase flow issues the mutation, polls, and updates
      the audit row. - Edge: empty session_id list (data subject had no events) — endpoint succeeds
      with no mutations issued.
- [ ] Master Design §H.1 updated: the ClickHouse erasure step is documented in the DSR-erase flow
      diagram and the "Realistic erasure semantics" prose explains the mutation/poll/audit pattern.
      Bump version.
- [ ] DPIA (`docs/compliance/DPIA.md`) updated if it currently asserts erasure-complete semantics:
      now it must reflect the async mutation reality.
- [ ] All CI checks green except the explicitly-ignored ones (Doppler verify, Rule I, Python tests).

---

## What NOT to do

- Do not implement TTL-based deletion as a substitute (`ALTER TABLE ... MODIFY TTL` exists but does
  not satisfy Art. 17's on-demand semantics).
- Do not delete from Postgres differently than today — that path already works.
- Do not change the DSR verification flow (OTP / Resend / token) — only the erasure side-effect.
- Do not introduce a new ClickHouse client library — use whatever the existing codebase uses (search
  for existing ClickHouse client imports first).
- Do not bundle FOLLOW-073 (INTERNAL_API_SECRET threat model) here — separate ticket.

---

## Files to read first

1. `apps/control-plane/src/app/api/dsr/` — full directory tree
2. `apps/control-plane/src/app/api/dsr/erase/` or equivalent — existing erase endpoint
3. `infra/clickhouse/migrations/` — schema for adaptation_decisions, events tables
4. `apps/control-plane/src/lib/clickhouse.ts` (or equivalent client wrapper) — if exists
5. Any existing ClickHouse mutation usage in the codebase (`grep -rn "ALTER TABLE" apps/ packages/`)
6. `docs/MASTER_DESIGN.md` §H.1 — current DSR documentation
7. `docs/compliance/DPIA.md` — current erasure claims
8. `backlog/sprint-10/FOLLOW-051.md` style — for PR description format

---

## Files to create / edit

1. `apps/control-plane/src/app/api/dsr/erase/route.ts` (or equivalent) — add ClickHouse mutation
   logic
2. `apps/control-plane/src/lib/clickhouse-dsr.ts` (new) — mutation builder + poll helper
3. Drizzle migration — add `clickhouse_mutation_*` columns to `dsr_audit_log`
4. Test files — unit + integration
5. `docs/MASTER_DESIGN.md` §H.1 — update + version bump
6. `docs/compliance/DPIA.md` — update erasure semantics

---

## CI watch + autonomous fix policy

After pushing PR:

1. Run `gh pr checks <pr> --watch` until critical checks complete.
2. Fix real failures: TypeScript, lint, format, test, build, Rule H, Rule J.
3. **Ignore** these checks (pre-existing): Doppler verify, Rule I, Python tests.
4. If QUEUE.md conflict on rebase: keep both sides + run prettier.
5. Loop until critical CI green, then post PM-validation comment: "PM-validated: critical CI green,
   ignored Doppler/Rule-I/Python per Sprint 11 policy"
6. Mark READY_FOR_REVIEW in QUEUE.md and stop.

---

## Escalation triggers

If during implementation you discover:

- The existing DSR-erase endpoint doesn't actually exist at the expected path (search reveals only a
  stub): escalate to `backlog/ESCALATIONS.md` BEFORE writing the ClickHouse mutation layer — the
  prerequisite work needs scoping.
- A ClickHouse client library is not in the existing stack: escalate before adding a new dependency.
- The polling/scheduling decision (cron vs inline vs Modal) requires a Vercel-paid feature:
  escalate.

---

## References

- `backlog/QUEUE.md` Sprint 11 yaml block
- `backlog/FOLLOW_UPS.md` FOLLOW-039 stub (Sprint 8 origin)
- `docs/MASTER_DESIGN.md` §H.1 — GDPR pragmatic checklist
- `docs/compliance/DPIA.md` — current erasure claims
- ClickHouse docs: `ALTER TABLE ... DELETE` mutation semantics
