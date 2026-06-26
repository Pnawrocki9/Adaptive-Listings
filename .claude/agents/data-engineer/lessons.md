# Data Engineer — Lessons Learned

---

## 2026-06-20 / FOLLOW-366

**What I built:** P0 hotfix for the dead FOLLOW-346 chat NLP shadow bridge. The defect:
`_spawn_chat_nlp` read `payload.get("content")` and `payload.get("role")`, but the canonical SDK
producer shape (`ChatMessageSentPayloadSchema`) has `{message, char_count, lead_id}` — no `content`,
no `role`. So `content == ""` for 100% of real events, the empty-text guard tripped, and
`process_chat_message` was never spawned. Fix: read `payload.get("message")` and synthesize
`{"role": "user", "content": message_text}` only at the Modal call site (matching the Modal
function's expected arg shape). Also replaced all hand-invented `{role, content}` test fixtures with
the real producer shape and added a dedicated AC-Z regression test that proves fail-before /
pass-after.

**Vocabulary/seed/retention risks I weighed:**

- No new table/column introduced. ClickHouse batch path is unchanged. DPIA (C-07) re-verified: only
  `tenant_id`, `session_id`, and the message text (already PII-scrubbed by the SDK's
  `scrubMessagePii`) are forwarded to Modal. No double-scrubbing, no raw text stored.
- The synthesized `{"role": "user", "content": ...}` dict exists only in the `_spawn_chat_nlp` stack
  frame; it is never persisted.
- Rule Z (new): ALL test fixtures for `chat.message.sent` MUST use the canonical SDK producer shape
  (`{message, char_count, lead_id}`), not a hand-invented `{role, content}`. Documented in the test
  module docstring so the pattern is visible to the next engineer.

**A guardrail I'd add:** Rule Z should be formally codified: "For any consumer test that processes a
named Redpanda event type, the test fixture MUST be derived from the Zod schema for that event type
(or a comment linking to it). Hand-invented payload shapes are forbidden." This would have caught
the original FOLLOW-346 defect at PR review time.

---

## 2026-06-20 / FOLLOW-346

**What I built:** Chat NLP shadow bridge — wired the dead bridge between `stream-consumer` and
`process_chat_message`. Added `_spawn_chat_nlp()` to `events.py` with a `modal.Function.lookup` +
`.spawn()` fire-and-forget pattern (mirrors `waitUntil` in `events.ts`). Added `CHAT_NLP_LIVE` env
flag to `route.ts` (default false) to make the shadow-vs-live gate machine-readable. 17 new tests (8
stream-consumer, 5 intent-engine, 4 TS route).

**Vocabulary/seed/retention risks I weighed:**

- DPIA (C-07): confirmed zero raw chat text reaches ClickHouse or Postgres. The spawn forwards only
  `tenant_id`, `session_id`, and the message dict. The NLP output (12-dim intent vector) is written
  to Redis shadow key by `redis_writer.write_shadow_intent` with enforced 24h TTL (`ex=86400`). No
  new column or table introduced — no Rule H seed needed.
- `process_chat_message` in `main.py` already correctly writes the shadow key — no NLP logic changes
  required. This confirmed the spec's instruction: "if it already does, make no change."
- The `CHAT_NLP_LIVE` gate prevents any silent live adaptation from chat intent. The flag is read at
  module load time (not per-request) which is intentional — changing it requires a redeploy, not a
  runtime toggle, which is the right gate for a DPIA-controlled feature.
- The existing `route.chat-intent.test.ts` tests all passed unchanged after adding the
  `console.info` log in the shadow read block — confirmed no regression.
- `_spawn_chat_nlp` has two layers of exception protection: internal `except Exception` + outer
  `try/except` in the routing branch. Belt-and-suspenders needed because mock patches in tests
  bypass the internal catch.

**A guardrail I'd add:** When a Modal function is referenced by name string
(`.lookup("app", "fn")`), there is no compile-time check that the function name matches the deployed
function. A CI integration test that does `modal.Function.lookup(...)` against the staging
deployment and asserts the function exists would catch rename drift before it reaches prod silently.

---

## 2026-06-08 / FOLLOW-234

**What I built:** Vercel cron route `GET /api/internal/retention/conversion-labels` (schedule
`0 2 * * *`) that deletes `conversion_labels` rows where `labeled_at < NOW() - 13 months`, using the
same CRON_SECRET auth + fail-loud (Rule K.2) pattern as the existing DSR mutation-poll cron. Added
route to `vercel.json` crons array. Exported `thirteenMonthsAgo()` helper for testability. Updated
ROPA Retention Schedule (v2.3) and DPIA §2.5 (v2.5) to confirm enforcement is live.

**Vocabulary/seed/retention risks I weighed:**

- No new table — the `conversionLabels` schema already existed (migration 0019). The cron is the
  writer/enforcer for a retention promise that was previously aspirational. Self-check: writer
  evidence is the `db.delete(conversionLabels).where(lt(...))` call in the route.
- Chose `labeled_at` (not `created_at`) as the retention anchor — matches the ROPA/DPIA spec and
  HANDOFFS.md language ("from `labeled_at`"), and labeled_at is set by the CRM ingest webhook at the
  moment of label creation, so it correctly bounds the training pair's age.
- Chose calendar-month arithmetic (`setMonth(m - 13)`) over a fixed ms constant so the boundary
  doesn't drift against leap years. Documented and tested.
- The "nightly TTL cron" referenced in ropa.md for session_embeddings/engagement_scores also does
  not exist yet — but that's out of scope for FOLLOW-234. Did not introduce a new aspirational
  reference; the engagement_scores schema docstring still says "FOLLOW-193 AC1 — requires Vercel
  Pro, gated on CEO Q3 confirmation." Did not touch that.

**A guardrail I'd add:** When a compliance doc retention table row says "enforced by nightly cron"
but no cron route exists in `apps/control-plane/src/app/api/`, a CI check should flag the gap (grep
for cron path in vercel.json, confirm route file exists). This would have caught the
session_embeddings/engagement_scores aspirational cron reference before it drifted.

---

## 2026-06-08 / FOLLOW-221

**What I built:** `?format=json` export for `GET /api/pilot/calibration`. Added
`CalibrationExportRowSchema` (Zod), `CalibrationExportRow` type, and `buildCalibrationExportRows()`
to `route-helpers.ts`. When `?format=json` is present, the endpoint returns a flat JSON array of
`(outcome_class, model_version, tenant, window, count, avg_confidence)` rows with
`Content-Disposition: attachment`. Existing chart path is unaffected. 9 new tests (37 total).

**Vocabulary/seed/retention risks I weighed:**

- No new table/column — the export is a projection of existing `adaptation_decisions` +
  `conversion_labels` data already assembled for the chart path. No new writer needed per Rule H.
- `avg_confidence` is derived from `predicted_rate` (already-computed calibration rows) rather than
  a separate ClickHouse query — avoids N+1 and keeps the export path on the same fast code path.
- Rule K.2 inherited cleanly: the export calls `buildCalibrationExportRows()` on the same data the
  chart path already assembled, so a configured-store failure on ClickHouse/Postgres hits the same
  HTTP 500 + Sentry path before the export builder is ever called. No new silent-fallback risk.
- New exports `CalibrationExportRowSchema` and `buildCalibrationExportRows` are imported by
  `route.ts` (non-test file) — Rule I satisfied. The pre-existing `isPositiveOutcome` /
  `confidenceDecile` Rule I warnings are not new; confirmed pre-existing on main from PR #234 logs.

**A guardrail I'd add:** The CI landscape memory recorded `Rule I` as pre-existing-red since June 3.
Each new PR that exports helper functions from `route-helpers.ts` risks compounding the WARNs. A
Rule H amendment that specifically exempts "helper functions imported within the same app directory"
from Rule I's zero-importer check (only enforcing it across package/app boundaries) would reduce
noise without weakening the real signal.

---

## 2026-06-08 / FOLLOW-237

**What I built:** Four fixes to the calibration JSON export: (1) added
`data_source: 'clickhouse' | 'mock'` to `CalibrationExportRowSchema` and the `jsonExportResponse`
envelope (Rule K.2 provenance); (2) added `parseFormat()` that throws HTTP 400 for unknown
`?format=` values like `csv`, `jsonl`, `JSON`; (3) renamed `avg_confidence` →
`mean_model_predicted_rate` with JSDoc clarifying per-model_version semantics and FOLLOW-230
dwell-cap caveat; (4) corrected HANDOFFS.md FOLLOW-221→FOLLOW-175 entry to state this is a
calibration SUMMARY not a row-level LoRA corpus. 42 tests (up from the original 28), all passing.

**Vocabulary/seed/retention risks I weighed:**

- Renamed exported field `avg_confidence` → `mean_model_predicted_rate` in
  `CalibrationExportRowSchema`. This is a breaking change to any consumer of the JSON export — but
  the RETRO confirmed there are ZERO existing consumers (Rule H HALF_WIRE_P), so no parity test was
  needed. Grepped to confirm before renaming.
- The envelope shape `{ data_source, rows }` replaces the flat array — also breaking, no consumers
  to update. Documented in HANDOFFS.md.
- The `parseFormat()` function throws a pre-built `Response` (not a JS `Error`) and the catch in the
  GET handler returns it directly. This avoids the anti-pattern of re-wrapping an already-built
  response and preserves Next.js's ability to serialize it natively.

**A guardrail I'd add:** When a handoff entry claims "export feeds FOLLOW-NNN", a CI check should
confirm the receiving ticket's spec lists the correct schema fields. A hand-written handoff that
disagrees with the receiving ticket's AC goes undetected until someone builds FOLLOW-175 and
discovers the shape mismatch. An automated "cross-reference ACs" step in the HANDOFFS format
validation could catch this at PR time.

---

## 2026-06-26 / FOLLOW-394

**What I built:** CI contract test (`infra/clickhouse/scripts/migration-contract-test.sh`) that
catches migration-before-code ordering failures for ClickHouse. Added as a step in the
`clickhouse-smoke` CI job, runs before `migrate.sh + smoke-test.sh` on a clean container. Also added
`docs/runbooks/clickhouse-migrations.md` documenting the invariant, the ESC-031 incident, the manual
curl apply pattern, and the checklist for future column additions.

**Vocabulary/seed/retention risks I weighed:**

- No new table/column: the script is a pure test harness, no DDL side-effects beyond transient test
  data. No seed or writer obligation.
- The AC-supplied INSERT included columns (`listing_id`, `directives`, `created_at`) that do not
  exist in the `adaptation_decisions` schema. Substituted correct real column names so the
  post-migration assertion can succeed. Documented the deviation with a comment in the script.
- The contract test applies 0001-0018, then 0019, leaving all migrations applied. The subsequent
  full `migrate.sh` run is a no-op (all `IF NOT EXISTS` guards). No ordering conflict.
- Cross-referenced FOLLOW-308 (standing prod-apply gate) in the runbook instead of duplicating the
  mechanism — consistent with the ticket's "do NOT build a parallel mechanism" constraint.

**A guardrail I'd add:** Extend the contract test to cover EVERY fire-and-forget ClickHouse writer
in `apps/` (not just `logDecisionAsync`) — any `.catch()` that swallows a CH error is a
silent-data-loss risk for the same migration-ordering pattern. A grep-based CI step that detects new
`.catch(() => ...)` wrappers around ClickHouse `fetch()` calls and requires a corresponding contract
test case would close that gap generically.

---

## 2026-06-23 / FOLLOW-371

**What I built:** One-shot remediation of ESC-026 holdout contamination. Between PR #327 (2026-06-19
21:17 UTC) and PR #333 (2026-06-20 09:53 UTC), the GET `/api/adapt` path wrote
`adaptation_decisions` rows with `(holdout_group=1, variant IN ('v1','v2'))`. Four analytics routes
consuming those rows now carry an exclusion predicate
`NOT (holdout_group=1 AND variant!='control')`. Migration 0017 (no-op documentation), an optional
operator relabel script, golden-query regression tests, and `docs/DATA_DICTIONARY.md` (first-ever)
were added in the same PR.

**Vocabulary/seed/retention risks I weighed:**

- No new table/column added (no writer-seed obligation triggered). The contaminated rows already
  exist; the fix is query-layer, not DDL-layer.
- Chose exclusion filter over ALTER TABLE UPDATE (async ClickHouse mutation) because: (1) the pilot
  was in shadow mode — expected zero affected rows — so no data-in-place urgency; (2) an async
  mutation is harder to verify atomically and has replay risk; (3) the exclusion filter is
  self-documenting and immediately effective without operator downtime.
- Retention: no new TTL claims made. DATA_DICTIONARY.md correctly marks existing table TTLs as
  "Pending" to avoid making promises that aren't enforced.

**A guardrail I'd add:** A CI-enforced lint rule on ClickHouse queries: any SQL touching
`adaptation_decisions` WHERE `holdout_group = 1` must also carry `AND variant = 'control'` or the
exclusion predicate. This would have flagged the original PR #327 gap immediately and caught any
future regression without relying on a retro + follow-up ticket cycle.
