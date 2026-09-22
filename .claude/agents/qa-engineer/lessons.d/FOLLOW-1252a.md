- **2026-09-22 / FOLLOW-1252a** · Tested: AC(5)'s this-run `cta.clicked` read now polls ClickHouse
  by `session_id`. Its budget is derived from the SDK source: `BATCH_INTERVAL_MS`, `MAX_FLUSHES` and
  the power-of-two re-send predicate, which gives every timed send plus 5 s slack, 85000 ms at
  `d7e8ad26`. A row landing at 8.15 s (run 6) reads 0 under the legacy 7 s read and 1 under the
  poll. A row that never lands is RED with `thisRunConversionLoss` = `cta_not_sent`,
  `no_ingest_2xx_for_cta_batch` or `ingest_accepted_row_never_landed`, read from per-POST ingest
  records. Mutating either SDK constant in the real source text moves the budget. Removing the
  predicate makes the reader throw. · Where a test could have passed over a dead wire: the fixed
  wait was derived from a producer constant (FOLLOW-1075). It went stale when FOLLOW-1242 added a
  second producer behaviour, retry, that the wait never modelled. "Read from source" covered one
  constant, not the schedule. Separately, `net[]` could not answer "did ingest accept the batch",
  because a CORS-less 503 never reaches Playwright's `response` event. · A guardrail I'd add: when a
  harness wait is derived from a producer, derive it from the producer's whole delivery contract
  (interval, retries, cap), and make the reader throw when that contract's shape changes. Record
  per-request outcomes (`response` and `requestfailed`) for every request an AC's verdict depends
  on, not just the responses.
