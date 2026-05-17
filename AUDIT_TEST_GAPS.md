# Estalara Adaptive Listings — Test Gap Audit

**Audit date:** 2026-05-16 **Repository HEAD:** `398dc97` **Companion to:**
`AUDIT_REPORT_INVESTOR_READINESS.md`, `AUDIT_IMPLEMENTATION_MAP.md`, `AUDIT_RISK_MATRIX.md`

---

## 1. Coverage today

### Test file count

- **TypeScript test/spec files:** 102 (excluding `node_modules/`, `dist/`, `.next/`)
- **Python test files:** 14
- **Total:** 116

### Per-package test count

| Package                       | Source files |            Test files | Notes                                                            |
| ----------------------------- | -----------: | --------------------: | ---------------------------------------------------------------- |
| `packages/sdk`                |           52 | 27 + 4 Playwright e2e | The crown jewel; playbooks, adapt, auto-detect, observer covered |
| `packages/shared`             |           29 |                     8 | Zod schemas + event union + directives                           |
| `packages/db`                 |           20 |                     4 | Drizzle schema + bandit/embedding seed coverage                  |
| `packages/auth`               |            4 |                     4 | JWT, middleware, tenant context                                  |
| `packages/platform-templates` |            3 |             1 (smoke) | Skeleton — barely populated                                      |
| `packages/compliance`         |            1 |             1 (smoke) | Empty package — version-stub test only                           |
| `packages/intent-ontology`    |            1 |             1 (smoke) | Same                                                             |
| `packages/sdk-loader`         |            1 |             1 (smoke) | Same                                                             |
| `packages/sdk-react`          |            1 |             1 (smoke) | Same                                                             |
| `packages/sdk-vue`            |            1 |             1 (smoke) | Same                                                             |

### Per-app test count

| App                       |        Source files |                 Test files | Notes                                                                  |
| ------------------------- | ------------------: | -------------------------: | ---------------------------------------------------------------------- |
| `apps/control-plane`      |           79 TS/TSX |             37 (367 tests) | Next.js dashboard + all REST routes                                    |
| `apps/ingest`             |                  13 |                          9 | Worker handlers + middleware                                           |
| `apps/decision-api`       |                  10 |                          6 | Adapt route, bandit, ab-assignment, reorder, consent-gate, llm-gateway |
| `apps/stream-consumer`    |             10 (Py) | 5 (4 unit + 1 integration) | ClickHouse client, otel, e2e                                           |
| `apps/llm-gateway`        |              5 (Py) |                          2 | Main stub + 544-LOC test for generate_description                      |
| `apps/data-quality`       |              4 (Py) |                          2 | Main stub + schema_validation cron                                     |
| `apps/auto-detect`        |              2 (Py) |                          2 | Both are smoke tests for the placeholder                               |
| `apps/intent-engine`      | 2 (Py, 27 LOC main) |                          1 | Tests the placeholder's `status: placeholder`                          |
| `apps/archetype-pipeline` | 2 (Py, 22 LOC main) |                          1 | Same                                                                   |
| `apps/adaptation-engine`  | 2 (Py, 22 LOC main) |                          1 | Same                                                                   |

### Coverage thresholds enforced

Per `CLAUDE.md`: ≥80% for `packages/*` (libraries), ≥70% for `apps/*` (services).

| Surface                                                  | Vitest config                  | Enforced thresholds                       | Status          |
| -------------------------------------------------------- | ------------------------------ | ----------------------------------------- | --------------- |
| All 10 packages                                          | `vitest.config.ts` per package | `lines/functions/branches/statements: 80` | ✅ Enforced     |
| `apps/ingest`, `apps/decision-api`, `apps/control-plane` | per-app `vitest.config.ts`     | `lines/functions/branches/statements: 70` | ✅ Enforced     |
| All Python apps                                          | `pyproject.toml` + `pytest`    | **No `--cov` flag in CI**                 | 🟥 Not enforced |

### CI workflow gates

`.github/workflows/`:

