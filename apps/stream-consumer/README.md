# estalara-stream-consumer

Estalara stream consumer — Modal service consuming Redpanda events into ClickHouse.

## Status

Placeholder — full implementation in TICKET-012.

## Development

```bash
cd apps/stream-consumer
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest src/
```
