# PROPOSED-0022 — Retire the two Redpanda remnants ADR-0016 deferred

**Status:** PROPOSED — needs a CEO decision · **Date:** 2026-08-15 · **Author:** architect
(session 119) **Closes:** the follow-up ADR-0016 promised and nobody wrote · **References:**
ADR-0016, ESC-017, FOLLOW-986

---

## Why this document exists

ADR-0016 removed Redpanda from the description and embed-seed flows and explicitly deferred two
things:

> **Explicitly out of scope (separate decision):** A/B assignment events (`ab-events.ts`) and the
> ingest Redpanda mirror still reference `REDPANDA_REST_URL` and will **silently no-op** without it
> … A follow-up decides whether to route those directly to ClickHouse or reinstate a bus at scale.

**That follow-up was never written.** A repo-wide grep for the phrase finds it only inside ADR-0016
itself. The deferral has been open since **2026-07-03**.

## Measured state at `main` `27a299a6`

Everything below is a fact about this repository, checkable from it, so it needs no
`MEASURED_PREMISES.md` entry — that register is for claims about live environments this repo cannot
verify.

| what                                   | measurement                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `REDPANDA_REST_URL` in `wrangler.toml` | `""` in **all four** env blocks, production included                                                                                                               |
| non-test files still referencing it    | 5 (`ingest/handlers/events.ts`, `ingest/redpanda-producer.ts`, `decision-api/index.ts`, `decision-api/lib/redpanda-producer.ts`, `control-plane/lib/ab-events.ts`) |
| `control-plane/lib/ab-events.ts`       | **1 consumer** — `app/api/adapt/route.ts:54`                                                                                                                       |
| `decision-api/lib/ab-events.ts`        | **ZERO consumers anywhere.** Dead code, 81 lines                                                                                                                   |
| can the bus work at all today?         | **No.** ESC-017: Redpanda Cloud Serverless exposes no Pandaproxy; HTTP Proxy is BYOC/Dedicated only                                                                |

## The load-bearing finding: the A/B event is redundant except for one field

The same request that publishes the A/B event **also writes `adaptation_decisions` to ClickHouse
directly** (`route.ts:482`, `logDecisionAsync`). Field by field:

| A/B event field   | covered by `adaptation_decisions`? |
| ----------------- | ---------------------------------- |
| `session_id`      | ✅ `session_id`                    |
| `tenant_id`       | ✅ `tenant_id`                     |
| `holdout_group`   | ✅ `holdout_group`                 |
| `assigned_at`     | ✅ `ts`                            |
| **`holdout_pct`** | ❌ **not a column**                |

So retiring the A/B publisher loses **exactly one datum**: the holdout percentage _in force at
assignment time_. The current value is config and readable at any time; what is lost is the
historical value for past assignments — which matters only if the holdout percentage is ever changed
and someone later needs to reconstruct which regime a session was assigned under.

**The ingest mirror carries no such residue**: `pushToRedpanda` sends the same validated events that
`pushToClickHouse` already writes directly (the ESC-017 replacement path), so it is redundant
outright.

## Options

**A — Retire both, add `holdout_pct` to `adaptation_decisions` first.** One migration (additive
column), delete `decision-api/lib/ab-events.ts` (dead), delete the publisher call and the Redpanda
producer paths. Nothing is lost. Cost: one migration + a deletion PR.

**B — Retire both, accept losing `holdout_pct`.** Cheaper by one migration. Acceptable only if
nobody will ever need to know the holdout regime of a historical assignment.

**C — Reinstate a bus.** Requires a **Dedicated** Redpanda cluster, ~**$500/mo** (ESC-017/ADR-0016
both priced it). The CEO ruled on 2026-08-14 (ESC-059) that spend of this kind waits until LIVE.

## Recommendation: **A**

- The bus **cannot** be reinstated on the current tier, so C is not a near-term option regardless of
  preference; it is a re-decision for scale, not for now.
- The code is not merely unused, it is **structurally unable to work** — `REDPANDA_REST_URL` is
  empty in every environment and the cluster has no Pandaproxy to point it at. Code that cannot run
  still has to be read, typechecked, linted and reasoned about by everyone who touches these files.
- A dedicated 81-line module with **zero consumers** is exactly the wired-or-dead shape Rule I
  exists to prevent; it survives only because Rule I does not currently inspect it.
- Option A costs one additive migration to lose nothing. **B saves almost nothing and discards a
  field silently** — this estate has spent a lot of effort this month on things that were discarded
  silently.

## Ruling

**Option A, ruled by the CEO on 2026-08-15.** Add `holdout_pct` to `adaptation_decisions`, then
retire the dead paths.

## ⚠️ Two corrections to this brief, found while planning the execution

Both were missed when the brief was written, and both change HOW option A must be carried out. They
are recorded here rather than quietly worked around.

**1. The brief's implied ordering is unsafe against production.** ClickHouse migrations do **not**
auto-apply — they live in `infra/clickhouse/migrations/` and `db-migrate.yml` does not touch them,
because the prod ClickHouse user has no DDL grant (an operator applies them from the Cloud console).
A ClickHouse `INSERT` with an explicit column list **fails outright** when a column is missing. So
shipping the migration file and the write in one PR would deploy, on merge, an INSERT naming a
column production does not have — **breaking every `adaptation_decisions` write** until an operator
happened to run the DDL. A change described as "safe additive" would have caused an outage.

The precedent (`cdda69a4`, migration 0019) did land both in one commit — which is exactly why this
is written down instead of inherited.

**Required order:** (i) migration file lands, (ii) an **operator applies it to prod ClickHouse** and
confirms, (iii) only then does the code that writes the column ship.

**2. "Loses nothing" is true for a different reason than the brief gave.**
`publishAbAssignmentEvent` opens with `if (!redpandaUrl) return Promise.resolve();` and
`REDPANDA_REST_URL` is empty in every environment — so **`holdout_pct` is captured NOWHERE today,
and has not been since ADR-0016.** Deleting the publisher therefore loses nothing because it
currently collects nothing. Adding the column is not data recovery; it is a **net-new capability**,
and it can be sequenced independently of the deletion without any window of loss.

## ⚠️ The blast radius is larger than this brief's 2h estimate

Measured, not assumed: **~25 files**. `apps/ingest/src/types.ts`, the ingest hot path in
`handlers/events.ts`, **44 test references** (`index.test.ts` 23, `redpanda-producer.test.ts` 21),
and **15 control-plane test files** carrying a `vi.mock('@/lib/ab-events', …)` that must go with it.
The mocks are mechanical; the ingest mirror is not — it touches the request path that received two
real bug fixes on 2026-08-14 (FOLLOW-986). Size the ticket accordingly and stage it.

## The work, in the order that is safe

1. Migration: `ALTER TABLE adaptation_decisions ADD COLUMN holdout_pct Float64 DEFAULT 0` (additive,
   safe under the auto-apply policy).
2. `logDecisionAsync` writes it; `publishAbAssignmentEvent` call removed from `route.ts`.
3. Delete `control-plane/lib/ab-events.ts`, `decision-api/lib/ab-events.ts`, and the two
   `redpanda-producer.ts` modules plus their tests.
4. Drop `REDPANDA_*` vars from `wrangler.toml` and the deploy docs.
5. `docs/MASTER_DESIGN.md` §A.1 and the tech-stack list stop naming Redpanda as an event bus.