| Workflow                                                                                                                                                                              | Trigger                           | Blocking on PR?                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------- |
| `ci.yml` (10 jobs: doppler-verify, lint, typecheck, test-node, test-python matrix, build, build-control-plane, format, gitleaks-scan, clickhouse-smoke, corpus-gate, rule-h, sdk-e2e) | Push + PR to main                 | ✅ Yes (except doppler-verify with `continue-on-error: true`) |
| `e2e-smoke.yml`                                                                                                                                                                       | Nightly cron `0 3 * * *` + manual | 🟥 Not on PR                                                  |
| `deploy-staging.yml`                                                                                                                                                                  | Manual dispatch                   | n/a                                                           |
| `load-test.yml`                                                                                                                                                                       | Manual dispatch                   | 🟥 Not on PR                                                  |
| `release.yml`                                                                                                                                                                         | (SDK publish)                     | n/a                                                           |

---

## 2. End-to-end coverage

### Playwright SDK e2e (`packages/sdk/e2e/`)

4 specs, runs on every PR via `sdk-e2e` job:

| Spec                          | Last touched | Scope                                        |
| ----------------------------- | ------------ | -------------------------------------------- |
| `sdk.spec.ts`                 | 2026-05-15   | SDK init, sidebar widget mount               |
| `observer-flow.spec.ts`       | 2026-05-15   | page.view → scroll → impression → click flow |
| `adapt-dom-mutations.spec.ts` | 2026-05-15   | text/class/reorder directive application     |
| `consent.spec.ts`             | 2026-05-16   | TICKET-GDPR-004 consent gate                 |

✅ Well maintained. Covers Tier 1 + Tier 2 happy path against a fixture.

### Multi-service smoke (`tests/e2e/smoke-ingest.test.ts`)

- **Last touched:** 2026-05-03 (13 days stale at audit time)
- **Runs:** Nightly cron only (03:00 UTC), not per PR
- **Scope:** Docker Compose with ClickHouse + Redpanda + wrangler dev → POSTs 50 events → polls for
  ClickHouse arrival
- **Status:** 🟡 Only multi-service integration test in the repo; stale + non-blocking on PR

### Corpus gate (`packages/sdk/scripts/test-corpus.ts`)

- **Runs:** Every PR via `corpus-gate` job
- **Scope:** 24-platform auto-detection fixture suite; asserts 100% precision + 100% recall
- **Status:** ✅ Currently passing 100/100. The differentiator's quality floor.

### Rule H gate (`scripts/check-rule-h.sh`)

- **Runs:** Every PR via `rule-h` job + lefthook pre-push
- **Scope:** Blocks (a) new API routes claiming "MVP stub / real impl in TICKET-X" without a
  corresponding open `FOLLOW-NNN` reference; (b) new `lib/*.ts` files with zero non-test importers
- **Status:** ✅ Active and effective. Should be tightened further (current bypass: comment with
  "TICKET-" + non-existent ticket id passes).

---

## 3. Critical test gaps (ordered by leverage)

### Gap 1 — No end-to-end test of intent → archetype → adapt → DOM loop

**Severity:** P1 (FOLLOW-022).

There is no test in the repository that exercises the full differentiator loop: synthetic user
behavior → ingest → consumer → intent classification → archetype assignment → directives applied →
DOM mutation → measured CTR vs holdout.

The closest things:

- `packages/sdk/e2e/adapt-dom-mutations.spec.ts` — tests DOM mutation given mocked directives, but
  not the path that produced them
- `apps/decision-api/src/__tests__/adapt.test.ts` — tests endpoint logic given mocked classifier
  input
- `apps/intent-engine/src/test_main.py` — tests the placeholder returns `status: placeholder`
- `apps/stream-consumer/src/tests/test_consumer.py` — tests Kafka batch + ClickHouse insert with
  mocks
- `tests/e2e/smoke-ingest.test.ts` — only validates data-plane arrival

**Recommended fix:** A single new test in `tests/e2e/intent-loop.test.ts` that:

