# ClickHouse Data Layer

Event store and analytics tables for Estalara Adaptive Listings. This directory manages the
ClickHouse schema migrations (raw SQL), dbt project config, and helper scripts.

## Schema overview

### `events` table (migration 0001)

The canonical ingest store. Every event emitted by the SDK and validated by the ingest Worker lands
here via the stream consumer (TICKET-015). Partitioned and ordered for efficient tenant-scoped
analytical queries.

| Column               | Type                   | Notes                                                                   |
| -------------------- | ---------------------- | ----------------------------------------------------------------------- |
| `event_id`           | UUID                   | Client-generated UUIDv7; deduplicated at the ingest layer               |
| `tenant_id`          | String CODEC(ZSTD(3))  | Partition key; ZSTD 3 for 5–10× compression on high-cardinality strings |
| `session_id`         | String CODEC(ZSTD(3))  | SHA-256 hex fingerprint (32–64 chars)                                   |
| `ts`                 | DateTime64(3, 'UTC')   | Client-side timestamp in ms; used for TTL and ORDER BY                  |
| `ingest_received_at` | DateTime64(3, 'UTC')   | Server clock; used for latency monitoring                               |
| `region`             | LowCardinality(String) | eu / us / uk / uae — dictionary-encoded                                 |
| `type`               | LowCardinality(String) | e.g. `page.view`, `chat.message.sent` — 33 types currently              |
| `schema_version`     | UInt16                 | Bumped only on breaking changes (ADR-0003)                              |
| `consent_state`      | LowCardinality(String) | GDPR signal: none / legitimate-interest / consented                     |
| `listing_id`         | String CODEC(ZSTD(3))  | Empty string when not listing-scoped                                    |
| `archetype_hint`     | LowCardinality(String) | Server annotation from intent engine; empty on ingest                   |
| `payload`            | String CODEC(ZSTD(3))  | JSON string; per-type shape validated in `@estalara/shared`             |

**Engine:** `ReplicatedMergeTree` on ClickHouse Cloud (paths auto-assigned). `MergeTree` for
local/CI (substituted by `migrate.sh LOCAL=1`).

**Partition:** `(tenant_id, toYYYYMMDD(ts))` — enables fast tenant-scoped scans and automatic
partition pruning when filtering on tenant + date range.

**Order key:** `(tenant_id, type, session_id, ts)` — optimises the most common query patterns:
tenant-wide event counts, per-type funnels, and per-session timelines.

**TTL:** `ts + INTERVAL 13 MONTH` — default compliance retention. Per-tenant overrides via
partition-level TTL will be added in Sprint 9; do not change this without compliance sign-off.

**index_granularity:** 8192 (ClickHouse default). Suitable for our write pattern of 100M+
events/day.

### `session_summary` table + `session_summary_mv` view (migration 0002)

Pre-aggregated session features for fast dashboard queries. The materialized view fires on every
INSERT into `events` and emits one aggregate row per `(tenant_id, session_id)` per batch.

Uses `AggregatingMergeTree` with `SimpleAggregateFunction` (no serialization overhead) and one full
`AggregateFunction(uniq)` for the HyperLogLog listing count.

**Reading the table correctly** — always use one of:

```sql
-- Option A: FINAL keyword (forces instant merge; slow on large tables)
SELECT tenant_id, session_id,
       maxSimpleState(ended_at)            AS ended_at,
       sumSimpleState(page_count)          AS page_count,
       uniqMerge(listing_ids_seen)         AS unique_listings,
       maxSimpleState(has_chat)            AS has_chat,
       maxSimpleState(has_inquiry)         AS has_inquiry,
       anyLastSimpleState(last_event_type) AS last_event_type
FROM session_summary FINAL
WHERE tenant_id = 'your-tenant'
GROUP BY tenant_id, session_id;

-- Option B: explicit merge in GROUP BY (efficient on large tables)
SELECT tenant_id, session_id,
       max(ended_at)             AS ended_at,
       sum(page_count)           AS page_count,
       uniqMerge(listing_ids_seen) AS unique_listings
FROM session_summary
WHERE tenant_id = 'your-tenant'
GROUP BY tenant_id, session_id;
```

## Running migrations

### Prerequisites

- `curl` (ships with every CI/dev environment)
- ClickHouse reachable at `CLICKHOUSE_URL`

### Local (Docker)

```bash
# Start ClickHouse
docker run -d --name ch-local -p 8123:8123 clickhouse/clickhouse-server:latest

# Apply migrations (LOCAL=1 replaces ReplicatedMergeTree with MergeTree)
LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 ./infra/clickhouse/scripts/migrate.sh

# Run smoke test to verify
LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 ./infra/clickhouse/scripts/smoke-test.sh
```

### Via Doppler (production / staging)

```bash
doppler run -- ./infra/clickhouse/scripts/migrate.sh
```

Doppler must have `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` configured. See
`.env.example` for the full list of required variables.

## Migration naming convention

Files in `migrations/` are applied in lexicographic order:

```
0001_create_events.sql
0002_create_session_summary_mv.sql
0003_next_migration.sql   ← next ticket adds here
```

Rules (ADR-0003):

- **Additive only within schema_version 1**: add columns, add tables, add MVs — never `DROP COLUMN`,
  `RENAME COLUMN`, or change a column's type.
- **Always idempotent**: use `CREATE TABLE IF NOT EXISTS`, `CREATE VIEW IF NOT EXISTS`.
- **Never mutate data** in a schema migration. Backfills are separate one-off scripts.
- **4-digit prefix** with leading zeros: `0042_...` not `42_...`.
- **Descriptive name**: `0003_add_listing_features_mv.sql` not `0003_new_stuff.sql`.

## dbt (Sprint 4+)

The `dbt_project.yml` and `profiles.yml.example` are scaffolded for dbt-clickhouse. dbt models will
supplement the raw SQL migrations for rollup tables and feature engineering once the intent pipeline
ships. For now, run raw SQL migrations only.

To use dbt locally:

```bash
pip install dbt-clickhouse
cp infra/clickhouse/profiles.yml.example ~/.dbt/profiles.yml
# fill in credentials
cd infra/clickhouse
dbt compile   # validate models compile against ClickHouse
dbt run       # apply models
```

## Retention and compliance

Default TTL is **13 months** from the event timestamp (`ts`). This covers GDPR Art. 5(1)(e) storage
limitation while retaining enough history for annual trend analysis. Audit-retention tenants (legal
hold) will receive extended TTLs applied at the partition level in Sprint 9. Never extend the
default TTL without written compliance approval.
