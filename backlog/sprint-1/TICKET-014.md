---
id: TICKET-014
title: ClickHouse table DDL + first migration (events table partitioned)
sprint: 1
priority: P0
agent: data-engineer
status: BLOCKED
estimated_hours: 4
depends_on: [TICKET-009, TICKET-011]
produces: [TICKET-015, TICKET-016]
affects_files:
  - 'infra/clickhouse/migrations/0001_create_events.sql'
  - 'infra/clickhouse/migrations/0002_create_session_summary_mv.sql'
  - 'infra/clickhouse/dbt_project.yml'
  - 'infra/clickhouse/profiles.yml.example'
  - 'infra/clickhouse/scripts/migrate.sh'
  - 'infra/clickhouse/README.md'
context_files:
  - docs/MASTER_DESIGN.md (sections C.1, K.1 — data architecture)
  - packages/shared/src/schemas/event.ts (TICKET-011)
  - .claude/agents/data-engineer.md
labels: [sprint-1, p0, data, clickhouse]
---

# TICKET-014: ClickHouse table DDL + first migration

## Summary

Create the canonical `events` table in ClickHouse with proper partitioning, ordering, compression,
and TTL. Plus the first materialized view (`session_summary`) for fast session-level dashboard
queries. This is the first real ClickHouse work — schema must match the Zod schemas from TICKET-011
exactly. Use dbt-clickhouse for migration management going forward.

## Context

Master Design event store layout:

- Partition by `(tenant_id, toYYYYMMDD(ts))` for fast tenant-scoped queries + automatic dropping of
  old partitions
- Order by `(tenant_id, type, session_id, ts)` for efficient queries (tenant + type are common
  filters)
- ZSTD codec on String columns (mandatory cost optimization)
- TTL 13 months default (compliance retention; tenants on `audit_retention_days: 'compliance'` get
  longer per-region rules)

Materialized view pattern: `events` is the polymorphic source of truth (payload as JSON String). MVs
project specific event types into typed columns for fast queries.

## Scope

### In scope

- `infra/clickhouse/migrations/0001_create_events.sql` — events table DDL per Master Design
- `infra/clickhouse/migrations/0002_create_session_summary_mv.sql` — session_summary materialized
  view (one row per session with derived features: tenant, region, started_at, ended_at, page_count,
  listing_ids_seen, last_event_type, has_chat, has_inquiry)
- `infra/clickhouse/dbt_project.yml` — dbt project config pointing to ClickHouse
- `infra/clickhouse/profiles.yml.example` — example profiles file (real one in Doppler)
- `infra/clickhouse/scripts/migrate.sh` — wrapper script that applies migrations in order against
  `CLICKHOUSE_URL`
- README documenting: migration process, naming convention, backwards-compat rules
- A second migration that's a smoke test: insert 5 sample events, query them back via the MV, drop
  them

### Out of scope

- Schema-drift events table (Sprint 9 / 2.5)
- Other materialized views (rollup tables, intent signal stream) — Sprint 4-6 as needed
- Schema-per-tenant partitioning for top enterprise — Sprint 7
- ClickHouse production connection / actual deployment — depends on TICKET-009 vendor accounts

## Acceptance criteria

- [ ] AC1: `0001_create_events.sql` creates `events` table with all columns from Master Design
      (event_id UUID, tenant_id String CODEC(ZSTD(3)), session_id, ts DateTime64(3 'UTC'), region
      LowCardinality, type LowCardinality, schema_version UInt16, consent_state LowCardinality,
      listing_id String CODEC(ZSTD(3)), archetype_hint LowCardinality, payload String
      CODEC(ZSTD(3)), ingest_received_at DateTime64(3 'UTC'))
- [ ] AC2: Table uses `ReplicatedMergeTree`, partition by `(tenant_id, toYYYYMMDD(ts))`, order by
      `(tenant_id, type, session_id, ts)`, TTL `ts + INTERVAL 13 MONTH`, `index_granularity = 8192`
- [ ] AC3: `0002_create_session_summary_mv.sql` creates `session_summary_mv` materialized view +
      target table `session_summary` aggregating one row per (tenant_id, session_id) with at least 8
      derived columns
- [ ] AC4: `migrate.sh` reads `CLICKHOUSE_URL` from env, applies migrations in order, idempotent
      (re-run is no-op)
