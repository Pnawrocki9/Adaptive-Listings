---
id: TICKET-015
title: Stream consumer Modal scaffold (Redpanda subscribe → ClickHouse insert)
sprint: 1
priority: P0
agent: data-engineer
status: BLOCKED
estimated_hours: 6
depends_on: [TICKET-014, TICKET-012]
produces: [TICKET-016]
affects_files:
  - 'apps/stream-consumer/src/main.py'
  - 'apps/stream-consumer/src/consumers/events.py'
  - 'apps/stream-consumer/src/clickhouse_client.py'
  - 'apps/stream-consumer/src/redpanda_client.py'
  - 'apps/stream-consumer/pyproject.toml'
  - 'apps/stream-consumer/tests/**'
context_files:
  - apps/stream-consumer/* (existing skeleton from TICKET-001)
  - infra/clickhouse/migrations/* (TICKET-014)
  - .claude/agents/data-engineer.md
labels: [sprint-1, p0, data, modal, consumers]
---

# TICKET-015: Stream consumer Modal scaffold

## Summary

Implement the stream consumer that subscribes to Redpanda topic `events.raw` (where ingest Worker
publishes), batches events for 5s or 5000 messages whichever first, validates schema, enriches as
needed, and inserts into ClickHouse `events` table. This runs as a Modal Python function with
auto-scaling. Idempotent on `event_id` (use ClickHouse's deduplication via
`INSERT INTO ... ENGINE = MergeTree` doesn't dedup, but we add a deduplication step by relying on
ClickHouse's `MergeTree` behavior + idempotent `event_id`).

## Context

Master Design C.2: stream path is Worker → Redpanda → consumer → ClickHouse. Consumer's job is
bridge between async event bus and analytical store, with batching for ClickHouse efficiency.

Modal idiomatic pattern: schedule a `@app.function` that runs continuously OR triggered by a
webhook. We use the continuous-loop pattern since we need real-time consumption. Modal auto-scales
replicas based on lag.

For Redpanda: use `confluent-kafka-python` (well-maintained, fast). Modal's Python runtime supports
it natively (no Workers limitations like ingest had).

## Scope

### In scope

- `apps/stream-consumer/pyproject.toml` — add deps: `confluent-kafka>=2.0`,
  `clickhouse-connect>=0.7`, `pydantic>=2.0`, `modal>=0.60`
- `apps/stream-consumer/src/main.py` — Modal app definition + entry point
- `apps/stream-consumer/src/consumers/events.py` — main consumer loop:
  - Subscribe to `events.raw`
  - Batch 5000 messages or 5 seconds whichever first
  - Validate via Pydantic models (mirrored from packages/shared Zod) — see note below
  - Insert batch to ClickHouse via clickhouse-connect
  - Commit offsets after successful insert
- `apps/stream-consumer/src/clickhouse_client.py` — wrapper around clickhouse-connect with retries
- `apps/stream-consumer/src/redpanda_client.py` — wrapper around confluent-kafka with TLS config
- Tests:
  - Unit: mock kafka consumer, verify batching logic
  - Integration: docker-compose with Redpanda + ClickHouse, end-to-end produce → consume → verify in
    ClickHouse
- Modal app config: Modal secret for Redpanda credentials, Modal volume for offset state if needed

### Out of scope

- Multiple consumer apps (intent_signals, archetype_pipeline) — they're separate tickets
- Schema-drift event handling (Sprint 9)
- Cross-region replication (Sprint 10)
- Pydantic codegen from Zod (do it manually for now, automate later if pain)

## Acceptance criteria

- [ ] AC1: Modal app `estalara-stream-consumer-events` defined; entry point function
      `consume_events`
- [ ] AC2: Pydantic models in `apps/stream-consumer/src/models/event.py` mirror Zod schemas from
      packages/shared (envelope + types from TICKET-011)
- [ ] AC3: Consumer subscribes to `events.raw`, processes in batches of 5000 or 5s, whichever first
- [ ] AC4: Failed schema validation: log + skip + emit metric `stream_consumer.schema_failure`
      (don't block batch)
- [ ] AC5: ClickHouse insert uses `JSONEachRow` format for efficiency; on failure retries 3x with
      backoff (1s, 5s, 30s); after exhaustion writes to dead-letter topic `events.dlq`
- [ ] AC6: Offsets committed only after successful ClickHouse insert (at-least-once delivery;
      deduplication via event_id PK in ClickHouse handled by ReplicatedMergeTree merge process)
- [ ] AC7: Unit tests cover: batching by count, batching by time, schema failure handling, retry on
      ClickHouse failure, DLQ write on retry exhaustion
- [ ] AC8: Integration test: docker-compose Redpanda + ClickHouse + this consumer, produce 100
      events to topic, verify 100 rows in ClickHouse `events` table, verify offsets committed
- [ ] AC9: Python build backend MUST be `setuptools.build_meta`, `__init__.py` present in src/
- [ ] AC10: All CI checks pass; new CI job for stream-consumer Python tests
- [ ] AC11: PR title `feat(data): stream consumer events scaffold [TICKET-015]`

## Implementation guidance

```python
# apps/stream-consumer/src/main.py
import modal

app = modal.App("estalara-stream-consumer-events")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("confluent-kafka>=2.0", "clickhouse-connect>=0.7", "pydantic>=2.0")
)

@app.function(
    image=image,
    secrets=[modal.Secret.from_name("redpanda-creds"), modal.Secret.from_name("clickhouse-creds")],
    cpu=1,
    memory=512,
    timeout=86400,  # long-running
    keep_warm=1,
)
def consume_events():
    from src.consumers.events import run_consumer
    run_consumer()
```

```python
# apps/stream-consumer/src/consumers/events.py
import os
import time
from typing import List
from confluent_kafka import Consumer
from src.clickhouse_client import ClickHouseClient
from src.redpanda_client import build_consumer
from src.models.event import EventEnvelope


BATCH_MAX_SIZE = 5000
BATCH_MAX_WAIT_S = 5


def run_consumer():
    consumer = build_consumer(group_id="stream-consumer-events", topics=["events.raw"])
    ch = ClickHouseClient.from_env()

    batch: list[dict] = []
    batch_started_at = time.time()

    while True:
        msg = consumer.poll(timeout=1.0)
        if msg is None:
            should_flush = batch and (time.time() - batch_started_at >= BATCH_MAX_WAIT_S)
        else:
            if msg.error():
                # log + continue
                continue
            try:
                event = EventEnvelope.model_validate_json(msg.value())
                batch.append(event.model_dump())
            except Exception as e:
                # log schema failure metric
                continue
            should_flush = len(batch) >= BATCH_MAX_SIZE

        if should_flush and batch:
            try:
                ch.insert_events(batch)
                consumer.commit(asynchronous=False)
                batch = []
                batch_started_at = time.time()
            except Exception as e:
                # retry handled inside ClickHouseClient; if exhausted, write DLQ
                handle_clickhouse_failure(batch, consumer)
                batch = []
                batch_started_at = time.time()
```

For Pydantic model:

```python
# apps/stream-consumer/src/models/event.py
from typing import Literal, Any
from pydantic import BaseModel, Field
from uuid import UUID


class EventEnvelope(BaseModel):
    event_id: UUID
    tenant_id: UUID
    session_id: str = Field(min_length=32, max_length=64)
    ts: int = Field(gt=0)
    region: Literal["eu", "us", "uk", "uae"]
    consent_state: Literal["none", "session-only", "legitimate-interest", "consented"]
    schema_version: Literal[1]
    type: str
    payload: dict[str, Any]
    listing_id: str | None = None
    archetype_hint: str | None = None
    ingest_received_at: int | None = None
```

## Test plan

- Unit: 8+ tests as per AC7
- Integration: docker-compose with Redpanda + ClickHouse + consumer; produce 100 events; assert 100
  rows in events table; assert offsets advanced

## Definition of Done

- [ ] Branch `data-engineer/TICKET-015-stream-consumer-events`
- [ ] PR title above
- [ ] All ACs verified including Python conventions (build_meta + **init**.py)
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean (markdown only — Python uses ruff/black per CONVENTIONS)
- [ ] HANDOFF: TICKET-015 → TICKET-016 (smoke test e2e)

## Notes

- Use `confluent-kafka` not `kafka-python`. The former is a C binding and 10x faster.
- Modal's `keep_warm=1` keeps one replica always running. For MVP that's fine; in Sprint 10 we tune
  scaling.
- Pydantic + Zod schema duplication is annoying. If it becomes a real maintenance burden, escalate
  for ADR on codegen approach (e.g., `quicktype` from JSON Schema).
