"""
Unit tests for the events consumer loop.

All Kafka and ClickHouse interactions are mocked — no network access required.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from unittest.mock import MagicMock

from src.consumers.events import BATCH_MAX_SIZE, BATCH_MAX_WAIT_S, _parse_message, run_consumer

# ─── Helpers ──────────────────────────────────────────────────────────────────


def _time_seq(*values: float) -> Callable[[], float]:
    """Return a callable that yields values in order, repeating the last indefinitely."""
    vals = list(values)
    state = [0]

    def _fn() -> float:
        i = min(state[0], len(vals) - 1)
        state[0] += 1
        return vals[i]

    return _fn


def _make_raw_event(
    event_id: str = "a0000000-0000-0000-0000-000000000001",
    tenant_id: str = "tenant-001",
    type_: str = "page.view",
    ts: int = 1_746_259_200_000,
) -> bytes:
    return json.dumps(
        {
            "event_id": event_id,
            "tenant_id": tenant_id,
            "session_id": "a" * 32,
            "ts": ts,
            "region": "eu",
            "consent_state": "consented",
            "schema_version": 1,
            "type": type_,
            "payload": {"url": "https://example.com"},
            "ingest_received_at": ts,
        }
    ).encode()


def _make_kafka_msg(value: bytes, topic: str = "events", offset: int = 0) -> MagicMock:
    msg = MagicMock()
    msg.error.return_value = None
    msg.value.return_value = value
    msg.topic.return_value = topic
    msg.offset.return_value = offset
    return msg


def _make_consumer(*poll_returns: object) -> MagicMock:
    consumer = MagicMock()
    consumer.poll.side_effect = list(poll_returns)
    return consumer


def _make_ch() -> MagicMock:
    ch = MagicMock()
    ch.insert_events.return_value = None
    return ch


def _make_dlq() -> MagicMock:
    dlq = MagicMock()
    dlq.produce.return_value = None
    dlq.flush.return_value = 0
    return dlq


# ─── ParseMessage tests ────────────────────────────────────────────────────────


class TestParseMessage:
    def test_valid_event_is_parsed(self) -> None:
        msg = _make_kafka_msg(_make_raw_event())
        result = _parse_message(msg)
        assert result is not None
        assert result["type"] == "page.view"

    def test_invalid_json_returns_none(self) -> None:
        msg = _make_kafka_msg(b"{not-json}")
        assert _parse_message(msg) is None

    def test_schema_violation_returns_none(self) -> None:
        bad = json.dumps(
            {
                "event_id": "a0000000-0000-0000-0000-000000000001",
                "tenant_id": "t1",
                "session_id": "a" * 32,
                "ts": 1_000_000,
                "region": "mars",  # invalid enum
                "consent_state": "consented",
                "schema_version": 1,
                "type": "page.view",
                "payload": {},
            }
        ).encode()
        assert _parse_message(_make_kafka_msg(bad)) is None

    def test_non_bytes_value_returns_none(self) -> None:
        msg = MagicMock()
        msg.error.return_value = None
        msg.value.return_value = None
        msg.topic.return_value = "events"
        assert _parse_message(msg) is None


# ─── Batching by count ─────────────────────────────────────────────────────────


class TestBatchingByCount:
    def test_flushes_exactly_at_batch_max_size(self) -> None:
        """insert_events is called once with BATCH_MAX_SIZE events."""
        # Use 7-digit zero-padded decimal — all digits 0-9 are valid hex
        msgs = [
            _make_kafka_msg(
                _make_raw_event(
                    event_id=f"a{i:07d}-0000-0000-0000-000000000001",
                    ts=1_746_259_200_000 + i,
                )
            )
            for i in range(BATCH_MAX_SIZE)
        ]
        # Nones after the flush let the loop exit via _max_polls
        consumer = _make_consumer(*msgs, *([None] * 5))
        ch = _make_ch()
        dlq = _make_dlq()

        run_consumer(
            consumer=consumer,
            ch_client=ch,
            dlq_producer=dlq,
            _time_fn=lambda: 0.0,
            _max_polls=BATCH_MAX_SIZE + 5,
        )

        ch.insert_events.assert_called_once()
        assert len(ch.insert_events.call_args[0][0]) == BATCH_MAX_SIZE

    def test_remaining_events_flushed_on_shutdown(self) -> None:
        """Events below max size are flushed when the loop exits (graceful shutdown)."""
        msgs = [
            _make_kafka_msg(_make_raw_event(event_id=f"a{i:07d}-0000-0000-0000-000000000001"))
            for i in range(10)
        ]
        consumer = _make_consumer(*msgs, *([None] * 5))
        ch = _make_ch()
        dlq = _make_dlq()

        run_consumer(
            consumer=consumer,
            ch_client=ch,
            dlq_producer=dlq,
            _time_fn=lambda: 0.0,  # time never advances → no time-based flush
            _max_polls=15,
        )

        # Finally-block flush: exactly the 10 remaining events
        ch.insert_events.assert_called_once()
        assert len(ch.insert_events.call_args[0][0]) == 10


# ─── Batching by time ─────────────────────────────────────────────────────────


class TestBatchingByTime:
    def test_flushes_after_wait_period_on_poll_none(self) -> None:
        """A poll returning None triggers a flush if batch_max_wait_s has elapsed."""
        msg = _make_kafka_msg(_make_raw_event())
        consumer = _make_consumer(msg, None, None)
        ch = _make_ch()
        dlq = _make_dlq()

        # init=0, poll1=0, poll2=WAIT+1 (triggers flush), reset=WAIT+1, poll3=WAIT+1
        run_consumer(
            consumer=consumer,
            ch_client=ch,
            dlq_producer=dlq,
            _time_fn=_time_seq(0.0, 0.0, BATCH_MAX_WAIT_S + 1.0, BATCH_MAX_WAIT_S + 1.0),
            _max_polls=3,
        )

        ch.insert_events.assert_called_once()

    def test_no_flush_in_loop_when_time_not_elapsed(self) -> None:
        """Frozen time means no time-based flush; events flushed only at shutdown."""
        msg = _make_kafka_msg(_make_raw_event())
        consumer = _make_consumer(msg, None)
        ch = _make_ch()
        dlq = _make_dlq()

        run_consumer(
            consumer=consumer,
            ch_client=ch,
            dlq_producer=dlq,
            _time_fn=lambda: 0.0,
            _max_polls=2,
        )

        # One flush only — from the finally block (1 remaining event)
        ch.insert_events.assert_called_once()
        assert len(ch.insert_events.call_args[0][0]) == 1


# ─── Schema failure handling ───────────────────────────────────────────────────


class TestSchemaFailureHandling:
    def test_invalid_events_skipped_not_blocking(self) -> None:
        """Invalid events increment schema failure counter but don't stop processing."""
        bad_msg = _make_kafka_msg(b"{invalid}")
        good_msg = _make_kafka_msg(_make_raw_event())
        consumer = _make_consumer(*([bad_msg] * 10), good_msg)
        ch = _make_ch()
        dlq = _make_dlq()

        run_consumer(
            consumer=consumer,
            ch_client=ch,
            dlq_producer=dlq,
            _time_fn=lambda: 0.0,
            _max_polls=11,
        )

        # Exactly 1 valid event flushed at shutdown (the good_msg)
        ch.insert_events.assert_called_once()
        assert len(ch.insert_events.call_args[0][0]) == 1

    def test_schema_failures_do_not_commit_offsets(self) -> None:
        """Processing a bad message must not trigger a commit."""
        bad_msg = _make_kafka_msg(b"bad")
        consumer = _make_consumer(bad_msg)
        ch = _make_ch()
        dlq = _make_dlq()

        run_consumer(
            consumer=consumer,
            ch_client=ch,
            dlq_producer=dlq,
            _time_fn=lambda: 0.0,
            _max_polls=1,
        )

        # No valid events → no flush → no commit
        consumer.commit.assert_not_called()


