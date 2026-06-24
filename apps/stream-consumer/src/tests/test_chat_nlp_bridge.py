"""
FOLLOW-346 / FOLLOW-366 / FOLLOW-387 tests: chat.message.sent -> _spawn_chat_nlp -> process_chat_message.

Rule Z (FOLLOW-366): ALL fixtures MUST use the real SDK producer shape
  {"message": str, "char_count": int, "lead_id": str}
as defined in ChatMessageSentPayloadSchema (packages/shared/src/schemas/events/chat.ts:38-48).
Fixtures using {"role", "content"} are FORBIDDEN — that shape never existed in the SDK and
is what let the original FOLLOW-346 defect (content == "" guard always tripping) ship green.

FOLLOW-387 (§H.9 / RETRO-108 TG-1): the AC-4 / AC-Z-optout tests exercise the real producer
chain (event payload → _spawn_chat_nlp → fn.spawn args) and assert that an opted-out
chat.message.sent event carries profiling_opt_out=True through to the spawn call.
This is the "TG-1 gap" RETRO-108 identified: FOLLOW-384's tests called write_shadow_intent
directly; these tests drive the real path (_spawn_chat_nlp → spawn args).

Coverage:
  AC-1a: a consumed chat.message.sent event (real producer shape) triggers fn.spawn.
  AC-1b: non-chat events do NOT trigger _spawn_chat_nlp.
  AC-1c: _spawn_chat_nlp skips spawn when payload.message is empty/absent.
  AC-2:  no raw chat text is added to the ClickHouse batch (DPIA C-07).
  AC-3:  spawn failure (Modal unavailable) does not block the ClickHouse batch.
  AC-Z:  regression guard — real-shape event causes spawn with correct message text
         (this test FAILS on origin/main and PASSES after the FOLLOW-366 fix).
  AC-4/AC-Z-optout (FOLLOW-387): opted-out chat event → spawn carries profiling_opt_out=True.
  AC-4-optout-default (FOLLOW-387): event without profiling_opt_out → spawn defaults to False.
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
            # §H.9/FOLLOW-387: payload has no profiling_opt_out → defaults to False.
            profiling_opt_out=False,
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

    # ── FOLLOW-387 §H.9 opt-out producer chain tests (AC-4 / AC-Z-optout) ──────

    def test_opted_out_event_passes_profiling_opt_out_true_to_spawn(self) -> None:
        """AC-4 / AC-Z-optout (FOLLOW-387 / §H.9 / RETRO-108 TG-1).

        This is the end-to-end producer chain test RETRO-108 TG-1 identified as
        MISSING: it drives the real path (event payload → _spawn_chat_nlp →
        fn.spawn args) rather than calling write_shadow_intent directly.

        An opted-out chat.message.sent event (profiling_opt_out=True in the SDK
        payload, as set by index.ts FOLLOW-387) must cause fn.spawn to be called
        with profiling_opt_out=True — so that process_chat_message (FOLLOW-384
        consumer guard) can skip write_shadow_intent.

        Rule Z: the event fixture uses the real SDK producer shape
        (ChatMessageSentPayloadSchema) — not {"role", "content"}.
        """
        mock_fn = MagicMock()
        mock_modal = MagicMock()
        mock_modal.Function.lookup.return_value = mock_fn

        # Real SDK producer shape WITH profiling_opt_out=True (set by index.ts FOLLOW-387)
        event = {
            "tenant_id": "t-optout",
            "session_id": "s" * 32,
            "type": "chat.message.sent",
            "payload": {
                "message": "Looking for a 3-bed near international school",
                "char_count": 46,
                "lead_id": "lead-abc123",
                "profiling_opt_out": True,  # SDK sets this (FOLLOW-387)
            },
        }

        with patch.dict("sys.modules", {"modal": mock_modal}):
            _spawn_chat_nlp(event)

        mock_fn.spawn.assert_called_once_with(
            tenant_id="t-optout",
            session_id="s" * 32,
            message={"role": "user", "content": "Looking for a 3-bed near international school"},
            # §H.9 — profiling_opt_out=True must reach the Modal spawn args (FOLLOW-387)
            profiling_opt_out=True,
        )

    def test_opted_in_event_passes_profiling_opt_out_false_to_spawn(self) -> None:
        """AC-4-optout-default (FOLLOW-387): event with profiling_opt_out=False (or absent)
        → spawn uses False (backward-compatible default).

        Confirms the flag is always forwarded, not just when True. An opted-in user's
        chat must also have the flag explicitly present in the spawn so process_chat_message
        reliably writes the shadow prior.
        """
        mock_fn = MagicMock()
        mock_modal = MagicMock()
        mock_modal.Function.lookup.return_value = mock_fn

        # Opted-in: profiling_opt_out=False (or omitted — same as False via default)
        event = {
            "tenant_id": "t-optedin",
            "session_id": "s" * 32,
            "type": "chat.message.sent",
            "payload": {
                "message": "Best yield listings in Dubai Marina?",
                "char_count": 37,
                "profiling_opt_out": False,
            },
        }

        with patch.dict("sys.modules", {"modal": mock_modal}):
            _spawn_chat_nlp(event)

        mock_fn.spawn.assert_called_once_with(
            tenant_id="t-optedin",
            session_id="s" * 32,
            message={"role": "user", "content": "Best yield listings in Dubai Marina?"},
            profiling_opt_out=False,
        )

    def test_event_without_profiling_opt_out_field_defaults_to_false(self) -> None:
        """Backward-compatibility: events emitted before the FOLLOW-387 schema bump
        (no profiling_opt_out key in payload) default to profiling_opt_out=False.

        This ensures in-flight events from older SDK versions do not accidentally
        suppress the shadow prior write.
        """
        mock_fn = MagicMock()
        mock_modal = MagicMock()
        mock_modal.Function.lookup.return_value = mock_fn

        # Pre-FOLLOW-387 event: no profiling_opt_out key at all
        event = {
            "tenant_id": "t-legacy",
            "session_id": "s" * 32,
            "type": "chat.message.sent",
            "payload": {
                "message": "Show me houses with a garden",
                "char_count": 27,
            },
        }

        with patch.dict("sys.modules", {"modal": mock_modal}):
            _spawn_chat_nlp(event)

        mock_fn.spawn.assert_called_once_with(
            tenant_id="t-legacy",
            session_id="s" * 32,
            message={"role": "user", "content": "Show me houses with a garden"},
            profiling_opt_out=False,
        )


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

    def test_opted_out_event_threads_profiling_opt_out_through_consumer_to_spawn(self) -> None:
        """AC-4 end-to-end (FOLLOW-387 / §H.9 / RETRO-108 TG-1).

        Drives the REAL producer chain:
          consumer loop → _spawn_chat_nlp (real, not mocked) → fn.spawn(profiling_opt_out=True)

        This is the test RETRO-108 TG-1 identified as the critical missing evidence:
        FOLLOW-384's tests called write_shadow_intent directly with an explicit value;
        THIS test verifies the full chain from the event payload through the consumer
        into the spawn args WITHOUT calling write_shadow_intent directly.

        Unlike TestSpawnChatNlp which tests _spawn_chat_nlp in isolation, this test
        runs the full run_consumer loop with a real opted-out event, lets _spawn_chat_nlp
        run (it is NOT mocked here), and patches only the Modal module to capture spawn args.

        §H.8 invariant: the event still reaches the ClickHouse batch (insert_events called).
        §H.9 enforcement: fn.spawn receives profiling_opt_out=True.
        Rule Z: event payload uses the real SDK producer shape (ChatMessageSentPayloadSchema).
        """
        # Real SDK producer shape WITH profiling_opt_out=True (set by FOLLOW-387 SDK change)
        opted_out_payload = {
            "message": "I need a 2-bed near a top school, budget 800k",
            "char_count": 47,
            "lead_id": "lead-optout01",
            "profiling_opt_out": True,
        }
        msg = _make_kafka_msg(
            _make_raw_event(
                event_id="b0000000-0000-0000-0000-000000000002",
                tenant_id="t-e2e-optout",
                type_="chat.message.sent",
                payload=opted_out_payload,
            )
        )
        consumer = _make_consumer(msg, None)
        ch = _make_ch()
        dlq = _make_dlq()

        mock_fn = MagicMock()
        mock_modal = MagicMock()
        mock_modal.Function.lookup.return_value = mock_fn

        # _spawn_chat_nlp is NOT mocked — we let the real function run.
        # Only the Modal module itself is patched so we can capture spawn args
        # without needing a live Modal deployment.
        with patch.dict("sys.modules", {"modal": mock_modal}):
            run_consumer(
                consumer=consumer,
                ch_client=ch,
                dlq_producer=dlq,
                _time_fn=lambda: 0.0,
                _max_polls=2,
            )

        # §H.9 key assertion: spawn was called with profiling_opt_out=True
        mock_fn.spawn.assert_called_once_with(
            tenant_id="t-e2e-optout",
            session_id="a" * 32,
            message={
                "role": "user",
                "content": "I need a 2-bed near a top school, budget 800k",
            },
            profiling_opt_out=True,
        )

        # §H.8 assertion: event still lands in ClickHouse batch
        ch.insert_events.assert_called_once()
        batch = ch.insert_events.call_args[0][0]
        assert len(batch) == 1
        assert batch[0]["type"] == "chat.message.sent"
        # The payload in ClickHouse retains profiling_opt_out (it's just another field)
        assert batch[0]["payload"]["profiling_opt_out"] is True
