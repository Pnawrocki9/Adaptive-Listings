---
id: TICKET-017
title: Ingest load test 10K req/s (k6 scripts)
sprint: 1
priority: P1
agent: qa-engineer
status: BLOCKED
estimated_hours: 4
depends_on: [TICKET-016]
produces: []
affects_files:
  - 'tests/load/k6-ingest-baseline.js'
  - 'tests/load/k6-ingest-stress.js'
  - 'tests/load/README.md'
  - '.github/workflows/load-test.yml'
context_files:
  - apps/ingest/* (TICKET-012, 013)
  - .claude/agents/qa-engineer.md
labels: [sprint-1, p1, qa, load-test]
---

# TICKET-017: Ingest load test 10K req/s (k6 scripts)

## Summary

Write k6 load test scripts for the ingest endpoint. Target: prove ingest Worker can sustain 10,000
req/s with p95 < 50ms latency. Two scenarios: baseline (steady-state) and stress (ramp to find
breaking point). Run against staging deploy (not local), with the ability to run locally for
development. Results captured as artifacts.

## Context

Master Design C.2: target 70k events/sec peak across the platform. With batches of ~10 events per
request, that's 7k req/s peak. We test 10k req/s to give headroom. The ingest Worker is the most
performance-sensitive component — if it can't hit this, nothing downstream matters.

k6 chosen over alternatives (Locust, Artillery) because: built in Go (10x faster than Python-based),
JS scripting (matches our stack), excellent Prometheus output, runs in distributed mode if we need
it later.

## Scope

### In scope

- `tests/load/k6-ingest-baseline.js` — steady-state load: ramp 0 → 10k req/s over 1 min, hold for 5
  min, ramp down
- `tests/load/k6-ingest-stress.js` — ramp 0 → 50k req/s over 5 min, find breaking point
- Both scripts use realistic batch sizes (3–20 events per request, sampled), realistic event types
  from C.1
- Both scripts use realistic API keys (env var injected, e.g., `K6_TEST_API_KEY`)
- Output: k6 JSON results + summary text, saved as artifact in CI
- README explaining: how to run locally vs CI, how to interpret results, how to set baseline
  expectations
- CI workflow `.github/workflows/load-test.yml`: triggered on workflow_dispatch only (not on PR —
  too expensive); allows specifying target environment (staging/local)
- Pass criteria for baseline: p95 < 50ms, p99 < 200ms, 0% error rate, throughput ≥ 9.5k req/s
  sustained

### Out of scope

- Production load testing (production should never be load tested without coordinated comms)
- Stream consumer load (separate ticket if it becomes necessary; for now ingest is the bottleneck)
- ClickHouse load testing (that's data-engineer's domain, separate ticket if needed)
- Sustained 24h soak tests (Sprint 11 pre-launch)

## Acceptance criteria

- [ ] AC1: `tests/load/k6-ingest-baseline.js` exists, valid k6 script, can run with
      `k6 run --vus 1000 ...`
- [ ] AC2: `tests/load/k6-ingest-stress.js` exists, ramps to 50k req/s
- [ ] AC3: Both scripts use realistic event payloads sampled from across event categories
- [ ] AC4: Scripts read target URL + API key from env vars (`INGEST_URL`, `API_KEY`)
- [ ] AC5: Output thresholds defined: baseline `http_req_duration{p(95)<50ms}`,
      `http_req_failed{rate<0.001}`
- [ ] AC6: README in `tests/load/` covers: running locally, running against staging, interpreting
      results, baseline expectations; minimum 250 words
- [ ] AC7: GitHub Action `load-test.yml` is workflow_dispatch only with input parameter `scenario`
      (baseline/stress) and `target` (local/staging); uploads k6 results as artifacts
- [ ] AC8: First run against staging (manual trigger) produces results; if baseline thresholds fail,
      investigate but don't block ticket — escalate findings
- [ ] AC9: PR title `test(load): k6 ingest baseline + stress [TICKET-017]`

## Implementation guidance

```javascript
// tests/load/k6-ingest-baseline.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const options = {
  scenarios: {
    baseline: {
      executor: 'ramping-arrival-rate',
      preAllocatedVUs: 500,
      maxVUs: 2000,
      timeUnit: '1s',
      startRate: 0,
      stages: [
        { duration: '1m', target: 10000 },
        { duration: '5m', target: 10000 },
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<50', 'p(99)<200'],
    http_req_failed: ['rate<0.001'],
  },
};

const INGEST_URL = __ENV.INGEST_URL || 'http://localhost:8787';
const API_KEY = __ENV.K6_TEST_API_KEY || 'pk_test_load';

function sampleEvent(sessionId) {
  const types = ['page.view', 'scroll.depth', 'photo.opened', 'mouse.dwell'];
  const type = types[randomIntBetween(0, types.length - 1)];
  return {
    event_id: crypto.randomUUID(),
    tenant_id: '01928f00-7000-7000-8000-aaaaaaaaaaaa',
    session_id: sessionId,
    ts: Date.now(),
    region: 'eu',
    consent_state: 'legitimate-interest',
    schema_version: 1,
    type,
    payload:
      type === 'page.view'
        ? {
            url: 'https://example.com/listing/1',
            viewport: { width: 1440, height: 900 },
            device_class: 'desktop',
          }
        : {
            /* type-specific minimal */
          },
  };
}

export default function () {
  const sessionId = `sess_${__VU}_${__ITER}`;
  const batchSize = randomIntBetween(3, 20);
  const events = Array.from({ length: batchSize }, () => sampleEvent(sessionId));

  const res = http.post(`${INGEST_URL}/v1/events`, JSON.stringify({ events }), {
    headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': API_KEY },
  });

  check(res, {
    'status 200': (r) => r.status === 200,
    'has accepted': (r) => JSON.parse(r.body).accepted === batchSize,
  });
}
```

Stress version: replace `target: 10000` with `target: 50000` and longer ramp.

## Test plan

- Local: spin up wrangler dev + Redpanda + ClickHouse, run baseline script, observe results
- CI: trigger `load-test.yml` against staging, verify artifacts uploaded, results readable
- Document baseline numbers in README so future regressions are visible

## Definition of Done

- [ ] Branch `qa-engineer/TICKET-017-load-test-ingest`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean (also k6 scripts via prettier)
- [ ] First baseline run against staging captured + documented in README

## Notes

- 10k req/s is hard from a single test runner. If your local machine + staging infra can't handle
  it, escalate; we may need k6 Cloud or a dedicated load runner.
- Stress test will likely break things. That's the point. Document where it breaks and file
  follow-up tickets.
