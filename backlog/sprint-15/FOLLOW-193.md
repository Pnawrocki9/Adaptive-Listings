# FOLLOW-193 — FIX-028: restore DSR cron + engagement_scores erasure

**Sprint:** 15 **Agent:** backend-engineer + compliance-engineer **Priority:** P0 **Estimated
hours:** 6 **Status:** READY **Source:** Audit F-10, F-11, CHK-C G-1/G-2 **Promoted:** 2026-06-05

---

## Context

Two GDPR Art. 17 gaps exist in the current DSR erasure pipeline, documented as CHK-C G-1 and G-2:

**G-1 (F-10): DSR mutation-poll cron removed.** The Vercel Cron for `/api/dsr/mutation-poll` was
removed from `apps/control-plane/vercel.json` on 2026-05-29 due to Vercel Hobby plan constraints
(crons require Vercel Pro). ClickHouse `ALTER TABLE ... DELETE WHERE` mutations are issued but never
polled to completion. Any GDPR Art. 17 erasure request silently leaves data in ClickHouse
indefinitely. HTTP 200 from `/api/dsr/erase` does not mean data was deleted.

**G-2 (F-11): `engagement_scores` missing from erasure cascade.** The `engagement_scores` Postgres
table is absent from the Drizzle transaction in
`apps/control-plane/src/app/api/dsr/erase/route.ts:312–323`. DPIA §8 line 773 explicitly requires
it.

**CEO must confirm Vercel Pro plan status before cron can be restored (Audit Q3).**

This is a Track A (Week 1) P0 blocker. A DPA audit during the EU pilot with real user data would
find unexecuted erasure mutations and an incomplete erasure cascade.

## Scope

1. **Cron restore** (requires Vercel Pro — CEO must confirm before agent acts):
   - Restore `crons` block in `apps/control-plane/vercel.json` for `/api/dsr/mutation-poll` at an
     appropriate interval (e.g., every 10 minutes).
   - Document the Vercel Pro requirement in a comment in `vercel.json`.

2. **`engagement_scores` erasure** (can be done immediately, no plan dependency):
   - Add `DELETE FROM engagement_scores WHERE session_id = $1 AND tenant_id = $2` to the Drizzle
     transaction in `apps/control-plane/src/app/api/dsr/erase/route.ts:312–323`.
   - Ensure it is inside the same Drizzle `db.transaction()` block as the existing deletions.

3. **E2e canary test**:
   - Add an integration test: POST `/api/dsr/erase` with a test session_id → GET
     `/api/dsr/mutation-poll` → verify `status` transitions to `'done'`.
   - Cover both the Postgres cascade (verify `engagement_scores` row deleted) and the ClickHouse
     mutation status check.

## Acceptance criteria

- [ ] AC1: `crons` block restored in `apps/control-plane/vercel.json` for `/api/dsr/mutation-poll`.
      Vercel Pro confirmed by CEO before deploy.
- [ ] AC2: `DELETE FROM engagement_scores WHERE session_id = $1 AND tenant_id = $2` present inside
      the erasure transaction in `erase/route.ts`.
- [ ] AC3: E2e canary test covers POST `/api/dsr/erase` → mutation-poll → `status: 'done'` flow.
- [ ] AC4: E2e test verifies `engagement_scores` row is absent after erasure.
- [ ] AC5: CI green. Compliance-engineer sign-off on the DPIA §8 gap closure.

## Definition of Done

- [ ] Branch `backend-engineer/FOLLOW-193-dsr-cron-engagement-scores`; commits referencing
      [FOLLOW-193]; PR opened; CI green.
- [ ] Compliance-engineer reviews and approves the DPIA §8 closure.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [CEO confirms Vercel Pro plan — Audit Q3 (for cron restore); engagement_scores fix
has no blocker] · **produces:** [GDPR Art. 17 erasure complete]
