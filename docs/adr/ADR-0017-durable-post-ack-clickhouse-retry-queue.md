# ADR-0017 — Durable, crash-survivable retry for the post-ACK ClickHouse `events` insert (Cloudflare Queues)

**Status:** ACCEPTED (2026-07-06, CEO Piotr). Decision: adopt **Cloudflare Queues** (over Upstash
Redis); **accept the duplicate-row risk** — no dedup key required in FOLLOW-482 scope (the `events`
table stays ReplicatedMergeTree without `event_id` in ORDER BY); DLQ replay/alert runbook owner =
**devops-engineer** (discharged via FOLLOW-495). FOLLOW-482 is unblocked and promoted to QUEUE. See
ESC-037 (RESOLVED). This ADR adds a new Cloudflare product surface (a new binding + a new deployable
consumer) to `apps/ingest`, which is a "new third-party service" / new recurring-cost surface under
CLAUDE.md's escalation rules even though it is same-vendor as the rest of the Worker stack — see the
**Escalation** section below for exactly what needs a founder decision. · **References:** FOLLOW-459
(PR #429), FOLLOW-482 (`backlog/FOLLOW_UPS.md`), RETRO-154 (`backlog/RETROSPECTIVES.md`), ESC-017,
ADR-0016 (Redpanda dropped for the Modal pilot flows), ADR-0003 (event schema/versioning)

---

## Context

FOLLOW-459 (merged, PR #429, 2026-07-03) moved the ClickHouse `events` insert in
`apps/ingest/src/handlers/events.ts` off the ACK critical path via `ctx.waitUntil()`, to meet the
<50ms p95 ACK budget (Master Design, `index.ts:10`). It kept the insert's existing in-process retry
policy (`pushToClickHouse`, `apps/ingest/src/clickhouse-producer.ts`): 3 attempts, exponential
backoff `[100, 500, 2500]` ms — a ~3.1s window. On terminal failure (all 3 attempts exhausted, or a
bare 4xx) the batch is captured to Sentry
(`tags: {area:'events', sink:'clickhouse', kind:'insert_failed'}`) but **is not re-queued
anywhere**.

**Why this is now P1, not P2 (RETRO-154 / ESC-017):** in production, `REDPANDA_REST_URL` is empty
(Redpanda Cloud Serverless does not expose Pandaproxy — ESC-017), so `pushToRedpanda` is a no-op
that always resolves `{ok:true, attempts:0}` (`redpanda-producer.ts`). **ClickHouse is therefore the
sole real persistence path for the `events` table in prod.** Before FOLLOW-459, a terminal CH
failure returned HTTP 503 and the SDK retried the whole batch (idempotency.ts caches only 2xx
responses), giving client-driven at-least-once delivery. After FOLLOW-459, the ACK is a 200 gated
solely on the Redpanda no-op, so a ClickHouse outage longer than ~3.1s now **permanently drops** the
batch, with only a Sentry event as the trace. RETRO-154 §4a (LG-1) and the FOLLOW-482 stub both flag
this as the load-bearing gap this ADR closes.

Two sibling follow-ups depend on this decision landing: **FOLLOW-495** (alert on
`clickhouse_push_failed_post_ack`, not just capture it — that alert should fire only on batches that
_fail to land even after_ the durable retry this ADR adds) and **FOLLOW-494** (harden the
`getWaitUntil` fallback branch — orthogonal, does not block this ADR).

### Constraints this decision must respect

- **Stack:** Turborepo/pnpm monorepo; ingest is a Cloudflare Worker (Hono v4) with existing bindings
  — 2 KV namespaces (`KV_API_KEYS`, `KV_IDEMPOTENCY`) and 1 Durable Object (`RATE_LIMITER`,
  SQLite-backed) — see `apps/ingest/wrangler.toml`. No Cloudflare Queues binding exists today.
- **Redpanda Cloud** is out as the durable bus for this flow: Serverless has no HTTP Proxy for edge
  producers, and Dedicated (~€500/mo) is out of pilot budget — this was already decided in ADR-0016
  for the description/embed-seed flows, and the same cost/reachability constraint applies here.
- **ClickHouse `events` schema** (`infra/clickhouse/migrations/0001_create_events.sql`):
  `ENGINE = ReplicatedMergeTree`, `ORDER BY (tenant_id, type, session_id, ts)`. **`event_id` is a
  column but is NOT part of the sorting/ORDER BY key**, and the engine is plain `MergeTree`, not
  `ReplacingMergeTree`. **There is no insert-time deduplication today.** This is a pre-existing
  property of the table, not something this ADR introduces — the existing in-process retry already
  risks a duplicate row if a request succeeds server-side but the client-visible response is lost
  before a retry fires (a generic at-least-once/network-timeout hazard, orthogonal to this ADR).
- **Multi-region:** `apps/ingest` runs on Cloudflare's global edge network (no region-pinned
  deployment beyond the `staging`/`production` env split in `wrangler.toml`); `region` is a **data
  tag** on each event (`mapCountryToRegion`, CF-IPCountry-derived), not a physical routing decision.
  The single `CLICKHOUSE_URL` in production points at one `eu-west-1` cluster regardless of the
  tagged `region`. A durable retry queue does not need to solve multi-region ClickHouse routing — it
  only needs to bridge the (already global-edge) Worker to the one existing cluster, which is the
  same posture the direct-insert path has today. Genuine per-region ClickHouse clusters are a
  separate, larger decision, out of scope here.
- **Ordering:** events are **order-tolerant**. `ts` is a per-event field set by the producer, not a
  sequence/cursor; `MergeTree` re-sorts each inserted part by the `ORDER BY` key at merge time
  regardless of arrival order, and no downstream consumer (analytics, drift cron, pilot-lift
  queries) depends on insertion order — they all query by `ts` range. A standard (non-ordered)
  delivery queue is acceptable; we do not need Cloudflare Queues' now-deprecated ordering guarantees
  or any FIFO semantics.

## Decision

**Recommendation: add a Cloudflare Queue as the durable retry buffer for the post-ACK ClickHouse
insert, consumed by a `queue()` handler exported from the same `apps/ingest` Worker (no new
deployable).** This is the option that best fits "fewer dependencies, simpler interfaces,
reversibility": it reuses the vendor and deployment unit already in place, needs no new account/SDK,
and its cost is effectively zero at pilot volume (see **Cost** below).

### Shape of the change

1. **New binding on the existing `apps/ingest` Worker** (`wrangler.toml`):

   ```toml
   [[queues.producers]]
   binding = "EVENTS_RETRY_QUEUE"
   queue = "estalara-events-retry"

   [[queues.consumers]]
   queue = "estalara-events-retry"
   max_retries = 5
   dead_letter_queue = "estalara-events-retry-dlq"
   max_batch_size = 25
   max_batch_timeout = 5   # seconds

   [[queues.producers]]
   binding = "EVENTS_RETRY_DLQ"   # not consumed by code; inspected via `wrangler queues consumer`
   queue = "estalara-events-retry-dlq"
   ```

   One queue (`estalara-events-retry`) plus its native DLQ (`estalara-events-retry-dlq`). No second
   Worker script, no second deployable — the same `src/index.ts` gets a second exported handler
   (`export default { fetch, queue }`), which `wrangler.toml`'s `main` already points at.

2. **Producer — `events.ts`, terminal-CH-failure branch (the existing `.then` at
   `clickhousePush.ok === false`).** In addition to the existing `logger.error` +
   `Sentry.captureException` (kept — Rule K.2, observability stays even though the batch is now
   retried elsewhere), enqueue a retry message:

   ```ts
   interface EventsRetryMessage {
     schema_version: 1;
     batch_id: string;
     tenant_id: string;
     first_failed_at: number; // epoch ms
     attempt: number; // 0 on first enqueue; incremented by the consumer
     records: Record<string, unknown>[]; // the same `validated` rows pushToClickHouse received
   }
   ```

   Enqueued via `env.EVENTS_RETRY_QUEUE.send(message)` inside the same `waitUntil`-flushed promise
   chain FOLLOW-459 already built (so the send itself is fail-loud-observed, not a second unguarded
   fire-and-forget — reuse the `getWaitUntil`/`.catch` pattern, not a new one).

   **Message-size chunking (load-bearing detail):** Cloudflare Queues caps a message at **128 KB**
   (batch total 256 KB) [Cloudflare Queues limits]. Ingest accepts batches up to 1000 events
   (`MAX_BATCH_SIZE`, `events.ts`), and NDJSON rows can exceed 128 KB in aggregate well before 1000
   events. The producer MUST chunk `records` into sub-batches bounded by serialized byte size (a
   simple running-total accumulator over `JSON.stringify(toClickHouseRow(r))`, flushing a chunk
   before it would exceed ~100 KB to leave headroom) before calling `.send()` once per chunk —
   **not** introduce R2/KV pointer indirection, which is unnecessary complexity for this volume.

3. **Consumer — `queue()` handler in `apps/ingest/src/index.ts` (or a co-located
   `handlers/events-retry-consumer.ts`).** For each message in the batch: call `pushToClickHouse`
   again (same function, same 3-attempt in-process backoff — reused, not reimplemented) with
   `message.body.records`. On success: `message.ack()`. On failure: `message.retry()` (Cloudflare's
   native per-message retry, up to `max_retries = 5`, exponential-backoff-with-jitter is CF's
   default — no bespoke backoff code needed). After 5 Queue-level retries (each of which itself runs
   the 3-attempt in-process backoff — a bounded worst case, not unbounded retry storm), Cloudflare
   auto-moves the message to `estalara-events-retry-dlq`. A terminal DLQ landing gets one more
   `Sentry.captureException` (`tags: {area:'events', sink:'clickhouse', kind:'dlq_terminal'}`) —
   this is the signal FOLLOW-495's alert should key off, distinct from the (now much rarer)
   `insert_failed` tag emitted before the retry queue existed.

4. **Idempotency / dedup posture — explicit, not silently accepted.** The `events` table has no
   dedup key today (see Context). This ADR does **not** add one (adding `event_id` to the sorting
   key or switching engines is a schema migration with its own compaction/compatibility cost, and is
   unnecessary to unblock FOLLOW-482). Consequence: a message that is retried after a
   **false-negative** failure (ClickHouse accepted the insert but the HTTP response was lost/timed
   out) can produce a duplicate row on replay. This is the same class of risk the _existing_
   in-process 3-attempt retry already carries — this ADR extends the window, it does not introduce a
   new risk class. **Recommendation, not required for FOLLOW-482:** any analytics/aggregation query
   that is sensitive to exact row counts (rather than a distribution) should
   `SELECT argMax(...)`-style-dedupe by `event_id`, or a follow-up should evaluate a
   `ReplacingMergeTree` migration if duplicate rows are later observed to matter in practice.
   Flagging this rather than silently shipping an at-least-once queue on top of an at-least-once
   table without naming the compounding effect.

5. **Not a new public interface.** `EventsRetryMessage` is internal to `apps/ingest` — producer and
   consumer are the same Worker script, not a cross-module contract like the SDK↔ingest event
   schema. It therefore does **not** require a `packages/shared` Zod schema, an `docs/INTERFACES.md`
   entry, or a `packages/shared/src/examples/` fixture (those apply to interfaces crossing a module
   boundary — SDK↔ingest, ingest↔decision-api, etc. — this does not). It should still get a local
   Zod schema colocated in `apps/ingest/src` (matching repo-wide "Zod-validated at every boundary"
   practice) and a unit test with ≥5 cases (happy path, oversized-single-event forces multi-chunk,
   empty records guard, malformed message from a hypothetical bad producer, ack/retry branch) as
   part of the FOLLOW-482 implementation — tracked as an acceptance criterion below, not a
   contract-registry entry.

### Explicitly out of scope (separate decisions)

- **Reviving Redpanda as the durable bus.** Rejected for the same reason ADR-0016 rejected it for
  the Modal flows: Serverless has no HTTP Proxy for edge producers; Dedicated (~€500/mo) is out of
  pilot budget. Nothing about FOLLOW-482 changes that calculus.
- **A `ReplacingMergeTree` / dedup-key migration for the `events` table.** Named above as a
  consequence to watch, not undertaken here.
- **Per-region ClickHouse clusters.** The retry queue bridges the Worker to the one existing
  `eu-west-1` cluster, matching today's posture; multi-region ClickHouse is a separate ADR when the
  business needs it.

## Consequences

**Positive**

- Closes the P1 gap: a ClickHouse outage longer than ~3.1s no longer permanently drops events — it
  now survives up to `max_retries × (in-process 3-attempt window)` ≈ 5 × ~3.1s plus CF's own
  inter-retry backoff, typically minutes, before landing in a DLQ that is still recoverable (manual
  replay) rather than gone.
- No new vendor account, no new deployable, no new secret class — same Cloudflare account, same
  Worker script, same Doppler/Terraform provisioning story as the existing KV/DO bindings.
- Reuses `pushToClickHouse` unchanged in both the primary and retry paths — no drift between
  "normal" and "retried" insert logic.
- Native DLQ + native per-message retry means no bespoke backoff/dead-letter code to maintain — CF
  Queues already provides exactly the two primitives (RETRO-154's and FOLLOW-482's AC list) that
  would otherwise have to be hand-rolled on top of Durable Objects or KV.

**Negative**

- New binding = new failure mode surface: a Queue outage/misconfiguration (wrong `queue` name, DLQ
  not provisioned) is itself a way to lose the retry path, though it degrades to "same as before
  this ADR" (Sentry-capture-only), not worse.
- Message-size chunking adds a small amount of producer complexity (byte-accounting) that a simpler
  "just enqueue the array" design wouldn't need — accepted because 128 KB is a hard platform limit,
  not a tunable.
- Duplicate-row risk on Queue-level retry compounds (additively, not multiplicatively — see Decision
  §4) with the pre-existing in-process retry's duplicate-row risk. Named, not hidden.

**Risks**

- If `max_retries`/backoff timing is misjudged, a sustained ClickHouse outage could still exhaust
  the Queue's retry budget before CH recovers — mitigated by the DLQ being inspectable/replayable (a
  runbook, per FOLLOW-482's AC) rather than a hard data-loss floor.
- A leaked understanding that "the retry queue means events are safe now" could mask that duplicate
  rows are still possible — mitigated by FOLLOW-495 documenting the posture on the SDK/ops-facing
  surface, and by this ADR naming it explicitly.

**Reversibility:** high. The producer/consumer boundary is the same `pushToClickHouse` call in both
paths; removing the queue binding and reverting to Sentry-capture-only is a localized revert of
`events.ts` + `wrangler.toml`, with no data migration.

## Alternatives considered

1. **Cloudflare Queues (RECOMMENDED — see Decision).** Native to the CF Worker already in use;
   at-least-once with native retry + DLQ; ~free at pilot volume; same vendor, same deployment unit,
   no new account. Weighed as the best fit for "fewer dependencies... reversibility."

2. **Durable Objects + alarms as a retry buffer.** `RATE_LIMITER` DO already exists in this Worker,
   so the primitive is familiar. But DOs are built for per-key coordinated state (here: per-tenant
   rate counters), not a queue — modeling a durable FIFO/retry-buffer on top of DO storage +
   `alarm()` means hand-rolling exactly the batching/backoff/DLQ semantics Cloudflare Queues gives
   for free, for no cost benefit (DO pricing is per-request + storage, comparable order of magnitude
   to Queues' per-operation pricing at this volume) and materially more code to test and maintain.
   Rejected: reinvents a wheel Cloudflare already ships as a product.

3. **Upstash Redis (Kafka-compatible or list-based) as a dead-letter/replay buffer.** Upstash is
   already in the stack (control-plane/decision-api session cache), so it is not a _brand-new_
   vendor account — but it **is** a new _usage pattern_ (durable queue semantics on a cache-shaped
   product) and, more importantly, it requires the ingest Worker to reach Upstash's REST API over
   HTTP for every retry-enqueue and every consumer poll, adding a second cross-service network hop
   the Cloudflare-native option doesn't need. A scheduled Worker (cron) would still be needed to
   poll and drain it, since Upstash has no native "invoke my consumer" push mechanism the way CF
   Queues does. Rejected: more moving parts (a cron-poll loop to build and monitor) for no cost or
   reliability advantage over the native option.

4. **R2 / KV write-ahead buffer + scheduled replay.** Write the failed batch to R2 (or KV) keyed by
   `batch_id`, and a Cron Trigger Worker lists/replays periodically. This is strictly more code than
   Cloudflare Queues for a strictly worse result: no native retry/backoff, no native DLQ, R2 listing
   is not designed for queue-drain access patterns (eventually-consistent listing, no
   visibility-timeout concept), and it would need bespoke idempotent-delete-after-success logic
   Queues gives for free via `ack()`. The one scenario this beats Queues is the 128 KB message-size
   ceiling — but §Decision's chunking approach handles that without needing this alternative.
   Rejected: reimplements a queue badly on top of a blob store.

5. **Revive Redpanda as the durable bus.** Has HTTP Proxy only on BYOC/Dedicated (~€500/mo, already
   rejected by ADR-0016 for the same cost/pilot-budget reason); Serverless (the current tier) cannot
   be reached by the edge Worker producer at all. Rejected on cost, consistent with ADR-0016's
   precedent — re-litigating this per flow would be inconsistent.

## Cost & vendor-lock-in / escalation note

**Cost estimate:** Cloudflare Queues, Workers Paid plan: 1,000,000 operations/month included, then
$0.40 per additional million operations; each message send/receive/ack is counted per 64 KB chunk,
so a typical small event-batch retry generates on the order of 3 operations per message (send,
receive, ack) [Cloudflare Queues pricing]. At pilot volume (ClickHouse terminal failures are the
_retry_ path, not the steady-state path — this queue should see traffic only during CH incidents,
not on every request), monthly cost is expected to be **well under $10/month**, i.e. **far below the
€100/mo CLAUDE.md escalation threshold** even under a sustained-incident worst case. This is not the
part that needs a founder cost call — it needs one for a different reason (below).

**What DOES require human/CEO sign-off before FOLLOW-482 is worked (per CLAUDE.md: "They need to add
a new third-party service (vendor lock-in)" and the FOLLOW-482 stub's own note):**

- **The service-choice itself.** Even though Cloudflare Queues is same-vendor as the existing
  Worker/KV/DO stack, it is a **new bound resource type** on `apps/ingest` that didn't exist before
  — a new Terraform-provisioned resource, a new thing that can be misconfigured/outage, and a new
  operational surface (DLQ inspection/replay runbook) someone has to own. The FOLLOW-482 stub itself
  flags this explicitly ("needs an ADR + escalation sign-off before adding the binding... even
  though it is same-vendor").
- **Confirmation of the recommended option over the alternatives** — in particular, sign-off that
  Upstash Redis (already a paid vendor elsewhere in the stack) is _not_ preferred despite being an
  existing account, given the Cloudflare-native option's lower operational surface.
- **The DLQ replay/ops-ownership question**: who is paged when `estalara-events-retry-dlq` is
  non-empty, and who runs a manual replay (this feeds FOLLOW-495's alerting AC and needs an owner
  before it can be marked done).

Cost is reported here for completeness and is not itself the blocking question (it is trivially
under threshold); the blocking questions are the new-binding/new-third-party-surface rule and DLQ
ownership.

## Implementation outline for FOLLOW-482 (once this ADR is ACCEPTED)

1. Terraform/wrangler: provision `estalara-events-retry` + `estalara-events-retry-dlq` queues for
   `dev`/`staging`/`production` envs; add the `[[queues.producers]]` / `[[queues.consumers]]` blocks
   to `apps/ingest/wrangler.toml` per env (mirroring the existing per-env KV/DO block pattern).
2. `apps/ingest/src`: add `EventsRetryMessageSchema` (Zod, colocated, not in `packages/shared` — see
   Decision §5) + the byte-size chunking helper; wire the terminal-failure branch in `events.ts` to
   enqueue chunked messages via `getWaitUntil`-flushed `.send()` calls, alongside the existing
   `logger.error` + `Sentry.captureException` (kept).
3. Add the `queue()` export to `apps/ingest/src/index.ts` (or a new
   `handlers/events-retry-consumer.ts` it delegates to): consume a batch, call `pushToClickHouse`
   per message, `ack()`/`retry()` accordingly.
4. Tests (≥5 cases per Decision §5): happy-path enqueue→consume→ack; oversized single failed batch
   forces multi-chunk `.send()`; consumer success path acks; consumer failure path calls `retry()`
   without throwing; a message that exhausts `max_retries` is observed landing in the DLQ
   (integration or a mocked-CF-Queues-behavior unit test, whichever the existing `index.test.ts`
   harness supports most cheaply).
5. Runbook entry: how an operator lists/inspects/replays the DLQ (`wrangler queues consumer` /
   Cloudflare dashboard), and who owns that pager duty (the sign-off item above).
6. Update FOLLOW-495 to key its Sentry alert off the new `kind:'dlq_terminal'` tag (rarer, higher
   signal) in addition to / instead of `kind:'insert_failed'` (now expected to be a transient,
   self-healing event most of the time).
7. Update `events.ts`'s existing "RETRY-CONTRACT CHANGE" comment block to record that a terminal
   post-ACK CH failure is now durably retried (not just Sentry-captured) as of this change, closing
   the residual FOLLOW-459 named at merge time.

## References

- `apps/ingest/src/handlers/events.ts` (current retry-contract comment block, `getWaitUntil`,
  terminal-failure branch)
- `apps/ingest/src/clickhouse-producer.ts` (`pushToClickHouse`, in-process retry policy)
- `apps/ingest/wrangler.toml` (existing KV/DO bindings, per-env pattern to mirror)
- `infra/clickhouse/migrations/0001_create_events.sql` (`events` table engine/ORDER BY — no dedup
  key)
- `backlog/RETROSPECTIVES.md` — RETRO-154 (full gap analysis, LG-1)
- `backlog/FOLLOW_UPS.md` — FOLLOW-482 (this ADR's chartering stub), FOLLOW-494, FOLLOW-495
- `docs/adr/ADR-0016-pilot-direct-modal-invocation.md` (precedent: Redpanda rejected on cost for a
  sibling flow, same reasoning reused here)
- [Cloudflare Queues — Pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [Cloudflare Queues — Limits](https://developers.cloudflare.com/queues/platform/limits/)
- [Cloudflare Queues — Batching, Retries and Delays](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [Cloudflare Queues — Dead Letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)
