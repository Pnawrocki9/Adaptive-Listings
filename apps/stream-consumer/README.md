# estalara-stream-consumer

Modal Python service that subscribes to the Redpanda `events` topic and batch-inserts validated
events into ClickHouse Cloud. Part of the Sprint 1 ingest pipeline.

## Architecture

```
Redpanda Cloud (events topic)
    ↓  confluent-kafka Consumer
src/consumers/events.py  — batch (5000 msgs or 5s) → validate → insert
    ↓  clickhouse-connect
ClickHouse Cloud (events table)
    ↓  materialized view fires automatically
ClickHouse Cloud (session_summary)
```

On ClickHouse failure: 3 retries (1 s, 5 s, 30 s) then DLQ (`events.dlq` topic). Offsets are
committed only after a successful insert (at-least-once delivery).

## Development setup

```bash
cd apps/stream-consumer
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest src/ -v          # unit tests (no external services needed)
```

## Running via Modal

### 1. Create Modal secrets

```bash
modal secret create redpanda-creds \
  REDPANDA_BROKERS=... \
  REDPANDA_SASL_USERNAME=... \
  REDPANDA_SASL_PASSWORD=... \
  REDPANDA_SASL_MECHANISM=SCRAM-SHA-256 \
  REDPANDA_TLS=true

modal secret create clickhouse-creds \
  CLICKHOUSE_HOST=... \
  CLICKHOUSE_PORT=8443 \
  CLICKHOUSE_USER=default \
  CLICKHOUSE_PASSWORD=... \
  CLICKHOUSE_DATABASE=default
```

Use `doppler run` to get the values from Doppler.

### 2. Deploy

```bash
modal deploy apps/stream-consumer/src/main.py
```

### 3. Run locally (no Modal infra, reads env from shell)

```bash
doppler run -- modal run apps/stream-consumer/src/main.py::consume_events
```

## Integration tests

Integration tests require local Docker services:

```bash
# Start services
docker compose -f tests/integration/docker-compose.yml up -d

# Apply ClickHouse migrations (LOCAL=1 uses MergeTree)
LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 \
  ./infra/clickhouse/scripts/migrate.sh

# Run integration tests
pytest tests/integration/ -v -m integration
```

## Environment variables

| Variable                  | Default                  | Description                                 |
| ------------------------- | ------------------------ | ------------------------------------------- |
| `REDPANDA_BROKERS`        | `localhost:9092`         | Comma-separated broker list                 |
| `REDPANDA_SASL_USERNAME`  | _(empty)_                | SASL username; omit for unauthenticated     |
| `REDPANDA_SASL_PASSWORD`  | _(empty)_                | SASL password                               |
| `REDPANDA_SASL_MECHANISM` | `SCRAM-SHA-256`          | SASL mechanism                              |
| `REDPANDA_TLS`            | `false`                  | Set `true` for TLS (Redpanda Cloud)         |
| `REDPANDA_TOPIC`          | `events`                 | Source topic                                |
| `REDPANDA_DLQ_TOPIC`      | `events.dlq`             | Dead-letter topic                           |
| `CONSUMER_GROUP_ID`       | `stream-consumer-events` | Kafka consumer group                        |
| `CLICKHOUSE_HOST`         | `localhost`              | ClickHouse hostname                         |
| `CLICKHOUSE_PORT`         | `8443`                   | ClickHouse port (8123 = HTTP, 8443 = HTTPS) |
| `CLICKHOUSE_USER`         | `default`                | ClickHouse user                             |
| `CLICKHOUSE_PASSWORD`     | _(empty)_                | ClickHouse password                         |
| `CLICKHOUSE_DATABASE`     | `default`                | ClickHouse database                         |
