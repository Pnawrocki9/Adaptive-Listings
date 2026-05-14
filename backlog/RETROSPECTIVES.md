# Retrospectives Log

Every ticket that reaches DONE produces one entry here. The `retrospective-analyst` agent appends
entries after the PM orchestrator transitions a ticket from READY_FOR_REVIEW → DONE (post-merge).

Format: `## RETRO-NNN — TICKET-XXX (short title) — YYYY-MM-DD`

Entries are append-only. Never edit a past entry — add a follow-up retro or a cross-reference in the
next entry instead.

**How to read this file:** Each retro covers one merged PR. Section 4 (Cascading impact) is the most
important for upcoming tickets — check it when picking up any ticket that touches modules listed
there.

---

## RETRO-001 — TICKET-046 (playbook variants + copy_template) — 2026-05-14

### 1. Summary of change

- **PR:** #92 (merged 2026-05-14, commit b6368b6)
- **Files changed:** ~30 (+817 / -40)
- **Modules touched:** SDK playbooks, control-plane llm-gateway, control-plane test fixtures, demo
  mockup page
- **Key contracts changed:**
  - `PlaybookEntry.copy_template` — ADDED as required field — breaking: yes (all inline mock objects
    of PlaybookEntry must now include `copy_template`)
  - `SlotDirective.variants` — ADDED as optional field — breaking: no
  - `SlotDirective.slot` (yield_hunter) — CHANGED from `'feature-section'` to `'feature'` —
    breaking: yes for any tenant who hardcoded `feature-section` (none in prod, but SDK behavior
    changed)
  - LLM gateway Sonnet prompt — CHANGED slot list from `headline, feature-section, cta` to
    `headline, cta, feature` — breaking: no (output correction)

### 2. Verification done in PR

- Test files changed: `playbooks.test.ts` (full rewrite with it.each matrix)
- Assertions added: 18 archetypes × 6 invariants = 108 assertions
- Coverage delta: SDK playbooks module went from ~40% to ~95%
- CI checks: passed (pnpm test, pnpm build, pnpm typecheck, prettier)

### 3. Discovered gaps

#### 3a. Logic gaps

