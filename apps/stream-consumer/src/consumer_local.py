#!/usr/bin/env python3
"""
Local Redpanda → ClickHouse consumer for E2E smoke tests.

NOT for production. Production uses Modal (TICKET-015).
Reads JSON event records from a Redpanda topic and batch-inserts them into ClickHouse.
"""

import json
import logging
import os
import sys
from datetime import UTC, datetime

import clickhouse_connect
from kafka import KafkaConsumer
from kafka.errors import NoBrokersAvailable

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

REDPANDA_BROKERS = os.environ.get("REDPANDA_BROKERS", "localhost:9092")
CLICKHOUSE_URL = os.environ.get("CLICKHOUSE_URL", "http://localhost:8123")
TOPIC = os.environ.get("REDPANDA_TOPIC", "events")
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "100"))

COLUMNS = [
    "event_id",
    "tenant_id",
    "session_id",
    "ts",
    "region",
    "type",
    "schema_version",
    "consent_state",
    "listing_id",
    "archetype_hint",
    "payload",
    "ingest_received_at",
]


def _parse_ch_url(url: str) -> tuple[str, int]:
    url = url.removeprefix("https://").removeprefix("http://")
    host, _, port_str = url.partition(":")
    return host, int(port_str) if port_str else 8123


def _ms_to_dt(ms: object) -> datetime:
    ts = int(ms) if ms else 0
    return datetime.fromtimestamp(ts / 1000.0, tz=UTC)


def _event_to_row(event: dict) -> list:
    return [
        str(event.get("event_id", "")),
        str(event.get("tenant_id", "")),
        str(event.get("session_id", "")),
        _ms_to_dt(event.get("ts")),
        str(event.get("region", "")),
        str(event.get("type", "")),
        int(event.get("schema_version", 1)),
        str(event.get("consent_state", "none")),
        str(event.get("listing_id") or ""),
        str(event.get("archetype_hint") or ""),
        json.dumps(event.get("payload", {})),
        _ms_to_dt(event.get("ingest_received_at") or event.get("ts")),
    ]


def main() -> None:
    log.info("consumer_local: brokers=%s topic=%s", REDPANDA_BROKERS, TOPIC)

    ch_host, ch_port = _parse_ch_url(CLICKHOUSE_URL)
    client = clickhouse_connect.get_client(host=ch_host, port=ch_port)
    log.info("ClickHouse connected: %s:%d", ch_host, ch_port)

    brokers = [b.strip() for b in REDPANDA_BROKERS.split(",")]
    try:
        consumer = KafkaConsumer(
            TOPIC,
            bootstrap_servers=brokers,
            group_id="e2e-consumer",
            auto_offset_reset="earliest",
            enable_auto_commit=True,
            value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        )
    except NoBrokersAvailable as exc:
        log.error("Cannot connect to Redpanda: %s", exc)
        sys.exit(1)

    log.info("Kafka consumer ready, polling %s", TOPIC)

    batch: list[list] = []
    for msg in consumer:
        event: dict = msg.value
        try:
            batch.append(_event_to_row(event))
        except Exception as exc:  # noqa: BLE001
            log.error("Skipping malformed event %s: %s", event.get("event_id"), exc)
            continue

        if len(batch) >= BATCH_SIZE:
            _flush(client, batch)
            batch = []

    if batch:
        _flush(client, batch)


def _flush(client: clickhouse_connect.driver.Client, batch: list[list]) -> None:
    try:
        client.insert("events", batch, column_names=COLUMNS)
        log.info("Inserted %d events", len(batch))
    except Exception as exc:  # noqa: BLE001
        log.error("ClickHouse insert failed: %s", exc)


if __name__ == "__main__":
    main()
