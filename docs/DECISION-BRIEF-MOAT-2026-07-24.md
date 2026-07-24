# Decision Brief — Building the Adaptive Listings data MOAT

**Date:** 2026-07-24 · **Author:** PM orchestrator (session 57) · **Audience:** CEO (Piotr)
**Status:** DECISION REQUESTED · **Source:** CEO-requested admin-surface audit (3 Explore probes,
code-traced with file:line evidence; consistent with the 2026-07-01 audit F-01…F-06 and
`MASTER_DESIGN.md` §Snapshot.1).

---

## 1. The question

"Are we collecting and aggregating all the data Adaptive Listings uses for profiling, so we can turn
it into our MOAT?" The MOAT thesis is: a cross-listing / cross-tenant behavioral + intent +
archetype signal that no competitor can replicate because they don't have the traffic.

## 2. Current state — traced from code, not docs

The chain has three links: **collect → aggregate → learn**. Only the first is partly live.

| Link                                                             | State                                                          | Evidence                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| SDK per-user archetype weights (browser)                         | ✅ LIVE                                                        | `packages/sdk/src/core/intent.ts`                                    |
| Behavioral events → ClickHouse `events`                          | ✅ LIVE (code); silent no-op if `CLICKHOUSE_URL` unset         | `apps/ingest/src/clickhouse-producer.ts:131`                         |
| Intent snapshot → PG `intent_sessions` (full weights)            | ✅ LIVE                                                        | `apps/ingest/src/handlers/intent-snapshot.ts:296`                    |
| Intent snapshot → ClickHouse `intent_events` (ML training trail) | ⚠️ CODE LIVE, **PROD count=0**                                 | migration `0015` not applied to prod; `backlog/STATUS.md:3437`       |
| Chat / NLP signals                                               | ⚠️ SHADOW-ONLY (throwaway Redis); `stream-consumer` undeployed | `apps/intent-engine/src/redis_writer.py:34`; F-03                    |
| Per-session rollup (within tenant)                               | ✅ LIVE (MV)                                                   | `infra/clickhouse/migrations/0002_create_session_summary_mv.sql`     |
| Batch enrichment cron                                            | ❌ STUB (reads `[]`, processes 0)                              | `apps/intent-engine/src/jobs/batch_enrich.py:6`                      |
| **Global cross-tenant archetype aggregation**                    | ❌ **DOES NOT EXIST — app deleted**                            | `apps/archetype-pipeline` absent; `MASTER_DESIGN.md:441`             |
| **Differential privacy**                                         | ❌ **DOES NOT EXIST — no code**                                | grep: docs/charter only                                              |
| Bandit learning loop                                             | ❌ FROZEN (503-gated) → Thompson = uniform random              | `apps/control-plane/src/app/api/adapt/feedback/route.ts:262`         |
| Archetype→listing affinity                                       | ❌ djb2 HASH (embeddings NULL → fallback)                      | `apps/decision-api/src/lib/reorder.ts:223`; `embedding-lookup.ts:52` |

**Plain-language verdict:**

- **Collect:** mostly built. Per-user weights + behavioral events + quiz land in storage. But the
  primary ML training table (`intent_events`) is **empty in prod** (a one-line operator migration),
  and chat contributes **nothing** live (shadow-only by CEO pilot ruling).
- **Aggregate (the actual MOAT):** **does not exist.** The only aggregation is per-session,
  within-tenant. The app meant to build the cross-tenant asset (`archetype-pipeline`) was **deleted
  from the tree**, and there is zero differential-privacy code. This is design-only.
- **Learn:** the loop that would turn signal into better adaptation is **frozen** on three axes
  (bandit off, affinity=djb2, chat shadow) — all operator/go-live flips, not missing code.

## 3. The two decisions

These are independent and can be taken separately.

### Decision A — Unfreeze what is already built (Wave 0 operator flips)

Low effort, mostly operator actions, no new architecture. Unblocks real collection and turns the
engine from frozen to live:

1. Apply ClickHouse migration `0015` to prod → `intent_events` stops rejecting inserts (the training
   substrate fills). _(operator)_
2. Flip `FEEDBACK_ENDPOINT_ENABLED=true` → bandit starts learning from outcomes. _(operator,
   FOLLOW-450 code already merged)_
3. Auto-seed / run the `archetype_embeddings` seed in prod → affinity uses real cosine, not djb2.
   _(operator, ESC-034 path)_
4. Deploy `stream-consumer` + decide whether to un-shadow chat for the pilot (DPIA-gated per CEO
   Q2). _(build+deploy+compliance)_

**Cost:** days, mostly operator + one deploy. **Payoff:** you actually start _collecting usable
signal at quality_, and the per-listing adaptation stops being random/hashed. **This is a
prerequisite for the MOAT** — you cannot aggregate what you are not collecting.

### Decision B — Build the cross-tenant aggregation MOAT (new epic)

High effort, real engineering. This is the MOAT itself and must be **built from scratch**:

1. Re-create `apps/archetype-pipeline` (Modal): regional clustering, publish only clusters with k≥50
   from ≥3 tenants, separate global Postgres DB.
2. Implement **differential privacy** (ε≤2/epoch tracked) — zero code exists today.
3. A real ClickHouse reader for `batch_enrich` (currently returns `[]`).
4. The cross-tenant rollup + the consumer that feeds aggregated priors back into per-user
   classification.

**Cost:** a multi-ticket epic (weeks, data-engineer-led), plus a **compliance/DPIA review** (cross-
tenant aggregation of behavioral data is the highest-sensitivity thing we'd do). **Payoff:** the
defensible asset — but it is worthless until Decision A is done and traffic is actually
accumulating.

## 4. Recommendation

**Sequence, don't parallelize.** Do **Decision A first** (cheap, unblocks collection + de-freezes
the engine, makes the pilot real). Only once `intent_events` is filling and the engine is live does
**Decision B** (the aggregation epic) have inputs to consume — building the DP pipeline over an
empty `intent_events` would be premature.

Concretely:

- **Now:** approve the Wave 0 operator flips (A.1–A.3 are the same operator legs already tracked
  from the 2026-07-01 audit / Wave 0 runbook). A.4 (chat) needs a separate DPIA go/no-go from you.
- **Next sprint:** scope the `archetype-pipeline` + DP epic as a data-engineer-led design (ADR
  first, because it needs a separate global DB + a DP budget model + a compliance sign-off).

## 5. Open questions for the CEO

1. **Chat signal (A.4):** un-shadow chat for the pilot, or keep it shadow-only until post-pilot
   DPIA? (Currently CEO Q2 ruling = shadow-only.)
2. **MOAT epic timing:** greenlight the `archetype-pipeline` + DP build now (design/ADR this
   sprint), or defer until Wave 0 proves collection volume?
3. **DP / compliance appetite:** cross-tenant aggregation needs a DPIA and a differential-privacy
   budget policy. Owned by compliance-engineer + data-engineer — approve starting that review?

## 6. Related tracked work

- Wave 0 operator legs — memory `project_wave0_golive_2026_07_13`, 2026-07-01 audit F-01…F-06
  (`docs/AUDIT-2026-07-12.md`, `docs/MASTER_DESIGN.md` §Snapshot.1 rows E/F/G).
- `FOLLOW-450` (bandit code, operator-pending flip), migration `0015` (operator-pending), ESC-034
  (embedding seed).
- `FOLLOW-634` — fix the stale `data-engineer` charter that claims `apps/archetype-pipeline` exists
  (it doesn't); filed this session.
