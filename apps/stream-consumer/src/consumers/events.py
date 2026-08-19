"""
Main event consumer loop.

Subscribes to the `events` Redpanda topic, batches messages (up to 5000 or 5s),
validates them against EventEnvelope, and inserts valid events into ClickHouse.
Invalid events are skipped and logged. On ClickHouse failure after retries, the
batch is written to the dead-letter topic `events.dlq`.

Offsets are committed only *after* a successful ClickHouse insert (at-least-once
delivery). Duplicate events reaching ClickHouse are handled by the
ReplicatedMergeTree merge process on `event_id`.

chat.message.sent events are routed fire-and-forget to the Modal NLP engine
(process_chat_message) before the ClickHouse batch insert. This write does NOT
block the batch and does NOT add raw chat text to ClickHouse — only the 12-dim
intent vector is persisted (to the Redis shadow namespace by process_chat_message).
DPIA constraint (C-07): zero raw free-text is persisted this cycle.
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
from src.models.event import EventEnvelope, is_valid_boot_timing_payload
from src.redpanda_client import build_consumer, build_producer, is_fatal

_tracer = trace.get_tracer(__name__)

log = structlog.get_logger(__name__)


def _spawn_chat_nlp(event: dict[str, Any]) -> None:
    """Fire-and-forget: spawn Modal process_chat_message for a chat.message.sent event.

    Extracts tenant_id, session_id, the message text, and the §H.9 opt-out flag from
    the event payload (canonical fields: payload.message, payload.profiling_opt_out per
    ChatMessageSentPayloadSchema) and calls process_chat_message.spawn(...) — a
    non-blocking Modal background call.
    The spawn returns immediately; the Modal function runs asynchronously and writes
    the 12-dim intent vector to the Redis shadow namespace (unless profiling_opt_out
    is True, in which case write_shadow_intent skips the write — §H.9 / FOLLOW-387).

    DPIA constraint (C-07): only tenant_id, session_id, the synthesized message dict
    {"role": "user", "content": <payload.message>}, and profiling_opt_out are forwarded
    to Modal. No raw chat text is written to ClickHouse or Postgres by this function.
    The SDK already PII-scrubs via scrubMessagePii before emission; we do not double-scrub.

    §H.8 invariant: the chat event STILL reaches ClickHouse via the normal batch path
    regardless of profiling_opt_out. This function gates only the AL shadow-prior write.

    Failure posture: any import error (Modal not installed, wrong environment) or
    spawn error is logged and swallowed — the ClickHouse batch is never blocked.
    """
    try:
        import modal  # noqa: PLC0415 — deferred: Modal not required at module load

        tenant_id: str = str(event.get("tenant_id", ""))
        session_id: str = str(event.get("session_id", ""))
        payload: dict[str, Any] = event.get("payload") or {}
        # Canonical producer field is `message` (ChatMessageSentPayloadSchema).
        # Synthesize {"role", "content"} here to satisfy the Modal function signature;
        # this dict is never stored anywhere.
        message_text: str = str(payload.get("message", ""))
        message: dict[str, Any] = {
            "role": "user",
            "content": message_text,
        }
        # §H.9/FOLLOW-387: read the opt-out flag from the event payload.
        # Default False preserves backward-compatibility for in-flight events emitted
        # before the ChatMessageSentPayloadSchema was bumped to carry the field.
        profiling_opt_out: bool = bool(payload.get("profiling_opt_out", False))

        # Validate minimum data before spawning — skip if either id or text is empty.
        if not tenant_id or not session_id or not message["content"]:
            log.warning(
                "chat_nlp_spawn_skipped",
                reason="missing tenant_id, session_id, or content",
                tenant_id=tenant_id,
                session_id=session_id,
            )
            return

        # Lookup the deployed Modal function and spawn (non-blocking background call).
        # modal.Function.lookup raises if the app/function is not deployed; we swallow
        # that so the consumer loop is never blocked in dev/CI environments.
        fn = modal.Function.lookup("estalara-intent-engine", "process_chat_message")
        fn.spawn(
            tenant_id=tenant_id,
            session_id=session_id,
            message=message,
            # §H.9/FOLLOW-387: thread the opt-out flag so process_chat_message can
            # skip write_shadow_intent for opted-out sessions (FOLLOW-384 consumer guard).
            profiling_opt_out=profiling_opt_out,
        )
        log.info(
            "chat_nlp_spawned",
            tenant_id=tenant_id,
            session_id=session_id,
            profiling_opt_out=profiling_opt_out,
        )
    except Exception as exc:  # noqa: BLE001
        # Spawn errors must never block the ClickHouse batch.
        log.warning("chat_nlp_spawn_failed", error=str(exc))


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
                    # FOLLOW-346: route chat.message.sent events to the Modal NLP
                    # engine fire-and-forget BEFORE appending to the ClickHouse batch.
                    # The spawn is non-blocking — the batch insert is never delayed.
                    # DPIA (C-07): _spawn_chat_nlp forwards only tenant_id, session_id,
                    # and the message dict; no raw text is added to the ClickHouse batch.
                    if parsed.get("type") == "chat.message.sent":
                        try:
                            _spawn_chat_nlp(parsed)
                        except Exception as spawn_exc:  # noqa: BLE001
                            # Belt-and-suspenders: _spawn_chat_nlp already catches
                            # all exceptions internally. This outer guard ensures the
                            # consumer loop is never disrupted even if _spawn_chat_nlp
                            # is mocked to raise in tests.
                            log.warning("chat_nlp_spawn_outer_error", error=str(spawn_exc))

                    # FOLLOW-1037 / MP-011: observability-only shape check against the shared
                    # TS<->Python contract (BOOT_TIMING_REQUIRED_FIELDS). Never blocks or
                    # mutates the batch — `events.payload` stores the JSON blob verbatim
                    # regardless — it only makes drift between the SDK producer and this
                    # contract visible in stream-consumer's own logs.
                    if parsed.get("type") == "boot_timing":
                        boot_payload = parsed.get("payload") or {}
                        if not is_valid_boot_timing_payload(boot_payload):
                            log.warning(
                                "boot_timing_payload_contract_drift",
                                payload_keys=list(boot_payload.keys()),
                            )

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
