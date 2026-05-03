"""
Integration tests: Redpanda → consumer → ClickHouse.

Requires docker-compose services (see docker-compose.yml in this directory).

Run:
    docker compose -f tests/integration/docker-compose.yml up -d
    # Apply ClickHouse migrations with LOCAL=1
    LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 ./infra/clickhouse/scripts/migrate.sh
    pytest tests/integration/ -v -m integration
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Generator

import pytest

REDPANDA_BROKERS = os.environ.get("REDPANDA_BROKERS", "localhost:19092")
CLICKHOUSE_URL = os.environ.get("CLICKHOUSE_URL", "http://localhost:8123")
TOPIC = os.environ.get("REDPANDA_TOPIC", "events")


def _docker_services_available() -> bool:
    """Check if local docker services are reachable."""
    import socket

    try:
        s = socket.create_connection(("localhost", 8123), timeout=2)
        s.close()
        return True
    except OSError:
        return False


pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def ch_client():  # type: ignore[return]
    """clickhouse-connect client pointed at local test ClickHouse."""
    pytest.importorskip("clickhouse_connect")
    import clickhouse_connect

    client = clickhouse_connect.get_client(host="localhost", port=8123)
    yield client


@pytest.fixture(scope="module")
def kafka_producer():  # type: ignore[return]
    """confluent-kafka Producer pointed at local Redpanda."""
    pytest.importorskip("confluent_kafka")
    from confluent_kafka import Producer

    prod = Producer({"bootstrap.servers": REDPANDA_BROKERS})
    yield prod
    prod.flush(timeout=10)


def _make_event(event_id: str, session_id: str, ts_offset: int = 0) -> bytes:
    return json.dumps(
        {
            "event_id": event_id,
            "tenant_id": "integration-test-tenant-001",
            "session_id": session_id,
            "ts": 1_746_259_200_000 + ts_offset,
            "region": "eu",
            "consent_state": "consented",
            "schema_version": 1,
            "type": "page.view",
            "payload": {"url": "https://example.com/test"},
            "ingest_received_at": 1_746_259_200_000 + ts_offset,
        }
    ).encode()


@pytest.mark.skipif(not _docker_services_available(), reason="docker services not running")
def test_produce_consume_100_events_appear_in_clickhouse(
    ch_client, kafka_producer  # type: ignore[no-untyped-def]
) -> None:
    """
    Produce 100 events to Redpanda, run consumer for a bounded time,
    assert all 100 events appear in ClickHouse `events` table.
    """
    from src.clickhouse_client import ClickHouseClient
    from src.consumers.events import run_consumer
    from src.redpanda_client import build_consumer

    session_id = "b" * 32 + "inttest0000000000000000000000001"
    event_ids = [f"b{i:07d}-0000-0000-0000-000000000001" for i in range(100)]

    # Produce 100 events
    for i, eid in enumerate(event_ids):
        kafka_producer.produce(TOPIC, value=_make_event(eid, session_id, ts_offset=i * 1000))
    kafka_producer.flush(timeout=15)

    # Set up consumer and CH client pointed at local services
    os.environ["REDPANDA_BROKERS"] = REDPANDA_BROKERS
    os.environ["REDPANDA_TLS"] = "false"
    os.environ["CLICKHOUSE_HOST"] = "localhost"
    os.environ["CLICKHOUSE_PORT"] = "8123"
    os.environ["CLICKHOUSE_USER"] = "default"
    os.environ["CLICKHOUSE_PASSWORD"] = ""
    os.environ["CLICKHOUSE_DATABASE"] = "default"
    os.environ["CLICKHOUSE_SECURE"] = "false"
    os.environ["CONSUMER_GROUP_ID"] = "integration-test-group"

    kafka_consumer = build_consumer("integration-test-group", [TOPIC])
    ch = ClickHouseClient.from_env()

    # Run consumer in a thread for up to 20 seconds
    def _run() -> None:
        run_consumer(
            consumer=kafka_consumer,
            ch_client=ch,
            _max_polls=300,  # 300 * 1s polls = up to 300s max; exits earlier when empty
        )

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    t.join(timeout=30)

    # Assert all 100 events are in ClickHouse
    ids_csv = ", ".join(f"'{eid}'" for eid in event_ids)
    result = ch_client.query(
        f"SELECT count() FROM events WHERE event_id IN ({ids_csv}) FORMAT TSV"
    )
    count = int(result.result_rows[0][0])
    assert count == 100, f"Expected 100 rows, got {count}"

    # Assert session_summary has at least one row for the test session
    ss_result = ch_client.query(
        f"SELECT count() FROM session_summary FINAL WHERE session_id = '{session_id}' FORMAT TSV"
    )
    ss_count = int(ss_result.result_rows[0][0])
    assert ss_count >= 1, "session_summary should have at least one row for the test session"
