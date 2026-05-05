"""
Main event consumer loop.

Subscribes to the `events` Redpanda topic, batches messages (up to 5000 or 5s),
validates them against EventEnvelope, and inserts valid events into ClickHouse.
Invalid events are skipped and logged. On ClickHouse failure after retries, the
batch is written to the dead-letter topic `events.dlq`.

Offsets are committed only *after* a successful ClickHouse insert (at-least-once
delivery). Duplicate events reaching ClickHouse are handled by the
ReplicatedMergeTree merge process on `event_id`.
"""

from __future__ import annotations

import json
import os
import signal
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import structlog
from confluent_kafka import Consumer, KafkaError, Message, Producer
from opentelemetry import trace
from opentelemetry.context import Context
from opentelemetry.propagate import extract
from pydantic import ValidationError

from src.clickhouse_client import ClickHouseClient
from src.models.event import EventEnvelope
from src.redpanda_client import build_consumer, build_producer, is_fatal

_tracer = trace.get_tracer(__name__)

log = structlog.get_logger(__name__)

def _extract_trace_context(msg: Message) -> Context:
    """Extract W3C trace context from Kafka message headers.

    Header values arriving via Pandaproxy are base64-encoded bytes; decode to str
    before passing to the OTel extractor so the W3C propagator can parse them.
    Returns an empty context if no traceparent header is present.
    """
    carrier: dict[str, str] = {}
    raw_headers = msg.headers()
    if raw_headers:
        for header_key, header_value in raw_headers:
            try:
                carrier[header_key] = (
                    header_value.decode("utf-8")
                    if isinstance(header_value, bytes)
                    else str(header_value)
                )
            except (UnicodeDecodeError, AttributeError):
                pass
    return extract(carrier)


BATCH_MAX_SIZE: int = 5000
BATCH_MAX_WAIT_S: float = 5.0
DLQ_TOPIC: str = os.environ.get("REDPANDA_DLQ_TOPIC", "events.dlq")
CONSUMER_TOPIC: str = os.environ.get("REDPANDA_TOPIC", "events")
CONSUMER_GROUP: str = os.environ.get("CONSUMER_GROUP_ID", "stream-consumer-events")


@dataclass
class _BatchMetrics:
    processed: int = 0
    schema_failures: int = 0
    kafka_errors: int = 0
    inserts: int = 0
    dlq_writes: int = 0
    session_events: list[str] = field(default_factory=list)

    def log_summary(self) -> None:
        log.info(
            "batch_summary",
            processed=self.processed,
            schema_failures=self.schema_failures,
            kafka_errors=self.kafka_errors,
            inserts=self.inserts,
            dlq_writes=self.dlq_writes,
        )


def _parse_message(msg: Message) -> dict[str, Any] | None:
    """Deserialise and validate a Kafka message. Returns None on failure."""
    raw = msg.value()
    if not isinstance(raw, bytes):
        log.warning("stream_consumer.schema_failure", reason="non-bytes value", topic=msg.topic())
        return None
    try:
        envelope = EventEnvelope.model_validate_json(raw)
        # mode='json' converts UUID → str, avoids serialization issues in DLQ writes
        return envelope.model_dump(mode="json")
    except (ValidationError, ValueError) as exc:
        log.warning(
            "stream_consumer.schema_failure",
            reason=str(exc),
            topic=msg.topic(),
            offset=msg.offset(),
        )
        return None


def _flush_batch(
    batch: list[dict[str, Any]],
    consumer: Consumer,
    ch: ClickHouseClient,
    dlq: Producer,
    metrics: _BatchMetrics,
) -> None:
    """Insert batch into ClickHouse; on exhaustion write to DLQ and commit."""
    if not batch:
        return
    try:
        ch.insert_events(batch)
        consumer.commit(asynchronous=False)
        metrics.inserts += len(batch)
        log.info("batch_flushed", count=len(batch))
    except Exception as exc:
        log.error("batch_flush_failed_writing_dlq", count=len(batch), error=str(exc))
        _write_dlq(dlq, batch)
        consumer.commit(asynchronous=False)
        metrics.dlq_writes += len(batch)


