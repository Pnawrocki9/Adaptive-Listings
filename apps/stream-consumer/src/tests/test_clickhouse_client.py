"""
Unit tests for ClickHouseClient retry / backoff logic.
"""

from __future__ import annotations

from datetime import UTC
from unittest.mock import MagicMock

import pytest

from src.clickhouse_client import ClickHouseClient, _event_to_row, _ms_to_dt

# ─── Helpers ──────────────────────────────────────────────────────────────────


def _sample_event(ts: int = 1_746_259_200_000) -> dict:  # type: ignore[type-arg]
    return {
        "event_id": "a0000000-0000-0000-0000-000000000001",
        "tenant_id": "tenant-001",
        "session_id": "a" * 32,
        "ts": ts,
        "ingest_received_at": ts,
        "region": "eu",
        "type": "page.view",
        "schema_version": 1,
        "consent_state": "consented",
        "listing_id": "listing-001",
        "archetype_hint": "",
        "payload": {"url": "https://example.com"},
    }


# ─── Tests ────────────────────────────────────────────────────────────────────


class TestMsToDatetime:
    def test_converts_ms_to_utc_datetime(self) -> None:

        dt = _ms_to_dt(1_746_259_200_000, 0)
        assert dt.tzinfo == UTC
        assert dt.timestamp() == pytest.approx(1_746_259_200.0, abs=0.001)

    def test_falls_back_when_ms_is_none(self) -> None:
        dt = _ms_to_dt(None, 1_746_259_200_000)
        assert dt.timestamp() == pytest.approx(1_746_259_200.0, abs=0.001)


class TestEventToRow:
    def test_row_has_correct_length(self) -> None:
        row = _event_to_row(_sample_event())
        assert len(row) == 12  # matches _COLUMNS length

    def test_optional_fields_default_to_empty_string(self) -> None:
        event = _sample_event()
        event["listing_id"] = None
        event["archetype_hint"] = None
        row = _event_to_row(event)
        listing_idx = 9  # index in _COLUMNS
        archetype_idx = 10
        assert row[listing_idx] == ""
        assert row[archetype_idx] == ""


class TestClickHouseClientRetry:
    def _make_client(self, side_effects: list, sleep_calls: list) -> ClickHouseClient:
        mock_ch = MagicMock()
        mock_ch.insert.side_effect = side_effects
        sleep_mock = MagicMock(side_effect=lambda d: sleep_calls.append(d))
        return ClickHouseClient(client=mock_ch, retry_delays=(1, 5, 30), sleep_fn=sleep_mock)

    def test_succeeds_on_first_attempt(self) -> None:
        sleep_calls: list[float] = []
        client = self._make_client([None], sleep_calls)
        client.insert_events([_sample_event()])
        assert sleep_calls == []

    def test_retries_on_failure_then_succeeds(self) -> None:
        sleep_calls: list[float] = []
        # Fail first attempt, succeed second
        client = self._make_client([Exception("timeout"), None], sleep_calls)
        client.insert_events([_sample_event()])
        assert sleep_calls == [1]  # first backoff

    def test_raises_after_all_retries_exhausted(self) -> None:
        sleep_calls: list[float] = []
        client = self._make_client(
            [Exception("err1"), Exception("err2"), Exception("err3"), Exception("err4")],
            sleep_calls,
        )
        with pytest.raises(RuntimeError, match="failed after"):
            client.insert_events([_sample_event()])
        assert sleep_calls == [1, 5, 30]  # all three backoffs

    def test_empty_batch_is_noop(self) -> None:
        sleep_calls: list[float] = []
        client = self._make_client([], sleep_calls)
        client.insert_events([])
        client._client.insert.assert_not_called()
