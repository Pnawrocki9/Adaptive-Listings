# E2E Smoke Tests

End-to-end test validating the full Sprint 1 ingest pipeline: **wrangler dev → Redpanda →
stream-consumer → ClickHouse**

## Prerequisites

| Tool                    | Version | Install                                   |
| ----------------------- | ------- | ----------------------------------------- |
| Docker & Docker Compose | v2+     | <https://docs.docker.com/get-docker/>     |
| pnpm                    | 9.15.4  | `npm i -g pnpm`                           |
| wrangler                | 3.x     | included in `apps/ingest` devDependencies |
| Node.js                 | ≥22     | <https://nodejs.org/>                     |

Run `pnpm install` from the repo root before anything else.

## Running locally

Open **three** terminals:

**Terminal 1 — Docker services:**

```bash
cd tests/e2e
docker compose up --build
```

Wait until you see ClickHouse `db_loaded` and Redpanda `Started Redpanda!`.

**Terminal 2 — Wrangler dev (ingest Worker):**

First, seed the smoke-test API key into the local KV store (one-time):

```bash
cd apps/ingest
pnpm exec wrangler kv key put \
  --local \
  --namespace-id=PLACEHOLDER_KV_API_KEYS_PREVIEW_ID \
  "api_key:pk_test_smoke" \
  '{"tenant_id":"a0000000-0000-0000-0000-000000000001","scopes":["write:events"]}'
```

Then start the Worker:

```bash
cd apps/ingest
REDPANDA_REST_URL=http://localhost:18082 pnpm exec wrangler dev --port 8787
```

Wait for `Ready on http://localhost:8787`.

**Terminal 3 — Run the smoke test:**

```bash
pnpm e2e:smoke
```

Expected output: one passing test completing in under 60s.

## What the test does

1. POSTs `tests/e2e/fixtures/sample-events.json` (50 events) to `POST /v1/events` with API key
   `pk_test_smoke`
2. Asserts HTTP 200 with `accepted: 50`
3. Polls `SELECT count(*) FROM events WHERE event_id IN (...)` every 500ms for up to 10s
4. Asserts all 50 rows appear in ClickHouse
5. Asserts `session_summary` has rows for each of the 2 test sessions

## Fixtures

`fixtures/sample-events.json` — 50 valid events across 2 sessions and 6 types:

| Type                | Count | Sessions |
| ------------------- | ----- | -------- |
| `page.view`         | 10    | both     |
| `photo.opened`      | 10    | both     |
| `scroll.depth`      | 10    | both     |
| `chat.message.sent` | 10    | both     |
| `inquiry.started`   | 5     | both     |
| `page.exit`         | 5     | both     |

All events use:

- Tenant: `a0000000-0000-0000-0000-000000000001`
- Session A: `aaaa000000000000000000000000000000000000000000000000000000000001`
- Session B: `bbbb000000000000000000000000000000000000000000000000000000000001`

`fixtures/clickhouse-init.sql` — local ClickHouse DDL (MergeTree, no replication). Mounted via
`docker-entrypoint-initdb.d`. The production schema (ReplicatedMergeTree) lives in
`infra/clickhouse/migrations/` (TICKET-014).

### Updating fixtures

To add events or change the schema:

1. Edit `fixtures/sample-events.json` — keep count at 50 and update the assertion in the test
2. Validate with
   `node -e "const e = require('./fixtures/sample-events.json'); console.log(e.length)"`
3. If changing ClickHouse columns, update `fixtures/clickhouse-init.sql` and
   `apps/stream-consumer/src/consumer_local.py`

## Troubleshooting

**Redpanda not ready (`rpk cluster info` fails)**

Wait longer or check `docker compose logs redpanda`. Redpanda takes 10–20s to start on cold boot.

**ClickHouse migration not applied**

```bash
docker compose down -v   # remove volumes to force re-init
docker compose up --build
```

**`api_key:pk_test_smoke` not found (401 from ingest)**

Re-run the `wrangler kv key put` command from Terminal 2. The local KV store is in
`apps/ingest/.wrangler/state/v3/kv/`. If wrangler dev was started before seeding, restart it.

**ClickHouse count stuck at 0 (consumer not running)**

```bash
docker compose logs stream-consumer
```

Common causes: Redpanda topic not yet created (wait longer), or ClickHouse not ready when consumer
started (docker compose will restart it — wait for the retry).

**`wrangler dev` fails with auth error**

Set `CLOUDFLARE_ACCOUNT_ID` in your shell or `.env.local`. wrangler dev runs fully locally but may
try to verify the account ID on startup.

## CI

The workflow `.github/workflows/e2e-smoke.yml` runs:

- Nightly at **03:00 UTC**
- On demand via **workflow_dispatch** (Actions tab → "E2E Smoke Test" → "Run workflow")

Failures send a Slack notification if `SLACK_E2E_WEBHOOK_URL` is configured as a GitHub secret.
