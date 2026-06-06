# FOLLOW-200 — quiz_completions MOAT table + completion endpoint

**Sprint:** 15 **Agent:** backend-engineer + data-engineer **Priority:** P1 **Estimated hours:** 5
**Status:** READY **Source:** Audit §10.1, §E.4.8, Master_Design §E.4.8 v4.0 **Promoted:**
2026-06-05

---

## Context

Every quiz completion is MOAT training data — it links
`(session signals → quiz path → resolved archetype → adaptation → conversion)`. Without storing quiz
completions to a durable Postgres table, this label chain is permanently lost.

Master_Design v4.0 §E.4.8 specifies the `quiz_completions` table schema. The SDK dispatches a
`quiz.completed` ingest event (already in the event schema) after the decision tree leaf is reached.
A new endpoint `POST /api/quiz/completion` must persist the structured quiz path to Postgres.

This ticket is a MOAT infrastructure piece — it must land before the first real quiz completion
occurs in production, or that data is lost.

## Scope

1. **New Postgres migration** (`packages/db/src/migrations/`):

   ```sql
   CREATE TABLE quiz_completions (
     id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     session_id        text NOT NULL,
     tenant_id         text NOT NULL,
     listing_id        text,
     branch            text NOT NULL,
     q1_answer         text NOT NULL,
     q2_answer         text,
     q3_answer         text,
     resolved_archetype text NOT NULL,
     override_applied  boolean DEFAULT false,
     completed_at      timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT fk_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
   );
   ```

   RLS policy: `SELECT WHERE tenant_id = auth.jwt()->>'tenant_id'`.

2. **New endpoint `POST /api/quiz/completion`** in
   `apps/control-plane/src/app/api/quiz/completion/route.ts`:
   - Validates the request body with Zod (session_id, tenant_id, branch, q1_answer, q2_answer,
     q3_answer, resolved_archetype, override_applied, listing_id).
   - Writes to `quiz_completions` table.
   - Returns 200 on success, 400 on validation error.

3. **SDK dispatches `quiz.completed` ingest event** after the FOLLOW-199 quiz leaf is reached:
   - The SDK (in `packages/sdk/src/index.ts` quiz completion callback) should call the new
     `POST /api/quiz/completion` endpoint with the branch path and resolved archetype.
   - Also dispatch the existing `quiz.completed` ingest event via the normal ingest channel.

## Acceptance criteria

- [ ] AC1: Migration creates `quiz_completions` table with all columns and RLS policy. Migration
      applies cleanly with monotonic journal timestamp.
- [ ] AC2: `POST /api/quiz/completion` writes a row to `quiz_completions` for a valid payload.
- [ ] AC3: RLS enforced: a request with `tenant_id = 'other'` cannot read rows for
      `tenant_id = 'mine'`.
- [ ] AC4: SDK (in FOLLOW-199 quiz completion callback) calls `POST /api/quiz/completion`.
      Integration test confirms the row is written.
- [ ] AC5: Tests green. CI green.

## Definition of Done

- [ ] Branch `backend-engineer/FOLLOW-200-quiz-completions-moat`; commits referencing [FOLLOW-200];
      PR opened; CI green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [FOLLOW-199 (quiz v2.0 widget, for SDK dispatch)] · **produces:** [MOAT quiz data
for fine-tuning, full CHAT→quiz→adaptation→conversion chain]
