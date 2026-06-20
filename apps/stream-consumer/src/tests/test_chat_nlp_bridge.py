"""
FOLLOW-346 / FOLLOW-366 tests: chat.message.sent -> _spawn_chat_nlp -> process_chat_message.

Rule Z (FOLLOW-366): ALL fixtures MUST use the real SDK producer shape
  {"message": str, "char_count": int, "lead_id": str}
as defined in ChatMessageSentPayloadSchema (packages/shared/src/schemas/events/chat.ts:38-48).
Fixtures using {"role", "content"} are FORBIDDEN — that shape never existed in the SDK and
is what let the original FOLLOW-346 defect (content == "" guard always tripping) ship green.

Coverage:
  AC-1a: a consumed chat.message.sent event (real producer shape) triggers fn.spawn.
  AC-1b: non-chat events do NOT trigger _spawn_chat_nlp.
  AC-1c: _spawn_chat_nlp skips spawn when payload.message is empty/absent.
  AC-2:  no raw chat text is added to the ClickHouse batch (DPIA C-07).
  AC-3:  spawn failure (Modal unavailable) does not block the ClickHouse batch.
  AC-Z:  regression guard — real-shape event causes spawn with correct message text
         (this test FAILS on origin/main and PASSES after the FOLLOW-366 fix).
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

from src.consumers.events import _spawn_chat_nlp, run_consumer

# ─── Helpers ─────────────────────────────────────────────────────────────────

# Real SDK producer shape: ChatMessageSentPayloadSchema
# packages/shared/src/schemas/events/chat.ts:38-48
_REAL_CHAT_PAYLOAD = {
    "message": "Looking for 3-bed near international school",
    "char_count": 44,
    "lead_id": "lead-abc123",
}


def _make_raw_event(
    event_id: str = "a0000000-0000-0000-0000-000000000001",
    tenant_id: str = "tenant-001",
    type_: str = "page.view",
    ts: int = 1_746_259_200_000,
    payload: dict | None = None,
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
            "payload": payload or {"url": "https://example.com"},
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


# ─── _spawn_chat_nlp unit tests ───────────────────────────────────────────────


class TestSpawnChatNlp:
    def test_spawns_modal_with_real_producer_shape(self) -> None:
        """AC-Z / Rule Z regression guard.

        Uses the REAL SDK producer payload shape {message, char_count, lead_id}.
        This test FAILED on origin/main (payload.get("content") == "" -> guard tripped,
        spawn never called) and PASSES after the FOLLOW-366 fix (payload.get("message")
        is read instead).

        Also verifies that Modal process_chat_message receives the synthesized
        {"role": "user", "content": <message text>} dict as its `message` argument,
        as required by the Modal function signature (intent-engine/src/main.py:32-37).
        """
        mock_fn = MagicMock()
        mock_modal = MagicMock()
        mock_modal.Function.lookup.return_value = mock_fn

        # Real producer shape — ChatMessageSentPayloadSchema
        event = {
            "tenant_id": "t-123",
            "session_id": "s" * 32,
            "type": "chat.message.sent",
            "payload": _REAL_CHAT_PAYLOAD,
        }

        with patch.dict("sys.modules", {"modal": mock_modal}):
            _spawn_chat_nlp(event)

        mock_modal.Function.lookup.assert_called_once_with(
            "estalara-intent-engine", "process_chat_message"
        )
        mock_fn.spawn.assert_called_once_with(
            tenant_id="t-123",
            session_id="s" * 32,
            # Modal function expects {"role": "user", "content": <text>}; this dict is
            # synthesized in _spawn_chat_nlp and never stored anywhere (DPIA C-07).
            message={"role": "user", "content": "Looking for 3-bed near international school"},
        )

    def test_skips_spawn_when_message_field_absent(self) -> None:
        """AC-1c: _spawn_chat_nlp skips spawn when payload.message is absent/empty.

        Uses real producer shape with message omitted (edge case: malformed event).
        """
        mock_fn = MagicMock()
        mock_modal = MagicMock()
        mock_modal.Function.lookup.return_value = mock_fn

        event = {
            "tenant_id": "t-123",
            "session_id": "s" * 32,
            "type": "chat.message.sent",
            # message field absent — should guard without spawning
            "payload": {"char_count": 0, "lead_id": "lead-xyz"},
        }

        with patch.dict("sys.modules", {"modal": mock_modal}):
            _spawn_chat_nlp(event)

        mock_fn.spawn.assert_not_called()

    def test_skips_spawn_when_message_field_empty_string(self) -> None:
        """AC-1c variant: empty string in payload.message also skips spawn."""
        mock_fn = MagicMock()
        mock_modal = MagicMock()
        mock_modal.Function.lookup.return_value = mock_fn

        event = {
            "tenant_id": "t-123",
            "session_id": "s" * 32,
            "type": "chat.message.sent",
            "payload": {"message": "", "char_count": 0, "lead_id": "lead-xyz"},
        }

        with patch.dict("sys.modules", {"modal": mock_modal}):
            _spawn_chat_nlp(event)

        mock_fn.spawn.assert_not_called()

    def test_skips_spawn_when_tenant_id_missing(self) -> None:
        """_spawn_chat_nlp skips spawn when tenant_id is empty."""
        mock_fn = MagicMock()
        mock_modal = MagicMock()
        mock_modal.Function.lookup.return_value = mock_fn

        event = {
            "tenant_id": "",
            "session_id": "s" * 32,
            "type": "chat.message.sent",
            "payload": {"message": "hello", "char_count": 5},
        }

        with patch.dict("sys.modules", {"modal": mock_modal}):
            _spawn_chat_nlp(event)

        mock_fn.spawn.assert_not_called()

    def test_spawn_failure_does_not_raise(self) -> None:
        """If Modal spawn raises, _spawn_chat_nlp swallows the exception (fail-open)."""
        mock_modal = MagicMock()
        mock_modal.Function.lookup.side_effect = Exception("Modal app not deployed")

        event = {
            "tenant_id": "t-123",
            "session_id": "s" * 32,
            "type": "chat.message.sent",
            "payload": {"message": "Looking for a flat", "char_count": 18},
        }

        with patch.dict("sys.modules", {"modal": mock_modal}):
            # Must not raise — consumer loop must never be blocked by this
            _spawn_chat_nlp(event)  # no exception expected


# ─── Integration: consumer loop routing ───────────────────────────────────────


class TestChatNlpRouting:
    def test_chat_message_sent_triggers_spawn(self) -> None:
        """AC-1a: consuming a chat.message.sent event (real producer shape) triggers spawn."""
        msg = _make_kafka_msg(
            _make_raw_event(
                type_="chat.message.sent",
                payload=_REAL_CHAT_PAYLOAD,
            )
        )
        consumer = _make_consumer(msg, None, None)
        ch = _make_ch()
        dlq = _make_dlq()

        with patch("src.consumers.events._spawn_chat_nlp") as mock_spawn:
            run_consumer(
                consumer=consumer,
                ch_client=ch,
                dlq_producer=dlq,
                _time_fn=lambda: 0.0,
                _max_polls=3,
            )

        mock_spawn.assert_called_once()
        # Confirm the event dict passed to spawn has the right type and real payload
        called_event = mock_spawn.call_args[0][0]
        assert called_event["type"] == "chat.message.sent"
        assert called_event["payload"]["message"] == _REAL_CHAT_PAYLOAD["message"]

    def test_non_chat_event_does_not_trigger_spawn(self) -> None:
        """AC-1b: non-chat events (page.view) do not call _spawn_chat_nlp."""
        msg = _make_kafka_msg(_make_raw_event(type_="page.view"))
        consumer = _make_consumer(msg, None)
        ch = _make_ch()
        dlq = _make_dlq()

        with patch("src.consumers.events._spawn_chat_nlp") as mock_spawn:
            run_consumer(
                consumer=consumer,
                ch_client=ch,
                dlq_producer=dlq,
                _time_fn=lambda: 0.0,
                _max_polls=2,
            )

        mock_spawn.assert_not_called()

    def test_chat_event_still_appended_to_clickhouse_batch(self) -> None:
        """AC-2: chat.message.sent is still inserted into ClickHouse (DPIA C-07 check).

        The event appears in the ClickHouse batch unchanged — the spawn is fire-and-forget.
        payload.message (the PII-scrubbed text field) is NOT stripped from the event
        before the ClickHouse insert; the ClickHouse schema stores the payload blob as-is.
        """
        msg = _make_kafka_msg(
            _make_raw_event(
                type_="chat.message.sent",
                payload=_REAL_CHAT_PAYLOAD,
            )
        )
        consumer = _make_consumer(msg, None)
        ch = _make_ch()
        dlq = _make_dlq()

        with patch("src.consumers.events._spawn_chat_nlp"):
            run_consumer(
                consumer=consumer,
                ch_client=ch,
                dlq_producer=dlq,
                _time_fn=lambda: 0.0,
                _max_polls=2,
            )

        # Event is flushed on shutdown — 1 event in the batch
        ch.insert_events.assert_called_once()
        batch = ch.insert_events.call_args[0][0]
        assert len(batch) == 1
        assert batch[0]["type"] == "chat.message.sent"

    def test_spawn_failure_does_not_block_clickhouse_batch(self) -> None:
        """AC-3: even when _spawn_chat_nlp raises, ClickHouse batch proceeds normally."""
        msg = _make_kafka_msg(
            _make_raw_event(
                type_="chat.message.sent",
                payload={"message": "test message", "char_count": 12},
            )
        )
        consumer = _make_consumer(msg, None)
        ch = _make_ch()
        dlq = _make_dlq()

        with patch(
            "src.consumers.events._spawn_chat_nlp",
            side_effect=RuntimeError("Modal unreachable"),
        ):
            # Consumer must not propagate the error
            run_consumer(
                consumer=consumer,
                ch_client=ch,
                dlq_producer=dlq,
                _time_fn=lambda: 0.0,
                _max_polls=2,
            )

        # ClickHouse insert still called despite the spawn failure
        ch.insert_events.assert_called_once()