1. Boots a fixture HTML page with `data-estalara-*` attributes
2. Loads the SDK with a stubbed Decision API URL pointing at a local handler
3. Programmatically fires 5 listing-viewed events
4. Asserts the SDK calls Decision API with archetype hint
5. Stubs the response and asserts DOM mutation happens
6. Re-fires 5 more events and asserts a re-fetch occurs
7. Asserts a holdout session produces no mutation

Estimated 2 days for a qa-engineer.

### Gap 2 — Slot-name CI contract test missing

**Severity:** P1 (TICKET-SLOT-CONTRACT-001 READY).

Without this test, renaming `feature` → `feature-section` in one playbook silently breaks the SDK
applying directives. RETRO-001 documented one such silent regression that took half a sprint to
detect.

**Recommended fix:** `apps/control-plane/src/lib/__tests__/llm-gateway-slot-contract.test.ts` that
grep-walks `packages/sdk/src/core/playbooks/archetypes/*.ts`, extracts all slot names used in
TextDirective/ClassDirective, and asserts they are a subset of a canonical slot enum.
CONVENTIONS_PATCH.md Rule F documents the canonical names.

### Gap 3 — Placeholder-token coverage test missing

**Severity:** P1 (FOLLOW-026 / FOLLOW-030).

Every non-neutral archetype's `copy_template.en` contains 1–3 `{token}` placeholders. There is no
test asserting every token used in playbook copy has a registered resolver (DOM attribute name).
Result: tenants whose template doesn't expose the expected attribute see `{key_luxury_feature}`
literally on-page.

**Recommended fix:** A vitest in `packages/sdk/src/core/playbooks/__tests__/token-coverage.test.ts`
that parses every `copy_template.{en,pl,es}` string, extracts `{token}` matches, and asserts every
token is in a canonical `RESOLVABLE_TOKENS` set declared in `packages/shared/`. Add a corresponding
lint check.

### Gap 4 — Locale fallback test missing

**Severity:** P2.

`SlotDirective` has `pl?` / `es?` overrides. The Decision API reads `s.en` directly. A tenant
configured for `pl` silently gets English copy with no audit signal.

**Recommended fix:** Add `getLocalizedSlot(slot, locale)` with documented fallback chain
`pl → es → en`. Test asserting "if `pl` absent, returns `en` and emits `locale.fallback` event".

### Gap 5 — Corpus regression test for reorder missing

**Severity:** P2 (FOLLOW-021).

The 24-platform corpus tests schema detection (Layer 1–5) at 100/100. No fixture exercises
`applyReorderDirective` against detected schemas to assert reorder works post-detection.

**Recommended fix:** Extend `corpus-report.json` to include a reorder fixture for each of 24
platforms (small JSON with 5 listing-card DOM IDs); test asserts reorder applies for each.

### Gap 6 — No Python coverage gate

**Severity:** P2.

`test-python` matrix runs `pytest src/ -v` without `--cov`. Drift below sensible coverage goes
silently undetected for stream-consumer, llm-gateway, data-quality (the substantive Python apps).

**Recommended fix:** Add `--cov=src --cov-fail-under=70` to `.github/workflows/ci.yml` `test-python`
job. Acknowledge that placeholder apps will pass trivially (they have nothing to cover).

### Gap 7 — Decision-API stub classifier is the only thing tested

**Severity:** P1.

`apps/decision-api/src/__tests__/adapt.test.ts` (919 LOC, comprehensive) tests the _stub_ classifier
— `detectArchetype()` keyword-substring returning investor/family/neutral. There is no test
exercising the _real_ 18-archetype classifier path because that path runs in the control-plane
Next.js route, which has its own test set but is not validated against the Worker route for contract
consistency.

**Recommended fix:** A cross-route contract test (`tests/contract/adapt-route-parity.test.ts`) that
runs the same fixture request against both endpoints and asserts a documented shape parity (consent
gate behavior, holdout behavior, directive types emitted, response schema).

### Gap 8 — Bandit production wiring not tested

**Severity:** P1.

`apps/decision-api/src/lib/__tests__/bandit.test.ts` extensively tests the Thompson sampling math.
Zero tests cover the wire-up: there are no tests because there is no production wire-up —
`bandit.ts` is imported by zero non-test files. The tests pass; the bandit is dead.