def _write_dlq(producer: Producer, events: list[dict[str, Any]]) -> None:
    for event in events:
        try:
            producer.produce(DLQ_TOPIC, value=json.dumps(event).encode())
        except Exception as exc:
            log.error("dlq_produce_failed", error=str(exc))
    producer.flush(timeout=10.0)


def run_consumer(
    consumer: Consumer | None = None,
    ch_client: ClickHouseClient | None = None,
    dlq_producer: Producer | None = None,
    *,
    batch_max_size: int = BATCH_MAX_SIZE,
    batch_max_wait_s: float = BATCH_MAX_WAIT_S,
    _time_fn: Callable[[], float] = time.time,
    _max_polls: int | None = None,
) -> None:
    """
    Run the Redpanda → ClickHouse consumer loop.

    Dependency-injection parameters allow unit tests to provide mocks without
    needing actual Redpanda / ClickHouse connections.

    Args:
        consumer:        Pre-built confluent_kafka.Consumer (built from env if None).
        ch_client:       Pre-built ClickHouseClient (built from env if None).
        dlq_producer:    Pre-built confluent_kafka.Producer (built from env if None).
        batch_max_size:  Flush after this many messages (default 5000).
        batch_max_wait_s: Flush after this many seconds since last flush (default 5.0).
        _time_fn:        Callable returning current time; injectable for tests.
        _max_polls:      Stop after this many poll calls (None = run forever).
    """
    if consumer is None:
        consumer = build_consumer(CONSUMER_GROUP, [CONSUMER_TOPIC])
    if ch_client is None:
        ch_client = ClickHouseClient.from_env()
    if dlq_producer is None:
        dlq_producer = build_producer()

    running = True

    def _shutdown(*_: object) -> None:
        nonlocal running
        log.info("shutdown_signal_received")
        running = False

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    batch: list[dict[str, Any]] = []
    batch_started_at: float = _time_fn()
    metrics = _BatchMetrics()
    poll_count = 0

    log.info("consumer_started", topic=CONSUMER_TOPIC, group=CONSUMER_GROUP)

    try:
        while running:
            if _max_polls is not None and poll_count >= _max_polls:
                break

            msg: Message | None = consumer.poll(timeout=1.0)
            poll_count += 1
            now = _time_fn()

            if msg is None:
                should_flush = bool(batch) and (now - batch_started_at >= batch_max_wait_s)
            elif msg.error():
                err: KafkaError = msg.error()
                log.error("kafka_error", code=err.code(), str=err.str(), fatal=err.fatal())
                metrics.kafka_errors += 1
                if is_fatal(err):
                    break
                should_flush = False
            else:
                ctx = _extract_trace_context(msg)
                with _tracer.start_as_current_span(
                    "consume_event",
                    context=ctx,
                    kind=trace.SpanKind.CONSUMER,
                    attributes={
                        "messaging.system": "kafka",
                        "messaging.destination": msg.topic(),
                        "messaging.kafka.partition": msg.partition(),
                        "messaging.kafka.offset": msg.offset(),
                    },
                ):
                    parsed = _parse_message(msg)
                if parsed is None:
                    metrics.schema_failures += 1
                    should_flush = False
                else:
                    batch.append(parsed)
                    metrics.processed += 1
                    should_flush = len(batch) >= batch_max_size

            if should_flush:
                _flush_batch(batch, consumer, ch_client, dlq_producer, metrics)
                batch = []
                batch_started_at = _time_fn()
                metrics.log_summary()
                metrics = _BatchMetrics()

    finally:
        # Flush any remaining events before exiting
        if batch:
            log.info("flushing_remaining_on_shutdown", count=len(batch))
            _flush_batch(batch, consumer, ch_client, dlq_producer, metrics)
        consumer.close()
        log.info("consumer_stopped")