- **Bandit variant selection not wired:** `ab_bandit_weights` table (PR #80) has `variant` column
  but Decision API always returns `variant_index = 0` (the default). The 3 variants per archetype
  added in this PR are unreachable by the Thompson sampling logic. Bandit is seeded with
  `variant = 'default'` only — no `variant_1`, `variant_2` rows exist in the DB seed. → FOLLOW-001
  (post-Sprint 10: TICKET-BANDIT-VARIANTS)
- **`copy_template` pipeline not implemented (E.7):** The `copy_template.en` field now exists in all
  17 non-neutral archetypes but the endpoint `GET /api/adapt/description`, the Modal job
  `generate_description.py`, and the Redis cache layer described in Master Design E.7 do not exist.
  `copy_template` is currently unreachable by any API consumer. → FOLLOW-002 (Sprint 9:
  TICKET-DESC-001)

#### 3b. Code bugs not caught

- N/A — no runtime bugs escaped. The `feature-section` rename was the only behavioral fix and it was
  fully corrected in this PR.

#### 3c. Test coverage gaps

- **No contract test for slot name consistency between LLM prompt and playbook definitions:** The
  `feature-section` bug existed because the LLM gateway prompt hardcoded slot names independently
  from the playbook files. There is still no automated check that: "every slot name in
  `llm-gateway.ts` prompt strings = every slot name in `archetypes/*.ts`" → FOLLOW-003
  (TICKET-SLOT-CONTRACT-001, qa-engineer, 2h)
- **No lint check for `copy_template.en` non-empty on all non-neutral archetypes:** If someone adds
  a new archetype and forgets to fill `copy_template.en`, no CI gate catches it. → FOLLOW-004
  (TICKET-LINT-ARCHETYPE-001, sdk-engineer, 1h)

#### 3d. Documentation gaps

- Master Design updated to v1.6 in PR #93 (TICKET-ARCH-002) — covered separately.
- v1.5 patch sections B.8/B.9 (auto-onboarding schema details) were listed as pending in the patch
  notes but are not yet reflected in MASTER_DESIGN.md. → FOLLOW-005

### 4. Cascading impact

#### 4a. Current sprint tickets affected

- **TICKET-AB-001 (IN_PROGRESS):** Bandit A/B test logic. This ticket now has 3 real variants per
  archetype to test against. However, the ticket spec mentions `variant = 'default'` as the only
  seed value — the spec needs to be updated to include `variant_0`, `variant_1`, `variant_2` seed
  rows, or the bandit loop will still only ever pick `variant_index = 0`. **Action required:**
  Update TICKET-AB-001 spec or add it to that ticket's in-scope work.
- **TICKET-REORDER-001 (DONE):** No impact — reorder logic doesn't use variants or copy_template.

#### 4b. Future sprint tickets affected

- **TICKET-DESC-001 (Sprint 9, planned):** The `copy_template.en` field exists — Sonnet now has a
  seed to work from. The endpoint and Modal job still need to be built. Sprint 9 timing is correct.
  Verify that `copy_template.en` length (~100–150 words per archetype) fits within Sonnet's
  600-token budget for the description prompt.
- **TICKET-AGENCY-001 (Sprint 8, READY):** `LlmGatewayInput` still lacks `listingContext?` field.
  Agency answers will be collected but cannot flow into LLM prompts until this field is added.
  AGENCY-001 should include adding `listingContext?: Record<string, string>` to `LlmGatewayInput` in
  `apps/control-plane/src/lib/llm-gateway.ts`.

#### 4c. Contracts changed that other modules rely on

- Any code that constructs an inline `PlaybookEntry` object (tests, mocks, fixtures) now MUST
  include `copy_template: { en: string }`. Failure to do so causes a typecheck error. **Scan:**
  `grep -rn "PlaybookEntry" packages/ apps/ --include="*.ts"` — update all matches.
- The canonical slot name `feature` (not `feature-section`) is now the enforced standard. Any
  documentation, demo pages, or onboarding scripts referencing `feature-section` must be updated.

#### 4d. Architectural assumptions affected

- Master Design E.3 assumes "bandit selects variant per archetype" — this is architecturally correct
  but the implementation gap (no `variant_0/1/2` DB rows) means E.3 is not yet operationally active.
  The architecture is sound; the wiring is incomplete.

### 5. New lesson candidates

- **Pattern: "Breaking required-field change → missed inline mock objects"** — seen in RETRO-001
  only. Count: 1. Threshold: 2. NOT yet promoted to CONVENTIONS*PATCH.md. *(Note: this pattern was
  identified as common enough to pre-emptively codify as Rule G given it affects TypeScript-first
  codebase invariants — see CONVENTIONS*PATCH.md Rule G)*

### 6. Follow-ups

- FOLLOW-001: Wire bandit variant selection (variant_0/1/2 DB seed + Thompson sampling index)
  (architect → backend-engineer, 4h, P1, post-Sprint 10)
- FOLLOW-002: Build `GET /api/adapt/description` endpoint + Modal job (DESC-001) (backend-engineer +
  ml-engineer, 8h, P1, Sprint 9)
- FOLLOW-003: Contract test — LLM prompt slot names must equal playbook slot names (qa-engineer, 2h,
  P1, Sprint 8 or 9)
- FOLLOW-004: Lint check — all non-neutral archetypes must have non-empty `copy_template.en`
  (sdk-engineer, 1h, P2, Sprint 8)
- FOLLOW-005: Apply v1.5 patch B.8/B.9 to MASTER_DESIGN.md (architect, 1h, P2, Sprint 8)

### 7. Cross-references

- First retro — no prior cross-references.

---

## RETRO-002 — TICKET-AB-001 (A/B holdout framework + Thompson bandit) — 2026-05-14

**Note:** Retroactive retro. PR #80 merged 2026-05-14 (commit `0e5cc0c`), part of the Sprint 8
fix-cluster (PRs #80–#90). This retro runs after RETRO-001 (TICKET-046) because the PM scheduled
retros in dependency order — RETRO-001 already identified a downstream gap in AB-001
(`variant_index` propagation) before AB-001 itself was retro'd. Cross-reference noted in Section 7.

### 1. Summary of change

- **PR:** #80 (merged 2026-05-14, commit `0e5cc0c`)
- **Files changed:** 23 (+2258 / -37)
- **Modules touched:** decision-api (ab-assignment, bandit, adapt route), shared (events registry),
  db (Drizzle schema + SQL migration), infra/clickhouse (DDL migration), control-plane
  (`/api/ab/weights` stub), backlog metadata, commitlint config
- **Key contracts changed:**
  - `AbAssignmentEventSchema` + `AbAssignmentPayloadSchema` — ADDED to `packages/shared` event union
    — breaking: no (additive); `EVENT_TYPES` const tuple grew by `'ab.assignment'`
  - `ab_bandit_weights` Postgres table — NEW (Drizzle `abBanditWeights` + SQL migration 0004 with
    RLS policy) — breaking: no (new table)
  - `adaptation_decisions.holdout_group` ClickHouse column — NEW (migration 0006) — breaking: no
    (additive with default `false`)
  - `AdaptResponse.holdout_group?: boolean` — ADDED as optional field — breaking: no
  - `AdaptRequestSchema.consent_state | consent_mode_enabled | holdout_pct` — ADDED as optional
    fields — breaking: no
  - `apps/decision-api/src/lib/ab-assignment.ts` — NEW module exporting `assignHoldout`,
    `DEFAULT_HOLDOUT_PCT`, `shouldAutoPause`, `twoProportionZTestPValue`,
    `REGRESSION_MIN_SESSIONS_PER_ARM`, `REGRESSION_P_VALUE_THRESHOLD`, `SKIP_CONSENT_STATES` —
    breaking: no (new exports)
  - `apps/decision-api/src/lib/bandit.ts` — NEW module exporting `sampleBeta`, `thompsonSample`,
    `updateBanditArm`, `BanditArm` — breaking: no
  - `GET /api/ab/weights` (control-plane) — NEW route, **mock implementation** returning
    deterministic seeded fake data — breaking: no (new endpoint)

### 2. Verification done in PR

- Test files changed/added:
  - `apps/decision-api/src/lib/__tests__/ab-assignment.test.ts` (NEW, 286 lines)
  - `apps/decision-api/src/lib/__tests__/bandit.test.ts` (NEW, 151 lines)
  - `apps/decision-api/src/__tests__/adapt.test.ts` (+104 lines)
  - `packages/shared/src/schemas/events/__tests__/ab-assignment.test.ts` (NEW, 170 lines)
  - `packages/db/src/__tests__/ab_bandit_weights.test.ts` (NEW, 75 lines)
  - `apps/control-plane/src/app/api/ab/weights/route.test.ts` (NEW, 94 lines)
- Assertions added: ~80+ across the six new test files (determinism, uniform distribution at N=10k
  for holdout_pct ∈ {0.05, 0.10, 0.20}, consent-aware skip for 3 consent states, idempotency, z-test
  edge cases, shouldAutoPause decision boundaries, Beta sampling moments, Thompson selection bias,
  schema column presence)
- Coverage delta: new files start at near-100% (every exported symbol has at least one test);
  `apps/decision-api/src/app/api/adapt/route.ts` AC-5/AC-6 paths covered (idempotent holdout_group,
  default-experience-on-holdout)
- CI checks: passed (per QUEUE.md recent-merges entry, marked DONE 2026-05-14)
- **NOT verified by tests:** AC-4 (event emission to Redpanda), AC-7 (regression-detection scheduled
  job firing), bandit integration into the adapt hot-path, seeding of `ab_bandit_weights` rows. See
  Section 3a.

### 3. Discovered gaps

#### 3a. Logic gaps

- **AC-4 not implemented — `ab.assignment` event is never emitted.** The Zod schema
  (`AbAssignmentEventSchema`) is registered in `packages/shared/src/schemas/events/index.ts` and the
  route returns `holdout_group` in the JSON response, but
  `apps/decision-api/src/app/api/adapt/route.ts` does NOT push an event to Redpanda / the ingest
  pipeline on assignment. `grep -rn "ab.assignment" apps/decision-api/src/` returns matches only in
  tests and the route's own response field — there is no producer call. **Impact:** ClickHouse will
  never receive `ab.assignment` rows, which breaks the analytics dashboard's per-session holdout
  audit trail and any future causal inference (TICKET-CAUSAL-001). The schema is "wired everywhere
  except the actual emission site." → FOLLOW-006 (P0, backend-engineer, 3h).
- **AC-6 partially implemented — Thompson sampling is NEVER called from the adapt hot path.**
  `apps/decision-api/src/lib/bandit.ts` exports `thompsonSample()`, `sampleBeta()`,
  `updateBanditArm()`, all unit-tested in isolation. But:
  `grep -rn "thompsonSample\|sampleBeta\|updateBanditArm" apps/decision-api/src/` returns results
  only in `bandit.ts` itself and `bandit.test.ts`. The `bandit` module is imported by zero non-test
  files. `apps/decision-api/src/app/api/adapt/route.ts` still uses keyword-based `detectArchetype()`
  to select directives and never consults `ab_bandit_weights`. **Impact:** the entire bandit
  infrastructure is dead code at runtime. RETRO-001 already flagged the variant_index propagation
  gap (FOLLOW-001); this is the deeper sibling — the bandit selection itself doesn't run. →
  FOLLOW-007 (P0, backend-engineer, 4h, supersedes/expands FOLLOW-001's scope to also wire reads
  from `ab_bandit_weights` and sample at request time).
- **AC-6 seed data missing — `ab_bandit_weights` has zero rows for any tenant.** The migration
  creates the table but there is no follow-up `INSERT` statement, no
  `0005_seed_ab_bandit_weights.sql`, and no application-level on-tenant-create hook that seeds
  Beta(1,1) rows for the 18 archetypes. The ticket spec explicitly says "Seeded
  `variant = 'default'` for all 18 archetypes (uniform Beta(1,1) prior)" — this is in the ticket
  context but not in the AC list, so it slipped through PR review. Combined with the dead-code
  bandit (above), `ab_bandit_weights` is currently a schema-only artifact. → FOLLOW-008 (P0,
  data-engineer, 2h).
- **AC-7 not implemented — no regression-detection scheduled job.** `shouldAutoPause()` and
  `twoProportionZTestPValue()` are pure functions exported from `ab-assignment.ts` and unit-tested,
  but no Modal cron, Cloudflare scheduled worker, or inline check in the adapt route actually calls
  `shouldAutoPause()` with live ClickHouse data. No Sentry alert wiring either. The `paused boolean`
  column exists and the PATCH resume endpoint exists (added by AB-004), but the set-to-true side of
  the lifecycle has no producer. **Impact:** No archetype will ever be auto-paused; the "regression
  detection" claim in the ticket is aspirational. → FOLLOW-009 (P1, data-engineer, 6h, Sprint 9 or
  10 — needs ClickHouse `cta_clicked` rates available, which depends on DQS conversion signals being
  fully wired).
- **AC-5 partially implemented — `holdout_group` column exists in ClickHouse DDL but nothing writes
  to `adaptation_decisions` from the Decision API.** The decision-api stub returns directives in
  HTTP response only; it does not insert into ClickHouse. The `adaptation_decisions` writer (which
  presumably lives in the stream-consumer or a Modal job introduced in TICKET-ADP-001) was not
  updated by this PR to include `holdout_group` in the insert path. **Impact:** All AB-004 analytics
  queries that filter `holdout_group=true/false` will only ever read the column default (`false`),
  making the holdout/treatment split un-distinguishable in production data. → FOLLOW-010 (P0,
  data-engineer, 3h).

#### 3b. Code bugs not caught

- **`detectArchetype` returns lowercase tenant-supplied `archetype_hint` directly.** In the
  high-confidence branch (`confidence >= 0.6 && hint`),
  `apps/decision-api/src/app/api/adapt/route.ts:163-178` sets
  `archetype = hint.trim().toLowerCase()` and uses it as-is for the response's `archetype` field,
  even though only `'investor'` / `'family'` keyword paths actually map to playbook directives —
  every other value falls through to `NEUTRAL_DIRECTIVES_BASE` but still labels the response with
  the un-validated hint string. A tenant passing `archetype_hint: 'yield_hunter'` with
  `confidence: 0.7` will get neutral directives but an `archetype: "yield_hunter"` label. This is
  pre-existing (TICKET-ADP-001/TICKET-FIX-015) — AB-001 did not introduce it but the new holdout
  branch interacts with it: holdout always relabels to `'neutral'`, hiding the bug for 10% of
  traffic. **Severity:** P2 (cosmetic in MVP; impactful once 18-archetype playbook is fully wired).
  Not in AB-001 scope → flag for visibility only, no follow-up needed because TICKET-046 already
  added 18-archetype playbooks (PR #92) and a future ticket should switch `detectArchetype` from
  keyword matching to the playbook map.
- **`Math.random()` in bandit.ts is non-deterministic and not seeded per request.** This is correct
  for production Thompson sampling (we want randomness across requests) but it makes every
  `thompsonSample()` call non-idempotent — opposite of the AC-2 guarantee for `assignHoldout`.
  Currently this only manifests in tests via convergence/distribution assertions; once integrated
  into the adapt hot path (FOLLOW-007), every call to `/api/adapt` for the same session may return a
  different variant. The TICKET-AB-001 spec's AC-2 idempotency applies only to holdout assignment,
  but a downstream consumer (the SDK rendering variant copy) will need its own per-session caching
  to avoid flicker. **Severity:** P1 once FOLLOW-007 lands — must be designed-in (cache last
  `variant_index` per session in Redis or rederive deterministically from session_id hash + Beta
  posterior). Flag in FOLLOW-007 spec.

#### 3c. Test coverage gaps

- **No integration test that mounts the route AND verifies the `ab.assignment` event reaches
  Redpanda (or an in-process mock producer).** Tests only assert the HTTP response shape. If AC-4
  had been a wired-and-tested behavior, the producer-call assertion would have caught the missing
  emission. → covered by FOLLOW-006 (test added with the emission).
- **No test that asserts `apps/decision-api/src/lib/bandit.ts` is actually imported by the adapt
  route.** A simple `expect(import.meta).toHaveImported('../lib/bandit.js')`-style assertion or a
  higher-level integration test would have caught the dead-code gap. → covered by FOLLOW-007.
- **No test that the `ab_bandit_weights` table has rows for newly-created tenants.** A fixture-based
  test (`createTenant() → expect 18 rows in ab_bandit_weights`) would have caught FOLLOW-008. →
  covered by FOLLOW-008.
- **Fraction tests use `Math.random()` for `session_id` generation (lines 79, 92 of
  ab-assignment.test.ts).** Combined with `Promise.all` parallelism, these tests are
  non-deterministic across runs. If a future change drifts the distribution, the test could flake on
  CI rather than fail. **Severity:** P2 — convert to a seeded PRNG or fixed-list session_ids. Not
  blocking. → FOLLOW-011 (qa-engineer, 1h, P3).

#### 3d. Documentation gaps

- **Master Design E.3 / E.3.1 / E.3.2 wording suggests the bandit selects variants at request time**
  (the ticket spec quotes this verbatim). But the implementation only stores parameters; selection
  is unwired. The doc needs either a "Status: schema ready, selection deferred to Sprint 9/10" note
  OR the implementation needs to catch up. **Action:** Once FOLLOW-007 lands, reaffirm doc; until
  then add an inline status note. → FOLLOW-012 (architect, 0.5h, P2).
- **No ADR for the consent-state mapping.** `ab-assignment.ts` defines a separate
  `SKIP_CONSENT_STATES = {'opted_out', 'unknown', 'none'}` while the canonical `ConsentStateSchema`
  uses `'none' | 'session-only' | 'legitimate-interest' | 'consented'`. The two sets overlap only on
  `'none'`. The AB-001 module accepts both vocabularies via a loose `string` type. This divergence
  is documented in a code comment (lines 22–31 of ab-assignment.ts) but not in an ADR or in
  MASTER_DESIGN.md. Future GDPR-004 (TICKET-GDPR-004, Sprint 9) will need to unify these
  vocabularies; the divergence is a latent bug. → FOLLOW-013 (compliance-engineer +
  backend-engineer, 2h, Sprint 9, P1 — coordinate with GDPR-004).
- **`packages/db/migrations/0004_ab_bandit_weights.sql` RLS policy uses `auth.jwt()` extraction but
  does not document the required tenant_id claim shape.** Other migrations (e.g. tenants table) have
  a similar pattern but it's not centrally documented. Minor — not creating a follow-up; will be
  picked up by Sprint 9 RLS-audit work.

### 4. Cascading impact

#### 4a. Current sprint tickets affected

- **TICKET-AB-004 (DONE, PR #99):** This ticket SHIPPED while still reading from the mock
  `/api/ab/weights` route. Per the route's own header comment ("MVP stub: returns deterministic mock
  data keyed on tenant_id. Real Drizzle DB queries (packages/db abBanditWeights table) will replace
  this in TICKET-AB-004"), AB-004 was supposed to replace the stub with real queries — but
  `git log -- apps/control-plane/src/app/api/ab/weights/route.ts` shows it has NOT been modified
  since the AB-001 commit. **Severity:** P0 — the analytics dashboard's Anomaly Feed (Panel 5) and
  any holdout-based query is currently rendering fabricated data. Every AB-004 panel that aggregates
  from `/api/ab/weights` displays seed-derived noise, not real bandit state. This is the single
  largest cascading defect from AB-001 → AB-004. → FOLLOW-014 (P0, backend-engineer, 3h, Sprint 8
  immediate — must land before any pilot tenant sees the dashboard).
- **TICKET-REORDER-001 (DONE, PR #91):** Independent of bandit selection; no impact.
  ReorderDirective uses archetype-keyed reorder rules, not variant indices. Confirmed clean.
- **TICKET-046 (DONE, PR #92):** Already covered by RETRO-001 FOLLOW-001 — variant_index unwired.
  Combine FOLLOW-001 (variant_index propagation through SDK) and the new FOLLOW-007 (Thompson
  selection in adapt route) into a single coordinated work item; do NOT promote them as independent
  tickets because they form one end-to-end wire. **Action:** PM should fold FOLLOW-001 into
  FOLLOW-007 at sprint planning. Both currently `promoted_to_queue: false` in FOLLOW_UPS.md — fold
  instead of dual-promote.
- **TICKET-AGENCY-001 (DONE, PR #97):** Independent — answers RAG pipeline does not touch bandit or
  holdout state. Clean.
- **TICKET-ARCH-003 (READY_FOR_REVIEW, PR #95):** The retrospective learning loop itself — this very
  RETRO-002 is the second invocation. No impact, but note: RETRO-001 was authored before the analyst
  had visibility into AB-001's full implementation gaps, leading to an underestimate (FOLLOW-001
  framed the gap as "variant_index propagation" only; the real gap is much wider — see FOLLOW-007).
  The learning loop is working as designed: each retro reveals more once preceded by other retros.

#### 4b. Future sprint tickets affected

- **TICKET-CAUSAL-001 (Sprint 8 BACKLOG, P2):** Depends on AB-001 holdout data. With AC-4 (event
  emission) and AC-5 (ClickHouse writes) both unwired, the prerequisite "2+ weeks of real holdout
  data in production" cannot start its clock. CAUSAL-001 cannot meaningfully begin until FOLLOW-006
  and FOLLOW-010 land. → block CAUSAL-001 explicitly on FOLLOW-006 + FOLLOW-010 + 14 days of
  post-deploy traffic.
- **TICKET-GDPR-004 (Sprint 9, BACKLOG, P0):** "Extends TICKET-AB-001 consent-aware skip pattern to
  full personalization gate." GDPR-004 inherits the consent-vocabulary divergence from AB-001
  (Section 3d above) and MUST unify the two sets (`SKIP_CONSENT_STATES` vs `ConsentStateSchema`)
  before adding the `consent_required` tenant-region default logic. Note this in the GDPR-004 ticket
  spec (currently in `backlog/sprint-9/TICKET-GDPR-004.md`) before Sprint 9 starts. → FOLLOW-013.
- **TICKET-DESC-001 (Sprint 9, BACKLOG, P1):** Uses `copy_template` from TICKET-046, not bandit
  state. No direct AB-001 dependency. Clean.
- **TICKET-VAL-001 (Sprint 9, BACKLOG, P1):** Schema validation cron — unrelated to bandit. Clean.

#### 4c. Contracts changed that other modules rely on

- `AdaptResponse.holdout_group?: boolean` — optional, so additive. The SDK
  (`packages/sdk/src/core/adapt.ts`) does not yet consume this field; once a session-stickiness
  cache is needed (Section 3b above), the SDK must thread `holdout_group` through. Currently no
  consumer = no breakage.
- `EVENT_TYPES` tuple grew by `'ab.assignment'` — additive. Any code doing exhaustive switch on
  event type would benefit from a TS exhaustiveness check; not currently present anywhere I can
  find, so no immediate action.
- `apps/decision-api/src/lib/ab-assignment.ts` exports — new public surface. The
  `SKIP_CONSENT_STATES` set is exported but uses a tuple-as-Set pattern with the assertion
  `as 'opted_out' | 'unknown' | 'none'` at the call site. This couples the module to those three
  literal values; expanding to ConsentStateSchema's full set later will require updating the
  assertion. Flag in FOLLOW-013.

#### 4d. Architectural assumptions affected

- Master Design E.3 / E.3.1 assumes "Thompson sampling bandit selects best variant per archetype
  based on rolling conversion lift, with regression detection auto-pausing underperforming arms."
  Implemented as schema + pure-function library only; runtime selection and pause are both unwired.
  **The architecture is sound — the wiring is incomplete.** Same conclusion as RETRO-001 reached for
  `copy_template` (different pipeline, same shape of gap). This is now a confirmed **second
  instance** of the pattern: "ship the schema, defer the wiring." See Section 5.
- The fair-housing constraint (Master Design + ESCALATIONS resolution) IS correctly enforced in
  code: `assignHoldout()` takes only `tenant_id + session_id`. Confirmed clean.

### 5. New lesson candidates

- **Pattern: "Schema/scaffold complete, runtime wiring deferred — no test asserts the wiring
  exists"** — seen in RETRO-001 (FOLLOW-001: variant_index unwired, FOLLOW-002: copy_template
  pipeline unbuilt) AND now in RETRO-002 (FOLLOW-006 ab.assignment never emitted, FOLLOW-007 bandit
  never called, FOLLOW-008 seed missing, FOLLOW-010 ClickHouse writes missing). Count: **2 retros,
  ≥4 distinct instances**. **Threshold: 2 — MET.** Promoting to CONVENTIONS_PATCH.md as Rule H.
- **Pattern: "Mock API route ships with comment 'real impl in TICKET-X' but TICKET-X merges without
  replacing the mock"** — seen in RETRO-002 (AB-001 → AB-004 cascade). Count: 1 retro, 1 instance.
  **Threshold: 2 — NOT YET met.** Track for next retro. If a similar pattern appears, promote.
- **Pattern: "AC list and ticket context body disagree about required deliverables (seed data in
  context, not in AC → omitted)"** — seen in RETRO-002 (AC-6 seed). Count: 1. **Threshold: 2 — NOT
  YET met.** Track.

### 6. Follow-ups

- FOLLOW-006: Emit `ab.assignment` event from decision-api adapt route on every non-skipped
  assignment (backend-engineer, 3h, P0, Sprint 8 immediate)
- FOLLOW-007: Wire Thompson sampling into the adapt hot path — read `ab_bandit_weights`, sample
  variant per archetype, return `variant_index` in response, propagate through SDK
  (backend-engineer + sdk-engineer, 6h, P0, Sprint 9 — supersedes/expands FOLLOW-001)
- FOLLOW-008: Seed `ab_bandit_weights` with 18 archetype rows × variant='default' per tenant
  (on-tenant-create hook + backfill migration for existing tenants) (data-engineer, 2h, P0, Sprint 8
  immediate)
- FOLLOW-009: Build regression-detection scheduled job — daily ClickHouse query →
  `shouldAutoPause()` → set `paused=true` + Sentry alert (data-engineer, 6h, P1, Sprint 9 or 10)
- FOLLOW-010: Wire `holdout_group` into ClickHouse `adaptation_decisions` insert path (so AB-004
  panels read real data) (data-engineer, 3h, P0, Sprint 8 immediate)
- FOLLOW-011: Replace `Math.random()` session_ids in `ab-assignment.test.ts` fraction tests with
  seeded PRNG for deterministic CI (qa-engineer, 1h, P3, when convenient)
- FOLLOW-012: Update MASTER_DESIGN.md E.3 with implementation-status note pending FOLLOW-007
  (architect, 0.5h, P2, Sprint 8)
- FOLLOW-013: Unify consent vocabulary (`SKIP_CONSENT_STATES` ↔ `ConsentStateSchema`) and document
  in ADR before TICKET-GDPR-004 starts (compliance-engineer + backend-engineer, 2h, P1, Sprint 9 —
  coordinate with GDPR-004)
- FOLLOW-014: Replace mock `/api/ab/weights` in control-plane with real Drizzle reads from
  `ab_bandit_weights` (backend-engineer, 3h, P0, Sprint 8 immediate — AB-004 dashboard depends on
  this for non-fake data)

### 7. Cross-references

- **RETRO-001 (TICKET-046):** FOLLOW-001 (variant_index propagation) was the first surfaced symptom
  of the same root cause this retro now traces: the bandit selection layer is entirely unwired.
  **FOLLOW-001 should be folded into FOLLOW-007** at sprint planning (do NOT dual-promote). The
  deeper pattern — "schema scaffold complete, runtime wiring deferred" — is now confirmed across two
  retros and is promoted to Rule H in CONVENTIONS_PATCH.md.
- **ESCALATIONS.md (TICKET-AB-001 fair-housing resolution, 2026-05-13):** The fair-housing
  constraint IS correctly enforced in code (Section 4d). Confirmed compliance.
- **CONVENTIONS_PATCH.md Rule G (RETRO-001):** Not directly triggered here — no `PlaybookEntry`
  required-field change in this PR.

---

<!-- RETRO-003 and beyond will be appended here by the retrospective-analyst agent -->
