"""
Estalara stream-consumer — Modal app entry point.

Deploys a long-running Modal function that subscribes to the Redpanda `events`
topic and inserts validated events into ClickHouse Cloud.

Deploy:
    modal deploy apps/stream-consumer/src/main.py

Run locally (no Modal infra, reads env from shell):
    modal run apps/stream-consumer/src/main.py::consume_events

Required Modal secrets (create with `modal secret create`):
    redpanda-creds   — REDPANDA_BROKERS, REDPANDA_SASL_USERNAME, REDPANDA_SASL_PASSWORD,
                       REDPANDA_SASL_MECHANISM, REDPANDA_TLS
    clickhouse-creds — CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER,
                       CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE
"""

import modal

SERVICE_NAME = "estalara-stream-consumer"
SERVICE_VERSION = "0.1.0"

app = modal.App("estalara-stream-consumer-events")

_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "confluent-kafka>=2.5",
        "clickhouse-connect>=0.8",
        "pydantic>=2.0",
        "structlog>=24.0",
        "opentelemetry-api>=1.20",
        "opentelemetry-sdk>=1.20",
    )
    .add_local_python_source("src")
)


@app.function(
    image=_image,
    secrets=[
        modal.Secret.from_name("redpanda-creds"),
        modal.Secret.from_name("clickhouse-creds"),
    ],
    cpu=1,
    memory=512,
    timeout=86400,  # 24 h; Modal restarts on timeout so the loop runs continuously
    min_containers=1,
)
def consume_events() -> None:
    """Entry point: runs the Redpanda → ClickHouse consumer loop."""
    from src.consumers.events import run_consumer

    run_consumer()


def get_service_info() -> dict[str, str]:
    """Return service metadata for health checks."""
    return {"service": SERVICE_NAME, "version": SERVICE_VERSION, "status": "active"}