- [ ] AC5: dbt project config compiles (`dbt compile`) against a local ClickHouse via Docker
- [ ] AC6: Smoke test: spin up ClickHouse locally via docker-compose, run migrations, INSERT 5
      sample events, SELECT from `events` (returns 5 rows), SELECT from `session_summary` (correctly
      aggregated)
- [ ] AC7: README covers migration process, columns explanation, retention/TTL behavior, example
      queries; minimum 300 words
- [ ] AC8: All existing CI checks pass; new CI job runs ClickHouse smoke via docker-compose
- [ ] AC9: PR title `feat(data): clickhouse events table + session summary mv [TICKET-014]`

## Implementation guidance

For SQL:

```sql
-- infra/clickhouse/migrations/0001_create_events.sql
CREATE TABLE IF NOT EXISTS events (
  event_id UUID,
  tenant_id String CODEC(ZSTD(3)),
  session_id String CODEC(ZSTD(3)),
  ts DateTime64(3, 'UTC'),
  region LowCardinality(String),
  type LowCardinality(String),
  schema_version UInt16,
  consent_state LowCardinality(String),
  listing_id String CODEC(ZSTD(3)),
  archetype_hint LowCardinality(String),
  payload String CODEC(ZSTD(3)),
  ingest_received_at DateTime64(3, 'UTC')
)
ENGINE = ReplicatedMergeTree
PARTITION BY (tenant_id, toYYYYMMDD(ts))
ORDER BY (tenant_id, type, session_id, ts)
TTL toDateTime(ts) + INTERVAL 13 MONTH
SETTINGS index_granularity = 8192;
```

```sql
-- infra/clickhouse/migrations/0002_create_session_summary_mv.sql
CREATE TABLE IF NOT EXISTS session_summary (
  tenant_id String,
  session_id String,
  region LowCardinality(String),
  started_at DateTime64(3, 'UTC'),
  ended_at SimpleAggregateFunction(max, DateTime64(3, 'UTC')),
  page_count SimpleAggregateFunction(sum, UInt32),
  listing_ids_seen AggregateFunction(uniq, String),
  has_chat SimpleAggregateFunction(max, UInt8),
  has_inquiry SimpleAggregateFunction(max, UInt8),
  last_event_type SimpleAggregateFunction(anyLast, LowCardinality(String))
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMMDD(started_at)
ORDER BY (tenant_id, session_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS session_summary_mv TO session_summary AS
SELECT
  tenant_id,
  session_id,
  any(region) AS region,
  min(ts) AS started_at,
  max(ts) AS ended_at,
  countIf(type = 'page.view') AS page_count,
  uniqState(listing_id) AS listing_ids_seen,
  maxIf(1, type IN ('chat.opened', 'chat.message.sent')) AS has_chat,
  maxIf(1, type IN ('inquiry.started', 'inquiry.completed')) AS has_inquiry,
  argMax(type, ts) AS last_event_type
FROM events
GROUP BY tenant_id, session_id;
```

`migrate.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${CLICKHOUSE_URL:?CLICKHOUSE_URL must be set}"
for f in $(ls -1 infra/clickhouse/migrations/*.sql | sort); do
  echo "Applying: $f"
  curl -sSf "$CLICKHOUSE_URL" --data-binary @"$f"
done
echo "Migrations done."
```

## Test plan

- Local: `docker-compose up clickhouse` (use clickhouse-server image), run migrate.sh, verify tables
  exist (`SHOW TABLES`)
- Local: insert 5 sample events via curl, verify `events` rows count = 5, `session_summary` reflects
  aggregations
- CI: docker-compose smoke job in CI runs migrations + sample insert + assert query (SELECT
  count(\*) FROM events == 5)

## Definition of Done

- [ ] Branch `data-engineer/TICKET-014-clickhouse-events-table`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean (yes, also format SQL via dbt or manual)
- [ ] HANDOFF: TICKET-014 → TICKET-015 (consumer can write to events), TICKET-016 (smoke test)

## Notes

- TTL is set to 13 months by default. Compliance retention overrides will be applied per-tenant in
  Sprint 9 via partition-level TTL, NOT row-level.
- The MV uses `AggregatingMergeTree` so it auto-merges. Don't index `last_event_type` separately —
  `argMax` covers it.