# ─── ClickHouse retry and DLQ ─────────────────────────────────────────────────


class TestClickHouseRetryAndDLQ:
    def test_dlq_written_on_clickhouse_exhaustion(self) -> None:
        """After ClickHouseClient raises RuntimeError the batch goes to the DLQ."""
        msg = _make_kafka_msg(_make_raw_event())
        consumer = _make_consumer(msg, None, None)
        ch = _make_ch()
        ch.insert_events.side_effect = RuntimeError("ClickHouse insert failed after 3 attempts")
        dlq = _make_dlq()

        run_consumer(
            consumer=consumer,
            ch_client=ch,
            dlq_producer=dlq,
            _time_fn=_time_seq(0.0, 0.0, BATCH_MAX_WAIT_S + 1.0, BATCH_MAX_WAIT_S + 1.0),
            _max_polls=3,
        )

        dlq.produce.assert_called_once()
        dlq.flush.assert_called()

    def test_offsets_committed_after_dlq_write(self) -> None:
        """Offset must advance even when the batch is sent to DLQ."""
        msg = _make_kafka_msg(_make_raw_event())
        consumer = _make_consumer(msg, None, None)
        ch = _make_ch()
        ch.insert_events.side_effect = RuntimeError("ClickHouse insert failed after 3 attempts")
        dlq = _make_dlq()

        run_consumer(
            consumer=consumer,
            ch_client=ch,
            dlq_producer=dlq,
            _time_fn=_time_seq(0.0, 0.0, BATCH_MAX_WAIT_S + 1.0, BATCH_MAX_WAIT_S + 1.0),
            _max_polls=3,
        )

        consumer.commit.assert_called_once_with(asynchronous=False)

    def test_offset_committed_on_successful_insert(self) -> None:
        """After a successful ClickHouse insert, the offset must be committed."""
        msg = _make_kafka_msg(_make_raw_event())
        consumer = _make_consumer(msg, None, None)
        ch = _make_ch()
        dlq = _make_dlq()

        run_consumer(
            consumer=consumer,
            ch_client=ch,
            dlq_producer=dlq,
            _time_fn=_time_seq(0.0, 0.0, BATCH_MAX_WAIT_S + 1.0, BATCH_MAX_WAIT_S + 1.0),
            _max_polls=3,
        )

        consumer.commit.assert_called_once_with(asynchronous=False)
        ch.insert_events.assert_called_once()
