"""
ClickHouse client wrapper with retries and row conversion.

Reads connection config from environment variables populated by the Modal
`clickhouse-creds` secret. Wraps clickhouse-connect with:
  - 3-attempt retry with (1s, 5s, 30s) back-off
  - JSONEachRow-style row list → typed column insert
  - Structured logging on every retry / failure
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID

import clickhouse_connect
import structlog
from clickhouse_connect.driver import Client

log = structlog.get_logger(__name__)

# Back-off seconds per attempt (0-indexed: attempt 1 → 1s, 2 → 5s, 3 → 30s).
_RETRY_DELAYS: tuple[int, ...] = (1, 5, 30)

_COLUMNS = [
    "event_id",
    "tenant_id",
    "session_id",
    "ts",
    "ingest_received_at",
    "region",
    "type",
    "schema_version",
    "consent_state",
    "listing_id",
    "archetype_hint",
    "payload",
]


def _ms_to_dt(ms: int | None, fallback_ms: int) -> datetime:
    ts = ms if ms is not None else fallback_ms
    return datetime.fromtimestamp(ts / 1000.0, tz=UTC)


def _event_to_row(event: dict) -> list:  # type: ignore[type-arg]
    return [
        str(event["event_id"]) if isinstance(event["event_id"], UUID) else event["event_id"],
        str(event["tenant_id"]),
        str(event["session_id"]),
        _ms_to_dt(event.get("ts"), event.get("ts", 0)),
        _ms_to_dt(event.get("ingest_received_at"), event.get("ts", 0)),
        str(event.get("region", "")),
        str(event.get("type", "")),
        int(event.get("schema_version", 1)),
        str(event.get("consent_state", "none")),
        str(event.get("listing_id") or ""),
        str(event.get("archetype_hint") or ""),
        json.dumps(event.get("payload", {})),
    ]


class ClickHouseClient:
    """Thin wrapper over clickhouse-connect with retry logic."""

    def __init__(
        self,
        client: Client,
        retry_delays: tuple[int, ...] = _RETRY_DELAYS,
        sleep_fn: Callable[[float], None] = time.sleep,
    ) -> None:
        self._client = client
        self._retry_delays = retry_delays
        self._sleep_fn = sleep_fn

    @classmethod
    def from_env(
        cls,
        retry_delays: tuple[int, ...] = _RETRY_DELAYS,
        sleep_fn: Callable[[float], None] = time.sleep,
    ) -> ClickHouseClient:
        host = os.environ.get("CLICKHOUSE_HOST", "localhost")
        port = int(os.environ.get("CLICKHOUSE_PORT", "8443"))
        user = os.environ.get("CLICKHOUSE_USER", "default")
        password = os.environ.get("CLICKHOUSE_PASSWORD", "")
        database = os.environ.get("CLICKHOUSE_DATABASE", "default")
        secure = port == 8443 or os.environ.get("CLICKHOUSE_SECURE", "false").lower() == "true"

        client = clickhouse_connect.get_client(
            host=host,
            port=port,
            username=user,
            password=password,
            database=database,
            secure=secure,
            compress=True,
        )
        log.info("clickhouse_connected", host=host, port=port, database=database)
        return cls(client, retry_delays=retry_delays, sleep_fn=sleep_fn)

    def insert_events(self, events: list[dict]) -> None:  # type: ignore[type-arg]
        """Insert *events* into the `events` table. Retries on failure."""
        if not events:
            return

        rows = [_event_to_row(e) for e in events]
        last_exc: Exception | None = None

        for attempt, delay in enumerate((*self._retry_delays, None), start=1):
            try:
                self._client.insert("events", rows, column_names=_COLUMNS)
                log.info("clickhouse_insert_ok", count=len(rows), attempt=attempt)
                return
            except Exception as exc:
                last_exc = exc
                log.warning(
                    "clickhouse_insert_failed",
                    attempt=attempt,
                    max_attempts=len(self._retry_delays) + 1,
                    error=str(exc),
                )
                if delay is not None:
                    self._sleep_fn(float(delay))

        raise RuntimeError(
            f"ClickHouse insert failed after {len(self._retry_delays) + 1} attempts"
        ) from last_exc