**Recommended fix:** Once FOLLOW-007 closes (variant selection per request), add tests asserting:

- Bandit is called from the decision route for non-holdout sessions
- `variant_index` is present on returned `TextDirective`s
- Bandit results are persisted to `ab_bandit_weights`

### Gap 9 — RLS enforcement test missing

**Severity:** P0.

There is no meta-test asserting every public-schema table has at least one RLS policy. The 5 tables
missing RLS (`session_embeddings`, `tenant_site_schemas`, `ab_bandit_weights`,
`schema_validation_history`, `archetype_embeddings`) slipped through review.

**Recommended fix:** `packages/db/src/__tests__/rls-meta.test.ts` that queries
`information_schema.tables` for `tablename` and asserts every row has a matching row in
`pg_policies`. Run as part of `db-migrate-and-test` job in CI.

### Gap 10 — DSR-erase ClickHouse hard-delete missing both implementation and test

**Severity:** P0 (FOLLOW-039).

The DSR-erase route does not hard-delete from ClickHouse, and there is no test asserting it does.
Both must land together.

**Recommended fix:** Implementation of hard-delete + integration test in
`apps/control-plane/src/app/api/dsr/erase/__tests__/clickhouse-hard-delete.test.ts` that:

1. Inserts a fixture session_id into the local ClickHouse `events` table
2. Calls DSR-erase with that session_id
3. Asserts the row is gone from `events`, `description_generations_verified_facts`,
   `session_embeddings`

### Gap 11 — Auto-detect AI Vision pipeline not load-tested

**Severity:** P2.

`apps/control-plane/src/app/api/detect/route.test.ts` (16 tests) covers happy path, DB failure
tolerance, schema validation. There is no test asserting the AI Vision call timeout (Claude Sonnet
4.6 can take 10–30s), cost cap, or retry behavior under degraded conditions. The 100/100 corpus gate
is single-platform; production traffic will see edge cases.

**Recommended fix:** k6 load test (already exists in `load-test.yml`) extended to hit `/api/detect`
with 50 distinct URLs; track p95 latency + cost-per-call + Sentry error rate.

### Gap 12 — No integration test for the schema-drift → SDK self-healing loop

**Severity:** P2.

`apps/data-quality/src/crons/schema_validation.py` detects drift and emits `schema_drift_detected`
to Redpanda. No test asserts that the SDK's auto-detect pipeline consumes that signal and applies a
fresh schema on next load.

**Recommended fix:** Integration test in `tests/e2e/schema-self-healing.test.ts` that mocks a drift
event, asserts the next SDK init queries a fresh tenant schema, asserts the new selectors take
effect.

---

## 4. Quality posture verdict

The engineering foundation is **acceptable**, leaning fragile in specific layers and strong in
others:

**Strong layers:**

- Coverage thresholds are real and enforced (80% libraries / 70% apps)
- CI gate set is broad (13 jobs per PR)
- Rule H scaffold-wiring check is a project-specific quality gate not present in most codebases
- Corpus gate at 100/100 on 24 platforms is the differentiator's true quality floor
- Per-ticket retrospectives drive accumulating rules → permanent CI gates (Rule H)
- SDK Playwright e2e is well-maintained and runs on every PR

**Fragile layers:**

- The differentiator loop has no end-to-end test (Gap 1)
- Bandit is dead code; tests cover math, not production wiring (Gap 8)
- Two parallel adapt routes have no consistency contract test (Gap 7)
- RLS gaps slipped through review (Gap 9)
- DSR-erase compliance gap (Gap 10) is both an implementation and test gap
- Python apps have no coverage gate (Gap 6)
- Stale multi-service smoke (13 days untouched, nightly-only)

**Net:** the team's CI gate discipline and per-ticket retrospective culture has caught and codified
failure patterns that would otherwise compound. The Rule H CI gate is exemplary. But several
critical test gaps map directly to the highest-leverage risks in `AUDIT_RISK_MATRIX.md`: closing
them is the fastest path from "acceptable" to "strong" engineering posture.
