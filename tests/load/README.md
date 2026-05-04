# Ingest Load Tests

k6 load test scripts for the Estalara ingest endpoint (`POST /v1/events`). These scripts prove (or
disprove) that the Cloudflare Worker can sustain 10,000 req/s at p95 < 50ms — the target from Master
Design C.2.

## Prerequisites

Install [k6](https://k6.io/docs/get-started/installation/):

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Windows (Chocolatey)
choco install k6
```

## Environment Variables

| Variable          | Default                 | Description                                        |
| ----------------- | ----------------------- | -------------------------------------------------- |
| `INGEST_URL`      | `http://localhost:8787` | Base URL for the ingest Worker                     |
| `K6_TEST_API_KEY` | `pk_test_load`          | API key pre-provisioned in the target environment  |
| `K6_TENANT_ID`    | `01928f00-7000-...`     | Tenant UUID associated with the test API key above |

## Running Locally

Before running locally, start the ingest Worker with Wrangler:

```bash
# In apps/ingest/
pnpm exec wrangler dev --local
```

Run the baseline script (single VU smoke test to verify payloads):

```bash
INGEST_URL=http://localhost:8787 \
K6_TEST_API_KEY=pk_test_load \
k6 run --vus 1 --iterations 10 tests/load/k6-ingest-baseline.js
```

Run the full baseline at reduced scale (useful for CI smoke on a developer machine):

```bash
INGEST_URL=http://localhost:8787 \
K6_TEST_API_KEY=pk_test_load \
k6 run tests/load/k6-ingest-baseline.js
```

**Note on local throughput:** 10,000 req/s from a single machine against a local Wrangler dev server
is not achievable — `wrangler dev` is single-threaded and is not representative of production
Cloudflare Workers performance. Local runs are useful only for verifying that payloads pass Zod
validation and the API key flow works. For meaningful latency/throughput measurements, always run
against staging.

## Running Against Staging

Staging pre-requisites:

1. A test tenant exists in staging Supabase with UUID `K6_TENANT_ID`.
2. A test API key `K6_TEST_API_KEY` is provisioned for that tenant in the KV namespace.
3. Doppler (or your secrets manager) has populated `INGEST_URL` for the staging deploy.

```bash
# Baseline — steady-state 10k req/s (7 minutes total)
INGEST_URL=https://ingest.staging.estalara.com \
K6_TEST_API_KEY=<from Doppler> \
K6_TENANT_ID=<staging tenant UUID> \
k6 run \
  --out json=baseline-results.json \
  tests/load/k6-ingest-baseline.js

# Stress — ramp to 50k req/s (8 minutes total). Coordinate with devops-engineer first.
INGEST_URL=https://ingest.staging.estalara.com \
K6_TEST_API_KEY=<from Doppler> \
K6_TENANT_ID=<staging tenant UUID> \
k6 run \
  --out json=stress-results.json \
  tests/load/k6-ingest-stress.js
```

The `--out json=...` flag writes a line-delimited JSON stream. Pipe it to the k6 summary tool or
import into Grafana k6 Cloud for visualisation.

## Triggering via GitHub Actions

The `load-test.yml` workflow is **workflow_dispatch only** — it does not run on push or pull
request. Trigger it from the GitHub UI or CLI:

```bash
# Baseline against staging
gh workflow run load-test.yml \
  -f scenario=baseline \
  -f target=staging

# Stress against staging
gh workflow run load-test.yml \
  -f scenario=stress \
  -f target=staging
```

Results are uploaded as workflow artifacts (`k6-results-<scenario>-<run-id>`). Download them after
the run completes:

```bash
gh run download <run-id>
```

## Interpreting Results

k6 prints a summary table at the end of each run. Key metrics to check:

### Baseline pass criteria

| Metric                    | Target         | Fail condition        |
| ------------------------- | -------------- | --------------------- |
| `http_req_duration p(95)` | < 50 ms        | ≥ 50 ms               |
| `http_req_duration p(99)` | < 200 ms       | ≥ 200 ms              |
| `http_req_failed rate`    | < 0.1% (0.001) | ≥ 0.1%                |
| `http_reqs rate`          | ≥ 9,500 req/s  | Executor didn't reach |

If `http_req_failed` is elevated, check the `estalara_rate_limited` and `estalara_redpanda_errors`
custom counters to identify whether errors are rate-limiter saturation (429) or Redpanda
backpressure (503). Authentication errors (401) indicate a misconfigured API key.

### Stress test analysis

The stress script does not enforce strict pass/fail (it is designed to break things). Analyze the
JSON output file to find:

1. **Degradation onset**: the `http_reqs` rate at which `http_req_duration p(95)` first exceeded 50
   ms. This is the effective throughput ceiling for this deployment.
2. **Error onset**: the rate at which `http_req_failed rate` first exceeded 0.1%. Compare against
   the degradation onset — if errors appear before latency degrades, the rate-limiter (Cloudflare
   DO) is the bottleneck. If latency degrades first, the Worker or Redpanda producer is the
   bottleneck.
3. **Recovery**: after the ramp-down, does latency return to baseline? If not, there may be a memory
   leak or Durable Object lock contention.

## Baseline Expectations

The following numbers represent first-run staging results (to be populated after AC8 — first manual
trigger). Until the first run, these are design targets derived from Master Design C.2:

| Metric                    | Design Target | First Run (TBD) |
| ------------------------- | ------------- | --------------- |
| `http_req_duration p(50)` | < 10 ms       | —               |
| `http_req_duration p(95)` | < 50 ms       | —               |
| `http_req_duration p(99)` | < 200 ms      | —               |
| `http_req_failed rate`    | < 0.001       | —               |
| Peak sustained req/s      | ≥ 9,500       | —               |

Update this table after each staging run to track regressions over time.

## Payload Realism

Events are sampled from all 30 client-emittable event types defined in
`packages/shared/src/schemas/events/`. The weighted distribution mirrors realistic session traffic:

- **Highest frequency**: `scroll.depth`, `photo.gallery.next`, `mouse.dwell` (15 / 12 / 12 weight)
- **High frequency**: `photo.opened`, `page.view`, `price.hovered` (10 / 8 / 8 weight)
- **Low frequency**: `price.compared`, `listing.compared`, `inquiry.started` (2 / 2 / 2 weight)

Server-side-only event types (`chat.intent.detected`, `inquiry.completed`, `tour.requested`) are
excluded — the SDK does not emit them and the ingest handler would accept them but they are not
realistic load-test candidates.

Batch sizes vary uniformly between 3 and 20 events per request, matching the SDK's 2-second flush
window behavior.

## Troubleshooting

**"WARN Request Failed" at high rates**: normal at the stress peak. Check `estalara_rate_limited`
and `estalara_redpanda_errors` custom metrics for root cause breakdown.

**"VU allocation: insufficient VUs"**: increase `--vus` or raise `maxVUs` in the script. At 10k
req/s with 50ms p95, you need at minimum `10000 * 0.05 = 500` VUs. The scripts pre-allocate 500 and
cap at 2000 — sufficient for staging Cloudflare latency.

**Auth failures (401)**: verify `K6_TEST_API_KEY` is provisioned in the target environment's KV
namespace. The key must match the format expected by `apps/ingest/src/auth.ts` and the associated
tenant UUID must exist in Supabase.

**Cannot reach 10k req/s locally**: expected — `wrangler dev` is single-threaded and not designed
for throughput testing. Run against staging for accurate results. See the note in "Running Locally"
above.
