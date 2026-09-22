- **2026-09-22 / FOLLOW-819 graded series at `d7e8ad26`** · Tested: the first FOLLOW-820 condition-1
  series under the 2026-09-22 rulings. Six graded runs on one control plane gave G, G, R, G, G, R,
  so the series is not citable. Both reds were AC(5) `thisRunConversions=0`, and in both the
  conversion WAS delivered: the SDK's FOLLOW-1242 re-send of a batch that workerd had refused with a
  503 landed about 8 s after the click, and the harness reads once at 7 s. · Where a test could have
  passed over a dead wire: nowhere here. The opposite happened: a fixed wait sized for the OLD
  delivery path (one flush, no retry) turned a product fix into a RED. The fix to that must not be a
  longer hand-picked sleep, which would only be tuned until green. A second trap: on WSL2 the wall
  clock stepped back about 2 s during the series. It made one Haiku call look like 244 ms and made
  ClickHouse refuse an `llm_calls` row with a negative `latency_ms` (FOLLOW-1253), so millisecond
  deltas from `Date.now()` in the artefacts are not reliable. · A guardrail I'd add: any harness
  wait on a producer's delivery must be derived from the producer's CURRENT retry schedule, read
  from its source, and must poll until the condition holds or a stated budget runs out, never sleep
  once. When a producer's delivery contract changes (retry, backoff, batching), grep the harnesses
  for fixed waits keyed to the old contract in the same PR.
